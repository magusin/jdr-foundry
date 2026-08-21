// systems/rpg/module/rules/auras.js

import { RPG_AURA_RENDER } from "./aura-render.js";
import { dropPassifOnStateLabel } from "./loadout.js";

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

/**
 * Cible de l'aura : la valeur choisie par le MJ sur l'effet
 * (aura.target = allies | enemies | both) fait foi. Sans choix explicite,
 * on déduit du contenu : buff => alliés, malus/DOT => ennemis.
 */
function computeAuraTarget(auraState) {
  const explicit = String(auraState?.aura?.target ?? "").trim().toLowerCase();
  if (explicit === "allies" || explicit === "enemies" || explicit === "both") return explicit;
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

/**
 * Distance entre deux tokens en MÈTRES, avec la même règle de diagonale que
 * le système de déplacement (diagonale pondérée, cf. measureSegmentMeters).
 * Les portées d'aura sont saisies en mètres sur la fiche de sort : il faut
 * mesurer dans la même unité, sinon 3 m se comportait comme 3 cases avec
 * une diagonale comptée double.
 */
function auraDistanceMeters(tokenA, tokenB) {
  try {
    const gs = canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100;
    const dist = canvas?.scene?.grid?.distance ?? 1;

    const axy = getTokenXY(tokenA);
    const bxy = getTokenXY(tokenB);

    const aw = Math.max(1, Number(tokenA.document.width ?? 1) || 1);
    const ah = Math.max(1, Number(tokenA.document.height ?? 1) || 1);
    const bw = Math.max(1, Number(tokenB.document.width ?? 1) || 1);
    const bh = Math.max(1, Number(tokenB.document.height ?? 1) || 1);

    const ac = { x: axy.x + (aw * gs) / 2, y: axy.y + (ah * gs) / 2 };
    const bc = { x: bxy.x + (bw * gs) / 2, y: bxy.y + (bh * gs) / 2 };

    const dx = Math.abs(bc.x - ac.x) / gs;
    const dy = Math.abs(bc.y - ac.y) / gs;
    const diag = Math.min(dx, dy);
    const straight = Math.abs(dx - dy);

    let factor = 1.41;
    try {
      const D = CONST.GRID_DIAGONALS ?? {};
      const rule = canvas?.scene?.grid?.diagonals;
      if (rule === D.EQUIDISTANT) factor = 1;
      else if (rule === D.ALTERNATING_1 || rule === D.ALTERNATING_2) factor = 1.5;
    } catch { /* défaut 1.41 */ }

    // Bord à bord : on retire le rayon des deux tokens pour qu'un grand
    // token soit "dans" l'aura dès que son corps l'atteint.
    const radiusA = (Math.max(aw, ah) - 1) / 2;
    const radiusB = (Math.max(bw, bh) - 1) / 2;
    const centers = (straight + diag * factor);
    return Math.max(0, centers - radiusA - radiusB) * dist;
  } catch (e) {
    return 999999;
  }
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
  const fatigueTick = Number(auraState?.dot?.fatiguePerTick ?? 0) || 0;

  return {
    id: `aura:${sourceActor.id}:${auraState.id}:${targetActor.id}:${targetToken.id}`,
    // Le libellé est celui de l'effet source, à l'identique. Le suffixe
    // « (Aura) » qu'il portait en faisait un état d'un AUTRE nom pour tout ce
    // qui compare des libellés : il ne remplaçait pas l'état homonyme déjà
    // porté (les deux s'empilaient), et status-icons.js, qui apparie sur
    // (libellé, élément), ne lui trouvait aucune icône de token. La
    // provenance est dite par `type` et par `auraApplied.sourceName`, que la
    // fiche affiche en pastille — pas en trafiquant le nom.
    label: String(auraState.label ?? "Aura"),
    type: "auraApplied",
    isAura: false,
    // Il ne se décompte pas (turn-effects.js saute les auraApplied) : il dure
    // tant que la cible reste à portée, ni plus ni moins. Pas de
    // `permanent: true` pour autant — ce drapeau range un état parmi les
    // séquelles de blessure sur la fiche (autoStatesForBlessures) ; c'est le
    // gabarit qui lit `auraApplied` et écrit « tant que tu restes à portée »
    // au lieu des 999999 tours.
    duration: 999999,
    remaining: 999999,
    // Aucun seuil de retrait, et c'est la règle : un effet reçu d'une aura ne
    // se retire pas. Seul l'émetteur est débuffable — retirer SON état d'aura
    // (qui, lui, porte son removeBaseTN) éteint l'aura pour tout le monde.
    // removableStates() (remove-state.js) filtre sur removeDifficulty /
    // removeBaseTN / cleanseDC : les trois sont absents ou nuls ici.
    cleanseDC: 0,
    // On reporte le type/élément et la clé de l'effet source : sans eux, les
    // résistances et les icônes d'état ne reconnaissaient pas l'effet d'aura.
    tag: auraState?.tag ?? null,
    effectKey: auraState?.effectKey ?? null,
    dot: { flat: dotFlat, formula: "", perTick: dotFlat, fatiguePerTick: fatigueTick },
    mods: foundry.utils.deepClone(auraState.mods ?? {}),
    auraApplied: {
      sourceActorId: sourceActor.id,
      sourceTokenId: sourceToken.id,
      sourceStateId: auraState.id,
      sourceName: sourceActor.name ?? "",
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

    // Poser un état sur autrui est une écriture d'acteur : un client JOUEUR
    // se la fait refuser par Foundry, et n'aurait fait qu'empiler des erreurs
    // silencieuses. Il garde en revanche le rendu des anneaux, qui est
    // purement local — sans ce partage, un joueur ne verrait plus aucune
    // aura sur le canevas.
    if (!game.user?.isGM) {
      try { RPG_AURA_RENDER.refresh(); } catch (e) { console.warn("[RPG] aura-render:", e); }
      return;
    }

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

          // Portées d'aura en MÈTRES (comme saisies sur la fiche de sort)
          const dist = auraDistanceMeters(sourceToken, targetToken);

          // ✅ bornes inclusives, avec une petite tolérance pour absorber
          // les arrondis des diagonales pondérées (ex: 1.41 vs 1.4)
          const EPS = 0.05;
          if (dist < min - EPS) continue;
          if (dist > max + EPS) continue;

          applied.push(makeAppliedState({ sourceActor, sourceToken, auraState, targetActor, targetToken }));
        }

        desiredApplied.set(targetToken.id, applied);
      }

      // remplace auraApplied sur chaque actor (par token)
      for (const t of tokens) {
        const a = t.actor;
        if (!a) continue;

        const cur = Array.isArray(a.system?.etatsActifs) ? foundry.utils.deepClone(a.system.etatsActifs) : [];
        const add = desiredApplied.get(t.id) ?? [];

        // Un état homonyme déjà porté cède la place à celui de l'aura, comme
        // partout ailleurs (findStateSlot) : le dernier posé gagne. La
        // conséquence est voulue et doit être connue de la table — en
        // sortant de l'aura, la cible n'a plus RIEN, puisque son état
        // personnel a été remplacé, pas mis de côté.
        // Un état d'aura PORTÉ n'est pas un effet reçu, c'est une émission :
        // il n'est jamais remplacé par la copie d'un homonyme, et la copie
        // n'est pas posée non plus. Sans ces deux exceptions, deux paladins
        // portant la même aura et se tenant côte à côte se détruisaient
        // mutuellement leur source — et, tant qu'elle tenait, cumulaient
        // leurs mods avec ceux de la copie reçue.
        const ownAuras = new Set(cur.filter(s => s?.isAura)
          .map(s => String(s?.label ?? "").trim().toLowerCase()));
        const kept = add.filter(s => !ownAuras.has(String(s.label ?? "").trim().toLowerCase()));

        const incoming = new Set(kept.map(s => String(s.label ?? "").trim().toLowerCase()));
        const keep = cur.filter(s =>
          s?.type !== "auraApplied" &&
          (s?.isAura || !incoming.has(String(s?.label ?? "").trim().toLowerCase())));

        await setActorStates(a, [...keep, ...kept]);

        // Même règle pour un passif accordant l'un de ces libellés : il ne
        // vit pas dans etatsActifs, donc rien ne l'aurait remplacé et ses
        // mods se seraient ajoutés à ceux de l'aura, invisibles.
        for (const st of kept) {
          const dropped = await dropPassifOnStateLabel(a, st.label);
          if (dropped) {
            ChatMessage.create({
              content: `🔮 <b>${st.label}</b> (aura de ${st.auraApplied?.sourceName ?? "?"}) `
                     + `remplace le passif « ${dropped} » de <b>${a.name}</b> — emplacement libéré.`
            }).catch(() => {});
          }
        }
      }

      // Rendu visuel (anneaux colorés par élément) toujours en phase avec
      // le calcul qui vient de s'exécuter.
      try { RPG_AURA_RENDER.refresh(); } catch (e) { console.warn("[RPG] aura-render:", e); }
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