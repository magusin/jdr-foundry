// module/sheets/item-recipe-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { applyUiTheme, applySheetViewMode, bindImageEditors, restoreScrollPositions, uniqueSheetOptions } from "./sheet-helpers.js";
import { bindSendToActorsButton, bindLinkSyncCheckbox } from "./send-item-dialog.js";
import { setupItemRefDrop } from "./drop-helper.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Empreinte « quel objet est-ce ? » d'un item déposé, telle que forge.js la
 * relira dans le sac d'un acteur : la source de compendium quand il y en a
 * une, l'UUID du pack quand l'item déposé EST l'entrée de compendium.
 * Vide pour un item du monde — son nom reste alors le seul repère, ce qui
 * est exactement le comportement historique des recettes.
 */
function dropSourceOf(item) {
  const src = String(item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "").trim();
  if (src) return src;
  return item?.pack ? String(item.uuid ?? "") : "";
}

/** Ingrédient normalisé — un tableau saisi à la main n'a que {name, qty}. */
function normalizeIngredient(raw) {
  const ing = (typeof raw === "string") ? { name: raw } : (raw ?? {});
  return {
    name:   String(ing.name ?? ""),
    qty:    Math.max(1, Number(ing.qty ?? 1) || 1),
    uuid:   String(ing.uuid ?? ""),
    source: String(ing.source ?? ""),
    img:    String(ing.img ?? ""),
    type:   String(ing.type ?? "")
  };
}

export class RPGRecipeSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";


  /**
   * Un id de fenêtre UNIQUE par document — voir uniqueSheetOptions() : sans
   * lui, ouvrir une deuxième fiche du même type arrache du DOM la fenêtre de
   * la première, qui devient alors impossible à rouvrir sans erreur visible.
   */
  _initializeApplicationOptions(options) {
    return uniqueSheetOptions(super._initializeApplicationOptions(options), options,
                              "rpg-recipe-sheet-v2");
  }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ["rpg", "rpg-sheet", "sheet", "item", "recipe"],
    position: { width: 500, height: 620 },
    window: { contentClasses: ["rpg-sheet-window"], resizable: true },
    form: {
      closeOnSubmit: false,
      submitOnChange: true,
      handler: async function (event, form, formData, options) {
        await this._onFormSubmitV2(event, form, formData, options);
      }
    },
    actions: {
      addIngredient:    async function (e) { await this._actionAddIngredient(e); },
      removeIngredient: async function (e) { await this._actionRemoveIngredient(e); },
    }
  }, { inplace: false });

  static PARTS = foundry.utils.mergeObject(super.PARTS ?? {}, {
    form: { id: "form", template: "systems/rpg/templates/item/item-recipe-sheet.hbs", scrollable: [".sheet-body"] }
  }, { inplace: false });

  get isEditable() { return game.user.isGM; }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const item = this.document;
    ctx.item   = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});
    const ingRaw = ctx.system.ingredients;
    const ingList = Array.isArray(ingRaw) ? ingRaw
                  : (ingRaw && typeof ingRaw === "object") ? Object.values(ingRaw) : [];
    ctx.system.ingredients = ingList.map(normalizeIngredient);
    ctx.system.result      = ctx.system.result ?? { uuid: "", name: "", img: "" };
    ctx.system.result.img  = String(ctx.system.result.img ?? "");
    ctx.system.difficulte  = Number(ctx.system.difficulte ?? 0) || 0;
    ctx.system.description = String(ctx.system.description ?? "");
    ctx.canEdit = this.isEditable;
    ctx.isGM    = game.user.isGM;
    return ctx;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    bindImageEditors(root, this.document);
    applyUiTheme(root);
    restoreScrollPositions(root);
    applySheetViewMode(root, { isGM: game.user.isGM });
    bindSendToActorsButton(root, this.document);
    bindLinkSyncCheckbox(root, this.document);

    // ── Glisser-déposer d'un objet ───────────────────────────────────────
    // Toute la fiche accepte un item : c'est le geste de loin le plus
    // fréquent (ajouter un ingrédient). La carte « Résultat » intercepte le
    // sien avant qu'il ne remonte jusqu'ici — même montage que la fiche de
    // quête, dont le Récit intercepte le drop destiné aux récompenses.
    if (game.user.isGM) {
      setupItemRefDrop(this, root, (item) => this._addIngredientFromDrop(item));
      this._bindResultDropZone(root);
    }

    // ── Clic sur bouton "Voir" (UUID) → ouvre la fiche de l'item ──────────
    root.querySelectorAll(".rpg-open-uuid").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const uuid = btn.dataset.uuid;
        if (!uuid) return;
        try {
          const doc = await fromUuid(uuid);
          if (doc?.sheet) doc.sheet.render(true);
          else ui.notifications?.warn?.("Objet introuvable pour cet UUID.");
        } catch(e) {
          ui.notifications?.error?.(`UUID invalide : ${uuid}`);
        }
      });
    });

    // ── Bouton "Apprendre la recette" ───────────────────────────────────
    root.querySelectorAll(".rpg-learn-recipe").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const item = this.document;

        // Sélecteur de personnage
        const pjs = game.actors.filter(a => a.type === "character");
        if (!pjs.length) { ui.notifications?.warn?.("Aucun personnage trouvé."); return; }

        const options = pjs.map(a =>
          `<option value="${a.id}">${a.name}</option>`
        ).join("");

        const result = await new Promise(resolve => {
          new Dialog({
            title: "Apprendre la recette",
            content: `
              <div style="display:flex;flex-direction:column;gap:10px;padding:4px">
                <div>Ajouter <b>${item.name}</b> à l'inventaire de :</div>
                <select id="learn-target" style="width:100%">${options}</select>
              </div>`,
            buttons: {
              ok: {
                label: "📚 Donner la recette",
                callback: (html) => resolve(html[0]?.querySelector("#learn-target")?.value)
              },
              cancel: { label: "Annuler", callback: () => resolve(null) }
            },
            default: "ok"
          }).render(true);
        });

        if (!result) return;
        const actor = game.actors.get(result);
        if (!actor) return;

        // Vérifie si l'acteur a déjà cette recette
        const already = actor.items.find(i => i.type === "recipe" && i.name === item.name);
        if (already) {
          ui.notifications?.warn?.(`${actor.name} possède déjà la recette "${item.name}".`);
          return;
        }

        const itemData = item.toObject();
        delete itemData._id;
        await actor.createEmbeddedDocuments("Item", [itemData]);
        ui.notifications?.info?.(`✅ "${item.name}" ajoutée à l'inventaire de ${actor.name}.`);
        await ChatMessage.create({
          content: `📚 <b>${actor.name}</b> apprend la recette <b>${item.name}</b>.`
        });
      });
    });
  }

  /**
   * Dépôt d'un item sur la carte « Résultat » : renseigne l'UUID de l'objet
   * à créer au lieu de l'ajouter aux ingrédients. stopPropagation est
   * indispensable — sans lui le drop remonterait jusqu'au DragDrop posé sur
   * toute la fiche et l'objet serait AUSSI ajouté comme ingrédient.
   */
  _bindResultDropZone(root) {
    const zone = root.querySelector(".rpg-recipe-result");
    if (!zone || zone.dataset.rpgResultDrop) return;
    zone.dataset.rpgResultDrop = "1";

    zone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      zone.classList.add("rpg-drop-hover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("rpg-drop-hover"));
    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      zone.classList.remove("rpg-drop-hover");
      if (!game.user.isGM) return;

      const item = await this._itemFromDropEvent(ev);
      if (item) await this._setResultFromDrop(item);
    });
  }

  /** Item Foundry résolu depuis un évènement de drop, ou null. */
  async _itemFromDropEvent(ev) {
    let data;
    try {
      data = foundry.applications.ux.TextEditor?.implementation?.getDragEventData?.(ev)
          ?? TextEditor.getDragEventData(ev);
    } catch (e) {
      console.warn("[RPG] Recette : drop illisible.", e);
      return null;
    }
    if (!data || data.type !== "Item") return null;

    try {
      const item = await Item.implementation.fromDropData(data);
      if (!item) ui.notifications?.warn?.("Objet introuvable (UUID invalide ou compendium inaccessible).");
      return item ?? null;
    } catch (e) {
      console.error("[RPG] Recette : fromDropData a échoué.", e);
      ui.notifications?.error?.("Impossible de récupérer l'objet déposé.");
      return null;
    }
  }

  /**
   * Ajoute l'objet déposé aux ingrédients requis. Un objet déjà listé
   * n'ouvre pas une deuxième ligne : sa quantité augmente (même esprit que
   * l'empilement d'inventaire, et un double-dépôt accidentel reste lisible).
   */
  async _addIngredientFromDrop(item) {
    if (!game.user.isGM || !item) return;

    const source = dropSourceOf(item);
    const list = this._ingredientList();

    const existing = list.find(ing =>
      (source && ing.source === source) || (ing.name && norm(ing.name) === norm(item.name))
    );

    if (existing) {
      existing.qty += 1;
      // Un ingrédient saisi à la main avant ce dépôt n'a qu'un nom : le
      // dépôt lui donne enfin son UUID/type, ce qui le rend reconnaissable
      // même sur un exemplaire renommé.
      if (!existing.uuid)   existing.uuid = String(item.uuid ?? "");
      if (!existing.source) existing.source = source;
      if (!existing.img)    existing.img = String(item.img ?? "");
      if (!existing.type)   existing.type = String(item.type ?? "");
      ui.notifications?.info?.(`« ${item.name} » : quantité requise portée à ${existing.qty}.`);
    } else {
      list.push({
        name:   String(item.name ?? ""),
        qty:    1,
        uuid:   String(item.uuid ?? ""),
        source,
        img:    String(item.img ?? ""),
        type:   String(item.type ?? "")
      });
      ui.notifications?.info?.(`« ${item.name} » ajouté aux ingrédients requis.`);
    }

    await this.document.update({ "system.ingredients": list }, { render: true });
  }

  /** Renseigne l'objet résultat depuis l'item déposé. */
  async _setResultFromDrop(item) {
    if (!game.user.isGM || !item) return;
    await this.document.update({
      "system.result": {
        uuid: String(item.uuid ?? ""),
        name: String(item.name ?? ""),
        img:  String(item.img ?? "")
      }
    }, { render: true });
    ui.notifications?.info?.(`Résultat de la recette : « ${item.name} ».`);
  }

  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;
    // La case "🔗 Synchro" (bindLinkSyncCheckbox) gère son propre
    // update+notification et n'a pas de "name" : la laisser passer ici
    // déclencherait une resoumission complète + render({force:true}) en
    // parallèle de son propre appel — rapporté comme "la fiche ne s'ouvre
    // plus après avoir coché". stopPropagation côté checkbox suffit déjà
    // en théorie, ce garde-fou n'a de rôle que si jamais l'évènement
    // l'atteint quand même (ex. ordre d'attache des listeners).
    if (event?.target?.dataset?.action === "toggleLinkSync") return;
    const expanded = foundry.utils.expandObject(formData.object);
    const ingRaw = expanded?.system?.ingredients;
    if (ingRaw && !Array.isArray(ingRaw)) expanded.system.ingredients = Object.values(ingRaw);
    if (Array.isArray(expanded?.system?.ingredients)) {
      // uuid/source/img/type voyagent par des <input type="hidden"> dans le
      // gabarit : submitOnChange réécrit le tableau ENTIER à chaque frappe,
      // donc tout champ absent du formulaire serait effacé — la référence
      // posée par glisser-déposer disparaîtrait au premier caractère tapé
      // dans la quantité juste à côté.
      expanded.system.ingredients = expanded.system.ingredients
        .map(ing => normalizeIngredient(ing))
        .map(ing => ({ ...ing, name: ing.name.trim() }));
    }
    await this.document.update(expanded, { render: true });
  }

  /** Tableau d'ingrédients courant, normalisé et détaché du document. */
  _ingredientList() {
    const raw = this.document.system?.ingredients ?? [];
    const list = Array.isArray(raw) ? raw : (typeof raw === "object" ? Object.values(raw) : []);
    return list.map(normalizeIngredient);
  }

  async _actionAddIngredient(event) {
    const list = this._ingredientList();
    list.push(normalizeIngredient({}));
    await this.document.update({ "system.ingredients": list }, { render: true });
  }

  async _actionRemoveIngredient(event) {
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = this._ingredientList();
    list.splice(idx, 1);
    await this.document.update({ "system.ingredients": list }, { render: true });
  }
}
