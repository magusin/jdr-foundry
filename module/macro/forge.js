/**
 * Macro "Forge" (Foundry VTT v13)
 * - Liste les recettes possédées par le personnage contrôlé
 * - Affiche les ingrédients requis / possédés
 * - Bouton Forger : jet de chance basé sur skill Forge, consomme les ingrédients,
 *   crée l'objet résultat en cas de succès
 */
(async () => {
  const notify = (type, msg) =>
    ui.notifications?.[type]?.(msg) ?? console.log(`[${type}]`, msg);

  const htmlEscape = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const getControlledToken = () => canvas?.tokens?.controlled?.[0] ?? null;
  const getForgeAPI = () => game.rpg?.forge ?? null;

  const token = getControlledToken();
  const actor = token?.actor ?? null;
  if (!actor) return notify("warn", "Contrôle un token avant d'ouvrir la Forge.");

  const forgeAPI = getForgeAPI();
  if (!forgeAPI) return notify("error", "API Forge introuvable (game.rpg.forge).");

  const recipes = actor.items
    .filter(i => i.type === "recipe")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!recipes.length)
    return notify("info", `${actor.name} ne connaît aucune recette. Demande au MJ de t'en donner une.`);

  const forgeLevel = Number(actor.system?.skills?.forge?.level ?? 0) || 0;
  const forgeXp    = Number(actor.system?.skills?.forge?.xp ?? 0) || 0;

  const buildRowsHTML = () => {
    return recipes.map(r => {
      const check  = forgeAPI.checkIngredients(actor, r);
      const chance = forgeAPI.computeForgeChance(actor, r);

      const ingLines = check.results.map(ing =>
        `<span style="color:${ing.ok ? "#1d9e75" : "#c0392b"}">${htmlEscape(ing.name)} (${ing.have}/${ing.need})</span>`
      ).join(", ");

      const resultName = r.system?.result?.name || "(objet non précisé)";

      return `
        <div class="rpg-spell-row" data-item-id="${r.id}" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b>${htmlEscape(r.name)}</b>
            <span style="font-size:11px;color:var(--color-text-secondary)">Chance : <b>${chance}%</b></span>
          </div>
          <div style="font-size:11px">🎁 ${htmlEscape(resultName)}</div>
          <div style="font-size:11px">🧱 ${ingLines || "—"}</div>
          <button type="button" data-action="forge"
            style="padding:4px;border-radius:6px;border:none;cursor:pointer;font-size:12px;
                   background:${check.allOk ? "#1d9e75" : "#888"};color:#fff;opacity:${check.allOk ? "1" : "0.5"}"
            ${check.allOk ? "" : "disabled"}>
            🔨 Forger
          </button>
        </div>`;
    }).join("");
  };

  const content = `
    <div style="max-height:520px;overflow-y:auto">
      <div style="margin-bottom:10px;font-size:12px;color:var(--color-text-secondary)">
        Compétence Forge : niveau <b>${forgeLevel}</b> (XP ${forgeXp})
      </div>
      <div class="rpg-forge-list" style="display:flex;flex-direction:column;gap:10px">
        ${buildRowsHTML()}
      </div>
    </div>`;

  const DialogClass = foundry?.applications?.api?.DialogV2 ?? Dialog;
  const isV2 = DialogClass === foundry?.applications?.api?.DialogV2;

  const dlgCfg = {
    title: `Forge — ${actor.name}`,
    content,
    default: "close"
  };
  if (isV2) dlgCfg.buttons = [{ action: "close", label: "Fermer", default: true }];
  else dlgCfg.buttons = { close: { label: "Fermer" } };

  const dlg = new DialogClass(dlgCfg, { width: 460, height: 600, resizable: true });
  await dlg.render(true);
  await new Promise(r => setTimeout(r, 0));

  const el = dlg?.element instanceof HTMLElement ? dlg.element
    : dlg?.element?.[0] instanceof HTMLElement ? dlg.element[0]
    : dlg?.element?.get?.(0);
  if (!el) return;

  const $root = $(el);
  const rerender = () => $root.find(".rpg-forge-list").html(buildRowsHTML());

  $root.on("click", "[data-action='forge']", async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;

    const row    = btn.closest("[data-item-id]");
    const recipe = actor.items.get(row?.dataset?.itemId);
    if (!recipe) { btn.disabled = false; return; }

    try {
      const result = await forgeAPI.craftRecipe(actor, recipe);
      if (!result.ok) {
        notify("warn", result.reason ?? "Échec de la préparation du craft.");
        btn.disabled = false;
        return;
      }

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: result.content
      });

      notify(result.success ? "info" : "warn", result.success ? "Craft réussi !" : "Craft échoué.");
      rerender();
    } catch (e) {
      console.error("[RPG][Forge]", e);
      notify("error", `Erreur craft : ${e?.message ?? e}`);
      btn.disabled = false;
    }
  });
})();
