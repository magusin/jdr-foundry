// module/rules/item-link.js
//
// Synchronisation d'objets/armes/armures/sorts/consommables/recettes/loot
// entre PJ — contrepartie de quest-group.js pour tout ce qui n'est pas une
// quête. PAR DÉFAUT (aucune action requise du MJ), deux items du même
// type portant la même empreinte (même source de compendium, ou même nom)
// sont traités comme "le même objet" : toute modification d'un champ de
// DÉFINITION (dégâts, poids, prix, bonus...) sur l'un se répercute sur
// tous les autres, où qu'ils soient — objet du monde, inventaire d'un PJ,
// que la copie ait été créée avant ou après l'existence de cette
// fonctionnalité. Il n'y a PAS d'étape "d'activation" à part : la
// correspondance est recalculée à chaque modification, pas figée une
// fois pour toutes au moment de la distribution (une première version de
// ce module procédait ainsi — voir la case "🔗 Synchro" ci-dessous — mais
// ça laissait justement les copies distribuées AVANT l'activation hors
// synchro tant que le MJ ne rouvrait pas explicitement la fiche pour
// cocher la case : "ça ne marche que quand je coche la case").
//
// Ce que ça NE synchronise JAMAIS : l'état propre à chaque copie (équipé,
// emplacement, quantité, utilisations restantes, recharge/cooldown en
// cours, aura active/enabled...). C'est une liste BLANCHE de champs de
// définition, pas une liste noire d'état d'instance — un champ absent de
// SYNC_FIELDS ne synchronise jamais, même par excès de prudence : mieux
// vaut sous-synchroniser que corrompre l'état d'une copie qu'un joueur a
// déjà équipée/personnalisée.
//
// Un exemplaire précis peut sortir du groupe (ex. un joueur l'a fait
// enchanter en objet unique) en décochant "🔗 Synchro" sur SA fiche —
// flags.rpg.linkSync passe alors explicitement à false, et cet exemplaire
// n'est plus ni source ni cible de la synchro tant que la case reste
// décochée, même si un autre exemplaire du même nom continue d'exister.

const FLAG_SCOPE = "rpg";
const FLAG_LINK_SYNC = "linkSync";

/**
 * Champs de définition synchronisables par type. Volontairement absents,
 * pour chaque type concerné :
 *  - system.qte / system.utilisations : compteurs propres à chaque copie
 *    (combien CE PJ en a / lui reste), jamais une "définition".
 *  - system.emplacement, system.equipe, system.actif : état d'équipement/
 *    activation en cours (confirmés par la liste blanche joueur d'init.js,
 *    preUpdateItem — "system.emplacement" y est écrit par le SYSTÈME
 *    quand un joueur équipe une arme dans une main précise : synchroniser
 *    ce champ écraserait quelle main chaque PJ a réellement équipée).
 *  - system.cooldown.* / system.recharge.* : recharge EN COURS (même
 *    liste blanche — le système les écrit à chaque lancer de sort).
 *  - system.aura : mélange définition (min/max/target/key/range...) et
 *    état d'exécution propre à chaque copie (active/enabled) dans le
 *    MÊME objet imbriqué — pas de découpage sûr sans risquer d'écraser
 *    l'activation en cours d'un buff sur un PJ. Exclu en bloc.
 */
const SYNC_FIELDS = {
  weapon: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.effects", "system.resistances", "system.recetteAssociee", "system.bonus",
    "system.lore", "system.description",
    "system.twoHands", "system.difficulte", "system.fatigueCost", "system.livraison",
    "system.portee", "system.range", "system.allonge", "system.damage", "system.crit", "system.effet"
  ],
  armor: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.effects", "system.resistances", "system.recetteAssociee", "system.bonus",
    "system.lore", "system.description"
  ],
  consumable: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.lore", "system.description", "system.effet"
  ],
  spell: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.effects", "system.resistances", "system.recetteAssociee", "system.bonus",
    "system.lore", "system.description",
    "system.speed", "system.range", "system.targetCount", "system.fatigueCost", "system.coutMana",
    "system.difficulte", "system.livraison", "system.damage", "system.damageCrit",
    "system.damages", "system.restores", "system.effectsUI", "system.tag"
  ],
  recipe: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.lore", "system.description",
    "system.ingredients", "system.result", "system.difficulte"
  ],
  loot: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.lore", "system.description"
  ]
};

const SYNC_TYPES = new Set(Object.keys(SYNC_FIELDS));

/** true seulement si le MJ a explicitement décoché "🔗 Synchro" sur CET
 *  exemplaire — undefined/jamais posé compte comme "synchronisé" (c'est
 *  le comportement par défaut, pas un opt-in). */
function isOptedOut(item) {
  return item?.flags?.[FLAG_SCOPE]?.[FLAG_LINK_SYNC] === false;
}

/** Empreinte "probablement le même objet" : source de compendium si
 *  connue, sinon type+nom — même heuristique que codex.js. */
function fingerprint(item) {
  const src = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "";
  if (src) return `src:${src}`;
  return `name:${item.type}:${String(item?.name ?? "").trim().toLowerCase()}`;
}

function* worldAndPartyItems() {
  for (const it of game.items) yield it;
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    for (const it of actor.items) yield it;
  }
}

/**
 * Tous les exemplaires (objet du monde compris) "probablement identiques"
 * à `item` — même type, même empreinte — hors ceux explicitement
 * désynchronisés. Recalculé à chaque appel : pas de groupe figé à l'avance,
 * donc pas d'étape "d'activation" à oublier de refaire pour une copie
 * distribuée avant que le MJ n'y pense.
 */
export function findMatchingCopies(item, excludeUuid = null) {
  if (!SYNC_TYPES.has(item?.type)) return [];
  if (isOptedOut(item)) return [];
  const fp = fingerprint(item);
  const found = [];
  for (const it of worldAndPartyItems()) {
    if (it.type !== item.type) continue;
    if (excludeUuid && it.uuid === excludeUuid) continue;
    if (isOptedOut(it)) continue;
    if (fingerprint(it) === fp) found.push(it);
  }
  return found;
}

/**
 * Coche/décoche "🔗 Synchro" pour CET exemplaire précis : décocher pose
 * flags.rpg.linkSync=false (l'exclut du groupe, dans les deux sens —
 * il ne suit plus les autres ET les autres ne le suivent plus) ; cocher
 * efface un désistement antérieur (retour au comportement par défaut).
 * Retourne les autres exemplaires actuellement assortis, pour que
 * l'appelant puisse informer le MJ ("relié à N copie(s)").
 */
export async function setItemSyncOptOut(item, optOut) {
  await item.update({ [`flags.${FLAG_SCOPE}.${FLAG_LINK_SYNC}`]: !optOut });
  return findMatchingCopies(item, item.uuid);
}

/**
 * Propage les champs de définition modifiés vers tous les autres
 * exemplaires assortis. Filtre `changed` (le payload brut reçu par le
 * hook updateItem, PAS juste les clés qu'on a envie de lire) par la
 * liste blanche du type — un update qui ne touche que de l'état
 * d'instance (ex. équiper une arme) ne propage donc rien du tout.
 */
async function propagateItemUpdate(item, changed) {
  const allowed = SYNC_FIELDS[item?.type];
  if (!allowed) return;

  const flat = foundry.utils.flattenObject(changed ?? {});
  const patch = {};
  for (const key of Object.keys(flat)) {
    if (allowed.some(p => key === p || key.startsWith(`${p}.`))) {
      patch[key] = flat[key];
    }
  }
  if (!Object.keys(patch).length) return;

  const others = findMatchingCopies(item, item.uuid);
  for (const other of others) {
    await other.update(patch, { rpgLinkSync: true }).catch(() => {});
  }
}

/**
 * Branche la synchro sur TOUTES les écritures d'item, quel que soit le
 * chemin d'origine (fiche, macro, console) — un hook central évite de
 * dupliquer "filtrer les champs + retrouver les copies + réécrire" dans
 * 5 fiches différentes, et ne rate aucun chemin d'écriture futur.
 *
 * options.rpgLinkSync sert de garde anti-boucle : sans elle, réécrire une
 * copie assortie déclencherait elle-même ce hook, qui la propagerait à
 * nouveau indéfiniment. `userId !== game.userId` évite en plus que
 * chaque client connecté (pas seulement celui qui a fait la modif)
 * tente la même propagation en double.
 */
export function installItemLinkSync() {
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if (options?.rpgLinkSync) return;
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;
    propagateItemUpdate(item, changed).catch(e => console.warn("[RPG] synchro objet lié :", e));
  });
}
