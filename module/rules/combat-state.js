// module/rules/combat-state.js
//
// Détection de fin de combat (équipe entière K.O. ou en fuite) et suivi
// de la fuite des combattants. S'appuie sur le flag natif Foundry
// 'flags.core.defeated' (icône crâne du tracker) pour le K.O. — pas de
// réinvention, juste une synchronisation automatique avec system.derived.ko.

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/** Trouve le combattant correspondant à cet acteur dans le combat actif (s'il y en a un). */
export function findCombatantFor(actor) {
  const combat = game.combat;
  if (!combat) return null;
  return combat.combatants.find(c => c.actorId === actor.id) ?? null;
}

/**
 * Synchronise le flag natif 'defeated' (icône crâne) avec system.derived.ko.
 * Appelé à chaque changement de PV.
 */
export async function syncDefeatedFlag(actor) {
  const combatant = findCombatantFor(actor);
  if (!combatant) return;

  const isKO = !!actor.system?.derived?.ko;
  const currentlyDefeated = !!combatant.getFlag("core", "defeated");

  if (isKO !== currentlyDefeated) {
    await combatant.update({ "flags.core.defeated": isKO }).catch(() => {});
  }
}

/** Marque un combattant comme ayant fui (distinct du K.O.). */
export async function markFled(combat, combatantId, reason = "") {
  const combatant = combat?.combatants.get(combatantId);
  if (!combatant) return;
  await combatant.update({
    "flags.rpg.fled": true,
    "flags.core.defeated": true // mêmes effets visuels que K.O. : sorti du combat
  });

  await ChatMessage.create({
    content: `🏃 <b>${combatant.actor?.name ?? combatant.name}</b> fuit le combat !${reason ? ` (${reason})` : ""}`
  });

  if (game.rpg?.journal) {
    game.rpg.journal.appendToCampaignJournal(`<b>${combatant.actor?.name ?? combatant.name}</b> fuit le combat.`).catch(() => {});
  }

  await checkCombatEndCondition(combat);
}

export function isFled(combatant) {
  return !!combatant?.getFlag?.("rpg", "fled");
}

export function isOutOfFight(combatant) {
  return !!combatant?.getFlag?.("core", "defeated") || isFled(combatant);
}

/**
 * Vérifie si un côté entier (PJ ou monstres) est hors combat (K.O. ou fui).
 * Si oui, poste une notification chat avec un bouton pour terminer le combat
 * (le MJ garde la main — rien ne se termine automatiquement sans validation).
 */
export async function checkCombatEndCondition(combat) {
  if (!combat || !combat.started) return;
  if (combat.getFlag("rpg", "endNotified")) return; // déjà notifié, évite le spam

  const combatants = combat.combatants.contents;
  const pjSide = combatants.filter(c => c.actor?.type === "character");
  const monsterSide = combatants.filter(c => c.actor?.type === "monster");

  const pjWiped = pjSide.length > 0 && pjSide.every(isOutOfFight);
  const monstersWiped = monsterSide.length > 0 && monsterSide.every(isOutOfFight);

  if (!pjWiped && !monstersWiped) return;

  await combat.setFlag("rpg", "endNotified", true);

  const winner = pjWiped ? "les monstres" : "les PJ";
  const content = `
    <div style="font-size:13px">
      ⚔️ <b>Plus personne ne se bat dans un camp</b> — victoire pour <b>${winner}</b> (K.O. ou en fuite).
      <div style="margin-top:6px;text-align:right">
        <button type="button" data-action="endCombatNow" style="padding:4px 10px;cursor:pointer">
          Terminer le combat
        </button>
      </div>
    </div>`;

  await ChatMessage.create({ content, flags: { rpg: { combatEndPrompt: true, combatId: combat.id } } });
}
