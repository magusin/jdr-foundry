// module/rules/default-actions.js
//
// Actions de base possédées par TOUS les personnages et monstres.
//
// Certaines actions ne s'achètent pas et ne s'apprennent pas : n'importe qui
// peut souffler pour récupérer son souffle. Elles sont créées comme de vrais
// objets « spell » sur l'acteur, ce qui leur donne gratuitement tout le reste
// du système : déclaration en chat, validation MJ, budget d'action, barre de
// raccourcis, filtres de l'onglet Sorts.
//
// Attribution :
//   • à la création d'un acteur (hook createActor)
//   • en rattrapage au chargement du monde, pour les acteurs déjà existants
//
// Chaque acteur porte un drapeau `flags.rpg.defaultActions` avec la version
// déjà appliquée : un MJ qui supprime volontairement « Repos » ne le voit pas
// revenir au prochain rechargement.

const FLAG_SCOPE = "rpg";
const FLAG_KEY   = "defaultActions";
const VERSION    = 1;

/** Clé stable posée sur l'objet, indépendante du nom affiché. */
export const ACTION_KEY_FLAG = "defaultActionKey";

/**
 * Repos — récupère de la fatigue.
 * Formule : 1d10 + 5 + Endurance/10, sur soi, sans cible ni jet de touché.
 */
function restActionData() {
  return {
    name: "Repos",
    type: "spell",
    img: "icons/magic/life/heart-cross-green.webp",
    system: {
      speed: "normal",
      livraison: "physique",
      tag: "neutre",
      coutMana: 0,
      fatigueCost: 0,          // se reposer ne coûte pas de fatigue
      difficulte: 0,
      range: { min: 0, max: 0 },
      targetCount: { min: 0, max: 0 },   // aucune cible requise
      cooldown: { max: 0, restant: 0 },
      damages: [],
      restores: [{
        id: "repos-fatigue",
        resource: "fatigue",
        cible: "self",
        dice: "1d10",
        flat: 5,
        stat: "endurance",
        per: 10,
        perStep: 1,
        critDice: "",
        critFlat: 0
      }],
      effectsUI: [],
      description: "<p>Le personnage souffle et récupère <b>1d10 + 5 + Endurance/10</b> "
                 + "points de fatigue. Coûte une action.</p>"
    },
    flags: { [FLAG_SCOPE]: { [ACTION_KEY_FLAG]: "repos" } }
  };
}

/** Toutes les actions de base, indexées par clé. */
const DEFAULT_ACTIONS = { repos: restActionData };

/** Types d'acteurs concernés. */
const TARGET_TYPES = new Set(["character", "monster"]);

/**
 * Ajoute à un acteur les actions de base qui lui manquent.
 * Idempotent : ne recrée jamais un objet déjà présent.
 * @returns {Promise<string[]>} clés effectivement ajoutées
 */
export async function grantDefaultActions(actor) {
  if (!actor || !TARGET_TYPES.has(actor.type)) return [];

  const missing = [];
  for (const [key, build] of Object.entries(DEFAULT_ACTIONS)) {
    const already = actor.items.some(i =>
      i.getFlag?.(FLAG_SCOPE, ACTION_KEY_FLAG) === key || i.name === build().name);
    if (!already) missing.push(build());
  }

  if (missing.length) await actor.createEmbeddedDocuments("Item", missing);
  await actor.setFlag(FLAG_SCOPE, FLAG_KEY, VERSION);
  return missing.map(m => m.name);
}

/**
 * Rattrapage sur les acteurs déjà créés avant l'arrivée de cette fonction.
 * Ne touche qu'aux acteurs jamais traités (drapeau absent ou plus ancien).
 * @returns {Promise<number>} nombre d'acteurs mis à jour
 */
export async function backfillDefaultActions() {
  if (!game.user.isGM) return 0;

  const todo = game.actors.filter(a =>
    TARGET_TYPES.has(a.type) && Number(a.getFlag(FLAG_SCOPE, FLAG_KEY) ?? 0) < VERSION);

  let done = 0;
  for (const actor of todo) {
    try {
      const added = await grantDefaultActions(actor);
      if (added.length) done++;
    } catch (e) {
      console.warn(`[RPG] actions de base sur ${actor.name} :`, e);
    }
  }
  if (done) console.log(`[RPG] Actions de base ajoutées à ${done} acteur(s).`);
  return done;
}

/** Branche l'attribution automatique à la création d'un acteur. */
export function installDefaultActions() {
  Hooks.on("createActor", async (actor, options, userId) => {
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;
    if (!TARGET_TYPES.has(actor.type)) return;
    try {
      await grantDefaultActions(actor);
    } catch (e) {
      console.warn("[RPG] actions de base à la création :", e);
    }
  });
}
