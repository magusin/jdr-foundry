/**
 * Macro "JDR — Distribuer un Objet (MJ)"
 *
 * Généralise la distribution de recette : permet de donner un Sort, une Arme,
 * une Armure, une Relique, un Consommable, un Loot ou une Recette à un ou plusieurs PJ
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
    relic:      "✨ Relique",
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

  // PJ, puis PNJ, puis monstres — un PNJ est un acteur `character` comme un
  // PJ, seul rules/actor-roles.js (exposé sur game.rpg.actorRoles, une macro
  // ne pouvant pas importer) sait les distinguer. Sans ce tri, les PNJ du
  // monde se mélangeaient aux PJ dans la liste des cibles.
  const roles = game.rpg?.actorRoles ?? null;
  const isNpc = (a) => !!roles?.isNpcActor?.(a);
  const roleOf = (a) => roles?.roleLabel?.(a) ?? (a.type === "character" ? "PJ" : "Monstre");
  const rank = (a) => (a.type === "monster" ? 2 : (isNpc(a) ? 1 : 0));

  const actors = game.actors
    .filter(a => a.type === "character" || a.type === "monster")
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (a.name ?? "").localeCompare(b.name ?? "", "fr");
    });

  if (!actors.length) {
    ui.notifications.warn("Aucun personnage ou monstre trouvé dans le monde.");
    return;
  }

  const hasItem = (actor, itemName, itemType) =>
    actor.items.some(i => i.type === itemType &&
      String(i.name ?? "").trim().toLowerCase() === String(itemName ?? "").trim().toLowerCase());

  // Les Objets (loot) s'empilent : « déjà possédé » n'est plus une raison
  // de griser la cible, on lui en donne un de plus (voir rules/inventory.js,
  // exposé sur game.rpg.inventory — une macro ne peut pas importer).
  const inventoryApi = game.rpg?.inventory ?? null;
  const isStackable = (type) => !!inventoryApi?.isStackableType?.(type);

  const ownedQty = (actor, itemName, itemType) => {
    let total = 0;
    for (const i of actor.items) {
      if (i.type !== itemType) continue;
      if (String(i.name ?? "").trim().toLowerCase() !== String(itemName ?? "").trim().toLowerCase()) continue;
      total += Math.max(0, Math.floor(Number(i.system?.qte ?? 1)) || 0);
    }
    return total;
  };

  const typeOptions = Object.entries(TYPE_LABELS)
    .filter(([type]) => allItems.some(i => i.type === type))
    .map(([type, label]) => `<option value="${type}">${label}</option>`).join("");

  const buildItemOptions = (type) =>
    allItems.filter(i => i.type === type)
      .map(i => `<option value="${i.id}">${htmlEscape(i.name)}</option>`).join("");

  const GROUP_TITLES = ["👤 Personnages joueurs", "🎭 PNJ", "👹 Monstres"];

  const buildActorBlocks = () => allItems.map(it => {
    const stackable = isStackable(it.type);
    let lastRank = -1;
    const rows = actors.map(actor => {
      const has = hasItem(actor, it.name, it.type);
      const r = rank(actor);
      // En-tête de groupe dès que la catégorie change : les PJ ne se
      // confondent plus avec les PNJ, et « tout cocher » agit sur un seul
      // groupe (donner à tous les PJ sans arroser les PNJ au passage).
      const header = r === lastRank ? "" : `
        <label style="display:flex;align-items:center;gap:6px;margin:8px 0 2px;font-size:11px;
                       font-weight:600;opacity:.75;text-transform:uppercase;letter-spacing:.04em">
          <input type="checkbox" class="id-group-all" data-rank="${r}" title="Tout cocher dans ce groupe" />
          ${GROUP_TITLES[r]}
        </label>`;
      lastRank = r;

      // Objet empilable déjà possédé : cible toujours sélectionnable (on
      // ajoutera +1 à sa pile). Les autres types restent grisés — un 2e
      // exemplaire d'arme/armure/sort n'a pas de sens ici.
      const lock = has && !stackable;
      const statut = has
        ? (stackable ? `✔ Possédé ×${ownedQty(actor, it.name, it.type)}` : "✔ Déjà possédé")
        : "N'a pas";
      return `${header}
        <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;
                       background:${has ? "rgba(29,158,117,0.1)" : "transparent"}">
          <input type="checkbox" class="id-actor-check" data-rank="${r}" value="${actor.id}" ${lock ? "disabled checked" : ""} />
          <span style="flex:1">${htmlEscape(actor.name)} <small style="opacity:0.6">(${roleOf(actor)})</small></span>
          <span style="font-size:11px;color:${has ? "#1d9e75" : "var(--color-text-secondary)"}">
            ${statut}
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
        Les cibles qui possèdent déjà l'objet sont cochées et grisées (pas de doublon créé).<br>
        Exception : les <b>Objets</b> s'empilent — une cible qui en possède déjà reste
        sélectionnable et voit simplement sa quantité augmenter.
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

      // « Tout cocher » d'un groupe (PJ / PNJ / Monstres) — délégué, car
      // chaque objet a son propre bloc de cases régénéré à la volée.
      root.addEventListener("change", (ev) => {
        const toggle = ev.target?.closest?.(".id-group-all");
        if (!toggle) return;
        const block = toggle.closest(".id-actor-block");
        block?.querySelectorAll(`.id-actor-check[data-rank="${toggle.dataset.rank}"]`)
          .forEach(cb => { if (!cb.disabled) cb.checked = toggle.checked; });
      });
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

          // ✅ Quête : distribGroupId dans tous les cas (traçabilité "qui a
          // cette quête", relu par la fiche source), + questGroupId si
          // partagée (synchronise la progression entre les copies).
          if (item.type === "quest" && game.rpg?.questGroup) {
            const distribId = await game.rpg.questGroup.ensureDistribGroupId(item);
            if (distribId && itemData.system) itemData.system.distribGroupId = distribId;
            if (item.system?.partagee) {
              const gid = await game.rpg.questGroup.ensureQuestGroupId(item);
              if (gid && itemData.system) itemData.system.questGroupId = gid;
            }
          }

          const givenNames = [];
          for (const chk of checks) {
            const actor = game.actors.get(chk.value);
            if (!actor) continue;
            // Empilement des Objets déjà possédés (game.rpg.inventory) ;
            // repli sur la création directe si l'API manque (système à jour
            // partiellement, monde ouvert avant rechargement).
            if (inventoryApi?.addItemToActor) {
              const res = await inventoryApi.addItemToActor(actor, itemData);
              // Plafond d'encombrement atteint : rien n'a été ajouté, et le
              // nom ne doit pas apparaître dans le récapitulatif « donné à ».
              if (res.refused) { ui.notifications?.warn?.(res.reason); continue; }
              givenNames.push(res.stacked ? `${actor.name} (×${res.total})` : actor.name);
            } else {
              await actor.createEmbeddedDocuments("Item", [foundry.utils.deepClone(itemData)]);
              givenNames.push(actor.name);
            }
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
