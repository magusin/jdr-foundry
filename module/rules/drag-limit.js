// module/rules/drag-limit.js
//
// Blocage du déplacement PENDANT le glisser-déposer.
//
// Foundry V13 a remplacé l'ancien système de glisser (un clone qui suit la
// souris, positions écrites dans `event.interactionData.clones`) par la
// « Token Drag Measurement » : le token reste visuellement immobile pendant
// le glisser, seule une réglette (ligne + étiquette de distance) suit le
// curseur, et TOUT — aperçu ET dépôt final — passe par un unique point
// d'appel, `Token#_updateDragDestination(point, options)`, rappelé à chaque
// mouvement de souris. Il n'y a donc plus de clone à repositionner : on
// borne directement le point que Foundry s'apprête à utiliser, avant qu'il
// ne l'utilise. La destination qui sert à afficher la réglette est EXACTEMENT
// celle qui sert à exécuter le déplacement au lâcher (TokenDocument#move) :
// la borner ici suffit à la fois pour l'aperçu ET pour l'arrivée réelle, sans
// dépendre d'une correction après coup une fois l'update Foundry écrite (qui,
// avec le pipeline de mouvement animé de la V13, peut arriver trop tard ou se
// faire écraser par l'animation en cours — voir onUpdateToken dans
// movement-tracker.js).
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

// Centre du token au tout début du glisser — le token ne bouge plus
// visuellement pendant le drag en V13, mais on le mémorise nous-mêmes plutôt
// que de relire `token.center` à chaque appel : plus sûr si un autre module
// (ou une future version) venait à faire bouger l'aperçu.
// tokenId → { x, y }
const _dragOrigin = new Map();

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
 * Borne le point de destination d'un glisser à la réserve restante.
 * @param {Token} self  - le token en train d'être glissé
 * @param {{x:number,y:number}} point - destination brute (centre, non alignée)
 * @returns {{x:number,y:number}} destination corrigée (même repère que `point`)
 */
function clampDestination(self, point) {
  const doc = self?.document;
  if (!doc || !point) return point;

  const limit = getMovementLimit(doc);
  if (!limit.applies || !Number.isFinite(limit.remaining)) return point;

  const origin = _dragOrigin.get(self.id) ?? (() => {
    try { const c = self.center; return { x: c.x, y: c.y }; }
    catch { return { x: doc.x, y: doc.y }; }
  })();

  if (origin.x === point.x && origin.y === point.y) return point;

  // Réserve épuisée : le token ne bouge plus du tout
  if (limit.remaining <= 0.05) return { x: origin.x, y: origin.y };

  // Dichotomie coûteuse : on ne la relance que si la destination a changé
  const key = `${Math.round(point.x)}:${Math.round(point.y)}:${limit.remaining}`;
  const hit = _cache.get(self.id);
  let stop;
  if (hit && hit.key === key) {
    stop = { x: hit.x, y: hit.y };
  } else {
    stop = furthestReachable(limit.actor, origin, point, limit.remaining);
    _cache.set(self.id, { key, x: stop.x, y: stop.y });
  }

  // Signale en direct l'entrée dans l'allonge d'un ennemi — sinon rien ne le
  // montre avant le dépôt du token. Pas de vrai clone à passer : on construit
  // un objet minimal portant juste ce dont updateDragThreatIndicator a besoin.
  try {
    updateDragThreatIndicator({
      center: stop, actor: limit.actor, id: doc.id,
      w: self.w, h: self.h, document: { disposition: doc.disposition }
    });
  } catch (e) { /* indicateur optionnel */ }

  return stop;
}

/**
 * Installe la contrainte en enveloppant Token#_updateDragDestination (le
 * point d'appel unique de la V13 pour l'aperçu ET le dépôt), et efface les
 * indicateurs/caches sur _onDragLeftStart / _onDragLeftDrop / _onDragLeftCancel.
 *
 * Passe par libWrapper quand il est actif — c'est le mécanisme prévu par
 * Foundry pour ce genre de "patch" de méthode core, justement pour éviter
 * les conflits qu'un monkey-patch direct provoque quand un autre module
 * wrappe la même méthode (ex: "Toggle Snap to Grid"). Sans libWrapper
 * installé, on retombe sur le monkey-patch direct d'origine (moins robuste
 * face à d'autres modules, mais fonctionnel seul).
 *
 * Idempotent, et entièrement défensif : si l'API diffère, le glisser-déposer
 * reste celui de Foundry (la vérification à l'enregistrement prend le relais,
 * et la limite s'appliquera quand même à la validation du déplacement via
 * onPreUpdateToken dans movement-tracker.js).
 */
export function installDragLimit() {
  if (globalThis.__rpgDragLimit) return;

  const proto = CONFIG?.Token?.objectClass?.prototype
             ?? foundry?.canvas?.placeables?.Token?.prototype
             ?? globalThis.Token?.prototype;
  if (!proto || typeof proto._updateDragDestination !== "function") {
    console.warn("[RPG] blocage du déplacement au glisser : API introuvable, "
               + "la limite s'appliquera à la validation du déplacement.");
    return;
  }

  const onDragStart = function (self) {
    try { const c = self.center; _dragOrigin.set(self.id, { x: c.x, y: c.y }); }
    catch { /* origine reprise depuis doc.x/y en repli */ }
  };
  const onDragEnd = function (self) {
    try { clearDragThreatIndicator(); } catch { /* ignore */ }
    if (self?.id) { _dragOrigin.delete(self.id); _cache.delete(self.id); }
  };

  if (globalThis.libWrapper) {
    try {
      if (typeof proto._onDragLeftStart === "function") {
        libWrapper.register("rpg", "CONFIG.Token.objectClass.prototype._onDragLeftStart",
          function (wrapped, event) {
            const result = wrapped(event);
            onDragStart(this);
            return result;
          }, "WRAPPER");
      }

      libWrapper.register("rpg", "CONFIG.Token.objectClass.prototype._updateDragDestination",
        function (wrapped, point, options) {
          return wrapped(clampDestination(this, point), options);
        }, "WRAPPER");

      for (const hookName of ["_onDragLeftDrop", "_onDragLeftCancel"]) {
        if (typeof proto[hookName] !== "function") continue;
        libWrapper.register("rpg", `CONFIG.Token.objectClass.prototype.${hookName}`,
          function (wrapped, event) {
            onDragEnd(this);
            return wrapped(event);
          }, "WRAPPER");
      }

      globalThis.__rpgDragLimit = true;
      Hooks.on("canvasTearDown", () => { _cache.clear(); _dragOrigin.clear(); clearDragThreatIndicator(); });
      console.log("[RPG] Blocage du déplacement au glisser : actif (via libWrapper).");
      return;
    } catch (e) {
      console.warn("[RPG] libWrapper.register a échoué, repli sur le monkey-patch direct :", e);
    }
  }

  // ── Repli sans libWrapper : monkey-patch direct des prototypes ─────────
  globalThis.__rpgDragLimit = true;

  if (typeof proto._onDragLeftStart === "function") {
    const originalStart = proto._onDragLeftStart;
    proto._onDragLeftStart = function (event) {
      const result = originalStart.call(this, event);
      onDragStart(this);
      return result;
    };
  }

  const originalUpdateDest = proto._updateDragDestination;
  proto._updateDragDestination = function (point, options) {
    return originalUpdateDest.call(this, clampDestination(this, point), options);
  };

  for (const hookName of ["_onDragLeftDrop", "_onDragLeftCancel"]) {
    if (typeof proto[hookName] !== "function") continue;
    const originalEnd = proto[hookName];
    proto[hookName] = function (event) {
      onDragEnd(this);
      return originalEnd.call(this, event);
    };
  }

  Hooks.on("canvasTearDown", () => { _cache.clear(); _dragOrigin.clear(); clearDragThreatIndicator(); });
  console.log("[RPG] Blocage du déplacement au glisser : actif.");
}

/** Vide le cache de dichotomie (appelé après chaque déplacement confirmé). */
export function clearDragLimitCache(tokenId = null) {
  if (tokenId) { _cache.delete(tokenId); _dragOrigin.delete(tokenId); }
  else { _cache.clear(); _dragOrigin.clear(); }
}
