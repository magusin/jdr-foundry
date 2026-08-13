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
function costOf(actor, from, to, elevation = 0) {
  try {
    const { cost } = calculateMovementCost([from, to], actor, elevation);
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
function furthestReachable(actor, origin, dest, budget, elevation = 0) {
  if (costOf(actor, origin, dest, elevation) <= budget) return dest;

  let lo = 0, hi = 1;
  const at = (t) => ({ x: origin.x + t * (dest.x - origin.x),
                       y: origin.y + t * (dest.y - origin.y) });

  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (costOf(actor, origin, at(mid), elevation) <= budget) lo = mid;
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
  const elevation = doc.elevation ?? 0;
  const key = `${Math.round(point.x)}:${Math.round(point.y)}:${limit.remaining}`;
  const hit = _cache.get(self.id);
  let stop;
  if (hit && hit.key === key) {
    stop = { x: hit.x, y: hit.y };
  } else {
    stop = furthestReachable(limit.actor, origin, point, limit.remaining, elevation);
    _cache.set(self.id, { key, x: stop.x, y: stop.y });
  }

  return stop;
}

/* ── Allonges affichées pendant le geste ────────────────────────────────────
 *
 * L'affichage des allonges (la mienne, celles des ennemis) était appelé depuis
 * clampDestination, donc il dépendait du BRIDAGE de déplacement — qui ne
 * s'applique qu'en combat, qu'aux combattants inscrits, et par défaut qu'aux
 * joueurs (`movementLimitScope`). Résultat : dans les cas les plus courants —
 * le MJ qui déplace un monstre, n'importe qui hors combat, une réserve déjà
 * épuisée (retour anticipé) — rien ne s'affichait pendant le geste et la
 * situation ne se découvrait qu'une fois le token posé, ce qui est trop tard
 * pour choisir où s'arrêter. L'affichage est donc désormais branché sur le
 * geste lui-même, indépendamment du bridage.
 *
 * Il reçoit la destination BRIDÉE (celle où le token ira vraiment), pas le
 * point brut sous la souris : sinon il annoncerait une menace ou une cible
 * atteinte à un endroit que la réserve de déplacement interdit d'atteindre.
 */

// Tokens dont un glisser est réellement en cours. Foundry peut rappeler
// _updateDragDestination une dernière fois pendant le dépôt, APRÈS notre
// nettoyage : sans ce garde, l'affichage se redessinerait juste après avoir
// été effacé et resterait figé sur la carte jusqu'au geste suivant.
const _dragging = new Set();
let _dragStartHooked = false;

function _isDragging(self) {
  // Sans point d'accroche sur le début du glisser (API différente), on ne peut
  // pas savoir : on affiche, comme avant. Le nettoyage de fin de geste reste
  // en place dans les deux cas.
  return _dragStartHooked ? _dragging.has(self?.id) : true;
}

/**
 * Affiche les deux allonges à la position courante du geste.
 * Pas de vrai clone à passer en V13 (le token reste immobile pendant le
 * glisser) : on construit un objet minimal portant juste ce dont
 * updateDragThreatIndicator a besoin — dont `w`/`h`, l'emprise qui sert de
 * point de départ aux portées (utils/grid.js).
 */
function showDragReaches(self, point) {
  if (!point || !_isDragging(self)) return;
  try {
    updateDragThreatIndicator({
      center: point, actor: self.actor, id: self.id,
      w: self.w, h: self.h, document: { disposition: self.document?.disposition }
    });
  } catch { /* indicateur optionnel */ }
}

// Ne prévient qu'une fois par session si le calcul échoue en cours de
// glisser (ex : un futur changement d'API Foundry casse une hypothèse ici) —
// le glisser doit rester utilisable (destination Foundry non bridée) plutôt
// que de planter, la limite retombant alors sur la validation à l'enregistrement
// (onPreUpdateToken, movement-tracker.js).
let _clampErrorWarned = false;

/** Enveloppe défensive de clampDestination : ne doit jamais interrompre un glisser. */
function safeClampDestination(self, point) {
  try {
    return clampDestination(self, point) ?? point;
  } catch (e) {
    if (!_clampErrorWarned) {
      _clampErrorWarned = true;
      console.warn("[RPG] blocage du déplacement au glisser : erreur de calcul, "
                 + "destination non bridée pour ce glisser (repli sur la validation "
                 + "à l'enregistrement) :", e);
    }
    return point;
  }
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
    if (self?.id) _dragging.add(self.id);
    try { const c = self.center; _dragOrigin.set(self.id, { x: c.x, y: c.y }); }
    catch { /* origine reprise depuis doc.x/y en repli */ }
  };
  const onDragEnd = function (self) {
    if (self?.id) _dragging.delete(self.id);
    try { clearDragThreatIndicator(); } catch { /* ignore */ }
    if (self?.id) { _dragOrigin.delete(self.id); _cache.delete(self.id); }
  };

  // Le geste et son affichage passent par le même point d'appel que le
  // bridage : une seule destination, donc un affichage qui ne peut pas
  // annoncer autre chose que ce qui va réellement se produire.
  const onDragMove = function (self, point) {
    const dest = safeClampDestination(self, point);
    showDragReaches(self, dest);
    return dest;
  };

  if (globalThis.libWrapper) {
    try {
      if (typeof proto._onDragLeftStart === "function") {
        _dragStartHooked = true;
        libWrapper.register("rpg", "CONFIG.Token.objectClass.prototype._onDragLeftStart",
          function (wrapped, event) {
            const result = wrapped(event);
            onDragStart(this);
            return result;
          }, "WRAPPER");
      }

      libWrapper.register("rpg", "CONFIG.Token.objectClass.prototype._updateDragDestination",
        function (wrapped, point, options) {
          return wrapped(onDragMove(this, point), options);
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
      Hooks.on("canvasTearDown", () => { _cache.clear(); _dragOrigin.clear(); _dragging.clear(); clearDragThreatIndicator(); });
      console.log("[RPG] Blocage du déplacement au glisser : actif (via libWrapper).");
      return;
    } catch (e) {
      console.warn("[RPG] libWrapper.register a échoué, repli sur le monkey-patch direct :", e);
    }
  }

  // ── Repli sans libWrapper : monkey-patch direct des prototypes ─────────
  globalThis.__rpgDragLimit = true;

  if (typeof proto._onDragLeftStart === "function") {
    _dragStartHooked = true;
    const originalStart = proto._onDragLeftStart;
    proto._onDragLeftStart = function (event) {
      const result = originalStart.call(this, event);
      onDragStart(this);
      return result;
    };
  }

  const originalUpdateDest = proto._updateDragDestination;
  proto._updateDragDestination = function (point, options) {
    return originalUpdateDest.call(this, onDragMove(this, point), options);
  };

  for (const hookName of ["_onDragLeftDrop", "_onDragLeftCancel"]) {
    if (typeof proto[hookName] !== "function") continue;
    const originalEnd = proto[hookName];
    proto[hookName] = function (event) {
      onDragEnd(this);
      return originalEnd.call(this, event);
    };
  }

  Hooks.on("canvasTearDown", () => { _cache.clear(); _dragOrigin.clear(); _dragging.clear(); clearDragThreatIndicator(); });
  console.log("[RPG] Blocage du déplacement au glisser : actif.");
}

/** Vide le cache de dichotomie (appelé après chaque déplacement confirmé). */
export function clearDragLimitCache(tokenId = null) {
  if (tokenId) { _cache.delete(tokenId); _dragOrigin.delete(tokenId); }
  else { _cache.clear(); _dragOrigin.clear(); }
}
