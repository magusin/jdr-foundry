// module/rules/spell-move.js
//
// Déplacement du LANCEUR provoqué par un sort (charge, bond, ruée...).
//
// Pourquoi un module à part plutôt qu'un champ de plus dans movement-tracker :
// ce déplacement-ci n'est pas une action de déplacement. Il fait partie de la
// résolution du sort, au même titre que ses dégâts — il ne consomme ni la
// réserve de mètres du tour, ni le slot « Déplacement » du budget d'action
// (rules/action-budget.js). C'est tout l'intérêt du champ : sans lui, une
// charge coûtait le sort ET le déplacement, soit le tour entier (2 slots).
//
// Le contournement est `{ rpgNoTrack: true }` sur la mise à jour du token —
// la seule chose du système qui fasse sauter entièrement le suivi de
// mouvement (movement-tracker.js, hooks preUpdateToken/updateToken). Le
// système s'en servait déjà pour ses propres corrections et annulations.
//
// ⚠️ Conséquence assumée, et c'est la raison d'être de ce commentaire : parce
// que le suivi est court-circuité, ce déplacement ne déclenche NI attaque
// d'opportunité, NI piège / zone à effet traversé. Une charge est un
// mouvement de l'action, pas un déplacement tactique que l'adversaire peut
// punir. Si un jour on veut l'inverse, c'est ici qu'il faut appeler
// triggerZoneEffectsForToken (zone-effects.js) — pas retirer rpgNoTrack, qui
// remettrait du même coup le décompte du budget que ce champ existe pour
// éviter.

import {
  gridSizePx, gridDistanceMeters, tokenHalfSizeMeters
} from "../utils/grid.js";

const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Distance à parcourir, en mètres et le long de la ligne des centres, pour
 * arriver EXACTEMENT au contact de la cible.
 *
 * Ce n'est PAS l'écart bord à bord (rangeDistanceMeters), et c'était le
 * premier réflexe — faux en diagonale. L'écart entre deux carrés se mesure
 * axe par axe puis se combine, il ne décroît donc pas linéairement le long
 * d'une trajectoire oblique : plafonner la charge sur cet écart laissait le
 * lanceur à une dizaine de centimètres du contact dès que l'approche n'était
 * pas alignée sur un axe (mesuré : 3,61 m parcourus au lieu de 3,75 sur une
 * approche 3/4). Toujours conservateur — jamais de chevauchement — mais une
 * charge censée finir « au contact » qui s'arrête juste avant, c'est le genre
 * d'écart qui fait rater l'attaque de mêlée qui suit.
 *
 * On résout donc directement : en approchant, les deux écarts d'axes se
 * réduisent proportionnellement à la distance des centres restante. Le
 * contact est atteint quand les DEUX tiennent dans la somme des emprises,
 * c'est-à-dire quand il ne reste que la fraction min(SW/ax, SH/ay) de la
 * distance de départ. Un axe nul (approche parfaitement horizontale ou
 * verticale) ne contraint rien : sa fraction vaut l'infini et l'autre décide.
 */
function contactTravelMeters(from, to, dxPx, dyPx) {
  const A = tokenHalfSizeMeters(from);
  const B = tokenHalfSizeMeters(to);
  const sumW = A.hw + B.hw;
  const sumH = A.hh + B.hh;

  const perPx = gridDistanceMeters() / gridSizePx();
  const ax = Math.abs(num(dxPx)) * perPx;
  const ay = Math.abs(num(dyPx)) * perPx;
  const D  = Math.hypot(ax, ay);
  if (!Number.isFinite(D) || D <= 0) return 0;

  const ratioX = ax > 1e-9 ? sumW / ax : Infinity;
  const ratioY = ay > 1e-9 ? sumH / ay : Infinity;

  // Fraction de la distance des centres à CONSERVER. Bornée à 1 : au-delà,
  // les tokens se chevauchent déjà et il n'y a rien à parcourir.
  const keep = Math.min(1, ratioX, ratioY);
  return Math.max(0, D * (1 - keep));
}

/**
 * Avance le lanceur vers sa cible, en ligne droite, d'au plus `meters`.
 *
 * S'arrête AU CONTACT et jamais au-delà : la distance parcourue est bornée
 * par l'écart bord à bord réel entre les deux tokens (rangeDistanceMeters,
 * la mesure de tout le système). Sans ce plafond, une charge de 12 m sur une
 * cible à 4 m ferait traverser la cible au lanceur et le déposerait derrière
 * elle — visuellement absurde, et une allonge de mêlée ne porterait plus.
 *
 * Aucune magnétisation à la grille : les tokens se déplacent librement dans
 * ce système (voir l'en-tête de utils/grid.js), et le clamp de drag
 * (drag-limit.js) ne magnétise pas non plus.
 *
 * @param {Token}  casterToken
 * @param {Token}  targetToken
 * @param {number} meters  distance demandée, en mètres
 * @returns {Promise<{moved:boolean, meters:number, reason:string|null}>}
 */
export async function advanceCasterTowardTarget(casterToken, targetToken, meters) {
  const want = Math.max(0, num(meters, 0));
  const no = (reason) => ({ moved: false, meters: 0, reason });

  if (want <= 0) return no(null);                       // champ à 0 : rien à faire, ce n'est pas une anomalie
  if (!casterToken || !targetToken) return no("token du lanceur ou de la cible introuvable");
  if (casterToken.id && casterToken.id === targetToken.id) return no("le lanceur est sa propre cible");

  const from = casterToken.center;
  const to   = targetToken.center;
  if (!from || !to) return no("position introuvable");

  const dx = num(to.x) - num(from.x);
  const dy = num(to.y) - num(from.y);
  const distPx = Math.hypot(dx, dy);
  if (distPx < 1) return no("déjà au contact");

  // Ce qu'il reste réellement à franchir avant de toucher la cible.
  const contact = contactTravelMeters(casterToken, targetToken, dx, dy);
  if (!Number.isFinite(contact) || contact <= 0.01) return no("déjà au contact");

  const travel = Math.min(want, contact);
  if (travel <= 0.01) return no("déjà au contact");

  const gs = gridSizePx();
  const px = (travel / gridDistanceMeters()) * gs;

  const centerX = num(from.x) + (dx / distPx) * px;
  const centerY = num(from.y) + (dy / distPx) * px;

  // doc.x / doc.y sont le COIN haut-gauche ; token.w / token.h les dimensions
  // en pixels (un token 2×2 ne fait pas la taille d'une case).
  const w = num(casterToken.w, gs);
  const h = num(casterToken.h, gs);

  await casterToken.document.update(
    { x: centerX - w / 2, y: centerY - h / 2 },
    { rpgNoTrack: true, animate: true }
  );

  return { moved: true, meters: travel, reason: null };
}
