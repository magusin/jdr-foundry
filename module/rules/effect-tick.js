// module/rules/effect-tick.js
//
// Le « par tour » d'un effet : dégâts ou soin, part fixe plus une part
// proportionnelle à une caractéristique du lanceur.
//
// Vit dans son propre module, sans aucune dépendance, parce que DEUX mondes
// en ont besoin sans pouvoir s'importer l'un l'autre : la résolution des
// sorts (spells.js) et le passif porté (loadout.js), dont les effets sont
// recalculés à la volée au lieu d'être écrits. En recopier une seconde
// version, c'était la garantie qu'elles finiraient par diverger.

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Valeur par tour d'un effet secondaire, SIGNÉE pour le moteur de tour :
 * positive = dégâts, négative = soin.
 *
 * Source : fx.tick { mode:"none"|"damage"|"heal", flat, stat, per, perStep }
 * où `flat` est toujours positif — c'est `mode` qui donne le sens.
 * Replis successifs sur les anciens formats : dot{}/hot{} séparés, puis
 * l'ancien champ unique signé damage.flat.
 */
export function tickPerTick(fx, effP) {
  const scaled = (blk) => {
    if (!blk) return 0;
    const stat = String(blk.stat ?? "").trim();
    const per = Math.max(1, n(blk.per, 10) || 10);
    const perStep = n(blk.perStep, 0);
    const bonus = stat ? Math.floor(n(effP?.[stat], 0) / per) * perStep : 0;
    return n(blk.flat, 0) + bonus;
  };

  const t = fx?.tick;
  if (t && typeof t === "object" && t.mode) {
    if (t.mode === "none") return 0;
    const total = Math.abs(scaled(t));
    return t.mode === "heal" ? -total : total;
  }

  // Anciens formats
  const dotHas = fx?.dot && (n(fx.dot.flat, 0) !== 0 || n(fx.dot.perStep, 0) !== 0);
  const hotHas = fx?.hot && (n(fx.hot.flat, 0) !== 0 || n(fx.hot.perStep, 0) !== 0);
  if (dotHas || hotHas) return scaled(fx.dot) - scaled(fx.hot);

  return n(fx?.damage?.flat, 0);
}


/**
 * Valeur SIGNÉE d'un bonus/malus de stat, mise à l'échelle des
 * caractéristiques de celui qui lance l'effet.
 *
 * Même forme que le « par tour » ci-dessus — `fixe + (stat ÷ par) × gain` —
 * et pour la même raison : un rare sort doit pouvoir donner un bonus qui
 * dépend de la puissance de son lanceur, exactement comme ses dégâts. Sans
 * cela, la partie 4 de l'éditeur d'effets était le seul endroit de la fiche
 * où un nombre restait figé quoi qu'il arrive.
 *
 * La quantité saisie est toujours POSITIVE, c'est `sens` qui donne le signe
 * (voir normMods, item-spell-sheet-v2.js) ; on retombe sur le signe de la
 * valeur pour les données antérieures à ce champ.
 */
export function scaledModValue(m, effP) {
  const signed = n(m?.value, 0);
  const neg = m?.sens === "malus" || (m?.sens !== "bonus" && signed < 0);

  const base = Math.abs(signed);
  const stat = String(m?.scaleStat ?? "").trim();
  const per = Math.max(1, n(m?.scalePer, 10) || 10);
  const step = n(m?.scaleStep, 0);
  const bonus = (stat && step) ? Math.floor(n(effP?.[stat], 0) / per) * step : 0;

  const qty = base + bonus;
  return neg ? -qty : qty;
}

/** Le mod grandit-il avec une caractéristique ? */
export function modIsScaled(m) {
  return !!String(m?.scaleStat ?? "").trim() && n(m?.scaleStep, 0) !== 0;
}
