/**
 * Macro « Générateur de Rencontres (MJ) »
 *
 * Compose une rencontre à partir des monstres du MONDE qui ont des plages de
 * génération (bouton ⚡ de leur fiche, ou installés par « 📚 Installer la
 * campagne »), selon la règle du guide : une rencontre normale vaut 1 point
 * de menace pour 3 PJ. Toute la logique vit dans rules/encounter-builder.js
 * (game.rpg.encounters) ; cette macro n'est que l'interface.
 *
 * Les jetons sont posés CACHÉS au centre de la vue, au niveau choisi (et non
 * à un niveau tiré au hasard dans les plages du monstre).
 */
(async () => {
  if (!game.user.isGM) return ui.notifications.warn("Réservé au MJ.");
  const E = game.rpg?.encounters;
  const T = game.rpg?.monsterThemes;
  if (!E) return ui.notifications.error("Générateur indisponible (game.rpg.encounters) — recharge le monde.");
  const DialogV2 = foundry.applications.api.DialogV2;

  const get = (k, d) => { try { return game.settings.get("rpg", k); } catch { return d; } };
  let level = Number(get("peseeNiveauGroupe", 1)) || 1;
  let size = Number(get("peseeGroupeTaille", 3)) || 3;
  let difficulty = "standard";
  let theme = "";

  const diffOpts = () => Object.entries(E.DIFFICULTIES).map(([k, v]) =>
    `<option value="${k}" ${k === difficulty ? "selected" : ""}>${v.label} — ${v.budget} pt</option>`).join("");
  const themeOpts = () => `<option value="">Tous les thèmes</option>` + (T?.MONSTER_THEMES ?? [])
    .map(t => `<option value="${t.key}" ${t.key === theme ? "selected" : ""}>${t.icon} ${t.label}</option>`).join("");

  const ask = () => DialogV2.wait({
    window: { title: "⚔️ Générateur de Rencontres" },
    position: { width: 440 },
    content: `<div style="display:grid;grid-template-columns:150px 1fr;gap:8px;align-items:center">
        <label>Niveau du groupe</label><input type="number" name="level" min="1" max="20" value="${level}"/>
        <label>Nombre de PJ</label><input type="number" name="size" min="1" max="8" value="${size}"/>
        <label>Difficulté</label><select name="difficulty">${diffOpts()}</select>
        <label>Thème</label><select name="theme">${themeOpts()}</select>
      </div>
      <p style="font-size:11px;opacity:.75;margin-top:8px">Tire dans les monstres du monde qui ont des plages de
        génération à ±2 niveaux. Un monstre plus haut que le groupe compte plus lourd (×1,3 par niveau).</p>`,
    buttons: [
      { action: "ok", label: "🎲 Composer", default: true, callback: (ev, btn, dlg) => {
          const r = dlg.element;
          return {
            level: Math.max(1, Number(r.querySelector("[name=level]").value) || 1),
            size: Math.max(1, Number(r.querySelector("[name=size]").value) || 3),
            difficulty: r.querySelector("[name=difficulty]").value,
            theme: r.querySelector("[name=theme]").value
          };
        } },
      { action: "cancel", label: "Annuler" }
    ],
    rejectClose: false
  }).catch(() => null);

  const params = await ask();
  if (!params || params === "cancel") return;
  ({ level, size, difficulty, theme } = params);

  const pool = E.listBestiary({ level });
  if (!pool.length) {
    return ui.notifications.warn("Aucun monstre utilisable à ce niveau. Calibre tes monstres (bouton ⚡ de leur fiche) ou lance « 📚 Installer la campagne ».");
  }

  // Boucle « relancer » jusqu'à ce que le MJ pose ou ferme.
  for (let guard = 0; guard < 30; guard++) {
    const enc = E.buildEncounter({ level, size, difficulty, theme, pool });
    const html = E.encounterSummaryHTML(enc);
    const choice = await DialogV2.wait({
      window: { title: "⚔️ Rencontre proposée" },
      position: { width: 480 },
      content: html,
      buttons: [
        { action: "place", label: "📍 Poser (cachés)", default: true, disabled: !enc.entries.length },
        { action: "chat", label: "💬 Envoyer au chat (MJ)" },
        { action: "again", label: "🎲 Relancer" },
        { action: "close", label: "Fermer" }
      ],
      rejectClose: false
    }).catch(() => "close");

    if (choice === "again") continue;
    if (choice === "chat") {
      await ChatMessage.create({ content: html, whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id), speaker: { alias: "Rencontre" } });
      return;
    }
    if (choice === "place") {
      if (!canvas?.scene) return ui.notifications.warn("Aucune scène active.");
      const center = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
      const created = await E.placeEncounter(enc, { center, hidden: true });
      await ChatMessage.create({ content: html, whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id), speaker: { alias: "Rencontre" } });
      ui.notifications.info(`${created.length} jeton(s) posé(s), cachés. Révèle-les quand le groupe les voit.`);
    }
    return;
  }
})();
