/**
 * Macro "Météo (MJ)" — Sélecteur multi-conditions avec aperçu des effets mana
 */
(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }

  const { listWeathers, getActiveWeatherKeys, setActiveWeathers, ELEMENT_TAGS } =
    game.rpg?.weather ?? {};
  if (!listWeathers) { ui.notifications.error("Module météo introuvable."); return; }

  const weathers = listWeathers();
  const current  = getActiveWeatherKeys();

  const rows = weathers.map(w => {
    const checked = current.includes(w.key);

    // Calculer tous les effets mana de cette condition
    const effects = Object.entries(w.manaReduction ?? {})
      .filter(([, v]) => v !== 0)
      .map(([tag, v]) => {
        const td = ELEMENT_TAGS?.[tag];
        const color = v < 0 ? "#1d9e75" : "#c0392b";
        const sign  = v < 0 ? "" : "+";
        return `<span style="color:${color};font-size:10px;background:${color}18;
          border-radius:3px;padding:1px 4px;white-space:nowrap">${td?.label ?? tag} ${sign}${v}</span>`;
      }).join(" ");

    return `
      <label style="display:flex;align-items:flex-start;gap:10px;padding:7px 10px;
        border-radius:8px;cursor:pointer;margin-bottom:4px;
        background:${checked ? "rgba(155,89,182,0.15)" : "rgba(255,255,255,0.03)"};
        border:1px solid ${checked ? "rgba(155,89,182,0.5)" : "rgba(255,255,255,0.08)"};
        transition:background 0.1s">
        <input type="checkbox" name="weather" value="${w.key}" ${checked ? "checked" : ""}
          style="width:16px;height:16px;margin-top:2px;flex-shrink:0;cursor:pointer"/>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:20px">${w.icon}</span>
            <span style="font-weight:600;font-size:13px">${w.label}</span>
          </div>
          ${effects ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">${effects}</div>` :
            `<div style="opacity:.35;font-size:10px;margin-top:2px">Aucun effet sur les sorts</div>`}
        </div>
      </label>`;
  }).join("");

  new Dialog({
    title: "🌤️ Conditions météo",
    content: `
      <div style="font-size:11px;opacity:.6;margin-bottom:8px;padding:0 4px">
        Coche une ou plusieurs conditions. Les effets mana s'additionnent.<br>
        Le HUD en haut de l'écran affiche les conditions actives pour tous les joueurs.
      </div>
      <div style="max-height:62vh;overflow-y:auto;padding:0 2px">
        ${rows}
      </div>`,
    buttons: {
      clear: {
        label: "✕ Tout effacer",
        callback: async () => {
          await setActiveWeathers([]);
          ui.notifications.info("Conditions météo effacées.");
        }
      },
      ok: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const checked = [...html[0].querySelectorAll("input[name='weather']:checked")]
            .map(el => el.value);
          await setActiveWeathers(checked);
          const labels = checked.map(k => listWeathers().find(w => w.key === k)?.icon + " " +
            listWeathers().find(w => w.key === k)?.label).join(", ");
          await ChatMessage.create({
            content: `<div style="text-align:center;font-size:13px;padding:4px">
              🌤️ <b>Météo</b> : ${labels || "Aucune condition"}
            </div>`
          });
          ui.notifications.info(`Météo : ${labels || "effacée"}`);
        }
      }
    },
    default: "ok",
    options: { width: 420 }
  }).render(true);
})();
