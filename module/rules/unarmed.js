// module/rules/unarmed.js
//
// Attaque de base — tout personnage peut toujours attaquer, même sans arme.
//
// Si le personnage a une arme équipée, c'est elle qui sert. Sinon on fabrique
// une arme temporaire « Mains nues » (poings/griffes) : elle n'est jamais
// enregistrée dans l'inventaire, elle est reconstruite à l'identique au moment
// de résoudre l'attaque grâce à l'identifiant réservé UNARMED_ID.

export const UNARMED_ID = "__rpg_unarmed__";

/** Données système d'une attaque à mains nues. */
export function unarmedSystemData() {
  return {
    equipe: true,
    poids: 0,
    emplacement: "mainDroite",
    twoHands: false,
    difficulte: 0,
    livraison: "physique",
    portee: 1,
    allonge: 1,
    range: { min: 0, max: 1 },
    damage: {
      dice: "1d4",
      flat: 0,
      scaling: { stat: "force", per: 10, perStep: 1 }
    },
    crit: {
      mode: "max+die",
      damage: { dice: "1d4", flat: 0, scaling: { stat: "force", per: 10, perStep: 0 } }
    },
    effects: [],
    resistances: [],
    amplifications: [],
    bonus: {}
  };
}

/**
 * Construit l'arme temporaire « Mains nues » rattachée à l'acteur.
 * C'est un vrai document Item non persisté : rollDamage() et tout le reste du
 * pipeline de combat fonctionnent dessus sans cas particulier.
 */
export function buildUnarmedWeapon(actor) {
  if (!actor) return null;
  try {
    const cls = CONFIG.Item.documentClass ?? Item;
    return new cls({
      _id: UNARMED_ID,
      name: "Mains nues",
      type: "weapon",
      img: "icons/skills/melee/unarmed-punch-fist.webp",
      system: unarmedSystemData()
    }, { parent: actor });
  } catch (e) {
    console.warn("[RPG] attaque à mains nues :", e);
    return null;
  }
}

/**
 * Retourne l'arme à utiliser pour une attaque de base :
 * l'arme équipée si elle existe, sinon les mains nues.
 */
export function getAttackWeapon(actor) {
  const equipped = actor?.items?.find?.(i => i.type === "weapon" && i.system?.equipe);
  return equipped ?? buildUnarmedWeapon(actor);
}

/**
 * Résout un identifiant d'arme, en gérant le cas des mains nues (qui
 * n'existent pas dans l'inventaire).
 */
export function resolveWeapon(actor, weaponId) {
  if (!actor) return null;
  if (weaponId === UNARMED_ID) return buildUnarmedWeapon(actor);
  return actor.items.get(weaponId) ?? null;
}
