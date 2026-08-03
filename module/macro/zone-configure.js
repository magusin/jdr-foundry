/**
 * Macro "Configurer une Zone (MJ)"
 *
 * Foundry ne permet pas de sélectionner une région en cliquant directement
 * sa forme sur la carte (clic sur la géométrie d'une région n'est pas
 * supporté — c'est un choix des créateurs de Foundry, pas une limite de ce
 * système). Pour reprendre une zone déjà configurée (Terrain difficile,
 * Piège / Zone à effet...), il faut :
 *   1. Outil "Régions" (barre d'outils de gauche) — ouvre la légende des régions
 *   2. Cliquer le nom de la région dans cette légende (la sélectionne)
 *   3. Lancer cette macro
 *
 * Elle ouvre directement la fiche du comportement RPG de la région (au lieu
 * de la fiche générique de Foundry, où il faudrait ensuite retrouver et
 * double-cliquer la bonne ligne de comportement).
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const region = canvas.regions?.controlled?.[0];
  if (!region) {
    ui.notifications.warn(
      "Sélectionne d'abord une région : outil « Régions » (barre d'outils de gauche), " +
      "puis clique son nom dans la légende des régions qui s'affiche — " +
      "cliquer sa forme directement sur la carte ne fonctionne pas, Foundry ne le permet pas."
    );
    return;
  }

  const terrainTypes = game.rpg?.terrain?.TERRAIN_TYPES ?? {};
  const behaviors = (region.document.behaviors ?? []).filter(b => {
    const type = String(b.type ?? "").replace("rpg.", "");
    return type in terrainTypes || type === "zoneEffet";
  });

  const label = region.document.name || "Cette région";
  if (!behaviors.length) {
    ui.notifications.warn(`« ${label} » n'a aucun comportement RPG (terrain difficile, piège/zone) à configurer.`);
    return;
  }

  if (behaviors.length === 1) {
    behaviors[0].sheet?.render(true);
  } else {
    // Plusieurs comportements RPG sur la même région : ouvre la fiche native
    // (liste tous les comportements) plutôt que de deviner lequel ouvrir.
    ui.notifications.info(`« ${label} » a plusieurs comportements RPG — ouverture de la fiche de la région.`);
    region.document.sheet?.render(true);
  }
})();
