// module/rules/weather-library.js
// Gestion des conditions météo multiples simultanées.
// Le MJ peut cocher plusieurs conditions (ex: Orageux + Forte chaleur).
// Les effets sur le mana s'additionnent par tag élémentaire.

export const WEATHER_LIBRARY = {
  ensoleille:   { key: "ensoleille",   label: "Ensoleillé",    icon: "☀️",  manaReduction: { feu: -1, lumiere: -1, obscurite: 1, glace: 1 } },
  nuageux:      { key: "nuageux",      label: "Nuageux",       icon: "⛅",  manaReduction: {} },
  pluie_legere: { key: "pluie_legere", label: "Pluie légère",  icon: "🌦️", manaReduction: { eau: -1, feu: 1 } },
  forte_pluie:  { key: "forte_pluie",  label: "Forte pluie",   icon: "🌧️", manaReduction: { eau: -1, eclair: -1, feu: 1, air: 1 } },
  orageux:      { key: "orageux",      label: "Orageux",       icon: "⛈️", manaReduction: { eclair: -2, eau: -1, air: -1, feu: 2, terre: 1 } },
  forte_chaleur:{ key: "forte_chaleur",label: "Forte chaleur", icon: "🌡️", manaReduction: { feu: -2, terre: -1, glace: 2, eau: 1, air: 1 } },
  gel:          { key: "gel",          label: "Gel",           icon: "❄️",  manaReduction: { glace: -2, air: -1, feu: 2, lumiere: 1 } },
  vent_fort:    { key: "vent_fort",    label: "Vent fort",     icon: "💨", manaReduction: { air: -1, feu: 1, terre: 1 } },
  brouillard:   { key: "brouillard",   label: "Brouillard",    icon: "🌫️", manaReduction: { obscurite: -1, eau: -1, feu: 1, lumiere: 1, eclair: 1 } },
  nuit_claire:  { key: "nuit_claire",  label: "Nuit claire",   icon: "🌙", manaReduction: { obscurite: -1, glace: -1, feu: 1, lumiere: 1 } },
};

export const ELEMENT_TAGS = {
  feu:       { label: "Feu 🔥",       color: "#e05a00" },
  eau:       { label: "Eau 💧",        color: "#2980b9" },
  eclair:    { label: "Éclair ⚡",    color: "#f1c40f" },
  glace:     { label: "Glace ❄️",     color: "#85c1e9" },
  air:       { label: "Air 💨",        color: "#abebc6" },
  terre:     { label: "Terre 🌍",     color: "#7d6608" },
  lumiere:   { label: "Lumière ✨",   color: "#f9e79f" },
  obscurite: { label: "Obscurité 🌑", color: "#6c3483" },
  neutre:    { label: "Neutre",        color: "#7f8c8d" },
};

export function listWeathers() { return Object.values(WEATHER_LIBRARY); }
export function getWeatherDef(key) { return WEATHER_LIBRARY[key] ?? null; }

/** Retourne les clés des conditions actives */
export function getActiveWeatherKeys() {
  try {
    const arr = game.settings.get("rpg", "activeWeathers");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Retourne les définitions des conditions actives */
export function getActiveWeathers() {
  return getActiveWeatherKeys().map(k => WEATHER_LIBRARY[k]).filter(Boolean);
}

/**
 * Calcule la réduction mana TOTALE pour un tag élémentaire
 * en combinant toutes les conditions actives.
 */
export function getManaCostReduction(tag) {
  if (!tag || tag === "neutre") return 0;
  const actives = getActiveWeathers();
  return actives.reduce((sum, w) => sum + (w.manaReduction?.[tag] ?? 0), 0);
}

export function getManaCostMultiplier() { return 1; } // compat

/**
 * Modificateurs sur durée/dégâts des sorts (inchangé).
 */
export function getWeatherModifierFor(tag) {
  if (!tag) return { durationReduction: 0, dotReductionPct: 0 };
  const actives = getActiveWeathers();
  let dur = 0, dot = 0;
  for (const w of actives) {
    const boosts = Object.entries(w.manaReduction ?? {})
      .filter(([t]) => t === tag)
      .map(([, v]) => v);
    for (const v of boosts) {
      if (v < 0) { dur -= 1; dot -= 20; }
      else if (v > 0) { dur += 1; dot += 20; }
    }
  }
  return { durationReduction: Math.sign(dur), dotReductionPct: Math.sign(dot) * 20 };
}

/**
 * Met à jour les conditions actives et rafraîchit le HUD.
 */
export async function setActiveWeathers(keys) {
  const valid = keys.filter(k => WEATHER_LIBRARY[k]);
  await game.settings.set("rpg", "activeWeathers", valid);
  refreshWeatherHUD();

  // Effets visuels Foundry V13 sur la scène active
  const scene = game.scenes?.active;
  if (scene) {
    const fx = keys.includes("forte_pluie") || keys.includes("orageux") ? "rain"
      : keys.includes("pluie_legere") ? "rain"
      : keys.includes("gel") ? "snow"
      : keys.includes("brouillard") ? "fog"
      : keys.includes("vent_fort") ? "leaves"
      : "";
    try { await scene.update({ "environment.weather.effect": fx }); } catch { /* V13 */ }
  }
}

// ─── HUD MÉTÉO ────────────────────────────────────────────────────────────────

let _hudEl = null;

export function refreshWeatherHUD() {
  if (_hudEl) { _hudEl.remove(); _hudEl = null; }

  const actives = getActiveWeathers();
  if (!actives.length && !game.user.isGM) return;

  const el = document.createElement("div");
  el.id = "rpg-weather-hud";
  el.style.cssText = `
    position:fixed; top:10px; left:50%; transform:translateX(-50%);
    z-index:90; display:flex; gap:6px; align-items:center;
    background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.15);
    border-radius:20px; padding:4px 12px; backdrop-filter:blur(4px);
    pointer-events:${game.user.isGM ? "auto" : "none"};
    cursor:${game.user.isGM ? "pointer" : "default"};
    font-size:13px; color:#eee; user-select:none;
  `;

  if (actives.length) {
    el.innerHTML = actives.map(w =>
      `<span title="${w.label}" style="font-size:18px">${w.icon}</span>`
    ).join("") + `<span style="font-size:11px;opacity:.7;margin-left:2px">${
      actives.map(w => w.label).join(", ")
    }</span>`;
  } else {
    el.innerHTML = `<span style="opacity:.5;font-size:12px">⛅ Aucune météo</span>`;
  }

  // Clic MJ → ouvre le sélecteur météo
  if (game.user.isGM) {
    el.addEventListener("click", () => openWeatherDialog());
    el.title = "Cliquer pour changer la météo";
  }

  document.body.appendChild(el);
  _hudEl = el;
}

/** Appelé au hook ready et à chaque changement de setting */
export function initWeatherHUD() {
  refreshWeatherHUD();
  // Écoute les changements de setting (broadcast temps réel aux joueurs)
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === "rpg.activeWeathers") refreshWeatherHUD();
  });
}

// ─── SYSTÈME DE TERRAIN / BIOME ──────────────────────────────────────────────
// Le terrain représente l'environnement global où se trouvent les joueurs.
// Un seul terrain actif à la fois. Bonus mana plus subtils que la météo (-1/+1 max).

export const TERRAIN_BIOMES = {
  // ── Extérieur ─────────────────────────────────────────────────────────
  plaine:      { key: "plaine",       label: "Plaine",            icon: "🌾", manaBonus: { air: -1 },                    desc: "Vastes étendues dégagées. L'air circule librement." },
  foret:       { key: "foret",        label: "Forêt",             icon: "🌲", manaBonus: { terre: -1, eau: -1 },          desc: "Sous-bois dense. La nature amplifie terre et eau." },
  montagne:    { key: "montagne",     label: "Montagne",          icon: "⛰️", manaBonus: { terre: -1, air: -1 },         desc: "Hauteurs rocheuses. Terre et air y sont puissants." },
  enneige:     { key: "enneige",      label: "Région enneigée",  icon: "🏔️", manaBonus: { glace: -1, eau: -1 },        desc: "Neige et glace à perte de vue. Cryo-magie favorisée." },
  desert:      { key: "desert",       label: "Désert",            icon: "🏜️", manaBonus: { feu: -1, terre: -1 },        desc: "Chaleur aride. Le sable et le feu dominent." },
  marecage:    { key: "marecage",     label: "Marécage",          icon: "🌿", manaBonus: { eau: -1, obscurite: -1 },      desc: "Eaux stagnantes et brumes. Eau et obscurité renforcées." },
  cote:        { key: "cote",         label: "Côte marine",       icon: "🌊", manaBonus: { eau: -1, air: -1 },           desc: "Embruns et vagues. L'eau et l'air y sont chez eux." },
  volcan:      { key: "volcan",       label: "Zone volcanique",   icon: "🌋", manaBonus: { feu: -2, terre: -1 },         desc: "Lave et cendres. Le feu brûle sans contrainte." },
  plaine_arc:  { key: "plaine_arc",   label: "Plaine arctique",   icon: "🧊", manaBonus: { glace: -1, air: -1 },        desc: "Toundra gelée. La glace et les vents dominent." },
  foret_arc:   { key: "foret_arc",    label: "Forêt hivernale",   icon: "🎄", manaBonus: { glace: -1, terre: -1 },      desc: "Arbres givrés. Froid et nature entrelacés." },
  jungle:      { key: "jungle",       label: "Jungle",            icon: "🦜", manaBonus: { terre: -1, eau: -1, air: -1 }, desc: "Végétation luxuriante. Énergie naturelle intense." },
  // ── Intérieur / Souterrain ────────────────────────────────────────────
  grotte:      { key: "grotte",       label: "Grotte naturelle",  icon: "🕳️", manaBonus: { terre: -1, obscurite: -1, air: 1 }, desc: "Cavités rocheuses. La terre domine, l'air manque." },
  caverne_glace:{ key: "caverne_glace",label: "Caverne de glace", icon: "🌨️", manaBonus: { glace: -2, obscurite: -1 },  desc: "Glace éternelle. La cryo-magie est extrêmement puissante." },
  donjon:      { key: "donjon",       label: "Donjon / Forteresse",icon: "🏰", manaBonus: { obscurite: -1, terre: -1 }, desc: "Pierre et ombre. La magie noire et terrestre y prospère." },
  catacombe:   { key: "catacombe",    label: "Catacombes",        icon: "💀", manaBonus: { obscurite: -2, lumiere: 1 }, desc: "Couloirs de mort. L'obscurité est à son comble." },
  temple:      { key: "temple",       label: "Temple / Sanctuaire",icon: "⛩️", manaBonus: { lumiere: -1, obscurite: -1 }, desc: "Lieu de culte. Les deux côtés de la magie répondent." },
  mine:        { key: "mine",         label: "Mine",              icon: "⛏️", manaBonus: { terre: -2, air: 1 },         desc: "Galeries creusées. La terre est omniprésente, l'air rare." },
  // ── Magique / Spécial ─────────────────────────────────────────────────
  ruines:      { key: "ruines",       label: "Ruines antiques",   icon: "🏛️", manaBonus: { lumiere: -1, obscurite: -1 }, desc: "Anciens vestiges. La magie ancienne résonne encore." },
  nexus:       { key: "nexus",        label: "Nexus magique",     icon: "✨", manaBonus: { feu: -1, eau: -1, eclair: -1, glace: -1, air: -1, terre: -1, lumiere: -1, obscurite: -1 }, desc: "Carrefour d'énergie. Tous les éléments sont amplifiés." },
  abysses:     { key: "abysses",      label: "Abysses",           icon: "🌑", manaBonus: { obscurite: -2, eau: -1, lumiere: 2 }, desc: "Profondeurs insondables. L'obscurité règne en maître." },
};

export function listBiomes() { return Object.values(TERRAIN_BIOMES); }
export function getBiomeDef(key) { return TERRAIN_BIOMES[key] ?? null; }

export function getActiveBiomeKey() {
  try { return game.settings.get("rpg", "activeBiome") ?? ""; } catch { return ""; }
}

export function getActiveBiome() {
  const key = getActiveBiomeKey();
  return key ? TERRAIN_BIOMES[key] : null;
}

/**
 * Retourne la réduction mana du terrain pour un tag.
 * Se cumule avec la météo.
 */
export function getBiomeManaBonus(tag) {
  if (!tag || tag === "neutre") return 0;
  const biome = getActiveBiome();
  return biome?.manaBonus?.[tag] ?? 0;
}

export async function setActiveBiome(key) {
  const valid = key && TERRAIN_BIOMES[key] ? key : "";
  await game.settings.set("rpg", "activeBiome", valid);
  refreshBiomeHUD();
  if (valid) {
    const def = TERRAIN_BIOMES[valid];
    const effects = Object.entries(def.manaBonus ?? {})
      .filter(([, v]) => v !== 0)
      .map(([tag, v]) => {
        const td = ELEMENT_TAGS[tag];
        return v < 0
          ? `<span style="color:#1d9e75">${td?.label ?? tag} ${v} mana</span>`
          : `<span style="color:#c0392b">${td?.label ?? tag} +${v} mana</span>`;
      }).join(" · ");
    await ChatMessage.create({
      content: `<div style="text-align:center;font-size:13px;padding:4px">
        ${def.icon} <b>Terrain : ${def.label}</b><br>
        <span style="opacity:.7;font-size:11px">${def.desc}</span>
        ${effects ? `<div style="margin-top:4px;font-size:11px">${effects}</div>` : ""}
      </div>`
    });
  }
}

// ─── HUD TERRAIN ──────────────────────────────────────────────────────────────

let _biomeHudEl = null;

export function refreshBiomeHUD() {
  if (_biomeHudEl) { _biomeHudEl.remove(); _biomeHudEl = null; }
  const biome = getActiveBiome();
  if (!biome && !game.user?.isGM) return;

  const el = document.createElement("div");
  el.id = "rpg-biome-hud";
  el.style.cssText = `
    position:fixed; top:48px; left:50%; transform:translateX(-50%);
    z-index:90; display:flex; gap:6px; align-items:center;
    background:rgba(20,12,0,0.6); border:1px solid rgba(180,140,60,0.3);
    border-radius:20px; padding:3px 12px; backdrop-filter:blur(4px);
    pointer-events:${game.user?.isGM ? "auto" : "none"};
    cursor:${game.user?.isGM ? "pointer" : "default"};
    font-size:13px; color:#eee; user-select:none;
  `;

  if (biome) {
    el.innerHTML = `<span style="font-size:16px">${biome.icon}</span>
      <span style="font-size:11px;opacity:.8">${biome.label}</span>`;
  } else {
    el.innerHTML = `<span style="opacity:.4;font-size:11px">🗺️ Aucun terrain</span>`;
  }

  if (game.user?.isGM) {
    el.addEventListener("click", () => openBiomeDialog());
    el.title = "Cliquer pour changer le terrain";
  }

  document.body.appendChild(el);
  _biomeHudEl = el;
}

export function initBiomeHUD() {
  refreshBiomeHUD();
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === "rpg.activeBiome") refreshBiomeHUD();
  });
}

// ─── DIALOGS APPELÉS DIRECTEMENT DEPUIS LES HUDS ─────────────────────────────

export function openWeatherDialog() {
  if (!game.user?.isGM) return;
  const weathers = listWeathers();
  const current  = getActiveWeatherKeys();

  const rows = weathers.map(w => {
    const checked = current.includes(w.key);
    const effects = Object.entries(w.manaReduction ?? {}).filter(([,v]) => v !== 0)
      .map(([tag,v]) => {
        const td = ELEMENT_TAGS[tag];
        const color = v < 0 ? "#1d9e75" : "#c0392b";
        return `<span style="color:${color};font-size:10px;background:${color}18;border-radius:3px;padding:1px 4px">${td?.label ?? tag} ${v > 0 ? "+" : ""}${v}</span>`;
      }).join(" ");
    return `<label style="display:flex;align-items:flex-start;gap:10px;padding:6px 8px;border-radius:8px;cursor:pointer;margin-bottom:3px;
        background:${checked ? "rgba(155,89,182,0.15)" : "rgba(255,255,255,0.03)"};
        border:1px solid ${checked ? "rgba(155,89,182,0.5)" : "rgba(255,255,255,0.08)"}">
      <input type="checkbox" name="weather" value="${w.key}" ${checked ? "checked" : ""} style="width:16px;height:16px;margin-top:2px;cursor:pointer"/>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:18px">${w.icon}</span><span style="font-weight:600;font-size:12px">${w.label}</span></div>
        ${effects ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">${effects}</div>` : `<div style="opacity:.3;font-size:10px">Aucun effet</div>`}
      </div></label>`;
  }).join("");

  new Dialog({
    title: "🌤️ Conditions météo",
    content: `<div style="font-size:11px;opacity:.6;margin-bottom:6px">Plusieurs conditions possibles simultanément.</div>
      <div style="max-height:60vh;overflow-y:auto">${rows}</div>`,
    buttons: {
      clear: { label: "✕ Effacer", callback: async () => { await setActiveWeathers([]); } },
      ok: { label: "✅ Appliquer", callback: async (html) => {
        const keys = [...html[0].querySelectorAll("input[name='weather']:checked")].map(e => e.value);
        await setActiveWeathers(keys);
        const labels = keys.map(k => weathers.find(w => w.key === k)?.icon + " " + weathers.find(w => w.key === k)?.label).join(", ");
        if (keys.length) await ChatMessage.create({ content: `<div style="text-align:center;font-size:13px">🌤️ <b>Météo :</b> ${labels}</div>` });
      }}
    },
    default: "ok", options: { width: 400 }
  }).render(true);
}

export function openBiomeDialog() {
  if (!game.user?.isGM) return;
  const biomes  = listBiomes();
  const current = getActiveBiomeKey();

  // Grouper par catégorie
  const groupes = [
    { label: "🌍 Extérieur", keys: ["plaine","foret","montagne","enneige","desert","marecage","cote","volcan","plaine_arc","foret_arc","jungle"] },
    { label: "⛏️ Intérieur / Souterrain", keys: ["grotte","caverne_glace","donjon","catacombe","temple","mine"] },
    { label: "✨ Magique / Spécial", keys: ["ruines","nexus","abysses"] },
  ];

  const makeRow = (b) => {
    const checked = current === b.key;
    const effects = Object.entries(b.manaBonus ?? {}).filter(([,v]) => v !== 0)
      .map(([tag,v]) => {
        const td = ELEMENT_TAGS[tag];
        const color = v < 0 ? "#1d9e75" : "#c0392b";
        return `<span style="color:${color};font-size:10px;background:${color}18;border-radius:3px;padding:1px 4px">${td?.label ?? tag} ${v > 0 ? "+" : ""}${v}</span>`;
      }).join(" ");
    return `<label style="display:flex;align-items:flex-start;gap:10px;padding:6px 8px;border-radius:8px;cursor:pointer;margin-bottom:3px;
        background:${checked ? "rgba(180,140,60,0.15)" : "rgba(255,255,255,0.03)"};
        border:1px solid ${checked ? "rgba(180,140,60,0.5)" : "rgba(255,255,255,0.08)"}">
      <input type="radio" name="biome" value="${b.key}" ${checked ? "checked" : ""} style="width:16px;height:16px;margin-top:2px;cursor:pointer"/>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:18px">${b.icon}</span><span style="font-weight:600;font-size:12px">${b.label}</span></div>
        <div style="font-size:10px;opacity:.55;margin-top:1px">${b.desc}</div>
        ${effects ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">${effects}</div>` : ""}
      </div></label>`;
  };

  const rows = groupes.map(g => {
    const groupBiomes = g.keys.map(k => TERRAIN_BIOMES[k]).filter(Boolean);
    return `<div style="margin-bottom:8px">
      <div style="font-size:10px;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;padding:0 4px">${g.label}</div>
      ${groupBiomes.map(makeRow).join("")}
    </div>`;
  }).join("");

  new Dialog({
    title: "🗺️ Terrain / Lieu",
    content: `<div style="font-size:11px;opacity:.6;margin-bottom:6px">Un seul endroit à la fois. Les bonus s'ajoutent à la météo.</div>
      <label style="display:flex;align-items:center;gap:10px;padding:5px 8px;border-radius:8px;cursor:pointer;margin-bottom:6px;
        background:${!current ? "rgba(100,100,100,0.2)" : "rgba(255,255,255,0.02)"};border:1px solid ${!current ? "rgba(180,180,180,0.4)" : "rgba(255,255,255,0.06)"}">
        <input type="radio" name="biome" value="" ${!current ? "checked" : ""} style="width:16px;height:16px;cursor:pointer"/>
        <span style="font-size:12px;opacity:.6">— Aucun lieu particulier —</span>
      </label>
      <div style="max-height:60vh;overflow-y:auto;padding-right:4px">${rows}</div>`,
    buttons: {
      ok: { label: "✅ Appliquer", callback: async (html) => {
        const key = html[0]?.querySelector("input[name='biome']:checked")?.value ?? "";
        await setActiveBiome(key);
      }}
    },
    default: "ok", options: { width: 420 }
  }).render(true);
}
