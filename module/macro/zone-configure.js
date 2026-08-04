/**
 * Macro "Configurer une Zone (MJ)"
 *
 * Foundry ne permet pas de sélectionner une région en cliquant directement
 * sa forme sur la carte une fois qu'elle est placée (clic sur la géométrie
 * d'une région non supporté — un choix des créateurs de Foundry, pas une
 * limite de ce système : foundryvtt/foundryvtt#10755, fermée "wontfix"). La
 * seule voie officielle passe par la légende des régions (outil "Régions"
 * de la barre d'outils), pas toujours facile à repérer selon le thème/la
 * disposition de l'interface, et qui ne permet elle-même que de sélectionner
 * — pas de supprimer directement une zone dont la forme n'est pas cliquable.
 *
 * Cette macro évite d'avoir à chercher la légende : si une région est déjà
 * sélectionnée, elle propose Configurer/Supprimer pour cette région. Sinon
 * elle liste TOUTES les régions de la scène active — peu importe l'outil/
 * calque actif au moment où on la lance — avec les deux actions sur chaque
 * ligne : configurer (fiche de comportement RPG) ou supprimer la région
 * entière (avec confirmation, irréversible).
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

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  /** Supprime la région (et tous ses comportements) après confirmation — irréversible. */
  const deleteZone = async (region) => {
    const name = region.document.name || "cette région";
    const DialogV2 = foundry.applications?.api?.DialogV2;
    let confirmed = true;
    if (DialogV2?.confirm) {
      confirmed = await DialogV2.confirm({
        window: { title: "Supprimer la zone" },
        content: `<p>Supprimer définitivement <b>${htmlEscape(name)}</b> et tous ses comportements ?
          Cette action est irréversible.</p>`,
        modal: true, rejectClose: false
      });
    }
    if (!confirmed) return false;
    try {
      await region.document.delete();
      ui.notifications.info(`« ${name} » supprimée.`);
      return true;
    } catch (e) {
      console.error("[RPG][ZoneConfigure] suppression:", e);
      ui.notifications.error(`Impossible de supprimer « ${name} » : ${e?.message ?? e}`);
      return false;
    }
  };

  // Une région déjà sélectionnée via la légende des régions : pas besoin de
  // la liste ci-dessous, mais on propose quand même Configurer/Supprimer
  // plutôt que de sauter directement à la fiche (qui ne permet pas de
  // supprimer la région elle-même).
  const selected = canvas.regions?.controlled?.[0];
  if (selected) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    const name = selected.document.name || "cette région";
    if (DialogV2?.wait) {
      const action = await DialogV2.wait({
        window: { title: name },
        content: `<p>Que faire avec <b>${htmlEscape(name)}</b> ?</p>`,
        modal: true, rejectClose: false,
        buttons: [
          { action: "configure", label: "⚙️ Configurer", default: true },
          { action: "delete", label: "🗑️ Supprimer" },
          { action: "cancel", label: "Fermer" }
        ]
      });
      if (action === "configure") openZone(selected);
      else if (action === "delete") await deleteZone(selected);
    } else {
      openZone(selected); // repli si DialogV2 indisponible
    }
    return;
  }

  const regions = canvas.regions?.placeables ?? [];
  if (!regions.length) {
    ui.notifications.warn("Aucune région sur cette scène.");
    return;
  }

  const rows = regions.map(region => {
    const behaviors = (region.document.behaviors ?? []).filter(isOurs);
    const tag = behaviors.length ? behaviors.map(behaviorLabel).join(", ") : "aucun comportement RPG";
    return { region, label: region.document.name || "(région sans nom)", tag };
  });

  const rowsHtml = rows.map((r, i) => `
    <div style="display:flex;gap:5px;margin-bottom:5px">
      <button type="button" data-idx="${i}" data-role="configure"
        style="flex:1;text-align:left;padding:6px 10px;cursor:pointer;border-radius:6px">
        <b>${htmlEscape(r.label)}</b><br>
        <span style="font-size:11px;opacity:.75">${htmlEscape(r.tag)}</span>
      </button>
      <button type="button" data-idx="${i}" data-role="delete" title="Supprimer cette zone"
        style="padding:6px 10px;cursor:pointer;border-radius:6px;color:#c0392b">
        🗑️
      </button>
    </div>`).join("");

  const content = `
    <p style="font-size:12px;opacity:.8;margin-top:0">
      Foundry ne permet pas de cliquer la forme d'une région déjà placée pour la sélectionner —
      choisis-la directement ici : configure-la, ou supprime-la avec 🗑️.
    </p>
    <div style="max-height:50vh;overflow-y:auto">${rowsHtml}</div>`;

  let dlg;
  dlg = new Dialog({
    title: "Configurer une zone",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      root.querySelectorAll("[data-role='configure']").forEach(btn => {
        btn.addEventListener("click", () => {
          openZone(rows[Number(btn.dataset.idx)].region);
          dlg.close();
        });
      });
      root.querySelectorAll("[data-role='delete']").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await deleteZone(rows[Number(btn.dataset.idx)].region);
          dlg.close();
        });
      });
    }
  }, { width: 380, height: "auto" });
  dlg.render(true);
})();
