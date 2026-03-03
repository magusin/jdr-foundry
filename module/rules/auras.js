// systems/rpg/module/rules/auras.js

const REFRESH_DEBOUNCE_MS = 50;
let _t = null;

// ---- position overrides (anti "1 case de retard") ----
const _posOverrides = new Map(); // tokenId -> {x,y,exp}
const OVERRIDE_TTL_MS = 250;

export function setTokenPosOverride(tokenId, x, y) {
  if (!tokenId) return;
  _posOverrides.set(tokenId, { x: Number(x), y: Number(y), exp: Date.now() + OVERRIDE_TTL_MS });
}

function getTokenXY(token) {
  const doc = token?.document;
  if (!doc) return { x: 0, y: 0 };

  const o = _posOverrides.get(token.id);
  if (o && o.exp > Date.now() && Number.isFinite(o.x) && Number.isFinite(o.y)) {
    return { x: o.x, y: o.y };
  }

  return { x: Number(doc.x) || 0, y: Number(doc.y) || 0 };
}

function cleanupOverrides() {
  const now = Date.now();
  for (const [k, v] of _posOverrides.entries()) {
    if (!v || v.exp <= now) _posOverrides.delete(k);
  }
}

// anti ré-entrance (évite refresh pendant qu’un refresh tourne)
let _running = false;
let _queued = false;

function debounce(fn) {
  clearTimeout(_t);
  _t = setTimeout(fn, REFRESH_DEBOUNCE_MS);
}

function auraHasHarm(auraState) {
  const dot = Number(auraState?.dot?.perTick ?? auraState?.dot?.flat ?? 0) || 0;
  if (dot > 0) return true;

  const mods = auraState?.mods ?? {};
  for (const m of Object.values(mods)) {
    const flat = Number(m?.flat ?? 0) || 0;
    const pct  = Number(m?.pct ?? 0) || 0;
    if (flat < 0 || pct < 0) return true;
  }
  return false;
}

// buff => allies ; malus/DOT => enemies
function computeAuraTarget(auraState) {
  return auraHasHarm(auraState) ? "enemies" : "allies";
}

function getDisposition(token) {
  return Number(token?.document?.disposition ?? token?.disposition ?? 0) || 0;
}

function tokenGridOrigin(token) {
  const gs = canvas.grid.size || 100;

  const gx = Math.floor((Number(token.document.x) || 0) / gs);
  const gy = Math.floor((Number(token.document.y) || 0) / gs);

  return { gx, gy };
}

function tokenPivotCell(token) {
  const { gx, gy } = tokenGridOrigin(token);

  // width/height sont en cases
  const w = Math.max(1, Number(token.document.width ?? 1) || 1);
  const h = Math.max(1, Number(token.document.height ?? 1) || 1);

  // pivot = centre du footprint (stable)
  const px = gx + Math.floor((w - 1) / 2);
  const py = gy + Math.floor((h - 1) / 2);

  return { px, py };
}

function stableDocCenterPixels(token) {
  const gs = canvas.grid.size || 100;
  const doc = token?.document;
  if (!doc) return { x: 0, y: 0 };
  const w = Math.max(1, Number(doc.width ?? 1) || 1);
  const h = Math.max(1, Number(doc.height ?? 1) || 1);

  // centre calculé depuis le DOCUMENT (toujours à jour)
  // petit epsilon pour éviter les "frontières" de case
  const eps = 0.001;
  return {
    x: (Number(doc.x) || 0) + (w * gs) / 2 - eps,
    y: (Number(doc.y) || 0) + (h * gs) / 2 - eps
  };
}

// ✅ 1 case = 1, diagonale = 2
function gridDistanceSquares(tokenA, tokenB) {
  try {
    if (!canvas?.grid || !tokenA?.document || !tokenB?.document) return 999999;

    const gs = canvas.grid.size || 100;

    const axy = getTokenXY(tokenA);
    const bxy = getTokenXY(tokenB);

    const aw = Math.max(1, Number(tokenA.document.width ?? 1) || 1);
    const ah = Math.max(1, Number(tokenA.document.height ?? 1) || 1);
    const bw = Math.max(1, Number(tokenB.document.width ?? 1) || 1);
    const bh = Math.max(1, Number(tokenB.document.height ?? 1) || 1);

    // centre depuis x/y (override-aware)
    const eps = 0.001;
    const ac = { x: axy.x + (aw * gs) / 2 - eps, y: axy.y + (ah * gs) / 2 - eps };
    const bc = { x: bxy.x + (bw * gs) / 2 - eps, y: bxy.y + (bh * gs) / 2 - eps };

    const oa = canvas.grid.getOffset(ac);
    const ob = canvas.grid.getOffset(bc);

    const ax = Number(oa?.i ?? oa?.x ?? 0);
    const ay = Number(oa?.j ?? oa?.y ?? 0);
    const bx = Number(ob?.i ?? ob?.x ?? 0);
    const by = Number(ob?.j ?? ob?.y ?? 0);

    return Math.abs(ax - bx) + Math.abs(ay - by); // diag=2
  } catch (e) {
    return 999999;
  }
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

      const rem = Number(st?.remaining ?? st?.duration ?? 1) || 0;
      if (rem <= 0) continue;

      out.push({ sourceToken: t, sourceActor: a, auraState: st });
    }
  }

  return out;
}

function makeAppliedState({ sourceActor, sourceToken, auraState, targetActor, targetToken }) {
  const min = Number(auraState?.aura?.min ?? 0) || 0;
  const max = Number(auraState?.aura?.max ?? 0) || 0;

  const target = computeAuraTarget(auraState);
  const auraKey = String(auraState?.aura?.key ?? auraState?.label ?? "Aura");
  const dotFlat = Number(auraState?.dot?.perTick ?? auraState?.dot?.flat ?? 0) || 0;

  return {
    id: `aura:${sourceActor.id}:${auraState.id}:${targetActor.id}:${targetToken.id}`,
    label: `${auraState.label} (Aura)`,
    type: "auraApplied",
    isAura: false,
    duration: 999999,
    remaining: 999999,
    cleanseDC: 0,
    dot: { flat: dotFlat, formula: "", perTick: dotFlat },
    mods: foundry.utils.deepClone(auraState.mods ?? {}),
    auraApplied: {
      sourceActorId: sourceActor.id,
      sourceTokenId: sourceToken.id,
      sourceStateId: auraState.id,
      targetTokenId: targetToken.id,
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
    cleanupOverrides();
    if (!canvas?.ready) return;

    // lock anti boucle
    if (_running) { _queued = true; return; }
    _running = true;

    try {
      const tokens = canvas.tokens.placeables.filter(t => t?.actor);
      if (!tokens.length) return;

      const sources = getAuraSources(tokens);

      // map par TOKEN id (pas actor id)
      const desiredApplied = new Map(); // targetTokenId -> appliedStates[]

      for (const targetToken of tokens) {
        const targetActor = targetToken.actor;
        if (!targetActor) continue;

        const applied = [];

        for (const src of sources) {
          const { sourceToken, sourceActor, auraState } = src;
          if (targetToken.id === sourceToken.id) continue;

          const min = Number(auraState?.aura?.min ?? 0) || 0;
          const max = Number(auraState?.aura?.max ?? 0) || 0;

          const auraTarget = computeAuraTarget(auraState);
          if (!targetMatches(auraTarget, sourceToken, targetToken)) continue;

          const dist = gridDistanceSquares(sourceToken, targetToken);

          // ✅ bornes inclusives : 0..3 => dist 3 OK / dist 4 NON
          if (dist < min) continue;
          if (dist > max) continue;

          applied.push(makeAppliedState({ sourceActor, sourceToken, auraState, targetActor, targetToken }));
        }

        desiredApplied.set(targetToken.id, applied);
      }

      // remplace auraApplied sur chaque actor (par token)
      for (const t of tokens) {
        const a = t.actor;
        if (!a) continue;

        const cur = Array.isArray(a.system?.etatsActifs) ? foundry.utils.deepClone(a.system.etatsActifs) : [];
        const keep = cur.filter(s => s?.type !== "auraApplied");
        const add = desiredApplied.get(t.id) ?? [];

        await setActorStates(a, [...keep, ...add]);
      }
    } finally {
      _running = false;
      if (_queued) {
        _queued = false;
        // rerun 1 fois si un refresh est arrivé pendant le lock
        debounce(() => this.refreshAuras());
      }
    }
  },

  onTokenMoved() {
    debounce(() => this.refreshAuras());
  }
};