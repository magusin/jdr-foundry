/**
 * Macro « Position tactique (MJ) »
 *
 * Pose une couverture (légère +1 / moyenne +2 / totale +4) ou une exposition
 * (pris en flanc −2 / angle mort −3 / en contrebas −1) sur les jetons
 * SÉLECTIONNÉS et CIBLÉS : c'est leur esquive qui change, donc le seuil de
 * toute attaque adverse qui les vise (combat.js, computeTN). Une position
 * remplace la précédente du même groupe ; « Retirer » les efface toutes.
 * Le MJ juge la carte, l'outil applique (rules/tactical-library.js).
 */
(async () => {
  if (!game.user.isGM) return ui.notifications.warn("Réservé au MJ.");
  const T = game.rpg?.tactical;
  if (!T?.applyTactical) return ui.notifications.error("Positions indisponibles (game.rpg.tactical) — recharge le monde.");

  const tokens = [...new Set([...(canvas.tokens?.controlled ?? []), ...(game.user.targets ?? [])])].filter(t => t.actor);
  if (!tokens.length) return ui.notifications.warn("Sélectionne ou cible au moins un jeton.");

  const rows = T.listTactical().map(d =>
    `<button type="button" data-key="${d.key}" style="display:block;width:100%;text-align:left;margin:3px 0">
       <b>${d.label}</b> <span style="opacity:.7;font-size:11px">— ${d.hint}</span></button>`).join("");
  const names = tokens.map(t => t.name).join(", ");

  const DialogV2 = foundry.applications.api.DialogV2;
  let chosen = null;
  const dlg = new DialogV2({
    window: { title: "🛡️ Position tactique" },
    position: { width: 460 },
    content: `<p style="margin:0 0 6px">Sur : <b>${names}</b></p>${rows}
      <hr/><button type="button" data-key="__clear" style="width:100%">🧹 Retirer toutes les positions</button>`,
    buttons: [{ action: "close", label: "Fermer" }]
  });
  await dlg.render({ force: true });
  dlg.element.querySelectorAll("button[data-key]").forEach(b => b.addEventListener("click", async () => {
    chosen = b.dataset.key;
    dlg.close();
    const lines = [];
    for (const t of tokens) {
      if (chosen === "__clear") {
        const nb = await T.clearTactical(t.actor);
        if (nb) lines.push(`${t.name} : position retirée`);
      } else {
        const st = await T.applyTactical(t.actor, chosen);
        if (st) lines.push(`${t.name} : <b>${st.label}</b>`);
      }
    }
    if (lines.length) ChatMessage.create({ content: `🛡️ ${lines.join("<br>")}`, speaker: { alias: "Position" } });
  }));
})();
