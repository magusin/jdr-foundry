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

  // Onglet Butin d'une fiche monstre ouvert : le drop alimente la table de
  // butin (probabilité/quantité/essais) au lieu d'ajouter l'objet à
  // l'inventaire du monstre — sinon impossible de constituer une table sans
  // taper les UUID à la main.
  if (sheetInstance._activeTab === "butin" && typeof sheetInstance.addLootEntryFromItem === "function") {
    await sheetInstance.addLootEntryFromItem(item);
    return;
  }

  // Item déjà présent sur CET acteur : pas de doublon (réordonnancement non géré ici)
  if (item.parent?.id === actor.id) return;

  // ✅ Synchro (armes/armures/sorts/consommables/recettes/loot) : activée
  // automatiquement AVANT de figer itemData (item.toObject() ci-dessous) —
  // voir send-item-dialog.js pour le même traitement sur le bouton
  // "Envoyer". Résilient à un échec (ex. source en lecture seule, comme un
  // pack de compendium verrouillé) : le drop crée quand même la copie,
  // juste sans lien de synchro dans ce cas précis.
  if (item.type !== "quest") {
    const { autoActivateItemSync } = await import("../rules/item-link.js");
    await autoActivateItemSync(item).catch(() => {});
  }

  const itemData = item.toObject();
  delete itemData._id;

  // ✅ Quête : distribGroupId dans tous les cas (traçabilité "qui a cette
  // quête", relu par la fiche source), + questGroupId si partagée
  // (synchronise la progression entre toutes les copies données).
  if (item.type === "quest") {
    const { ensureDistribGroupId, ensureQuestGroupId } = await import("../rules/quest-group.js");
    const distribId = await ensureDistribGroupId(item);
    if (distribId && itemData.system) itemData.system.distribGroupId = distribId;
    if (item.system?.partagee) {
      const gid = await ensureQuestGroupId(item);
      if (gid && itemData.system) itemData.system.questGroupId = gid;
    }
  }

  try {
    const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
    ui.notifications?.info?.(`"${created?.name ?? item.name}" ajouté à ${actor.name}.`);
  } catch (e) {
    console.error("[RPG] Drop : création de l'item embarqué a échoué.", e);
    ui.notifications?.error?.(`Impossible d'ajouter l'objet : ${e?.message ?? e}`);
  }
}

/**
 * Branche le drop d'un Item Foundry (compendium, inventaire d'un acteur,
 * barre d'items du monde...) sur la sheet d'un document QUELCONQUE (pas
 * forcément un acteur) sans créer de copie embarquée : le document résolu
 * est juste transmis à `onItemDropped`, à charge pour l'appelant de n'en
 * garder que l'UUID (ex: une référence de récompense sur une quête, comme
 * `addLootEntryFromItem` le fait déjà pour le butin d'un monstre, mais sans
 * l'ancrer à un acteur précis). GM only, cohérent avec isEditable.
 *
 * @param {DocumentSheetV2} sheetInstance
 * @param {HTMLElement} rootElement
 * @param {(item: Item) => Promise<void>|void} onItemDropped
 */
export function setupItemRefDrop(sheetInstance, rootElement, onItemDropped) {
  if (!rootElement) return null;

  const DragDropImpl = foundry.applications.ux.DragDrop?.implementation ?? foundry.applications.ux.DragDrop;
  if (!DragDropImpl) {
    console.warn("[RPG] DragDrop API introuvable — drop de référence désactivé.");
    return null;
  }

  if (sheetInstance._rpgRefDragDrop) {
    sheetInstance._rpgRefDragDrop.bind(rootElement);
    return sheetInstance._rpgRefDragDrop;
  }

  const dd = new DragDropImpl({
    dropSelector: null,
    permissions: { drop: () => game.user.isGM },
    callbacks: {
      drop: async (event) => {
        event.preventDefault();
        if (!game.user.isGM) return;

        let data;
        try {
          data = foundry.applications.ux.TextEditor?.implementation?.getDragEventData?.(event)
              ?? TextEditor.getDragEventData(event);
        } catch (e) {
          console.warn("[RPG] Drop référence : impossible de lire les données.", e);
          return;
        }
        if (!data || data.type !== "Item") return;

        let item;
        try {
          item = await Item.implementation.fromDropData(data);
        } catch (e) {
          console.error("[RPG] Drop référence : fromDropData a échoué.", e);
          ui.notifications?.error?.("Impossible de récupérer l'objet déposé.");
          return;
        }
        if (!item) {
          ui.notifications?.warn?.("Objet introuvable (UUID invalide ou compendium inaccessible).");
          return;
        }

        await onItemDropped(item);
      }
    }
  });

  dd.bind(rootElement);
  sheetInstance._rpgRefDragDrop = dd;
  return dd;
}
