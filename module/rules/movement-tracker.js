// module/rules/movement-tracker.js
// Suivi du déplacement des tokens en combat — distance en MÈTRES
// Utilise canvas.grid.measurePath pour la vraie distance (Pythagore/Chebyshev)
// plutôt que la distance Manhattan qui pénalise les diagonales.

import {
  getBudget, saveBudget, canUseSlot, reserveSlot,
  releaseSlot, addLogEntry, updateLogEntry, findLogEntry
} from "./action-budget.js";

const SCOPE = "rpg";

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

// Debounce par token : regroupe plusieurs updates rapides en un seul message
const _pendingMoves = new Map(); // tokenId → { timer, prevPos, lastPos }
const DEBOUNCE_MS = 400;

// Map temporaire tokenId → position avant move
const _prevPos = new Map();

/**
 * Mesure la distance réelle en mètres entre deux points sur la grille Foundry.
 * Utilise canvas.grid.measurePath (Chebyshev sur carré, Pythagore sur hexa).
 * Fallback sur distance Chebyshev si canvas non disponible.
 */
function measureDistanceMeters(x1, y1, x2, y2) {
  try {
    if (canvas?.grid?.measurePath) {
      const result = canvas.grid.measurePath([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
      return result.distance ?? result.totalDistance ?? _chebychev(x1, y1, x2, y2);
    }
  } catch { /* fallback */ }
  return _chebychev(x1, y1, x2, y2);
}

function _chebychev(x1, y1, x2, y2) {
  const gs = canvas?.scene?.grid?.size ?? 100;
  const dist = canvas?.scene?.grid?.distance ?? 1.5; // mètres par case
  const dx = Math.abs(x2 - x1) / gs;
  const dy = Math.abs(y2 - y1) / gs;
  return Math.max(dx, dy) * dist; // Chebyshev × mètres/case
}

function getVitesseMeters(actor) {
  return Number(actor?.system?.deplacement?.vitesse ?? 6) || 6;
}

/**
 * Hook preUpdateToken — capture la position avant déplacement.
 * Garde-fous côté client (tour, K.O., vitesse).
 */
export function onPreUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.combat?.active) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  // Mémorise la position de départ (avant ce move)
  if (!_prevPos.has(tokenDoc.id)) {
    _prevPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
  }

  if (!game.user.isGM) {
    const actor = tokenDoc.actor;

    if (actor?.system?.derived?.ko) {
      ui.notifications?.warn?.("K.O. — impossible de se déplacer.");
      return false;
    }

    const current = game.combat.combatant;
    if (current && current.tokenId !== tokenDoc.id) {
      ui.notifications?.warn?.("Ce n'est pas ton tour.");
      return false;
    }

    const budget = game.rpg?.budget?.getBudgetFor?.(game.combat, combatant.id);
    if (budget && !game.rpg?.budget?.canUseSlot(budget, "deplacement")) {
      ui.notifications?.warn?.("Slot de déplacement épuisé pour ce tour.");
      return false;
    }

    // Vérif vitesse en mètres
    const vitesse = getVitesseMeters(actor);
    const startPos = _prevPos.get(tokenDoc.id) ?? { x: tokenDoc.x, y: tokenDoc.y };
    const newX = changes.x ?? tokenDoc.x;
    const newY = changes.y ?? tokenDoc.y;
    const dist = measureDistanceMeters(startPos.x, startPos.y, newX, newY);
    if (dist > vitesse + 0.1) {
      ui.notifications?.warn?.(`Vitesse max ${vitesse}m — tu essaies de faire ${dist.toFixed(1)}m.`);
      return false;
    }
  }
}

/**
 * Hook updateToken (GM seulement) — crée le message pending avec debounce.
 * Regroupe les updates rapides (glisser-déposer multi-cases) en un seul message.
 */
export async function onUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.user.isGM) return;
  if (!game.combat?.active) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  const prevPos = _prevPos.get(tokenDoc.id);
  const newX = "x" in changes ? changes.x : tokenDoc.x;
  const newY = "y" in changes ? changes.y : tokenDoc.y;

  if (prevPos && prevPos.x === newX && prevPos.y === newY) {
    _prevPos.delete(tokenDoc.id);
    return;
  }

  // Debounce : accumule les moves pendant DEBOUNCE_MS puis traite en une fois
  const existing = _pendingMoves.get(tokenDoc.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.lastPos = { x: newX, y: newY };
  } else {
    _pendingMoves.set(tokenDoc.id, {
      startPos: prevPos ?? { x: tokenDoc.x, y: tokenDoc.y },
      lastPos: { x: newX, y: newY }
    });
  }

  const pending = _pendingMoves.get(tokenDoc.id);
  pending.timer = setTimeout(async () => {
    _pendingMoves.delete(tokenDoc.id);
    _prevPos.delete(tokenDoc.id);
    await _processMove(tokenDoc, combatant, pending.startPos, pending.lastPos);
  }, DEBOUNCE_MS);
}

async function _processMove(tokenDoc, combatant, startPos, endPos) {
  if (startPos.x === endPos.x && startPos.y === endPos.y) return;

  const actor  = combatant.actor;
  if (!actor) return;

  const combat  = game.combat;
  const budget  = getBudget(combat, combatant.id);
  const hasSlot = canUseSlot(budget, "deplacement");
  const vitesse = getVitesseMeters(actor);

  // Distance réelle en mètres via Foundry
  const distM = measureDistanceMeters(startPos.x, startPos.y, endPos.x, endPos.y);
  const distStr = distM % 1 === 0 ? `${distM}m` : `${distM.toFixed(1)}m`;

  const actionId = foundry.utils.randomID();
  const snapshot = {
    casterId: actor.id, tokenId: tokenDoc.id,
    oldX: startPos.x, oldY: startPos.y,
    newX: endPos.x, newY: endPos.y
  };

  if (hasSlot) {
    await saveBudget(combat, combatant.id, reserveSlot(budget, "deplacement"));
  }

  await addLogEntry(combat, combatant.id, {
    id: actionId, slot: "deplacement",
    status: hasSlot ? "pending" : "overflow",
    label: `Déplacement ${actor.name} (${distStr})`,
    actorId: actor.id, snapshot, timestamp: Date.now()
  });

  // Attaque d'opportunité : désengagement d'un ennemi adjacent
  const opportunityTargets = [];
  if (canvas?.tokens?.placeables) {
    const gs = canvas.scene?.grid?.size ?? 100;
    const adjacentDist = (canvas.scene?.grid?.distance ?? 1.5) * 1.5; // ~2m
    for (const enemyTok of canvas.tokens.placeables) {
      const ea = enemyTok.actor;
      if (!ea || ea.id === actor.id) continue;
      if (ea.type === actor.type) continue;
      const ec = combat.combatants.find(c => c.actorId === ea.id);
      if (!ec || ec.getFlag("core","defeated")) continue;
      const dBefore = measureDistanceMeters(startPos.x, startPos.y, enemyTok.x, enemyTok.y);
      const dAfter  = measureDistanceMeters(endPos.x, endPos.y, enemyTok.x, enemyTok.y);
      if (dBefore <= adjacentDist && dAfter > adjacentDist) {
        opportunityTargets.push({ id: ea.id, name: ea.name });
      }
    }
  }

  const opportunityHtml = opportunityTargets.length
    ? `<div style="margin-top:8px;padding:6px;background:rgba(192,57,43,0.1);border-radius:6px">
         <div style="font-size:11px;font-weight:600;margin-bottom:4px">⚔️ Désengagement — attaque d'opportunité :</div>
         ${opportunityTargets.map(t => `
           <button type="button" class="rpg-opportunity-btn"
             data-enemy-id="${t.id}" data-mover-id="${actor.id}"
             style="display:block;width:100%;margin-bottom:4px;padding:4px;cursor:pointer;font-size:11px">
             ⚔️ ${htmlEsc(t.name)} attaque ${htmlEsc(actor.name)}
           </button>`).join("")}
       </div>`
    : "";

  const overSlot  = !hasSlot;
  const overSpeed = distM > vitesse + 0.1;
  const warnings  = [];
  if (overSlot)  warnings.push(`⚠️ <b>Slot de déplacement épuisé</b>`);
  if (overSpeed) warnings.push(`⚠️ <b>${distStr}</b> déplacés — vitesse max <b>${vitesse}m</b>`);

  const warnLine = warnings.length
    ? `<div style="color:#c0392b;margin:4px 0;font-size:12px">${warnings.join("<br>")}</div>`
    : `<div style="color:#1d9e75;font-size:11px">✓ ${distStr} / ${vitesse}m</div>`;

  const msgContent = `
    <div style="font-size:13px;line-height:1.6">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="background:${overSlot ? "#c0392b" : "#e0a020"};color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">
          ${overSlot ? "⚠️ Sans slot" : "⏳ En attente"}
        </span>
        <span>🏃 <b>Déplacement</b> — <b>${htmlEsc(actor.name)}</b> — ${distStr}</span>
      </div>
      ${warnLine}
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

  // Validation côté serveur : si le déplacement dépasse la vitesse → log warning
  if (overSpeed) {
    console.warn(`[RPG][Move] ${actor.name} a dépassé sa vitesse (${distStr} > ${vitesse}m)`);
  }
}

export async function triggerOpportunityAttack(enemyActorId, moverActorId) {
  if (!game.user.isGM) return;
  const enemyActor = game.actors.get(enemyActorId);
  const moverActor = game.actors.get(moverActorId);
  if (!enemyActor || !moverActor) { ui.notifications?.warn?.("Acteur introuvable."); return; }

  const weapon = enemyActor.items.find(i => i.type === "weapon" && i.system?.equipe)
    ?? enemyActor.items.find(i => i.type === "weapon");
  if (!weapon) { ui.notifications?.warn?.(`${enemyActor.name} n'a aucune arme.`); return; }

  const combatAPI = game.rpg?.combat;
  const tnData = combatAPI?.computeTN
    ? combatAPI.computeTN(enemyActor, moverActor, weapon)
    : { tnFinal: 11, livraison: "physique" };

  const roll20 = await (new Roll("1d20")).evaluate();
  await roll20.toMessage({
    speaker: { alias: enemyActor.name },
    flavor: `⚔️ Attaque d'opportunité — ${enemyActor.name} → ${moverActor.name} (TN ${tnData.tnFinal}+)`
  });

  const actionId = foundry.utils.randomID();
  await ChatMessage.create({
    speaker: { alias: enemyActor.name },
    content: `<div style="font-size:13px">
      Attaque d'opportunité : <b>${htmlEsc(weapon.name)}</b> → <b>${htmlEsc(moverActor.name)}</b><br>
      🎲 d20 = <b>${roll20.total}</b> (TN ${tnData.tnFinal}+)
      <div class="rpg-attack-gm" style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="rpg-attack-resolve" data-result="fail" style="flex:1;padding:4px;cursor:pointer">Échec</button>
        <button type="button" class="rpg-attack-resolve" data-result="hit" style="flex:1;padding:4px;cursor:pointer">Touché</button>
        <button type="button" class="rpg-attack-resolve" data-result="crit" style="flex:1;padding:4px;cursor:pointer;font-weight:700;color:gold">Critique !</button>
      </div>
    </div>`,
    flags: { rpg: { type: "attackDeclaration", actionId,
      attackDeclaration: { actorId: enemyActor.id, weaponId: weapon.id, targetId: moverActor.id,
        d20: roll20.total, tnFinal: tnData.tnFinal, livraison: tnData.livraison } } }
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
      btn.disabled = true; btn.textContent += " (utilisée)";
      try { await triggerOpportunityAttack(btn.dataset.enemyId, btn.dataset.moverId); }
      catch (e) { console.error("[RPG][Opportunity]", e); btn.disabled = false; }
    });
  });
}

export async function undoMovement(combat, actionId) {
  if (!game.user.isGM) return { ok: false, reason: "Réservé au MJ" };
  const found = findLogEntry(combat, actionId);
  if (!found) return { ok: false, reason: "Déplacement introuvable" };
  const { combatantId, entry } = found;
  const snap = entry.snapshot ?? {};
  if (snap.tokenId && snap.oldX !== undefined) {
    const tokenDoc = canvas?.scene?.tokens?.get(snap.tokenId)
      ?? game.scenes.active?.tokens?.get(snap.tokenId);
    if (tokenDoc) await tokenDoc.update({ x: snap.oldX, y: snap.oldY });
  }
  const budget = getBudget(combat, combatantId);
  await saveBudget(combat, combatantId, releaseSlot(budget, "deplacement", entry.status === "confirmed"));
  await updateLogEntry(combat, actionId, { status: "undone" });
  return { ok: true, label: entry.label ?? "Déplacement" };
}
