// systems/rpg/module/documents/actor.js
import { sumActiveEffectMods } from "../rules/status-effects.js";

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

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

  for (const item of actor.items) {
    const t = item.type;
    const sys = item.system ?? {};

    const isEquip = (t === "weapon" || t === "armor") && !!sys.equipe;
    const isPassiveSpell = (t === "spell") && (sys.mode !== "attaque") && !!sys.actif;
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
    const grants = s?.grants ?? {}; // ex { dexterite:1 } par level

    // On applique grants * level
    if (grants.force) totals.principales.force += lvl * Number(grants.force);
    if (grants.intelligence) totals.principales.intelligence += lvl * Number(grants.intelligence);
    if (grants.dexterite) totals.principales.dexterite += lvl * Number(grants.dexterite);
    if (grants.acuite) totals.principales.acuite += lvl * Number(grants.acuite);
    if (grants.endurance) totals.principales.endurance += lvl * Number(grants.endurance);

    // Optionnel si tu veux aussi booster d’autres champs :
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
    sys.base = sys.base ?? {};

    const isMonster = this.type === "monster";

    // BASE (éditable)
    const baseP = sys.principales ?? {};
    const baseD = sys.defenses ?? {};
    const baseR = sys.ressources ?? {};
    const baseReg = sys.regeneration ?? {};
    const baseMove = sys.deplacement ?? {};
    const baseCharge = sys.charge ?? {};

    // BONUS items / sorts passifs
    const bonusItems = sumBonuses(this);
    const bonusSkills = sumSkillBonuses(this);

    // fusion simple
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
    sys.derived.bonusSkills = bonusSkills; // utile si tu veux afficher le détail


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
      effP[s] = Math.max(0, Math.floor(Number(effP[s]) || 0));
    }

    // -----------------------
    // 2) DEFENSES (avec endurance finale)
    // -----------------------
    const SCORE_PER_END_STEP = 3;
    const SCORE_PER_END_GAIN = 1;
    const scoreFromEnd = Math.floor(Math.max(0, effP.endurance) / SCORE_PER_END_STEP) * SCORE_PER_END_GAIN;

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

    // write effective
    sys.derived.effective.principales = effP;
    sys.derived.effective.defenses = effD;

    // -----------------------
    // 3) Réductions
    // -----------------------
    sys.derived.reductions.physiquePct = scoreToPct(effD.scoreArmure);
    sys.derived.reductions.magiquePct = scoreToPct(effD.scoreResistance);

    // -----------------------
    // 4) Ressources / regen / pods / move
    // -----------------------
    const PODS_BASE = isMonster ? (Number(sys.base.podsMax ?? baseCharge.podsMax ?? 0) || 0) : 50;
    const PODS_PER_FORCE = 0.5;

    const MANA_PER_INT_STEP = 20;
    const REGEN_STEP = 20;
    const PV_PER_END_STEP = 5;
    const PV_PER_END_GAIN = 1;

    const basePvMax = Number(sys.base.pvMax ?? baseR?.pv?.max ?? 30) || 30;
    const baseManaMax = Number(sys.base.manaMax ?? baseR?.mana?.max ?? (isMonster ? 0 : 5)) || 0;

    const baseRegenPv = Number(sys.base.regenPv ?? baseReg?.pv ?? (isMonster ? 0 : 1)) || 0;
    const baseRegenMana = Number(sys.base.regenMana ?? baseReg?.mana ?? (isMonster ? 0 : 1)) || 0;

    // pods (PJ)
    const podsFromForce = isMonster ? 0 : Math.floor(Math.max(0, effP.force) * PODS_PER_FORCE);
    sys.charge = sys.charge ?? {};
    sys.charge.podsMax = PODS_BASE + podsFromForce;

    // pv max
    const pvFromEnd = isMonster ? 0 : (Math.floor(Math.max(0, effP.endurance) / PV_PER_END_STEP) * PV_PER_END_GAIN);
    let pvMax = Math.max(1, basePvMax + pvFromEnd + (Number(bonus.ressources.pvMax ?? 0) || 0));

    // mana max
    const manaFromInt = isMonster ? 0 : Math.floor(Math.max(0, effP.intelligence) / MANA_PER_INT_STEP);
    let manaMax = Math.max(0, baseManaMax + manaFromInt + (Number(bonus.ressources.manaMax ?? 0) || 0));

    // états -> ressources max
    pvMax += Number(flat?.ressources?.pvMax ?? 0) || 0;
    pvMax = applyPct(pvMax, pct?.ressources?.pvMax);
    pvMax = Math.max(1, Math.floor(pvMax));

    manaMax += Number(flat?.ressources?.manaMax ?? 0) || 0;
    manaMax = applyPct(manaMax, pct?.ressources?.manaMax);
    manaMax = Math.max(0, Math.floor(manaMax));

    // regen
    const regenPvBase = isMonster ? 0 : (baseRegenPv + Math.floor(Math.max(0, effP.dexterite) / REGEN_STEP));
    const regenManaBase = isMonster ? 0 : (baseRegenMana + Math.floor(Math.max(0, effP.acuite) / REGEN_STEP));

    let regenPv = Math.floor(regenPvBase * (1 + (Number(bonus.regen.pvPct ?? 0) || 0) / 100));
    let regenMana = Math.floor(regenManaBase * (1 + (Number(bonus.regen.manaPct ?? 0) || 0) / 100));

    // états -> regen (flat puis %)
    regenPv += Number(flat?.regen?.pv ?? 0) || 0;
    regenPv = applyPct(regenPv, pct?.regen?.pv);
    regenPv = Math.max(0, Math.floor(regenPv));

    regenMana += Number(flat?.regen?.mana ?? 0) || 0;
    regenMana = applyPct(regenMana, pct?.regen?.mana);
    regenMana = Math.max(0, Math.floor(regenMana));

    sys.ressources = sys.ressources ?? {};
    sys.ressources.pv = sys.ressources.pv ?? { valeur: pvMax, max: pvMax };
    sys.ressources.mana = sys.ressources.mana ?? { valeur: manaMax, max: manaMax };

    sys.ressources.pv.max = pvMax;
    sys.ressources.pv.valeur = Math.min(Number(sys.ressources.pv.valeur ?? 0) || 0, pvMax);

    if (!isMonster) {
      sys.ressources.mana.max = manaMax;
      sys.ressources.mana.valeur = Math.min(Number(sys.ressources.mana.valeur ?? 0) || 0, manaMax);
    }

    sys.regeneration = sys.regeneration ?? {};
    sys.regeneration.pv = regenPv;
    sys.regeneration.mana = regenMana;

    // move: base + bonus items + effets d'états
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
    // 6) InitiativeMod (dépend d'effP)
    // -----------------------
    sys.derived.initiativeMod = Math.floor(((Number(effP.dexterite) || 0) + (Number(effP.acuite) || 0)) / 2);
    sys.derived.initiativeMod += Number(flat?.initiative?.mod ?? 0) || 0;
    sys.derived.initiativeMod = applyPct(sys.derived.initiativeMod, pct?.initiative?.mod);
    sys.derived.initiativeMod = Math.floor(sys.derived.initiativeMod);
  }
}
