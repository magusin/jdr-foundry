(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }
  const { openBiomeDialog } = game.rpg?.weather ?? {};
  if (openBiomeDialog) openBiomeDialog();
  else ui.notifications.error("Module terrain introuvable.");
})();
