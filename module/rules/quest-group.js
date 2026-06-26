// module/rules/quest-group.js
//
// Quêtes partagées entre plusieurs PJ : chaque PJ a sa propre copie de
// l'item (nécessaire pour qu'elle apparaisse dans son inventaire), mais
// toutes les copies d'une même quête partagée portent le même
// 'questGroupId' — ça permet de synchroniser la progression (étape,
// statut, récompenses) sur toutes les copies à la fois.

/**
 * Si l'item est une quête marquée 'partagée' sans questGroupId, en génère
 * un et le persiste sur l'item source. Retourne le groupId à utiliser
 * pour les copies, ou null si la quête n'est pas partagée.
 */
export async function ensureQuestGroupId(item) {
  if (!item || item.type !== "quest") return null;
  if (!item.system?.partagee) return null;

  let gid = String(item.system?.questGroupId ?? "").trim();
  if (!gid) {
    gid = foundry.utils.randomID(12);
    await item.update({ "system.questGroupId": gid });
  }
  return gid;
}

/**
 * Trouve toutes les copies (embarquées sur un acteur) d'une quête partagée
 * portant ce questGroupId, à l'exclusion de l'item donné en référence.
 */
export function findGroupQuestItems(groupId, excludeUuid = null) {
  if (!groupId) return [];
  const found = [];
  for (const actor of game.actors) {
    for (const it of actor.items) {
      if (it.type !== "quest") continue;
      if (String(it.system?.questGroupId ?? "").trim() !== String(groupId)) continue;
      if (excludeUuid && it.uuid === excludeUuid) continue;
      found.push(it);
    }
  }
  return found;
}

/**
 * Propage une mise à jour (étape, statut...) à toutes les autres copies
 * d'une même quête partagée. N'a aucun effet si la quête n'est pas
 * partagée (questGroupId vide).
 */
export async function propagateQuestUpdate(quest, updates) {
  const gid = String(quest?.system?.questGroupId ?? "").trim();
  if (!gid) return [];

  const others = findGroupQuestItems(gid, quest.uuid);
  for (const other of others) {
    await other.update(updates).catch(() => {});
  }
  return others;
}
