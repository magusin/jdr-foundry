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

export async function randomizeMonster(actor) {
  if (!actor || actor.type !== "monster") return;

  const lvl = pickLevel(actor);
  if (!lvl) {
    // pas de config => on ne casse pas le token
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

  const [pvMin, pvMax] = getRange(band.pv, 30, 30);
  const pvMaxRoll = randInt(pvMin, pvMax);
  const [regenMin, regenMax] = getRange(band.regenPv, 0, 0);
  const valRegenPv = randInt(regenMin, regenMax);
  const [vitMin, vitMax] = getRange(band.vitesse, 3, 3);
  const [xpMin, xpMax] = getRange(band.xpReward, 0, 0);

  const updates = {
    "system.niveau": lvl,

    "system.principales.force": randInt(...getRange(s.force, 0, 0)),
    "system.principales.intelligence": randInt(...getRange(s.intelligence, 0, 0)),
    "system.principales.dexterite": randInt(...getRange(s.dexterite, 0, 0)),
    "system.principales.acuite": randInt(...getRange(s.acuite, 0, 0)),
    "system.principales.endurance": randInt(...getRange(s.endurance, 0, 0)),
    "system.defenses.armureFixe": randInt(...getRange(d.armureFixe, 0, 0)),
    "system.defenses.resistanceFixe": randInt(...getRange(d.resistanceFixe, 0, 0)),
    "system.defenses.scoreArmure": randInt(...getRange(d.scoreArmure, 0, 0)),
    "system.defenses.scoreResistance": randInt(...getRange(d.scoreResistance, 0, 0)),

    "system.deplacement.vitesse": randInt(vitMin, vitMax),

    "system.ressources.pv.max": pvMaxRoll,
    "system.ressources.pv.valeur": pvMaxRoll,
    "system.regeneration.pv": valRegenPv,
    "system.recompenses.xp": randInt(xpMin, xpMax),

    // marqueur optionnel
    "system.gen.generated": true
  };

  await actor.update(updates);
}
