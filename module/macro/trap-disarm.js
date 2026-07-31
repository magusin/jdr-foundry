/**
 * Macro "Désamorcer un piège"
 *
 * Le MJ sélectionne :
 * - le token qui tente le jet de Crochetage (contrôlé sur le canvas)
 * - la région (piège / zone à effet) à désamorcer — outil "Régions",
 *   région sélectionnée sur le canvas
 *
 * Poste un jet de Crochetage (DD de désamorçage défini sur la zone). Si le
 * MJ valide la réussite dans le chat, le piège est désactivé pour de bon.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Seul le MJ peut lancer ce désamorçage.");
    return;
  }

  const token = canvas.tokens.controlled[0];
  if (!token?.actor) {
    ui.notifications.warn("Sélectionne d'abord le token qui tente le jet de Crochetage.");
    return;
  }

  const region = canvas.regions?.controlled?.[0];
  if (!region) {
    ui.notifications.warn("Sélectionne aussi la région (piège/zone) à désamorcer — outil « Régions » de la barre d'outils.");
    return;
  }

  const behavior = region.document.behaviors.find(b => String(b.type) === "rpg.zoneEffet");
  if (!behavior) {
    ui.notifications.warn("Cette région n'a pas de comportement « Piège / Zone à effet (RPG) ».");
    return;
  }

  const { declareZoneDisarmCheck } = game.rpg?.zones ?? {};
  if (!declareZoneDisarmCheck) {
    ui.notifications.error("API zones introuvable.");
    return;
  }

  await declareZoneDisarmCheck(token.actor, region.document, behavior);
})();
