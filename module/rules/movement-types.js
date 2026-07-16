// module/rules/movement-types.js
//
// Définition des types de déplacement et leurs interactions avec le terrain.
//
// Un acteur peut avoir un type principal + des types temporaires (sorts).
// Les types temporaires sont stockés dans system.deplacement.typesExtra[]
// et ajoutés par les effets de sort (ex: sort "Vol" → typesExtra: ["volant"]).

export const MOVEMENT_TYPES = {
  terrestre: {
    label: "Terrestre",
    icon: "fas fa-hiking",
    description: "Se déplace au sol — toutes les restrictions de terrain s'appliquent.",
    immunities: [],           // aucun terrain ignoré
    reduced: []               // aucun terrain avec coût réduit
  },
  volant: {
    label: "Volant",
    icon: "fas fa-dove",
    description: "Vole au-dessus du terrain — ignore toutes les restrictions au sol.",
    immunities: ["terrainDifficile", "vegetationDense", "boue", "eauPeuProfonde", "eauProfonde", "courant"],
    reduced: [],
    note: "Ne peut pas traverser les plafonds (murs de terrain hauts)."
  },
  aquatique: {
    label: "Aquatique",
    icon: "fas fa-fish",
    description: "Nage naturellement — ignore les pénalités d'eau, subit les pénalités terrestres.",
    immunities: ["eauPeuProfonde", "eauProfonde", "courant"],
    reduced: [],
    note: "Peut se trouver en difficulté sur terre ferme."
  },
  amphibie: {
    label: "Amphibie",
    icon: "fas fa-frog",
    description: "Terrestre ET aquatique — ignore toutes les pénalités d'eau.",
    immunities: ["eauPeuProfonde", "eauProfonde", "courant"],
    reduced: ["boue"]         // la boue ne coûte que ×0.75 pour les amphibies
  },
  montagnard: {
    label: "Montagnard",
    icon: "fas fa-mountain",
    description: "Adapté au terrain difficile — ignore les pénalités de rochers et éboulements.",
    immunities: ["terrainDifficile"],
    reduced: [],
    note: "Les trolls des montagnes, nains, etc."
  },
  forestier: {
    label: "Forestier",
    icon: "fas fa-tree",
    description: "À l'aise en forêt — se déplace normalement en végétation dense.",
    immunities: ["vegetationDense"],
    reduced: [],
    note: "Elfes sylvains, rôdeurs, etc."
  },
  ethere: {
    label: "Éthéré",
    icon: "fas fa-ghost",
    description: "Traverses murs et terrain — ignore TOUT (murs, eau, obstacles).",
    immunities: ["terrainDifficile", "vegetationDense", "boue", "eauPeuProfonde", "eauProfonde", "courant"],
    reduced: [],
    note: "Fantômes, entités spectrales."
  }
};

/**
 * Retourne tous les types de déplacement actifs pour un acteur.
 * Combine le type principal + les types temporaires (sorts actifs).
 */
export function getActiveMovementTypes(actor) {
  const sys = actor?.system ?? {};
  const mainType = String(sys.deplacement?.type ?? "terrestre");
  const extraTypes = Array.isArray(sys.deplacement?.typesExtra) ? sys.deplacement.typesExtra : [];

  // Aussi vérifier les états actifs qui donnent un type de mouvement
  const stateTypes = (sys.etatsActifs ?? [])
    .filter(s => s.mods?.movementTypeGrant)
    .map(s => s.mods.movementTypeGrant);

  return [...new Set([mainType, ...extraTypes, ...stateTypes])];
}

/**
 * Vérifie si un acteur est immunisé à un type de terrain donné.
 * Un acteur peut avoir plusieurs types de déplacement (ex: volant temporairement).
 */
export function isImmuneToTerrain(actor, terrainTypeKey) {
  const types = getActiveMovementTypes(actor);
  return types.some(typeKey => {
    const movType = MOVEMENT_TYPES[typeKey];
    return movType?.immunities?.includes(terrainTypeKey) ?? false;
  });
}

/**
 * Retourne le multiplicateur de vitesse effectif pour un acteur sur un terrain.
 * Tient compte des immunités et réductions.
 */
export function getEffectiveSpeedMult(actor, terrainTypeKey, baseMult) {
  const types = getActiveMovementTypes(actor);

  // Immunité totale → multiplicateur = 1 (pas de pénalité)
  for (const typeKey of types) {
    const movType = MOVEMENT_TYPES[typeKey];
    if (movType?.immunities?.includes(terrainTypeKey)) return 1;
  }

  // Réduction partielle → multiplicateur amélioré
  for (const typeKey of types) {
    const movType = MOVEMENT_TYPES[typeKey];
    if (movType?.reduced?.includes(terrainTypeKey)) {
      return Math.min(1, baseMult * 1.5); // réduit la pénalité de moitié
    }
  }

  return baseMult; // pénalité normale
}

/**
 * Retourne un résumé lisible du type de déplacement actif.
 */
export function getMovementTypeLabel(actor) {
  const types = getActiveMovementTypes(actor);
  return types.map(t => MOVEMENT_TYPES[t]?.label ?? t).join(" + ");
}
