/**
 * Macro "JDR — Forcer Effets de Tour" (MJ uniquement)
 * Applique manuellement, pour le token contrôlé, les mécaniques de tour :
 * - Décrément des cooldowns de sorts (-1, suppression à 0)
 * - Tick des états actifs (durée -1, DOT appliqué, suppression à 0)
 * - Régénération PV/Mana
 * - Refresh des auras
 *
 * Utile pour :
 * - Tester les mécaniques sans avoir à démarrer un combat complet
 * - Forcer un tick si jamais le hook de combat automatique ne s'est pas déclenché
 * - Faire avancer un PNJ/PJ hors combat (ex: en exploration, repos court)
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const token = canvas?.tokens?.controlled?.[0] ?? null;
  const actor = token?.actor ?? null;

  if (!actor) {
    ui.notifications.warn("Contrôle un token avant de forcer un tour.");
    return;
  }

  const turnEffectsAPI = game.rpg?.turnEffects;
  if (!turnEffectsAPI?.onTurnStartForActor) {
    ui.notifications.error("API turnEffects introuvable (game.rpg.turnEffects).");
    return;
  }

  // Snapshot avant pour affichage du delta
  const before = {
    pv: Number(actor.system?.ressources?.pv?.valeur ?? 0),
    mana: Number(actor.system?.ressources?.mana?.valeur ?? 0)
  };

  // Force le tick (sans contexte de combat -> pas de guard anti-double-tick)
  await turnEffectsAPI.onTurnStartForActor(actor, { combat: null });

  // Régénération manuelle (même logique que le hook updateCombat)
  const pvCur    = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
  const pvMax    = Number(actor.system?.ressources?.pv?.max ?? 0) || 0;
  const manaCur  = Number(actor.system?.ressources?.mana?.valeur ?? 0) || 0;
  const manaMax  = Number(actor.system?.ressources?.mana?.max ?? 0) || 0;
  const regenPv  = Number(actor.system?.regeneration?.pv ?? 0) || 0;
  const regenMana = Number(actor.system?.regeneration?.mana ?? 0) || 0;

  if (regenPv !== 0 || regenMana !== 0) {
    await actor.update({
      "system.ressources.pv.valeur": Math.min(pvMax, pvCur + regenPv),
      "system.ressources.mana.valeur": Math.min(manaMax, manaCur + regenMana)
    });
  }

  await game.rpg?.auras?.refreshAuras?.();

  const after = {
    pv: Number(actor.system?.ressources?.pv?.valeur ?? 0),
    mana: Number(actor.system?.ressources?.mana?.valeur ?? 0)
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div style="font-size:13px">
        🔧 <b>Tour forcé (MJ)</b> — ${actor.name}<br>
        PV : ${before.pv} → <b>${after.pv}</b><br>
        Mana : ${before.mana} → <b>${after.mana}</b><br>
        <span style="font-size:11px;color:var(--color-text-secondary)">
          Cooldowns -1, états tickés, régénération appliquée.
        </span>
      </div>`
  });

  ui.notifications.info(`Tour forcé pour ${actor.name}.`);
})();
