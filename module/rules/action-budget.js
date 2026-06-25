// module/rules/action-budget.js
// Budget d'actions par tour + log undo

const SCOPE       = "rpg";
const FLAG_BUDGET = "actionBudget";
const FLAG_LOG    = "actionLog";

/**
 * Augmente la fatigue d'un acteur de `amount` (clampée au max courant).
 * Appelée à chaque action confirmée par le MJ (attaque, sort, déplacement) —
 * c'est la fatigue physique/mentale de l'effort, pas un coût "magique".
 */
export async function incrementFatigue(actor, amount = 1) {
  if (!actor) return;
  const cur = Number(actor.system?.ressources?.fatigue?.valeur ?? 0) || 0;
  const max = Number(actor.system?.ressources?.fatigue?.max ?? 10) || 10;
  const next = Math.min(max, cur + amount);
  if (next === cur) return;
  await actor.update({ "system.ressources.fatigue.valeur": next });
}

// ── Définition des slots ──────────────────────────────────────────────────
export const SLOT_DEFS = {
  deplacement: { label: "Déplacement", icon: "🏃", max: 1 },
  attaque:     { label: "Attaque",     icon: "⚔️",  max: 1 },
  sortNormal:  { label: "Sort normal", icon: "✨", max: 1 },
  sortRapide:  { label: "Sort rapide", icon: "⚡",  max: 2 }
};

const TOTAL_SLOTS = 2;

// ── Helpers internes ──────────────────────────────────────────────────────
function freshBudget() {
  return {
    slotsTotal:  { max: TOTAL_SLOTS, used: 0, pending: 0 },
    deplacement: { max: 1, used: 0, pending: 0 },
    attaque:     { max: 1, used: 0, pending: 0 },
    sortNormal:  { max: 1, used: 0, pending: 0 },
    sortRapide:  { max: 2, used: 0, pending: 0 }
  };
}

function getAllBudgets(combat) {
  return foundry.utils.deepClone(combat.getFlag(SCOPE, FLAG_BUDGET) ?? {});
}

function getAllLogs(combat) {
  return foundry.utils.deepClone(combat.getFlag(SCOPE, FLAG_LOG) ?? {});
}

// ── API Budget ────────────────────────────────────────────────────────────

export function getBudget(combat, combatantId) {
  return foundry.utils.deepClone(
    combat.getFlag(SCOPE, FLAG_BUDGET)?.[combatantId] ?? freshBudget()
  );
}

export async function saveBudget(combat, combatantId, budget) {
  const all = getAllBudgets(combat);
  all[combatantId] = budget;
  await combat.setFlag(SCOPE, FLAG_BUDGET, all);
}

export async function resetBudget(combat, combatantId) {
  const allB = getAllBudgets(combat);
  const allL = getAllLogs(combat);
  allB[combatantId] = freshBudget();
  allL[combatantId] = [];
  await combat.update({
    [`flags.${SCOPE}.${FLAG_BUDGET}`]: allB,
    [`flags.${SCOPE}.${FLAG_LOG}`]:    allL
  });
}

/**
 * Vérifie si un slot peut être utilisé (pending inclus dans "used" logique).
 */
export function canUseSlot(budget, slot) {
  const totalUsed = (budget.slotsTotal.used ?? 0) + (budget.slotsTotal.pending ?? 0);
  if (totalUsed >= budget.slotsTotal.max) return false;
  const s = budget[slot];
  if (!s) return false;
  const slotUsed = (s.used ?? 0) + (s.pending ?? 0);
  return slotUsed < s.max;
}

/**
 * Réserve un slot (pending — en attente de confirmation MJ).
 * Retourne le nouveau budget sans le sauvegarder.
 */
export function reserveSlot(budget, slot) {
  const b = foundry.utils.deepClone(budget);
  b.slotsTotal.pending = (b.slotsTotal.pending ?? 0) + 1;
  if (b[slot]) b[slot].pending = (b[slot].pending ?? 0) + 1;
  return b;
}

/**
 * Confirme un slot pending → passe en used.
 */
export function confirmSlot(budget, slot) {
  const b = foundry.utils.deepClone(budget);
  b.slotsTotal.pending = Math.max(0, (b.slotsTotal.pending ?? 0) - 1);
  b.slotsTotal.used    = (b.slotsTotal.used ?? 0) + 1;
  if (b[slot]) {
    b[slot].pending = Math.max(0, (b[slot].pending ?? 0) - 1);
    b[slot].used    = (b[slot].used ?? 0) + 1;
  }
  return b;
}

/**
 * Libère un slot pending ou used (refus / undo).
 */
export function releaseSlot(budget, slot, wasConfirmed = false) {
  const b = foundry.utils.deepClone(budget);
  if (wasConfirmed) {
    b.slotsTotal.used = Math.max(0, (b.slotsTotal.used ?? 0) - 1);
    if (b[slot]) b[slot].used = Math.max(0, (b[slot].used ?? 0) - 1);
  } else {
    b.slotsTotal.pending = Math.max(0, (b.slotsTotal.pending ?? 0) - 1);
    if (b[slot]) b[slot].pending = Math.max(0, (b[slot].pending ?? 0) - 1);
  }
  return b;
}

/**
 * HTML compact du budget pour affichage dans le menu combat.
 */
export function budgetHTML(budget) {
  const totalUsed    = (budget.slotsTotal.used ?? 0) + (budget.slotsTotal.pending ?? 0);
  const totalMax     = budget.slotsTotal.max;
  const slotsLeft    = totalMax - totalUsed;
  const slotColor    = slotsLeft === 0 ? "#c0392b" : slotsLeft === 1 ? "#e0a020" : "#1d9e75";

  const rows = Object.entries(SLOT_DEFS).map(([key, def]) => {
    const s   = budget[key] ?? { max: def.max, used: 0, pending: 0 };
    const rem = s.max - (s.used ?? 0) - (s.pending ?? 0);
    const col = rem === 0 ? "#c0392b" : (s.pending ?? 0) > 0 ? "#e0a020" : "#1d9e75";
    const dots = Array.from({ length: s.max }, (_, i) => {
      const idx = i;
      let fill = "#ddd";
      if (idx < (s.used ?? 0)) fill = "#c0392b";
      else if (idx < (s.used ?? 0) + (s.pending ?? 0)) fill = "#e0a020";
      else fill = "#1d9e75";
      return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${fill};margin:0 1px"></span>`;
    }).join("");
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
      <span>${def.icon}</span>
      <span style="flex:1;color:var(--color-text-secondary)">${def.label}</span>
      <span>${dots}</span>
      <span style="color:${col};font-weight:500;min-width:28px;text-align:right">${rem}/${s.max}</span>
    </div>`;
  }).join("");

  return `
    <div style="border:1px solid var(--color-border-tertiary);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:var(--color-background-secondary)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:500">Actions du tour</span>
        <span style="font-size:12px;font-weight:700;color:${slotColor}">${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} restant${slotsLeft !== 1 ? "s" : ""}</span>
      </div>
      ${rows}
    </div>`;
}

// ── API Log ───────────────────────────────────────────────────────────────

export function getLog(combat, combatantId) {
  return foundry.utils.deepClone(
    combat.getFlag(SCOPE, FLAG_LOG)?.[combatantId] ?? []
  );
}

export async function addLogEntry(combat, combatantId, entry) {
  const all = getAllLogs(combat);
  if (!all[combatantId]) all[combatantId] = [];
  all[combatantId].push(entry);
  await combat.setFlag(SCOPE, FLAG_LOG, all);
}

export async function updateLogEntry(combat, actionId, updates) {
  const all = getAllLogs(combat);
  for (const entries of Object.values(all)) {
    const idx = entries.findIndex(e => e.id === actionId);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], ...updates };
      await combat.setFlag(SCOPE, FLAG_LOG, all);
      return true;
    }
  }
  return false;
}

export function findLogEntry(combat, actionId) {
  const all = combat.getFlag(SCOPE, FLAG_LOG) ?? {};
  for (const [combatantId, entries] of Object.entries(all)) {
    const entry = (entries ?? []).find(e => e.id === actionId);
    if (entry) return { combatantId, entry: foundry.utils.deepClone(entry) };
  }
  return null;
}

// ── Undo ─────────────────────────────────────────────────────────────────

/**
 * Annule une action confirmée : restaure le snapshot et libère le slot.
 * Retourne { ok, errors, label }
 */
export async function undoAction(combat, actionId) {
  if (!game.user.isGM) return { ok: false, reason: "Réservé au MJ" };

  const found = findLogEntry(combat, actionId);
  if (!found) return { ok: false, reason: "Action introuvable dans le log" };

  const { combatantId, entry } = found;
  if (entry.status !== "confirmed")
    return { ok: false, reason: `Impossible d'annuler (statut : ${entry.status})` };

  const snap   = entry.snapshot ?? {};
  const errors = [];

  // 1. Restaure mana du lanceur
  if (snap.casterId !== undefined && snap.casterMana !== undefined) {
    const caster = game.actors.get(snap.casterId);
    if (caster) {
      await caster.update({ "system.ressources.mana.valeur": snap.casterMana });
    } else {
      errors.push("Lanceur introuvable pour restaurer le mana");
    }
  }

  // 2. Restaure PV de la/des cible(s)
  if (Array.isArray(snap.targetsSnapshot) && snap.targetsSnapshot.length) {
    // ✅ Multi-cible : restaure les PV de CHAQUE cible touchée par le sort
    for (const ts of snap.targetsSnapshot) {
      const target = game.actors.get(ts.targetId);
      if (target) {
        await target.update({ "system.ressources.pv.valeur": ts.targetPv });
      } else {
        errors.push(`Cible introuvable pour restaurer les PV (${ts.targetId})`);
      }
    }
  } else if (snap.targetId !== undefined && snap.targetPv !== undefined) {
    // Rétrocompat : ancien format mono-cible
    const target = game.actors.get(snap.targetId);
    if (target) {
      await target.update({ "system.ressources.pv.valeur": snap.targetPv });
    } else {
      errors.push("Cible introuvable pour restaurer les PV");
    }
  }

  // 2b. Restaure position token (déplacement)
  if (snap.tokenId !== undefined && snap.oldX !== undefined && snap.oldY !== undefined) {
    try {
      const tokenDoc = canvas?.scene?.tokens?.get(snap.tokenId)
                    ?? game.scenes.active?.tokens?.get(snap.tokenId);
      if (tokenDoc) {
        await tokenDoc.update({ x: snap.oldX, y: snap.oldY });
      } else {
        errors.push("Token introuvable pour restaurer la position");
      }
    } catch (e) {
      errors.push(`Erreur restauration position : ${e?.message}`);
    }
  }

  // 2c. Restaure état passif (toggle)
  if (snap.passifItemId !== undefined && snap.casterId !== undefined) {
    const caster = game.actors.get(snap.casterId);
    const passifItem = caster?.items.get(snap.passifItemId);
    if (passifItem) {
      await passifItem.update({ "system.aura.active": !!snap.oldAuraActive });
    }
  }

  // 3. Supprime les états ajoutés (multi-cible : un retrait par {actorId, stateId})
  if (Array.isArray(snap.addedStates) && snap.addedStates.length) {
    // Regroupe par acteur pour ne mettre à jour chaque acteur qu'une fois
    const byActor = new Map();
    for (const { actorId, stateId } of snap.addedStates) {
      if (!byActor.has(actorId)) byActor.set(actorId, []);
      byActor.get(actorId).push(stateId);
    }
    for (const [actorId, stateIds] of byActor.entries()) {
      const affected = game.actors.get(actorId);
      if (!affected) { errors.push(`Acteur introuvable pour retirer un effet (${actorId})`); continue; }
      const next = (affected.system?.etatsActifs ?? [])
        .filter(s => !stateIds.includes(s.id));
      await affected.update({ "system.etatsActifs": next });
    }
  } else if (snap.addedStateIds?.length) {
    // Rétrocompat (ancien format mono-acteur, jamais réellement rempli historiquement)
    const actorId  = snap.statesAppliedTo ?? snap.targetId ?? snap.casterId;
    const affected = game.actors.get(actorId);
    if (affected) {
      const next = (affected.system?.etatsActifs ?? [])
        .filter(s => !snap.addedStateIds.includes(s.id));
      await affected.update({ "system.etatsActifs": next });
    }
  }

  // 4. Restaure cooldown
  if (snap.cooldown?.itemId && snap.casterId) {
    const caster = game.actors.get(snap.casterId);
    const item   = caster?.items.get(snap.cooldown.itemId);
    if (item) {
      const r = snap.cooldown.oldRestant ?? 0;
      await item.update({ "system.cooldown.restant": r, "system.recharge.restant": r });
    }
  }

  // 5. Libère le slot budget
  const budget     = getBudget(combat, combatantId);
  const newBudget  = releaseSlot(budget, entry.slot, true);
  await saveBudget(combat, combatantId, newBudget);

  // 6. Marque l'entrée comme annulée
  await updateLogEntry(combat, actionId, { status: "undone" });

  // 7. Supprime le message de résolution
  if (entry.resolutionMessageId) {
    const msg = game.messages.get(entry.resolutionMessageId);
    if (msg) await msg.delete().catch(() => {});
  }

  return { ok: true, errors, label: entry.label ?? "Action" };
}
