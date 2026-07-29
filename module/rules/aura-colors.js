// module/rules/aura-colors.js
//
// Couleur associée à chaque type/élément d'état (tag), utilisée pour le
// rendu visuel des auras sur le canevas (aura-render.js) et pour la macro
// aura. Même catalogue de tags que effect-library.js / state-builder.js.
// Quand plusieurs auras de types différents se superposent sur un même
// token, le rendu additionne les couleurs (mode additif) : chaque élément
// reste identifiable par sa teinte plutôt que de masquer les autres.

export const AURA_COLOR_BY_TAG = {
  feu:      0xff5a2e,
  air:      0x8fd6ff,
  eau:      0x2f8fe0,
  glace:    0x8fe9ff,
  eclair:   0xffe14d,
  terre:    0x8a6b3d,
  magique:  0xb76bff,
  physique: 0xd1524a,
  lumiere:  0xfff2a8,
  tenebres: 0x6b3fa0
};

export const DEFAULT_AURA_COLOR = 0x45d4ff;

/** Couleur PIXI (nombre 0xRRGGBB) pour un tag d'état donné. */
export function auraColorForTag(tag) {
  return AURA_COLOR_BY_TAG[String(tag ?? "").trim()] ?? DEFAULT_AURA_COLOR;
}

/** Même couleur, en chaîne hexa "#rrggbb" (pour un `<input type="color">`). */
export function auraColorHex(tag) {
  return `#${auraColorForTag(tag).toString(16).padStart(6, "0")}`;
}

export function hexToColorNumber(hex) {
  const s = String(hex ?? "").replace("#", "").trim();
  const v = parseInt(s, 16);
  return Number.isFinite(v) ? v : null;
}
