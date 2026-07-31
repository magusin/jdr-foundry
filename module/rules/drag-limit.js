// module/rules/drag-limit.js
//
// Blocage du déplacement PENDANT le glisser-déposer.
//
// Le token suit la souris jusqu'à la limite de sa réserve du tour, puis
// s'arrête net — comme s'il butait sur un mur — même si la souris continue.
// On ne subit donc plus le déplacement puis l'annulation : la contrainte est
// visible et immédiate.
//
// Le coût est celui du système (diagonales pondérées + terrain difficile) :
// on cherche par dichotomie le point le plus éloigné dont le coût tient dans
// la réserve, en réutilisant calculateMovementCost — exactement la fonction
// qui servira à décompter le déplacement.

import { calculateMovementCost } from "./region-behaviors.js";
import { getMovementLimit } from "./movement-tracker.js";
import { updateDragThreatIndicator, clearDragThreatIndicator } from "./range-overlay.js";

// Cache par token : évite de refaire la dichotomie à chaque pixel parcouru.
// tokenId → { key, x, y }
const _cache = new Map();

/** Coût RP réel d'un trajet en ligne droite, terrain compris. */
function costOf(actor, from, to) {
  try {
    const { cost } = calculateMovementCost([from, to], actor);
    return Number(cost) || 0;
  } catch {
    return 0;
  }
}

/**
 * Point le plus éloigné sur le segment origine → destination dont le coût
 * tient dans `budget`. Dichotomie : le coût n'est pas linéaire (le terrain
 * difficile varie le long du trajet), on ne peut pas simplement mettre le
 * vecteur à l'échelle.
 */
function furthestReachable(actor, origin, dest, budget) {
  if (costOf(actor, origin, dest) <= budget) return dest;

  let lo = 0, hi = 1;
  const at = (t) => ({ x: origin.x + t * (dest.x - origin.x),
                       y: origin.y + t * (dest.y - origin.y) });

  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (costOf(actor, origin, at(mid)) <= budget) lo = mid;
    else hi = mid;
  }
  const p = at(lo);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * Contraint la position d'un aperçu de token à la réserve restante.
 * @param {Token} clone  - l'aperçu déplacé par la souris
 * @param {Token} source - le token réel (position de départ, budget)
 */
function clampClone(clone, source) {
  const doc = source?.document;
  if (!doc || !clone) return;

  const limit = getMovementLimit(doc);
  if (!limit.applies || !Number.isFinite(limit.remaining)) return;

  const origin = { x: doc.x, y: doc.y };
  const dest   = { x: clone.document.x, y: clone.document.y };
  if (origin.x === dest.x && origin.y === dest.y) return;

  // Réserve épuisée : le token ne bouge plus du tout
  if (limit.remaining <= 0.05) {
    clone.document.x = origin.x;
    clone.document.y = origin.y;
    return;
  }

  // Dichotomie coûteuse : on ne la relance que si la destination a changé
  const key = `${Math.round(dest.x)}:${Math.round(dest.y)}:${limit.remaining}`;
  const hit = _cache.get(source.id);
  let stop;
  if (hit && hit.key === key) {
    stop = { x: hit.x, y: hit.y };
  } else {
    stop = furthestReachable(limit.actor, origin, dest, limit.remaining);
    _cache.set(source.id, { key, x: stop.x, y: stop.y });
  }

  clone.document.x = stop.x;
  clone.document.y = stop.y;
}

/**
 * Installe la contrainte en enveloppant Token#_onDragLeftMove.
 * Idempotent, et entièrement défensif : si l'API diffère, le glisser-déposer
 * reste celui de Foundry (la vérification à l'enregistrement prend le relais).
 */
export function installDragLimit() {
  if (globalThis.__rpgDragLimit) return;

  const proto = CONFIG?.Token?.objectClass?.prototype
             ?? foundry?.canvas?.placeables?.Token?.prototype
             ?? globalThis.Token?.prototype;
  if (!proto || typeof proto._onDragLeftMove !== "function") {
    console.warn("[RPG] blocage du déplacement au glisser : API introuvable, "
               + "la limite s'appliquera à la validation du déplacement.");
    return;
  }

  globalThis.__rpgDragLimit = true;
  const original = proto._onDragLeftMove;

  proto._onDragLeftMove = function (event) {
    const result = original.call(this, event);
    try {
      const clones = event?.interactionData?.clones ?? [];
      for (const clone of clones) {
        // Le token réel derrière l'aperçu
        const source = clone?._original ?? clone?.document?._original?.object ?? this;
        clampClone(clone, source);
        // Repositionne l'aperçu à l'écran après correction (pas de redraw :
        // on est appelé à chaque mouvement de souris).
        if (clone.position?.set) clone.position.set(clone.document.x, clone.document.y);
        else { clone.x = clone.document.x; clone.y = clone.document.y; }
        // Signale en direct l'entrée dans l'allonge d'un ennemi — sinon rien
        // ne le montre avant le dépôt du token.
        try { updateDragThreatIndicator(clone); } catch (e) { /* indicateur optionnel */ }
      }
    } catch (e) {
      console.warn("[RPG] blocage du déplacement au glisser :", e);
    }
    return result;
  };

  // Efface l'indicateur de danger à la fin du glisser (dépôt ou annulation)
  for (const hookName of ["_onDragLeftDrop", "_onDragLeftCancel"]) {
    if (typeof proto[hookName] !== "function") continue;
    const originalEnd = proto[hookName];
    proto[hookName] = function (event) {
      try { clearDragThreatIndicator(); } catch { /* ignore */ }
      return originalEnd.call(this, event);
    };
  }

  // Purge le cache en fin de glisser
  Hooks.on("canvasTearDown", () => { _cache.clear(); clearDragThreatIndicator(); });
  console.log("[RPG] Blocage du déplacement au glisser : actif.");
}

/** Vide le cache de dichotomie (appelé après chaque déplacement confirmé). */
export function clearDragLimitCache(tokenId = null) {
  if (tokenId) _cache.delete(tokenId);
  else _cache.clear();
}
