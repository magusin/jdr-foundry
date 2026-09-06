// module/rules/monster-archetypes.js
//
// « Combien de PV je mets à mon gobelin de niveau 4 ? »
//
// Ce module répond à cette question par un CALCUL, pas par une intuition, et
// c'est tout son intérêt : jusqu'ici le bouton « + Initialiser les niveaux »
// de la fiche de monstre écrivait des plages à ZÉRO, et le MJ devait remplir
// une vingtaine de fourchettes par niveau sans que rien ne lui dise ce qu'une
// valeur vaut. Résultat constaté : des monstres sans stats, un bestiaire qui
// ne progresse pas avec le groupe, et une pesée (rules/item-value.js) qui
// annonçait « Trivial » sur tout.
//
// La méthode est l'inverse de celle d'une table de monstres écrite à la main :
// on part de ce que le GROUPE fait subir au monstre, et de ce que le monstre
// doit faire subir au groupe, puis on résout les stats qui produisent ces deux
// nombres.
//
//   1. `partyRefFor(niveau)` (item-value.js) donne le groupe de référence :
//      effectif, dégâts par attaque, PV, mitigation, Dex/Acuité. C'est LA
//      même référence que la pesée — un band généré ici et pesé par
//      `computeMonsterBandValues` doit tomber sur le palier annoncé, sinon
//      l'un des deux ment.
//   2. Un archétype fixe deux objectifs lisibles à la table :
//        - `tkill`  : combien de TOURS le groupe met à l'abattre ;
//        - `share`  : quelle fraction des PV d'UN PJ il enlève par tour.
//      Tout le reste (PV, scores d'armure, dés de sa capacité) se déduit.
//   3. Les formules employées sont celles du moteur, importées et non
//      recopiées : `mitigateDamage`/`tnFromRatio` (combat.js), le barème
//      score → % (K = 160, actor.js), Endurance → score (÷3) et → PV (÷5).
//      Une divergence ici produirait des monstres calibrés pour un jeu qui
//      n'est pas celui-ci.
//
// ⚠️ Les bandes s'écrivent AVANT le bonus d'Endurance : `prepareDerivedData`
// ajoute ⌊END/3⌋ aux scores et ⌊END/5⌋ aux PV par-dessus ce que la génération
// a écrit. Les valeurs produites ici sont donc les valeurs de fiche, déjà
// diminuées de cet apport — le même piège que `endInScores` dans la pesée.

import { partyRefFor } from "./item-value.js";
import { mitigateDamage, tnFromRatio, AUTO_FAIL_MAX, AUTO_SUCC_MIN } from "./combat.js";
import { DAMAGE_TYPE_KEYS } from "./damage-types.js";

const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r0 = (v) => Math.round(Number(v) || 0);

/** Chance de toucher d'un seuil, bornes d'auto-échec / auto-réussite comprises. */
export function hitChanceFor(tn) {
  const t = Math.min(AUTO_SUCC_MIN, Math.max(AUTO_FAIL_MAX + 1, Math.round(Number(tn) || 11)));
  return (21 - t) / 20;
}

/** Score d'armure/résistance produisant un pourcentage donné (barème actor.js : S/(S+160)). */
export function scoreForPct(pct) {
  const p = Math.min(69, Math.max(0, Number(pct) || 0));
  return Math.round((160 * p) / (100 - p));
}

/**
 * Archétypes.
 *
 * Les facteurs de stats sont exprimés en multiples de la principale de
 * référence du groupe au même niveau (`partyRefFor().dexterite`, soit
 * 5 + 2 × (niveau − 1)) : un monstre « à 1.0 » de Dextérité est touché une
 * fois sur deux, exactement comme le suppose la pesée. En dessous il est
 * facile à toucher, au-dessus il devient une plaie à l'épée.
 *
 * `share` est la fraction des PV d'UN PJ que la créature enlève par tour, une
 * fois la mitigation du groupe payée. Les valeurs sont calibrées sur ce que la
 * créature coûte au groupe PENDANT TOUTE SA VIE (`share × PV × tkill`, comparé
 * aux PV totaux du groupe) : un boss à 0,30 consomme ~80 % des PV du groupe
 * avant de tomber, quatre soldats à 0,15 en consomment ~60 %. C'est ce produit
 * qui compte, jamais le chiffre seul — 0,30 sur une créature qui tient huit
 * tours n'a rien à voir avec 0,30 sur une qui en tient un.
 *
 * `fight` est la fraction de COMBAT que représente un exemplaire : elle ne
 * sert qu'à l'XP, et c'est elle qui fait qu'un boss vaut à lui seul deux
 * combats et demi.
 */
export const ARCHETYPES = [
  {
    key: "pietaille", label: "Piétaille", icon: "🐀",
    hint: "figurant : se joue par 4 à 6, tombe en un tour",
    tkill: 1, share: 0.06, count: 6, fight: 0.15,
    force: 0.9, int: 0.5, dex: 0.9, acu: 0.8, end: 0.6,
    armPct: 8, resPct: 5, armFixe: 0, resFixe: 0,
    vitesse: 8, fatigue: 8, toucher: -1, regenPct: 0,
    livraison: "physique", portee: 1.5
  },
  {
    key: "soldat", label: "Soldat", icon: "🗡️",
    hint: "l'unité de base d'un combat : 3 à 4 font une rencontre",
    tkill: 2, share: 0.14, count: 3, fight: 0.33,
    force: 1.1, int: 0.6, dex: 1.0, acu: 0.9, end: 1.0,
    armPct: 15, resPct: 10, armFixe: 1, resFixe: 0,
    vitesse: 8, fatigue: 10, toucher: 0, regenPct: 0,
    livraison: "physique", portee: 1.5
  },
  {
    key: "brute", label: "Brute", icon: "🪓",
    hint: "lente et blindée : encaisse le groupe pendant que le reste frappe",
    tkill: 4, share: 0.32, count: 1, fight: 0.5,
    force: 1.6, int: 0.5, dex: 0.7, acu: 0.6, end: 1.6,
    armPct: 25, resPct: 12, armFixe: 2, resFixe: 0,
    vitesse: 6, fatigue: 14, toucher: 0, regenPct: 2,
    livraison: "physique", portee: 2
  },
  {
    key: "rodeur", label: "Rôdeur", icon: "🏹",
    hint: "rapide, difficile à toucher, fragile : tire et décroche",
    tkill: 1.5, share: 0.34, count: 2, fight: 0.4,
    force: 0.9, int: 0.7, dex: 1.4, acu: 1.2, end: 0.7,
    armPct: 8, resPct: 8, armFixe: 0, resFixe: 0,
    vitesse: 11, fatigue: 10, toucher: 1, regenPct: 0,
    livraison: "physique", portee: 15
  },
  {
    key: "mage", label: "Mage", icon: "✨",
    hint: "frappe fort à distance, s'effondre au contact",
    tkill: 1.5, share: 0.35, count: 2, fight: 0.4,
    force: 0.5, int: 1.6, dex: 0.8, acu: 1.4, end: 0.6,
    armPct: 5, resPct: 25, armFixe: 0, resFixe: 1,
    vitesse: 7, fatigue: 10, toucher: 1, regenPct: 0,
    livraison: "magique", portee: 12
  },
  {
    key: "elite", label: "Élite", icon: "🛡️",
    hint: "mini-boss : un seul exemplaire fait déjà un vrai combat",
    tkill: 7, share: 0.19, special: 2, count: 1, fight: 1,
    force: 1.4, int: 1.2, dex: 1.2, acu: 1.2, end: 1.4,
    armPct: 25, resPct: 22, armFixe: 2, resFixe: 1,
    vitesse: 9, fatigue: 16, toucher: 1, regenPct: 2,
    livraison: "physique", portee: 2
  },
  {
    key: "boss", label: "Boss", icon: "👑",
    hint: "combat de fin d'arc : vérifie que le groupe peut le blesser",
    tkill: 12, share: 0.14, special: 2, count: 1, fight: 2.5,
    force: 1.8, int: 1.6, dex: 1.3, acu: 1.3, end: 2.0,
    armPct: 32, resPct: 30, armFixe: 3, resFixe: 2,
    vitesse: 9, fatigue: 22, toucher: 2, regenPct: 4,
    livraison: "physique", portee: 2
  }
];

export function getArchetype(key) {
  return ARCHETYPES.find(a => a.key === String(key)) ?? ARCHETYPES[1];
}

/**
 * Armure fixe au niveau demandé.
 *
 * Elle monte d'un point tous les trois niveaux, et TRÈS lentement à dessein :
 * un point d'armure fixe est retiré de CHAQUE coup reçu avant le pourcentage
 * (`mitigateDamage`), ce qui en fait le champ le plus violent du système —
 * la pesée le paie dix fois le point de score d'armure. Un monstre à 0 reste
 * un monstre normal ; un monstre à 6 devient invulnérable aux petites armes.
 */
function fixeAt(base, level) {
  const b = Math.max(0, Number(base) || 0);
  return b ? b + Math.floor((Math.max(1, level) - 1) / 3) : 0;
}

/** Fourchette autour d'une valeur centrale (±12 % par défaut, jamais négative). */
function spread(center, pct = 0.12, { allowNegative = false } = {}) {
  const c = Number(center) || 0;
  let lo = Math.floor(c * (1 - pct));
  let hi = Math.ceil(c * (1 + pct));
  if (!allowNegative) { lo = Math.max(0, lo); hi = Math.max(0, hi); }
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo && c > 0) hi = lo + 1;
  return [lo, hi];
}

/**
 * Traduit une moyenne de dégâts voulue en « XdY + plat ».
 *
 * Des d6 : c'est le dé du système (dégâts d'arme, `template.json`), et une
 * poignée de d6 donne une courbe plus lisible à la table qu'un gros dé unique
 * — un monstre qui fait « 2d6+3 » ne fait jamais 1, ce qui compte quand sa
 * menace est calibrée sur une moyenne.
 */
function diceForAverage(avg) {
  const target = Math.max(1, Number(avg) || 1);
  let dice = Math.max(1, Math.min(20, Math.round(target / 4.5)));
  let flat = Math.round(target - 3.5 * dice);
  while (flat < 0 && dice > 1) { dice -= 1; flat = Math.round(target - 3.5 * dice); }
  return { dice: `${dice}d6`, flat: Math.max(0, flat), average: 3.5 * dice + Math.max(0, flat) };
}

/**
 * Profil chiffré d'un archétype à un niveau donné.
 *
 * C'est la fonction qui fait tout le travail ; `buildBand` et
 * `recommendedAbilities` ne font que mettre en forme ce qu'elle rend.
 */
export function archetypeProfile(level, key, opts = {}) {
  const a = getArchetype(key);
  const lvl = Math.max(1, n(level, 1));
  const P = opts.party ?? partyRefFor(lvl);
  const ref = P.dexterite;                       // 5 + 2 × (niveau − 1)

  // ── 1. Principales ───────────────────────────────────────────────────
  const stats = {
    force:        Math.max(1, r0(ref * a.force)),
    intelligence: Math.max(1, r0(ref * a.int)),
    dexterite:    Math.max(1, r0(ref * a.dex)),
    acuite:       Math.max(1, r0(ref * a.acu)),
    endurance:    Math.max(1, r0(ref * a.end))
  };
  const scoreFromEnd = Math.floor(stats.endurance / 3);
  const pvFromEnd    = Math.floor(stats.endurance / 5);

  // ── 2. Défenses ──────────────────────────────────────────────────────
  const armFixe = fixeAt(a.armFixe, lvl);
  const resFixe = fixeAt(a.resFixe, lvl);
  const scoreArmureTotal     = scoreForPct(a.armPct);
  const scoreResistanceTotal = scoreForPct(a.resPct);
  const defenses = {
    armureFixe:      armFixe,
    resistanceFixe:  resFixe,
    // Écrites diminuées de l'apport d'Endurance, que le moteur rajoutera.
    scoreArmure:     Math.max(0, scoreArmureTotal - scoreFromEnd),
    scoreResistance: Math.max(0, scoreResistanceTotal - scoreFromEnd)
  };

  // ── 3. Survie : combien de PV pour tenir `tkill` tours ────────────────
  // Le groupe frappe physiquement (Dex contre Dex) : son seuil dépend de la
  // Dextérité du monstre, pas d'un 50 % supposé.
  const tnParty   = tnFromRatio((100 + ref) / (100 + stats.dexterite));
  const hitParty  = hitChanceFor(tnParty);
  const landedPj  = mitigateDamage(P.damagePerHit, armFixe, a.armPct);
  const partyDps  = P.size * hitParty * landedPj;
  // Les PV sont VOLONTAIREMENT rendus monotones. Le calcul brut ne l'est pas :
  // l'armure fixe d'une brute gagne un point tous les trois niveaux, ce qui
  // diminue les dégâts encaissés par coup et donc les PV nécessaires pour
  // tenir le même nombre de tours. Mathématiquement juste, illisible à la
  // table — un monstre de niveau 5 affichant moins de PV que son homologue de
  // niveau 3 se lit comme un bug. On garde donc le maximum des niveaux
  // inférieurs : la créature encaisse un peu plus longtemps que sa cible
  // `tkill`, jamais moins.
  let pvTotal     = Math.max(6, r0(partyDps * a.tkill));
  if (!opts.noMonotone) {
    for (let l = 1; l < lvl; l++) {
      const prev = archetypeProfile(l, a.key, { noMonotone: true });
      if (prev.pvTotal > pvTotal) pvTotal = prev.pvTotal;
    }
  }
  const pv        = Math.max(1, pvTotal - pvFromEnd);

  // ── 4. Menace : quels dégâts sa capacité doit porter ──────────────────
  const isPhys    = a.livraison === "physique";
  const atkStat   = isPhys ? stats.dexterite : stats.acuite;
  const tnMonster = Math.min(16, Math.max(6, tnFromRatio((100 + atkStat) / (100 + ref)) - a.toucher));
  const hitM      = hitChanceFor(tnMonster);

  // La RÉGÉNÉRATION du groupe s'ajoute à la menace visée, elle ne s'en
  // retranche pas : un PJ récupère `P.regenPv` PV à chaque tour (init.js, et
  // l'équipement fait monter ce chiffre), donc une créature qui inflige juste
  // cette valeur ne blesse personne — le combat dure indéfiniment sans que
  // rien ne bouge. C'était le trou le plus coûteux du premier calibrage : à
  // bas niveau la régen annulait jusqu'à un tiers de la menace d'un monstre.
  // ...et elle se PARTAGE entre les créatures de la rencontre : la régen est
  // un seul flux sur le PJ visé, pas un flux par assaillant. La compter
  // entière sur chacun des six membres d'une bande de piétaille sextuplait la
  // compensation — vérifié, ça transformait la rencontre la plus anodine du
  // bestiaire en anéantissement du groupe dès que le MJ annonçait une régen de
  // 4. D'où `count`, le nombre d'exemplaires auquel l'archétype est censé se
  // jouer, qui est aussi ce que le guide recommande de poser sur la table.
  const regenPj    = Math.max(0, n(P.regenPv, 1)) / Math.max(1, a.count);
  const landedGoal = a.share * P.pv + regenPj;             // par tour, sur UN PJ

  // Une créature ne place qu'UNE capacité normale par tour : le budget
  // d'action (action-budget.js) donne 2 places mais `sortNormal` est plafonné
  // à 1. Une seconde capacité ne s'ajoute donc pas à la première, elle la
  // REMPLACE le tour où elle sort. Avec une recharge 2, elle sort un tour sur
  // trois : la capacité de base porte 60 % de la menace visée, la spéciale en
  // porte 200 %, et la moyenne (⅔ × 0,6 + ⅓ × 2) retombe sur ~1. Le partage
  // est volontairement déséquilibré vers la spéciale : un gros coup qui tombe
  // un tour sur trois se joue (on le voit venir, on se protège, on écourte le
  // combat), là où la même menace étalée à l'identique tous les tours n'est
  // qu'une soustraction.
  // Le premier calibrage divisait naïvement la menace par « deux attaques par
  // tour » qui n'existaient pas : les élites et les boss délivraient la moitié
  // de ce qui était annoncé.
  const baseFactor = a.special ? 0.6 : 1;
  const perHitLanded = (landedGoal * baseFactor) / Math.max(0.05, hitM);
  const rawNeeded  = perHitLanded / Math.max(0.3, 1 - P.reductionPct / 100);
  const scaleStat  = isPhys ? stats.force : stats.intelligence;
  const statBonus  = Math.floor(scaleStat / 10);           // per 10 / perStep 1
  const dmg        = diceForAverage(rawNeeded - statBonus);
  const specialDmg = a.special
    ? diceForAverage((landedGoal * 2) / Math.max(0.05, hitM)
        / Math.max(0.3, 1 - P.reductionPct / 100) - statBonus)
    : null;

  // ── 5. Reste ─────────────────────────────────────────────────────────
  const regenPv = Math.max(0, Math.round((pvTotal * a.regenPct) / 100));
  // 100 XP par niveau, partagés entre les PJ (combat-end.js) : viser quatre
  // combats par niveau donne 25 XP par PJ et par combat, donc 25 × effectif
  // pour la rencontre entière, réparti au prorata de ce que pèse la créature.
  const xp = Math.max(1, r0(25 * P.size * a.fight));

  return {
    level: lvl, archetype: a, party: P, ref,
    stats, defenses, pv, pvTotal, pvFromEnd, scoreFromEnd,
    vitesse: a.vitesse, fatigueMax: a.fatigue,
    toucherPhysique: isPhys ? a.toucher : 0,
    toucherMagique:  isPhys ? 0 : a.toucher,
    regenPv, xp,
    // Lecture directe pour l'écran d'aide
    survie: {
      tnParty, hitParty, landedPj, partyDps,
      tours: Math.round((pvTotal / Math.max(0.1, partyDps)) * 10) / 10,
      armPct: a.armPct, resPct: a.resPct
    },
    menace: {
      tnMonster, hitM, livraison: a.livraison,
      parTour: Math.round(landedGoal * 10) / 10,
      pctPvPj: Math.round(a.share * 100),
      dice: dmg.dice, flat: dmg.flat, moyenne: Math.round((dmg.average + statBonus) * 10) / 10,
      statBonus, scaleStat: isPhys ? "force" : "intelligence",
      regenPj,
      special: specialDmg
        ? { dice: specialDmg.dice, flat: specialDmg.flat, cooldown: a.special,
            moyenne: Math.round((specialDmg.average + statBonus) * 10) / 10 }
        : null
    }
  };
}

/**
 * Bande de génération complète pour un niveau — la forme exacte attendue par
 * `system.gen.bands.<niveau>` (monster-gen.js / ensureBand de la fiche).
 *
 * Les résistances élémentaires restent à [0, 0] : elles relèvent du THÈME de
 * la créature (un élémentaire de feu, une ombre), pas de son calibrage, et
 * `rollResistances` n'écrit rien sur une plage nulle — ce qui préserve une
 * valeur déjà saisie à la main sur la fiche.
 */
export function buildBand(level, key, opts = {}) {
  const p = archetypeProfile(level, key, opts);
  const band = {
    stats: {
      force:        spread(p.stats.force),
      intelligence: spread(p.stats.intelligence),
      dexterite:    spread(p.stats.dexterite),
      acuite:       spread(p.stats.acuite),
      endurance:    spread(p.stats.endurance)
    },
    defenses: {
      armureFixe:      [p.defenses.armureFixe, p.defenses.armureFixe],
      resistanceFixe:  [p.defenses.resistanceFixe, p.defenses.resistanceFixe],
      scoreArmure:     spread(p.defenses.scoreArmure),
      scoreResistance: spread(p.defenses.scoreResistance)
    },
    pv:              spread(p.pv, 0.15),
    regenPv:         [p.regenPv, p.regenPv],
    vitesse:         [p.vitesse, p.vitesse],
    xpReward:        spread(p.xp, 0.2),
    fatigueMax:      spread(p.fatigueMax, 0.1),
    toucherPhysique: [p.toucherPhysique, p.toucherPhysique],
    toucherMagique:  [p.toucherMagique, p.toucherMagique],
    resistancesElem: {}
  };
  for (const t of DAMAGE_TYPE_KEYS) band.resistancesElem[t] = [0, 0];
  return band;
}

/**
 * Capacités recommandées.
 *
 * Un monstre n'a pas d'arme dans ce système : ses attaques SONT ses items de
 * type `spell` (voir ACTION_EXCLUDED_TYPES dans default-actions.js). Une
 * bande de génération parfaitement calibrée ne produit donc qu'un sac de PV
 * tant que personne n'a écrit la capacité — c'est très exactement l'effet
 * « il manque des stats aux monstres » : les stats étaient là, la menace
 * n'existait pas.
 *
 * Les archétypes à deux places d'action reçoivent une seconde capacité en
 * recharge 2, aux dés doublés : disponible un tour sur deux, elle rend en
 * moyenne ce que rendrait une attaque ordinaire, sans aplatir le combat.
 */
export function recommendedAbilities(level, key, opts = {}) {
  const p = archetypeProfile(level, key, opts);
  const a = p.archetype;
  const isPhys = a.livraison === "physique";
  const base = {
    label: isPhys ? "Attaque" : "Trait arcanique",
    dice: p.menace.dice, flat: p.menace.flat,
    livraison: a.livraison, stat: p.menace.scaleStat, per: 10, perStep: 1,
    portee: a.portee, cibles: 1, cooldown: 0, speed: "normal",
    fatigueCost: 1, coutMana: 0, difficulte: 0,
    note: `≈ ${p.menace.moyenne} de dégâts bruts, ${p.menace.pctPvPj} % des PV d'un PJ par tour`
  };
  const out = [base];
  const sp = p.menace.special;
  if (sp) {
    out.push({
      ...base,
      label: a.key === "boss" ? "Déchaînement" : "Coup puissant",
      dice: sp.dice, flat: sp.flat,
      cibles: a.key === "boss" ? 2 : 1,
      cooldown: sp.cooldown,
      fatigueCost: 2,
      note: `recharge ${sp.cooldown} : sort un tour sur ${sp.cooldown + 1} À LA PLACE de l'attaque de base, ≈ ${sp.moyenne} bruts`
    });
  }
  return out;
}

/** Données de création d'un item `spell` à partir d'une capacité recommandée. */
export function abilityItemData(spec, { img = "icons/svg/sword.svg" } = {}) {
  return {
    name: spec.label,
    type: "spell",
    img,
    system: {
      speed: spec.speed ?? "normal",
      livraison: spec.livraison,
      difficulte: spec.difficulte ?? 0,
      coutMana: spec.coutMana ?? 0,
      fatigueCost: spec.fatigueCost ?? 1,
      range: { min: 0, max: spec.portee ?? 1.5 },
      targetCount: { min: 1, max: spec.cibles ?? 1 },
      cooldown: { max: spec.cooldown ?? 0, restant: 0 },
      tag: "neutre",
      damages: [{
        dice: spec.dice, flat: spec.flat,
        stat: spec.stat, per: spec.per ?? 10, perStep: spec.perStep ?? 1,
        critDice: "", critFlat: 0, siphon: 0,
        livraison: spec.livraison
      }],
      description: spec.note ?? ""
    }
  };
}
