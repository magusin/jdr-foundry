// module/rules/item-link.js
//
// Synchronisation OPT-IN d'objets/armes/armures/sorts/consommables/recettes
// distribués aux PJ — contrepartie de quest-group.js pour tout ce qui n'est
// pas une quête. Une copie embarquée reste par défaut un item Foundry
// indépendant de sa source (comportement natif documenté dans CLAUDE.md) :
// ce module ajoute un lien explicite, posé par le MJ via la case "Garder
// synchronisé" sur la fiche, entre plusieurs exemplaires qu'il veut garder
// alignés — cocher la case relie rétroactivement tous les exemplaires déjà
// distribués qui semblent être "le même objet" (même source de compendium,
// ou même nom), et toute édition future d'un CHAMP DE DÉFINITION (dégâts,
// poids, prix, bonus...) sur l'un se répercute sur tous les autres.
//
// Ce que ça NE synchronise JAMAIS : l'état propre à chaque copie (équipé,
// emplacement, quantité, utilisations restantes, recharge/cooldown en
// cours, aura active/enabled...). C'est une liste BLANCHE de champs de
// définition, pas une liste noire d'état d'instance — un champ absent de
// SYNC_FIELDS ne synchronise jamais, même par excès de prudence : mieux
// vaut sous-synchroniser que corrompre l'état d'une copie qu'un joueur a
// déjà équipée/personnalisée.

const FLAG_SCOPE = "rpg";
const FLAG_LINK_ID = "linkId";
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

function getLinkId(item) {
  return String(item?.flags?.[FLAG_SCOPE]?.[FLAG_LINK_ID] ?? "").trim();
}

function isLinkSyncOn(item) {
  return !!item?.flags?.[FLAG_SCOPE]?.[FLAG_LINK_SYNC];
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
 * Tous les exemplaires (source monde comprise) partageant ce linkId.
 * Clé exacte (pas une empreinte floue) : sert à la propagation courante,
 * une fois le groupe déjà établi par activateItemSync.
 */
export function findLinkedCopies(linkId, excludeUuid = null) {
  if (!linkId) return [];
  const found = [];
  for (const it of worldAndPartyItems()) {
    if (excludeUuid && it.uuid === excludeUuid) continue;
    if (getLinkId(it) === linkId) found.push(it);
  }
  return found;
}

/**
 * Exemplaires embarqués sur un PJ "probablement identiques" (même
 * empreinte) et pas déjà dans CE groupe — sert uniquement au rattachement
 * rétroactif quand le MJ active la synchro. Volontairement limité aux
 * PJ (pas aux autres items du monde) : le rattachement rétroactif répond
 * à "qui a déjà reçu cet objet", pas à "fusionner des doublons du monde".
 */
function findFingerprintCopies(item, linkId) {
  if (!SYNC_TYPES.has(item?.type)) return [];
  const fp = fingerprint(item);
  const found = [];
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    for (const it of actor.items) {
      if (it.type !== item.type) continue;
      if (it.uuid === item.uuid) continue;
      if (getLinkId(it) === linkId) continue; // déjà dans le groupe
      if (fingerprint(it) === fp) found.push(it);
    }
  }
  return found;
}

/**
 * Active la synchro pour cet item : crée son linkId si besoin, et
 * rattache rétroactivement tous les exemplaires déjà distribués qui
 * partagent la même empreinte. Sans ce rattachement, cocher la case ne
 * synchroniserait que les futurs envois — pas les copies qu'un PJ a déjà
 * dans son inventaire au moment où le MJ l'active (même raison que
 * quest-group.js#activateQuestSync).
 */
export async function activateItemSync(item) {
  if (!SYNC_TYPES.has(item?.type)) return [];

  let linkId = getLinkId(item);
  if (!linkId) linkId = foundry.utils.randomID(12);
  await item.update({ [`flags.${FLAG_SCOPE}.${FLAG_LINK_ID}`]: linkId, [`flags.${FLAG_SCOPE}.${FLAG_LINK_SYNC}`]: true });

  const copies = findFingerprintCopies(item, linkId);
  for (const copy of copies) {
    await copy.update({ [`flags.${FLAG_SCOPE}.${FLAG_LINK_ID}`]: linkId, [`flags.${FLAG_SCOPE}.${FLAG_LINK_SYNC}`]: true }).catch(() => {});
  }
  return copies;
}

/** Désactive la synchro pour cet item ET tous les exemplaires liés — pour
 *  que décocher arrête la synchro immédiatement, pas juste les futurs envois. */
export async function deactivateItemSync(item) {
  const linkId = getLinkId(item);
  if (!linkId) return [];

  const others = findLinkedCopies(linkId, item.uuid);
  await item.update({ [`flags.${FLAG_SCOPE}.${FLAG_LINK_SYNC}`]: false }).catch(() => {});
  for (const other of others) {
    await other.update({ [`flags.${FLAG_SCOPE}.${FLAG_LINK_SYNC}`]: false }).catch(() => {});
  }
  return others;
}

/**
 * Propage les champs de définition modifiés vers tous les autres
 * exemplaires liés. Filtre `changed` (le payload brut reçu par le hook
 * updateItem, PAS juste les clés qu'on a envie de lire) par la liste
 * blanche du type — un update qui ne touche que de l'état d'instance
 * (ex. équiper une arme) ne propage donc rien du tout.
 */
async function propagateItemUpdate(item, changed) {
  if (!isLinkSyncOn(item)) return;
  const linkId = getLinkId(item);
  if (!linkId) return;

  const allowed = SYNC_FIELDS[item.type];
  if (!allowed) return;

  const flat = foundry.utils.flattenObject(changed ?? {});
  const patch = {};
  for (const key of Object.keys(flat)) {
    if (allowed.some(p => key === p || key.startsWith(`${p}.`))) {
      patch[key] = flat[key];
    }
  }
  if (!Object.keys(patch).length) return;

  const others = findLinkedCopies(linkId, item.uuid);
  for (const other of others) {
    await other.update(patch, { rpgLinkSync: true }).catch(() => {});
  }
}

/**
 * Branche la synchro sur TOUTES les écritures d'item, quel que soit le
 * chemin d'origine (fiche, macro, console) — contrairement à
 * quest-group.js (appelé explicitement depuis chaque action de la fiche
 * Quête), un hook central évite de dupliquer "filtrer les champs +
 * retrouver les copies + réécrire" dans 5 fiches différentes, et ne rate
 * aucun chemin d'écriture futur.
 *
 * options.rpgLinkSync sert de garde anti-boucle : sans elle, réécrire une
 * copie liée déclencherait elle-même ce hook, qui la propagerait à
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
