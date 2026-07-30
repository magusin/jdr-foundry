// module/sheets/send-item-dialog.js
//
// Bouton "Envoyer" présent sur chaque fiche d'objet (MJ uniquement) : copie
// l'objet directement vers un ou plusieurs PJ choisis dans une popup, sans
// passer par le glisser-déposer (qui reste possible en parallèle — les deux
// chemins créent le même type de copie embarquée indépendante).

/** Personnages joueurs du monde, triés par nom. */
export function partyCharacters() {
  return game.actors
    .filter(a => a.type === "character")
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/**
 * Ouvre une popup de sélection de destinataires (cases à cocher + "Tous"),
 * puis crée une copie indépendante de l'objet sur chaque PJ choisi.
 * Si une quête est envoyée à plusieurs PJ à la fois, les copies reçoivent un
 * questGroupId commun (comme une quête "partagée") pour que leur progression
 * reste synchronisée sans action supplémentaire du MJ.
 */
export async function promptSendItemToActors(item) {
  if (!game.user.isGM || !item) return;

  const actors = partyCharacters();
  if (!actors.length) {
    ui.notifications?.warn?.("Aucun personnage joueur dans le monde.");
    return;
  }

  const rows = actors.map(a => `
    <label style="display:flex;align-items:center;gap:6px;padding:2px 0">
      <input type="checkbox" data-actor-id="${a.id}" />
      ${a.name}
    </label>`).join("");

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:12px;color:var(--color-text-secondary)">
        Envoyer <b>${item.name}</b> à :
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-weight:600">
        <input type="checkbox" id="send-all" /> Tous les PJ
      </label>
      <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px">${rows}</div>
    </div>`;

  const readSelection = (root) => {
    if (root?.querySelector("#send-all")?.checked) return actors.map(a => a.id);
    return Array.from(root?.querySelectorAll("input[data-actor-id]") ?? [])
      .filter(el => el.checked)
      .map(el => el.dataset.actorId);
  };

  const bindAllToggle = (root) => {
    root?.querySelector("#send-all")?.addEventListener("change", (ev) => {
      root.querySelectorAll("input[data-actor-id]").forEach(el => { el.disabled = ev.target.checked; });
    });
  };

  const selectedIds = await new Promise((resolve) => {
    const DialogClass = foundry?.applications?.api?.DialogV2 ?? globalThis.Dialog;
    const isV2 = DialogClass === foundry?.applications?.api?.DialogV2;

    if (isV2) {
      const dlg = new DialogClass({
        window: { title: `Envoyer « ${item.name} »` },
        content,
        buttons: [
          {
            action: "send",
            label: "📤 Envoyer",
            default: true,
            callback: (_event, _button, dialog) => {
              const root = dialog.element ?? dialog?.form ?? dialog;
              resolve(readSelection(root));
            }
          },
          { action: "cancel", label: "Annuler", callback: () => resolve([]) }
        ],
        close: () => resolve([])
      });
      dlg.render(true).then(() => bindAllToggle(dlg.element));
      return;
    }

    new Dialog({
      title: `Envoyer « ${item.name} »`,
      content,
      render: (html) => bindAllToggle(html?.[0] ?? html),
      buttons: {
        send: { label: "📤 Envoyer", callback: (html) => resolve(readSelection(html?.[0] ?? html)) },
        cancel: { label: "Annuler", callback: () => resolve([]) }
      },
      default: "send",
      close: () => resolve([])
    }, { width: 380 }).render(true);
  });

  if (!selectedIds.length) return;
  const targets = selectedIds.map(id => game.actors.get(id)).filter(Boolean);
  if (!targets.length) return;

  const baseData = item.toObject();
  delete baseData._id;

  if (item.type === "quest" && targets.length > 1) {
    baseData.system = baseData.system ?? {};
    baseData.system.partagee = true;
    baseData.system.questGroupId = baseData.system.questGroupId || foundry.utils.randomID(12);
  }

  const sentTo = [];
  for (const actor of targets) {
    try {
      const [created] = await actor.createEmbeddedDocuments("Item", [foundry.utils.deepClone(baseData)]);
      if (created) sentTo.push(actor.name);
    } catch (e) {
      console.error(`[RPG] Envoi de "${item.name}" à ${actor.name} :`, e);
      ui.notifications?.error?.(`Échec de l'envoi à ${actor.name} — voir la console.`);
    }
  }

  if (sentTo.length) {
    ui.notifications?.info?.(`« ${item.name} » envoyé à ${sentTo.join(", ")}.`);
  }
}

/** Branche le bouton [data-action="sendToActors"] d'une fiche d'objet (idempotent). */
export function bindSendToActorsButton(root, item) {
  const btn = root?.querySelector('[data-action="sendToActors"]');
  if (!btn || btn.dataset.rpgSendBound) return;
  btn.dataset.rpgSendBound = "1";
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (!game.user.isGM) return;
    try { await promptSendItemToActors(item); }
    catch (e) { console.error("[RPG] Envoyer à un PJ :", e); ui.notifications?.error?.("Erreur — voir la console."); }
  });
}
