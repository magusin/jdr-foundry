// module/rules/movement-tracker.js
// Système de déplacement en mètres avec détection de terrain.
// Grille : 1m par case.

import {
  getBudget, saveBudget, canUseSlot, reserveSlot,
  releaseSlot, addLogEntry, updateLogEntry, findLogEntry,
  movementRemaining, reserveMovement, releaseMovement
} from "./action-budget.js";
import {
  calculateMovementCost, formatTerrainSummary, getTerrainAt, TERRAIN_TYPES,
  measureSegmentMeters
} from "./region-behaviors.js";

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

// Debounce : regroupe les updates rapides en un seul message
const _pendingMoves = new Map(); // tokenId → { timer, startPos, lastPos, waypoints }
const DEBOUNCE_MS = 350;

// Position avant le move (capturée dans preUpdateToken)
const _prevPos = new Map();

// Position à laquelle le token DOIT se retrouver après un déplacement bridé :
//   - refus complet        → sa position de départ
//   - déplacement raccourci→ le dernier point atteignable
// Le pipeline de déplacement de la V13 n'honore pas toujours le refus ni la
// modification de `changes` : updateToken corrige alors la position.
// tokenId → { x, y, at }
const _pendingRevert = new Map();
const REVERT_TTL_MS = 3000;

// Anti-spam : un seul geste de glisser V13 déclenche plusieurs cycles
// preUpdateToken (position mise à jour en direct pendant le drag), donc le
// même « mur de budget » peut être touché plusieurs fois d'affilée. On ne
// remontre le toast qu'une fois par courte fenêtre, sans jamais sauter le
// bridage lui-même (qui doit s'appliquer à CHAQUE appel).
// tokenId → timestamp du dernier toast
const _lastNotifyAt = new Map();
const NOTIFY_COOLDOWN_MS = 1200;

// ─────────────────────────────────────────────────────────────────────────────

export function getVitesse(actor) {
  return Number(actor?.system?.deplacement?.vitesse ?? 6) || 6;
}

/**
 * Un combat existe et est actif dès sa création (Foundry l'active
 * automatiquement dans le tracker) — mais tant que le MJ n'a pas cliqué
 * « Commencer le combat », `round` reste à 0 : personne n'a encore de tour,
 * et les restrictions de déplacement ne doivent pas s'appliquer. `round > 0`
 * est exactement ce que pose `Combat#startCombat()`.
 */
function isCombatEngaged(combat) {
  return !!combat?.active && Number(combat?.round ?? 0) > 0;
}

/**
 * Allonge de menace au corps à corps d'un acteur, en mètres. Sert à savoir
 * jusqu'où il « engage » un adversaire (zone d'attaque d'opportunité).
 * = plus grande portée parmi ses armes ÉQUIPÉES de corps à corps (portée ≤ 3 m),
 * plancher à 1 m (menace à mains nues / au contact). Les armes à distance
 * (grande portée) ne comptent pas pour le désengagement.
 */
/**
 * Deux camps : ami (FRIENDLY) vs ennemi (HOSTILE), d'après la DISPOSITION du token
 * (et non le type d'acteur — un PNJ hostile est un « character » comme un joueur).
 * Le neutre (0) ne menace personne et n'est menacé par personne par défaut.
 */
export function areOpposedDisp(a, b) {
  const D = CONST?.TOKEN_DISPOSITIONS ?? { FRIENDLY: 1, HOSTILE: -1 };
  return (a === D.FRIENDLY && b === D.HOSTILE) || (a === D.HOSTILE && b === D.FRIENDLY);
}

const MELEE_REACH_MAX = 3;

/**
 * Arme de corps à corps ÉQUIPÉE dont l'allonge est la plus haute (allonge >
 * 0 et ≤ 3 m) — celle qui détermine la zone de menace affichée
 * (getMeleeReach ci-dessous). Avec deux armes équipées, seule CELLE-CI doit
 * porter l'attaque d'opportunité : sinon le cercle affiché au joueur
 * (allonge de sa meilleure arme) ne correspondrait plus à l'arme qui frappe
 * réellement quand il déclenche la réaction.
 */
export function bestMeleeWeapon(actor) {
  let best = null, bestReach = 0;
  try {
    const equipped = (actor?.items ?? []).filter(i => i.type === "weapon" && i.system?.equipe);
    for (const w of equipped) {
      const a = Number(w.system?.allonge ?? 0) || 0;
      if (a > 0 && a <= MELEE_REACH_MAX && a > bestReach) { bestReach = a; best = w; }
    }
  } catch { /* défaut null */ }
  return best;
}

export function getMeleeReach(actor) {
  // Monstre : allonge propre. 0 = pas de menace (aucune attaque d'opportunité).
  // Non défini → 1 m par défaut (valeur du template). 0 explicite est respecté.
  if (actor?.type === "monster") {
    return Math.max(0, Number(actor.system?.allonge ?? 1) || 0);
  }
  // Personnage/PNJ : plus grande ALLONGE parmi les armes ÉQUIPÉES de corps à corps
  // (allonge > 0 et ≤ 3 m). Aucune arme de mêlée équipée (ou allonge 0) → 0 =
  // pas de menace, donc pas d'attaque d'opportunité.
  return Number(bestMeleeWeapon(actor)?.system?.allonge ?? 0) || 0;
}

/**
 * Distance RP en mètres, diagonales pondérées selon le réglage « rpg.diagonalRule ».
 * Source unique partagée avec le calcul de coût de terrain (region-behaviors.js)
 * pour que déplacement, coût et adjacence utilisent EXACTEMENT la même règle.
 */
function measureDist(x1, y1, x2, y2) {
  return measureSegmentMeters(x1, y1, x2, y2);
}

function fmt(m) { return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`; }

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook preUpdateToken — capture position avant déplacement.
 * Garde-fous côté client.
 */
/**
 * Refuse un déplacement : mémorise la position de départ pour pouvoir la
 * restaurer si Foundry applique quand même la mise à jour, puis renvoie false.
 */
function _refuseMove(tokenDoc, message) {
  if (message) _notifyOnce(tokenDoc.id, () => ui.notifications?.warn?.(message));
  _pendingRevert.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y, at: Date.now() });
  return false;
}

/**
 * Affiche un toast au plus une fois par courte fenêtre par token — un seul
 * geste de glisser V13 peut déclencher le même bridage plusieurs fois
 * d'affilée (position mise à jour en direct pendant le drag).
 */
function _notifyOnce(tokenId, fn) {
  const now = Date.now();
  const last = _lastNotifyAt.get(tokenId) ?? 0;
  if (now - last < NOTIFY_COOLDOWN_MS) return;
  _lastNotifyAt.set(tokenId, now);
  fn();
}

/**
 * Point le plus éloigné atteignable sur le trajet start → dest avec `budget`
 * mètres de réserve. La métrique de distance est homogène (mesurer un vecteur
 * réduit de moitié donne la moitié du coût), on peut donc simplement mettre le
 * vecteur à l'échelle.
 */
function _clampToBudget(startPos, destX, destY, distBrute, mult, budget) {
  const maxDist = budget * (mult > 0 ? mult : 1);   // distance brute payable
  const t = distBrute > 0 ? Math.max(0, Math.min(1, maxDist / distBrute)) : 0;
  return {
    x: Math.round(startPos.x + t * (destX - startPos.x)),
    y: Math.round(startPos.y + t * (destY - startPos.y)),
    t
  };
}

/**
 * Règle de limite de déplacement applicable à un token, à un instant donné.
 * Source unique partagée par le blocage pendant le glisser-déposer ET la
 * vérification à l'enregistrement, pour qu'ils ne puissent pas diverger.
 *
 * @returns {{applies:boolean, remaining:number, combatant:object|null, actor:Actor|null}}
 */
export function getMovementLimit(tokenDoc) {
  const none = { applies: false, remaining: Infinity, combatant: null, actor: tokenDoc?.actor ?? null };
  if (!tokenDoc || !isCombatEngaged(game.combat)) return none;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return none;

  let enforce = "players";
  try { enforce = String(game.settings.get("rpg", "movementLimitScope") ?? "players"); } catch { /* défaut */ }
  if (enforce === "off") return none;

  let gmLimit = false;
  try { gmLimit = game.settings.get("rpg", "gmMovementLimit") === true; } catch { /* défaut */ }

  const applies = game.user.isGM ? (enforce === "all" || gmLimit) : true;
  if (!applies) return none;

  const actor = tokenDoc.actor;
  const budget = getBudget(game.combat, combatant.id);
  const remaining = movementRemaining(budget, getVitesse(actor));
  return { applies: true, remaining, combatant, actor };
}

export function onPreUpdateToken(tokenDoc, changes, options) {
  if (options?.rpgNoTrack) return;              // déplacement interne (annulation) : ne pas suivre
  if (!("x" in changes) && !("y" in changes)) return;
  if (!isCombatEngaged(game.combat)) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  // NB : on ne purge PAS _pendingRevert ici. En V13, un seul geste de glisser
  // déclenche PLUSIEURS cycles preUpdateToken/updateToken (mise à jour live de
  // la position pendant le drag, pas seulement au lâcher). Si on efface la
  // cible en attente à chaque appel, on annule la correction programmée par
  // l'appel précédent avant qu'elle ait pu s'appliquer — le token retombe
  // alors sur la dernière position non corrigée (souvent son point de départ).
  // La cible n'est réécrite que quand on calcule un nouveau point d'arrêt
  // (ci-dessous) ou effacée une fois honorée, dans onUpdateToken.
  // La réserve va changer : le point d'arrêt mis en cache pour le glisser
  // n'est plus valable.
  import("./drag-limit.js").then(m => m.clearDragLimitCache(tokenDoc.id)).catch(() => {});

  if (!_prevPos.has(tokenDoc.id)) {
    _prevPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
  }

  const actor = tokenDoc.actor;

  if (!game.user.isGM) {
    if (actor?.system?.derived?.ko) {
      return _refuseMove(tokenDoc, "K.O. — impossible de se déplacer.");
    }

    const current = game.combat.combatant;
    if (current && current.tokenId !== tokenDoc.id) {
      return _refuseMove(tokenDoc, "Ce n'est pas ton tour.");
    }
  }

  // ── Limite de vitesse ────────────────────────────────────────────────────
  // Joueur : toujours limité (sauf si le MJ a désactivé la règle).
  // MJ     : libre par défaut — il doit pouvoir repousser, téléporter ou
  //          replacer un token — et active la limite à la volée avec le
  //          raccourci « Limite de déplacement (MJ) » (Maj+M par défaut),
  //          par exemple pour jouer un monstre à la règle.
  // Hors combat, personne n'est limité (sortie plus haut).
  let enforce = "players";
  try { enforce = String(game.settings.get("rpg", "movementLimitScope") ?? "players"); } catch { /* défaut */ }
  if (enforce === "off") return;

  let gmLimit = false;
  try { gmLimit = game.settings.get("rpg", "gmMovementLimit") === true; } catch { /* défaut */ }

  const applies = game.user.isGM ? (enforce === "all" || gmLimit) : true;

  if (applies) {
    // Vérif vitesse + terrain (avec type de déplacement)
    const vitesse = getVitesse(actor);
    const startPos = _prevPos.get(tokenDoc.id) ?? { x: tokenDoc.x, y: tokenDoc.y };
    const newX = changes.x ?? tokenDoc.x;
    const newY = changes.y ?? tokenDoc.y;

    const destTerrains = getTerrainAt(newX, newY);
    const getEffMult = game?.rpg?.movementTypes?.getEffectiveSpeedMult;
    let mult = 1;
    for (const t of destTerrains) {
      const regionMult = Number(t.behavior?.system?.speedMult ?? t.terrain.speedMult ?? 1);
      const effMult = getEffMult ? getEffMult(actor, t.typeKey, regionMult) : regionMult;
      if (effMult < mult) mult = effMult;
    }
    const distBrute = measureDist(startPos.x, startPos.y, newX, newY);
    const cost = mult > 0 ? distBrute / mult : 999;

    // Réserve de mètres du tour (ce qu'il reste après les déplacements déjà faits)
    const budget    = getBudget(game.combat, combatant.id);
    const remaining = movementRemaining(budget, vitesse);

    if (cost > remaining + 0.1) {
      // Plutôt que de tout refuser, on ARRÊTE le token au dernier point
      // qu'il peut atteindre avec sa réserve : on ne va jamais plus loin que
      // ce qu'il reste, sans perdre le déplacement déjà entamé.
      if (remaining <= 0.05) {
        return _refuseMove(tokenDoc, "Plus de déplacement ce tour.");
      }

      const stop = _clampToBudget(startPos, newX, newY, distBrute, mult, remaining);

      if (stop.x === startPos.x && stop.y === startPos.y) {
        // La dichotomie retombe sur le point de départ (terrain trop cher
        // dès le premier pas) : rien à corriger, refus franc.
        return _refuseMove(tokenDoc, "Plus de déplacement ce tour.");
      }

      const typeLabel = mult < 1 ? ` (terrain ×${mult})` : "";
      _notifyOnce(tokenDoc.id, () => ui.notifications?.info?.(
        `Déplacement arrêté à ${fmt(remaining)}${typeLabel} — c'est tout ce qu'il te reste ce tour.`
      ));

      // On ne mute plus `changes.x/y` en espérant que Foundry honore la
      // modification : depuis le pipeline de « déplacement planifié »
      // (checkpoints / TokenDocument#move), rien ne garantit plus que ça se
      // répercute sur ce qui est réellement écrit/animé — en pratique le
      // token peut rester figé à son point de départ malgré ce message.
      // On refuse CETTE mise à jour précise et on programme nous-mêmes,
      // séparément, la mise à jour vers le point d'arrêt calculé — même
      // principe que le filet de sécurité ci-dessous dans onUpdateToken,
      // mais déclenché tout de suite plutôt qu'en réaction à un décalage
      // constaté après coup.
      _pendingRevert.set(tokenDoc.id, { x: stop.x, y: stop.y, at: Date.now() });
      queueMicrotask(() => {
        tokenDoc.update({ x: stop.x, y: stop.y }, { rpgNoTrack: true, animate: false })
          .catch(e => console.warn("[RPG] correction du déplacement bridé (arrêt) :", e));
      });
      return false;   // cette mise à jour précise est refusée, le raccourci suit séparément
    }
  }
}

/**
 * Hook updateToken (GM) — crée le message avec debounce.
 */
export async function onUpdateToken(tokenDoc, changes, options) {
  if (options?.rpgNoTrack) return;              // déplacement interne (annulation) : ne pas recompter
  if (!("x" in changes) && !("y" in changes)) return;

  // ── Filet de sécurité : la position bridée n'a pas été appliquée ─────────
  // preUpdateToken a refusé le déplacement ou l'a raccourci, mais le pipeline
  // de déplacement de la V13 n'honore pas toujours le refus ni la modification
  // de `changes` : on replace alors le token là où il devait s'arrêter.
  // Ne s'exécute que sur le client qui a tenté le déplacement, seul à avoir
  // mémorisé la position attendue.
  const target = _pendingRevert.get(tokenDoc.id);
  if (target) {
    _pendingRevert.delete(tokenDoc.id);
    const fresh = Date.now() - target.at < REVERT_TTL_MS;
    const landedX = "x" in changes ? changes.x : tokenDoc.x;
    const landedY = "y" in changes ? changes.y : tokenDoc.y;
    const offBy = Math.hypot(landedX - target.x, landedY - target.y);

    if (fresh && offBy > 1) {
      // Le token n'est pas là où il devait s'arrêter → on corrige. On coupe
      // d'abord toute animation de déplacement V13 encore en cours (le ruban
      // de déplacement natif peut continuer d'animer vers la destination
      // d'origine après notre correction sinon, donnant l'impression que le
      // token « revient » à sa position de départ une fois l'animation finie).
      try { tokenDoc.stopMovement?.(); } catch { /* API absente : ignorer */ }
      try {
        await tokenDoc.update({ x: target.x, y: target.y },
                              { rpgNoTrack: true, animate: false });
      } catch (e) {
        console.warn("[RPG] correction du déplacement bridé :", e);
      }
      // Vérifie que la correction a bien pris (une mise à jour live
      // concurrente du drag V13 a pu s'intercaler) ; sinon, un second essai.
      if (tokenDoc.x !== target.x || tokenDoc.y !== target.y) {
        try {
          await tokenDoc.update({ x: target.x, y: target.y },
                                { rpgNoTrack: true, animate: false });
        } catch (e) {
          console.warn("[RPG] 2e correction du déplacement bridé :", e);
        }
      }

      const start = _prevPos.get(tokenDoc.id);
      const wasRefusal = !start || (start.x === target.x && start.y === target.y);
      if (wasRefusal) {
        // Refus complet : rien à décompter.
        _prevPos.delete(tokenDoc.id);
        return;
      }
      // Déplacement raccourci : il a bien eu lieu jusqu'au point d'arrêt,
      // on continue le décompte normal avec les bonnes coordonnées.
      changes = { ...changes, x: target.x, y: target.y };
    }
  }

  if (!game.user.isGM) return;
  if (!isCombatEngaged(game.combat)) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  const prevPos = _prevPos.get(tokenDoc.id);
  const newX = "x" in changes ? changes.x : tokenDoc.x;
  const newY = "y" in changes ? changes.y : tokenDoc.y;

  if (prevPos && prevPos.x === newX && prevPos.y === newY) {
    _prevPos.delete(tokenDoc.id);
    return;
  }

  const startPos = prevPos ?? { x: tokenDoc.x, y: tokenDoc.y };

  const existing = _pendingMoves.get(tokenDoc.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.waypoints.push({ x: newX, y: newY });
    existing.lastPos = { x: newX, y: newY };
  } else {
    _pendingMoves.set(tokenDoc.id, {
      startPos,
      lastPos: { x: newX, y: newY },
      waypoints: [startPos, { x: newX, y: newY }]
    });
  }

  const pending = _pendingMoves.get(tokenDoc.id);
  pending.timer = setTimeout(async () => {
    _pendingMoves.delete(tokenDoc.id);
    _prevPos.delete(tokenDoc.id);
    await _processMove(tokenDoc, combatant, pending.waypoints);
  }, DEBOUNCE_MS);
}

async function _processMove(tokenDoc, combatant, waypoints) {
  if (waypoints.length < 2) return;
  const startPos = waypoints[0];
  const endPos   = waypoints[waypoints.length - 1];
  if (startPos.x === endPos.x && startPos.y === endPos.y) return;

  const actor   = combatant.actor;
  if (!actor) return;

  const combat  = game.combat;
  const budget  = getBudget(combat, combatant.id);
  const vitesse = getVitesse(actor);

  // ── Calcul du coût réel avec terrain + type de déplacement ─────────────
  const { cost, segments, terrainsCrossed } = calculateMovementCost(waypoints, actor);
  const distBrute = segments.reduce((s, seg) => s + seg.rawDist, 0);
  const terrainInfo = formatTerrainSummary(terrainsCrossed);

  // ── Réserve de mètres du tour ──────────────────────────────────────────
  const dep         = budget.deplacement ?? {};
  const firstMove   = ((dep.used ?? 0) + (dep.pending ?? 0)) === 0;
  const hasSlot     = firstMove ? canUseSlot(budget, "deplacement") : true;
  const remaining   = movementRemaining(budget, vitesse);
  const remainAfter = Math.max(0, remaining - cost);
  const overSpeed   = cost > remaining + 0.05;   // dépasse la réserve restante du tour
  const overSlot    = !hasSlot;                   // 1er déplacement sans slot d'action libre

  // Résumé des segments terrain pour le chat
  const segSummary = segments
    .filter(s => s.speedMult < 1)
    .map(s => `${fmt(s.rawDist)} en ${s.terrainLabel} (coût ${fmt(s.cost)})`)
    .join(", ");

  const actionId = foundry.utils.randomID();
  const snapshot = {
    casterId: actor.id, tokenId: tokenDoc.id,
    oldX: startPos.x, oldY: startPos.y,
    newX: endPos.x,   newY: endPos.y,
    cost, waypoints
  };

  // Réserve les mètres (+ 1 slot d'action au tout 1er déplacement du tour)
  if (hasSlot) {
    await saveBudget(combat, combatant.id, reserveMovement(budget, cost));
  }

  await addLogEntry(combat, combatant.id, {
    id: actionId, slot: "deplacement",
    status: hasSlot ? "pending" : "overflow",
    label: `Déplacement ${actor.name} (${fmt(distBrute)} brut, coût ${fmt(cost)})`,
    actorId: actor.id, snapshot, timestamp: Date.now()
  });

  // ── Désengagement & attaque d'opportunité ────────────────────────────
  // Un ennemi obtient une attaque d'opportunité si le personnage QUITTE sa
  // zone de menace (allonge de son arme : 1 m, 1,5 m…) : il était engagé
  // (dBefore ≤ allonge) et ne l'est plus après le déplacement (dAfter > allonge).
  const MARGE = 0.1; // petite tolérance de mesure
  const moverDisp = tokenDoc.disposition;
  const opportunityTargets = [];
  if (canvas?.tokens?.placeables) {
    for (const enemyTok of canvas.tokens.placeables) {
      const ea = enemyTok.actor;
      if (!ea || ea.id === actor.id) continue;
      // Ennemi = camp opposé (disposition), pas type d'acteur : un PNJ hostile
      // est un « character » comme un joueur.
      if (!areOpposedDisp(moverDisp, enemyTok.document?.disposition)) continue;
      const ec = combat.combatants.find(c => c.actorId === ea.id);
      if (!ec || ec.getFlag("core","defeated")) continue;
      const reach   = getMeleeReach(ea);
      const dBefore = measureDist(startPos.x, startPos.y, enemyTok.x, enemyTok.y);
      const dAfter  = measureDist(endPos.x,   endPos.y,   enemyTok.x, enemyTok.y);
      if (dBefore <= reach + MARGE && dAfter > reach + MARGE) {
        opportunityTargets.push({ id: ea.id, name: ea.name, reach });
      }
    }
  }

  const opportunityHtml = opportunityTargets.length
    ? `<div style="margin-top:8px;padding:6px;background:rgba(192,57,43,0.1);border-radius:6px">
         <div style="font-size:11px;font-weight:600;margin-bottom:4px">⚔️ Désengagement — attaque d'opportunité :</div>
         ${opportunityTargets.map(t => `
           <button type="button" class="rpg-opportunity-btn"
             data-enemy-id="${t.id}" data-mover-id="${actor.id}"
             style="display:block;width:100%;margin-bottom:3px;padding:3px 6px;cursor:pointer;font-size:11px">
             ⚔️ ${htmlEsc(t.name)} (allonge ${fmt(t.reach)}) attaque ${htmlEsc(actor.name)}
           </button>`).join("")}
       </div>`
    : "";

  // ── Résumé terrain ───────────────────────────────────────────────────
  let terrainHtml = "";
  if (terrainsCrossed.size) {
    const terrainLines = [...terrainsCrossed].map(k => {
      const t = TERRAIN_TYPES[k];
      return `<span style="background:${t.color}22;border:1px solid ${t.color}44;border-radius:3px;padding:1px 5px;font-size:10px">${t.label} ×${t.speedMult}</span>`;
    });
    terrainHtml = `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${terrainLines.join("")}</div>`;
    if (segSummary) {
      terrainHtml += `<div style="font-size:10px;opacity:.65;margin-top:2px">${segSummary}</div>`;
    }
  }

  const warnings = [];
  if (overSlot)  warnings.push(`⚠️ <b>Aucun slot d'action libre</b> pour amorcer le déplacement`);
  if (overSpeed) warnings.push(`⚠️ Coût <b>${fmt(cost)}</b> > réserve restante <b>${fmt(remaining)}</b> ce tour`);

  const warnLine = warnings.length
    ? `<div style="color:#c0392b;font-size:12px;margin:3px 0">${warnings.join("<br>")}
         <div style="font-size:10px;opacity:.75">Réserve du tour : ${fmt(vitesse)} — reste ${fmt(remaining)}</div>
       </div>`
    : `<div style="color:#1d9e75;font-size:11px">✓ coût ${fmt(cost)} — reste <b>${fmt(remainAfter)}</b> / ${fmt(vitesse)} ce tour</div>`;

  const msgContent = `
    <div style="font-size:13px;line-height:1.5">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="background:${overSlot ? "#c0392b" : "#e0a020"};color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">
          ${overSlot ? "⚠️ Sans slot" : "⏳ En attente"}
        </span>
        <span>🏃 <b>${htmlEsc(actor.name)}</b> — ${fmt(distBrute)}</span>
      </div>
      ${warnLine}
      ${terrainHtml}
      ${opportunityHtml}
      <div class="rpg-action-gm-btns" style="display:flex;gap:6px;margin-top:8px">
        <button type="button" data-action-resolve="confirm" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-size:12px">
          ✅ Valider
        </button>
        <button type="button" data-action-resolve="undo_move" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px;font-size:12px">
          ↩️ Annuler
        </button>
      </div>
    </div>`;

  const msg = await ChatMessage.create({
    speaker: { alias: actor.name },
    content: msgContent,
    flags: { rpg: { pendingAction: { type: "move", actionId, outcome: "confirm" } } }
  });
  await updateLogEntry(combat, actionId, { chatMessageId: msg.id });
}

// ── Attaque d'opportunité ────────────────────────────────────────────────────

/** Demande confirmation MJ (Oui/Non) pour une attaque d'opportunité de PJ. */
async function _confirmOpportunity(ea, ma, item) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const content = `<p><b>${htmlEsc(ea.name)}</b> peut porter une attaque d'opportunité sur
    <b>${htmlEsc(ma.name)}</b> qui se désengage, avec <b>${htmlEsc(item.name)}</b>.</p>
    <p>Confirmer l'attaque ?</p>`;
  try {
    if (DialogV2?.confirm) {
      return await DialogV2.confirm({
        window: { title: "Attaque d'opportunité" },
        content, modal: true, rejectClose: false
      });
    }
  } catch (e) { console.warn("[RPG] confirm opportunité:", e); }
  return true; // fallback : pas de DialogV2 → considère confirmé
}

/**
 * Une compétence de monstre (item type "spell") n'est utilisable que hors
 * recharge — les armes (pas de champ cooldown) sont toujours disponibles.
 */
function _isAbilityAvailable(item) {
  if (item?.type !== "spell") return true;
  return Number(item?.system?.cooldown?.restant ?? 0) <= 0;
}

/** Laisse le MJ choisir la compétence d'un monstre parmi celles hors recharge. null = annulé. */
async function _chooseOpportunityAbility(ea, ma, abilities) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const opts = abilities.map(a => {
    const cdRest = a.type === "spell" ? Number(a.system?.cooldown?.restant ?? 0) : 0;
    const label = a.type === "spell" ? " (compétence)" : " (arme)";
    return `<option value="${a.id}">${htmlEsc(a.name)}${label}${cdRest > 0 ? ` — en recharge (${cdRest})` : ""}</option>`;
  }).join("");
  const content = `
    <p><b>${htmlEsc(ea.name)}</b> peut réagir contre <b>${htmlEsc(ma.name)}</b> qui se désengage.</p>
    <p>Compétence à utiliser :</p>
    <select name="ability" style="width:100%">${opts}</select>`;
  try {
    if (DialogV2?.wait) {
      const chosenId = await DialogV2.wait({
        window: { title: "Attaque d'opportunité — compétence" },
        content, modal: true, rejectClose: false,
        buttons: [
          { action: "ok", label: "⚔️ Attaquer", default: true,
            callback: (event, button) => button.form?.elements?.ability?.value ?? null },
          { action: "cancel", label: "Annuler", callback: () => null }
        ]
      });
      return chosenId ? (ea.items.get(chosenId) ?? null) : null;
    }
  } catch (e) { console.warn("[RPG] choix compétence opportunité:", e); }
  return abilities[0] ?? null; // fallback : 1re compétence
}

export async function triggerOpportunityAttack(enemyActorId, moverActorId) {
  if (!game.user.isGM) return;
  const ea = game.actors.get(enemyActorId);
  const ma = game.actors.get(moverActorId);
  if (!ea || !ma) { ui.notifications?.warn?.("Acteur introuvable."); return; }

  // ── Choix de l'attaque + confirmation MJ ──────────────────────────────
  let item = null;
  if (ea.type === "monster") {
    // Les monstres n'ont pas d'armes : ils attaquent avec leurs compétences (sorts/armes)
    const abilities = ea.items.filter(i => i.type === "spell" || i.type === "weapon");
    if (!abilities.length) { ui.notifications?.warn?.(`${ea.name} n'a aucune compétence.`); return; }
    const available = abilities.filter(_isAbilityAvailable);
    if (!available.length) {
      ui.notifications?.warn?.(`${ea.name} n'a aucune compétence disponible (toutes en recharge).`);
      return;
    }
    item = await _chooseOpportunityAbility(ea, ma, available);
    if (!item) return; // MJ a annulé
  } else {
    // Avec deux armes équipées, l'attaque d'opportunité doit porter avec
    // celle qui a la plus haute allonge — c'est elle qui détermine le
    // cercle de menace affiché au joueur (getMeleeReach) ; une autre arme
    // "au hasard" du tableau d'objets donnerait un coup incohérent avec ce
    // que ce cercle promettait.
    item = bestMeleeWeapon(ea)
        ?? ea.items.find(i => i.type === "weapon" && i.system?.equipe)
        ?? ea.items.find(i => i.type === "weapon");
    if (!item) { ui.notifications?.warn?.(`${ea.name} n'a aucune arme.`); return; }
    if (!(await _confirmOpportunity(ea, ma, item))) return; // MJ a refusé
  }

  // ── Résolution — même mécanisme qu'une attaque normale ────────────────
  const tnData = game.rpg?.combat?.computeTN?.(ea, ma, item)
    ?? { tnFinal: 11, livraison: item.system?.livraison ?? "physique" };
  const roll = await (new Roll("1d20")).evaluate();
  await roll.toMessage({ speaker: { alias: ea.name },
    flavor: `⚔️ Attaque d'opportunité — ${ea.name} → ${ma.name} (TN ${tnData.tnFinal}+)` });

  await ChatMessage.create({
    speaker: { alias: ea.name },
    content: `<div style="font-size:13px">
      Attaque d'opportunité : <b>${htmlEsc(item.name)}</b> → <b>${htmlEsc(ma.name)}</b><br>
      🎲 d20 = <b>${roll.total}</b> (TN ${tnData.tnFinal}+)
      <div class="rpg-attack-gm" style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="rpg-attack-resolve" data-result="fail" style="flex:1;padding:4px;cursor:pointer">Échec</button>
        <button type="button" class="rpg-attack-resolve" data-result="hit" style="flex:1;padding:4px;cursor:pointer">Touché</button>
        <button type="button" class="rpg-attack-resolve" data-result="crit" style="flex:1;padding:4px;cursor:pointer;font-weight:700;color:gold">Critique!</button>
      </div>
    </div>`,
    flags: { rpg: { type: "attackDeclaration", phase: "rolled", actionId: foundry.utils.randomID(),
      attackDeclaration: { actorId: ea.id, weaponId: item.id, targetId: ma.id,
        d20: roll.total, tnFinal: tnData.tnFinal, livraison: tnData.livraison } } }
  });
}

export function bindOpportunityAttackButtons(htmlEl) {
  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;
  if (!game.user.isGM) { root.querySelectorAll(".rpg-opportunity-btn").forEach(b => b.remove()); return; }
  root.querySelectorAll(".rpg-opportunity-btn").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      btn.disabled = true; btn.textContent += " ✓";
      try { await triggerOpportunityAttack(btn.dataset.enemyId, btn.dataset.moverId); }
      catch (e) { console.error("[RPG][Opportunity]", e); btn.disabled = false; }
    });
  });
}

export async function undoMovement(combat, actionId) {
  if (!game.user.isGM) return { ok: false };
  const found = findLogEntry(combat, actionId);
  if (!found) return { ok: false };
  const { combatantId, entry } = found;
  const snap = entry.snapshot ?? {};
  if (snap.tokenId && snap.oldX !== undefined) {
    const td = canvas?.scene?.tokens?.get(snap.tokenId)
      ?? game.scenes.active?.tokens?.get(snap.tokenId);
    if (td) {
      // Sans couper l'animation ni la désactiver, le token glisse encore
      // vers sa position annulée quand les cercles d'allonge/déplacement se
      // redessinent (updateToken, ~80ms après) : ils se calent alors sur une
      // position transitoire au lieu du point d'arrivée réel. Même parade
      // que la correction de bridage de vitesse dans onUpdateToken.
      try { td.stopMovement?.(); } catch { /* API absente : ignorer */ }
      await td.update({ x: snap.oldX, y: snap.oldY }, { rpgNoTrack: true, animate: false });
    }
  }
  const budget = getBudget(combat, combatantId);
  await saveBudget(combat, combatantId,
    releaseMovement(budget, snap.cost ?? 0, entry.status === "confirmed"));
  await updateLogEntry(combat, actionId, { status: "undone" });
  return { ok: true, label: entry.label ?? "Déplacement" };
}

/**
 * Diagnostic de la limite de déplacement — à lancer dans la console (F12) :
 *     game.rpg.debugMovement()
 * avec le token concerné SÉLECTIONNÉ. Affiche chaque condition et indique
 * laquelle bloque, pour savoir si la règle s'applique et pourquoi.
 */
export function debugMovement() {
  const out = {};
  const token = canvas?.tokens?.controlled?.[0] ?? null;
  out["token sélectionné"] = token?.name ?? "❌ AUCUN — sélectionne un token";
  if (!token) { console.table(out); return out; }

  out["combat actif"] = isCombatEngaged(game.combat) ? "✔ oui" : "❌ non (aucune limite hors combat, ou combat pas encore commencé)";
  const cbt = game.combat?.combatants?.find(c => c.tokenId === token.id) ?? null;
  out["token dans le combat"] = cbt ? "✔ oui" : "❌ non (ce token n'est pas un combattant)";

  let scope = "?", gmLimit = "?";
  try { scope = String(game.settings.get("rpg", "movementLimitScope")); } catch (e) { scope = "❌ réglage absent"; }
  try { gmLimit = game.settings.get("rpg", "gmMovementLimit") === true; } catch (e) { gmLimit = "❌ réglage absent"; }
  out["réglage « Limite de déplacement »"] = scope;
  out["MJ : limite activée (Maj+M)"] = gmLimit === true ? "🔒 oui" : "🔓 non";
  out["vous êtes"] = game.user.isGM ? "MJ" : "joueur";

  const applies = scope === "off" ? false : (game.user.isGM ? (scope === "all" || gmLimit === true) : true);
  out["la limite s'applique à vous"] = applies ? "✔ OUI" : "❌ non";
  out["blocage pendant le glisser"] = globalThis.__rpgDragLimit
    ? "✔ actif (le token bute sur sa réserve)"
    : "❌ inactif — la limite s'appliquera seulement au lâcher";

  const actor = token.actor;
  out["vitesse du token"] = actor ? `${getVitesse(actor)} m` : "❌ pas d'acteur";

  if (cbt && game.combat) {
    try {
      const budget = getBudget(game.combat, cbt.id);
      out["réserve restante ce tour"] = `${movementRemaining(budget, getVitesse(actor))} m`;
    } catch (e) { out["réserve restante ce tour"] = `❌ ${e.message}`; }
    out["c'est son tour"] = game.combat.combatant?.id === cbt.id ? "✔ oui" : "non";
  }

  console.table(out);
  return out;
}
