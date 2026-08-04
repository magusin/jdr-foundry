// module/rules/remove-state.js
//
// « Retirer un état » — action de base (voir default-actions.js) qui laisse
// le personnage tenter de se défaire d'un état actif retirable par un jet.
//
// Suit le même schéma déclare → validation MJ → résolution que les sorts
// (spells.js) : deux messages liés (public + whisper MJ), une phase stockée
// dans les flags de chacun, mise à jour en place plutôt que republiée à
// chaque étape. Le TN n'est calculé qu'à la validation MJ (pas à la
// déclaration) pour refléter l'état de l'acteur au moment où ça compte —
// un buff/debuff de retrait posé entre-temps doit s'appliquer.

const FLAG_SCOPE = "rpg";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const DIFF_TN = {
  trivial: 6, facile: 9, moyen: 11, difficile: 14, tresDifficile: 17, quasiImpossible: 19
};

/** États actifs qu'on peut tenter de retirer par un jet (mêmes critères que l'ancienne macro dédiée). */
export function removableStates(actor) {
  return (actor?.system?.etatsActifs ?? []).filter(s =>
    !s.permanent && (s.removeDifficulty || s.removeBaseTN));
}

/** Modificateurs globaux au retrait : équipements équipés + états actifs. */
export function computeRemoveMods(actor) {
  let equipMod = 0;
  for (const item of actor.items) {
    if (item.system?.equipe) equipMod += n(item.system?.bonus?.retraitMod, 0);
  }
  let effectMod = 0;
  for (const s of (actor.system?.etatsActifs ?? [])) {
    effectMod += n(s.mods?.retraitMod?.flat, 0);
  }
  return { equipMod, effectMod };
}

/** TN final pour tenter de retirer un état donné (base + mods équip/effets + mod propre à l'état). */
export function computeStateTN(actor, state) {
  const baseTN = n(state.removeBaseTN, 0) || DIFF_TN[state.removeDifficulty] || 11;
  const stMod = n(state.retraitMod, 0);
  const { equipMod, effectMod } = computeRemoveMods(actor);
  return { baseTN, equipMod, effectMod, stMod, finalTN: baseTN + equipMod + effectMod + stMod };
}

function rollBonusFor(actor) {
  const endurance = n(actor.system?.derived?.effective?.principales?.endurance, 0);
  const volonte = n(actor.system?.skills?.survie?.level, 0);
  return Math.floor(endurance / 10) + volonte;
}

function gmUserIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/**
 * Contenu du message public (visible de tous), phase par phase :
 * - "pending"      : en attente de validation MJ, pas de jet possible
 * - "awaitingRoll" : validé, TN révélé, bouton "Lancer le dé" pour le joueur
 * - "ready"         : jet fait, en attente du verdict MJ
 * - "rejected"      : refusé par le MJ
 */
function publicContent(d, phase) {
  const header = `<div><b>${htmlEsc(d.actorName)}</b> tente de se défaire de <b>${htmlEsc(d.stateLabel)}</b></div>`;
  let footer;
  if (phase === "pending") {
    footer = `<div style="opacity:.8"><i>En attente de validation MJ.</i></div>`;
  } else if (phase === "awaitingRoll") {
    footer = `
      <div style="opacity:.8;margin-bottom:6px">
        <i>Validé par le MJ — il faut faire <b style="color:#e05a00;font-size:1.1em">${d.tnFinal}+</b> sur 1d20+${d.bonus}.</i>
      </div>
      <button type="button" class="rpg-removestate-roll-btn"
        style="width:100%;padding:6px 8px;cursor:pointer;border-radius:6px;font-weight:600">
        🎲 Lancer le dé
      </button>`;
  } else if (phase === "ready") {
    footer = `<div style="opacity:.8"><i>Jet fait — en attente du verdict du MJ.</i></div>`;
  } else {
    footer = `<div style="opacity:.75"><b>❌ Refusé par le MJ.</b></div>`;
  }
  return `<div class="rpg-removestate-declare">${header}${footer}</div>`;
}

/** Contenu du message MJ (whisper), phase par phase — voir publicContent. */
function gmContent(d, phase) {
  const header = `<div style="font-size:11px;color:#c8960a;font-weight:600;margin-bottom:6px">`
               + `⚙️ ${htmlEsc(d.actorName)} → Retirer un état : ${htmlEsc(d.stateLabel)}</div>`;

  if (phase === "pending") {
    return `<div class="rpg-removestate-declare rpg-removestate-gm">${header}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="rpg-removestate-confirm" data-ok="1"
          style="flex:1;padding:4px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-weight:600">✅ Valider</button>
        <button type="button" class="rpg-removestate-confirm" data-ok="0"
          style="flex:1;padding:4px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">❌ Refuser</button>
      </div></div>`;
  }
  if (phase === "awaitingRoll") {
    return `<div class="rpg-removestate-declare rpg-removestate-gm">${header}
      <div style="opacity:.8;font-size:12px">
        <i>Validé — TN <b>${d.tnFinal}+</b> (base ${d.baseTN}${d.equipMod ? `, équip ${d.equipMod > 0 ? "+" : ""}${d.equipMod}` : ""}${d.effectMod ? `, états ${d.effectMod > 0 ? "+" : ""}${d.effectMod}` : ""}${d.stMod ? `, état visé ${d.stMod > 0 ? "+" : ""}${d.stMod}` : ""}) — en attente du jet.</i>
      </div></div>`;
  }
  if (phase === "ready") {
    const hit = n(d.rollTotal, 0) >= n(d.tnFinal, 11);
    return `<div class="rpg-removestate-declare rpg-removestate-gm">${header}
      <div style="opacity:.85;font-size:12px;margin-bottom:6px">Jet : <b>${d.rollTotal}</b> vs TN <b>${d.tnFinal}+</b></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="rpg-removestate-resolve" data-result="fail"
          style="flex:1;padding:4px;cursor:pointer;border-radius:5px">❌ Persiste</button>
        <button type="button" class="rpg-removestate-resolve" data-result="success"
          style="flex:1;padding:4px;cursor:pointer;border-radius:5px;${hit ? "background:rgba(29,158,117,0.2)" : ""}">✅ Retiré</button>
      </div></div>`;
  }
  // "rejected"
  return `<div class="rpg-removestate-declare rpg-removestate-gm">${header}
    <div style="font-size:12px;opacity:.75">❌ Refusé.</div></div>`;
}

/**
 * Étape 1 — le joueur choisit, parmi ses états actifs, lequel tenter de
 * retirer. Poste la déclaration (publique + whisper MJ) ; aucun jet ici.
 */
export async function declareRemoveState(actor) {
  if (!actor) return { handled: true, ok: false, reason: "Acteur introuvable." };

  const states = removableStates(actor);
  if (!states.length) {
    return { handled: true, ok: false, reason: `${actor.name} n'a aucun état qui peut être retiré par un jet.` };
  }

  const options = states.map(s => {
    const { finalTN } = computeStateTN(actor, s);
    return `<option value="${htmlEsc(s.id)}">${htmlEsc(s.label)} (TN estimé ${finalTN}+)</option>`;
  }).join("");

  const DialogV2 = foundry.applications.api.DialogV2;
  let stateId = null;
  try {
    stateId = await DialogV2.wait({
      window: { title: "Retirer un état" },
      content: `
        <div style="display:flex;flex-direction:column;gap:8px;padding:4px">
          <label style="font-weight:700">État à tenter de retirer</label>
          <select name="state" style="width:100%">${options}</select>
        </div>`,
      modal: true,
      rejectClose: false,
      buttons: [
        { action: "ok", label: "Déclarer", default: true,
          callback: (event, button) => button.form?.elements?.state?.value ?? null },
        { action: "cancel", label: "Annuler", callback: () => null }
      ]
    });
  } catch (e) {
    console.warn("[RPG] choix état à retirer :", e);
  }
  if (!stateId) return { handled: true, ok: false, reason: "Annulé." };

  const state = states.find(s => s.id === stateId);
  if (!state) return { handled: true, ok: false, reason: "État introuvable." };

  const d = {
    actorId: actor.id, actorName: actor.name,
    stateId: state.id, stateLabel: state.label,
    bonus: rollBonusFor(actor)
  };

  const speaker = ChatMessage.getSpeaker({ actor });
  const msg = await ChatMessage.create({
    speaker, content: publicContent(d, "pending"),
    flags: { rpg: { removeStateFlow: { ...d, phase: "pending" } } }
  });
  const gmMsg = await ChatMessage.create({
    speaker, content: gmContent(d, "pending"),
    whisper: gmUserIds(),
    flags: { rpg: { removeStateFlow: { ...d, phase: "pending", linkedPublicId: msg.id } } }
  });
  await msg.update({ "flags.rpg.removeStateFlow.linkedGmId": gmMsg.id });

  return { handled: true, ok: true };
}

/**
 * Étape 2 — le MJ valide ou refuse la tentative (avant tout jet). Le TN est
 * calculé ICI, pas à la déclaration, pour refléter l'état de l'acteur au
 * moment de la validation.
 */
export async function confirmRemoveDeclaration(message, approve) {
  if (!game.user.isGM) return;

  const flags = message?.flags?.rpg ?? {};
  const d = flags.removeStateFlow ?? {};
  const publicMsg = d.linkedPublicId ? game.messages.get(d.linkedPublicId) : null;

  if (!approve) {
    await message.update({ content: gmContent(d, "rejected"), "flags.rpg.removeStateFlow.phase": "rejected" });
    if (publicMsg) await publicMsg.update({ content: publicContent(d, "rejected"), "flags.rpg.removeStateFlow.phase": "rejected" });
    return;
  }

  const actor = game.actors.get(d.actorId);
  const state = (actor?.system?.etatsActifs ?? []).find(s => s.id === d.stateId);
  if (!actor || !state) {
    await message.update({ content: gmContent(d, "rejected"), "flags.rpg.removeStateFlow.phase": "rejected" });
    if (publicMsg) await publicMsg.update({ content: publicContent(d, "rejected"), "flags.rpg.removeStateFlow.phase": "rejected" });
    return;
  }

  const { baseTN, equipMod, effectMod, stMod, finalTN } = computeStateTN(actor, state);
  const newD = { ...d, baseTN, equipMod, effectMod, stMod, tnFinal: finalTN };

  await message.update({ content: gmContent(newD, "awaitingRoll"), "flags.rpg.removeStateFlow": { ...newD, phase: "awaitingRoll" } });
  if (publicMsg) await publicMsg.update({ content: publicContent(newD, "awaitingRoll"), "flags.rpg.removeStateFlow": { ...newD, phase: "awaitingRoll", linkedGmId: d.linkedGmId ?? message.id } });
}

/**
 * Étape 3 — le joueur lance son jet, une fois la déclaration validée par le
 * MJ. Le résultat n'applique rien tout seul : il ouvre le verdict MJ
 * (Persiste/Retiré) sur le message whisper lié.
 */
export async function rollRemoveDie(message) {
  const flags = message?.flags?.rpg ?? {};
  const d = flags.removeStateFlow ?? {};
  if (d.phase !== "awaitingRoll") return;

  const actor = game.actors.get(d.actorId);
  const tn = n(d.tnFinal, 11);
  const bonus = n(d.bonus, 0);
  const roll = await (new Roll(`1d20 + ${bonus}`)).evaluate();
  const hit = roll.total >= tn;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `🌀 <b>${actor?.name ?? "?"}</b> résiste à <b>${htmlEsc(d.stateLabel)}</b> (1d20+${bonus} vs TN ${tn}+)`
  });

  const newD = { ...d, rollTotal: roll.total };
  await message.update({
    content: publicContent(newD, "ready"),
    "flags.rpg.removeStateFlow": { ...newD, phase: "ready" }
  });

  const gmMsg = d.linkedGmId ? game.messages.get(d.linkedGmId) : null;
  if (gmMsg) {
    await gmMsg.update({
      content: gmContent(newD, "ready"),
      "flags.rpg.removeStateFlow": { ...newD, phase: "ready" }
    });
  }
}

/**
 * Étape 4 — verdict du MJ : retire réellement l'état de l'acteur en cas de
 * succès, ou le laisse persister.
 */
export async function resolveRemoveFromMessage(message, result) {
  if (!game.user.isGM) return;

  const flags = message?.flags?.rpg ?? {};
  const d = flags.removeStateFlow ?? {};
  const actor = game.actors.get(d.actorId);
  const publicMsg = d.linkedPublicId ? game.messages.get(d.linkedPublicId) : null;
  const success = result === "success";

  if (success && actor) {
    const list = (actor.system?.etatsActifs ?? []).filter(s => s.id !== d.stateId);
    await actor.update({ "system.etatsActifs": list });
  }

  await message.delete();
  await publicMsg?.delete().catch(() => {});

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: success
      ? `✅ <b>${actor?.name ?? "?"}</b> se défait de <b>${htmlEsc(d.stateLabel)}</b>.`
      : `❌ <b>${actor?.name ?? "?"}</b> n'arrive pas à se défaire de <b>${htmlEsc(d.stateLabel)}</b>.`
  });
}

/** Branche les boutons du flux dans le chat (déclaration/validation/résolution). */
export function bindRemoveStateChatButtons(htmlEl, message) {
  const data = message?.flags?.rpg?.removeStateFlow ?? null;
  if (!data) return;

  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;

  const phase = data.phase ?? "pending";

  if (phase === "pending") {
    if (!game.user.isGM) { root.querySelector(".rpg-removestate-gm")?.remove(); return; }
    if (root.dataset.rpgRemoveConfirmBound === "1") return;
    root.dataset.rpgRemoveConfirmBound = "1";
    const confirmBtns = root.querySelectorAll(".rpg-removestate-confirm");
    confirmBtns.forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (!game.user.isGM) return;
        confirmBtns.forEach(b => b.disabled = true);
        try {
          await confirmRemoveDeclaration(message, btn.dataset.ok === "1");
        } catch (e) {
          console.error("[RPG] validation retrait d'état :", e);
          ui.notifications.error("Erreur validation (voir console).");
          confirmBtns.forEach(b => b.disabled = false);
        }
      });
    });
    return;
  }

  if (phase === "awaitingRoll") {
    if (!game.user.isGM) root.querySelector(".rpg-removestate-gm")?.remove();
    const rollBtn = root.querySelector(".rpg-removestate-roll-btn:not([data-bound])");
    if (rollBtn) {
      rollBtn.dataset.bound = "1";
      rollBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        rollBtn.disabled = true;
        try {
          await rollRemoveDie(message);
        } catch (e) {
          console.error("[RPG] jet retrait d'état :", e);
          rollBtn.disabled = false;
        }
      });
    }
    return;
  }

  if (phase === "rejected") return;

  // ── phase "ready" : verdict MJ ──────────────────────────────────────────
  if (!game.user.isGM) { root.querySelector(".rpg-removestate-gm")?.remove(); return; }
  if (root.dataset.rpgRemoveResolveBound === "1") return;
  root.dataset.rpgRemoveResolveBound = "1";
  const resolveBtns = root.querySelectorAll(".rpg-removestate-resolve");
  resolveBtns.forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      resolveBtns.forEach(b => b.disabled = true);
      try {
        await resolveRemoveFromMessage(message, btn.dataset.result);
      } catch (e) {
        console.error("[RPG] résolution retrait d'état :", e);
        ui.notifications.error("Erreur résolution (voir console).");
        resolveBtns.forEach(b => b.disabled = false);
      }
    });
  });
}
