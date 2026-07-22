// module/rules/region-behaviors.js
//
// Comportements de région personnalisés pour le système RPG.
// Enregistrés dans Foundry V13 via CONFIG.RegionBehavior.dataModels.
//
// Chaque type définit :
//   - label       : nom affiché dans l'UI Foundry
//   - icon        : icône Fontawesome
//   - speedMult   : multiplicateur de vitesse (1 = normal, 0.5 = terrain difficile)
//   - impassable  : si true, bloque le passage (nécessite jet de compétence)
//   - skillReq    : compétence requise pour traverser (si impassable)
//   - visionMult  : multiplicateur de distance de vision (1 = normal, 0.3 = forêt dense)
//   - visionRange : distance de vision max en mètres (null = illimité)
//   - color       : couleur de la région dans l'UI
//   - description : explication pour le MJ

export const TERRAIN_TYPES = {
  terrainDifficile: {
    label:       "Terrain difficile",
    icon:        "fas fa-mountain",
    color:       "#8B4513",
    speedMult:   0.5,
    visionMult:  1,
    description: "Éboulements, ronces, décombres — vitesse divisée par 2."
  },
  vegetationDense: {
    label:       "Végétation dense",
    icon:        "fas fa-tree",
    color:       "#228B22",
    speedMult:   0.5,
    visionMult:  1,
    visionRange: 3, // vision limitée à 3m dans la zone
    description: "Forêt épaisse, roseaux — vitesse ÷2, vision limitée à 3m."
  },
  eauPeuProfonde: {
    label:       "Eau peu profonde",
    icon:        "fas fa-water",
    color:       "#4169E1",
    speedMult:   0.67,
    visionMult:  1,
    description: "Gué, marais, rivière peu profonde — vitesse × 2/3."
  },
  eauProfonde: {
    label:       "Eau profonde",
    icon:        "fas fa-swimming-pool",
    color:       "#00008B",
    speedMult:   0.33,
    impassable:  false, // peut traverser mais très lent sans compétence
    skillReq:    "nage",
    visionMult:  1,
    description: "Lac, rivière profonde — vitesse ÷3 sans compétence Nage, impassable si niveau 0."
  },
  boue: {
    label:       "Boue profonde",
    icon:        "fas fa-circle",
    color:       "#4B3621",
    speedMult:   0.5,
    visionMult:  1,
    description: "Marécage, champ inondé — vitesse ÷2, pas d'attaque d'opportunité possible."
  },
  courant: {
    label:       "Courant fort",
    icon:        "fas fa-wind",
    color:       "#1E90FF",
    speedMult:   0.25,
    impassable:  false,
    skillReq:    "nage",
    visionMult:  1,
    description: "Rivière en crue, torrent — vitesse ÷4, risque d'emportement."
  }
};

/**
 * Retourne les terrains actifs à une position (x, y) sur la scène.
 * Cherche toutes les régions qui contiennent ce point et ont un comportement
 * de type terrain RPG.
 */
export function getTerrainAt(x, y) {
  if (!canvas?.regions?.placeables) return [];

  const terrains = [];
  for (const region of canvas.regions.placeables) {
    // Vérifie si le point est dans la région
    const contains = _pointInRegion(region, x, y);
    if (!contains) continue;

    // Cherche un comportement terrain RPG sur cette région
    for (const behavior of (region.document?.behaviors ?? [])) {
      const type = String(behavior.type ?? "").replace("rpg.", "");
      if (TERRAIN_TYPES[type]) {
        terrains.push({ region, behavior, terrain: TERRAIN_TYPES[type], typeKey: type });
      }
    }
  }
  return terrains;
}

/**
 * Calcule le coût de déplacement en mètres pour un chemin donné,
 * en tenant compte des terrains traversés ET du type de déplacement de l'acteur.
 *
 * @param {Array} waypoints — [{x, y}] points du trajet
 * @param {Actor} actor     — acteur qui se déplace (pour type de mouvement)
 * @returns {{ cost: number, segments: Array, terrainsCrossed: Set }}
 */
export function calculateMovementCost(waypoints, actor = null) {
  if (!waypoints || waypoints.length < 2) return { cost: 0, segments: [], terrainsCrossed: new Set() };

  // Import dynamique pour éviter les dépendances circulaires
  let getEffectiveSpeedMult = null;
  try {
    // On essaie de récupérer depuis game.rpg.movementTypes si disponible
    getEffectiveSpeedMult = game?.rpg?.movementTypes?.getEffectiveSpeedMult ?? null;
  } catch { /* pas encore dispo */ }

  const segments = [];
  const terrainsCrossed = new Set();
  let totalCost = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to   = waypoints[i + 1];
    const rawDist = _measureSegment(from.x, from.y, to.x, to.y);

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const terrains = getTerrainAt(midX, midY);

    // Multiplicateur le plus pénalisant avec prise en compte du type de mouvement
    let speedMult = 1;
    let terrainLabel = null;
    for (const t of terrains) {
      if (!t.terrain.enabled && t.behavior?.system?.enabled === false) continue;

      // Récupère le multiplicateur configuré sur CETTE région (peut différer du défaut du type)
      const regionMult = Number(t.behavior?.system?.speedMult ?? t.terrain.speedMult ?? 1);

      // Applique les immunités du type de déplacement de l'acteur
      let effectiveMult = regionMult;
      if (actor && getEffectiveSpeedMult) {
        effectiveMult = getEffectiveSpeedMult(actor, t.typeKey, regionMult);
      }

      if (effectiveMult < speedMult) {
        speedMult    = effectiveMult;
        terrainLabel = t.behavior?.system?.notes
          ? `${t.terrain.label} (${t.behavior.system.notes})`
          : t.terrain.label;
        if (effectiveMult < regionMult) {
          terrainLabel += " [immunité partielle]";
        }
        if (effectiveMult < speedMult || effectiveMult === 1 && regionMult < 1) {
          // Acteur immunisé → ne signale pas le terrain
        } else {
          terrainsCrossed.add(t.typeKey);
        }
      }
      if (effectiveMult < 1) terrainsCrossed.add(t.typeKey);
    }

    const cost = speedMult > 0 ? rawDist / speedMult : rawDist * 10;
    totalCost += cost;

    segments.push({ from, to, rawDist, speedMult, cost, terrainLabel });
  }

  return { cost: totalCost, segments, terrainsCrossed };
}

/**
 * Mesure la distance d'un segment en mètres.
 */
/**
 * Facteur de coût d'un pas en diagonale, selon le réglage RP « rpg.diagonalRule » :
 *   octile (défaut) = √2 ≈ 1,41 m — réaliste (une diagonale coûte plus qu'un pas droit)
 *   alternating     = 1,5 m        — 1 puis 2 m en alternance (façon 5-10-5), moyenné
 *   chebyshev       = 1 m          — diagonale « gratuite », tactique simple
 */
export function diagonalFactor() {
  let rule = "octile";
  try { rule = game.settings.get("rpg", "diagonalRule") || "octile"; } catch { /* avant init */ }
  if (rule === "chebyshev")   return 1;
  if (rule === "alternating") return 1.5;
  return Math.SQRT2;
}

/**
 * Distance RP en mètres entre deux points (pixels), diagonales pondérées.
 * Décompose le trajet en composante droite + composante diagonale :
 *   mètres = (droite + diagonale × facteur) × distanceParCase
 * Indépendant de la règle de diagonale du cœur Foundry → le coût du système
 * reste correct même si le MJ change les réglages du core.
 */
export function measureSegmentMeters(x1, y1, x2, y2) {
  const gs   = canvas?.scene?.grid?.size ?? 100;
  const dist = canvas?.scene?.grid?.distance ?? 1;
  const dx = Math.abs(x2 - x1) / gs;
  const dy = Math.abs(y2 - y1) / gs;
  const diag     = Math.min(dx, dy);
  const straight = Math.abs(dx - dy);
  return (straight + diag * diagonalFactor()) * dist;
}

function _measureSegment(x1, y1, x2, y2) {
  return measureSegmentMeters(x1, y1, x2, y2);
}

/**
 * Vérifie si un point est dans une région Foundry V13.
 */
function _pointInRegion(region, x, y) {
  try {
    // V13 API officielle
    if (region.document?.testPoint) return region.document.testPoint({ x, y });
    // Fallback via polygones
    if (region.polygon?.contains) return region.polygon.contains(x, y);
    if (region.polygons?.some(p => p.contains?.(x, y))) return true;
    // Fallback via bounds
    const b = region.bounds;
    if (b && !(x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)) return false;
    return true;
  } catch { return false; }
}

/**
 * Retourne un résumé lisible des terrains pour l'affichage dans le chat.
 */
export function formatTerrainSummary(terrainsCrossed) {
  if (!terrainsCrossed.size) return "";
  const labels = [...terrainsCrossed].map(k => TERRAIN_TYPES[k]?.label ?? k);
  return ` <span style="opacity:.7;font-size:11px">(${labels.join(", ")})</span>`;
}

/**
 * Enregistre les data models de comportements dans Foundry V13.
 * Appelé depuis init.js dans le hook "init".
 */
export function registerRegionBehaviors() {
  if (!CONFIG.RegionBehavior?.dataModels) {
    console.warn("[RPG] CONFIG.RegionBehavior non disponible — Foundry V13+ requis.");
    return;
  }

  for (const [typeKey, config] of Object.entries(TERRAIN_TYPES)) {
    const fullKey = `rpg.${typeKey}`;
    if (CONFIG.RegionBehavior.dataModels[fullKey]) continue; // déjà enregistré

    // DataModel minimal pour Foundry V13
    class TerrainBehavior extends foundry.abstract.TypeDataModel {
      static defineSchema() {
        const fields = foundry.data.fields;
        return {
          enabled:   new fields.BooleanField({ initial: true }),
          speedMult: new fields.NumberField({ initial: config.speedMult, min: 0.1, max: 1 }),
          visionRange: new fields.NumberField({ initial: config.visionRange ?? null, nullable: true }),
          notes:     new fields.StringField({ initial: "" })
        };
      }
    }
    Object.defineProperty(TerrainBehavior, "name", { value: `${typeKey}Behavior` });

    CONFIG.RegionBehavior.dataModels[fullKey] = TerrainBehavior;

    // Libellé dans l'UI Foundry
    if (CONFIG.RegionBehavior.typeLabels) {
      CONFIG.RegionBehavior.typeLabels[fullKey] = config.label;
    }
    if (CONFIG.RegionBehavior.typeIcons) {
      CONFIG.RegionBehavior.typeIcons[fullKey] = config.icon;
    }

    console.log(`[RPG] Comportement région enregistré : ${fullKey} (${config.label})`);
  }
}


// ─── Sheet de configuration du comportement terrain ──────────────────────────
// Fournit l'UI dans Foundry pour configurer speedMult, visionRange, etc.

export class TerrainBehaviorSheet extends foundry.applications.sheets.RegionBehaviorConfig {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS ?? {},
    { window: { title: "Configuration du terrain" }, position: { width: 420 } },
    { inplace: false }
  );

  static PARTS = {
    form: { template: "systems/rpg/templates/region/terrain-behavior.hbs" }
  };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const typeKey = String(this.document.type ?? "").replace("rpg.", "");
    const terrain = TERRAIN_TYPES[typeKey] ?? {};

    ctx.terrain = {
      ...terrain,
      color: terrain.color ?? "#888888",
      icon:  terrain.icon  ?? "fas fa-map",
      hasVisionRange: "visionRange" in (terrain) || !!this.document.system?.visionRange
    };

    const mult = Number(this.document.system?.speedMult ?? terrain.speedMult ?? 1);
    ctx.speedCostLabel = mult >= 1 ? "normal" :
      `${(1/mult).toFixed(1)}× plus lent`;
    ctx.effectiveSpeed = (6 * mult).toFixed(1);
    ctx.trueCost       = mult > 0 ? (6 / mult).toFixed(1) : "∞";

    return ctx;
  }
}

/**
 * Enregistre les sheets de comportements.
 * Appelé après registerRegionBehaviors().
 */
export function registerRegionBehaviorSheets() {
  if (!foundry.applications.sheets?.RegionBehaviorConfig) return;

  for (const typeKey of Object.keys(TERRAIN_TYPES)) {
    const fullKey = `rpg.${typeKey}`;
    try {
      foundry.applications.sheets.RegionBehaviorConfig.registerConfig(
        fullKey, TerrainBehaviorSheet
      );
    } catch { /* API peut varier selon la version V13 */ }
  }
}
