// module/rules/state-builder.js
//
// Construction d'un état personnalisé de A à Z par le MJ — durée, dégâts,
// bonus/malus de stat (fixe ou %), aura ou pas. Complète les catalogues
// fixes (effect-library, wound-library, tactical-library) qui ne
// couvrent que des cas prédéfinis.

export const STATE_TYPES = {
  "":         "Aucun (pas de résistance/affinité)",
  magique:    "Magique",
  physique:   "Physique",
  feu:        "Feu",
  air:        "Air",
  eau:        "Eau",
  glace:      "Glace",
  eclair:     "Éclair",
  terre:      "Terre"
};

export const STAT_KEYS = {
  force: "Force", intelligence: "Intelligence", dexterite: "Dextérité",
  acuite: "Acuité", endurance: "Endurance",
  armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
  scoreArmure: "Score Armure", scoreResistance: "Score Résistance",
  pvMax: "PV max", manaMax: "Mana max",
  regenPv: "Régén PV", regenMana: "Régén Mana",
  vitesse: "Vitesse", initiativeMod: "Initiative",
  toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique",
  fatigueMax: "Fatigue max", podsMax: "Pods max"
};

/**
 * Construit un objet "state" prêt à être appliqué, à partir des choix du MJ.
 * @param {object} opts
 * @param {string} opts.label - nom de l'état (ex: "Brûlure")
 * @param {string} opts.tag - type/élément (clé de STATE_TYPES, peut être "")
 * @param {number} opts.duration - durée en tours (ignoré si permanent)
 * @param {boolean} opts.permanent - ne s'estompe jamais seul
 * @param {number} opts.dotPerTick - dégâts/tour (négatif = soin), 0 = aucun
 * @param {number} opts.fatiguePerTick - fatigue/tour (négatif = repos), 0 = aucun
 * @param {Array<{stat:string, flat:number, pct:number}>} opts.mods - bonus/malus
 * @param {boolean} opts.isAura - si vrai, devient une source d'aura
 * @param {number} opts.auraMin - portée min (cases), si aura
 * @param {number} opts.auraMax - portée max (cases), si aura
 */
export function buildCustomState({
  label, tag = "", duration = 1, permanent = false,
  dotPerTick = 0, fatiguePerTick = 0, mods = [], isAura = false,
  auraMin = 0, auraMax = 0
} = {}) {
  const modsObj = {};
  for (const m of mods) {
    if (!m?.stat) continue;
    const flat = Number(m.flat) || 0;
    const pct = Number(m.pct) || 0;
    if (!flat && !pct) continue;
    modsObj[m.stat] = { flat, pct };
  }

  const dur = permanent ? 0 : Math.max(1, Number(duration) || 1);

  const state = {
    id: `custom_${foundry.utils.randomID(10)}`,
    label: String(label ?? "État personnalisé").trim() || "État personnalisé",
    type: "custom",
    tag: tag || null,
    isAura: !!isAura,
    permanent: !!permanent,
    duration: dur,
    remaining: dur,
    dot: { flat: Number(dotPerTick) || 0, perTick: Number(dotPerTick) || 0 },
    mods: modsObj
  };

  if (isAura) {
    state.aura = {
      min: Math.max(0, Number(auraMin) || 0),
      max: Math.max(0, Number(auraMax) || 0),
      key: state.label
    };
  }

  // Le DOT de fatigue n'est pas dans le schéma "dot" standard (qui ne gère
  // que les PV) — on l'ajoute à part, déjà supporté par turn-effects.js
  if (fatiguePerTick) state.dot.fatiguePerTick = Number(fatiguePerTick) || 0;

  return state;
}
