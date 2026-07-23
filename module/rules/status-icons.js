// module/rules/status-icons.js
//
// Pont entre les états maison (EFFECT_LIBRARY / system.etatsActifs) et les
// icônes de statut natives du token Foundry (menu clic-droit, CONFIG.statusEffects).
//
//   1. installCustomStatusEffects() : ajoute chaque effet du catalogue au menu
//      clic-droit du token (icône native Foundry selon le tag élémentaire).
//   2. syncActorStatusIcons(actor)  : miroir — les états présents dans
//      system.etatsActifs (posés par un sort ou l'éditeur) s'affichent
//      automatiquement en icônes sur le token, et disparaissent au retrait.
//
// Tout est défensif (try/catch) : en cas d'API différente, on n'altère rien.

import { EFFECT_LIBRARY } from "./effect-library.js";

// Icône Foundry native par tag élémentaire (fichiers du set core /icons/svg/).
const ICON_BY_TAG = {
  feu:      "icons/svg/fire.svg",
  air:      "icons/svg/wing.svg",
  eau:      "icons/svg/acid.svg",
  glace:    "icons/svg/frozen.svg",
  eclair:   "icons/svg/lightning.svg",
  terre:    "icons/svg/stoned.svg",
  magique:  "icons/svg/aura.svg",
  physique: "icons/svg/blood.svg"
};
const DEFAULT_ICON = "icons/svg/hazard.svg";

export function iconForTag(tag) {
  return ICON_BY_TAG[tag] ?? DEFAULT_ICON;
}

// Icône dédiée UNIQUE par effet (SVG généré dans assets/effects/, emoji + anneau
// coloré par élément). Repli sur l'icône de tag si le fichier venait à manquer.
function iconForEffect(key, tag) {
  return key ? `systems/rpg/assets/effects/${key}.svg` : iconForTag(tag);
}

const statusId = (key) => `rpg-${key}`;

// Retrouver la clé du catalogue depuis le libellé d'un état appliqué.
const LABEL_TO_KEY = {};
for (const [key, def] of Object.entries(EFFECT_LIBRARY)) LABEL_TO_KEY[def.label] = key;

/**
 * Ajoute les états du catalogue au menu clic-droit du token (non destructif :
 * conserve les statuts Foundry existants).
 */
export function installCustomStatusEffects() {
  try {
    const existing = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : [];
    const ids = new Set(existing.map(e => e.id));
    for (const [key, def] of Object.entries(EFFECT_LIBRARY)) {
      const id = statusId(key);
      if (ids.has(id)) continue;
      existing.push({ id, name: def.label, img: iconForEffect(key, def.tag) });
    }
    CONFIG.statusEffects = existing;
  } catch (e) {
    console.warn("[RPG] installCustomStatusEffects:", e);
  }
}

/** Ensemble des ids de statut correspondant aux etatsActifs de l'acteur. */
function wantedStatusIds(actor) {
  const states = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
  const ids = new Set();
  for (const s of states) {
    const key = LABEL_TO_KEY[s?.label] ?? (EFFECT_LIBRARY[s?.type] ? s.type : null);
    if (key) ids.add(statusId(key));
  }
  return ids;
}

/**
 * Synchronise les icônes de statut du token avec system.etatsActifs.
 * → un état posé par un sort apparaît sur le token ; retiré, l'icône disparaît.
 * GM uniquement (évite les courses réseau). Ne touche QUE les statuts « rpg-* ».
 */
export async function syncActorStatusIcons(actor) {
  if (!game.user?.isGM || !actor) return;
  if (typeof actor.toggleStatusEffect !== "function") return;
  try {
    const want    = wantedStatusIds(actor);
    const current = actor.statuses ?? new Set();
    for (const key of Object.keys(EFFECT_LIBRARY)) {
      const id  = statusId(key);
      const has = current.has(id);
      if (want.has(id) && !has)      await actor.toggleStatusEffect(id, { active: true });
      else if (!want.has(id) && has) await actor.toggleStatusEffect(id, { active: false });
    }
  } catch (e) {
    console.warn("[RPG] syncActorStatusIcons:", e);
  }
}
