// module/rules/action-confirm.js
// Gestion MJ des boutons de confirmation/refus/undo dans le chat

import {
  getBudget, saveBudget, confirmSlot, releaseSlot,
  updateLogEntry, findLogEntry, undoAction
} from "./action-budget.js";
import { undoMovement } from "./movement-tracker.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Appelée dans renderChatMessageHTML.
 * Branche les boutons Confirmer / Refuser / Laisser corriger / Annuler.
 */
export function bindActionChatButtons(html, message) {
  const flags = message?.flags?.rpg ?? {};

  // ── Boutons de déclaration (pending) ───────────────────────────────────
  if (flags.pendingAction) {
    if (!game.user.isGM) {
      // Joueurs : masque les boutons MJ, affiche juste "en attente"
      html.querySelector?.(".rpg-action-gm-btns")
        ?.querySelectorAll("button")
        ?.forEach(b => { b.style.display = "none"; });
      return;
    }

    if (html.dataset?.rpgActionBound === "1") return;
    if (html instanceof HTMLElement) html.dataset.rpgActionBound = "1";
    else if (html.get) html.get(0).dataset.rpgActionBound = "1";

    const container = html instanceof HTMLElement ? html : html.get(0);

    container.querySelectorAll("[data-action-resolve]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;

        const result   = btn.dataset.actionResolve;   // "confirm" | "reject" | "correct" | "undo_move"
        const actionId = btn.dataset.actionId;

        for (const b of container.querySelectorAll("[data-action-resolve]"))
          b.disabled = true;

        try {
          // Cas spécial : undo_move → replacement token
          if (result === "undo_move") {
            const combat = game.combat;
            if (!combat) throw new Error("Aucun combat actif");
            const res = await undoMovement(combat, actionId);
            if (!res.ok) {
              ui.notifications?.warn?.(res.reason ?? "Impossible d'annuler le déplacement");
              for (const b of container.querySelectorAll("[data-action-resolve]")) b.disabled = false;
              return;
            }
            await message.delete().catch(() => {});
            await ChatMessage.create({
              content: `<span style="color:#888">↩️ Déplacement annulé par le MJ : <b>${res.label}</b></span>`
            });
            return;
          }

          await handlePendingAction(message, result, actionId);
        } catch (e) {
          console.error("[RPG][ActionConfirm]", e);
          ui.notifications?.error?.(`Erreur : ${e?.message ?? e}`);
          for (const b of container.querySelectorAll("[data-action-resolve]"))
            b.disabled = false;
        }
      });
    });
  }

  // ── Bouton Annuler (après confirmation) ────────────────────────────────
  if (flags.confirmedAction) {
    if (!game.user.isGM) return;

    const container = html instanceof HTMLElement ? html : html.get?.(0);
    if (!container) return;

    container.querySelectorAll("[data-action-undo]").forEach(btn => {
      if (btn.dataset.rpgUndoBound === "1") return;
      btn.dataset.rpgUndoBound = "1";

      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;

        const actionId = btn.dataset.actionId;
        btn.disabled   = true;

        try {
          const combat = game.combat;
          if (!combat) throw new Error("Aucun combat actif");

          const result = await undoAction(combat, actionId);
          if (!result.ok) {
            ui.notifications?.warn?.(result.reason ?? "Impossible d'annuler");
            btn.disabled = false;
            return;
          }

          if (result.errors?.length)
            ui.notifications?.warn?.(`Annulation partielle : ${result.errors.join(", ")}`);

          // Supprime ce message de confirmation et poste un message d'annulation
          await message.delete().catch(() => {});
          await ChatMessage.create({
            content: `<span style="color:#888">↩️ Action annulée par le MJ : <b>${result.label}</b></span>`
          });

        } catch (e) {
          console.error("[RPG][Undo]", e);
          ui.notifications?.error?.(`Erreur annulation : ${e?.message ?? e}`);
          btn.disabled = false;
        }
      });
    });
  }
}

/**
 * Traite la décision MJ (confirm / reject / correct) sur une action pending.
 */
async function handlePendingAction(message, result, actionId) {
  const flags  = message?.flags?.rpg ?? {};
  const combat = game.combat;
  if (!combat) throw new Error("Aucun combat actif");

  const found = findLogEntry(combat, actionId);
  if (!found) throw new Error("Entrée de log introuvable");

  const { combatantId, entry } = found;
  const budget = getBudget(combat, combatantId);

  if (result === "confirm") {
    // Confirme le slot → passe pending → used
    const newBudget = confirmSlot(budget, entry.slot);
    await saveBudget(combat, combatantId, newBudget);

    // Cas déplacement : juste confirmer le slot, pas d'effet à appliquer
    // (seul type encore géré par ce système générique — sorts et attaques
    // utilisent désormais leurs propres boutons dédiés Échec/Réussite/Crit)
    if (flags.pendingAction.type === "move") {
      await updateLogEntry(combat, actionId, { status: "confirmed" });
      await message.update({
        content: `<div style="font-size:13px;color:var(--color-text-secondary)">
          ✅ Déplacement confirmé — <b>${entry?.label ?? ""}</b>
          <div style="margin-top:6px;text-align:right">
            <button type="button" data-action-undo data-action-id="${actionId}"
              style="font-size:11px;padding:2px 8px;cursor:pointer;opacity:0.7">
              ↩️ Annuler ce déplacement
            </button>
          </div>
        </div>`,
        "flags.rpg.pendingAction": null,
        "flags.rpg.confirmedAction": true,
        "flags.rpg.actionId": actionId
      });
      return;
    }

    // Type inconnu : on confirme juste le slot sans action spécifique
    await updateLogEntry(combat, actionId, { status: "confirmed" });

  } else {
    // Refus ou correction → libère le slot pending
    const newBudget = releaseSlot(budget, entry.slot, false);
    await saveBudget(combat, combatantId, newBudget);
    await updateLogEntry(combat, actionId, {
      status: result === "reject" ? "rejected" : "corrected"
    });

    const actor = game.actors.get(entry.snapshot?.casterId ?? entry.actorId ?? "");
    const label = result === "reject"
      ? `❌ Action refusée — ${actor?.name ?? "?"}`
      : `↩️ Le MJ demande à <b>${actor?.name ?? "?"}</b> de choisir une autre action.`;

    await message.update({
      content: `<div style="font-size:13px;color:var(--color-text-secondary)">${label}</div>`,
      "flags.rpg.pendingAction": null
    });
  }
}

/**
 * Poste un message de résolution (après confirmation) avec bouton Annuler.
 */
export async function postConfirmedMessage(content, actionId) {
  const fullContent = `
    <div>
      ${content}
      <div style="margin-top:8px;text-align:right">
        <button type="button" data-action-undo data-action-id="${actionId}"
          style="font-size:11px;padding:2px 8px;cursor:pointer;opacity:0.7">
          ↩️ Annuler cette action
        </button>
      </div>
    </div>`;

  return ChatMessage.create({
    content: fullContent,
    flags: { rpg: { confirmedAction: true, actionId } }
  });
}

/**
 * Construit le HTML du message de déclaration pending (visible de tous,
 * boutons MJ visibles seulement pour le MJ via bindActionChatButtons).
 */
export function buildPendingMessage({ actor, label, slotLabel, slotIcon, detail, actionId, type, outcome }) {
  return `
    <div style="font-size:13px;line-height:1.6;padding:4px 0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="background:#f0a020;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">⏳ En attente</span>
        <span>${slotIcon ?? ""} <b>${slotLabel ?? ""}</b></span>
      </div>
      <b>${actor}</b> : ${label}
      ${detail ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${detail}</div>` : ""}
      <div class="rpg-action-gm-btns" style="display:flex;gap:6px;margin-top:8px">
        <button type="button" data-action-resolve="confirm" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-size:12px">
          ✅ Confirmer
        </button>
        <button type="button" data-action-resolve="correct" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#e0a020;color:#fff;border:none;border-radius:5px;font-size:12px">
          ↩️ Corriger
        </button>
        <button type="button" data-action-resolve="reject" data-action-id="${actionId}"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px;font-size:12px">
          ❌ Refuser
        </button>
      </div>
    </div>`;
}
