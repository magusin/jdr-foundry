// systems/rpg/module/rules/turn-effects.js

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Décrémente les cooldowns des items (spells) qui ont system.cooldown.restant.
 * Appelée UNE SEULE FOIS par tour (depuis onTurnStartForActor).
 */
async function decCooldowns(actor) {
  const updates = [];

  for (const it of actor.items) {
    const rest = n(it.system?.cooldown?.restant, 0);
    if (rest > 0) {
      const next = Math.max(0, rest - 1);
      // Met à jour les deux champs pour compat avec l'ancien modèle
      updates.push({ _id: it.id, "system.cooldown.restant": next, "system.recharge.restant": next });
    }
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * Tick des états (etatsActifs) :
 * - décrémente remaining de 1
 * - supprime si remaining arrive à 0
 * - ne touche pas aux auraApplied (gérés par refreshAuras)
 * - collecte les DOT pour application
 */
function tickStates(actor) {
  const cur = Array.isArray(actor.system?.etatsActifs)
    ? foundry.utils.deepClone(actor.system.etatsActifs)
    : [];

  if (!cur.length) return { changed: false, next: cur, removedAuraSource: false, totalDot: 0, totalFatigueDot: 0 };

  let removedAuraSource = false;
  let totalDot = 0;
  let totalFatigueDot = 0;
  const next = [];

  for (const st of cur) {
    // auraApplied : ne décrémente jamais (suivi par refreshAuras)
    if (String(st?.type) === "auraApplied") {
      // Les DOT des auras s'appliquent quand même (soin négatif inclus)
      const dot = n(st?.dot?.perTick ?? st?.dot?.flat, 0);
      if (dot !== 0) totalDot += dot;
      totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);
      next.push(st);
      continue;
    }

    // ✅ Blessures/effets permanents : ne s'estompent jamais seuls,
    // seul un soin explicite (macro MJ) les retire. Le DOT (ex: saignement)
    // continue de s'appliquer chaque tour tant que la blessure est active.
    if (st?.permanent) {
      const dot = n(st?.dot?.perTick ?? st?.dot?.flat, 0);
      if (dot !== 0) totalDot += dot;
      totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);
      next.push(st);
      continue;
    }

    const remaining    = n(st?.remaining, n(st?.duration, 0));
    const newRemaining = Math.max(0, remaining - 1);

    // Collecte DOT avant suppression (soin négatif inclus)
    const dot = n(st?.dot?.perTick ?? st?.dot?.flat, 0);
    if (dot !== 0 && remaining > 0) totalDot += dot;
    if (remaining > 0) totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);

    if (st?.isAura && newRemaining <= 0) removedAuraSource = true;

    if (newRemaining > 0) next.push({ ...st, remaining: newRemaining });
  }

  const changed = JSON.stringify(cur) !== JSON.stringify(next);
  return { changed, next, removedAuraSource, totalDot, totalFatigueDot };
}

/**
 * Guard anti-double-tick par tour.
 * Stocke une clé dans un flag du Combat.
 */
async function ensureTurnGuard(combat) {
  const key  = `${combat.id}:${combat.round}:${combat.turn}`;
  const last = await combat.getFlag("rpg", "lastTurnEffectsKey").catch(() => null);
  if (last === key) return { ok: false };
  await combat.setFlag("rpg", "lastTurnEffectsKey", key);
  return { ok: true };
}

/**
 * Appelée au début du tour du combattant actif (depuis init.js > updateCombat).
 *
 * Pipeline :
 *   1. Anti-double-tick
 *   2. Cooldowns -1
 *   3. États -1, supprime ceux à 0
 *   4. Recompute (reset actor pour que prepareDerivedData se réexécute)
 *   5. Refresh auras si une source expire
 */
export async function onTurnStartForActor(actor, { combat = null } = {}) {
  if (!actor) return;

  // Anti double tick
  if (combat) {
    const g = await ensureTurnGuard(combat);
    if (!g.ok) return;
  }

  // 1) Cooldowns
  await decCooldowns(actor);

  // 2) États + collecte DOT
  const { changed, next, removedAuraSource, totalDot, totalFatigueDot } = tickStates(actor);

  // 3) Applique DOT avant la mise à jour des états
  const updates = {};
  if (changed) updates["system.etatsActifs"] = next;

  const lines = [];

  if (totalDot !== 0) {
    const pvCur  = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
    const pvMax  = Number(actor.system?.ressources?.pv?.max    ?? 0) || 0;
    // totalDot positif = dégâts, négatif = soin (clampé au max dans les deux sens)
    const newPv  = Math.min(pvMax, Math.max(0, pvCur - totalDot));
    updates["system.ressources.pv.valeur"] = newPv;

    lines.push(totalDot > 0
      ? `subit <b>${totalDot}</b> dégâts (DOT). PV: ${newPv}/${pvMax}`
      : `récupère <b>${Math.abs(totalDot)}</b> PV (soin/tour). PV: ${newPv}/${pvMax}`);
  }

  if (totalFatigueDot !== 0) {
    const fatCur = Number(actor.system?.ressources?.fatigue?.valeur ?? 0) || 0;
    const fatMax = Number(actor.system?.ressources?.fatigue?.max    ?? 10) || 10;
    const newFat = Math.min(fatMax, Math.max(0, fatCur + totalFatigueDot));
    updates["system.ressources.fatigue.valeur"] = newFat;

    lines.push(totalFatigueDot > 0
      ? `s'épuise de <b>${totalFatigueDot}</b> (effet). Fatigue: ${newFat}/${fatMax}`
      : `récupère <b>${Math.abs(totalFatigueDot)}</b> fatigue (effet). Fatigue: ${newFat}/${fatMax}`);
  }

  if (lines.length) {
    await actor.update(updates);
    await ChatMessage.create({
      speaker:  ChatMessage.getSpeaker({ actor }),
      content:  `<b>${actor.name}</b> ${lines.join(" — ")}`
    });
  } else if (changed) {
    await actor.update(updates);
  }

  // 4) Recompute (force prepareDerivedData via reset)
  actor.reset();
  actor.sheet?.render(false);

  // 5) Refresh auras si une source a expiré
  if (removedAuraSource && globalThis.RPG_AURAS?.refreshAuras) {
    await globalThis.RPG_AURAS.refreshAuras();
  }
}
