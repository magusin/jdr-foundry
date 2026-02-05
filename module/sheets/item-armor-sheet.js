export class RPGArmorSheet extends ItemSheet {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["rpg", "sheet", "item", "armor"],
        template: "systems/rpg/templates/item/armor-sheet.hbs",
        width: 640,
        height: 620
      });
    }
  
    async getData(options) {
      const data = await super.getData(options);
      data.system = data.item.system;
      data.isGM = game.user.isGM;
      return data;
    }
  }
  