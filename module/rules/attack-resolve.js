// module/rules/attack-resolve.js
//
// Gestion côté MJ des boutons Échec / Touché / Critique dans les messages
// de déclaration d'attaque physique (type "attackDeclaration").
//
// Flow : le joueur ne lance QUE le d20 de touché à la déclaration. Sur
// touché/critique, le MJ ne fait que trancher — c'est ensuite au JOUEUR de
// cliquer pour lancer son jet de dégâts (message "attackDamageRoll"), même
// principe que le d20 de touché. Une fois ce jet lancé, l'application aux PV
// de la cible attend encore un clic MJ supplémentaire sur « Appliquer les
// dégâts » — voir applyAttackDamage.

import { hpSecret } from "./chat-visibility.js";
import { confirmAttackDeclaration, rollAttackDie } from "./attack-declare.js";

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

/**
 * Applique les effets d'une arme à la cible touchée.
 *
 * Chaque effet porte un déclencheur `when` :
 *   - "hit"  : touche normale — un critique la déclenche aussi
 *   - "crit" : uniquement sur coup critique
 * Le DOT vaut base + (stat de l'attaquant ÷ per), figé au moment du coup.
 *
 * @returns {Promise<string[]>} lignes à afficher dans le message de résolution
 */
async function applyWeaponEffects({ weapon, attacker, target, isCrit }) {
  const list = Array.isArray(weapon?.system?.effects) ? weapon.system.effects : [];
  if (!list.length || !target) return [];

  // "hit" = toute touche réussie (critique compris)
  // "hitOnly" = touche normale seulement, "crit" = critique seulement
  const allowed = new Set(isCrit ? ["hit", "crit"] : ["hit", "hitonly"]);
  const rows = [];

  const effP = attacker?.system?.derived?.effective?.principales
            ?? attacker?.system?.principales ?? {};

  const states = Array.isArray(target.system?.etatsActifs)
    ? foundry.utils.deepClone(target.system.etatsActifs) : [];

  for (const fx of list) {
    if (!allowed.has(String(fx?.when ?? "hit").toLowerCase())) continue;

    const label = String(fx?.label ?? weapon.name ?? "Effet").trim() || "Effet";
    const duration = Math.max(1, n(fx?.duration, 1));

    // La nature (dégâts / soin) est explicite ; la quantité reste positive.
    // En interne un perTick négatif = soin. Ancien format sans `mode` :
    // on garde le signe de la base pour ne rien casser.
    const base = n(fx?.dot?.base, 0);
    const stat = String(fx?.dot?.stat ?? "").trim();
    const per  = Math.max(1, n(fx?.dot?.per, 10) || 10);
    const bonus = stat ? Math.floor(n(effP?.[stat], 0) / per) : 0;
    const mode = String(fx?.dot?.mode ?? "").toLowerCase();
    let perTick;
    if (mode === "none") perTick = 0;
    else if (mode === "damage") perTick = Math.abs(base) + Math.abs(bonus);
    else if (mode === "heal")   perTick = -(Math.abs(base) + Math.abs(bonus));
    else perTick = base + bonus; // ancien format signé

    const id = `weapon_${weapon.id}_${fx?.id ?? label}_${target.id}`;
    const state = {
      id, label, type: "weaponEffect",
      duration, remaining: duration,
      cleanseDC: Math.max(0, n(fx?.cleanseDC, 0)),
      dot: { flat: perTick, perTick, formula: "", fatiguePerTick: 0 },
      mods: {}
    };

    const idx = states.findIndex(s => String(s?.id) === id);
    if (idx >= 0) states[idx] = { ...states[idx], ...state };
    else states.push(state);

    rows.push(`✨ <b>${label}</b> → ${target.name}${perTick ? ` (${perTick > 0 ? `${perTick} dég` : `${Math.abs(perTick)} soin`}/tour)` : ""} — ${duration} tour(s)${isCrit && String(fx?.when).toLowerCase() === "crit" ? " <i>(crit)</i>" : ""}`);
  }

  if (rows.length) {
    await target.update({ "system.etatsActifs": states });
    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(target);
  }
  return rows;
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
 * Augmente la fatigue de l'attaquant (action confirmée = effort physique).
 *
 * Le coût vient du champ « Coût fatigue » de l'arme employée : une masse
 * lourde n'épuise pas comme une dague. Une arme qui n'a pas encore ce champ
 * (créée avant son ajout) ou une attaque à mains nues retombe sur le réglage
 * de monde « Fatigue — attaque ». Avec deux armes, les deux coûts s'additionnent
 * — manier les deux fatigue plus que manier une seule.
 */
async function bumpFatigue(actor, weapon = null, offhand = null) {
  if (!actor) return;
  try {
    const { incrementFatigue, actionFatigueCost } = await import("./action-budget.js");
    const costOf = (w) => {
      const own = w?.system?.fatigueCost;
      return (own === undefined || own === null || own === "")
        ? actionFatigueCost("attaque")
        : Math.max(0, Number(own) || 0);
    };
    const amount = costOf(weapon) + (offhand ? costOf(offhand) : 0);
    await incrementFatigue(actor, amount);
  } catch (e) { /* ignore */ }
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

  const phase = flags.phase ?? "pending";

  // ── Phase "pending" : le MJ valide ou annule l'action, avant tout jet ──
  if (phase === "pending") {
    if (!game.user.isGM) {
      root.querySelector(".rpg-attack-gm-confirm")?.remove();
      return;
    }
    if (root.dataset.rpgAttackConfirmBound === "1") return;
    root.dataset.rpgAttackConfirmBound = "1";

    const confirmBtns = root.querySelectorAll(".rpg-attack-confirm");
    confirmBtns.forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;
        confirmBtns.forEach(b => b.disabled = true);
        try {
          await confirmAttackDeclaration(message, btn.dataset.ok === "1");
        } catch (e) {
          console.error("[RPG][AttackConfirm]", e);
          ui.notifications?.error?.(`Erreur validation attaque : ${e?.message ?? e}`);
          confirmBtns.forEach(b => b.disabled = false);
        }
      });
    });
    return;
  }

  // ── Phase "confirmed" : le joueur lance son jet de touché ───────────────
  if (phase === "confirmed") {
    const btn = root.querySelector(".rpg-roll-d20-attack:not([data-bound])");
    if (!btn) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      btn.disabled = true;
      try {
        await rollAttackDie(message);
      } catch (e) {
        console.error("[RPG][AttackRoll]", e);
        ui.notifications?.error?.(`Erreur jet de touché : ${e?.message ?? e}`);
        btn.disabled = false;
      }
    });
    return;
  }

  // ── Phase "rolled" : boutons Échec critique/Échec/Touché/Critique (MJ) ──
  if (phase === "rolled") {
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
    return;
  }

  // ── Message "attackDamageRoll" : le joueur lance son jet de dégâts ──────
  if (flags.type === "attackDamageRoll") {
    const btn = root.querySelector(".rpg-roll-damage-attack:not([data-bound])");
    if (!btn) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      btn.disabled = true;
      try {
        await rollAttackDamage(message);
      } catch (e) {
        console.error("[RPG][AttackDamageRoll]", e);
        ui.notifications?.error?.(`Erreur jet de dégâts : ${e?.message ?? e}`);
        btn.disabled = false;
      }
    });
    return;
  }

  // ── Message "attackDamagePending" : bouton MJ « Appliquer les dégâts » ──
  if (flags.type === "attackDamagePending") {
    if (!game.user.isGM) {
      root.querySelector(".rpg-attack-apply")?.remove();
      return;
    }
    if (root.dataset.rpgAttackApplyBound === "1") return;
    root.dataset.rpgAttackApplyBound = "1";

    if (flags.applied) {
      root.querySelectorAll(".rpg-attack-apply-btn").forEach(b => { b.disabled = true; b.style.opacity = "0.4"; });
      return;
    }

    const applyBtn = root.querySelector(".rpg-attack-apply-btn");
    applyBtn?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!game.user.isGM) return;
      applyBtn.disabled = true;
      try {
        await applyAttackDamage(message);
      } catch (e) {
        console.error("[RPG][AttackApplyDamage]", e);
        ui.notifications?.error?.(`Erreur application des dégâts : ${e?.message ?? e}`);
        applyBtn.disabled = false;
      }
    });
  }
}

/**
 * Résout l'attaque : sur échec, message aléatoire (paré/esquivé/raté), pas de dégâts.
 * Sur touché/critique : lance les dégâts MAINTENANT (pas avant), applique mitigation,
 * affiche le détail complet (jet, bonus, mitigation, final) — mais laisse les PV
 * intacts jusqu'à ce que le MJ clique sur « Appliquer les dégâts » (voir applyAttackDamage).
 * Confirme le slot de budget dans tous les cas (échec compris).
 */
export async function resolveAttack(message, result, { actionId = null } = {}) {
  if (!game.user.isGM) return;

  const f = message?.flags?.rpg?.attackDeclaration ?? message?.flags?.rpg ?? {};
  const attacker = game.actors.get(f.actorId);
  const target   = game.actors.get(f.targetId);
  // resolveWeapon gère le cas « Mains nues » : arme reconstruite à la volée,
  // absente de l'inventaire.
  const { resolveWeapon } = await import("./unarmed.js");
  const weapon   = resolveWeapon(attacker, f.weaponId);

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
      // ── Le MJ a tranché : au JOUEUR de lancer son jet de dégâts ──────
      // On ne lance rien ici. La fatigue/le slot de budget sont confirmés
      // tout de suite (l'action a été tentée, indépendamment du jet de
      // dégâts à venir), puis on poste un message avec un bouton que le
      // joueur clique lui-même — même principe que le d20 de touché.
      const label = isCrit ? "✦ CRITIQUE !" : "✔ TOUCHÉ";
      const col   = isCrit ? "gold" : "#27ae60";

      await confirmBudgetSlot(realActionId);
      await bumpFatigue(attacker, weapon, f.offhandId ? resolveWeapon(attacker, f.offhandId) : null);

      await message.delete();

      const rollContent =
        `<b style="color:${col}">${label}</b> — ${attackerName} touche ${targetName} avec <b>${weapon.name}</b>` +
        `<div style="font-size:11px;opacity:.7;margin-top:2px">En attente du jet de dégâts du joueur.</div>` +
        `<div class="rpg-attack-damage-roll" style="margin-top:8px">` +
        `<button type="button" class="rpg-roll-damage-attack" style="width:100%;padding:6px 8px;cursor:pointer;border-radius:6px;font-weight:600">🎲 Lancer les dégâts</button>` +
        `</div>`;

      const rollMsg = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: rollContent,
        flags: {
          rpg: {
            type: "attackDamageRoll",
            label, col,
            attackerId: attacker.id,
            targetId: target?.id ?? null,
            weaponId: weapon.id,
            offhandId: f.offhandId ?? null,
            isCrit,
            livraison: f.livraison,
            actionId: realActionId
          }
        }
      });

      return { content: rollContent, messageId: rollMsg.id };
    }
  }

  // Confirme le slot de budget (échec compris : l'action a été tentée)
  await confirmBudgetSlot(realActionId);
  await bumpFatigue(attacker, weapon, f.offhandId ? resolveWeapon(attacker, f.offhandId) : null);

  await message.delete();

  const resolMsg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: content +
      (realActionId ? `<div style="margin-top:6px;text-align:right"><button type="button" data-action-undo data-action-id="${realActionId}" style="font-size:11px;padding:2px 8px;cursor:pointer;opacity:0.7">↩️ Annuler</button></div>` : ""),
    flags: realActionId ? { rpg: { confirmedAction: true, actionId: realActionId } } : {}
  });

  return { content, messageId: resolMsg.id };
}

/**
 * Le joueur lance son jet de dégâts, une fois que le MJ a tranché Touché/
 * Critique sur le message "attackDamageRoll" créé par resolveAttack.
 * N'importe qui peut cliquer (même permissivité que rollAttackDie) : le jet
 * reste public. Une fois lancé, poste le message "attackDamagePending" avec
 * le bouton MJ « Appliquer les dégâts » (voir applyAttackDamage) — l'appli-
 * cation aux PV reste un clic MJ distinct.
 */
export async function rollAttackDamage(message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "attackDamageRoll") return;

  const attacker = game.actors.get(flags.attackerId);
  const target   = flags.targetId ? game.actors.get(flags.targetId) : null;
  const { resolveWeapon } = await import("./unarmed.js");
  const weapon = resolveWeapon(attacker, flags.weaponId);

  const attackerName = attacker?.name ?? "?";
  const targetName   = target?.name ?? "?";

  if (!weapon || !attacker) {
    await message.update({
      content: `<b style="color:#c0392b">Erreur</b> — arme ou attaquant introuvable, impossible de lancer les dégâts.`
    });
    return null;
  }

  const isCrit = !!flags.isCrit;
  const dmgResult = await weapon.rollDamage({
    attackerActor: attacker,
    targetActor:   target ?? null,
    isCrit,
    type:          String(flags.livraison ?? weapon.system?.livraison ?? "physique"),
    offhand:       flags.offhandId ? resolveWeapon(attacker, flags.offhandId) : null
  });

  const label = flags.label ?? (isCrit ? "✦ CRITIQUE !" : "✔ TOUCHÉ");
  const col   = flags.col ?? (isCrit ? "gold" : "#27ae60");

  const bonusLine = `🎲 Jet brut : <b>${dmgResult.rollTotal}</b> + bonus stat <b>${dmgResult.statBonus}</b>` +
    (dmgResult.critBonus ? ` + bonus crit <b>${dmgResult.critBonus}</b>` : "") +
    (dmgResult.offhandTotal
      ? `<br>🗡️ ${dmgResult.offhandName} (${dmgResult.offhandDie}) : <b>${dmgResult.offhandTotal}</b> — dé seul`
      : "");

  const mitigLine = (dmgResult.fixe || dmgResult.pct)
    ? `🛡️ Mitigation : −${dmgResult.fixe} fixe, −${dmgResult.pct}%`
    : `🛡️ Aucune mitigation`;

  const baseContent =
    `<b style="color:${col}">${label}</b> — ${attackerName} touche ${targetName} avec <b>${weapon.name}</b><br>` +
    `${bonusLine}<br>` +
    `${mitigLine}<br>` +
    `💥 Dégâts bruts : ${dmgResult.beforeMitigation} → <b>Final : ${dmgResult.final}</b>`;

  await message.delete();

  const pendingMsg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: baseContent +
      `<div style="font-size:11px;opacity:.7;margin-top:2px">En attente de la validation du MJ pour appliquer les dégâts.</div>` +
      `<div class="rpg-attack-apply" style="margin-top:8px">` +
      `<button type="button" class="rpg-attack-apply-btn" style="width:100%;padding:6px 8px;cursor:pointer;border-radius:6px;font-weight:600;background:#c0392b;color:#fff;border:none">💥 Appliquer les dégâts</button>` +
      `</div>`,
    flags: {
      rpg: {
        type: "attackDamagePending",
        baseContent,
        attackerId: attacker.id,
        targetId: target?.id ?? null,
        weaponId: weapon.id,
        offhandId: flags.offhandId ?? null,
        isCrit,
        final: dmgResult.final,
        actionId: flags.actionId ?? null
      }
    }
  });

  return { content: baseContent, messageId: pendingMsg.id };
}

/**
 * Applique réellement les dégâts (retire les PV, déclenche les effets d'arme)
 * une fois que le MJ a cliqué sur « Appliquer les dégâts » du message
 * "attackDamagePending" créé par resolveAttack. Sépare le jet (visible dès
 * Touché/Critique) de son application, pour laisser le MJ vérifier le
 * résultat avant de le faire encaisser à la cible.
 */
export async function applyAttackDamage(message) {
  if (!game.user.isGM) return;

  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "attackDamagePending" || flags.applied) return;

  const attacker = game.actors.get(flags.attackerId);
  const target   = flags.targetId ? game.actors.get(flags.targetId) : null;
  const { resolveWeapon } = await import("./unarmed.js");
  const weapon = resolveWeapon(attacker, flags.weaponId);

  let pvLine = "";
  if (target) {
    const pvCur = n(target.system?.ressources?.pv?.valeur, 0);
    const pvMax = n(target.system?.ressources?.pv?.max, 0);
    const pvNew = Math.max(0, pvCur - n(flags.final, 0));
    await target.update({ "system.ressources.pv.valeur": pvNew });
    pvLine = hpSecret(target, `<br>${target.name} : ${pvCur} → <b>${pvNew}</b> / ${pvMax} PV`);
  }

  // Effets de l'arme (déclencheur touche normale / critique uniquement)
  let fxLines = [];
  try {
    fxLines = await applyWeaponEffects({ weapon, attacker, target, isCrit: !!flags.isCrit });
  } catch (e) {
    console.warn("[RPG] effets d'arme :", e);
  }

  const finalContent = flags.baseContent +
    pvLine +
    (fxLines.length ? `<br>${fxLines.join("<br>")}` : "") +
    (flags.actionId ? `<div style="margin-top:6px;text-align:right"><button type="button" data-action-undo data-action-id="${flags.actionId}" style="font-size:11px;padding:2px 8px;cursor:pointer;opacity:0.7">↩️ Annuler</button></div>` : "");

  await message.update({
    content: finalContent,
    "flags.rpg.applied": true
  });

  return { content: finalContent, messageId: message.id };
}
