/**
 * Macro "Météo (MJ)"
 * Permet de choisir la météo actuelle avec aperçu des effets sur les sorts.
 * La météo choisie affecte le coût mana des sorts élémentaires en temps réel.
 */
(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }

  const { listWeathers, getCurrentWeatherKey, setCurrentWeather, ELEMENT_TAGS } = game.rpg?.weather ?? {};
  if (!listWeathers) { ui.notifications.error("Module météo introuvable."); return; }

  const weathers = listWeathers();
  const current  = getCurrentWeatherKey();

  const rows = weathers.map(w => {
    const isActive = w.key === current;
    const effects  = [];

    // Boosts (coût réduit)
    for (const tag of w.boost ?? []) {
      const mult = w.manaCostMult?.[tag];
      if (mult && mult < 1) {
        const tagDef = ELEMENT_TAGS?.[tag];
        effects.push(`<span style="color:#1d9e75;font-size:10px">▼ ${tagDef?.label ?? tag} ×${mult}</span>`);
      }
    }
    // Weaken (coût augmenté)
    for (const tag of w.weaken ?? []) {
      const mult = w.manaCostMult?.[tag];
      if (mult && mult > 1) {
        const tagDef = ELEMENT_TAGS?.[tag];
        effects.push(`<span style="color:#c0392b;font-size:10px">▲ ${tagDef?.label ?? tag} ×${mult}</span>`);
      }
    }

    const effectStr = effects.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px">${effects.join("")}</div>`
      : `<div style="opacity:.4;font-size:10px">Aucun effet élémentaire</div>`;

    return `
      <label style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;
        background:${isActive ? "rgba(155,89,182,0.15)" : "rgba(255,255,255,0.03)"};
        border:1px solid ${isActive ? "rgba(155,89,182,0.4)" : "rgba(255,255,255,0.08)"};
        margin-bottom:4px">
        <input type="radio" name="weather" value="${w.key}" ${isActive ? "checked" : ""}
          style="margin-top:3px;flex-shrink:0"/>
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">${w.icon} ${w.label}</div>
          <div style="font-size:11px;opacity:.7;margin-top:1px">${w.desc}</div>
          ${effectStr}
        </div>
      </label>`;
  }).join("");

  new Dialog({
    title: "🌤️ Météo actuelle",
    content: `
      <div style="max-height:65vh;overflow-y:auto;padding:4px">
        <div style="font-size:11px;opacity:.6;margin-bottom:8px">
          La météo modifie le coût mana des sorts élémentaires (visible sur les fiches de sort).
        </div>
        ${rows}
      </div>`,
    buttons: {
      ok: {
        label: "Appliquer",
        callback: async (html) => {
          const key = html[0]?.querySelector("input[name='weather']:checked")?.value;
          if (!key) return;
          await setCurrentWeather(key);
          // Rafraîchit toutes les fiches de sort ouvertes
          for (const app of Object.values(ui.windows ?? {})) {
            if (app.document?.type === "spell") {
              try { app.render({ force: true }); } catch { /* ignore */ }
            }
          }
          ui.notifications.info(`Météo changée : ${weathers.find(w => w.key === key)?.label}`);
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "ok",
    options: { width: 440 }
  }).render(true);
})();
