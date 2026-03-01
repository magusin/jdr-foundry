const { ItemSheet } = foundry.appv1.sheets;

export class RPGGenericItemSheet extends ItemSheet {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["rpg", "sheet", "item", "generic"],
        width: 520,
        height: 520
      });
    }
  
    get template() {
      const t = this.item.type;
      // if (t === "consumable") return "systems/rpg/templates/item/consumable-sheet.hbs";
      return "systems/rpg/templates/item/item-generic-sheet.hbs";
    }
  
    async getData(options) {
      const data = await super.getData(options);
      data.system = data.item.system;
      data.isGM = game.user.isGM;
      return data;
    }
  }
  