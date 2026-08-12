// module/rules/unarmed.js
//
// Attaque de base — tout personnage peut toujours attaquer, même sans arme.
//
// Si le personnage a une arme équipée, c'est elle qui sert. Sinon on fabrique
// une arme temporaire « Mains nues » (poings/griffes) : elle n'est jamais
// enregistrée dans l'inventaire, elle est reconstruite à l'identique au moment
// de résoudre l'attaque grâce à l'identifiant réservé UNARMED_ID.

/**
 * Identifiant réservé de l'arme « Mains nues ».
 *
 * ⚠️ Doit être un identifiant Foundry VALIDE : exactement 16 caractères
 * alphanumériques. L'ancienne valeur, "__rpg_unarmed__", ne l'était pas (15
 * caractères, avec des soulignés) et faisait échouer la validation du
 * document dès sa construction :
 *   « _id: must be a valid 16-character alphanumeric ID »
 * buildUnarmedWeapon() attrapait l'erreur et renvoyait null — donc, en
 * pratique, plus AUCUNE attaque à mains nues n'était possible : ni depuis le
 * menu d'action (l'entrée disparaissait de la liste), ni depuis l'action de
 * base « Attaquer » d'un personnage désarmé.
 */
export const UNARMED_ID = "rpgUnarmed000000";

/**
 * Ancienne valeur, encore présente dans les messages de chat d'attaques
 * déclarées avant ce correctif : resolveWeapon() doit continuer de la
 * reconnaître, sinon ces messages-là résolvent sur « arme introuvable ».
 */
const LEGACY_UNARMED_IDS = ["__rpg_unarmed__"];

/** true si cet identifiant désigne l'arme temporaire « Mains nues ». */
export function isUnarmedId(id) {
  return id === UNARMED_ID || LEGACY_UNARMED_IDS.includes(id);
}

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
  if (isUnarmedId(weaponId)) return buildUnarmedWeapon(actor);
  return actor.items.get(weaponId) ?? null;
}
