// systems/rpg/module/rules/auras.js

const REFRESH_DEBOUNCE_MS = 120;
let _t = null;

function debounce(fn) {
  clearTimeout(_t);
  _t = setTimeout(fn, REFRESH_DEBOUNCE_MS);
}

function gridDistanceSquares(tokenA, tokenB) {
  try {
    const d = canvas.grid.measureDistance(tokenA.center, tokenB.center);
    const unit = Number(canvas.dimensions?.distance ?? 1) || 1;
    return d / unit;
  } catch (e) {
    return 999999;
  }
}

function getDisposition(token) {
  return Number(token?.document?.disposition ?? token?.disposition ?? 0) || 0;
}

function isAlly(sourceToken, targetToken) {
  const s = getDisposition(sourceToken);
  const t = getDisposition(targetToken);
  return s === t && t !== CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function isEnemy(sourceToken, targetToken) {
  const s = getDisposition(sourceToken);
  const t = getDisposition(targetToken);
  return (
    (s === CONST.TOKEN_DISPOSITIONS.FRIENDLY && t === CONST.TOKEN_DISPOSITIONS.HOSTILE) ||
    (s === CONST.TOKEN_DISPOSITIONS.HOSTILE && t === CONST.TOKEN_DISPOSITIONS.FRIENDLY)
  );
}

function targetMatches(auraTarget, sourceToken, targetToken) {
  const tgt = String(auraTarget ?? "allies");
  if (tgt === "both") return true;
  if (tgt === "allies") return isAlly(sourceToken, targetToken);
  if (tgt === "enemies") return isEnemy(sourceToken, targetToken);
  return true;
}

function getAuraSources(tokens) {
  const out = [];
  for (const t of tokens) {
    const a = t.actor;
    if (!a) continue;

    const states = Array.isArray(a.system?.etatsActifs) ? a.system.etatsActifs : [];
    for (const st of states) {
      if (!st?.isAura) continue;
      const max = Number(st?.aura?.max ?? 0) || 0;
      if (max <= 0) continue;

      out.push({ sourceToken: t, sourceActor: a, auraState: st });
    }
  }
  return out;
}

function makeAppliedState({ sourceActor, sourceToken, auraState, targetActor }) {
  const min = Number(auraState?.aura?.min ?? 0) || 0;
  const max = Number(auraState?.aura?.max ?? 0) || 0;
  const target = String(auraState?.aura?.target ?? "allies");
  const auraKey = String(auraState?.aura?.key ?? auraState?.label ?? "Aura");

  return {
    id: `aura:${sourceActor.id}:${auraState.id}:${targetActor.id}`, // stable
    label: `${auraState.label} (Aura)`,
    type: "auraApplied",
    isAura: false, // IMPORTANT: sinon propagation infinie
    duration: 999999,
    remaining: 999999,
    cleanseDC: 0,
    dot: { flat: 0, formula: "", perTick: 0 },
    mods: foundry.utils.deepClone(auraState.mods ?? {}),
    auraApplied: {
      sourceActorId: sourceActor.id,
      sourceTokenId: sourceToken.id,
      sourceStateId: auraState.id,
      auraKey,
      min,
      max,
      target
    }
  };
}

async function setActorStates(actor, newStates) {
  const cur = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
  if (JSON.stringify(cur) === JSON.stringify(newStates)) return false;

  await actor.update({ "system.etatsActifs": newStates });
  if (game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);
  return true;
}

export const RPG_AURAS = {
  async refreshAuras() {
    if (!canvas?.ready) return;

    const tokens = canvas.tokens.placeables.filter(t => t?.actor);
    if (!tokens.length) return;

    const sources = getAuraSources(tokens);
    const desiredApplied = new Map(); // targetActorId -> appliedStates[]

    for (const targetToken of tokens) {
      const targetActor = targetToken.actor;
      if (!targetActor) continue;

      const applied = [];

      for (const src of sources) {
        const { sourceToken, sourceActor, auraState } = src;

        // ✅ pas d'auraApplied sur le lanceur (il a déjà l'aura source)
        if (targetToken.id === sourceToken.id) continue;

        const min = Number(auraState?.aura?.min ?? 0) || 0;
        const max = Number(auraState?.aura?.max ?? 0) || 0;
        const auraTarget = String(auraState?.aura?.target ?? "allies");

        if (!targetMatches(auraTarget, sourceToken, targetToken)) continue;

        const dist = gridDistanceSquares(sourceToken, targetToken);
        if (dist < min || dist > max) continue;

        applied.push(makeAppliedState({ sourceActor, sourceToken, auraState, targetActor }));
      }

      desiredApplied.set(targetActor.id, applied);
    }

    // remplace auraApplied sur chaque actor
    for (const t of tokens) {
      const a = t.actor;
      if (!a) continue;

      const cur = Array.isArray(a.system?.etatsActifs) ? foundry.utils.deepClone(a.system.etatsActifs) : [];
      const keep = cur.filter(s => s?.type !== "auraApplied");
      const add = desiredApplied.get(a.id) ?? [];

      await setActorStates(a, [...keep, ...add]);
    }
  },

  onTokenMoved() {
    debounce(() => this.refreshAuras());
  }
};