// module/rules/movement-tracker.js
// Système de déplacement en mètres avec détection de terrain.
// Grille : 1m par case.

import {
  getBudget, saveBudget, canUseSlot, reserveSlot,
  releaseSlot, addLogEntry, updateLogEntry, findLogEntry
} from "./action-budget.js";
import {
  calculateMovementCost, formatTerrainSummary, getTerrainAt, TERRAIN_TYPES
} from "./region-behaviors.js";

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

// Debounce : regroupe les updates rapides en un seul message
const _pendingMoves = new Map(); // tokenId → { timer, startPos, lastPos, waypoints }
const DEBOUNCE_MS = 350;

// Position avant le move (capturée dans preUpdateToken)
const _prevPos = new Map();

// ─────────────────────────────────────────────────────────────────────────────

export function getVitesse(actor) {
  return Number(actor?.system?.deplacement?.vitesse ?? 6) || 6;
}

/** Mesure la distance réelle via canvas.grid.measurePath (Chebyshev/Pythagore). */
function measureDist(x1, y1, x2, y2) {
  try {
    if (canvas?.grid?.measurePath) {
      const r = canvas.grid.measurePath([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
      return r.distance ?? r.totalDistance ?? _cheby(x1, y1, x2, y2);
    }
  } catch { /* fallback */ }
  return _cheby(x1, y1, x2, y2);
}

function _cheby(x1, y1, x2, y2) {
  const gs = canvas?.scene?.grid?.size ?? 100;
  const d  = canvas?.scene?.grid?.distance ?? 1;
  return Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) / gs * d;
}

function fmt(m) { return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`; }

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook preUpdateToken — capture position avant déplacement.
 * Garde-fous côté client.
 */
export function onPreUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.combat?.active) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

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
      ui.notifications?.warn?.("Slot de déplacement épuisé.");
      return false;
    }

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

    if (cost > vitesse + 0.1) {
      const typeLabel = mult < 1 ? ` (terrain ×${mult})` : "";
      ui.notifications?.warn?.(
        `Déplacement impossible — ${fmt(cost)} nécessaires${typeLabel} vs ${fmt(vitesse)} disponibles.`
      );
      return false;
    }
  }
}

/**
 * Hook updateToken (GM) — crée le message avec debounce.
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
  const hasSlot = canUseSlot(budget, "deplacement");
  const vitesse = getVitesse(actor);

  // ── Calcul du coût réel avec terrain + type de déplacement ─────────────
  const { cost, segments, terrainsCrossed } = calculateMovementCost(waypoints, actor);
  const distBrute = segments.reduce((s, seg) => s + seg.rawDist, 0);
  const terrainInfo = formatTerrainSummary(terrainsCrossed);
  const overSpeed   = cost > vitesse + 0.05;
  const overSlot    = !hasSlot;

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
    waypoints
  };

  if (hasSlot) {
    await saveBudget(combat, combatant.id, reserveSlot(budget, "deplacement"));
  }

  await addLogEntry(combat, combatant.id, {
    id: actionId, slot: "deplacement",
    status: hasSlot ? "pending" : "overflow",
    label: `Déplacement ${actor.name} (${fmt(distBrute)} brut, coût ${fmt(cost)})`,
    actorId: actor.id, snapshot, timestamp: Date.now()
  });

  // ── Désengagement & attaque d'opportunité ────────────────────────────
  const adjacentDist = 1.5; // 1m case + marge
  const opportunityTargets = [];
  if (canvas?.tokens?.placeables) {
    for (const enemyTok of canvas.tokens.placeables) {
      const ea = enemyTok.actor;
      if (!ea || ea.id === actor.id) continue;
      if (ea.type === actor.type) continue;
      const ec = combat.combatants.find(c => c.actorId === ea.id);
      if (!ec || ec.getFlag("core","defeated")) continue;
      const dBefore = measureDist(startPos.x, startPos.y, enemyTok.x, enemyTok.y);
      const dAfter  = measureDist(endPos.x,   endPos.y,   enemyTok.x, enemyTok.y);
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
             style="display:block;width:100%;margin-bottom:3px;padding:3px 6px;cursor:pointer;font-size:11px">
             ⚔️ ${htmlEsc(t.name)} attaque ${htmlEsc(actor.name)}
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
  if (overSlot)  warnings.push(`⚠️ <b>Slot de déplacement épuisé</b>`);
  if (overSpeed) warnings.push(`⚠️ Coût <b>${fmt(cost)}</b> > vitesse <b>${fmt(vitesse)}</b>`);

  const warnLine = warnings.length
    ? `<div style="color:#c0392b;font-size:12px;margin:3px 0">${warnings.join("<br>")}</div>`
    : `<div style="color:#1d9e75;font-size:11px">✓ ${fmt(distBrute)} (coût ${fmt(cost)}) / ${fmt(vitesse)}</div>`;

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
export async function triggerOpportunityAttack(enemyActorId, moverActorId) {
  if (!game.user.isGM) return;
  const ea = game.actors.get(enemyActorId);
  const ma = game.actors.get(moverActorId);
  if (!ea || !ma) { ui.notifications?.warn?.("Acteur introuvable."); return; }

  const weapon = ea.items.find(i => i.type === "weapon" && i.system?.equipe)
    ?? ea.items.find(i => i.type === "weapon");
  if (!weapon) { ui.notifications?.warn?.(`${ea.name} n'a aucune arme.`); return; }

  const tnData = game.rpg?.combat?.computeTN?.(ea, ma, weapon) ?? { tnFinal: 11, livraison: "physique" };
  const roll = await (new Roll("1d20")).evaluate();
  await roll.toMessage({ speaker: { alias: ea.name },
    flavor: `⚔️ Attaque d'opportunité — ${ea.name} → ${ma.name} (TN ${tnData.tnFinal}+)` });

  await ChatMessage.create({
    speaker: { alias: ea.name },
    content: `<div style="font-size:13px">
      Attaque d'opportunité : <b>${htmlEsc(weapon.name)}</b> → <b>${htmlEsc(ma.name)}</b><br>
      🎲 d20 = <b>${roll.total}</b> (TN ${tnData.tnFinal}+)
      <div class="rpg-attack-gm" style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="rpg-attack-resolve" data-result="fail" style="flex:1;padding:4px;cursor:pointer">Échec</button>
        <button type="button" class="rpg-attack-resolve" data-result="hit" style="flex:1;padding:4px;cursor:pointer">Touché</button>
        <button type="button" class="rpg-attack-resolve" data-result="crit" style="flex:1;padding:4px;cursor:pointer;font-weight:700;color:gold">Critique!</button>
      </div>
    </div>`,
    flags: { rpg: { type: "attackDeclaration", actionId: foundry.utils.randomID(),
      attackDeclaration: { actorId: ea.id, weaponId: weapon.id, targetId: ma.id,
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
    if (td) await td.update({ x: snap.oldX, y: snap.oldY });
  }
  const budget = getBudget(combat, combatantId);
  await saveBudget(combat, combatantId, releaseSlot(budget, "deplacement", entry.status === "confirmed"));
  await updateLogEntry(combat, actionId, { status: "undone" });
  return { ok: true, label: entry.label ?? "Déplacement" };
}
