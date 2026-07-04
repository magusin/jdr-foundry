/**
 * Macro "JDR — Déverrouiller les Compendiums (MJ)"
 *
 * Foundry verrouille les compendiums de système en lecture seule par défaut.
 * Cette macro les déverrouille tous pour permettre au MJ d'y ajouter des
 * objets, créer des dossiers, modifier les images, etc.
 * À relancer après chaque redémarrage si nécessaire.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const RPG_PACKS = [
    "rpg.macros-rpg",
    "rpg.items-reference",
    "rpg.loot-tables",
    "rpg.monsters-reference",
    "rpg.documentation"
  ];

  let unlocked = 0;
  for (const packId of RPG_PACKS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    if (pack.locked) {
      await pack.configure({ locked: false });
      unlocked++;
    }
  }

  if (unlocked > 0) {
    ui.notifications.info(`✅ ${unlocked} compendium(s) déverrouillé(s) — tu peux maintenant les modifier.`);
  } else {
    ui.notifications.info("Tous les compendiums étaient déjà déverrouillés.");
  }
})();
