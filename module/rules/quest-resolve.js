// module/rules/quest-resolve.js
//
// Résolution d'une quête (réussite/échec) par le MJ : octroie XP + objets
// de récompense en cas de réussite, met à jour le statut, consigne au
// journal de campagne. Si la quête est partagée (questGroupId), la même
// résolution + récompenses s'appliquent à TOUS les PJ qui ont une copie.

import { propagateQuestUpdate } from "./quest-group.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Applique la résolution (statut + récompenses) à UN seul PJ/copie.
 * Retourne les lignes de récap pour ce PJ.
 */
async function applyOutcomeTo(actor, questItem, success) {
  const statut = success ? "reussie" : "echouee";
  await questItem.update({ "system.statut": statut });

  const lines = [];

  if (success) {
    const xp = n(questItem.system?.recompense?.xp, 0);
    if (xp > 0) {
      const curXp = n(actor.system?.xp?.valeur, 0);
      await actor.update({ "system.xp.valeur": curXp + xp });
      lines.push(`+${xp} XP`);
    }

    const rewardItems = Array.isArray(questItem.system?.recompense?.items) ? questItem.system.recompense.items : [];
    for (const ri of rewardItems) {
      const uuid = String(ri.uuid ?? "").trim();
      if (!uuid) continue;
      try {
        const src = await fromUuid(uuid);
        if (!src) { lines.push(`⚠️ Objet introuvable (${ri.name || uuid})`); continue; }
        const data = src.toObject();
        delete data._id;
        if (data.system) data.system.qte = Math.max(1, n(ri.qty, 1));
        const [created] = await actor.createEmbeddedDocuments("Item", [data]);
        lines.push(`🎁 ${created.name} ×${Math.max(1, n(ri.qty, 1))}`);
      } catch (e) {
        lines.push(`⚠️ Erreur objet (${ri.name || uuid})`);
      }
    }
  }

  return lines;
}

export async function resolveQuest(actor, questItem, { success } = {}) {
  if (!game.user.isGM) return { ok: false, reason: "Réservé au MJ." };
  if (!actor || !questItem) return { ok: false, reason: "Acteur ou quête introuvable." };

  const perActorLines = [{ actorName: actor.name, lines: await applyOutcomeTo(actor, questItem, success) }];

  // ✅ Quête partagée : applique la MÊME résolution + récompenses à chaque
  // PJ qui a une copie de cette quête (questGroupId commun)
  const gid = String(questItem.system?.questGroupId ?? "").trim();
  if (gid) {
    const { findGroupQuestItems } = await import("./quest-group.js");
    const others = findGroupQuestItems(gid, questItem.uuid);
    for (const otherItem of others) {
      const otherActor = otherItem.parent;
      if (!otherActor) continue;
      const lines = await applyOutcomeTo(otherActor, otherItem, success);
      perActorLines.push({ actorName: otherActor.name, lines });
    }
  }

  const blockFor = (entry) => `<b>${entry.actorName}</b>${entry.lines.length ? `<br>${entry.lines.join("<br>")}` : ""}`;

  const content = `
    <div style="font-size:13px">
      <span style="background:${success ? "#1d9e75" : "#c0392b"};color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">
        ${success ? "✅ QUÊTE RÉUSSIE" : "❌ QUÊTE ÉCHOUÉE"}
      </span>
      <br><b>${questItem.name}</b><br><br>
      ${perActorLines.map(blockFor).join("<br><br>")}
    </div>`;

  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });

  if (game.rpg?.journal) {
    const allNames = perActorLines.map(e => e.actorName).join(", ");
    game.rpg.journal.appendToCampaignJournal(
      `<b>${allNames}</b> ${success ? "a terminé" : "a échoué"} la quête <b>${questItem.name}</b>.`
    ).catch(() => {});
  }

  return { ok: true, perActorLines };
}
