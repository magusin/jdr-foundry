// module/rules/resistances.js
//
// Calcule et applique les résistances (équipement + buffs) à un effet
// avant qu'il ne soit posé sur un acteur. Centralise la logique pour que
// tous les points d'application d'effets (sorts, catalogue MJ, pièges
// futurs) bénéficient automatiquement des résistances.

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Résistances fournies par l'équipement équipé (arme/armure).
 * Format attendu sur l'item : system.resistances = [{tag, durationReduction, dotReductionPct, immune}]
 */
function getGearResistances(actor) {
  const list = [];
  for (const it of actor.items) {
    if (it.type !== "weapon" && it.type !== "armor") continue;
    if (!it.system?.equipe) continue;
    const res = Array.isArray(it.system?.resistances) ? it.system.resistances : [];
    list.push(...res);
  }
  return list;
}

/**
 * Résistances fournies par des états actifs (buffs de résistance posés par sort).
 * Format attendu sur le state : state.resistance = {tag, durationReduction, dotReductionPct, immune}
 */
function getStateResistances(actor) {
  const list = [];
  const states = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
  for (const st of states) {
    if (st?.resistance && typeof st.resistance === "object") list.push(st.resistance);
  }
  return list;
}

/**
 * Calcule la résistance totale d'un acteur pour un tag donné.
 */
export function computeResistanceFor(actor, tag) {
  if (!tag) return { durationReduction: 0, dotReductionPct: 0, immune: false };

  const all = [...getGearResistances(actor), ...getStateResistances(actor)]
    .filter(r => String(r?.tag ?? "") === String(tag));

  let durationReduction = 0;
  let dotReductionPct = 0;
  let immune = false;

  for (const r of all) {
    durationReduction += n(r.durationReduction, 0);
    dotReductionPct += n(r.dotReductionPct, 0);
    if (r.immune) immune = true;
  }

  dotReductionPct = Math.min(100, Math.max(0, dotReductionPct));
  return { durationReduction, dotReductionPct, immune };
}

/**
 * Ajuste un "state" avant application selon les résistances de la cible.
 * Retourne null si l'effet est totalement résisté (immunité ou durée ≤ 0
 * après réduction) — dans ce cas, ne PAS l'ajouter à etatsActifs.
 *
 * @param {Actor} actor - la cible qui va recevoir l'effet
 * @param {object} state - état au format V2 (avec éventuellement state.tag)
 * @returns {object|null} state ajusté, ou null si résisté
 */
export function applyResistances(actor, state) {
  if (!state?.tag) return state; // pas de tag = pas concerné

  const res = computeResistanceFor(actor, state.tag);
  if (res.immune) return null;

  const baseDuration = n(state.duration, 1);
  const newDuration = Math.max(0, baseDuration - res.durationReduction);
  if (newDuration <= 0) return null; // entièrement résisté

  const adjusted = foundry.utils.deepClone(state);
  adjusted.duration = newDuration;
  adjusted.remaining = newDuration;

  const perTick = n(adjusted.dot?.perTick, 0);
  if (perTick) {
    const reduced = perTick * (1 - res.dotReductionPct / 100);
    const reducedRounded = perTick < 0
      ? Math.min(0, Math.round(reduced))   // soin (négatif) : ne pas inverser le signe
      : Math.max(0, Math.round(reduced));
    adjusted.dot.perTick = reducedRounded;
    adjusted.dot.flat = reducedRounded;
  }

  adjusted.resistanceApplied = {
    tag: state.tag,
    durationReduced: res.durationReduction,
    dotReductionPct: res.dotReductionPct
  };

  return adjusted;
}

/**
 * Ajoute un état à un acteur en passant par le calcul de résistance.
 * Fonction générique utilisable depuis n'importe quel point d'application
 * (catalogue MJ, sorts, futurs pièges...).
 *
 * @returns {{applied: boolean, resisted: boolean, state?: object}}
 */
export async function addStateWithResistance(actor, state) {
  const adjusted = applyResistances(actor, state);
  if (!adjusted) return { applied: false, resisted: true };

  const list = Array.isArray(actor.system?.etatsActifs)
    ? foundry.utils.deepClone(actor.system.etatsActifs)
    : [];

  const id = String(adjusted.id || foundry.utils.randomID());
  const idx = list.findIndex(e => String(e.id) === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...adjusted };
  else list.push(adjusted);

  await actor.update({ "system.etatsActifs": list });

  if (game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);

  return { applied: true, resisted: false, state: adjusted };
}
