/**
 * Config Token Joueurs (MJ)
 * Applique le Prototype Token recommandé à TOUS les personnages :
 *   - Lié à l'acteur (actorLink)
 *   - Nom affiché au survol par n'importe qui
 *   - Barres affichées au survol par n'importe qui
 *   - Vision activée
 *   - Barre 1 = PV, Barre 2 = Mana
 *   - Taille 1×1, disposition Amical
 * À relancer après avoir créé de nouveaux personnages.
 */
(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }

  const D = CONST.TOKEN_DISPLAY_MODES;   // HOVER = au survol par n'importe qui
  const P = CONST.TOKEN_DISPOSITIONS;

  const chars = game.actors.filter(a => a.type === "character");
  if (!chars.length) { ui.notifications.warn("Aucun personnage trouvé."); return; }

  let n = 0;
  for (const actor of chars) {
    await actor.update({
      "prototypeToken.actorLink":        true,
      "prototypeToken.disposition":      P.FRIENDLY,
      "prototypeToken.displayName":      D.HOVER,
      "prototypeToken.displayBars":      D.HOVER,
      "prototypeToken.sight.enabled":    true,
      "prototypeToken.bar1.attribute":   "ressources.pv",
      "prototypeToken.bar2.attribute":   "ressources.mana",
      "prototypeToken.width":            1,
      "prototypeToken.height":           1
    });
    n++;
  }

  ui.notifications.info(
    `✅ Prototype Token configuré pour ${n} personnage(s) : lié, nom + barres au survol, vision, Barre 1 = PV, Barre 2 = Mana.`
  );
})();
