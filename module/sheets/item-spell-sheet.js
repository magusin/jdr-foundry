export class RPGSpellSheet extends ItemSheet {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["rpg", "sheet", "item", "spell"],
        template: "systems/rpg/templates/item/spell-sheet.hbs",
        width: 680,
        height: 820
      });
    }
  
    async getData(options) {
      const data = await super.getData(options);
      data.system = data.item.system;
      data.isGM = game.user.isGM;
      return data;
    }
  }
  