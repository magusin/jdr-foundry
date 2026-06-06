// systems/rpg/module/rules/combat-hooks.js
//
// Ce fichier ne contient PLUS de tick cooldown/durées :
// tout est centralisé dans turn-effects.js → onTurnStartForActor.
//
// Il ne reste que les hooks légers qui ne font PAS de tick.

// (fichier intentionnellement vide de logique de tick)
// onTurnStartForActor est appelé depuis init.js > updateCombat
