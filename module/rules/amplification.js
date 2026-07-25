// module/rules/amplification.js
//
// Amplification des effets — côté LANCEUR (pendant symétrique de
// resistances.js, qui agit lui côté CIBLE).
//
// Un bâton, une armure ou un état actif peuvent renforcer les effets que
// leur porteur applique : allonger leur durée, augmenter leurs dégâts par
// tour, renforcer leurs bonus/malus de stats.
//
// Format sur un item équipé (arme/armure) :
//   system.amplifications = [{ tag, effectKey, durationBonus, dotBonusPct, modBonusPct }]
// Format sur un état actif :
//   state.amplification = { tag, effectKey, durationBonus, dotBonusPct, modBonusPct }
//
// `tag` (élément) et `effectKey` (nom de l'effet) sont des filtres facultatifs :
//   - les deux vides  → la ligne est ignorée (évite d'amplifier tout par erreur)
//   - tag seul        → tous les effets de cet élément
//   - effectKey seul  → uniquement cet effet, quel que soit l'élément

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/** Amplifications fournies par l'équipement équipé du lanceur. */
function getGearAmplifications(actor) {
  const list = [];
  for (const it of actor?.items ?? []) {
    if (it.type !== "weapon" && it.type !== "armor") continue;
    if (!it.system?.equipe) continue;
    const amps = Array.isArray(it.system?.amplifications) ? it.system.amplifications : [];
    list.push(...amps);
  }
  return list;
}

/** Amplifications fournies par les états actifs du lanceur. */
function getStateAmplifications(actor) {
  const list = [];
  const states = Array.isArray(actor?.system?.etatsActifs) ? actor.system.etatsActifs : [];
  for (const st of states) {
    if (st?.amplification && typeof st.amplification === "object") list.push(st.amplification);
  }
  return list;
}

/**
 * Amplification totale du lanceur pour un effet donné.
 * @param {Actor} actor - le LANCEUR
 * @param {string} tag - élément de l'effet (feu, glace…)
 * @param {string} effectLabel - nom de l'effet
 * @returns {{durationBonus:number, dotBonusPct:number, modBonusPct:number}}
 */
export function computeAmplificationFor(actor, tag, effectLabel = "") {
  const tagStr = String(tag ?? "");
  const labelStr = String(effectLabel ?? "").trim().toLowerCase();

  const all = [...getGearAmplifications(actor), ...getStateAmplifications(actor)]
    .filter(a => {
      const aTag = String(a?.tag ?? "").trim();
      const aKey = String(a?.effectKey ?? "").trim().toLowerCase();
      if (!aTag && !aKey) return false; // ligne vide : ignorée
      const tagOk = !aTag || aTag === tagStr;
      const keyOk = !aKey || aKey === labelStr;
      return tagOk && keyOk;
    });

  let durationBonus = 0;
  let dotBonusPct = 0;
  let modBonusPct = 0;

  for (const a of all) {
    durationBonus += n(a.durationBonus, 0);
    dotBonusPct   += n(a.dotBonusPct, 0);
    modBonusPct   += n(a.modBonusPct, 0);
  }

  // Garde-fous : on autorise l'affaiblissement (valeurs négatives) mais on
  // borne pour éviter les effets absurdes.
  dotBonusPct = Math.max(-100, Math.min(500, dotBonusPct));
  modBonusPct = Math.max(-100, Math.min(500, modBonusPct));

  return { durationBonus, dotBonusPct, modBonusPct };
}

/**
 * Applique l'amplification du lanceur à un état AVANT qu'il ne parte vers la
 * cible (donc avant applyResistances, qui s'occupe des défenses de la cible).
 *
 * @param {Actor} casterActor - le lanceur
 * @param {object} state - état au format V2
 * @returns {{state: object, info: object|null}}
 */
export function amplifyState(casterActor, state) {
  if (!casterActor || !state) return { state, info: null };
  if (!state.tag && !state.label) return { state, info: null };

  const amp = computeAmplificationFor(casterActor, state.tag, state.label);
  if (!amp.durationBonus && !amp.dotBonusPct && !amp.modBonusPct) {
    return { state, info: null };
  }

  const out = foundry.utils.deepClone(state);

  const baseDuration = n(out.duration, 1);
  const basePerTick  = n(out.dot?.perTick, 0);

  // Durée : les effets permanents ne sont pas concernés
  if (!out.permanent && amp.durationBonus) {
    out.duration  = Math.max(1, baseDuration + amp.durationBonus);
    out.remaining = out.duration;
  }

  // Dégâts / soin par tour : on amplifie la magnitude, le signe est conservé
  if (amp.dotBonusPct && basePerTick !== 0) {
    const scaled = Math.abs(basePerTick) * (1 + amp.dotBonusPct / 100);
    const signed = basePerTick < 0 ? -Math.ceil(scaled) : Math.ceil(scaled);
    out.dot = out.dot ?? {};
    out.dot.perTick = signed;
    out.dot.flat = signed;
  }

  // Bonus/malus de stats : on amplifie la magnitude, le sens est conservé
  if (amp.modBonusPct && out.mods && typeof out.mods === "object") {
    const mult = 1 + amp.modBonusPct / 100;
    for (const v of Object.values(out.mods)) {
      if (!v || typeof v !== "object") continue;
      for (const key of ["flat", "pct"]) {
        const val = n(v[key], 0);
        if (!val) continue;
        const scaled = Math.abs(val) * mult;
        v[key] = val < 0 ? -Math.round(scaled) : Math.round(scaled);
      }
    }
  }

  return {
    state: out,
    info: {
      durationBonus: amp.durationBonus,
      dotBonusPct: amp.dotBonusPct,
      modBonusPct: amp.modBonusPct,
      baseDuration, finalDuration: n(out.duration, baseDuration),
      baseDot: basePerTick, finalDot: n(out.dot?.perTick, basePerTick)
    }
  };
}
