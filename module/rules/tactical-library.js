// module/rules/tactical-library.js
//
// Positions tactiques (couverture, angle mort, flanc) : le MJ juge la
// situation sur la carte (mur, obstacle, encerclement) et applique un
// statut correspondant — pas de détection géométrique automatique
// (cohérent avec le reste du système : le MJ décide, l'outil applique).
//
// Réutilise le bucket toucherPhysique/toucherMagique déjà construit pour
// l'équipement et les sorts — la couverture/le flanc ne sont qu'une
// source de plus qui alimente le même calcul.

export const TACTICAL_LIBRARY = {
  couverture_legere: {
    key: "couverture_legere", label: "Couverture légère", icon: "icons/svg/shield.svg",
    defaultDuration: 99, permanent: true,
    mods: { "toucherPhysique": { flat: -1, pct: 0 }, "toucherMagique": { flat: -1, pct: 0 } }
  },
  couverture_moyenne: {
    key: "couverture_moyenne", label: "Couverture moyenne", icon: "icons/svg/shield.svg",
    defaultDuration: 99, permanent: true,
    mods: { "toucherPhysique": { flat: -2, pct: 0 }, "toucherMagique": { flat: -2, pct: 0 } }
  },
  couverture_totale: {
    key: "couverture_totale", label: "Couverture totale", icon: "icons/svg/shield.svg",
    defaultDuration: 99, permanent: true,
    mods: { "toucherPhysique": { flat: -4, pct: 0 }, "toucherMagique": { flat: -4, pct: 0 } }
  },
  flanc: {
    key: "flanc", label: "Pris en flanc", icon: "icons/svg/sword.svg",
    defaultDuration: 99, permanent: true,
    mods: { "toucherPhysique": { flat: 2, pct: 0 } }
  },
  angle_mort: {
    key: "angle_mort", label: "Dans l'angle mort", icon: "icons/svg/blind.svg",
    defaultDuration: 99, permanent: true,
    mods: { "toucherPhysique": { flat: 3, pct: 0 }, "toucherMagique": { flat: 1, pct: 0 } }
  }
};

export function listTactical() {
  return Object.values(TACTICAL_LIBRARY);
}

export function getTacticalDef(key) {
  return TACTICAL_LIBRARY[key] ?? null;
}

/**
 * Construit un état "position tactique" permanent (jusqu'à retrait MJ) —
 * la note ici est sur l'ATTAQUANT visant la cible (toucherPhysique/Magique
 * positif = la cible est plus facile à toucher, négatif = plus dure).
 */
export function buildTacticalState(key, { sourceLabel = "" } = {}) {
  const def = getTacticalDef(key);
  if (!def) return null;

  return {
    id: `tactical_${key}_${foundry.utils.randomID(6)}`,
    label: def.label,
    type: "tactical",
    tag: null,
    isAura: false,
    permanent: true,
    duration: 0,
    remaining: 0,
    dot: { flat: 0, perTick: 0 },
    mods: foundry.utils.deepClone(def.mods ?? {}),
    sourceLabel
  };
}
