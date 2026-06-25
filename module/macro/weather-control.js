/**
 * Macro "JDR — Météo (MJ)"
 *
 * Change la météo courante du monde. Influence directement la magie
 * élémentaire : un sort Feu sera amplifié par temps de canicule et
 * atténué par la pluie, et inversement pour les autres éléments.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const weatherAPI = game.rpg?.weather;
  if (!weatherAPI) {
    ui.notifications.error("API weather introuvable (game.rpg.weather).");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const weathers = weatherAPI.listWeathers();
  const current = weatherAPI.getCurrentWeatherKey();

  const options = weathers.map(w => {
    const boostTxt  = w.boost.length  ? `↑ ${w.boost.join(", ")}`  : "";
    const weakenTxt = w.weaken.length ? `↓ ${w.weaken.join(", ")}` : "";
    const desc = [boostTxt, weakenTxt].filter(Boolean).join(" · ");
    return `<option value="${w.key}" ${w.key === current ? "selected" : ""}>${htmlEscape(w.label)}${desc ? ` (${desc})` : ""}</option>`;
  }).join("");

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Météo actuelle</label>
        <select id="wc-select" style="width:100%">${options}</select>
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary)">
        ↑ = éléments amplifiés (durée et dégâts augmentés) · ↓ = éléments atténués
      </div>
    </div>`;

  new Dialog({
    title: "Météo (MJ)",
    content,
    buttons: {
      apply: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const key = root.querySelector("#wc-select")?.value;
          const def = weatherAPI.getWeatherDef(key);

          await weatherAPI.setCurrentWeather(key);

          await ChatMessage.create({
            content: `🌤️ <b>Météo</b> : <b>${htmlEscape(def.label)}</b>` +
              (def.boost.length ? `<br>↑ Amplifié : ${def.boost.join(", ")}` : "") +
              (def.weaken.length ? `<br>↓ Atténué : ${def.weaken.join(", ")}` : "")
          });

          if (game.rpg?.journal) {
            game.rpg.journal.appendToCampaignJournal(`La météo change : <b>${htmlEscape(def.label)}</b>.`).catch(() => {});
          }

          ui.notifications.info(`Météo changée : ${def.label}`);
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "apply"
  }, { width: 380 }).render(true);
})();
