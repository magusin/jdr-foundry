// systems/rpg/module/rules/combat.js

export const AUTO_FAIL_MAX = 5;   // 5- échec auto
export const AUTO_SUCC_MIN = 16;  // 16+ succès auto

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function log2(x) {
  return Math.log(x) / Math.log(2);
}

/**
 * r = (100 + atk) / (100 + def)
 * r=1 -> 11+ (50/50), r=2 -> ~6+, r=0.5 -> ~16+
 */
export function tnFromRatio(r) {
  if (!Number.isFinite(r) || r <= 0) return 16;
  const tn = Math.round(11 - 5 * log2(r));
  return clamp(tn, 6, 16);
}

/**
 * Difficulté 0..4 : plus c'est élevé, plus c'est DUR
 * TN final = TN base + diff
 */
export function applyDifficulty(tnBase, diff) {
  const d = clamp(Number(diff) || 0, 0, 4);
  return clamp((Number(tnBase) || 11) + d, 6, 16);
}

/**
 * Bonus de dégâts depuis stat (simple et stable)
 * (tu peux changer plus tard, mais c'est cohérent avec ton système actuel)
 */
export function bonusFromStat(stat) {
  const s = Math.max(0, Number(stat) || 0);
  return Math.floor(s / 10);
}

/**
 * Mitigation : fixe puis % (arrondi sup), min 1
 */
export function mitigateDamage(raw, fixe, reducPct, capPct = 70) {
  const dmg = Math.max(0, Number(raw) || 0);
  const f = Math.max(0, Number(fixe) || 0);
  const pct = clamp(Number(reducPct) || 0, 0, capPct);

  const afterFixe = Math.max(0, dmg - f);
  const afterPct = Math.ceil(afterFixe * (1 - pct / 100));
  return Math.max(1, afterPct);
}

/**
 * ✅ Calcule TN pour une attaque (sans esquive)
 * - physique: dexterite vs dexterite
 * - magique:  acuite    vs acuite
 *
 * Supporte 2 signatures :
 *  A) computeTN(attackerActor, targetActor, item)
 *  B) computeTN({ attacker, target, livraison, diff })
 */
export function isHit(d20, tnFinal) {
  const roll = Number(d20) || 0;
  if (roll <= AUTO_FAIL_MAX) return { hit: false, crit: false, reason: "auto-fail" };
  if (roll >= AUTO_SUCC_MIN) return { hit: true, crit: roll === 20, reason: "auto-success" };
  const ok = roll >= tnFinal;
  return { hit: ok, crit: ok && roll === 20, reason: ok ? "success" : "fail" };
}

// Affichage “0 + 1d6 + …”
export function damagePreview(attackerActor, item) {
  const flat = Number(item?.system?.degatsFixes ?? 0) || 0;
  const die = String(item?.system?.degats ?? "1d6");
  const add = Number(item?.system?.degatsAdd ?? 0) || 0;

  // bonus stat = floor(stat/10) (on garde ton système actuel)
  const effP = attackerActor.system?.derived?.effective?.principales ?? attackerActor.system?.principales ?? {};
  const scalingStat = item?.system?.scaling?.stat ?? (item.type === "spell" ? "intelligence" : "force");
  const statVal = Number(effP?.[scalingStat] ?? 0) || 0;
  const statBonus = Math.floor(Math.max(0, statVal) / 10);

  // => exemple: "0 + 1d6 + 0 + stat(0)"
  return { flat, die, add, statBonus, scalingStat, text: `${flat} + ${die} + ${add} + stat(${statBonus})` };
}

// Signature simple: computeTN(attacker, target, item)
export function computeTN(attacker, target, item) {
  const livraison = item?.system?.livraison ?? (item?.type === "spell" ? "magique" : "physique");
  const diff = Number(item?.system?.difficulte ?? 0) || 0;
  const isPhys = livraison === "physique";

  const AP = attacker.system?.derived?.effective?.principales ?? attacker.system?.principales ?? {};
  const TP = target.system?.derived?.effective?.principales ?? target.system?.principales ?? {};

  const atk = isPhys ? Number(AP.dexterite ?? 0) : Number(AP.acuite ?? 0);
  const def = isPhys ? Number(TP.dexterite ?? 0) : Number(TP.acuite ?? 0);

  const r = (100 + atk) / (100 + def);
  const tnBase = tnFromRatio(r);
  const tnFinal = applyDifficulty(tnBase, diff);

  return { livraison, diff, atk, def, r, tnBase, tnFinal };
}

/**
 * Applique des dégâts finaux à la cible (retire PV)
 */
export async function applyFinalDamage({ targetActor, finalDamage }) {
  const pv = Number(targetActor.system?.ressources?.pv?.valeur ?? 0);
  const pvMax = Number(targetActor.system?.ressources?.pv?.max ?? 0);
  const newPv = Math.max(0, pv - Math.max(0, Number(finalDamage) || 0));
  await targetActor.update({ "system.ressources.pv.valeur": newPv });
  return { pvBefore: pv, pvAfter: newPv, pvMax };
}

/**
 * Calcule dégâts finaux (raw -> après armure/res fixe + %)
 * IMPORTANT : utilise le % déjà calculé dans actor.js (derived.reductions)
 */
export function computeFinalDamage({ targetActor, livraison, rawDamage }) {
  const sys = targetActor.system ?? {};
  const effDef = sys.derived?.effective?.defenses ?? sys.defenses ?? {};
  const red = sys.derived?.reductions ?? sys.derived?.reductions ?? sys.derived?.reductions ?? sys.derived?.reductions;

  // (au cas où certains noms bougent)
  const reductions = sys.derived?.reductions ?? sys.derived?.reductions ?? {};
  const isPhys = livraison === "physique";

  const fixe = isPhys
    ? Number(effDef.armureFixe ?? 0)
    : Number(effDef.resistanceFixe ?? 0);

  const pct = isPhys
    ? Number(reductions.physiquePct ?? 0)
    : Number(reductions.magiquePct ?? 0);

  const final = mitigateDamage(rawDamage, fixe, pct, 70);
  return { fixe, pct, final };
}
