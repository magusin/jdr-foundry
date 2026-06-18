// module/rules/movement-tracker.js
// Suivi du déplacement des tokens en combat + undo position

import {
  getBudget, saveBudget, canUseSlot, reserveSlot, confirmSlot,
  releaseSlot, addLogEntry, updateLogEntry, findLogEntry
} from "./action-budget.js";

const SCOPE = "rpg";

// Map temporaire tokenId → {x, y} avant le move (en mémoire client)
const _prevPos = new Map();

/**
 * Appelé dans preUpdateToken pour capturer la position avant le déplacement.
 */
export function onPreUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.combat?.active) return;
  const isTracked = game.combat.combatants.some(c => c.tokenId === tokenDoc.id);
  if (!isTracked) return;
  _prevPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
}

/**
 * Appelé dans updateToken (GM seulement).
 * Crée une entrée pending dans le log + message chat.
 */
export async function onUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.user.isGM) return;
  if (!game.combat?.active) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  const prevPos = _prevPos.get(tokenDoc.id);
  _prevPos.delete(tokenDoc.id);
  if (!prevPos) return; // pas capturé (ex: téléportation MJ)

  const newX = "x" in changes ? changes.x : tokenDoc.x;
  const newY = "y" in changes ? changes.y : tokenDoc.y;

  // Pas de mouvement réel (même case)
  if (prevPos.x === newX && prevPos.y === newY) return;

  const actor   = combatant.actor;
  if (!actor) return;

  const combat  = game.combat;
  const budget  = getBudget(combat, combatant.id);
  const hasSlot = canUseSlot(budget, "deplacement");

  // Calcule la distance en cases (Manhattan)
  const gs    = canvas?.scene?.grid?.size ?? 100;
  const dxCases = Math.abs(newX - prevPos.x) / gs;
  const dyCases = Math.abs(newY - prevPos.y) / gs;
  const distCases = Math.round(dxCases + dyCases); // Manhattan
  const vitesse = Number(actor.system?.deplacement?.vitesse ?? 3);

  const actionId = foundry.utils.randomID();

  const snapshot = {
    casterId:  actor.id,
    tokenId:   tokenDoc.id,
    oldX:      prevPos.x,
    oldY:      prevPos.y,
    newX,
    newY
  };

  // Réserve le slot si dispo, sinon log "overflow"
  if (hasSlot) {
    const newBudget = reserveSlot(budget, "deplacement");
    await saveBudget(combat, combatant.id, newBudget);
  }

  await addLogEntry(combat, combatant.id, {
    id:        actionId,
    slot:      "deplacement",
    status:    hasSlot ? "pending" : "overflow",
    label:     `Déplacement ${actor.name} (${distCases} case${distCases > 1 ? "s" : ""})`,
    actorId:   actor.id,
    snapshot,
    timestamp: Date.now()
  });

  // Message chat pour le MJ
  const overSlot  = !hasSlot;
  const overSpeed = distCases > vitesse;
  const warnings  = [];
  if (overSlot)  warnings.push(`⚠️ <b>Slot de déplacement épuisé</b>`);
  if (overSpeed) warnings.push(`⚠️ Déplacement de <b>${distCases}</b> cases — vitesse max <b>${vitesse}</b>`);

  const warnLine = warnings.length
    ? `<div style="color:#c0392b;margin:4px 0">${warnings.join("<br>")}</div>`
    : `<div style="color:#1d9e75;font-size:11px">Vitesse ok (${distCases}/${vitesse} cases)</div>`;

  const msgContent = `
    <div style="font-size:13px;line-height:1.6">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="background:${overSlot ? "#c0392b" : "#e0a020"};color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">
          ${overSlot ? "⚠️ Sans slot" : "⏳ En attente"}
        </span>
        <span>🏃 <b>Déplacement</b></span>
      </div>
      <b>${actor.name}</b> s'est déplacé de <b>${distCases}</b> case${distCases > 1 ? "s" : ""}
      ${warnLine}
      <div class="rpg-action-gm-btns" style="display:flex;gap:6px;margin-top:8px">
        <button type="button" data-action-resolve="confirm" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-size:12px">
          ✅ Valider
        </button>
        <button type="button" data-action-resolve="undo_move" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px;font-size:12px">
          ↩️ Annuler le déplacement
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

/**
 * Annule un déplacement : replace le token à sa position d'origine.
 */
export async function undoMovement(combat, actionId) {
  if (!game.user.isGM) return { ok: false, reason: "Réservé au MJ" };

  const found = findLogEntry(combat, actionId);
  if (!found) return { ok: false, reason: "Déplacement introuvable dans le log" };

  const { combatantId, entry } = found;
  const snap = entry.snapshot ?? {};

  // Replace le token
  if (snap.tokenId && snap.oldX !== undefined) {
    const tokenDoc = canvas?.scene?.tokens?.get(snap.tokenId)
                  ?? game.scenes.active?.tokens?.get(snap.tokenId);
    if (tokenDoc) {
      await tokenDoc.update({ x: snap.oldX, y: snap.oldY });
    }
  }

  // Libère le slot
  const budget    = getBudget(combat, combatantId);
  const wasConf   = entry.status === "confirmed";
  const newBudget = releaseSlot(budget, "deplacement", wasConf);
  await saveBudget(combat, combatantId, newBudget);

  await updateLogEntry(combat, actionId, { status: "undone" });

  return { ok: true, label: entry.label ?? "Déplacement" };
}
