// module/rules/weather-library.js
//
// La météo réduit (ou augmente) le coût mana des sorts élémentaires
// par une valeur FIXE en points de mana (pas un multiplicateur).
//
// manaReduction[tag] = N
//   N < 0 → le sort coûte N mana de moins (boost météo)
//   N > 0 → le sort coûte N mana de plus (temps défavorable)

export const WEATHER_LIBRARY = {
  ensoleille: {
    key: "ensoleille", label: "Ensoleillé ☀️", icon: "☀️",
    boost:  ["feu", "lumiere"],
    weaken: ["obscurite", "glace"],
    manaReduction: { feu: -1, lumiere: -1, obscurite: 1, glace: 1 },
    desc: "Temps clair et chaud. Renforce le feu et la lumière."
  },
  nuageux: {
    key: "nuageux", label: "Nuageux ⛅", icon: "⛅",
    boost: [], weaken: [], manaReduction: {},
    desc: "Temps couvert. Aucun effet sur les sorts."
  },
  pluie_legere: {
    key: "pluie_legere", label: "Pluie légère 🌦️", icon: "🌦️",
    boost:  ["eau"],
    weaken: ["feu"],
    manaReduction: { eau: -1, feu: 1 },
    desc: "Pluie fine. Sorts d'eau −1 mana, sorts de feu +1 mana."
  },
  forte_pluie: {
    key: "forte_pluie", label: "Forte pluie 🌧️", icon: "🌧️",
    boost:  ["eau", "eclair"],
    weaken: ["feu", "air"],
    manaReduction: { eau: -2, eclair: -1, feu: 2, air: 1 },
    desc: "Pluie battante. Eau −2, Éclair −1, Feu +2, Air +1."
  },
  orageux: {
    key: "orageux", label: "Orageux ⛈️", icon: "⛈️",
    boost:  ["eclair", "eau", "air"],
    weaken: ["feu", "terre"],
    manaReduction: { eclair: -3, eau: -2, air: -1, feu: 3, terre: 1 },
    desc: "Tempête. Éclair −3 mana, Eau −2, Air −1, Feu +3."
  },
  forte_chaleur: {
    key: "forte_chaleur", label: "Forte chaleur 🌡️", icon: "🌡️",
    boost:  ["feu", "terre"],
    weaken: ["glace", "eau", "air"],
    manaReduction: { feu: -3, terre: -1, glace: 3, eau: 2, air: 1 },
    desc: "Canicule. Feu −3, Glace +3, Eau +2."
  },
  gel: {
    key: "gel", label: "Gel ❄️", icon: "❄️",
    boost:  ["glace", "air"],
    weaken: ["feu", "lumiere"],
    manaReduction: { glace: -3, air: -1, feu: 3, lumiere: 1 },
    desc: "Froid intense. Glace −3, Feu +3."
  },
  vent_fort: {
    key: "vent_fort", label: "Vent fort 💨", icon: "💨",
    boost:  ["air"],
    weaken: ["feu", "terre"],
    manaReduction: { air: -2, feu: 2, terre: 1 },
    desc: "Grand vent. Air −2, Feu +2, Terre +1."
  },
  brouillard: {
    key: "brouillard", label: "Brouillard 🌫️", icon: "🌫️",
    boost:  ["obscurite", "eau"],
    weaken: ["feu", "lumiere", "eclair"],
    manaReduction: { obscurite: -2, eau: -1, feu: 2, lumiere: 2, eclair: 1 },
    desc: "Brouillard. Obscurité −2, Lumière +2, Feu +2."
  },
  nuit_claire: {
    key: "nuit_claire", label: "Nuit claire 🌙", icon: "🌙",
    boost:  ["obscurite", "glace"],
    weaken: ["feu", "lumiere"],
    manaReduction: { obscurite: -2, glace: -1, feu: 1, lumiere: 2 },
    desc: "Nuit étoilée. Obscurité −2, Glace −1, Lumière +2."
  }
};

export const ELEMENT_TAGS = {
  feu:       { label: "Feu 🔥",       color: "#e05a00" },
  eau:       { label: "Eau 💧",        color: "#2980b9" },
  eclair:    { label: "Éclair ⚡",     color: "#f1c40f" },
  glace:     { label: "Glace ❄️",      color: "#85c1e9" },
  air:       { label: "Air 💨",        color: "#abebc6" },
  terre:     { label: "Terre 🌍",      color: "#7d6608" },
  lumiere:   { label: "Lumière ✨",    color: "#f9e79f" },
  obscurite: { label: "Obscurité 🌑", color: "#6c3483" },
  neutre:    { label: "Neutre ⚪",     color: "#7f8c8d" },
};

export function listWeathers() { return Object.values(WEATHER_LIBRARY); }
export function getWeatherDef(key) { return WEATHER_LIBRARY[key] ?? WEATHER_LIBRARY.nuageux; }
export function getCurrentWeatherKey() { return game.settings?.get?.("rpg", "currentWeather") ?? "nuageux"; }
export function getCurrentWeather() { return getWeatherDef(getCurrentWeatherKey()); }

/**
 * Retourne la réduction de mana FIXE pour un tag élémentaire.
 * Valeur négative = sort coûte moins, positive = coûte plus.
 */
export function getManaCostReduction(tag) {
  if (!tag || tag === "neutre") return 0;
  const w = getCurrentWeather();
  return w.manaReduction?.[tag] ?? 0;
}

/** Compatibilité ancienne API */
export function getManaCostMultiplier(tag) { return 1; }

export function getWeatherModifierFor(tag) {
  if (!tag) return { durationReduction: 0, dotReductionPct: 0 };
  const w = getCurrentWeather();
  if (w.boost.includes(tag))  return { durationReduction: -1, dotReductionPct: -20 };
  if (w.weaken.includes(tag)) return { durationReduction: 1,  dotReductionPct: 20 };
  return { durationReduction: 0, dotReductionPct: 0 };
}

export async function setCurrentWeather(key) {
  if (!WEATHER_LIBRARY[key]) return false;
  await game.settings.set("rpg", "currentWeather", key);
  const def = getWeatherDef(key);

  // Effets visuels Foundry V13 natifs
  const sceneWeather = {
    ensoleille:    { weather: "" },
    nuageux:       { weather: "" },
    pluie_legere:  { weather: "rain" },
    forte_pluie:   { weather: "rain" },
    orageux:       { weather: "rain" },
    forte_chaleur: { weather: "" },
    gel:           { weather: "snow" },
    vent_fort:     { weather: "leaves" },
    brouillard:    { weather: "fog" },
    nuit_claire:   { weather: "" }
  };
  const weatherType = sceneWeather[key]?.weather ?? "";
  const scene = game.scenes?.active;
  if (scene && weatherType !== undefined) {
    try {
      await scene.update({ "environment.weather.effect": weatherType });
    } catch { /* Foundry V13 peut ne pas supporter ce path exactement */ }
  }

  // Effets météo sur mana — résumé
  const effects = Object.entries(def.manaReduction ?? {})
    .map(([t, v]) => {
      const td = ELEMENT_TAGS[t];
      return v < 0
        ? `<span style="color:#1d9e75">${td?.label ?? t} ${v} mana</span>`
        : `<span style="color:#c0392b">${td?.label ?? t} +${v} mana</span>`;
    }).join(" · ");

  await ChatMessage.create({
    content: `<div style="text-align:center;padding:6px;font-size:13px">
      ${def.icon} <b>Météo : ${def.label}</b><br>
      <span style="opacity:.7;font-size:11px">${def.desc}</span>
      ${effects ? `<div style="margin-top:4px;font-size:11px">${effects}</div>` : ""}
    </div>`
  });
  return true;
}
