// systems/rpg/module/rules/turn-effects.js

function n(v, d = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  }
  
  function decCooldowns(actor) {
    // décrémente CD des spells/skills/items qui ont system.cooldown.restant
    const updates = [];
  
    for (const it of actor.items) {
      const rest = n(it.system?.cooldown?.restant, 0);
      if (rest > 0) {
        updates.push({ _id: it.id, "system.cooldown.restant": Math.max(0, rest - 1) });
      }
    }
  
    if (updates.length) return actor.updateEmbeddedDocuments("Item", updates);
    return null;
  }
  
  function tickStates(actor) {
    const cur = Array.isArray(actor.system?.etatsActifs) ? foundry.utils.deepClone(actor.system.etatsActifs) : [];
    if (!cur.length) return { changed: false, removedAuraSource: false };
  
    let removedAuraSource = false;
  
    // 5.2 Effets: DOT au début du tour, puis remaining -1, remove si 0
    // Ici on ne roll pas la formule DOT, on applique dot.flat (tu peux étendre plus tard)
    // NB: si tu veux appliquer les DOT aux PV, branche ici sur actor.system.ressources.pv.valeur etc.
    // Pour l’instant, on gère surtout les durations.
  
    const next = [];
  
    for (const st of cur) {
      const remaining = n(st.remaining, n(st.duration, 0));
      const newRemaining = Math.max(0, remaining - 1);
  
      // marque si aura source expire
      if (st.isAura && newRemaining <= 0) removedAuraSource = true;
  
      if (newRemaining > 0) {
        next.push({ ...st, remaining: newRemaining });
      }
    }
  
    const changed = JSON.stringify(cur) !== JSON.stringify(next);
    return { changed, next, removedAuraSource };
  }
  
  export async function onTurnStartForActor(actor) {
    if (!actor) return;
  
    // cooldowns
    await decCooldowns(actor);
  
    // states
    const { changed, next, removedAuraSource } = tickStates(actor);
    if (changed) {
      await actor.update({ "system.etatsActifs": next });
      if (game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);
    }
  
    // si aura source expirée => refresh auras pour retirer les auraApplied
    if (removedAuraSource && globalThis.RPG_AURAS?.refreshAuras) {
      await globalThis.RPG_AURAS.refreshAuras();
    }
  }