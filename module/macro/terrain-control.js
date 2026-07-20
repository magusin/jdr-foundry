/**
 * Macro "Terrain (MJ)" — Sélecteur de biome avec effets mana
 */
(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }

  const { listBiomes, getActiveBiomeKey, setActiveBiome, ELEMENT_TAGS } =
    game.rpg?.weather ?? {};
  if (!listBiomes) { ui.notifications.error("Module terrain introuvable."); return; }

  const biomes  = listBiomes();
  const current = getActiveBiomeKey();

  const rows = biomes.map(b => {
    const checked = current === b.key;
    const effects = Object.entries(b.manaBonus ?? {})
      .filter(([, v]) => v !== 0)
      .map(([tag, v]) => {
        const td = ELEMENT_TAGS?.[tag];
        const color = v < 0 ? "#1d9e75" : "#c0392b";
        return `<span style="color:${color};font-size:10px;background:${color}18;
          border-radius:3px;padding:1px 4px;white-space:nowrap">${td?.label ?? tag} ${v > 0 ? "+" : ""}${v}</span>`;
      }).join(" ");

    return `
      <label style="display:flex;align-items:flex-start;gap:10px;padding:7px 10px;
        border-radius:8px;cursor:pointer;margin-bottom:4px;
        background:${checked ? "rgba(180,140,60,0.15)" : "rgba(255,255,255,0.03)"};
        border:1px solid ${checked ? "rgba(180,140,60,0.5)" : "rgba(255,255,255,0.08)"}">
        <input type="radio" name="biome" value="${b.key}" ${checked ? "checked" : ""}
          style="width:16px;height:16px;margin-top:2px;flex-shrink:0;cursor:pointer"/>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:20px">${b.icon}</span>
            <span style="font-weight:600;font-size:13px">${b.label}</span>
          </div>
          <div style="font-size:11px;opacity:.6;margin-top:1px">${b.desc}</div>
          ${effects ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">${effects}</div>` :
            `<div style="opacity:.3;font-size:10px;margin-top:2px">Aucun effet sur les sorts</div>`}
        </div>
      </label>`;
  }).join("");

  new Dialog({
    title: "🗺️ Terrain actuel",
    content: `
      <div style="font-size:11px;opacity:.6;margin-bottom:8px;padding:0 4px">
        Le terrain donne des bonus mana permanents cumulés avec la météo.<br>
        Les joueurs voient le terrain actif en haut de l'écran.
      </div>
      <div style="max-height:62vh;overflow-y:auto;padding:0 2px">
        <label style="display:flex;align-items:center;gap:10px;padding:6px 10px;
          border-radius:8px;cursor:pointer;margin-bottom:4px;
          background:${!current ? "rgba(100,100,100,0.2)" : "rgba(255,255,255,0.03)"};
          border:1px solid ${!current ? "rgba(180,180,180,0.4)" : "rgba(255,255,255,0.08)"}">
          <input type="radio" name="biome" value="" ${!current ? "checked" : ""}
            style="width:16px;height:16px;cursor:pointer"/>
          <span style="font-size:13px;opacity:.7">— Aucun terrain défini —</span>
        </label>
        ${rows}
      </div>`,
    buttons: {
      ok: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const key = html[0]?.querySelector("input[name='biome']:checked")?.value ?? "";
          await setActiveBiome(key);
          if (key) {
            const b = biomes.find(x => x.key === key);
            ui.notifications.info(`Terrain : ${b?.icon} ${b?.label}`);
          } else {
            ui.notifications.info("Terrain effacé.");
          }
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "ok",
    options: { width: 420 }
  }).render(true);
})();
