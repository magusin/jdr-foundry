// module/rules/inventory.js
//
// Ajout d'un objet à l'inventaire d'un acteur, avec EMPILEMENT.
//
// Un objet que l'acteur possède déjà n'est plus dupliqué : sa quantité
// augmente. Deux types s'empilent — « Objet » (loot) et « Consommable » —
// tout le reste garde un exemplaire par ligne :
//   - arme/armure/relique : chaque exemplaire porte son propre état
//     d'équipement (equipe, emplacement) ; les empiler rendrait impossible
//     d'en équiper un et d'en garder un autre au sac ;
//   - sort/recette/quête : ce ne sont pas des marchandises, une deuxième
//     copie n'a pas de sens (et la quête porte en plus sa propre
//     progression).
//
// Le consommable a longtemps été exclu au motif que chaque exemplaire portait
// son propre compteur `system.utilisations` — une potion à moitié bue n'étant
// pas une neuve, les fusionner aurait écrasé un compteur avec l'autre. Ce
// champ n'existe plus : un consommable se compte en QUANTITÉ, exactement
// comme un objet, et « consommer » retire 1 à la pile. Il n'y a donc plus
// aucun état par exemplaire à préserver, et l'empilement est inconditionnel.
//
// Ce qui motivait le changement : dix rations identiques occupaient dix
// lignes d'inventaire, et un butin qui rend une dizaine de consommables par
// monstre rendait le sac illisible dès le premier combat.
//
// TOUS les chemins qui donnent un objet à un acteur passent par ici
// (glisser-déposer sur la fiche, bouton « 📤 Envoyer », macro « Distribuer
// un Objet », récompense de quête, résultat de forge) — sinon l'empilement
// ne vaudrait que pour le chemin qui y pense, et c'est justement le
// symptôme rapporté. Les macros n'étant pas des modules ES, l'API est aussi
// exposée sur `game.rpg.inventory` (voir init.js).

import { carriedWeight, CHARGE_TIERS } from "../documents/actor.js";

/** Types dont deux exemplaires identiques fusionnent en une quantité. */
const STACKABLE_TYPES = new Set(["loot", "consumable"]);

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
 *
 * Aucun type empilable ne porte d'état par exemplaire : la quantité EST le
 * seul compteur, pour un objet comme pour un consommable. Un type qu'on
 * rendrait empilable en gardant un compteur par copie devrait, lui, exiger
 * l'égalité de ce compteur en plus de l'empreinte — sans quoi la fusion
 * écraserait silencieusement la valeur d'un exemplaire avec celle de l'autre.
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
 * L'ajout de `data` ×`added` ferait-il dépasser le plafond d'encombrement ?
 *
 * Le plafond est un mur : au-delà de CHARGE_TIERS.bloque (120 % de la
 * capacité) le sac n'accepte plus rien. Entre 100 % et 120 % on peut encore
 * charger, au prix des -50 % de vitesse (voir prepareDerivedData).
 *
 * Un acteur sans capacité (podsMax 0 — les monstres) n'est jamais limité :
 * la contrainte est une règle de jeu pour les personnages, pas une propriété
 * physique du monde.
 *
 * @returns {{blocked: boolean, current: number, max: number, incoming: number, ceiling: number}}
 */
export function chargeCheck(actor, data, added = 1) {
  const max = Number(actor?.system?.charge?.podsMax ?? 0) || 0;
  const current = carriedWeight(actor);
  const poids = Number(data?.system?.poids ?? 0) || 0;
  const incoming = Math.round(poids * Math.max(0, added) * 10) / 10;
  const ceiling = Math.round(max * CHARGE_TIERS.bloque * 10) / 10;

  // Pas de capacité définie, ou objet sans poids : rien à refuser. Un objet de
  // poids nul ne doit jamais être bloqué, même sur un acteur déjà au-delà du
  // plafond — sinon une quête ne pourrait plus remettre sa propre entrée de
  // journal à un joueur trop chargé.
  const blocked = max > 0 && incoming > 0 && (current + incoming) > ceiling;

  return { blocked, current, max, incoming, ceiling };
}

/**
 * Donne `source` (Item document ou données brutes) à `actor`.
 *
 * @param {Actor} actor
 * @param {Item|object} source
 * @param {object} [options]
 * @param {number} [options.qty] Quantité à ajouter — par défaut
 *   `system.qte` des données fournies, sinon 1.
 * @param {boolean} [options.ignoreCharge] Passe outre le plafond
 *   d'encombrement. Réservé aux gains que le personnage a DÉJÀ mérités au
 *   moment où on les lui remet — récompense de quête, résultat de forge dont
 *   les ingrédients viennent d'être consommés : un refus y ferait disparaître
 *   quelque chose d'irrécupérable. Le ramassage ordinaire, lui, se refuse
 *   sans dommage (on repose l'objet par terre).
 * @returns {Promise<{item: Item|null, stacked: boolean, added: number, total: number, refused?: boolean, reason?: string, charge?: object}>}
 *   `stacked` = la quantité d'un exemplaire existant a été augmentée
 *   (aucun doublon créé) ; `total` = quantité de la ligne après l'ajout ;
 *   `refused` = rien n'a été ajouté, `reason` dit pourquoi.
 */
export async function addItemToActor(actor, source, options = {}) {
  if (!actor) return { item: null, stacked: false, added: 0, total: 0 };

  const data = toData(source);
  const added = qty(options.qty ?? data?.system?.qte, 1);
  if (data.system) data.system.qte = added;

  if (!options.ignoreCharge) {
    const charge = chargeCheck(actor, data, added);
    if (charge.blocked) {
      return {
        item: null, stacked: false, added: 0, total: 0, refused: true, charge,
        reason: `${actor.name} est trop chargé : ${charge.current} + ${charge.incoming} pods dépasserait le plafond de ${charge.ceiling} (120 % de ${charge.max}).`
      };
    }
  }

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
  if (result?.refused) {
    return `« ${name} » refusé — ${result.reason ?? "inventaire plein."}`;
  }
  if (result?.stacked) {
    return `« ${name} » : quantité portée à ${result.total} sur ${actorName}.`;
  }
  return `« ${name} » ajouté à ${actorName}.`;
}
