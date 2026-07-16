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
 * en tenant compte des terrains traversés.
 *
 * @param {Array} waypoints — [{x, y}] points du trajet
 * @returns {{ cost: number, segments: Array, terrainsCrossed: Set }}
 */
export function calculateMovementCost(waypoints) {
  if (!waypoints || waypoints.length < 2) return { cost: 0, segments: [], terrainsCrossed: new Set() };

  const segments = [];
  const terrainsCrossed = new Set();
  let totalCost = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to   = waypoints[i + 1];

    // Distance réelle du segment
    const rawDist = _measureSegment(from.x, from.y, to.x, to.y);

    // Terrain au milieu du segment
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const terrains = getTerrainAt(midX, midY);

    // Multiplicateur le plus pénalisant (on prend le minimum)
    let speedMult = 1;
    let terrainLabel = null;
    for (const t of terrains) {
      if (t.terrain.speedMult < speedMult) {
        speedMult = t.terrain.speedMult;
        terrainLabel = t.terrain.label;
        terrainsCrossed.add(t.typeKey);
      }
    }

    const cost = rawDist / speedMult; // coût en "mètres de mouvement"
    totalCost += cost;

    segments.push({
      from, to,
      rawDist,
      speedMult,
      cost,
      terrainLabel
    });
  }

  return { cost: totalCost, segments, terrainsCrossed };
}

/**
 * Mesure la distance d'un segment en mètres.
 */
function _measureSegment(x1, y1, x2, y2) {
  try {
    if (canvas?.grid?.measurePath) {
      const r = canvas.grid.measurePath([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
      return r.distance ?? r.totalDistance ?? _chebychev(x1, y1, x2, y2);
    }
  } catch { /* fallback */ }
  return _chebychev(x1, y1, x2, y2);
}

function _chebychev(x1, y1, x2, y2) {
  const gs   = canvas?.scene?.grid?.size ?? 100;
  const dist = canvas?.scene?.grid?.distance ?? 1;
  return Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) / gs * dist;
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
