// module/utils/grid.js
//
// Helpers de grille — et surtout LA référence unique pour « est-ce à portée ? ».
//
// Tout est en MÈTRES RÉELS, mesurés BORD À BORD. Les tokens se déplacent
// librement (pas de case en case) : la grille n'est qu'un repère visuel, elle
// ne doit jamais servir d'unité de mesure. Une portée saisie « 1,5 m » vaut
// exactement 1,5 mètre entre le corps du lanceur et celui de sa cible.
//
// Historique des deux modèles écartés, parce qu'ils expliquent la forme
// actuelle :
//   1. Comptage de CASES en distance de Manhattan. Sur une grille à 1 m/case
//      les nombres coïncidaient par accident pour des valeurs entières, ce qui
//      a masqué le problème longtemps — mais une portée de 0,5 m devenait
//      inapplicable, une diagonale comptait double, et rien de tout ça ne
//      correspondait au cercle affiché sur la carte.
//   2. Distance de CENTRE à CENTRE, plus une « règle de contact » ad hoc pour
//      qu'une allonge courte atteigne quand même un voisin immédiat. Deux
//      tokens 1×1 collés ayant leurs centres à 1 m, toute la plage sous 1,41 m
//      devenait indistinguable : 0,5 m et 1 m donnaient exactement la même
//      portée, et le champ « allonge » perdait tout son bas de gamme.

const EPS = 1e-6;

/** Taille d'une case, en pixels. */
export function gridSizePx() {
  return Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
}

/** Distance représentée par une case, en mètres. */
export function gridDistanceMeters() {
  return Number(canvas?.scene?.grid?.distance ?? canvas?.grid?.distance ?? 1) || 1;
}

export function gridPosFromToken(token) {
  if (!token?.center || !canvas?.grid) return { gx: 0, gy: 0 };

  const { x, y } = token.center;

  // v12+ : canvas.grid.getOffset({x,y}) => {i,j}
  if (typeof canvas.grid.getOffset === "function") {
    const o = canvas.grid.getOffset({ x, y });
    // Foundry renvoie souvent {i, j}
    const gx = Number(o?.i ?? o?.x ?? 0);
    const gy = Number(o?.j ?? o?.y ?? 0);
    return { gx, gy };
  }

  // fallback ancien (devrait être rare)
  const size = gridSizePx();
  return { gx: Math.floor(x / size), gy: Math.floor(y / size) };
}

/**
 * Demi-largeur d'un token, en mètres — la distance de son centre à son bord.
 *
 * C'est ce qui permet de mesurer bord à bord : une allonge part du CORPS d'une
 * créature, pas d'un point mathématique en son centre. L'écart réel entre deux
 * combattants est leur distance de centre à centre moins leurs deux
 * demi-largeurs. Deux tokens 1×1 collés ont donc leurs corps à 0 m d'écart,
 * et la moindre allonge les atteint — sans avoir besoin d'aucune exception.
 */
export function tokenHalfExtentMeters(token) {
  if (!token) return 0;
  const gs = gridSizePx();
  const halfPx = Math.max(token.w ?? gs, token.h ?? gs) / 2;
  return (halfPx / gs) * gridDistanceMeters();
}

/** Distance en mètres entre deux points en pixels ({x, y}, ex: token.center). */
export function pointDistanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const px = Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
  return (px / gridSizePx()) * gridDistanceMeters();
}

/**
 * Écart entre deux tokens, en mètres, de BORD À BORD.
 *
 * Euclidien, sans aucune notion de case : c'est la distance qui sépare
 * réellement les deux corps. Vaut 0 quand ils se touchent, et croît
 * continûment ensuite — un token qu'on décale d'un demi-pas voit sa distance
 * bouger d'autant, ce qu'un comptage de cases ne pouvait pas rendre.
 */
export function rangeDistanceMeters(a, b) {
  const meters = pointDistanceMeters(a?.center, b?.center);
  if (!Number.isFinite(meters)) return Infinity;
  return Math.max(0, meters - tokenHalfExtentMeters(a) - tokenHalfExtentMeters(b));
}

/**
 * La cible est-elle à portée ? Tout est en mètres, bord à bord.
 *
 * Aucune exception, aucun plancher : `max` est la distance maximale entre les
 * deux corps, `min` la distance minimale (un arc qui ne tire pas à bout
 * portant). Une allonge de 0,5 m atteint donc ce qui est à moins de 50 cm,
 * une allonge de 1 m ce qui est à moins d'un mètre, et les deux se
 * distinguent — contrairement au modèle centre-à-centre qu'elles remplacent.
 */
export function checkRange(caster, target, min = 0, max = 0) {
  const rmin = Math.max(0, Number(min) || 0);
  const rmax = Math.max(0, Number(max) || 0);
  const dist = rangeDistanceMeters(caster, target);

  // Portée nulle = aucune allonge : le sort ou l'action ne vise que son
  // lanceur. À ne surtout pas laisser au test ci-dessous : deux tokens
  // collés sont à 0 m d'écart en bord à bord, donc « 0 ≤ 0 » passerait et
  // une action sans portée deviendrait lançable sur le voisin.
  if (rmax <= 0) {
    return { ok: false, dist, min: rmin, max: rmax, tooClose: false, tooFar: true };
  }

  const tooClose = dist + EPS < rmin;
  const tooFar   = dist > rmax + EPS;

  return { ok: !tooClose && !tooFar, dist, min: rmin, max: rmax, tooClose, tooFar };
}

/**
 * Objet minimal accepté partout où l'on attend un Token (checkRange,
 * rangeDistanceMeters), pour tester une position HYPOTHÉTIQUE.
 *
 * Sert au désengagement : décider s'il y a attaque d'opportunité demande de
 * savoir si le personnage était à portée AVANT son déplacement et ne l'est
 * plus APRÈS — deux positions dont une seule, au mieux, correspond à celle
 * qu'occupe réellement le token à l'instant du test.
 *
 * @param {{x:number,y:number}} center - centre en pixels
 * @param {number} widthCells  - largeur du token, en cases
 * @param {number} heightCells - hauteur du token, en cases
 */
export function virtualToken(center, widthCells = 1, heightCells = 1) {
  const gs = gridSizePx();
  return {
    center: { x: Number(center?.x) || 0, y: Number(center?.y) || 0 },
    w: (Number(widthCells) || 1) * gs,
    h: (Number(heightCells) || 1) * gs
  };
}

/** Formate une distance en mètres pour un message : « 1 m », « 1,4 m ». */
export function fmtMeters(m) {
  const v = Number(m);
  if (!Number.isFinite(v)) return "?";
  return (v % 1 === 0 ? String(v) : v.toFixed(1).replace(".", ",")) + " m";
}
