// systems/rpg/module/sheets/item-quest-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RPGQuestSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-quest-sheet-v2",
      classes: ["rpg", "sheet", "item", "quest"],
      position: { width: 480, height: 620 },
      window: { contentClasses: ["rpg-sheet-window"] },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      },

      actions: {
        addObjectif:      async function (event) { await this._actionAddObjectif(event); },
        removeObjectif:   async function (event) { await this._actionRemoveObjectif(event); },
        addRewardItem:    async function (event) { await this._actionAddRewardItem(event); },
        removeRewardItem: async function (event) { await this._actionRemoveRewardItem(event); }
      }
    },
    { inplace: false }
  );

  static PARTS = foundry.utils.mergeObject(
    super.PARTS ?? {},
    {
      form: {
        id: "form",
        template: "systems/rpg/templates/item/item-quest-sheet.hbs",
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
    ctx.system.objectifs = Array.isArray(ctx.system.objectifs) ? ctx.system.objectifs : [];
    ctx.system.recompense = ctx.system.recompense ?? { xp: 0, items: [] };
    ctx.system.recompense.items = Array.isArray(ctx.system.recompense.items) ? ctx.system.recompense.items : [];
    ctx.system.statut = String(ctx.system.statut ?? "active");
    ctx.system.description = String(ctx.system.description ?? "");

    ctx.canEdit = this.isEditable;
    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    const expanded = foundry.utils.expandObject(formData.object);

    const objRaw = expanded?.system?.objectifs;
    if (objRaw && !Array.isArray(objRaw)) expanded.system.objectifs = Object.values(objRaw);
    if (Array.isArray(expanded?.system?.objectifs)) {
      for (const o of expanded.system.objectifs) {
        if (o) { o.text = String(o.text ?? "").trim(); o.fait = !!o.fait; }
      }
    }

    const riRaw = expanded?.system?.recompense?.items;
    if (riRaw && !Array.isArray(riRaw)) expanded.system.recompense.items = Object.values(riRaw);
    if (Array.isArray(expanded?.system?.recompense?.items)) {
      for (const ri of expanded.system.recompense.items) {
        if (ri) {
          ri.uuid = String(ri.uuid ?? "").trim();
          ri.name = String(ri.name ?? "").trim();
          ri.qty  = Math.max(1, Number(ri.qty ?? 1) || 1);
        }
      }
    }

    await this.document.update(expanded, { render: true });
  }

  async _actionAddObjectif(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.objectifs ?? []);
    list.push({ text: "", fait: false });
    await this.document.update({ "system.objectifs": list }, { render: true });
  }

  async _actionRemoveObjectif(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.objectifs ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.objectifs": list }, { render: true });
  }

  async _actionAddRewardItem(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.push({ uuid: "", name: "", qty: 1 });
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }

  async _actionRemoveRewardItem(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }
}
