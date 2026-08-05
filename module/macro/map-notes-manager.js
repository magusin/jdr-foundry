/**
 * Macro "Repères de Carte : Configurer (MJ)"
 *
 * Cliquer directement l'icône d'une Note sur le canvas n'est pas toujours
 * fiable pour rouvrir sa configuration (dépend de l'outil actif et du pixel
 * cliqué), et surtout : la visibilité d'une Note pour les JOUEURS dépend de
 * la permission de l'Entrée de Journal à laquelle elle est liée, pas
 * seulement de son propre champ « caché ». Un pin non caché reste invisible
 * pour un joueur si l'entrée liée n'a pas au moins la permission
 * Observateur — c'est la cause la plus fréquente d'un « les joueurs ne
 * voient pas la note » alors que tout semble correct côté MJ.
 *
 * Cette macro liste toutes les Notes de la scène active avec, pour chacune,
 * trois actions fiables : basculer caché/visible, ouvrir sa fiche de
 * configuration (icône, libellé, entrée liée), et ouvrir l'Entrée de
 * Journal liée pour vérifier/régler sa permission.
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
  const notes = scene.notes.contents;
  if (!notes.length) {
    ui.notifications.warn("Aucune Note sur cette scène.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const rows = notes.map(n => {
    const entry = n.entryId ? game.journal.get(n.entryId) : null;
    const label = n.label || entry?.name || "(sans nom)";
    return { note: n, entry, label };
  });

  const rowsHtml = rows.map((r, i) => `
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
      <span style="flex:1">${r.note.hidden ? "🚫" : "👁"} <b>${htmlEscape(r.label)}</b></span>
      <button type="button" data-idx="${i}" data-role="toggle" title="Cacher/afficher">
        ${r.note.hidden ? "Afficher" : "Cacher"}
      </button>
      <button type="button" data-idx="${i}" data-role="configure" title="Configurer la Note">⚙️</button>
      <button type="button" data-idx="${i}" data-role="perm" title="Entrée liée (permission)" ${r.entry ? "" : "disabled"}>🔐</button>
    </div>`).join("");

  const content = `
    <p style="font-size:12px;opacity:.8;margin-top:0">
      ⚙️ ouvre la fiche de configuration de la Note (icône, libellé, entrée liée).
      🔐 ouvre l'Entrée de Journal liée : vérifie/règle sa permission sur au moins
      <b>Observateur</b> pour le rôle Joueur, sinon le pin reste invisible aux
      joueurs même une fois « affiché ».
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
          await r.note.update({ hidden: !r.note.hidden });
          dlg.close();
        });
      });
      root.querySelectorAll("[data-role='configure']").forEach(btn => {
        btn.addEventListener("click", () => {
          rows[Number(btn.dataset.idx)].note.sheet?.render(true);
          dlg.close();
        });
      });
      root.querySelectorAll("[data-role='perm']").forEach(btn => {
        btn.addEventListener("click", () => {
          rows[Number(btn.dataset.idx)].entry?.sheet?.render(true);
          dlg.close();
        });
      });
    }
  }, { width: 420, height: "auto" });
  dlg.render(true);
})();
