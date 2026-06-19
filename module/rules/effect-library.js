// module/rules/effect-library.js
//
// Catalogue d'effets nommés réutilisables (brûlure, poison, etc).
// Chaque effet a un "tag" de catégorie utilisé par le système de résistance
// (équipement ou buff) pour réduire sa durée et/ou ses dégâts par tour.
//
// Structure d'un effet du catalogue :
// {
//   key, label, icon, tag,
//   defaultDuration: nombre de tours,
//   dot: { perTick } | null,
//   mods: { "<bucket>.<key>": { flat, pct } }   (mêmes buckets que KEY_TO_BUCKET)
// }

export const EFFECT_TAGS = {
  feu:       "Feu",
  poison:    "Poison",
  glace:     "Glace",
  electrique:"Électrique",
  physique:  "Physique",
  mental:    "Mental",
  sacre:     "Sacré",
  tenebres:  "Ténèbres"
};

export const EFFECT_LIBRARY = {
  brulure: {
    key: "brulure", label: "Brûlure", icon: "icons/svg/fire.svg", tag: "feu",
    defaultDuration: 3,
    dot: { perTick: 3 },
    mods: {}
  },
  poison: {
    key: "poison", label: "Poison", icon: "icons/svg/poison.svg", tag: "poison",
    defaultDuration: 4,
    dot: { perTick: 2 },
    mods: { "principales.force": { flat: 0, pct: -10 } }
  },
  gel: {
    key: "gel", label: "Gel", icon: "icons/svg/ice-aura.svg", tag: "glace",
    defaultDuration: 2,
    dot: { perTick: 0 },
    mods: { "move.vitesse": { flat: -1, pct: 0 } }
  },
  choc: {
    key: "choc", label: "Choc électrique", icon: "icons/svg/lightning.svg", tag: "electrique",
    defaultDuration: 1,
    dot: { perTick: 1 },
    mods: { "initiative.mod": { flat: 0, pct: -25 } }
  },
  etourdissement: {
    key: "etourdissement", label: "Étourdissement", icon: "icons/svg/daze.svg", tag: "physique",
    defaultDuration: 1,
    dot: null,
    mods: { "principales.dexterite": { flat: 0, pct: -30 } }
  },
  aveuglement: {
    key: "aveuglement", label: "Aveuglement", icon: "icons/svg/blind.svg", tag: "physique",
    defaultDuration: 2,
    dot: null,
    mods: { "principales.acuite": { flat: 0, pct: -40 } }
  },
  affaiblissement: {
    key: "affaiblissement", label: "Affaiblissement", icon: "icons/svg/downgrade.svg", tag: "mental",
    defaultDuration: 3,
    dot: null,
    mods: { "principales.force": { flat: 0, pct: -20 } }
  },
  peur: {
    key: "peur", label: "Peur", icon: "icons/svg/terror.svg", tag: "mental",
    defaultDuration: 2,
    dot: null,
    mods: { "principales.dexterite": { flat: 0, pct: -15 }, "initiative.mod": { flat: 0, pct: -15 } }
  },
  corruption: {
    key: "corruption", label: "Corruption", icon: "icons/svg/wing.svg", tag: "tenebres",
    defaultDuration: 4,
    dot: { perTick: 1 },
    mods: { "ressources.pvMax": { flat: 0, pct: -10 } }
  },
  benediction: {
    key: "benediction", label: "Bénédiction", icon: "icons/svg/angel.svg", tag: "sacre",
    defaultDuration: 3,
    dot: null,
    mods: { "defenses.armureFixe": { flat: 2, pct: 0 }, "defenses.resistanceFixe": { flat: 2, pct: 0 } }
  },
  regeneration: {
    key: "regeneration", label: "Régénération", icon: "icons/svg/regen.svg", tag: "sacre",
    defaultDuration: 3,
    dot: { perTick: -3 }, // négatif = soin par tour
    mods: {}
  },
  rage: {
    key: "rage", label: "Rage", icon: "icons/svg/explosion.svg", tag: "physique",
    defaultDuration: 3,
    dot: null,
    mods: { "principales.force": { flat: 0, pct: 25 }, "defenses.scoreArmure": { flat: 0, pct: -15 } }
  },
  bouclier_magique: {
    key: "bouclier_magique", label: "Bouclier magique", icon: "icons/svg/shield.svg", tag: "sacre",
    defaultDuration: 3,
    dot: null,
    mods: { "defenses.resistanceFixe": { flat: 4, pct: 0 } }
  }
};

export function getEffectDef(key) {
  return EFFECT_LIBRARY[key] ?? null;
}

export function listEffects() {
  return Object.values(EFFECT_LIBRARY);
}

/**
 * Convertit une entrée du catalogue (+ durée éventuellement custom) en
 * objet "state" prêt à être passé à upsertState (status-effects.js).
 */
export function buildStateFromLibrary(key, { duration = null, sourceLabel = "" } = {}) {
  const def = getEffectDef(key);
  if (!def) return null;

  const dur = Math.max(1, Number(duration ?? def.defaultDuration) || def.defaultDuration);

  return {
    id: `lib_${key}_${foundry.utils.randomID(6)}`,
    label: def.label,
    type: "libraryEffect",
    tag: def.tag,
    isAura: false,
    duration: dur,
    remaining: dur,
    dot: def.dot ? { flat: def.dot.perTick, perTick: def.dot.perTick } : { flat: 0, perTick: 0 },
    mods: foundry.utils.deepClone(def.mods ?? {}),
    sourceLabel
  };
}
