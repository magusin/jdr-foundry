// module/rules/inventory.js
//
// Ajout d'un objet à l'inventaire d'un acteur, avec EMPILEMENT.
//
// Un « Objet » (type loot) que l'acteur possède déjà n'est plus dupliqué :
// sa quantité augmente. C'est le seul type empilable, volontairement —
// tout le reste garde un exemplaire par ligne :
//   - arme/armure/relique : chaque exemplaire porte son propre état
//     d'équipement (equipe, emplacement) ; les empiler rendrait impossible
//     d'en équiper un et d'en garder un autre au sac ;
//   - consommable : chaque exemplaire a son propre compteur
//     `system.utilisations` (une potion à moitié bue n'est pas la même
//     chose qu'une neuve) ;
//   - sort/recette/quête : ce ne sont pas des marchandises, une deuxième
//     copie n'a pas de sens (et la quête porte en plus sa propre
//     progression).
//
// TOUS les chemins qui donnent un objet à un acteur passent par ici
// (glisser-déposer sur la fiche, bouton « 📤 Envoyer », macro « Distribuer
// un Objet », récompense de quête, résultat de forge) — sinon l'empilement
// ne vaudrait que pour le chemin qui y pense, et c'est justement le
// symptôme rapporté. Les macros n'étant pas des modules ES, l'API est aussi
// exposée sur `game.rpg.inventory` (voir init.js).

/** Types dont deux exemplaires identiques fusionnent en une quantité. */
const STACKABLE_TYPES = new Set(["loot"]);

/** true si ce type d'item s'empile au lieu de créer un doublon. */
export function isStackableType(type) {
  return STACKABLE_TYPES.has(String(type ?? ""));
}

const norm = (s) => String(s ?? "").trim().toLowerCase();
const qty = (v, d = 1) => {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x > 0 ? x : d;
};

/** Item document OU données brutes → données brutes, sans _id. */
function toData(source) {
  const data = source?.toObject ? source.toObject() : foundry.utils.deepClone(source ?? {});
  delete data._id;
  return data;
}

/**
 * Source de compendium éventuelle — même heuristique que item-link.js / codex.js.
 * Exporté parce que forge.js s'en sert pour reconnaître, dans le sac d'un
 * acteur, l'exemplaire correspondant à l'ingrédient glissé-déposé sur une
 * recette : c'est la même question ("ces deux items sont-ils le même objet ?")
 * et elle doit recevoir la même réponse ici et là.
 */
export function compendiumSourceOf(itemOrData) {
  return String(itemOrData?._stats?.compendiumSource ?? itemOrData?.flags?.core?.sourceId ?? "");
}

const sourceOf = compendiumSourceOf;

/**
 * Exemplaire « unique » : le MJ a explicitement décoché « 🔗 Synchro » sur
 * cette fiche pour la sortir du groupe des copies identiques (voir
 * item-link.js). Le même geste vaut ici — un objet devenu unique
 * (enchanté, signé, maudit…) ne doit pas absorber silencieusement les
 * exemplaires ordinaires du même nom, ni être absorbé par eux.
 */
function isUniqueCopy(itemOrData) {
  return itemOrData?.flags?.rpg?.linkSync === false;
}

/**
 * L'exemplaire déjà présent sur l'acteur dans lequel `data` doit être
 * empilé, ou null s'il faut créer une nouvelle ligne.
 *
 * Correspondance : même type + même nom (insensible à la casse) OU même
 * source de compendium. Le OU est volontaire — un objet renommé sur une
 * copie reste le même objet, et deux objets de même nom venus de deux packs
 * différents sont, pour un joueur qui regarde son sac, la même chose.
 */
export function findStackTarget(actor, data) {
  if (!actor || !isStackableType(data?.type)) return null;
  if (isUniqueCopy(data)) return null;

  const name = norm(data?.name);
  const src = sourceOf(data);

  return actor.items.find(it => {
    if (it.type !== data.type) return false;
    if (isUniqueCopy(it)) return false;
    if (name && norm(it.name) === name) return true;
    const otherSrc = sourceOf(it);
    return !!src && otherSrc === src;
  }) ?? null;
}

/** Quantité déjà détenue par l'acteur pour cet objet (0 s'il ne l'a pas). */
export function ownedQuantity(actor, data) {
  const target = findStackTarget(actor, data?.toObject ? data.toObject() : data);
  return target ? qty(target.system?.qte, 0) : 0;
}

/**
 * Donne `source` (Item document ou données brutes) à `actor`.
 *
 * @param {Actor} actor
 * @param {Item|object} source
 * @param {object} [options]
 * @param {number} [options.qty] Quantité à ajouter — par défaut
 *   `system.qte` des données fournies, sinon 1.
 * @returns {Promise<{item: Item|null, stacked: boolean, added: number, total: number}>}
 *   `stacked` = la quantité d'un exemplaire existant a été augmentée
 *   (aucun doublon créé) ; `total` = quantité de la ligne après l'ajout.
 */
export async function addItemToActor(actor, source, options = {}) {
  if (!actor) return { item: null, stacked: false, added: 0, total: 0 };

  const data = toData(source);
  const added = qty(options.qty ?? data?.system?.qte, 1);
  if (data.system) data.system.qte = added;

  const target = findStackTarget(actor, data);
  if (target) {
    const total = qty(target.system?.qte, 0) + added;
    await target.update({ "system.qte": total });
    return { item: target, stacked: true, added, total };
  }

  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return { item: created ?? null, stacked: false, added, total: added };
}

/**
 * Phrase de confirmation commune à tous les appelants : « ajouté » ou
 * « quantité portée à N », pour que le MJ voie tout de suite qu'un
 * empilement a eu lieu plutôt qu'une création.
 */
export function describeAdd(result, itemName, actorName) {
  const name = itemName ?? result?.item?.name ?? "Objet";
  if (result?.stacked) {
    return `« ${name} » : quantité portée à ${result.total} sur ${actorName}.`;
  }
  return `« ${name} » ajouté à ${actorName}.`;
}
