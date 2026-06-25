// module/rules/wound-library.js
//
// Blessures localisées : contrairement aux effets élémentaires (durée
// limitée), une blessure est PERMANENTE jusqu'à un soin explicite du MJ
// (macro "JDR — Soigner / Repos"). Pas de tag élémentaire — une blessure
// n'est pas résistée par l'équipement, seule une guérison la retire.

export const WOUND_LIBRARY = {
  bras_blesse: {
    key: "bras_blesse", label: "Bras blessé", icon: "icons/svg/blood.svg",
    mods: { "principales.force": { flat: 0, pct: -30 } }
  },
  jambe_blessee: {
    key: "jambe_blessee", label: "Jambe blessée", icon: "icons/svg/blood.svg",
    mods: { "move.vitesse": { flat: -2, pct: 0 } }
  },
  torse_blesse: {
    key: "torse_blesse", label: "Torse blessé", icon: "icons/svg/wound.svg",
    mods: { "ressources.pvMax": { flat: 0, pct: -15 } }
  },
  tete_blessee: {
    key: "tete_blessee", label: "Tête blessée", icon: "icons/svg/wound.svg",
    mods: {
      "principales.force": { flat: 0, pct: -20 },
      "principales.intelligence": { flat: 0, pct: -20 },
      "principales.dexterite": { flat: 0, pct: -20 },
      "principales.acuite": { flat: 0, pct: -20 },
      "principales.endurance": { flat: 0, pct: -20 }
    }
  },
  saignement: {
    key: "saignement", label: "Saignement", icon: "icons/svg/blood.svg",
    dot: { perTick: 2 },
    mods: {}
  }
};

export function getWoundDef(key) {
  return WOUND_LIBRARY[key] ?? null;
}

export function listWounds() {
  return Object.values(WOUND_LIBRARY);
}

/**
 * Construit un état "blessure" permanent prêt à être ajouté à etatsActifs.
 * Pas de tag (non résistable par l'équipement), pas de durée qui s'épuise.
 */
export function buildWoundState(key, { sourceLabel = "" } = {}) {
  const def = getWoundDef(key);
  if (!def) return null;

  return {
    id: `wound_${key}_${foundry.utils.randomID(6)}`,
    label: def.label,
    type: "wound",
    tag: null,
    isAura: false,
    permanent: true,
    duration: 0,
    remaining: 0,
    dot: def.dot ? { flat: def.dot.perTick, perTick: def.dot.perTick } : { flat: 0, perTick: 0 },
    mods: foundry.utils.deepClone(def.mods ?? {}),
    sourceLabel
  };
}
