(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }
  const { openWeatherDialog } = game.rpg?.weather ?? {};
  if (openWeatherDialog) openWeatherDialog();
  else ui.notifications.error("Module météo introuvable.");
})();
