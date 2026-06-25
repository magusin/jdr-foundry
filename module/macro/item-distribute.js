/**
 * Macro "JDR — Distribuer un Objet (MJ)"
 *
 * Généralise la distribution de recette : permet de donner un Sort, une Arme,
 * une Armure, un Consommable, un Loot ou une Recette à un ou plusieurs PJ
 * (et/ou Monstres) en un clic, en plus du glisser-déposer classique.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const TYPE_LABELS = {
    spell:      "✨ Sort",
    weapon:     "⚔️ Arme",
    armor:      "🛡️ Armure",
    consumable: "🧪 Consommable",
    loot:       "🎁 Objet",
    recipe:     "📖 Recette",
    skill:      "📚 Compétence",
    quest:      "📜 Quête"
  };

  const allItems = game.items
    .filter(i => Object.keys(TYPE_LABELS).includes(i.type))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!allItems.length) {
    ui.notifications.warn("Aucun objet trouvé dans les Objets du monde (sidebar).");
    return;
  }

  const actors = game.actors
    .filter(a => a.type === "character" || a.type === "monster")
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "character" ? -1 : 1;
      return (a.name ?? "").localeCompare(b.name ?? "", "fr");
    });

  if (!actors.length) {
    ui.notifications.warn("Aucun personnage ou monstre trouvé dans le monde.");
    return;
  }

  const hasItem = (actor, itemName, itemType) =>
    actor.items.some(i => i.type === itemType &&
      String(i.name ?? "").trim().toLowerCase() === String(itemName ?? "").trim().toLowerCase());

  const typeOptions = Object.entries(TYPE_LABELS)
    .filter(([type]) => allItems.some(i => i.type === type))
    .map(([type, label]) => `<option value="${type}">${label}</option>`).join("");

  const buildItemOptions = (type) =>
    allItems.filter(i => i.type === type)
      .map(i => `<option value="${i.id}">${htmlEscape(i.name)}</option>`).join("");

  const buildActorBlocks = () => allItems.map(it => {
    const rows = actors.map(actor => {
      const has = hasItem(actor, it.name, it.type);
      const typeTag = actor.type === "character" ? "PJ" : "Monstre";
      return `
        <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;
                       background:${has ? "rgba(29,158,117,0.1)" : "transparent"}">
          <input type="checkbox" class="id-actor-check" value="${actor.id}" ${has ? "disabled checked" : ""} />
          <span style="flex:1">${htmlEscape(actor.name)} <small style="opacity:0.6">(${typeTag})</small></span>
          <span style="font-size:11px;color:${has ? "#1d9e75" : "var(--color-text-secondary)"}">
            ${has ? "✔ Déjà possédé" : "N'a pas"}
          </span>
        </label>`;
    }).join("");

    return `<div class="id-actor-block" data-item-id="${it.id}" style="display:none;flex-direction:column;gap:2px">${rows}</div>`;
  }).join("");

  const firstType = Object.keys(TYPE_LABELS).find(t => allItems.some(i => i.type === t));

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Type</label>
        <select id="id-type" style="width:100%">${typeOptions}</select>
      </div>
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Objet</label>
        <select id="id-item" style="width:100%">${buildItemOptions(firstType)}</select>
      </div>
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Cibles</label>
        <div id="id-actor-list" style="display:flex;flex-direction:column;gap:2px;max-height:260px;overflow-y:auto">
          ${buildActorBlocks()}
        </div>
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Les cibles qui possèdent déjà l'objet sont cochées et grisées (pas de doublon créé).
      </div>
    </div>`;

  const showBlockFor = (root, itemId) => {
    root.querySelectorAll(".id-actor-block").forEach(b => {
      b.style.display = (b.dataset.itemId === itemId) ? "flex" : "none";
    });
  };

  new Dialog({
    title: "Distribuer un Objet",
    content,
    render: (html) => {
      const root = html?.[0] ?? html;
      const typeSel = root.querySelector("#id-type");
      const itemSel = root.querySelector("#id-item");

      showBlockFor(root, itemSel.value);

      typeSel.addEventListener("change", () => {
        itemSel.innerHTML = buildItemOptions(typeSel.value);
        showBlockFor(root, itemSel.value);
      });

      itemSel.addEventListener("change", () => showBlockFor(root, itemSel.value));
    },
    buttons: {
      give: {
        label: "🎁 Donner aux sélectionnés",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const itemId = root.querySelector("#id-item")?.value;
          const item = allItems.find(i => i.id === itemId);
          if (!item) return;

          const activeBlock = root.querySelector(`.id-actor-block[data-item-id="${itemId}"]`);
          const checks = activeBlock
            ? Array.from(activeBlock.querySelectorAll(".id-actor-check:checked:not(:disabled)"))
            : [];

          if (!checks.length) {
            ui.notifications.warn("Aucune cible sélectionnée (ou tous possèdent déjà l'objet).");
            return;
          }

          const itemData = item.toObject();
          delete itemData._id;

          const givenNames = [];
          for (const chk of checks) {
            const actor = game.actors.get(chk.value);
            if (!actor) continue;
            await actor.createEmbeddedDocuments("Item", [itemData]);
            givenNames.push(actor.name);
          }

          await ChatMessage.create({
            content: `
              <div style="font-size:13px">
                🎁 <b>MJ</b> a donné <b>${htmlEscape(item.name)}</b> (${TYPE_LABELS[item.type] ?? item.type}) à :
                <ul>${givenNames.map(n => `<li>${htmlEscape(n)}</li>`).join("")}</ul>
              </div>`
          });

          ui.notifications.info(`"${item.name}" donné à ${givenNames.length} cible(s).`);
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "give"
  }, { width: 460, height: 560 }).render(true);
})();
