// systems/rpg/module/sheets/item-generic-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export class RPGGenericItemSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-generic-item-sheet-v2",
      classes: ["rpg", "sheet", "item", "generic"],
      position: { width: 520, height: 520 },
      window: { contentClasses: ["rpg-sheet-window"] },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      }
    },
    { inplace: false }
  );

  static PARTS = foundry.utils.mergeObject(
    super.PARTS ?? {},
    {
      form: {
        id: "form",
        template: "systems/rpg/templates/item/item-generic-sheet.hbs",
        scrollable: [".sheet-body"]
      }
    },
    { inplace: false }
  );

  get isEditable() {
    // comme tes autres : GM only
    return game.user.isGM;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);

    const item = this.document;
    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});

    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;
    ctx.isReadOnly = !ctx.canEdit;

    // defaults
    ctx.system.qte = n(ctx.system.qte, 1);
    ctx.system.poids = n(ctx.system.poids, 0);
    ctx.system.utilisations = n(ctx.system.utilisations, 0);
    ctx.system.effet = String(ctx.system.effet ?? "");
    ctx.system.description = String(ctx.system.description ?? "");

    ctx.system.prix = ctx.system.prix ?? { cuivre: 0, argent: 0, or: 0 };
    ctx.system.prix.cuivre = n(ctx.system.prix.cuivre, 0);
    ctx.system.prix.argent = n(ctx.system.prix.argent, 0);
    ctx.system.prix.or = n(ctx.system.prix.or, 0);

    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;

    const raw = formData?.object ?? {};
    const expanded = foundry.utils.expandObject(raw);

    // normalise numbers
    if (expanded?.system?.qte != null) expanded.system.qte = n(expanded.system.qte, 1);
    if (expanded?.system?.poids != null) expanded.system.poids = n(expanded.system.poids, 0);
    if (expanded?.system?.utilisations != null) expanded.system.utilisations = n(expanded.system.utilisations, 0);
    if (expanded?.system?.prix) {
      expanded.system.prix.cuivre = n(expanded.system.prix.cuivre, 0);
      expanded.system.prix.argent = n(expanded.system.prix.argent, 0);
      expanded.system.prix.or = n(expanded.system.prix.or, 0);
    }

    await this.document.update(expanded, { render: false });
    await this.render({ force: true });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    // read-only joueur : désactive tout (sécurité)
    applyUiTheme(root);
    applySheetViewMode(root, { isGM: game.user.isGM });
    bindImageEditors(root, this.document);
  }
}