// systems/rpg/monster-gen.js

function randInt(min, max) {
  min = Math.floor(Number(min));
  max = Math.floor(Number(max));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max < min) [min, max] = [max, min];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseLevels(csv) {
  return String(csv ?? "")
    .trim()
    .split(/[,\s;.]+/g)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0);
}

function getRange(obj, fallbackMin = 0, fallbackMax = 0) {
  const a = Number(obj?.[0] ?? fallbackMin);
  const b = Number(obj?.[1] ?? fallbackMax);
  return [Number.isFinite(a) ? a : fallbackMin, Number.isFinite(b) ? b : fallbackMax];
}

function pickLevel(actor) {
  const levels = parseLevels(actor.system?.gen?.levelsCsv);
  if (!levels.length) return null;
  return levels[randInt(0, levels.length - 1)];
}

function getBand(actor, lvl) {
  const key = String(lvl);
  return actor.system?.gen?.bands?.[key] ?? null;
}

// ✅ clamp utilitaires
function clampMin0(n) {
  n = Math.floor(Number(n) || 0);
  return Math.max(0, n);
}
function rollClamped(rangeArr, fallbackMin = 0, fallbackMax = 0) {
  const [mn, mx] = getRange(rangeArr, fallbackMin, fallbackMax);
  return clampMin0(randInt(mn, mx));
}

export async function randomizeMonster(actor) {
  if (!actor || actor.type !== "monster") return;

  const lvl = pickLevel(actor);
  if (!lvl) {
    console.warn("[RPG] Monster gen: aucun niveau configuré (system.gen.levelsCsv).");
    return;
  }

  const band = getBand(actor, lvl);
  if (!band) {
    console.warn(`[RPG] Monster gen: aucun band trouvé pour le niveau ${lvl}.`);
    return;
  }

  const s = band.stats ?? {};
  const d = band.defenses ?? {};

  // =========================
  // 1) TIRAGE DES BASES (clamp >= 0)
  // =========================
  const baseForce = rollClamped(s.force, 0, 0);
  const baseInt   = rollClamped(s.intelligence, 0, 0);
  const baseDex   = rollClamped(s.dexterite, 0, 0);
  const baseAcu   = rollClamped(s.acuite, 0, 0);
  const baseEnd   = rollClamped(s.endurance, 0, 0);

  const baseArmFix = rollClamped(d.armureFixe, 0, 0);
  const baseResFix = rollClamped(d.resistanceFixe, 0, 0);
  const baseScArm  = rollClamped(d.scoreArmure, 0, 0);
  const baseScRes  = rollClamped(d.scoreResistance, 0, 0);

  const pvBase = Math.max(1, rollClamped(band.pv, 30, 30));
  const regenPvBase = rollClamped(band.regenPv, 0, 0);
  const vitBase = rollClamped(band.vitesse, 3, 3);
  const xpReward = Math.max(0, rollClamped(band.xpReward, 0, 0));

  // =========================
  // 2) PV “actuels” au spawn = PV MAX FINAL (base + scaling END)
  //    ⚠️ doit matcher actor.js (PV_PER_END_STEP=5, PV_PER_END_GAIN=1)
  // =========================
  const PV_PER_END_STEP = 5;
  const pvFromEnd = Math.floor(Math.max(0, baseEnd) / PV_PER_END_STEP) * 1;
  const pvMaxFinal = Math.max(1, pvBase + pvFromEnd);

  // =========================
  // 3) UPDATE : on écrit les BASES
  // =========================
  const updates = {
    "system.niveau": lvl,

    // stats de base (éditables MJ si besoin)
    "system.principales.force": baseForce,
    "system.principales.intelligence": baseInt,
    "system.principales.dexterite": baseDex,
    "system.principales.acuite": baseAcu,
    "system.principales.endurance": baseEnd,

    // défenses de base (les dérivés END seront ajoutés en prepareDerivedData)
    "system.defenses.armureFixe": baseArmFix,
    "system.defenses.resistanceFixe": baseResFix,
    "system.defenses.scoreArmure": baseScArm,
    "system.defenses.scoreResistance": baseScRes,

    // vit / regen PV de base
    "system.deplacement.vitesse": vitBase,
    "system.regeneration.pv": regenPvBase,

    // base immuable (sert de référence comme pour PJ)
    "system.base.pvMax": pvBase,
    "system.base.regenPv": regenPvBase,
    "system.base.vitesse": vitBase,

    // PV du token : full life (sur le max final)
    "system.ressources.pv.max": pvMaxFinal,
    "system.ressources.pv.valeur": pvMaxFinal,

    "system.recompenses.xp": xpReward,

    // marqueur optionnel
    "system.gen.generated": true
  };

  await actor.update(updates);
}
