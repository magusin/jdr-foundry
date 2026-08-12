// module/rules/actor-roles.js
//
// Qui est un PJ, qui est un PNJ ? Il n'existe pas de type d'acteur `npc`
// dans ce système : un PNJ est un acteur `character` ordinaire (c'est ce
// qu'ouvre un lien @UUID[Actor.…] dans une quête ou un journal). La
// distinction est donc déduite, pas déclarée — et elle l'était déjà pour
// décider qui voit la « carte PNJ » au lieu de la fiche complète
// (character-sheet-v2.js). Ce module en fait la source unique, pour que
// les listes de distribution (« 📤 Envoyer », destinataires d'une quête,
// macro « Distribuer un Objet ») s'appuient exactement sur le même
// critère que l'affichage des fiches, et pas sur une deuxième heuristique
// qui divergerait.
//
// Règle, dans l'ordre :
//   1. system.pnjView = "always" → PNJ, "never" → PJ (choix explicite du MJ,
//      dans l'onglet 🎭 PNJ / RP de la fiche) ;
//   2. "auto" (défaut) → PNJ si aucun joueur ne possède l'acteur
//      (`hasPlayerOwner`), ce qui est vrai de tous les PNJ et faux de tous
//      les personnages joueurs, sans rien à cocher.
//
// ⚠️ Un PJ dont le compte joueur n'est pas encore attribué n'a pas de
// propriétaire joueur et sera donc rangé avec les PNJ. C'est pour ça que
// les listes de distribution REGROUPENT les PNJ dans une section repliée
// au lieu de les supprimer : rien ne devient inatteignable, et le MJ peut
// corriger durablement avec pnjView = "Toujours la fiche complète (PJ)".

/** true si cet acteur doit être traité comme un PNJ (voir en-tête). */
export function isNpcActor(actor) {
  if (!actor) return false;
  if (actor.type !== "character") return false;
  const mode = String(actor.system?.pnjView ?? "auto");
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !actor.hasPlayerOwner;
}

/** true pour un personnage joueur (type character non détecté comme PNJ). */
export function isPlayerCharacter(actor) {
  return actor?.type === "character" && !isNpcActor(actor);
}

/** Étiquette courte pour les listes mêlant PJ, PNJ et monstres. */
export function roleLabel(actor) {
  if (actor?.type === "monster") return "Monstre";
  return isNpcActor(actor) ? "PNJ" : "PJ";
}

const byName = (a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "fr");

/** Personnages JOUEURS du monde, triés par nom. */
export function partyCharacters() {
  return game.actors.filter(isPlayerCharacter).sort(byName);
}

/** PNJ du monde (acteurs `character` non joueurs), triés par nom. */
export function npcCharacters() {
  return game.actors.filter(isNpcActor).sort(byName);
}

/**
 * Les deux listes en une passe, pour les fenêtres qui affichent les PJ
 * puis les PNJ dans une section à part (`{pjs, npcs}`).
 */
export function splitCharacters() {
  const pjs = [];
  const npcs = [];
  for (const a of game.actors) {
    if (a.type !== "character") continue;
    (isNpcActor(a) ? npcs : pjs).push(a);
  }
  return { pjs: pjs.sort(byName), npcs: npcs.sort(byName) };
}
