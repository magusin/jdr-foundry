/**
 * Macro "Détecter un piège"
 *
 * Le MJ sélectionne :
 * - le token qui tente le jet de Perception (contrôlé sur le canvas)
 * - la région (piège / zone à effet) à faire jauger — outil "Régions",
 *   région sélectionnée sur le canvas
 *
 * Poste un jet de Perception (DD défini sur la zone). Si le MJ valide la
 * réussite dans le chat, la zone est marquée révélée pour ce personnage.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Seul le MJ peut lancer cette détection.");
    return;
  }

  const token = canvas.tokens.controlled[0];
  if (!token?.actor) {
    ui.notifications.warn("Sélectionne d'abord le token qui tente le jet de Perception.");
    return;
  }

  const region = canvas.regions?.controlled?.[0];
  if (!region) {
    ui.notifications.warn("Sélectionne aussi la région (piège/zone) à détecter — outil « Régions » de la barre d'outils.");
    return;
  }

  const behavior = region.document.behaviors.find(b => String(b.type) === "rpg.zoneEffet");
  if (!behavior) {
    ui.notifications.warn("Cette région n'a pas de comportement « Piège / Zone à effet (RPG) ».");
    return;
  }

  const { declareZonePerceptionCheck } = game.rpg?.zones ?? {};
  if (!declareZonePerceptionCheck) {
    ui.notifications.error("API zones introuvable.");
    return;
  }

  await declareZonePerceptionCheck(token.actor, region.document, behavior);
})();
