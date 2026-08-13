// module/utils/grid.js
//
// Helpers de grille — et surtout LA référence unique pour « est-ce à portée ? ».
//
// Tout est en MÈTRES RÉELS, mesurés BORD À BORD — d'un carré de token à
// l'autre. Les tokens se déplacent librement (pas de case en case) : la grille
// n'est qu'un repère visuel, elle ne doit jamais servir d'unité de mesure. Une
// portée saisie « 1,5 m » vaut exactement 1,5 mètre entre le carré du lanceur
// et celui de sa cible.
//
// La taille d'un token ne CHANGE donc jamais une portée : elle déplace son
// point de départ. C'est ce qui rend la mesure symétrique — le même écart, que
// l'on parte du gros ou du petit — et ce qui garde le jet de touché
// indépendant de la taille des socles.
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
//   3. Distance des centres MOINS les deux demi-largeurs. Bonne intention
//      (partir du bord), mauvaise géométrie : un carré n'est à sa demi-largeur
//      du centre que sur ses axes, et une fois et demie plus loin dans ses
//      coins. Deux voisins en diagonale, carrés collés par le coin, restaient
//      comptés à 0,41 m — et le cercle tracé sur la carte, lui, débordait le
//      carré de la portée entière sur les axes mais à peine dans les coins.

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
 * Demi-dimensions d'un token, en mètres — de son centre à ses bords.
 *
 * C'est l'EMPRISE du token, le carré que Foundry dessine autour de lui : c'est
 * elle qui sert de bord, et une portée part de ce bord. Largeur et hauteur sont
 * rendues séparément parce qu'un token n'est pas forcément carré (serpent,
 * chariot) et que les confondre déplacerait le bord du mauvais côté.
 *
 * @returns {{hw:number, hh:number}} demi-largeur / demi-hauteur, en mètres
 */
export function tokenHalfSizeMeters(token) {
  if (!token) return { hw: 0, hh: 0 };
  const gs = gridSizePx();
  const perPx = gridDistanceMeters() / gs;
  return {
    hw: ((Number(token.w) || gs) / 2) * perPx,
    hh: ((Number(token.h) || gs) / 2) * perPx
  };
}

/**
 * Demi-largeur d'un token, en mètres (la plus grande des deux dimensions).
 * Conservée pour l'affichage et la compatibilité ; la MESURE de portée, elle,
 * passe par tokenHalfSizeMeters (voir rangeDistanceMeters).
 */
export function tokenHalfExtentMeters(token) {
  const { hw, hh } = tokenHalfSizeMeters(token);
  return Math.max(hw, hh);
}

/** Distance en mètres entre deux points en pixels ({x, y}, ex: token.center). */
export function pointDistanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const px = Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
  return (px / gridSizePx()) * gridDistanceMeters();
}

/**
 * Écart entre deux tokens, en mètres : la distance entre leurs deux CARRÉS.
 *
 * C'est la règle du système, énoncée simplement : la taille du token définit
 * la limite, et l'allonge part de cette limite. Deux carrés qui se touchent
 * sont à 0 m l'un de l'autre (y compris par un coin), et l'écart croît ensuite
 * continûment — un token décalé d'un demi-pas voit sa distance bouger d'autant.
 *
 * La taille n'ajoute donc RIEN à la portée : elle ne fait que déplacer le point
 * de départ, identiquement dans les deux sens (A vers B et B vers A donnent le
 * même écart, quelles que soient les deux tailles).
 *
 * ⚠️ Ce n'est PAS « distance des centres moins les deux demi-largeurs », qui
 * était la formule précédente. Celle-ci retire la même demi-largeur dans toutes
 * les directions alors qu'un carré n'est à sa demi-largeur du centre que sur
 * ses axes : dans un coin, il s'étend une fois et demie plus loin. Deux tokens
 * 1×1 en diagonale, dont les carrés se touchent par le coin — collés, à l'œil
 * comme sur la grille — étaient ainsi comptés à 0,41 m l'un de l'autre, hors
 * d'atteinte de toute allonge inférieure. L'écart entre deux rectangles se
 * mesure axe par axe, puis se combine :
 */
export function rangeDistanceMeters(a, b) {
  const ca = a?.center, cb = b?.center;
  if (!ca || !cb) return Infinity;

  const A = tokenHalfSizeMeters(a);
  const B = tokenHalfSizeMeters(b);
  const perPx = gridDistanceMeters() / gridSizePx();

  const dx = Math.abs(Number(cb.x) - Number(ca.x)) * perPx;
  const dy = Math.abs(Number(cb.y) - Number(ca.y)) * perPx;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Infinity;

  // Écart restant sur chaque axe une fois les deux emprises retirées : 0 quand
  // les carrés se chevauchent sur cet axe (ils sont alors « en face »).
  const gx = Math.max(0, dx - A.hw - B.hw);
  const gy = Math.max(0, dy - A.hh - B.hh);

  return Math.hypot(gx, gy);
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
