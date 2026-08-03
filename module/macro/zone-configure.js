/**
 * Macro "Configurer une Zone (MJ)"
 *
 * Foundry ne permet pas de sélectionner une région en cliquant directement
 * sa forme sur la carte une fois qu'elle est placée (clic sur la géométrie
 * d'une région non supporté — un choix des créateurs de Foundry, pas une
 * limite de ce système : foundryvtt/foundryvtt#10755, fermée "wontfix"). La
 * seule voie officielle passe par la légende des régions (outil "Régions"
 * de la barre d'outils), pas toujours facile à repérer selon le thème/la
 * disposition de l'interface.
 *
 * Cette macro évite d'avoir à la chercher : si une région est déjà
 * sélectionnée (légende des régions), elle ouvre directement sa fiche de
 * comportement RPG. Sinon elle liste TOUTES les régions de la scène active
 * — peu importe l'outil/calque actif au moment où on la lance — et un clic
 * sur un nom ouvre sa fiche.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const terrainTypes = game.rpg?.terrain?.TERRAIN_TYPES ?? {};
  const isOurs = (b) => {
    const type = String(b?.type ?? "").replace("rpg.", "");
    return type in terrainTypes || type === "zoneEffet";
  };
  const behaviorLabel = (b) => {
    const type = String(b?.type ?? "").replace("rpg.", "");
    return terrainTypes[type]?.label || b?.system?.label || "Piège / Zone à effet";
  };

  /** Ouvre la fiche du seul comportement RPG trouvé, ou la fiche native de
   *  la région s'il y en a plusieurs (ou aucun) — pour ne jamais deviner. */
  const openZone = (region) => {
    const behaviors = (region.document.behaviors ?? []).filter(isOurs);
    if (behaviors.length === 1) {
      behaviors[0].sheet?.render(true);
    } else {
      if (behaviors.length > 1) {
        ui.notifications.info(`« ${region.document.name || "Cette région"} » a plusieurs comportements RPG — ouverture de la fiche de la région.`);
      }
      region.document.sheet?.render(true);
    }
  };

  // Une région déjà sélectionnée via la légende des régions : pas besoin de
  // la liste ci-dessous, on saute directement à sa fiche.
  const selected = canvas.regions?.controlled?.[0];
  if (selected) { openZone(selected); return; }

  const regions = canvas.regions?.placeables ?? [];
  if (!regions.length) {
    ui.notifications.warn("Aucune région sur cette scène.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const rows = regions.map(region => {
    const behaviors = (region.document.behaviors ?? []).filter(isOurs);
    const tag = behaviors.length ? behaviors.map(behaviorLabel).join(", ") : "aucun comportement RPG";
    return { region, label: region.document.name || "(région sans nom)", tag };
  });

  const rowsHtml = rows.map((r, i) => `
    <button type="button" data-idx="${i}"
      style="display:block;width:100%;text-align:left;margin-bottom:5px;padding:6px 10px;cursor:pointer;border-radius:6px">
      <b>${htmlEscape(r.label)}</b><br>
      <span style="font-size:11px;opacity:.75">${htmlEscape(r.tag)}</span>
    </button>`).join("");

  const content = `
    <p style="font-size:12px;opacity:.8;margin-top:0">
      Foundry ne permet pas de cliquer la forme d'une région déjà placée pour la sélectionner —
      choisis-la directement ici.
    </p>
    <div style="max-height:50vh;overflow-y:auto">${rowsHtml}</div>`;

  let dlg;
  dlg = new Dialog({
    title: "Configurer une zone",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      root.querySelectorAll("[data-idx]").forEach(btn => {
        btn.addEventListener("click", () => {
          openZone(rows[Number(btn.dataset.idx)].region);
          dlg.close();
        });
      });
    }
  }, { width: 380, height: "auto" });
  dlg.render(true);
})();
