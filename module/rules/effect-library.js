// module/rules/effect-library.js
//
// Catalogue des noms d'effets connus du système — UNIQUEMENT des noms et
// des types. Le MJ renseigne lui-même durée, dégâts, bonus/malus, aura
// etc. au moment d'appliquer l'effet. Aucune valeur n'est pré-configurée.

export const EFFECT_TAGS = {
  feu:     "🔥 Feu",
  air:     "🌬️ Air",
  eau:     "💧 Eau",
  glace:   "❄️ Glace",
  eclair:  "⚡ Éclair",
  terre:   "🌿 Terre",
  magique: "✨ Magique",
  physique:"⚔️ Physique"
};

export const EFFECT_LIBRARY = {
  // ── FEU ──────────────────────────────────────────────────────────────
  brulure:        { key: "brulure",        label: "Brûlure",         tag: "feu"     },
  combustion:     { key: "combustion",     label: "Combustion",      tag: "feu"     },
  ardeur:         { key: "ardeur",         label: "Ardeur",          tag: "feu"     },

  // ── AIR ──────────────────────────────────────────────────────────────
  bourrasque:     { key: "bourrasque",     label: "Bourrasque",      tag: "air"     },
  legerete:       { key: "legerete",       label: "Légèreté",        tag: "air"     },

  // ── EAU ──────────────────────────────────────────────────────────────
  asphyxie:       { key: "asphyxie",       label: "Asphyxie",        tag: "eau"     },
  regeneration:   { key: "regeneration",   label: "Régénération",    tag: "eau"     },
  purification:   { key: "purification",   label: "Purification",    tag: "eau"     },

  // ── GLACE ────────────────────────────────────────────────────────────
  gel:            { key: "gel",            label: "Gel",             tag: "glace"   },
  engourdissement:{ key: "engourdissement",label: "Engourdissement", tag: "glace"   },
  carapace_glace: { key: "carapace_glace", label: "Carapace de Glace",tag: "glace"  },

  // ── ÉCLAIR ───────────────────────────────────────────────────────────
  choc:                { key: "choc",                label: "Choc électrique",    tag: "eclair" },
  reflexes_foudroyants:{ key: "reflexes_foudroyants",label: "Réflexes Foudroyants",tag:"eclair" },

  // ── TERRE ────────────────────────────────────────────────────────────
  enlisement:     { key: "enlisement",     label: "Enlisement",      tag: "terre"   },
  peau_de_roc:    { key: "peau_de_roc",    label: "Peau de Roc",     tag: "terre"   },

  // ── MAGIQUE ──────────────────────────────────────────────────────────
  silence:        { key: "silence",        label: "Silence",         tag: "magique" },
  benediction:    { key: "benediction",    label: "Bénédiction",     tag: "magique" },
  malediction:    { key: "malediction",    label: "Malédiction",     tag: "magique" },

  // ── PHYSIQUE ─────────────────────────────────────────────────────────
  saignement:     { key: "saignement",     label: "Saignement",      tag: "physique"},
  etourdissement: { key: "etourdissement", label: "Étourdissement",  tag: "physique"},
  desarmement:    { key: "desarmement",    label: "Désarmement",     tag: "physique"},
};

export function getEffectDef(key) {
  return EFFECT_LIBRARY[key] ?? null;
}

export function listEffects() {
  return Object.values(EFFECT_LIBRARY);
}

/**
 * Construit un état minimal (sans valeurs) depuis un nom du catalogue.
 * Les valeurs réelles (dégâts, mods, durée…) sont injectées après par
 * le MJ via apply-effect.js ou l'éditeur de sort.
 */
export function buildStateFromLibrary(key, { duration = 1, sourceLabel = "", removeDifficulty = null,
  dot = 0, fatiguePerTick = 0, mods = {}, permanent = false, isAura = false, aura = null } = {}) {
  const def = getEffectDef(key);
  if (!def) return null;

  const dur = permanent ? 0 : Math.max(1, Number(duration) || 1);

  const state = {
    id: `lib_${key}_${foundry.utils.randomID(6)}`,
    label: def.label,
    type: "libraryEffect",
    tag: def.tag,
    isAura: !!isAura,
    permanent: !!permanent,
    duration: dur,
    remaining: dur,
    removeDifficulty: removeDifficulty ?? null,
    dot: { flat: Number(dot) || 0, perTick: Number(dot) || 0 },
    mods: foundry.utils.deepClone(mods ?? {}),
    sourceLabel
  };

  if (fatiguePerTick) state.dot.fatiguePerTick = Number(fatiguePerTick) || 0;
  if (isAura && aura) state.aura = aura;

  return state;
}
