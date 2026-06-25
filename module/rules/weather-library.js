// module/rules/weather-library.js
//
// La météo influence directement la magie élémentaire (cohérent avec le lore :
// la magie vient de la nature). Chaque condition météo favorise certains
// éléments (durée/dégâts amplifiés) et en défavorise d'autres (atténués) —
// s'intègre dans le même pipeline que les résistances d'équipement.

export const WEATHER_LIBRARY = {
  clair:   { key: "clair",   label: "Ciel clair",        boost: [],            weaken: [] },
  pluie:   { key: "pluie",   label: "Pluie",              boost: ["eau"],       weaken: ["feu"] },
  canicule:{ key: "canicule",label: "Canicule",           boost: ["feu"],       weaken: ["eau", "glace"] },
  vent:    { key: "vent",    label: "Vent fort",          boost: ["air"],       weaken: ["terre"] },
  gel:     { key: "gel",     label: "Gel / Tempête de neige", boost: ["glace"], weaken: ["feu"] },
  orage:   { key: "orage",   label: "Orage",              boost: ["eclair", "eau"], weaken: [] },
  sable:   { key: "sable",   label: "Tempête de sable",   boost: ["terre"],     weaken: ["air"] }
};

export function listWeathers() {
  return Object.values(WEATHER_LIBRARY);
}

export function getWeatherDef(key) {
  return WEATHER_LIBRARY[key] ?? WEATHER_LIBRARY.clair;
}

/**
 * Renvoie le modificateur météo pour un tag élémentaire donné.
 * boost  -> durationReduction négative (la durée AUGMENTE), dotReductionPct négatif (dégâts amplifiés)
 * weaken -> durationReduction positive (la durée diminue), dotReductionPct positif (dégâts atténués)
 */
export function getWeatherModifierFor(tag) {
  if (!tag) return { durationReduction: 0, dotReductionPct: 0 };

  const key = game.settings?.get?.("rpg", "currentWeather") ?? "clair";
  const def = getWeatherDef(key);

  if (def.boost.includes(tag))  return { durationReduction: -1, dotReductionPct: -20 };
  if (def.weaken.includes(tag)) return { durationReduction: 1,  dotReductionPct: 20 };
  return { durationReduction: 0, dotReductionPct: 0 };
}

export function getCurrentWeatherKey() {
  return game.settings?.get?.("rpg", "currentWeather") ?? "clair";
}

export async function setCurrentWeather(key) {
  if (!WEATHER_LIBRARY[key]) return false;
  await game.settings.set("rpg", "currentWeather", key);
  return true;
}
