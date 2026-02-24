function decCooldown(n) {
    n = Number(n) || 0;
    return Math.max(0, n - 1);
  }
  
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!("turn" in changed) && !("round" in changed)) return;
  
    const c = combat.combatant;
    const actor = c?.actor;
    if (!actor) return;
  
    const spells = actor.items.filter(i => i.type === "spell");
    const updates = [];
  
    for (const it of spells) {
      const cd = Number(it.system?.recharge?.restant ?? 0) || 0;
      if (cd > 0) updates.push({ _id: it.id, "system.recharge.restant": decCooldown(cd) });
  
      // optionnel : durée d’aura/buff runtime
      const d = Number(it.system?.dureeRestant ?? 0) || 0;
      if (d > 0) updates.push({ _id: it.id, "system.dureeRestant": decCooldown(d) });
    }
  
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  
    // si dureeRestant tombe à 0 => désactive + supprime aura
    for (const it of spells) {
      const d = Number(it.system?.dureeRestant ?? 0) || 0;
      if (it.system?.actif && d === 1) { // va devenir 0 après update
        await it.update({ "system.actif": false, "system.dureeRestant": 0 });
        if ((Number(it.system?.aura?.rayon ?? 0) || 0) > 0) await game.rpg.auras.deleteAuraTemplate(it);
      }
    }
  });
  