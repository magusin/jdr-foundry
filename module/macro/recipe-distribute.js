/**
 * Macro "JDR — Distribuer une Recette (MJ)"
 *
 * Permet au MJ de :
 * - Choisir une recette parmi les Items de type "recipe" présents dans le monde
 * - Voir en un coup d'œil quels PJ la connaissent déjà
 * - Cocher un ou plusieurs PJ pour leur donner une copie de la recette en un clic
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

  const recipes = game.items
    .filter(i => i.type === "recipe")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!recipes.length) {
    ui.notifications.warn("Aucune recette trouvée dans les Objets du monde. Crée d'abord un Item de type 'Recipe'.");
    return;
  }

  const pjs = game.actors
    .filter(a => a.type === "character")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!pjs.length) {
    ui.notifications.warn("Aucun personnage (character) trouvé dans le monde.");
    return;
  }

  const knowsRecipe = (actor, recipeName) =>
    actor.items.some(i => i.type === "recipe" &&
      String(i.name ?? "").trim().toLowerCase() === String(recipeName ?? "").trim().toLowerCase());

  // Construit un bloc PJ par recette, on bascule l'affichage en JS (pas de re-render réseau)
  const buildAllPjBlocks = () => recipes.map(r => {
    const rows = pjs.map(pj => {
      const has = knowsRecipe(pj, r.name);
      return `
        <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;
                       background:${has ? "rgba(29,158,117,0.1)" : "transparent"}">
          <input type="checkbox" class="rd-pj-check" value="${pj.id}" ${has ? "disabled checked" : ""} />
          <span style="flex:1">${htmlEscape(pj.name)}</span>
          <span style="font-size:11px;color:${has ? "#1d9e75" : "var(--color-text-secondary)"}">
            ${has ? "✔ Déjà apprise" : "Ne connaît pas"}
          </span>
        </label>`;
    }).join("");

    return `<div class="rd-pj-block" data-recipe-id="${r.id}" style="display:none;flex-direction:column;gap:2px">${rows}</div>`;
  }).join("");

  const recipeOptions = recipes.map(r =>
    `<option value="${r.id}">${htmlEscape(r.name)}</option>`
  ).join("");

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Recette à distribuer</label>
        <select id="rd-recipe" name="rd-recipe" style="width:100%">${recipeOptions}</select>
      </div>
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Personnages</label>
        <div id="rd-pj-list" style="display:flex;flex-direction:column;gap:2px;max-height:260px;overflow-y:auto">
          ${buildAllPjBlocks()}
        </div>
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Les PJ qui connaissent déjà la recette sont cochés et grisés (pas de doublon créé).
      </div>
    </div>`;

  const showBlockFor = (root, recipeId) => {
    root.querySelectorAll(".rd-pj-block").forEach(b => {
      b.style.display = (b.dataset.recipeId === recipeId) ? "flex" : "none";
    });
  };

  new Dialog({
    title: "Distribuer une Recette",
    content,
    render: (html) => {
      const root = html?.[0] ?? html;
      const sel  = root.querySelector("#rd-recipe");
      if (!sel) return;
      showBlockFor(root, sel.value);
      sel.addEventListener("change", () => showBlockFor(root, sel.value));
    },
    buttons: {
      give: {
        label: "🎁 Donner aux sélectionnés",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const recipeId = root.querySelector("#rd-recipe")?.value;
          const recipe   = recipes.find(r => r.id === recipeId);
          if (!recipe) return;

          const activeBlock = root.querySelector(`.rd-pj-block[data-recipe-id="${recipeId}"]`);
          const checks = activeBlock
            ? Array.from(activeBlock.querySelectorAll(".rd-pj-check:checked:not(:disabled)"))
            : [];

          if (!checks.length) {
            ui.notifications.warn("Aucun PJ sélectionné (ou tous la connaissent déjà).");
            return;
          }

          const itemData = recipe.toObject();
          delete itemData._id;

          const givenNames = [];
          for (const chk of checks) {
            const pj = game.actors.get(chk.value);
            if (!pj) continue;
            await pj.createEmbeddedDocuments("Item", [itemData]);
            givenNames.push(pj.name);
          }

          await ChatMessage.create({
            content: `
              <div style="font-size:13px">
                📖 <b>MJ</b> a donné la recette <b>${htmlEscape(recipe.name)}</b> à :
                <ul>${givenNames.map(n => `<li>${htmlEscape(n)}</li>`).join("")}</ul>
              </div>`
          });

          ui.notifications.info(`Recette "${recipe.name}" donnée à ${givenNames.length} PJ.`);
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "give"
  }, { width: 440, height: 520 }).render(true);
})();
