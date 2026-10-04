// module/utils/primary-gm.js
//
// Qui exécute les écritures AUTOMATIQUES (tick de début de tour, fin de
// combat, montée de niveau, pièges hors combat, auras…) ?
//
// `game.user.isGM` ne suffit pas : il est vrai pour CHAQUE client MJ connecté
// (un MJ assistant, un second MJ), et un hook gardé par lui s'exécute autant
// de fois qu'il y a de MJ en ligne — DOT et régénération appliqués deux fois,
// XP et butin distribués deux fois, piège déclenché deux fois. Foundry élit
// un MJ actif (`game.users.activeGM`) précisément pour ce genre de tâche.
//
// Limite connue : deux ONGLETS du même utilisateur MJ restent deux clients
// élus (activeGM désigne un utilisateur, pas un onglet).
//
// À réserver aux réactions automatiques à un hook. Un clic du MJ sur un
// bouton de chat n'a lieu que sur son propre client : `isGM` y reste correct,
// et exiger d'être le MJ élu bloquerait un MJ assistant.
export function isPrimaryGM() {
  if (!game.user?.isGM) return false;
  const active = game.users?.activeGM;
  // Pas d'élection disponible (ne devrait pas arriver en V13+) : on retombe
  // sur l'ancien comportement plutôt que de ne plus rien exécuter du tout.
  return !active || active.id === game.user.id;
}
