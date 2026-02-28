// systems/rpg/module/sheets/item-weapon-sheet.js

export class RPGWeaponSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["rpg", "sheet", "item", "weapon"],
      template: "systems/rpg/templates/item/weapon-sheet.hbs",
      width: 700,
      height: 800
    });
  }

  get isEditable() {
    return game.user.isGM; // GM only
  }

  async getData(options) {
    const data = await super.getData(options);
    data.system = data.item.system;
    data.isGM = game.user.isGM;
    return data;
  }

activateListeners(html) {
  super.activateListeners(html);

  // Ajout effet
  html.find("[data-action='addEffect']").on("click", async (ev) => {
    ev.preventDefault();

    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.push({
      id: foundry.utils.randomID(8),
      label: "Nouvel effet",
      duration: 1,
      cleanseDC: 0,
      stacking: "replace",
      dot: { base: 0, stat: "intelligence", per: 10, livraison: "physique" },
      modsFlat: { principales: {} },
      modsPct: { principales: {} }
    });

    await this.item.update({ "system.effects": effects });
    this.render(false);
  });

  // Suppression effet
  html.find("[data-action='removeEffect']").on("click", async (ev) => {
    ev.preventDefault();
    const idx = Number(ev.currentTarget.dataset.idx);
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.splice(idx, 1);
    await this.item.update({ "system.effects": effects });
    this.render(false);
  });
}
}
