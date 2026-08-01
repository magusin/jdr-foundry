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
 *
 * Corrige aussi les tokens DÉJÀ posés sur les scènes : un personnage non lié
 * (actorLink:false, réglage par défaut de Foundry pour un acteur neuf) stocke
 * tout ce qui change pendant la partie (objet équipé, objet ramassé…) dans le
 * « delta » de CE token précis, jamais dans l'acteur de base. Si un joueur
 * change ensuite de scène et qu'on recrée son token depuis la fiche PJ, le
 * nouveau token part d'un delta vide et n'affiche que l'acteur de base — tout
 * ce qui n'existait que dans le delta de l'ancien token semble avoir disparu.
 * Avant de forcer la liaison sur un token existant, on rapatrie donc dans
 * l'acteur de base tout objet présent sur le token mais absent de l'acteur,
 * pour ne rien perdre au passage.
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

  // ── Rattrapage des tokens déjà placés sur les scènes ────────────────────
  let fixedTokens = 0;
  let recoveredItems = 0;
  const reports = [];

  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorLink) continue;

      const baseActor = game.actors.get(token.actorId);
      if (!baseActor || baseActor.type !== "character") continue;

      const tokenActor = token.actor; // acteur synthétique = base + delta fusionnés
      if (!tokenActor) continue;

      const baseIds = new Set(baseActor.items.map(i => i.id));
      const missing = tokenActor.items.filter(i => !baseIds.has(i.id));

      if (missing.length) {
        await baseActor.createEmbeddedDocuments("Item", missing.map(i => i.toObject()));
        recoveredItems += missing.length;
        reports.push(`${baseActor.name} (scène « ${scene.name} ») : ${missing.length} objet(s) rapatrié(s) — ${missing.map(i => i.name).join(", ")}`);
      }

      await token.update({ actorLink: true });
      fixedTokens++;
    }
  }

  let msg = `✅ Prototype Token configuré pour ${n} personnage(s) : lié, nom + barres au survol, vision, Barre 1 = PV, Barre 2 = Mana.`;
  if (fixedTokens) {
    msg += `<br>🔗 ${fixedTokens} token(s) déjà posé(s) reliés à leur acteur.`;
  }
  if (recoveredItems) {
    msg += `<br>♻️ ${recoveredItems} objet(s) rapatrié(s) depuis des tokens non liés vers la fiche du personnage — vérifiez l'onglet Équipement.`;
    console.log("[RPG] Objets rapatriés lors de la liaison des tokens :", reports);
  }

  ui.notifications.info(msg, { permanent: !!recoveredItems });
})();
