// systems/rpg/module/documents/actor.js
import { sumActiveEffectMods } from "../rules/status-effects.js";

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

function hpState(pct) {
  if (pct >= 100) return "En forme";
  if (pct >= 75) return "Légèrement blessé";
  if (pct >= 50) return "Blessé";
  if (pct >= 25) return "Gravement blessé";
  if (pct > 0) return "À l'agonie";
  return "KO";
}

function sumBonuses(actor) {
  const totals = {
    principales: { force: 0, intelligence: 0, dexterite: 0, acuite: 0, endurance: 0 },
    defenses: { armureFixe: 0, resistanceFixe: 0, scoreArmure: 0, scoreResistance: 0 },
    ressources: { pvMax: 0, manaMax: 0 },
    regen: { pvPct: 0, manaPct: 0 },
    move: { vitesse: 0 }
  };

  const isMonster = actor.type === "monster";

  for (const item of actor.items) {
    const t = item.type;
    const sys = item.system ?? {};

    // ✅ Monstres: pas d'équipement weapon/armor (on ignore)
    const isEquip = !isMonster && (t === "weapon" || t === "armor") && !!sys.equipe;

    // ✅ PJ + Monstres: sorts passifs (buff/aura) actifs => pris en compte
    // Sort passif : speed="passif" OU aura.active (rétrocompat)
    const isPassiveSpell = (t === "spell") && (sys?.speed === "passif" || !!sys?.aura?.active);

    if (!isEquip && !isPassiveSpell) continue;

    const b = sys.bonus ?? {};

    totals.principales.force += Number(b.force ?? 0) || 0;
    totals.principales.intelligence += Number(b.intelligence ?? 0) || 0;
    totals.principales.dexterite += Number(b.dexterite ?? 0) || 0;
    totals.principales.acuite += Number(b.acuite ?? 0) || 0;
    totals.principales.endurance += Number(b.endurance ?? 0) || 0;

    totals.ressources.pvMax += Number(b.pvMax ?? 0) || 0;
    totals.ressources.manaMax += Number(b.manaMax ?? 0) || 0;

    totals.move.vitesse += Number(b.vitesse ?? 0) || 0;

    totals.defenses.armureFixe += Number(b.armureFixe ?? 0) || 0;
    totals.defenses.resistanceFixe += Number(b.resistanceFixe ?? 0) || 0;
    totals.defenses.scoreArmure += Number(b.scoreArmure ?? 0) || 0;
    totals.defenses.scoreResistance += Number(b.scoreResistance ?? 0) || 0;

    totals.regen.pvPct += Number(b.regenPvPct ?? 0) || 0;
    totals.regen.manaPct += Number(b.regenManaPct ?? 0) || 0;
  }

  return totals;
}

function sumSkillBonuses(actor) {
  const skills = actor.system?.skills ?? {};
  const totals = {
    principales: { force: 0, intelligence: 0, dexterite: 0, acuite: 0, endurance: 0 },
    defenses: { armureFixe: 0, resistanceFixe: 0, scoreArmure: 0, scoreResistance: 0 },
    ressources: { pvMax: 0, manaMax: 0 },
    regen: { pvPct: 0, manaPct: 0 },
    move: { vitesse: 0 }
  };

  for (const s of Object.values(skills)) {
    const lvl = Number(s?.level) || 0;
    const grants = s?.grants ?? {};

    if (grants.force) totals.principales.force += lvl * Number(grants.force);
    if (grants.intelligence) totals.principales.intelligence += lvl * Number(grants.intelligence);
    if (grants.dexterite) totals.principales.dexterite += lvl * Number(grants.dexterite);
    if (grants.acuite) totals.principales.acuite += lvl * Number(grants.acuite);
    if (grants.endurance) totals.principales.endurance += lvl * Number(grants.endurance);

    if (grants.vitesse) totals.move.vitesse += lvl * Number(grants.vitesse);
    if (grants.pvMax) totals.ressources.pvMax += lvl * Number(grants.pvMax);
    if (grants.manaMax) totals.ressources.manaMax += lvl * Number(grants.manaMax);
    if (grants.scoreArmure) totals.defenses.scoreArmure += lvl * Number(grants.scoreArmure);
    if (grants.scoreResistance) totals.defenses.scoreResistance += lvl * Number(grants.scoreResistance);
  }

  return totals;
}

export class RPGActor extends Actor {
  getRollData() {
    const data = super.getRollData();
    data.eff = this.system?.derived?.effective ?? {};
    data.effP = this.system?.derived?.effective?.principales ?? {};
    data.effD = this.system?.derived?.effective?.defenses ?? {};
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

    // BONUS items / sorts passifs + skills
    const bonusItems = sumBonuses(this);
    const bonusSkills = sumSkillBonuses(this);

    const bonus = foundry.utils.deepClone(bonusItems);
    bonus.principales.force += bonusSkills.principales.force;
    bonus.principales.intelligence += bonusSkills.principales.intelligence;
    bonus.principales.dexterite += bonusSkills.principales.dexterite;
    bonus.principales.acuite += bonusSkills.principales.acuite;
    bonus.principales.endurance += bonusSkills.principales.endurance;

    bonus.defenses.armureFixe += bonusSkills.defenses.armureFixe;
    bonus.defenses.resistanceFixe += bonusSkills.defenses.resistanceFixe;
    bonus.defenses.scoreArmure += bonusSkills.defenses.scoreArmure;
    bonus.defenses.scoreResistance += bonusSkills.defenses.scoreResistance;

    bonus.ressources.pvMax += bonusSkills.ressources.pvMax;
    bonus.ressources.manaMax += bonusSkills.ressources.manaMax;

    bonus.regen.pvPct += bonusSkills.regen.pvPct;
    bonus.regen.manaPct += bonusSkills.regen.manaPct;

    bonus.move.vitesse += bonusSkills.move.vitesse;

    sys.derived.bonus = bonus;
    sys.derived.bonusSkills = bonusSkills;

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
      force: (Number(baseP.force ?? 0) || 0) + bonus.principales.force,
      intelligence: (Number(baseP.intelligence ?? 0) || 0) + bonus.principales.intelligence,
      dexterite: (Number(baseP.dexterite ?? 0) || 0) + bonus.principales.dexterite,
      acuite: (Number(baseP.acuite ?? 0) || 0) + bonus.principales.acuite,
      endurance: (Number(baseP.endurance ?? 0) || 0) + bonus.principales.endurance
    };

    for (const s of ["force", "intelligence", "dexterite", "acuite", "endurance"]) {
      effP[s] += Number(flat?.principales?.[s] ?? 0) || 0;
      effP[s] = applyPct(effP[s], pct?.principales?.[s]);
      // ✅ clamp à 0 pour respecter ta règle "pas en dessous de 0"
      effP[s] = Math.max(0, Math.floor(Number(effP[s]) || 0));
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

    for (const k of ["armureFixe", "resistanceFixe", "scoreArmure", "scoreResistance"]) {
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

    let regenPv = Math.floor(regenPvBase * (1 + (Number(bonus.regen.pvPct ?? 0) || 0) / 100));
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

      regenMana = Math.floor(regenManaBase * (1 + (Number(bonus.regen.manaPct ?? 0) || 0) / 100));
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


    // move
    sys.deplacement = sys.deplacement ?? {};
    const baseVit = (Number(baseMove.vitesse ?? 0) || 0) + (Number(bonus.move.vitesse ?? 0) || 0);
    let vit = baseVit + (Number(flat?.move?.vitesse ?? 0) || 0);
    vit = applyPct(vit, pct?.move?.vitesse);
    sys.deplacement.vitesse = Math.max(0, Math.floor(vit));

    // -----------------------
    // 5) HP state
    // -----------------------
    const pvCur = Number(sys.ressources?.pv?.valeur ?? 0) || 0;
    const pvMaxForPct = Math.max(1, Number(sys.ressources?.pv?.max ?? 1) || 1);
    const pctHp = clamp(Math.round((pvCur / pvMaxForPct) * 100), 0, 100);
    sys.derived.hp = { pct: pctHp, etat: hpState(pctHp) };

    // -----------------------
    // 6) InitiativeMod
    // -----------------------
    sys.derived.initiativeMod = Math.floor(((Number(effP.dexterite) || 0) + (Number(effP.acuite) || 0)) / 2);
    sys.derived.initiativeMod += Number(flat?.initiative?.mod ?? 0) || 0;
    sys.derived.initiativeMod = applyPct(sys.derived.initiativeMod, pct?.initiative?.mod);
    sys.derived.initiativeMod = Math.floor(sys.derived.initiativeMod);

    // -----------------------
    // 7) Pods (monstre = 0)
    // -----------------------
    sys.charge = sys.charge ?? {};

    if (isMonster) {
      sys.charge.podsMax = 0;
    } else {
      const basePodsMax = Number(
        sys.base.podsMax ??
        sys.podsMax ??          // ✅ template base podsMax: 50
        50
      ) || 50;

      // Scaling : Force => pods
      const PODS_PER_FOR_STEP = 2;     // 2 FOR => +1 pods
      const podsFromFor = Math.floor((Number(effP.force) || 0) / PODS_PER_FOR_STEP);

      let podsMax = basePodsMax + podsFromFor;

      // états éventuels si tu veux (optionnel)
      podsMax += Number(flat?.charge?.podsMax ?? 0) || 0;
      podsMax = applyPct(podsMax, pct?.charge?.podsMax);

      sys.charge.podsMax = Math.max(0, Math.floor(podsMax));
    }

  }
}
