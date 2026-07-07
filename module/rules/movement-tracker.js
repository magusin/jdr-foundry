// module/rules/movement-tracker.js
// Suivi du déplacement des tokens en combat + undo position

import {
  getBudget, saveBudget, canUseSlot, reserveSlot, confirmSlot,
  releaseSlot, addLogEntry, updateLogEntry, findLogEntry
} from "./action-budget.js";

const SCOPE = "rpg";

const htmlEscapeLocal = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Map temporaire tokenId → {x, y} avant le move (en mémoire client)
const _prevPos = new Map();

/**
 * Appelé dans preUpdateToken pour capturer la position avant le déplacement.
 */
export function onPreUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.combat?.active) return;

  const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
  if (!combatant) return;

  // Mémorise la position pour onUpdateToken
  _prevPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });

  // ✅ GARDE-FOU : blocage si pas le tour du combattant ou K.O.
  if (!game.user.isGM) {
    const actor = tokenDoc.actor;

    // K.O. → bloqué
    if (actor?.system?.derived?.ko) {
      ui.notifications?.warn?.("K.O. — impossible de se déplacer.");
      return false; // annule le déplacement
    }

    // Pas son tour → bloqué
    const current = game.combat.combatant;
    if (current && current.tokenId !== tokenDoc.id) {
      ui.notifications?.warn?.("Ce n'est pas ton tour.");
      return false;
    }

    // Slot de déplacement épuisé → bloqué
    const budgetAPI = game.rpg?.budget;
    if (budgetAPI) {
      const budget = budgetAPI.getBudgetFor?.(game.combat, combatant.id);
      if (budget && !budgetAPI.canUseSlot(budget, "deplacement")) {
        ui.notifications?.warn?.("Slot de déplacement épuisé pour ce tour.");
        return false;
      }
    }

    // Vitesse dépassée → bloqué
    const gs = canvas.scene?.grid?.size ?? 100;
    const vitesse = Number(actor?.system?.deplacement?.vitesse ?? 3) || 3;
    const newX = changes.x ?? tokenDoc.x;
    const newY = changes.y ?? tokenDoc.y;
    const prevPos = _prevPos.get(tokenDoc.id) ?? { x: tokenDoc.x, y: tokenDoc.y };
    const distCases = Math.round(
      (Math.abs(newX - prevPos.x) + Math.abs(newY - prevPos.y)) / gs
    );
    if (distCases > vitesse) {
      ui.notifications?.warn?.(`Vitesse max ${vitesse} case${vitesse > 1 ? "s" : ""} — tu essaies de faire ${distCases} cases.`);
      return false;
    }
  }
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

  // ✅ Désengagement : si ce déplacement éloigne le mobile d'un ennemi qui
  // était adjacent (distance 1) avant et ne l'est plus après, propose une
  // attaque d'opportunité gratuite au MJ pour cet ennemi.
  const distCasesPx = (x1, y1, x2, y2) =>
    Math.round(Math.abs(x1 - x2) / gs) + Math.round(Math.abs(y1 - y2) / gs);

  const opportunityTargets = [];
  if (canvas?.tokens?.placeables) {
    for (const enemyTok of canvas.tokens.placeables) {
      const enemyActor = enemyTok.actor;
      if (!enemyActor || enemyActor.id === actor.id) continue;
      if (enemyActor.type === actor.type) continue; // même camp, pas un ennemi
      const enemyCombatant = combat.combatants.find(c => c.actorId === enemyActor.id);
      if (!enemyCombatant) continue; // pas dans ce combat
      if (enemyCombatant.getFlag("core", "defeated") || enemyCombatant.getFlag("rpg", "fled")) continue;

      const distBefore = distCasesPx(prevPos.x, prevPos.y, enemyTok.x, enemyTok.y);
      const distAfter  = distCasesPx(newX, newY, enemyTok.x, enemyTok.y);

      if (distBefore <= 1 && distAfter > 1) {
        opportunityTargets.push({ id: enemyActor.id, name: enemyActor.name });
      }
    }
  }

  const opportunityHtml = opportunityTargets.length
    ? `<div style="margin-top:8px;padding:6px;background:rgba(192,57,43,0.1);border-radius:6px">
         <div style="font-size:11px;font-weight:600;margin-bottom:4px">⚔️ Désengagement détecté — attaque d'opportunité disponible :</div>
         ${opportunityTargets.map(t => `
           <button type="button" class="rpg-opportunity-btn" data-enemy-id="${t.id}" data-mover-id="${actor.id}"
             style="display:block;width:100%;margin-bottom:4px;padding:4px;cursor:pointer;font-size:11px">
             ⚔️ ${htmlEscapeLocal(t.name)} attaque gratuitement ${htmlEscapeLocal(actor.name)}
           </button>`).join("")}
       </div>`
    : "";

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
      ${opportunityHtml}
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
 * Déclenche une attaque d'opportunité gratuite (pas de coût de slot) :
 * l'ennemi attaque immédiatement le mobile qui vient de se désengager.
 * Réutilise tout le pipeline d'attaque existant (jet à toucher, puis
 * Échec/Touché/Critique validés par le MJ comme une attaque normale).
 */
export async function triggerOpportunityAttack(enemyActorId, moverActorId) {
  if (!game.user.isGM) return;

  const enemyActor = game.actors.get(enemyActorId);
  const moverActor = game.actors.get(moverActorId);
  if (!enemyActor || !moverActor) {
    ui.notifications?.warn?.("Acteur introuvable pour l'attaque d'opportunité.");
    return;
  }

  const weapon = enemyActor.items.find(i => i.type === "weapon" && i.system?.equipe)
    ?? enemyActor.items.find(i => i.type === "weapon");
  if (!weapon) {
    ui.notifications?.warn?.(`${enemyActor.name} n'a aucune arme pour une attaque d'opportunité.`);
    return;
  }

  const combatAPI = game.rpg?.combat;
  const tnData = combatAPI?.computeTN
    ? combatAPI.computeTN(enemyActor, moverActor, weapon)
    : { tnFinal: 11, livraison: "physique" };

  const roll20 = await (new Roll("1d20")).evaluate();
  await roll20.toMessage({
    speaker: { alias: enemyActor.name },
    flavor: `⚔️ <b>Attaque d'opportunité</b> — ${enemyActor.name} attaque ${moverActor.name} qui se désengage (il faut faire <b>${tnData.tnFinal}+</b>)`
  });

  const actionId = foundry.utils.randomID(); // libre, pas lié au budget (gratuite)

  const msgContent = `
    <div class="rpg-attack-declare" style="font-size:13px;line-height:1.6">
      <div>Attaque d'opportunité : <b>${htmlEscapeLocal(weapon.name)}</b> → <b>${htmlEscapeLocal(moverActor.name)}</b></div>
      <div style="opacity:.85;margin-top:2px">🎲 d20 = <b>${roll20.total}</b> (TN ${tnData.tnFinal}+)</div>
      <div class="rpg-attack-gm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="rpg-attack-resolve" data-result="fail" style="flex:1;padding:4px 8px;cursor:pointer">Échec</button>
        <button type="button" class="rpg-attack-resolve" data-result="hit" style="flex:1;padding:4px 8px;cursor:pointer">Touché</button>
        <button type="button" class="rpg-attack-resolve" data-result="crit" style="flex:1;padding:4px 8px;cursor:pointer;font-weight:700;color:gold">Critique !</button>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: { alias: enemyActor.name },
    content: msgContent,
    flags: {
      rpg: {
        type: "attackDeclaration",
        actionId,
        attackDeclaration: {
          actorId: enemyActor.id, weaponId: weapon.id, targetId: moverActor.id,
          d20: roll20.total, tnFinal: tnData.tnFinal, livraison: tnData.livraison
        }
      }
    }
  });
}

export function bindOpportunityAttackButtons(htmlEl) {
  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;
  if (!game.user.isGM) {
    root.querySelectorAll(".rpg-opportunity-btn").forEach(b => b.remove());
    return;
  }

  root.querySelectorAll(".rpg-opportunity-btn").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      btn.disabled = true;
      btn.textContent += " (utilisée)";
      try {
        await triggerOpportunityAttack(btn.dataset.enemyId, btn.dataset.moverId);
      } catch (e) {
        console.error("[RPG][Opportunity]", e);
        ui.notifications?.error?.(`Erreur attaque d'opportunité : ${e?.message ?? e}`);
        btn.disabled = false;
      }
    });
  });
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
