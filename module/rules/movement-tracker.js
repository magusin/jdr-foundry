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

// ─────────────────────────────────────────────────────────────────────────────

export function getVitesse(actor) {
  return Number(actor?.system?.deplacement?.vitesse ?? 6) || 6;
}

/**
 * Allonge de menace au corps à corps d'un acteur, en mètres. Sert à savoir
 * jusqu'où il « engage » un adversaire (zone d'attaque d'opportunité).
 * = plus grande portée parmi ses armes ÉQUIPÉES de corps à corps (portée ≤ 3 m),
 * plancher à 1 m (menace à mains nues / au contact). Les armes à distance
 * (grande portée) ne comptent pas pour le désengagement.
 */
export function getMeleeReach(actor) {
  // Monstre : allonge propre (les monstres n'ont pas d'armes, juste des compétences)
  if (actor?.type === "monster") {
    return Math.max(0, Number(actor.system?.allonge ?? 1) || 1) || 1;
  }
  // Personnage : plus grande ALLONGE parmi les armes équipées de corps à corps
  // (allonge ≤ 3 m ; au-delà = arme à distance, pas de menace de mêlée).
  const MELEE_MAX = 3;
  let reach = 1; // menace minimale au contact (1 m, mains nues)
  try {
    const weapons = (actor?.items ?? []).filter(i => i.type === "weapon");
    const equipped = weapons.filter(w => w.system?.equipe);
    const pool = equipped.length ? equipped : weapons;
    for (const w of pool) {
      const a = Number(w.system?.allonge ?? w.system?.portee ?? 1) || 1;
      if (a <= MELEE_MAX && a > reach) reach = a;
    }
  } catch { /* défaut 1 m */ }
  return reach;
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
export function onPreUpdateToken(tokenDoc, changes, options) {
  if (options?.rpgNoTrack) return;              // déplacement interne (annulation) : ne pas suivre
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
      const typeLabel = mult < 1 ? ` (terrain ×${mult})` : "";
      ui.notifications?.warn?.(
        `Déplacement impossible — ${fmt(cost)} nécessaires${typeLabel} vs ${fmt(remaining)} restants ce tour.`
      );
      return false;
    }
  }
}

/**
 * Hook updateToken (GM) — crée le message avec debounce.
 */
export async function onUpdateToken(tokenDoc, changes, options) {
  if (options?.rpgNoTrack) return;              // déplacement interne (annulation) : ne pas recompter
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
  const opportunityTargets = [];
  if (canvas?.tokens?.placeables) {
    for (const enemyTok of canvas.tokens.placeables) {
      const ea = enemyTok.actor;
      if (!ea || ea.id === actor.id) continue;
      if (ea.type === actor.type) continue;
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

/** Laisse le MJ choisir la compétence d'un monstre (cooldown ignoré). null = annulé. */
async function _chooseOpportunityAbility(ea, ma, abilities) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const opts = abilities.map(a =>
    `<option value="${a.id}">${htmlEsc(a.name)}${a.type === "spell" ? " (compétence)" : " (arme)"}</option>`
  ).join("");
  const content = `
    <p><b>${htmlEsc(ea.name)}</b> peut réagir contre <b>${htmlEsc(ma.name)}</b> qui se désengage.</p>
    <p>Compétence à utiliser <i>(cooldown ignoré)</i> :</p>
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
    item = await _chooseOpportunityAbility(ea, ma, abilities);
    if (!item) return; // MJ a annulé
  } else {
    item = ea.items.find(i => i.type === "weapon" && i.system?.equipe)
        ?? ea.items.find(i => i.type === "weapon");
    if (!item) { ui.notifications?.warn?.(`${ea.name} n'a aucune arme.`); return; }
    if (!(await _confirmOpportunity(ea, ma, item))) return; // MJ a refusé
  }

  // ── Résolution — même mécanisme qu'une attaque normale, cooldown NON consommé ──
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
    flags: { rpg: { type: "attackDeclaration", actionId: foundry.utils.randomID(),
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
    if (td) await td.update({ x: snap.oldX, y: snap.oldY }, { rpgNoTrack: true });
  }
  const budget = getBudget(combat, combatantId);
  await saveBudget(combat, combatantId,
    releaseMovement(budget, snap.cost ?? 0, entry.status === "confirmed"));
  await updateLogEntry(combat, actionId, { status: "undone" });
  return { ok: true, label: entry.label ?? "Déplacement" };
}
