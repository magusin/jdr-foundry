/**
 * Macro "Repères de Carte : Configurer (MJ)"
 *
 * Repères de lieux = Dessins (icône en texture de remplissage + libellé
 * texte), pas des Notes : pas d'Entrée de journal à créer ni de permission
 * séparée à régler, un Dessin est visible aux joueurs dès que son propre
 * champ `hidden` est décoché. Cliquer directement la forme d'un Dessin sur
 * le canvas reste peu pratique pour rouvrir sa configuration une fois
 * plusieurs repères posés — cette macro liste tous les Dessins de la scène
 * active avec, pour chacun, deux actions rapides : basculer caché/visible,
 * et ouvrir sa fiche de configuration (forme, texture/icône, texte).
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.warn("Aucune scène active.");
    return;
  }
  const drawings = scene.drawings.contents;
  if (!drawings.length) {
    ui.notifications.warn("Aucun Dessin sur cette scène.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const rows = drawings.map(d => ({ drawing: d, label: d.text || "(sans texte)" }));

  const rowsHtml = rows.map((r, i) => `
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
      <span style="flex:1">${r.drawing.hidden ? "🚫" : "👁"} <b>${htmlEscape(r.label)}</b></span>
      <button type="button" data-idx="${i}" data-role="toggle" title="Cacher/afficher">
        ${r.drawing.hidden ? "Afficher" : "Cacher"}
      </button>
      <button type="button" data-idx="${i}" data-role="configure" title="Configurer le Dessin">⚙️</button>
    </div>`).join("");

  const content = `
    <p style="font-size:12px;opacity:.8;margin-top:0">
      ⚙️ ouvre la fiche de configuration du Dessin (forme, icône/texture, texte).
    </p>
    <div style="max-height:50vh;overflow-y:auto">${rowsHtml}</div>`;

  let dlg;
  dlg = new Dialog({
    title: "Repères de carte",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      root.querySelectorAll("[data-role='toggle']").forEach(btn => {
        btn.addEventListener("click", async () => {
          const r = rows[Number(btn.dataset.idx)];
          await r.drawing.update({ hidden: !r.drawing.hidden });
          dlg.close();
        });
      });
      root.querySelectorAll("[data-role='configure']").forEach(btn => {
        btn.addEventListener("click", () => {
          rows[Number(btn.dataset.idx)].drawing.sheet?.render(true);
          dlg.close();
        });
      });
    }
  }, { width: 380, height: "auto" });
  dlg.render(true);
})();
