// module/rules/item-link.js
//
// Synchronisation d'objets/armes/armures/sorts/consommables/recettes/loot
// entre TOUS les porteurs — PJ, PNJ et monstres — contrepartie de
// quest-group.js pour tout ce qui n'est pas une quête.
//
// PAR DÉFAUT (aucune action requise du MJ), deux items du même
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
// emplacement, quantité, recharge/cooldown en cours, aura
// active/enabled...). C'est une liste BLANCHE de champs de
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
 * Champs de définition qui ne vivent PAS sous `system` : ils sont sur le
 * document lui-même et valent pour tous les types.
 *
 * Le nom en fait partie, et ce n'est pas anodin : l'empreinte de rattachement
 * (voir fingerprint()) retombe sur le nom quand l'objet ne vient pas d'un
 * compendium. Ne pas propager un renommage ne laissait donc pas simplement
 * les copies avec un ancien libellé — ça les sortait DÉFINITIVEMENT du
 * groupe, sans le dire : l'exemplaire renommé n'avait plus la même empreinte
 * que les autres, et plus aucune modification ultérieure ne les atteignait.
 * On propage donc le renommage à tout le groupe d'un coup, en le retrouvant
 * via son empreinte d'AVANT la modification (voir PENDING_FINGERPRINTS).
 */
const SYNC_DOC_FIELDS = ["name", "img"];

/**
 * Champs de définition synchronisables par type. Volontairement absents,
 * pour chaque type concerné :
 *  - system.qte : compteur propre à chaque copie (combien CE PJ en a),
 *    jamais une "définition".
 *  - system.emplacement, system.equipe, system.actif : état d'équipement/
 *    activation en cours (confirmés par la liste blanche joueur d'init.js,
 *    preUpdateItem — "system.emplacement" y est écrit par le SYSTÈME
 *    quand un joueur équipe une arme dans une main précise : synchroniser
 *    ce champ écraserait quelle main chaque PJ a réellement équipée).
 *  - system.cooldown.restant / system.recharge.* : recharge EN COURS (même
 *    liste blanche — le système les écrit à chaque lancer de sort).
 *    system.cooldown.max, lui, EST de la définition : c'est le champ
 *    « Recharge (tours) » que le MJ saisit sur la fiche du sort.
 *  - system.aura.active / system.aura.enabled : le passif est-il allumé sur
 *    CE porteur en ce moment (les deux figurent dans la liste blanche joueur
 *    d'init.js — c'est le joueur lui-même qui les bascule depuis son menu).
 *    Le RESTE de system.aura (portée, cible, clé, dotFlat, cleanseDC) est de
 *    la définition et se synchronise, sous-champ par sous-champ : la première
 *    version excluait l'objet `aura` en bloc faute de découpage sûr, ce qui
 *    laissait la portée d'une aura non synchronisée entre deux exemplaires
 *    du même sort.
 */
const SYNC_FIELDS = {
  weapon: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.effects", "system.resistances", "system.resistancesElem",
    "system.recetteAssociee", "system.bonus",
    "system.lore", "system.description",
    "system.twoHands", "system.categorie", "system.difficulte", "system.fatigueCost", "system.livraison",
    // Recharge : `max` est de la définition (une arbalète se recharge en un
    // tour, sur toutes les copies), `restant` est l'état de CETTE copie — le
    // synchroniser rendrait toutes les arbalètes du monde indisponibles dès
    // qu'un joueur tire. Même découpage que pour un sort, plus bas.
    "system.cooldown.max",
    "system.tag",
    "system.portee", "system.range", "system.allonge", "system.damage", "system.crit", "system.effet"
  ],
  armor: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.effects", "system.resistances", "system.resistancesElem", "system.amplifications",
    "system.recetteAssociee", "system.bonus",
    "system.lore", "system.description"
  ],
  // Relique : mêmes champs de définition qu'une armure (elles partagent la
  // fiche) — system.emplacement reste exclu comme partout ailleurs, c'est
  // de l'état d'équipement, pas de la définition.
  relic: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.effects", "system.resistances", "system.resistancesElem", "system.amplifications",
    "system.recetteAssociee", "system.bonus",
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
    "system.difficulte", "system.moveSelf", "system.livraison", "system.damage", "system.damageCrit",
    "system.damages", "system.restores", "system.effectsUI", "system.tag",
    "system.cooldown.max",
    "system.aura.target", "system.aura.key", "system.aura.range",
    "system.aura.dotFlat", "system.aura.cleanseDC"
  ],
  recipe: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.lore", "system.description",
    "system.ingredients", "system.result", "system.difficulte"
  ],
  // Objet ordinaire : mêmes champs qu'un consommable. `system.effet` en fait
  // partie — c'est un champ plein droit de la fiche générique (partagée avec
  // les consommables), et il manquait ici alors que le MJ le voit et l'édite
  // au même titre que le poids ou le prix.
  loot: [
    "system.poids", "system.prix", "system.vendeurAssocie",
    "system.lore", "system.description", "system.effet"
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

/**
 * Tous les items susceptibles d'être un exemplaire du même objet : ceux du
 * monde, puis ceux de TOUS les acteurs.
 *
 * Le filtre `actor.type !== "character"` d'origine écartait silencieusement
 * les monstres — or c'est justement sur eux que vivent la plupart des sorts
 * et une bonne partie des objets. Modifier un sort ne touchait donc aucune
 * des créatures qui l'utilisent réellement, ce qui se lit exactement comme
 * « la synchro marche pour l'équipement mais pas pour les sorts » : les
 * armes/armures, elles, sont surtout portées par des PJ (type `character`),
 * les seuls que la boucle regardait. Aucune raison de distinguer les types :
 * un objet identique doit rester identique où qu'il soit.
 *
 * Les tokens NON LIÉS ont leur propre copie des items (delta du token), qui
 * n'est pas dans `game.actors` : on les balaie aussi, mais uniquement pour la
 * scène affichée — Foundry ne charge pas les autres. Un monstre posé sur une
 * scène qu'on n'a pas ouverte garde donc son ancienne version jusqu'à ce
 * qu'il soit reposé depuis son prototype (lui, bien mis à jour).
 */
function* syncCandidates() {
  const seen = new Set();
  const emit = function* (it) {
    if (!it?.uuid || seen.has(it.uuid)) return;
    seen.add(it.uuid);
    yield it;
  };

  for (const it of game.items) yield* emit(it);
  for (const actor of game.actors) {
    for (const it of actor.items) yield* emit(it);
  }
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token?.document?.actorLink) continue;   // déjà couvert par game.actors
    for (const it of token?.actor?.items ?? []) yield* emit(it);
  }
}

/**
 * Tous les exemplaires (objet du monde compris) "probablement identiques"
 * à `item` — même type, même empreinte — hors ceux explicitement
 * désynchronisés. Recalculé à chaque appel : pas de groupe figé à l'avance,
 * donc pas d'étape "d'activation" à oublier de refaire pour une copie
 * distribuée avant que le MJ n'y pense.
 */
export function findMatchingCopies(item, excludeUuid = null, fingerprintOverride = null) {
  if (!SYNC_TYPES.has(item?.type)) return [];
  if (isOptedOut(item)) return [];
  const fp = fingerprintOverride ?? fingerprint(item);
  const found = [];
  for (const it of syncCandidates()) {
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
    if (SYNC_DOC_FIELDS.includes(key) ||
        allowed.some(p => key === p || key.startsWith(`${p}.`))) {
      patch[key] = flat[key];
    }
  }
  if (!Object.keys(patch).length) return;

  // Renommage : `item` porte DÉJÀ le nouveau nom quand ce hook s'exécute, donc
  // le chercher par son empreinte actuelle ne retrouverait plus personne. On
  // réutilise celle relevée juste avant l'écriture (preUpdateItem).
  const previousFp = PENDING_FINGERPRINTS.get(item.uuid) ?? null;
  PENDING_FINGERPRINTS.delete(item.uuid);

  const others = findMatchingCopies(item, item.uuid, previousFp);
  for (const other of others) {
    await other.update(patch, { rpgLinkSync: true }).catch(() => {});
  }
}

/**
 * Empreinte relevée AVANT l'écriture, pour les seules mises à jour qui
 * touchent au nom (les seules où l'empreinte peut changer sous nos pieds).
 * Indexée par uuid, consommée immédiatement par propagateItemUpdate.
 */
const PENDING_FINGERPRINTS = new Map();

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
  // Relève l'empreinte d'avant la modification quand le nom change : après
  // coup, l'ancien nom n'est plus lisible nulle part et le groupe serait
  // introuvable (voir SYNC_DOC_FIELDS).
  Hooks.on("preUpdateItem", (item, changed, options, userId) => {
    if (options?.rpgLinkSync) return;
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;
    if (changed?.name === undefined) return;
    PENDING_FINGERPRINTS.set(item.uuid, fingerprint(item));
  });

  Hooks.on("updateItem", (item, changed, options, userId) => {
    if (options?.rpgLinkSync) return;
    if (userId !== game.userId) return;
    if (!game.user.isGM) {
      PENDING_FINGERPRINTS.delete(item?.uuid);
      return;
    }
    propagateItemUpdate(item, changed).catch(e => console.warn("[RPG] synchro objet lié :", e));
  });
}
