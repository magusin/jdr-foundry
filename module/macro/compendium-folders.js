/**
 * Macro "Dossiers Compendium (MJ)"
 *
 * Un dossier à l'intérieur d'un compendium (ex. "Sorts de Monstres" dans un
 * compendium de sorts) n'a aucune permission propre en Foundry — seuls les
 * documents qu'il contient en ont. Le filtre codex (rules/codex.js) retire
 * déjà des compendiums d'objets ce qu'un joueur n'a jamais eu en main, mais
 * un dossier qui n'a jamais reçu ces objets reste visible, vide, dans
 * l'arbre — ce qui peut suffire à spoiler (le nom du dossier, son
 * existence). Et pour un compendium d'acteurs (monstres, PNJ…), le filtre
 * codex ne s'applique de toute façon pas du tout.
 *
 * Cette macro pose/retire `flags.rpg.gmOnly` sur le dossier choisi : une
 * fois posé, ce dossier — et tout son contenu — disparaît du rendu du
 * compendium pour tout non-MJ, quel que soit le type de compendium.
 *
 * Les compendiums sont verrouillés en lecture seule par défaut : cette
 * macro déverrouille elle-même celui qu'on modifie (même logique que
 * "Déverrouiller les Compendiums (MJ)", mais pas limitée à la liste des
 * compendiums du système — un compendium créé dans le monde marche aussi).
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const FLAG_SCOPE = "rpg";
  const FLAG_GM_ONLY = "gmOnly";

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const packs = game.packs.filter(p => p.folders?.size > 0);
  if (!packs.length) {
    ui.notifications.warn("Aucun compendium avec des dossiers à configurer.");
    return;
  }

  const openFolderList = async (pack) => {
    if (pack.locked) {
      await pack.configure({ locked: false });
      ui.notifications.info(`Compendium « ${pack.metadata.label} » déverrouillé.`);
    }

    const folders = Array.from(pack.folders).sort((a, b) => a.name.localeCompare(b.name));
    const rowsHtml = () => folders.map((f, i) => {
      const locked = !!f.getFlag(FLAG_SCOPE, FLAG_GM_ONLY);
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="flex:1">${htmlEscape(f.name)}</span>
          <button type="button" data-idx="${i}" data-role="toggle"
            style="padding:4px 10px;cursor:pointer;border-radius:6px;white-space:nowrap">
            ${locked ? "🔒 MJ uniquement" : "👁️ Visible des joueurs"}
          </button>
        </div>`;
    }).join("");

    let dlg;
    const render = (html) => {
      const root = html?.[0] ?? html;
      const list = root.querySelector("[data-role='list']");
      if (list) list.innerHTML = rowsHtml();
      root.querySelectorAll("[data-role='toggle']").forEach(btn => {
        btn.addEventListener("click", async () => {
          const f = folders[Number(btn.dataset.idx)];
          const locked = !!f.getFlag(FLAG_SCOPE, FLAG_GM_ONLY);
          btn.disabled = true;
          try {
            await f.setFlag(FLAG_SCOPE, FLAG_GM_ONLY, !locked);
          } catch (e) {
            console.error("[RPG] bascule dossier MJ :", e);
            ui.notifications.error("Échec de la mise à jour du dossier.");
          }
          btn.disabled = false;
          render(html);
        });
      });
    };

    dlg = new Dialog({
      title: `Dossiers MJ — ${pack.metadata.label}`,
      content: `
        <p style="font-size:12px;opacity:.8;margin-top:0">
          Un dossier marqué 🔒 disparaît entièrement — lui et son contenu — du
          compendium pour tout joueur, quel que soit par ailleurs ce que leurs
          personnages ont eu en main.
        </p>
        <div data-role="list" style="max-height:50vh;overflow-y:auto"></div>`,
      buttons: { close: { label: "Fermer" } },
      render
    }, { width: 400, height: "auto" });
    dlg.render(true);
  };

  if (packs.length === 1) {
    await openFolderList(packs[0]);
    return;
  }

  const packRowsHtml = packs.map((p, i) => `
    <button type="button" data-idx="${i}"
      style="display:block;width:100%;text-align:left;padding:6px 10px;cursor:pointer;border-radius:6px;margin-bottom:4px">
      <b>${htmlEscape(p.metadata.label)}</b>
      <span style="opacity:.6;font-size:11px"> — ${p.folders.size} dossier(s)</span>
    </button>`).join("");

  let picker;
  picker = new Dialog({
    title: "Choisir un compendium",
    content: `<div style="max-height:50vh;overflow-y:auto">${packRowsHtml}</div>`,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      root.querySelectorAll("[data-idx]").forEach(btn => {
        btn.addEventListener("click", async () => {
          picker.close();
          await openFolderList(packs[Number(btn.dataset.idx)]);
        });
      });
    }
  }, { width: 380, height: "auto" });
  picker.render(true);
})();
