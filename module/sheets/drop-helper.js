// module/sheets/drop-helper.js
//
// Foundry V13 : les sheets DocumentSheetV2 (contrairement aux anciennes ActorSheet)
// ne gèrent PAS le drag&drop d'item automatiquement. Il faut le brancher
// explicitement via foundry.applications.ux.DragDrop et l'API getDragEventData.
//
// Réutilisé par character-sheet-v2.js et monster-sheet-v2.js.

/**
 * Branche le drop d'item sur l'élément racine d'une sheet d'acteur.
 * GM only par design (cohérent avec isEditable des sheets RPG).
 *
 * @param {DocumentSheetV2} sheetInstance - this depuis _onRender
 * @param {HTMLElement} rootElement       - this.element
 */
export function setupActorItemDrop(sheetInstance, rootElement) {
  if (!rootElement) return null;

  const DragDropImpl = foundry.applications.ux.DragDrop?.implementation ?? foundry.applications.ux.DragDrop;
  if (!DragDropImpl) {
    console.warn("[RPG] DragDrop API introuvable — drop d'item désactivé.");
    return null;
  }

  // Évite de rebind plusieurs fois sur re-render
  if (sheetInstance._rpgDragDrop) {
    sheetInstance._rpgDragDrop.bind(rootElement);
    return sheetInstance._rpgDragDrop;
  }

  const dd = new DragDropImpl({
    dropSelector: null, // toute la fenêtre de la sheet est une zone de drop
    permissions: {
      drop: () => game.user.isGM
    },
    callbacks: {
      drop: (event) => onDropItem(sheetInstance, event)
    }
  });

  dd.bind(rootElement);
  sheetInstance._rpgDragDrop = dd;
  return dd;
}

/**
 * Handler de drop générique : crée une copie de l'item dans l'inventaire
 * de l'acteur cible. Fonctionne pour les drops venant :
 * - d'un compendium (Spell, Armes, Armure, Objet...)
 * - de la barre d'items du monde (sidebar)
 * - d'un autre acteur (transfert : copie, ne retire pas l'original)
 */
async function onDropItem(sheetInstance, event) {
  event.preventDefault();
  if (!game.user.isGM) return;

  let data;
  try {
    data = foundry.applications.ux.TextEditor?.implementation?.getDragEventData?.(event)
        ?? TextEditor.getDragEventData(event);
  } catch (e) {
    console.warn("[RPG] Drop : impossible de lire les données.", e);
    return;
  }

  if (!data || data.type !== "Item") return;

  const actor = sheetInstance.document;
  if (!actor) return;

  let item;
  try {
    item = await Item.implementation.fromDropData(data);
  } catch (e) {
    console.error("[RPG] Drop : fromDropData a échoué.", e);
    ui.notifications?.error?.("Impossible de récupérer l'objet déposé.");
    return;
  }
  if (!item) {
    ui.notifications?.warn?.("Objet introuvable (UUID invalide ou compendium inaccessible).");
    return;
  }

  // Item déjà présent sur CET acteur : pas de doublon (réordonnancement non géré ici)
  if (item.parent?.id === actor.id) return;

  const itemData = item.toObject();
  delete itemData._id;

  // ✅ Quête partagée : assure un questGroupId commun pour synchroniser
  // la progression entre toutes les copies données à différents PJ
  if (item.type === "quest" && item.system?.partagee) {
    const { ensureQuestGroupId } = await import("../rules/quest-group.js");
    const gid = await ensureQuestGroupId(item);
    if (gid && itemData.system) itemData.system.questGroupId = gid;
  }

  try {
    const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
    ui.notifications?.info?.(`"${created?.name ?? item.name}" ajouté à ${actor.name}.`);
  } catch (e) {
    console.error("[RPG] Drop : création de l'item embarqué a échoué.", e);
    ui.notifications?.error?.(`Impossible d'ajouter l'objet : ${e?.message ?? e}`);
  }
}
