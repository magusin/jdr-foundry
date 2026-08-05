/**
 * Macro "Basculer les Repères de Carte (MJ)"
 *
 * Sur une scène utilisée comme carte régionale (déplacement des tokens
 * joueurs par-dessus), les repères de lieux — Notes Foundry (icône +
 * libellé) placées sur la carte — peuvent gêner la lecture pendant qu'on
 * déplace des tokens. Cette macro bascule en un clic la visibilité de
 * TOUTES les Notes de la scène active, pour tout le monde (MJ et joueurs) :
 * `hidden` est un champ du document Note, pas un réglage d'affichage local
 * au client MJ, donc ça cache/montre bien les repères pour la table entière.
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
  const notes = scene.notes;
  if (!notes.size) {
    ui.notifications.warn("Aucun repère (Note) sur cette scène.");
    return;
  }
  const nextHidden = notes.some(n => !n.hidden);
  await scene.updateEmbeddedDocuments("Note", notes.map(n => ({ _id: n.id, hidden: nextHidden })));
  ui.notifications.info(nextHidden
    ? `Repères de carte cachés (${notes.size}).`
    : `Repères de carte affichés (${notes.size}).`);
})();
