// systems/rpg/module/sheets/item-recipe-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RPGRecipeSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-recipe-sheet-v2",
      classes: ["rpg", "sheet", "item", "recipe"],
      position: { width: 480, height: 560 },
      window: { contentClasses: ["rpg-sheet-window"] },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      },

      actions: {
        addIngredient:    async function (event) { await this._actionAddIngredient(event); },
        removeIngredient: async function (event) { await this._actionRemoveIngredient(event); }
      }
    },
    { inplace: false }
  );

  static PARTS = foundry.utils.mergeObject(
    super.PARTS ?? {},
    {
      form: {
        id: "form",
        template: "systems/rpg/templates/item/item-recipe-sheet.hbs",
        scrollable: [".sheet-body"]
      }
    },
    { inplace: false }
  );

  get isEditable() {
    return game.user.isGM;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const item = this.document;

    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});
    ctx.system.ingredients = Array.isArray(ctx.system.ingredients) ? ctx.system.ingredients : [];
    ctx.system.result = ctx.system.result ?? { uuid: "", name: "" };
    ctx.system.difficulte = Number(ctx.system.difficulte ?? 0) || 0;
    ctx.system.description = String(ctx.system.description ?? "");

    ctx.canEdit = this.isEditable;
    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    const expanded = foundry.utils.expandObject(formData.object);

    // Normalise ingredients : Object -> Array si Handlebars a sérialisé en objet indexé
    const ingRaw = expanded?.system?.ingredients;
    if (ingRaw && !Array.isArray(ingRaw)) {
      expanded.system.ingredients = Object.values(ingRaw);
    }
    if (Array.isArray(expanded?.system?.ingredients)) {
      for (const ing of expanded.system.ingredients) {
        if (ing) {
          ing.name = String(ing.name ?? "").trim();
          ing.qty  = Math.max(1, Number(ing.qty ?? 1) || 1);
        }
      }
    }

    await this.document.update(expanded, { render: true });
  }

  async _actionAddIngredient(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.ingredients ?? []);
    list.push({ name: "", qty: 1 });
    await this.document.update({ "system.ingredients": list }, { render: true });
  }

  async _actionRemoveIngredient(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.ingredients ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.ingredients": list }, { render: true });
  }
}
