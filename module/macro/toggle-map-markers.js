/**
 * Macro "Basculer les Repères de Carte (MJ)"
 *
 * Sur une scène utilisée comme carte régionale (déplacement des tokens
 * joueurs par-dessus), les repères de lieux — Dessins Foundry (icône en
 * texture de remplissage + libellé texte) placés sur la carte — peuvent
 * gêner la lecture pendant qu'on déplace des tokens. Un Dessin, contrairement
 * à une Note, n'a besoin d'aucune Entrée de journal ni permission séparée
 * pour être visible des joueurs : seul son propre champ `hidden` compte.
 * Cette macro bascule en un clic la visibilité de TOUS les Dessins de la
 * scène active, pour tout le monde (MJ et joueurs).
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.warn("Aucune scène active.");
    return;
  }
  const drawings = scene.drawings;
  if (!drawings.size) {
    ui.notifications.warn("Aucun repère (Dessin) sur cette scène.");
    return;
  }
  const nextHidden = drawings.some(d => !d.hidden);
  await scene.updateEmbeddedDocuments("Drawing", drawings.map(d => ({ _id: d.id, hidden: nextHidden })));
  ui.notifications.info(nextHidden
    ? `Repères de carte cachés (${drawings.size}).`
    : `Repères de carte affichés (${drawings.size}).`);
})();
