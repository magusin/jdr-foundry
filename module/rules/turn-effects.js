// systems/rpg/module/rules/turn-effects.js

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Décrémente les cooldowns des items qui ont system.cooldown.restant
 * => 1 fois au tour du possesseur (appelé depuis le hook combat)
 */
async function decCooldowns(actor) {
  const updates = [];

  for (const it of actor.items) {
    const rest = n(it.system?.cooldown?.restant, 0);
    if (rest > 0) {
      updates.push({ _id: it.id, "system.cooldown.restant": Math.max(0, rest - 1) });
    }
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * Tick des états (etatsActifs) :
 * - décrémente remaining -1
 * - supprime si remaining arrive à 0
 * - NE TOUCHE PAS aux auraApplied (gérés par refreshAuras)
 */
function tickStates(actor) {
  const cur = Array.isArray(actor.system?.etatsActifs)
    ? foundry.utils.deepClone(actor.system.etatsActifs)
    : [];

  if (!cur.length) return { changed: false, next: cur, removedAuraSource: false };

  let removedAuraSource = false;
  const next = [];

  for (const st of cur) {
    // ✅ auraApplied : ne décrémente jamais (suivi par refreshAuras)
    if (String(st?.type) === "auraApplied") {
      next.push(st);
      continue;
    }

    const remaining = n(st?.remaining, n(st?.duration, 0));
    const newRemaining = Math.max(0, remaining - 1);

    // marque si aura source expire
    if (st?.isAura && newRemaining <= 0) removedAuraSource = true;

    // ✅ supprime si 0
    if (newRemaining > 0) next.push({ ...st, remaining: newRemaining });
  }

  const changed = JSON.stringify(cur) !== JSON.stringify(next);
  return { changed, next, removedAuraSource };
}

/**
 * ✅ Guard anti double tick par tour:
 * on stocke une clé dans un flag du Combat.
 */
async function ensureTurnGuard(combat) {
  const key = `${combat.id}:${combat.round}:${combat.turn}`;
  const last = await combat.getFlag("rpg", "lastTurnEffectsKey");
  if (last === key) return { ok: false };
  await combat.setFlag("rpg", "lastTurnEffectsKey", key);
  return { ok: true };
}

/**
 * Appelée au début du tour du combattant actif.
 * - cooldowns -1
 * - états -1 et purge à 0
 * - refresh auras si une aura source expire
 */
export async function onTurnStartForActor(actor, { combat = null } = {}) {
  if (!actor) return;
  console.log("TURN TICK", combat.round, combat.turn, actor.name)

  // ✅ anti double tick (si combat fourni)
  if (combat) {
    const g = await ensureTurnGuard(combat);
    if (!g.ok) return;
  }

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