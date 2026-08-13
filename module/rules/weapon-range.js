// module/rules/weapon-range.js
//
// Portée d'attaque : UNE seule définition, partagée par le menu de combat,
// l'action de base « Attaquer » et les cercles dessinés sur le canevas.
//
// Deux champs décrivent la portée d'une arme, et ils ne veulent pas dire la
// même chose :
//   - system.allonge   : allonge de MÊLÉE (défaut 1 m). C'est elle qui définit
//                        la zone de menace, les attaques d'opportunité
//                        (movement-tracker.js) et l'anneau ⚔ affiché autour du
//                        combattant actif (range-overlay.js).
//   - system.range.max : portée de JET/TIR ("laisse la même valeur que
//                        l'allonge pour une arme de mêlée pure", dit la fiche
//                        d'arme elle-même).
//
// Le menu de combat ne regardait QUE `range.max`. Une épée dont ce champ était
// resté à 0,5 m — voire à 0, ce qu'aucune fiche n'interdit — devenait
// inutilisable : « Hors portée (1.0m, portée max 0.5m) » sur une cible pourtant
// collée au personnage, alors que l'anneau de menace dessiné sur la carte,
// lui, se base sur l'allonge et affichait bien la cible comme atteignable. La
// portée d'attaque effective est donc le MAXIMUM des deux : une arme de mêlée
// mal renseignée retombe sur son allonge, un arc garde sa portée de tir.

const MIN_TOUCH = 0;

const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Excédent de demi-largeur d'un token AU-DELÀ d'une case normale, en mètres.
 *
 * Une allonge se mesure depuis le CORPS d'une créature, pas depuis un point en
 * son centre. Pour un token 1×1 (le cas normal) deux centres adjacents sont
 * déjà exactement à une case l'un de l'autre : rien à ajouter, d'où le
 * `max(0, …)`. Seule la taille au-delà d'une case doit compenser (0 pour 1×1,
 * une demi-case pour 2×2…). Même fonction que celle utilisée pour dessiner les
 * anneaux — c'est tout l'intérêt de la partager : le cercle affiché et le
 * bouton « Attaquer » ne peuvent plus se contredire.
 */
export function tokenFootprintMeters(token) {
  if (!token) return 0;
  const gs = canvas?.scene?.grid?.size ?? 100;
  const gd = canvas?.scene?.grid?.distance ?? 1;
  const halfPx = Math.max(token.w ?? gs, token.h ?? gs) / 2;
  const halfMeters = halfPx / (gs || 1) * gd;
  return Math.max(0, halfMeters - gd / 2);
}

/** Distance en MÈTRES entre deux points en pixels du canevas. */
export function metersBetweenPoints(a, b) {
  if (!a || !b) return null;
  const gs = canvas?.scene?.grid?.size ?? 100;
  const gd = canvas?.scene?.grid?.distance ?? 1;
  return Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0)) / (gs || 1) * gd;
}

/**
 * Distance bord à bord entre deux tokens, en mètres.
 *
 * Euclidienne, comme les anneaux du canevas (et NON la distance de déplacement
 * à diagonales pondérées : atteindre une cible n'est pas s'y rendre à pied).
 * L'ancien calcul du menu appelait `game.rpg.measureDistance`, qui est une
 * distance de MANHATTAN exprimée en CASES — son résultat était comparé tel
 * quel à une portée en mètres, ce qui ne coïncide que sur une grille à 1 m par
 * case et jamais en diagonale (une case en diagonale y compte 2).
 */
export function tokenDistanceMeters(fromToken, toToken) {
  const raw = metersBetweenPoints(fromToken?.center, toToken?.center);
  if (raw === null) return null;
  return Math.max(0, raw - tokenFootprintMeters(fromToken) - tokenFootprintMeters(toToken));
}

/**
 * Portée effective d'une arme, en mètres.
 * @returns {{min:number, max:number, allonge:number, jet:number}}
 */
export function weaponRangeMeters(weapon) {
  const sys = weapon?.system ?? {};
  const allonge = Math.max(0, num(sys.allonge, 0));
  const jet     = Math.max(0, num(sys.range?.max ?? sys.portee, 0));
  return {
    min: Math.max(0, num(sys.range?.min, 0)),
    max: Math.max(allonge, jet, MIN_TOUCH),
    allonge,
    jet
  };
}

/**
 * L'arme peut-elle atteindre cette cible depuis ce token ?
 *
 * @returns {{ok:boolean, dist:number|null, min:number, max:number,
 *            tooClose:boolean, reason:string|null}}
 *          `dist === null` (pas de token, pas de canevas) vaut « on ne sait
 *          pas » et laisse passer : mieux vaut une attaque à valider par le MJ
 *          qu'un bouton bloqué sans explication.
 */
export function checkWeaponRange(fromToken, toToken, weapon) {
  const { min, max, allonge, jet } = weaponRangeMeters(weapon);
  const dist = (fromToken && toToken) ? tokenDistanceMeters(fromToken, toToken) : null;

  if (dist === null) return { ok: true, dist: null, min, max, tooClose: false, reason: null };

  const tooClose = dist < min;
  const tooFar   = dist > max;
  const fmt = (m) => (Math.round(m * 10) / 10).toString().replace(".", ",");

  // Quand les deux champs de la fiche divergent, on nomme celui qui a servi :
  // c'est la seule façon pour le MJ de savoir lequel corriger.
  const source = (max === allonge && allonge !== jet) ? ` (allonge)` : (max === jet && allonge !== jet ? ` (jet)` : "");

  return {
    ok: !tooClose && !tooFar,
    dist, min, max, tooClose,
    reason: tooClose ? `Trop près (${fmt(dist)} m, portée mini ${fmt(min)} m)`
          : tooFar   ? `Hors portée (${fmt(dist)} m, portée max ${fmt(max)} m${source})`
          : null
  };
}

/** Même test, à partir des acteurs : prend leur token actif sur la scène. */
export function checkWeaponRangeForActors(attacker, target, weapon) {
  const from = attacker?.getActiveTokens?.()?.[0] ?? null;
  const to   = target?.getActiveTokens?.()?.[0] ?? null;
  if (!from || !to) return { ok: true, dist: null, min: 0, max: 0, tooClose: false, reason: null };
  return checkWeaponRange(from, to, weapon);
}
