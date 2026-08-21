// systems/rpg/module/documents/actor.js
import { sumActiveEffectMods } from "../rules/status-effects.js";
import {
  DAMAGE_TYPE_KEYS, emptyResistMap, normalizeResistMap, sumResistMaps, isDamageType
} from "../rules/damage-types.js";
import { BASE_VITESSE } from "../rules/base-speed.js";
import { isPassif, equippedPassif, effectiveStates, passifFallbackAllowed } from "../rules/loadout.js";

function clamp(v, min, max) {
  v = Number(v) || 0;
  return Math.max(min, Math.min(max, v));
}

function scoreToPct(score) {
  const S = Math.max(0, Number(score) || 0);
  const K = 160;
  const CAP = 70;
  const pct = (S / (S + K)) * 100;
  return Math.min(CAP, Math.round(pct));
}

/**
 * Paliers d'encombrement, en fraction de la capacité (pods).
 *
 * « lourd » et « surcharge » ne se CUMULENT pas : le palier atteint remplace
 * le précédent (à 100 %, on subit -50 % de vitesse, pas -50 % ET -1).
 * « bloque » est le plafond dur — au-delà, plus rien n'entre dans le sac
 * (voir chargeCheck dans rules/inventory.js) ; côté vitesse il se comporte
 * comme « surcharge ».
 */
export const CHARGE_TIERS = { lourd: 0.9, surcharge: 1.0, bloque: 1.2 };

/** Multiplicateur de vitesse appliqué dès 100 % de la capacité. */
export const CHARGE_OVERLOAD_SPEED_MULT = 0.5;

/** Types d'items qui ne pèsent rien (ce ne sont pas des objets transportés). */
const WEIGHTLESS_TYPES = new Set(["spell", "skill"]);

/**
 * Arrondi des distances en mètres, au centimètre.
 *
 * Les vitesses sont des mètres et gardent leurs décimales (4,5 m = 4 m 500).
 * L'arrondi ne sert qu'à absorber le bruit des flottants (un ×0,5 suivi d'un
 * +20 % produit vite des 4.499999999999999), pas à tronquer la valeur.
 */
export function roundMeters(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/** Palier d'encombrement correspondant à un ratio charge/capacité. */
export function chargeTierOf(ratio) {
  const r = Number(ratio) || 0;
  if (r >= CHARGE_TIERS.bloque)     return "bloque";
  if (r >= CHARGE_TIERS.surcharge)  return "surcharge";
  if (r >= CHARGE_TIERS.lourd)      return "lourd";
  return "normal";
}

/**
 * Poids total porté par un acteur, sorts et compétences exclus.
 *
 * Unique définition du « poids porté » : prepareDerivedData s'en sert pour les
 * paliers, la barre d'encombrement de la fiche l'affiche, et inventory.js
 * l'interroge avant d'accepter un objet. Trois calculs séparés finissaient par
 * diverger — un joueur bloqué à 118 % affiché est exactement le genre de bug
 * que ça produit.
 */
export function carriedWeight(actor) {
  let total = 0;
  for (const item of actor?.items ?? []) {
    if (WEIGHTLESS_TYPES.has(item.type)) continue;
    const sys = item.system ?? {};
    const poids = Number(sys.poids ?? 0) || 0;
    const qte = Number(sys.qte ?? 1) || 1;
    total += poids * qte;
  }
  return Math.round(total * 10) / 10;
}

function hpState(pct) {
  if (pct >= 100) return "En forme";
  if (pct >= 75) return "Légèrement blessé";
  if (pct >= 50) return "Blessé";
  if (pct >= 15) return "Gravement blessé";
  if (pct > 0) return "À l'agonie";
  return "KO";
}

function sumBonuses(actor) {
  const totals = {
    principales: { force: 0, intelligence: 0, dexterite: 0, acuite: 0, endurance: 0 },
    defenses: { armureFixe: 0, resistanceFixe: 0, scoreArmure: 0, scoreResistance: 0 },
    ressources: { pvMax: 0, manaMax: 0, fatigueMax: 0 },
    regen: { pv: 0, mana: 0 },
    move: { vitesse: 0 },
    charge: { podsMax: 0 },
    // initiativeMod : prepareDerivedData lisait déjà `bonus.combat.initiativeMod`
    // (deux fois : effective.initiative et derived.initiativeMod) alors que rien
    // ne l'alimentait — ni ce cumul, ni un champ dans equipBonus, ni une entrée
    // sur les fiches. Exactement la même mort silencieuse que fatigueMax et
    // podsMax avant lui : la lecture valait 0 pour toujours.
    combat: { toucherPhysique: 0, toucherMagique: 0, initiativeMod: 0 },
    // Résistances élémentaires apportées par l'équipement porté — même règle
    // que les autres bonus : il faut que l'objet soit équipé, et un monstre
    // ne porte pas d'équipement (voir isEquip plus bas).
    resistancesElem: emptyResistMap()
  };

  const isMonster = actor.type === "monster";
  const wornPassif = equippedPassif(actor);

  for (const item of actor.items) {
    const t = item.type;
    const sys = item.system ?? {};

    // ✅ Monstres: pas d'équipement weapon/armor/relic (on ignore)
    const isEquip = !isMonster && (t === "weapon" || t === "armor" || t === "relic") && !!sys.equipe;

    // Le TALENT porté est une source de résistances au même titre qu'une
    // pièce d'équipement (rules/loadout.js). Ses BONUS DE STATS, eux, ne
    // passent pas par ici : ils vivent dans `system.mods` et sont lus par
    // sumActiveEffectMods, ce qui leur donne l'initiative et le mode
    // pourcentage que cette grille-ci ne connaît pas. Seule la partie
    // resistancesElem / resistances a besoin de ce chemin.
    const isWornTalent = t === "talent" && !!sys.equipe;

    // ✅ PJ + Monstres: le sort passif PORTÉ (un seul emplacement, loadout.js)
    // Le repli « aucun porté ⇒ tous comptent » ne vaut plus que pour un
    // acteur sans emplacement à l'écran — un monstre. Voir
    // passifFallbackAllowed : sur un personnage, il faisait de
    // « — Aucun passif — » l'exact contraire de ce qu'il annonce.
    // `aura.active` reste accepté pour les sorts non passifs qui s'en
    // servaient comme bascule (rétrocompat).
    const isPassiveSpell = (t === "spell")
      && (isPassif(item)
            ? (item.id === wornPassif?.id || (!wornPassif && passifFallbackAllowed(actor)))
            : !!sys?.aura?.active);

    if (!isEquip && !isPassiveSpell && !isWornTalent) continue;

    const b = sys.bonus ?? {};

    totals.principales.force += Number(b.force ?? 0) || 0;
    totals.principales.intelligence += Number(b.intelligence ?? 0) || 0;
    totals.principales.dexterite += Number(b.dexterite ?? 0) || 0;
    totals.principales.acuite += Number(b.acuite ?? 0) || 0;
    totals.principales.endurance += Number(b.endurance ?? 0) || 0;

    totals.ressources.pvMax += Number(b.pvMax ?? 0) || 0;
    totals.ressources.manaMax += Number(b.manaMax ?? 0) || 0;
    // fatigueMax : prepareDerivedData lisait déjà `bonus.ressources.fatigueMax`
    // alors que rien ne l'a jamais alimenté — ni ce cumul, ni un champ dans
    // equipBonus. La lecture valait donc 0 pour toujours : du code mort, et
    // aucun équipement ne pouvait toucher à la réserve de fatigue.
    totals.ressources.fatigueMax += Number(b.fatigueMax ?? 0) || 0;

    totals.move.vitesse += Number(b.vitesse ?? 0) || 0;
    // podsMax : le champ existait sur les fiches d'arme et d'armure mais
    // n'était cumulé nulle part — un sac de voyage « +20 pods » n'ajoutait
    // rien. Même famille de champ mort que fatigueMax et les régén.
    totals.charge.podsMax += Number(b.podsMax ?? 0) || 0;

    totals.defenses.armureFixe += Number(b.armureFixe ?? 0) || 0;
    totals.defenses.resistanceFixe += Number(b.resistanceFixe ?? 0) || 0;
    totals.defenses.scoreArmure += Number(b.scoreArmure ?? 0) || 0;
    totals.defenses.scoreResistance += Number(b.scoreResistance ?? 0) || 0;

    // Régén : des POINTS PAR TOUR, pas un pourcentage. Le pourcentage était
    // inutilisable en pratique — il multipliait une base de 1 ou 2 puis
    // arrondissait à l'entier inférieur, donc tout ce qui était sous +100 %
    // ne rendait rien du tout (la pesée le signalait comme un bonus mort).
    // L'ancien champ reste lu en repli, converti au même résultat qu'il
    // produisait sur une base de 1 (+100 % = +1) : un objet écrit avant ce
    // changement continue de donner ce qu'il donnait, et se nettoie tout seul
    // au prochain enregistrement de sa fiche.
    const legacyRegen = (pct) => Math.floor((Number(pct ?? 0) || 0) / 100);
    totals.regen.pv += (b.regenPv !== undefined)
      ? (Number(b.regenPv) || 0) : legacyRegen(b.regenPvPct);
    totals.regen.mana += (b.regenMana !== undefined)
      ? (Number(b.regenMana) || 0) : legacyRegen(b.regenManaPct);

    totals.combat.toucherPhysique += Number(b.toucherPhysique ?? 0) || 0;
    totals.combat.toucherMagique += Number(b.toucherMagique ?? 0) || 0;
    totals.combat.initiativeMod += Number(b.initiativeMod ?? 0) || 0;

    // ⚠️ system.resistancesElem, PAS system.bonus.* : les résistances
    // élémentaires d'un objet vivent à côté de system.resistances (états),
    // pas dans la grille de bonus de stats.
    const re = sys.resistancesElem;
    if (re && typeof re === "object") {
      for (const k of DAMAGE_TYPE_KEYS) {
        totals.resistancesElem[k] += Number(re[k] ?? 0) || 0;
      }
    }
  }

  return totals;
}

/**
 * Résistances aux DÉGÂTS accordées par les états actifs.
 *
 * Lit `state.resistanceDamage = {tag, pct}` — et surtout PAS
 * `state.resistance`, qui est la résistance aux ÉTATS (durée, dégâts par
 * tour, immunité) que lit resistances.js. Les deux sont deux champs
 * distincts de la fiche de sort, chacun avec son propre type visé : un buff
 * peut réduire les dégâts de feu sans rien changer aux brûlures.
 */
function sumStateResistances(actor) {
  const out = emptyResistMap();
  // Le passif porté compte comme un état actif : ses résistances ne sont
  // écrites nulle part, elles sont recalculées (effectiveStates, loadout.js).
  const states = effectiveStates(actor);
  for (const st of states) {
    const r = st?.resistanceDamage;
    if (!r || typeof r !== "object") continue;
    const tag = String(r.tag ?? "").trim().toLowerCase();
    if (!isDamageType(tag)) continue;
    out[tag] += Number(r.pct ?? 0) || 0;
  }
  return out;
}

export class RPGActor extends Actor {
  getRollData() {
    const data = super.getRollData();
    const eff  = this.system?.derived?.effective ?? {};
    data.eff   = eff;

    // ⚠️ Garantit des valeurs NUMÉRIQUES pour toutes les clés utilisées dans les
    // formules (initiative : @effP.dexterite + @effP.acuite). Sinon un acteur
    // dont les données dérivées ne sont pas encore calculées donne @effP.x =
    // undefined → Roll crée un « StringTerm undefined » et rollInitiative crashe.
    const num = (v) => Number(v) || 0;
    const effPsrc = eff.principales ?? this.system?.principales ?? {};
    data.effP = {
      force:        num(effPsrc.force),
      intelligence: num(effPsrc.intelligence),
      dexterite:    num(effPsrc.dexterite),
      acuite:       num(effPsrc.acuite),
      endurance:    num(effPsrc.endurance)
    };

    const effDsrc = eff.defenses ?? this.system?.defenses ?? {};
    data.effD = {
      armureFixe:       num(effDsrc.armureFixe),
      resistanceFixe:   num(effDsrc.resistanceFixe),
      scoreArmure:      num(effDsrc.scoreArmure),
      scoreResistance:  num(effDsrc.scoreResistance)
    };

    // Bonus d'initiative garanti numérique (utilisé par CONFIG.Combat.initiative
    // = "1d100 + @init"). Repli calculé si les données dérivées manquent.
    const derivedInit = this.system?.derived?.initiativeMod;
    data.init = Number.isFinite(Number(derivedInit))
      ? Number(derivedInit)
      : Math.floor((data.effP.dexterite + data.effP.acuite) / 2);
    return data;
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    const sys = this.system ?? {};
    sys.derived = sys.derived ?? {};
    sys.derived.effective = sys.derived.effective ?? {};
    sys.derived.reductions = sys.derived.reductions ?? {};
    sys.derived.damageBonus = sys.derived.damageBonus ?? {};
    sys.base = sys.base ?? {};

    const isMonster = this.type === "monster";

    // BASE (éditable)
    const baseP = sys.principales ?? {};
    const baseD = sys.defenses ?? {};
    const baseR = sys.ressources ?? {};
    const baseReg = sys.regeneration ?? {};
    const baseMove = sys.deplacement ?? {};

    // ✅ Fix dérive vitesse : sys.deplacement.vitesse est le champ DÉRIVÉ (réécrit
    // plus bas), jamais une vraie base. La vraie base éditable vit dans sys.base.vitesse
    // — initialisée une fois depuis l'ancienne valeur pour ne rien perdre.
    if (sys.base.vitesse === undefined) {
      sys.base.vitesse = Number(baseMove.vitesse ?? BASE_VITESSE) || BASE_VITESSE;
    }

    // BONUS items / sorts passifs
    const bonus = sumBonuses(this);

    sys.derived.bonus = bonus;

    // Etats (mods)
    const modsAE = (typeof sumActiveEffectMods === "function") ? sumActiveEffectMods(this) : null;
    const flat = modsAE?.flat ?? {};
    const pct = modsAE?.pct ?? {};
    sys.derived.etats = sys.derived.etats ?? {};
    sys.derived.etats.mods = modsAE;

    const applyPct = (val, p) => Number(val) * (1 + (Number(p) || 0) / 100);

    // -----------------------
    // 1) EFFECTIVE PRINCIPALES
    // -----------------------
    const effP = {
      force:        (Number(baseP.force        ?? 0) || 0) + bonus.principales.force,
      intelligence: (Number(baseP.intelligence ?? 0) || 0) + bonus.principales.intelligence,
      dexterite:    (Number(baseP.dexterite    ?? 0) || 0) + bonus.principales.dexterite,
      acuite:       (Number(baseP.acuite       ?? 0) || 0) + bonus.principales.acuite,
      endurance:    (Number(baseP.endurance    ?? 0) || 0) + bonus.principales.endurance
    };

    // ✅ Bonus de niveau : +1 à chaque stat principale par niveau
    const niveau = Math.max(1, Number(sys.niveau ?? 1) || 1);
    for (const s of ["force","intelligence","dexterite","acuite","endurance"]) {
      effP[s] += niveau;
    }

    // Stocke la contribution pour l'affichage sur la fiche
    sys.derived.fromLevel = niveau;

    // ✅ Photo AVANT les effets temporaires : c'est la valeur « permanente »
    // du personnage (base + niveau + équipement). La fiche l'affiche à côté
    // du total pour que le joueur voie ce que le combat ajoute ou retire.
    sys.derived.permanent = sys.derived.permanent ?? {};
    sys.derived.permanent.principales = { ...effP };

    for (const s of ["force", "intelligence", "dexterite", "acuite", "endurance"]) {
      effP[s] += Number(flat?.principales?.[s] ?? 0) || 0;
      effP[s] = applyPct(effP[s], pct?.principales?.[s]);
      // ✅ clamp à 0 pour respecter ta règle "pas en dessous de 0"
      effP[s] = Math.max(0, Math.floor(Number(effP[s]) || 0));
    }
    for (const s of ["force", "intelligence", "dexterite", "acuite", "endurance"]) {
      sys.derived.permanent.principales[s] = Math.max(0, Math.floor(Number(sys.derived.permanent.principales[s]) || 0));
    }

    // -----------------------
    // 2) DEFENSES (avec endurance finale)
    // -----------------------
    const SCORE_PER_END_STEP = 3;   // 3 END => +1 score
    const SCORE_PER_END_GAIN = 1;
    const scoreFromEnd = Math.floor(effP.endurance / SCORE_PER_END_STEP) * SCORE_PER_END_GAIN;

    const effD = {
      armureFixe: (Number(baseD.armureFixe ?? 0) || 0) + bonus.defenses.armureFixe,
      resistanceFixe: (Number(baseD.resistanceFixe ?? 0) || 0) + bonus.defenses.resistanceFixe,
      scoreArmure: (Number(baseD.scoreArmure ?? 0) || 0) + bonus.defenses.scoreArmure + scoreFromEnd,
      scoreResistance: (Number(baseD.scoreResistance ?? 0) || 0) + bonus.defenses.scoreResistance + scoreFromEnd
    };

    sys.derived.permanent.defenses = {};
    for (const k of ["armureFixe", "resistanceFixe", "scoreArmure", "scoreResistance"]) {
      sys.derived.permanent.defenses[k] = Math.max(0, Math.floor(Number(effD[k]) || 0));
      effD[k] += Number(flat?.defenses?.[k] ?? 0) || 0;
      effD[k] = applyPct(effD[k], pct?.defenses?.[k]);
      effD[k] = Math.max(0, Math.floor(Number(effD[k]) || 0));
    }

    sys.derived.effective.principales = effP;
    sys.derived.effective.defenses = effD;

    // -----------------------
    // 3) Réductions (doivent bouger avec les buffs/debuffs)
    // -----------------------
    sys.derived.reductions.physiquePct = scoreToPct(effD.scoreArmure);
    sys.derived.reductions.magiquePct = scoreToPct(effD.scoreResistance);

    // -----------------------
    // 3ter) Résistances élémentaires (second étage de mitigation)
    // -----------------------
    // Base propre à l'acteur (tirée à la génération pour un monstre, éditée
    // par le MJ sinon) + équipement porté + états actifs. Bornée une seule
    // fois dans sumResistMaps() : 100 = immunité, négatif = vulnérabilité.
    // La base est aussi réécrite normalisée pour qu'une fiche importée sans
    // le champ (ou avec des clés inconnues) affiche quand même sa grille.
    sys.resistancesElem = normalizeResistMap(sys.resistancesElem);
    sys.derived.resistancesElem = sumResistMaps(
      sys.resistancesElem,
      bonus.resistancesElem,
      sumStateResistances(this)
    );

    // -----------------------
    // 3bis) Bonus dégâts depuis stats (FOR/INT)
    // -----------------------
    sys.derived.damageBonus.physique = Math.floor(effP.force / 10);
    sys.derived.damageBonus.magique = Math.floor(effP.intelligence / 10);

    // -----------------------
    // 4) Ressources / regen / move
    // -----------------------
    const REGEN_STEP = 20;
    const PV_PER_END_STEP = 5; // 5 END => +1 PV
    const PV_PER_END_GAIN = 1;

    // pv max
    const basePvMax = Number(sys.base.pvMax ?? baseR?.pv?.max ?? 30) || 30;
    const pvFromEnd = Math.floor(effP.endurance / PV_PER_END_STEP) * PV_PER_END_GAIN;

    let pvMax = Math.max(1, basePvMax + pvFromEnd + (Number(bonus.ressources.pvMax ?? 0) || 0));

    // états -> ressources max (PV OK pour monstres aussi)
    pvMax += Number(flat?.ressources?.pvMax ?? 0) || 0;
    pvMax = applyPct(pvMax, pct?.ressources?.pvMax);
    pvMax = Math.max(1, Math.floor(pvMax));

    // mana : PJ normal, monstre forcé à 0 (même avec états)
    let manaMax = 0;

    if (!isMonster) {
      // Base : supporte sys.base.manaMax, sys.manaMax (template base), ou ressources existantes
      const baseManaMax = Number(
        sys.base.manaMax ??
        sys.manaMax ??
        baseR?.mana?.max ??
        5
      ) || 5;

      // Scaling : Intelligence => mana  
      const MANA_PER_INT_STEP = 20;      // 20 INT => +1 mana
      const manaFromInt = Math.floor((Number(effP.intelligence) || 0) / MANA_PER_INT_STEP);

      manaMax = baseManaMax + manaFromInt + (Number(bonus.ressources.manaMax ?? 0) || 0);

      // états -> mana max
      manaMax += Number(flat?.ressources?.manaMax ?? 0) || 0;
      manaMax = applyPct(manaMax, pct?.ressources?.manaMax);
      manaMax = Math.max(0, Math.floor(manaMax));
    }

    // regen PV : base (tirée en gen / editable) + scaling DEX/20 + bonus % + états
    const baseRegenPv = Number(
      sys.base.regenPv ??
      sys.regenPv ??              // template base
      baseReg?.pv ??              // system.regeneration.pv
      1
    ) || 1;
    const regenPvBase = baseRegenPv + Math.floor(effP.dexterite / REGEN_STEP);

    // Équipement : des points fermes, ajoutés à la base. Puis les états :
    // leur part plate, puis leur part en pourcentage — et le tout est arrondi
    // à l'entier INFÉRIEUR, y compris quand le pourcentage est un malus
    // (Math.floor arrondit vers le bas des deux côtés de zéro). La régén ne
    // descend jamais sous 0 : une régénération négative serait un DOT, ce
    // qu'un état sait déjà faire proprement.
    let regenPv = regenPvBase + (Number(bonus.regen.pv ?? 0) || 0);
    regenPv += Number(flat?.regen?.pv ?? 0) || 0;
    regenPv = applyPct(regenPv, pct?.regen?.pv);
    regenPv = Math.max(0, Math.floor(regenPv));

    // regen mana : monstre = 0, PJ = calcul normal (mais ici on garde ta règle monstre=0)
    let regenMana = 0;
    if (!isMonster) {
      const baseRegenMana = Number(
        sys.base.regenMana ??
        sys.regenMana ??            // template base
        baseReg?.mana ??            // system.regeneration.mana
        1
      ) || 1;
      const regenManaBase = baseRegenMana + Math.floor(effP.acuite / REGEN_STEP);

      regenMana = regenManaBase + (Number(bonus.regen.mana ?? 0) || 0);
      regenMana += Number(flat?.regen?.mana ?? 0) || 0;
      regenMana = applyPct(regenMana, pct?.regen?.mana);
      regenMana = Math.max(0, Math.floor(regenMana));
    }

    // -----------------------
    // ✅ WRITE REGEN (IMPORTANT)
    // -----------------------
    sys.regeneration = sys.regeneration ?? {};

    // Valeurs “source of truth” affichées dans la fiche si ton HBS est sur system.regeneration.*
    sys.regeneration.pv = regenPv;
    sys.regeneration.mana = regenMana;

    // ✅ Compat si certaines parties de ton système/HBS utilisent encore les champs “plats”
    sys.regenPv = regenPv;
    sys.regenMana = regenMana;


    // write ressources
    sys.ressources = sys.ressources ?? {};
    sys.ressources.pv = sys.ressources.pv ?? { valeur: pvMax, max: pvMax };
    sys.ressources.mana = sys.ressources.mana ?? { valeur: null, max: null };

    // PV
    sys.ressources.pv.max = pvMax;
    if (sys.ressources.pv.valeur === null || sys.ressources.pv.valeur === undefined) {
      sys.ressources.pv.valeur = pvMax; // init
    }
    sys.ressources.pv.valeur = clamp(Number(sys.ressources.pv.valeur) || 0, 0, pvMax);

    // MANA
    if (isMonster) {
      sys.ressources.mana.max = 0;
      sys.ressources.mana.valeur = 0;
    } else {
      sys.ressources.mana.max = manaMax;

      // ✅ init si valeur pas définie (ou si elle était restée à 0/0 d'une ancienne version)
      const hadNoManaValue =
        sys.ressources.mana.valeur === null ||
        sys.ressources.mana.valeur === undefined;

      if (hadNoManaValue) {
        sys.ressources.mana.valeur = manaMax; // init full
      }

      // si tu veux autoriser le négatif, mets min=-9999, sinon 0
      sys.ressources.mana.valeur = clamp(Number(sys.ressources.mana.valeur) || 0, -9999, manaMax);
    }

    // FATIGUE : max = base (10) + équipement + états. AUCUNE caractéristique
    // ne l'alimente, et c'est délibéré.
    //
    // L'Endurance y contribuait, tous les 20 points — un barème qui, aux
    // valeurs réellement pratiquées (une principale monte de +1 par niveau,
    // donc ~25 en fin de campagne), ne rendait jamais le moindre point : le
    // lien existait sur le papier et valait 0 en jeu. Le rétablir aurait
    // surtout donné TROIS rôles à l'Endurance (scores de défense, PV, puis
    // fatigue) contre un seul à la Dextérité et à l'Acuité, ce qui déséquilibre
    // la répartition des caractéristiques bien plus qu'une réserve de fatigue
    // figée. La fatigue passe donc par l'équipement et les effets, deux leviers
    // que le MJ dose objet par objet.
    sys.ressources.fatigue = sys.ressources.fatigue ?? { valeur: 0, max: 10 };
    let fatigueMax = Number(sys.base.fatigueMax ?? 10) + (Number(bonus.ressources.fatigueMax ?? 0) || 0);
    fatigueMax += Number(flat?.ressources?.fatigueMax ?? 0) || 0;
    fatigueMax = applyPct(fatigueMax, pct?.ressources?.fatigueMax);
    fatigueMax = Math.max(1, Math.floor(fatigueMax));

    sys.ressources.fatigue.max = fatigueMax;
    // La fatigue n'est PAS plafonnée à son max : le max est le seuil à partir
    // duquel l'épuisement frappe, pas une limite de stockage. Continuer à
    // s'épuiser au-delà est significatif (il faudra d'autant plus de repos
    // pour repasser sous le seuil). Seul le plancher à 0 est imposé.
    sys.ressources.fatigue.valeur = Math.max(0, Number(sys.ressources.fatigue.valeur) || 0);
    // pct sert aux jauges : borné à 100 pour ne pas déformer l'affichage.
    sys.ressources.fatigue.pctBrut = Math.round((sys.ressources.fatigue.valeur / fatigueMax) * 100);
    sys.ressources.fatigue.pct = Math.min(100, sys.ressources.fatigue.pctBrut);
    sys.ressources.fatigue.depassement = Math.max(0, sys.ressources.fatigue.valeur - fatigueMax);

    // ── Compat barres de token Foundry ──────────────────────────────────────
    // Foundry cherche un objet {value, max} pour une barre. Le système stocke
    // 'valeur' (FR) : on expose en plus 'value' (miroir) pour que le token
    // reconnaisse pv/mana/fatigue comme des barres "actuel / max".
    for (const r of ["pv", "mana", "fatigue"]) {
      const res = sys.ressources[r];
      if (res && typeof res === "object") res.value = Number(res.valeur) || 0;
    }

    // ✅ Épuisement : si fatigue au max → état "Fatigué" (-10% stats, -1 vitesse)
    // (appliqué APRÈS tous les autres mods)
    const isEpuise = sys.ressources.fatigue.valeur >= fatigueMax;
    sys.derived.epuise = isEpuise;
    if (isEpuise) {
      for (const s of Object.keys(effP)) {
        effP[s] = Math.max(0, Math.floor(Number(effP[s] ?? 0) * 0.9)); // -10%
      }
    }
    const epuiseVitesseMalus = isEpuise ? 1 : 0;
    const epuiseToucherMalus = isEpuise ? 1 : 0;

    // ✅ Surcharge — paliers, voir CHARGE_TIERS.
    //
    // La charge portée est recalculée ICI, depuis les objets, et publiée dans
    // sys.charge.podsActuels : c'est la SEULE source. Elle était auparavant
    // lue dans `sys.charge.actuelle ?? sys.charge.pods`, deux champs qui
    // n'existent nulle part (ni dans template.json, ni écrits par le code —
    // le seul champ réellement alimenté est `podsActuels`, par la fiche).
    // La lecture rendait donc toujours 0, la surcharge n'était jamais
    // détectée et son malus n'a jamais existé, alors même que la barre
    // d'encombrement de la fiche — qui recalculait le poids de son côté —
    // affichait correctement le dépassement.
    const chargeCur = carriedWeight(this);

    // ── Capacité de charge (pods) — calculée UNE SEULE FOIS ────────────────
    // Elle sert ici (détection de surcharge) et en section 7 : la calculer
    // aux deux endroits appliquait les modificateurs deux fois.
    let chargeMax;
    if (isMonster) {
      chargeMax = 0;
    } else {
      const basePodsMax = Number(sys.base.podsMax ?? sys.podsMax ?? 50) || 50;
      // Barème : 3 points de Force donnent 1 pod.
      const PODS_PER_FOR_STEP = 3;
      const podsFromFor = Math.floor((Number(effP.force) || 0) / PODS_PER_FOR_STEP);

      chargeMax = basePodsMax + podsFromFor + (Number(bonus.charge?.podsMax ?? 0) || 0);
      chargeMax += Number(flat?.charge?.podsMax ?? 0) || 0;
      chargeMax = applyPct(chargeMax, pct?.charge?.podsMax);
      chargeMax = Math.max(0, Math.floor(chargeMax));
    }
    sys.derived.podsFromForce = isMonster ? 0 : Math.floor((Number(effP.force) || 0) / 3);
    sys.derived.effective.podsMax = chargeMax;

    const chargeRatio = chargeMax > 0 ? (chargeCur / chargeMax) : 0;
    const chargeState = chargeTierOf(chargeRatio);

    sys.derived.chargeRatio = chargeRatio;
    sys.derived.chargePct = Math.round(chargeRatio * 100);
    sys.derived.chargeState = chargeState;
    // Conservé : la fiche et d'éventuelles macros lisent ce booléen. Il vaut
    // « au moins Lourd », c'est-à-dire l'ancien seuil de 90 %.
    sys.derived.surcharge = chargeState !== "normal";
    sys.derived.chargeBloque = chargeState === "bloque";

    // ≥ 90 % : -1 vitesse (plat). ≥ 100 % : -50 % à la place — les deux ne se
    // cumulent jamais, le palier haut REMPLACE le bas.
    const surchargeVitesseMalus = chargeState === "lourd" ? 1 : 0;
    const surchargeVitesseMult  = (chargeState === "surcharge" || chargeState === "bloque")
      ? CHARGE_OVERLOAD_SPEED_MULT
      : 1;

    // move — épuisement -1 vitesse + surcharge (-1 vitesse ou -50 %)
    sys.deplacement = sys.deplacement ?? {};
    const baseVit = (Number(sys.base.vitesse ?? 0) || 0) + (Number(bonus.move.vitesse ?? 0) || 0);
    // Vitesse « permanente » = base + équipement/compétences, sans les effets
    // temporaires ni les malus d'épuisement/surcharge.
    sys.derived.permanent = sys.derived.permanent ?? {};
    // La vitesse est en MÈTRES, pas en cases : elle garde ses décimales.
    // Un Math.floor ici transformait 4,5 m en 4 m, ce qui n'est pas un
    // arrondi d'affichage mais une perte réelle de 50 cm de déplacement à
    // chaque tour — toute la chaîne de mouvement (movement-tracker,
    // drag-limit, range-overlay, movement-ruler) travaille déjà en mètres
    // fractionnaires, c'était le seul endroit qui tronquait.
    sys.derived.permanent.vitesse = roundMeters(Math.max(0, baseVit));

    let vit = baseVit + (Number(flat?.move?.vitesse ?? 0) || 0) - epuiseVitesseMalus - surchargeVitesseMalus;
    // Les pourcentages s'appliquent APRÈS tous les plats, sur le total : un
    // % englobe donc toujours l'intégralité de la vitesse, quel que soit
    // l'ordre dans lequel les effets ont été posés ou lus. Les % d'effets
    // s'additionnent entre eux (+20 % et +30 % = +50 %), puis la surcharge
    // multiplie le résultat.
    vit = applyPct(vit, pct?.move?.vitesse);
    // Le -50 % de surcharge est un facteur SÉPARÉ, volontairement hors du
    // seau des pourcentages d'effets : fondu dedans, un buff de +50 %
    // l'annulerait purement et simplement (−50 +50 = 0), alors qu'être
    // surchargé doit dégrader la vitesse qu'on a, quelle qu'elle soit. Étant
    // multiplicatif, il reste commutatif avec le reste — l'ordre ne change
    // jamais le résultat.
    vit *= surchargeVitesseMult;
    sys.deplacement.vitesse = roundMeters(Math.max(0, vit));
    sys.derived.effective.vitesse = sys.deplacement.vitesse;

    // ✅ Chance de toucher (bonus direct, réduit le TN nécessaire)
    sys.derived.toucherPhysique = Number(sys.base.toucherPhysique ?? 0)
      + (Number(bonus.combat?.toucherPhysique ?? 0) || 0)
      + (Number(flat?.combat?.toucherPhysique ?? 0) || 0) - epuiseToucherMalus;
    sys.derived.toucherPhysique = applyPct(sys.derived.toucherPhysique, pct?.combat?.toucherPhysique);
    sys.derived.toucherPhysique = Math.floor(sys.derived.toucherPhysique);

    sys.derived.toucherMagique = Number(sys.base.toucherMagique ?? 0)
      + (Number(bonus.combat?.toucherMagique ?? 0) || 0)
      + (Number(flat?.combat?.toucherMagique ?? 0) || 0) - epuiseToucherMalus;
    sys.derived.toucherMagique = applyPct(sys.derived.toucherMagique, pct?.combat?.toucherMagique);
    sys.derived.toucherMagique = Math.floor(sys.derived.toucherMagique);

    // Stocke les valeurs effectives de combat dans derived.effective
    sys.derived.effective.vitesse        = sys.deplacement.vitesse;
    sys.derived.effective.toucherPhys    = sys.derived.toucherPhysique;
    sys.derived.effective.toucherMag     = sys.derived.toucherMagique;
    sys.derived.effective.initiative     = Math.floor(
      ((effP.dexterite ?? 0) + (effP.acuite ?? 0)) / 2
      + (Number(bonus.combat?.initiativeMod ?? 0) || 0)
      + (Number(flat?.combat?.initiativeMod ?? 0) || 0)
    );

    // -----------------------
    // 5) HP state
    // -----------------------
    const pvCur = Number(sys.ressources?.pv?.valeur ?? 0) || 0;
    const pvMaxForPct = Math.max(1, Number(sys.ressources?.pv?.max ?? 1) || 1);
    const pctHp = clamp(Math.round((pvCur / pvMaxForPct) * 100), 0, 100);
    sys.derived.hp = { pct: pctHp, etat: hpState(pctHp) };

    // ✅ KO : à 0 PV, ne peut plus agir à son tour — sauf exception cochée par le MJ
    sys.derived.ko = (pvCur <= 0) && !sys.ignoreKO;

    // ✅ À l'agonie (≤15% PV) : déclenche un jet de Volonté obligatoire,
    // une seule fois par combat, avant de pouvoir agir normalement à son tour
    sys.derived.agonie = (pctHp > 0) && (pctHp <= 15);

    // -----------------------
    // 6) InitiativeMod
    // -----------------------
    sys.derived.initiativeMod = Math.floor(((Number(effP.dexterite) || 0) + (Number(effP.acuite) || 0)) / 2);
    sys.derived.initiativeMod += (Number(bonus.combat?.initiativeMod ?? 0) || 0)
      + (Number(flat?.combat?.initiativeMod ?? 0) || 0)
      + (Number(flat?.initiative?.mod ?? 0) || 0);
    sys.derived.initiativeMod = applyPct(sys.derived.initiativeMod, pct?.combat?.initiativeMod ?? pct?.initiative?.mod);
    sys.derived.initiativeMod = Math.floor(sys.derived.initiativeMod);
    sys.derived.effective.initiative = sys.derived.initiativeMod;

    // -----------------------
    // 7) Pods (monstre = 0)
    // -----------------------
    sys.charge = sys.charge ?? {};
    // Déjà calculées plus haut (une seule fois) — on ne fait que les publier.
    sys.charge.podsMax = chargeMax;
    sys.charge.podsActuels = chargeCur;
    sys.podsMax = chargeMax;

  }
}
