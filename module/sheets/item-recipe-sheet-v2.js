// module/sheets/item-recipe-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { applySheetViewMode, bindImageEditors } from "./sheet-helpers.js";

export class RPGRecipeSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: "rpg-recipe-sheet-v2",
    classes: ["rpg", "sheet", "item", "recipe"],
    position: { width: 500, height: 620 },
    window: { contentClasses: ["rpg-sheet-window"] },
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
    ctx.system.ingredients = Array.isArray(ctx.system.ingredients) ? ctx.system.ingredients : [];
    ctx.system.result      = ctx.system.result ?? { uuid: "", name: "" };
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
    applySheetViewMode(root, { isGM: game.user.isGM });

    // ── Clic sur bouton "Voir" (UUID) → ouvre la fiche de l'item ──────────
    root.querySelectorAll(".rpg-open-uuid").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const uuid = btn.dataset.uuid;
        if (!uuid) return;
        try {
          const doc = await fromUuid(uuid);
          if (doc?.sheet) doc.sheet.render(true);
          else ui.notifications?.warn?.("Item introuvable pour cet UUID.");
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

  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;
    const expanded = foundry.utils.expandObject(formData.object);
    const ingRaw = expanded?.system?.ingredients;
    if (ingRaw && !Array.isArray(ingRaw)) expanded.system.ingredients = Object.values(ingRaw);
    if (Array.isArray(expanded?.system?.ingredients)) {
      for (const ing of expanded.system.ingredients) {
        if (ing) { ing.name = String(ing.name ?? "").trim(); ing.qty = Math.max(1, Number(ing.qty ?? 1) || 1); }
      }
    }
    await this.document.update(expanded, { render: true });
  }

  async _actionAddIngredient(event) {
    const list = foundry.utils.deepClone(this.document.system?.ingredients ?? []);
    list.push({ name: "", qty: 1 });
    await this.document.update({ "system.ingredients": list }, { render: true });
  }

  async _actionRemoveIngredient(event) {
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.ingredients ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.ingredients": list }, { render: true });
  }
}
