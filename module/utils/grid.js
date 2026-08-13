// module/utils/grid.js
//
// Helpers de grille — et surtout LA référence unique pour « est-ce à portée ? ».
//
// Tout le système raisonne en MÈTRES (déplacement, terrain, anneaux de portée
// dessinés sur le canevas). Les vérifications de portée, elles, comptaient
// des CASES en distance de Manhattan : sur une grille à 1 m/case les deux
// coïncidaient par accident pour des valeurs entières, ce qui a masqué le
// problème longtemps — mais un sort de portée 0,5 m devenait inutilisable
// (le voisin immédiat est à « 1 case », donc 1 > 0,5), une diagonale comptait
// double, et rien de tout ça ne correspondait au cercle affiché sur la carte.

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

export function manhattanDistanceTokens(a, b) {
  const A = gridPosFromToken(a);
  const B = gridPosFromToken(b);
  return Math.abs(A.gx - B.gx) + Math.abs(A.gy - B.gy);
}

/**
 * Nombre de cases séparant deux tokens, une diagonale comptant pour 1
 * (Chebyshev). Sert uniquement à reconnaître « collé » : deux tokens dont
 * les cases se touchent, en ligne droite comme en diagonale.
 */
export function cellsApart(a, b) {
  const A = gridPosFromToken(a);
  const B = gridPosFromToken(b);
  return Math.max(Math.abs(A.gx - B.gx), Math.abs(A.gy - B.gy));
}

/**
 * Excédent de demi-largeur d'un token AU-DELÀ d'une case normale, en mètres.
 *
 * Une allonge/portée se mesure depuis le CORPS d'une créature, pas depuis un
 * point en son centre : sans cet ajout, le cercle d'un monstre de grande
 * taille (2×2 cases ou plus) tombe en grande partie SOUS son propre socle, et
 * un joueur ne peut pas dire à l'œil quand son token entre dans la zone de
 * menace.
 *
 * Ne renvoie que l'EXCÉDENT (demi-largeur − demi-case) plutôt que la
 * demi-largeur brute : pour un token 1×1 (le cas normal), le centre de deux
 * tokens adjacents est déjà exactement à une case l'un de l'autre — l'allonge
 * de la fiche (ex. 1,5 m) mesurée depuis le CENTRE atteint donc déjà le bord
 * d'une case adjacente, sans rien à ajouter. Ajouter la demi-largeur COMPLÈTE
 * (0,5 m sur une grille à 1 m/case) à un token normal gonflait le cercle à 2 m
 * pour une allonge affichée de 1,5 m — l'anneau ne correspondait plus à son
 * étiquette. Seule la taille AU-DELÀ d'une case normale doit compenser
 * (0 pour 1×1, une demi-case pour 2×2, etc.).
 *
 * Partagé entre le dessin (range-overlay.js) et la vérification (checkRange) :
 * les deux doivent partir de la même empreinte, sinon l'anneau affiché ment.
 */
export function tokenFootprintMeters(token) {
  if (!token) return 0;
  const gs = gridSizePx();
  const gd = gridDistanceMeters();
  const halfPx = Math.max(token.w ?? gs, token.h ?? gs) / 2;
  return Math.max(0, (halfPx / gs) * gd - gd / 2);
}

/** Distance en mètres entre deux points en pixels ({x, y}, ex: token.center). */
export function pointDistanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const px = Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
  return (px / gridSizePx()) * gridDistanceMeters();
}

/**
 * Distance de portée entre deux tokens, en mètres.
 *
 * Euclidienne — le même cercle que celui dessiné par range-overlay.js et
 * spell-range.js. Le débordement des grands tokens est retiré des deux côtés,
 * pour que l'anneau affiché et la portée réellement autorisée coïncident.
 */
export function rangeDistanceMeters(a, b) {
  const meters = pointDistanceMeters(a?.center, b?.center);
  if (!Number.isFinite(meters)) return Infinity;
  return Math.max(0, meters - tokenFootprintMeters(a) - tokenFootprintMeters(b));
}

/**
 * La cible est-elle à portée ? Tout est en mètres.
 *
 * Règle de contact : un sort ou une arme dont la portée max est positive
 * atteint toujours un token dont la case touche la sienne, diagonale
 * comprise. Sans elle, une portée saisie sous la barre du mètre (« Croc,
 * 0–0,5 m ») ne pourrait jamais toucher personne, puisque le voisin le plus
 * proche est à 1 m de centre à centre. La portée MIN reste vérifiée telle
 * quelle : un arc qui ne tire pas à bout portant continue de refuser le
 * corps à corps.
 */
export function checkRange(caster, target, min = 0, max = 0) {
  const rmin = Math.max(0, Number(min) || 0);
  const rmax = Math.max(0, Number(max) || 0);
  const dist = rangeDistanceMeters(caster, target);

  const contact = rmax > 0 && cellsApart(caster, target) <= 1;
  const tooClose = dist + EPS < rmin;
  const tooFar   = !contact && dist > rmax + EPS;

  return { ok: !tooClose && !tooFar, dist, min: rmin, max: rmax, tooClose, tooFar, contact };
}

/**
 * Rayon, en mètres, qui représente la règle de contact à l'écran.
 *
 * La règle est une adjacence de CASES (cellsApart ≤ 1), pas un cercle — mais
 * pour un token 1×1 sur une grille carrée les deux coïncident exactement : le
 * voisin orthogonal est à 1 case de centre à centre, le voisin diagonal à √2,
 * et la case suivante à 2. Un cercle de rayon √2 × distance-par-case contient
 * donc précisément les huit voisins, et rien d'autre.
 *
 * Sert à DESSINER une allonge de contact : tracer un cercle de 0,5 m autour
 * d'un token 1×1 le fait tomber pile sur son propre socle — illisible, et
 * surtout mensonger, puisque la règle de contact lui fait bel et bien
 * atteindre les huit cases voisines.
 */
export function contactRadiusMeters() {
  return gridDistanceMeters() * Math.SQRT2;
}

/** Formate une distance en mètres pour un message : « 1 m », « 1,4 m ». */
export function fmtMeters(m) {
  const v = Number(m);
  if (!Number.isFinite(v)) return "?";
  return (v % 1 === 0 ? String(v) : v.toFixed(1).replace(".", ",")) + " m";
}
