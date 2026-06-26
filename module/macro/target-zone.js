/**
 * Macro "JDR — Cibler la Zone (MJ ou joueur)"
 *
 * Dessine ton gabarit de sort (cône, cercle, rayon...) avec les outils
 * natifs de Foundry, puis lance cette macro : elle cible automatiquement
 * tous les tokens compris dans le dernier gabarit posé sur la scène —
 * pratique pour déclarer un sort à plusieurs cibles (zone d'effet) sans
 * cliquer chaque token un par un.
 */
(async () => {
  const templates = canvas?.templates?.placeables ?? [];
  if (!templates.length) {
    ui.notifications.warn("Aucun gabarit de zone sur la scène. Dessine d'abord un cercle/cône/rayon (outil Mesure).");
    return;
  }

  // Prend le gabarit le plus récemment créé (le plus probable pour ce sort)
  const template = templates.reduce((latest, t) =>
    (t.document._stats?.createdTime ?? 0) > (latest.document._stats?.createdTime ?? 0) ? t : latest,
    templates[0]
  );

  const doc = template.document;
  const shape = template.shape; // PIXI shape en coordonnées LOCALES (origine au centre du gabarit)

  if (!shape) {
    ui.notifications.error("Impossible de lire la forme du gabarit.");
    return;
  }

  const angleRad = -(Number(doc.direction) || 0) * Math.PI / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const inside = [];
  for (const tok of canvas.tokens.placeables) {
    const dx = tok.center.x - doc.x;
    const dy = tok.center.y - doc.y;
    // Remet le point dans le référentiel local du gabarit (annule sa rotation)
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    try {
      if (shape.contains(localX, localY)) inside.push(tok);
    } catch (e) { /* forme non supportée, ignore ce token */ }
  }

  if (!inside.length) {
    ui.notifications.warn("Aucun token dans ce gabarit.");
    return;
  }

  game.user.targets.forEach(t => t.setTarget(false, { releaseOthers: false }));
  for (const tok of inside) {
    tok.setTarget(true, { releaseOthers: false });
  }

  const names = inside.map(t => t.actor?.name ?? t.name).join(", ");
  ui.notifications.info(`${inside.length} cible(s) sélectionnée(s) : ${names}`);

  if (game.user.isGM) {
    await ChatMessage.create({
      content: `🎯 Zone d'effet : <b>${inside.length}</b> cible(s) touchée(s) — ${names}`
    });
  }
})();
