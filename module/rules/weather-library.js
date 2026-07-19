// module/rules/weather-library.js
//
// La météo influence la magie élémentaire ET le coût en mana des sorts.
// Chaque condition booste certains éléments (coût mana réduit, dégâts amplifiés)
// et en affaiblit d'autres (coût mana augmenté, dégâts atténués).

export const WEATHER_LIBRARY = {
  ensoleille: {
    key: "ensoleille", label: "Ensoleillé ☀️",
    icon: "☀️",
    boost:  ["feu", "lumiere"],
    weaken: ["obscurite", "glace"],
    manaCostMult: { feu: 0.75, lumiere: 0.75, obscurite: 1.25, glace: 1.25 },
    desc: "Temps clair et chaud. Renforce le feu et la lumière."
  },
  nuageux: {
    key: "nuageux", label: "Nuageux ⛅",
    icon: "⛅",
    boost:  [],
    weaken: [],
    manaCostMult: {},
    desc: "Temps couvert. Aucun effet particulier."
  },
  pluie_legere: {
    key: "pluie_legere", label: "Pluie légère 🌦️",
    icon: "🌦️",
    boost:  ["eau"],
    weaken: ["feu"],
    manaCostMult: { eau: 0.80, feu: 1.20 },
    desc: "Pluie fine. Renforce les sorts d'eau, affaiblit le feu."
  },
  forte_pluie: {
    key: "forte_pluie", label: "Forte pluie 🌧️",
    icon: "🌧️",
    boost:  ["eau", "eclair"],
    weaken: ["feu", "air"],
    manaCostMult: { eau: 0.65, eclair: 0.80, feu: 1.40, air: 1.20 },
    desc: "Pluie battante. Sorts d'eau puissants, feu quasi inutile."
  },
  orageux: {
    key: "orageux", label: "Orageux ⛈️",
    icon: "⛈️",
    boost:  ["eclair", "eau", "air"],
    weaken: ["feu", "terre"],
    manaCostMult: { eclair: 0.50, eau: 0.75, air: 0.75, feu: 1.50, terre: 1.25 },
    desc: "Tempête électrique. L'éclair coûte moitié moins de mana."
  },
  forte_chaleur: {
    key: "forte_chaleur", label: "Forte chaleur 🌡️",
    icon: "🌡️",
    boost:  ["feu", "terre"],
    weaken: ["glace", "eau", "air"],
    manaCostMult: { feu: 0.60, terre: 0.80, glace: 1.50, eau: 1.25, air: 1.20 },
    desc: "Canicule. Le feu ne coûte presque rien, la glace est épuisante."
  },
  gel: {
    key: "gel", label: "Gel ❄️",
    icon: "❄️",
    boost:  ["glace", "air"],
    weaken: ["feu", "lumiere"],
    manaCostMult: { glace: 0.60, air: 0.80, feu: 1.50, lumiere: 1.20 },
    desc: "Froid intense. La glace devient redoutable."
  },
  vent_fort: {
    key: "vent_fort", label: "Vent fort 💨",
    icon: "💨",
    boost:  ["air"],
    weaken: ["feu", "terre"],
    manaCostMult: { air: 0.65, feu: 1.30, terre: 1.20 },
    desc: "Grand vent. Les sorts d'air portent loin."
  },
  brouillard: {
    key: "brouillard", label: "Brouillard 🌫️",
    icon: "🌫️",
    boost:  ["obscurite", "eau"],
    weaken: ["feu", "lumiere", "eclair"],
    manaCostMult: { obscurite: 0.70, eau: 0.85, feu: 1.30, lumiere: 1.40, eclair: 1.20 },
    desc: "Brouillard épais. Vision réduite, magie des ténèbres amplifiée."
  },
  nuit_claire: {
    key: "nuit_claire", label: "Nuit claire 🌙",
    icon: "🌙",
    boost:  ["obscurite", "glace"],
    weaken: ["feu", "lumiere"],
    manaCostMult: { obscurite: 0.65, glace: 0.85, feu: 1.20, lumiere: 1.30 },
    desc: "Nuit sans nuage. La magie sombre est à son apogée."
  }
};

// Tags élémentaires reconnus
export const ELEMENT_TAGS = {
  feu:       { label: "Feu 🔥",        color: "#e05a00" },
  eau:       { label: "Eau 💧",         color: "#2980b9" },
  eclair:    { label: "Éclair ⚡",      color: "#f1c40f" },
  glace:     { label: "Glace ❄️",       color: "#85c1e9" },
  air:       { label: "Air 💨",         color: "#abebc6" },
  terre:     { label: "Terre 🌍",       color: "#7d6608" },
  lumiere:   { label: "Lumière ✨",     color: "#f9e79f" },
  obscurite: { label: "Obscurité 🌑",  color: "#6c3483" },
  neutre:    { label: "Neutre ⚪",      color: "#7f8c8d" },
};

export function listWeathers() {
  return Object.values(WEATHER_LIBRARY);
}

export function getWeatherDef(key) {
  return WEATHER_LIBRARY[key] ?? WEATHER_LIBRARY.nuageux;
}

export function getCurrentWeatherKey() {
  return game.settings?.get?.("rpg", "currentWeather") ?? "nuageux";
}

export function getCurrentWeather() {
  return getWeatherDef(getCurrentWeatherKey());
}

/**
 * Retourne le multiplicateur de coût mana pour un tag élémentaire donné
 * selon la météo actuelle.
 * < 1.0 = coût réduit (boost) | > 1.0 = coût augmenté (weaken)
 */
export function getManaCostMultiplier(tag) {
  if (!tag || tag === "neutre") return 1;
  const weather = getCurrentWeather();
  return weather.manaCostMult?.[tag] ?? 1;
}

/**
 * Retourne les modificateurs météo pour un tag (durée, dégâts)
 * Gardé pour compatibilité avec le système existant.
 */
export function getWeatherModifierFor(tag) {
  if (!tag) return { durationReduction: 0, dotReductionPct: 0 };
  const weather = getCurrentWeather();
  if (weather.boost.includes(tag))  return { durationReduction: -1, dotReductionPct: -20 };
  if (weather.weaken.includes(tag)) return { durationReduction: 1,  dotReductionPct: 20 };
  return { durationReduction: 0, dotReductionPct: 0 };
}

export async function setCurrentWeather(key) {
  if (!WEATHER_LIBRARY[key]) return false;
  await game.settings.set("rpg", "currentWeather", key);

  // Notifier tous les clients du changement
  const def = getWeatherDef(key);
  await ChatMessage.create({
    content: `<div style="text-align:center;padding:6px;font-size:13px">
      ${def.icon} <b>Météo : ${def.label}</b><br>
      <span style="opacity:.7;font-size:11px">${def.desc}</span>
    </div>`
  });
  return true;
}
