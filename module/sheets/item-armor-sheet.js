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
    data.flags = data.flags ?? {};
    data.flags.isGM = game.user.isGM;

    const b = data.system?.bonus ?? {};

    const LABELS = {
      armureFixe: "Armure fixe",
      resistanceFixe: "Résistance fixe",
      scoreArmure: "Score Armure",
      scoreResistance: "Score Résistance",
      pvMax: "PV max",
      manaMax: "Mana max",
      vitesse: "Vitesse"
    };

    // ✅ liste “affichage joueur” = uniquement non-zéro
    data.displayBonuses = Object.entries(LABELS)
      .map(([k, label]) => ({ key: k, label, value: Number(b?.[k] ?? 0) || 0 }))
      .filter(row => row.value !== 0);

    return data;
  }
}
