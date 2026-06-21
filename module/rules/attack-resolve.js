// module/rules/attack-resolve.js
//
// Gestion côté MJ des boutons Échec / Touché / Critique dans les messages
// de déclaration d'attaque physique (type "attackDeclaration").
//
// Flow : le joueur ne lance QUE le d20 de touché à la déclaration. Les dégâts
// ne sont lancés qu'ICI, après que le MJ a tranché Échec/Touché/Critique —
// cohérent avec le flow des sorts (on ne sait pas combien on fait avant
// de savoir si on touche). Le MJ choisit librement, le d20/TN affichés ne
// sont qu'une indication.

const MISS_MESSAGES_MELEE = [
  "{target} esquive l'attaque au dernier moment !",
  "{target} pare le coup avec son arme !",
  "{attacker} rate sa cible de peu !",
  "{target} dévie l'attaque !",
  "Le coup glisse sur l'armure de {target} sans porter !",
  "{target} fait un pas de côté, évitant l'attaque !"
];

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function formatTemplate(template, attackerName, targetName) {
  return template.replace("{attacker}", attackerName).replace("{target}", targetName || "la cible");
}

/**
 * Confirme le slot de budget (pending -> confirmed) pour un actionId donné.
 * Utilisé pour échec ET réussite — l'action a été tentée dans tous les cas.
 */
async function confirmBudgetSlot(actionId) {
  if (!actionId || !game.combat) return;
  try {
    const { updateLogEntry, confirmSlot, getBudget, saveBudget, findLogEntry } = await import("./action-budget.js");
    const found = findLogEntry(game.combat, actionId);
    if (found) {
      const { combatantId } = found;
      const budget    = getBudget(game.combat, combatantId);
      const slot      = found.entry.slot ?? "attaque";
      const newBudget = confirmSlot(budget, slot);
      await saveBudget(game.combat, combatantId, newBudget);
      await updateLogEntry(game.combat, actionId, { status: "confirmed" });
    }
  } catch (e) { /* ignore si pas de budget actif */ }
}

/**
 * Appelée dans renderChatMessageHTML. Branche les 3 boutons Échec/Touché/Critique
 * directement (même pattern que bindSpellChatButtons) — masqués pour les joueurs,
 * désactivés une fois la résolution faite.
 */
export function bindAttackChatButtons(htmlEl, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "attackDeclaration") return;

  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;

  // Joueurs : on retire la zone GM
  if (!game.user.isGM) {
    root.querySelector(".rpg-attack-gm")?.remove();
    return;
  }

  // Anti double-bind si Foundry re-render
  if (root.dataset.rpgAttackBound === "1") return;
  root.dataset.rpgAttackBound = "1";

  if (flags.resolved) {
    root.querySelectorAll(".rpg-attack-resolve").forEach(b => { b.disabled = true; b.style.opacity = "0.4"; });
    return;
  }

  const buttons = root.querySelectorAll(".rpg-attack-resolve");
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!game.user.isGM) return;

      const result = btn.dataset.result; // "fail" | "hit" | "crit" | "critfail"
      if (!result) return;

      for (const b of buttons) b.disabled = true;
      try {
        const res = await resolveAttack(message, result, { actionId: flags.actionId ?? null });
        if (!res) {
          // Annulé (ex: MJ a fermé le dialog Échec Critique sans valider) -> on réactive
          for (const b of buttons) b.disabled = false;
        }
      } catch (e) {
        console.error("[RPG][AttackResolve]", e);
        ui.notifications?.error?.(`Erreur résolution attaque : ${e?.message ?? e}`);
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}

/**
 * Résout l'attaque : sur échec, message aléatoire (paré/esquivé/raté), pas de dégâts.
 * Sur touché/critique : lance les dégâts MAINTENANT (pas avant), applique mitigation,
 * retire les PV, affiche le détail complet (jet, bonus, mitigation, final).
 * Confirme le slot de budget dans tous les cas (échec compris).
 */
export async function resolveAttack(message, result, { actionId = null } = {}) {
  if (!game.user.isGM) return;

  const f = message?.flags?.rpg?.attackDeclaration ?? message?.flags?.rpg ?? {};
  const attacker = game.actors.get(f.actorId);
  const target   = game.actors.get(f.targetId);
  const weapon   = attacker?.items.get(f.weaponId);

  const attackerName = attacker?.name ?? "?";
  const targetName   = target?.name ?? "?";

  const realActionId = actionId ?? message?.flags?.rpg?.pendingAction?.actionId ?? null;

  let content = "";

  if (result === "fail") {
    const msgTemplate = pickRandom(MISS_MESSAGES_MELEE);
    content = `<b style="color:#c0392b">✗ ÉCHEC</b> — ${formatTemplate(msgTemplate, attackerName, targetName)}`;

  } else if (result === "critfail") {
    const { promptCritFailConsequence } = await import("./critfail-dialog.js");
    const choice = await promptCritFailConsequence({ kind: "attack", actorName: attackerName });
    if (!choice) return null; // MJ a annulé — ne rien faire, garder le message en attente

    let selfDmgLine = "";
    if (choice.selfDamage > 0 && attacker) {
      const pvCur = n(attacker.system?.ressources?.pv?.valeur, 0);
      const pvMax = n(attacker.system?.ressources?.pv?.max, 0);
      const pvNew = Math.max(0, pvCur - choice.selfDamage);
      await attacker.update({ "system.ressources.pv.valeur": pvNew });
      selfDmgLine = `<br>${attackerName} subit <b>${choice.selfDamage}</b> dégâts (${pvCur} → <b>${pvNew}</b>/${pvMax} PV)`;
    }

    content = `<b style="color:#8b1a12">☠ ÉCHEC CRITIQUE</b> — ${choice.label}${selfDmgLine}`;

  } else {
    const isCrit = result === "crit";

    if (!weapon || !attacker) {
      content = `<b style="color:#c0392b">Erreur</b> — arme ou attaquant introuvable, impossible de lancer les dégâts.`;
    } else {
      // ── Lance les dégâts MAINTENANT (après décision MJ) ──────────────
      const dmgResult = await weapon.rollDamage({
        attackerActor: attacker,
        targetActor:   target ?? null,
        isCrit,
        type:          String(f.livraison ?? "physique")
      });

      let pvLine = "";
      if (target) {
        const pvCur = n(target.system?.ressources?.pv?.valeur, 0);
        const pvMax = n(target.system?.ressources?.pv?.max, 0);
        const pvNew = Math.max(0, pvCur - dmgResult.final);
        await target.update({ "system.ressources.pv.valeur": pvNew });
        pvLine = `<br>${targetName} : ${pvCur} → <b>${pvNew}</b> / ${pvMax} PV`;
      }

      const label = isCrit ? "✦ CRITIQUE !" : "✔ TOUCHÉ";
      const col   = isCrit ? "gold" : "#27ae60";

      const bonusLine = `🎲 Jet brut : <b>${dmgResult.rollTotal}</b> + bonus stat <b>${dmgResult.statBonus}</b>` +
        (dmgResult.critBonus ? ` + bonus crit <b>${dmgResult.critBonus}</b>` : "");

      const mitigLine = (dmgResult.fixe || dmgResult.pct)
        ? `🛡️ Mitigation : −${dmgResult.fixe} fixe, −${dmgResult.pct}%`
        : `🛡️ Aucune mitigation`;

      content =
        `<b style="color:${col}">${label}</b> — ${attackerName} touche ${targetName} avec <b>${weapon.name}</b><br>` +
        `${bonusLine}<br>` +
        `${mitigLine}<br>` +
        `💥 Dégâts bruts : ${dmgResult.beforeMitigation} → <b>Final : ${dmgResult.final}</b>` +
        pvLine;
    }
  }

  // Confirme le slot de budget (échec compris : l'action a été tentée)
  await confirmBudgetSlot(realActionId);

  await message.delete();

  const resolMsg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: content +
      (realActionId ? `<div style="margin-top:6px;text-align:right"><button type="button" data-action-undo data-action-id="${realActionId}" style="font-size:11px;padding:2px 8px;cursor:pointer;opacity:0.7">↩️ Annuler</button></div>` : ""),
    flags: realActionId ? { rpg: { confirmedAction: true, actionId: realActionId } } : {}
  });

  return { content, messageId: resolMsg.id };
}
