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
    el.addEventListener("click", () => {
      const macro = game.macros.find(m => m.name === "Météo (MJ)");
      if (macro) macro.execute();
    });
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
