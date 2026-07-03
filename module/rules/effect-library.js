// module/rules/effect-library.js
//
// Catalogue d'effets nommés réutilisables, basé sur la magie élémentaire
// (Feu, Air, Eau, Glace, Éclair, Terre). Chaque élément propose une version
// offensive (DOT/debuff) et une version de soutien (buff) — les éléments
// servent autant à attaquer qu'à se renforcer.
//
// Le "tag" de chaque effet est utilisé par le système de résistance
// (équipement ou buff) pour réduire sa durée et/ou ses dégâts par tour.

export const EFFECT_TAGS = {
  feu:     "Feu",
  air:     "Air",
  eau:     "Eau",
  glace:   "Glace",
  eclair:  "Éclair",
  terre:   "Terre",
  magique: "Magique",
  physique:"Physique"
};

export const EFFECT_LIBRARY = {
  // ── FEU ──────────────────────────────────────────────────────────────
  brulure: {
    key: "brulure", label: "Brûlure", icon: "icons/svg/fire.svg", tag: "feu",
    defaultDuration: 3, removeDifficulty: "moyen",
    dot: { perTick: 3 },
    mods: {}
  },
  combustion: {
    key: "combustion", label: "Combustion", icon: "icons/svg/explosion.svg", tag: "feu",
    defaultDuration: 4, removeDifficulty: "difficile",
    dot: { perTick: 5 },
    // Retire de la résistance au feu (le feu s'embrase de lui-même)
    mods: { "scoreResistance": { flat: -15, pct: 0 } }
  },
  ardeur: {
    key: "ardeur", label: "Ardeur", icon: "icons/svg/explosion.svg", tag: "feu",
    defaultDuration: 3, removeDifficulty: "facile",
    dot: null,
    mods: { "force": { flat: 0, pct: 20 } }
  },

  // ── AIR ──────────────────────────────────────────────────────────────
  bourrasque: {
    key: "bourrasque", label: "Bourrasque", icon: "icons/svg/wing.svg", tag: "air",
    defaultDuration: 2, removeDifficulty: "facile",
    dot: null,
    mods: { "dexterite": { flat: 0, pct: -20 } }
  },
  legerete: {
    key: "legerete", label: "Légèreté", icon: "icons/svg/wind.svg", tag: "air",
    defaultDuration: 3, removeDifficulty: "facile",
    dot: null,
    mods: { "vitesse": { flat: 1, pct: 0 }, "initiativeMod": { flat: 0, pct: 15 } }
  },

  // ── EAU ──────────────────────────────────────────────────────────────
  asphyxie: {
    key: "asphyxie", label: "Asphyxie", icon: "icons/svg/wave.svg", tag: "eau",
    defaultDuration: 3, removeDifficulty: "difficile",
    dot: { perTick: 2 },
    mods: {}
  },
  regeneration: {
    key: "regeneration", label: "Régénération", icon: "icons/svg/regen.svg", tag: "eau",
    defaultDuration: 3, removeDifficulty: null,
    dot: { perTick: -3 },
    mods: {}
  },
  purification: {
    key: "purification", label: "Purification", icon: "icons/svg/holy.svg", tag: "eau",
    defaultDuration: 3, removeDifficulty: null,
    dot: null,
    // Bonus au jet de retrait d'état (simulé via un bonus de toucher magique —
    // le joueur fait le jet avec ce bonus quand il tente de se débarrasser d'un effet)
    mods: { "toucherMagique": { flat: 4, pct: 0 } }
  },

  // ── GLACE ────────────────────────────────────────────────────────────
  gel: {
    key: "gel", label: "Gel", icon: "icons/svg/ice-aura.svg", tag: "glace",
    defaultDuration: 2, removeDifficulty: "moyen",
    dot: { perTick: 0 },
    mods: { "toucherPhysique": { flat: -3, pct: 0 } }
  },
  engourdissement: {
    key: "engourdissement", label: "Engourdissement", icon: "icons/svg/frozen.svg", tag: "glace",
    defaultDuration: 3, removeDifficulty: "moyen",
    dot: null,
    mods: { "vitesse": { flat: -2, pct: 0 } }
  },
  carapace_glace: {
    key: "carapace_glace", label: "Carapace de Glace", icon: "icons/svg/frozen.svg", tag: "glace",
    defaultDuration: 3, removeDifficulty: "facile",
    dot: null,
    mods: { "armureFixe": { flat: 3, pct: 0 } }
  },

  // ── ÉCLAIR ───────────────────────────────────────────────────────────
  choc: {
    key: "choc", label: "Choc électrique", icon: "icons/svg/lightning.svg", tag: "eclair",
    defaultDuration: 1, removeDifficulty: "moyen",
    dot: { perTick: 1 },
    mods: { "initiativeMod": { flat: 0, pct: -25 } }
  },
  reflexes_foudroyants: {
    key: "reflexes_foudroyants", label: "Réflexes Foudroyants", icon: "icons/svg/lightning.svg", tag: "eclair",
    defaultDuration: 3, removeDifficulty: null,
    dot: null,
    mods: { "initiativeMod": { flat: 0, pct: 25 }, "dexterite": { flat: 0, pct: 10 } }
  },

  // ── TERRE ────────────────────────────────────────────────────────────
  enlisement: {
    key: "enlisement", label: "Enlisement", icon: "icons/svg/mountain.svg", tag: "terre",
    defaultDuration: 2, removeDifficulty: "difficile",
    dot: null,
    mods: { "vitesse": { flat: -1, pct: 0 }, "dexterite": { flat: 0, pct: -15 } }
  },
  peau_de_roc: {
    key: "peau_de_roc", label: "Peau de Roc", icon: "icons/svg/stoned.svg", tag: "terre",
    defaultDuration: 3, removeDifficulty: null,
    dot: null,
    mods: { "endurance": { flat: 0, pct: 15 }, "scoreArmure": { flat: 0, pct: 10 } }
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
 * objet "state" prêt à être passé à upsertState / addStateWithResistance.
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
    removeDifficulty: def.removeDifficulty ?? null,
    dot: def.dot ? { flat: def.dot.perTick, perTick: def.dot.perTick } : { flat: 0, perTick: 0 },
    mods: foundry.utils.deepClone(def.mods ?? {}),
    sourceLabel
  };
}
