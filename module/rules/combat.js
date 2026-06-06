// systems/rpg/module/rules/combat.js

export const AUTO_FAIL_MAX  = 5;   // 5- échec auto
export const AUTO_SUCC_MIN  = 16;  // 16+ succès auto

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function log2(x) {
  return Math.log(x) / Math.log(2);
}

/**
 * r = (100 + atk) / (100 + def)
 * r=1 → TN 11 (50/50), r=2 → ~TN 6, r=0.5 → ~TN 16
 */
export function tnFromRatio(r) {
  if (!Number.isFinite(r) || r <= 0) return 16;
  const tn = Math.round(11 - 5 * log2(r));
  return clamp(tn, 6, 16);
}

/**
 * Difficulté 0..4 : plus c'est élevé, plus c'est DUR.
 * TN final = TN base + diff
 */
export function applyDifficulty(tnBase, diff) {
  const d = clamp(Number(diff) || 0, 0, 4);
  return clamp((Number(tnBase) || 11) + d, 6, 16);
}

/**
 * Bonus de dégâts depuis une stat (stat / per × perStep).
 */
export function bonusFromStat(stat, { per = 10, perStep = 1 } = {}) {
  const s = Math.max(0, Number(stat) || 0);
  return Math.floor(s / Math.max(1, per)) * perStep;
}

/**
 * Mitigation : fixe puis % (arrondi sup), min 1.
 */
export function mitigateDamage(raw, fixe, reducPct, capPct = 70) {
  const dmg        = Math.max(0, Number(raw)      || 0);
  const f          = Math.max(0, Number(fixe)     || 0);
  const pct        = clamp(Number(reducPct) || 0, 0, capPct);
  const afterFixe  = Math.max(0, dmg - f);
  const afterPct   = Math.ceil(afterFixe * (1 - pct / 100));
  return Math.max(1, afterPct);
}

/**
 * Résultat d'un jet d20.
 */
export function isHit(d20, tnFinal) {
  const roll = Number(d20) || 0;
  if (roll <= AUTO_FAIL_MAX)  return { hit: false, crit: false, reason: "auto-fail" };
  if (roll >= AUTO_SUCC_MIN)  return { hit: true,  crit: roll === 20, reason: "auto-success" };
  const ok = roll >= tnFinal;
  return { hit: ok, crit: ok && roll === 20, reason: ok ? "success" : "fail" };
}

// ── Helpers internes ────────────────────────────────────────────────

function getEffStat(actor, stat) {
  const eff = actor?.system?.derived?.effective?.principales
           ?? actor?.system?.principales
           ?? {};
  return Number(eff?.[stat] ?? 0) || 0;
}

function scaleFrom(actor, scaling) {
  const stat    = String(scaling?.stat ?? "intelligence");
  const per     = Math.max(1, Number(scaling?.per ?? 10) || 10);
  const perStep = Number(scaling?.perStep ?? 1) || 1;
  const val     = getEffStat(actor, stat);
  return Math.floor(val / per) * perStep;
}

// ── API publique ────────────────────────────────────────────────────

/**
 * Affichage "flat + dé + stat(bonus)" (pas de jet, prévisualisation).
 */
export function damagePreview(attackerActor, item) {
  const effP = attackerActor?.system?.derived?.effective?.principales
            ?? attackerActor?.system?.principales
            ?? {};

  // Nouveau modèle (system.damage.flat / .dice / .scaling)
  const dmg = item?.system?.damage ?? null;
  if (dmg) {
    const flat        = Number(dmg.flat  ?? 0) || 0;
    const die         = String(dmg.dice  ?? dmg.die ?? "1d6");
    const scalingStat = String(dmg.scaling?.stat ?? (item.type === "spell" ? "intelligence" : "force"));
    const per         = Math.max(1, Number(dmg.scaling?.per     ?? 10) || 10);
    const perStep     = Number(dmg.scaling?.perStep ?? 1) || 1;
    const statVal     = Number(effP?.[scalingStat] ?? 0) || 0;
    const statBonus   = Math.floor(statVal / per) * perStep;
    return { flat, die, statBonus, scalingStat, text: `${flat} + ${die} + stat(${statBonus})` };
  }

  // Ancien modèle (fallback compat)
  const flat        = Number(item?.system?.degatsFixes ?? 0) || 0;
  const die         = String(item?.system?.degats ?? "1d6");
  const add         = Number(item?.system?.degatsAdd ?? 0) || 0;
  const scalingStat = String(item?.system?.scaling?.stat ?? (item?.type === "spell" ? "intelligence" : "force"));
  const statVal     = Number(effP?.[scalingStat] ?? 0) || 0;
  const statBonus   = Math.floor(Math.max(0, statVal) / 10);
  return { flat, die, add, statBonus, scalingStat, text: `${flat} + ${die} + ${add} + stat(${statBonus})` };
}

/**
 * Calcule et retourne les dégâts d'un sort (avec dé).
 *
 * Crit mode "max+die" : remplace le dé par son max + tire un dé bonus.
 */
export async function computeSpellDamage(actor, item, { crit = false } = {}) {
  const dmg    = item.system?.damage ?? {};
  const flat   = Number(dmg.flat  ?? 0) || 0;
  const dice   = String(dmg.dice  ?? "1d6");
  const scaled = scaleFrom(actor, dmg.scaling);

  const baseRoll = await (new Roll(dice)).evaluate();
  let total = flat + scaled + baseRoll.total;

  if (crit) {
    const critDef  = dmg.crit ?? {};
    const mode     = String(critDef.mode ?? "max+die");
    if (mode === "max+die") {
      const faces     = baseRoll.dice?.[0]?.faces ?? 6;
      // extraDice prend le dessus sur extraDie (normalisé)
      const extraDice = String(critDef.extraDice ?? critDef.extraDie ?? dice);
      const extra     = await (new Roll(extraDice)).evaluate();
      total = flat + scaled + faces + extra.total + (Number(critDef.extraFlat ?? 0) || 0);
    }
  }

  return { total, flat, scaled, roll: baseRoll.total };
}

/**
 * Calcule le seuil de toucher (TN) pour une attaque.
 *
 * - physique : Dextérité attaquant vs Dextérité cible
 * - magique  : Acuité    attaquant vs Acuité    cible
 */
export function computeTN(attacker, target, item) {
  const livraison = String(item?.system?.livraison ?? (item?.type === "spell" ? "magique" : "physique"));
  const diff      = Number(item?.system?.difficulte ?? 0) || 0;
  const isPhys    = livraison === "physique";

  const AP = attacker?.system?.derived?.effective?.principales ?? attacker?.system?.principales ?? {};
  const TP = target?.system?.derived?.effective?.principales   ?? target?.system?.principales   ?? {};

  const atk = isPhys ? Number(AP.dexterite ?? 0) : Number(AP.acuite ?? 0);
  const def = isPhys ? Number(TP.dexterite ?? 0) : Number(TP.acuite ?? 0);

  const r       = (100 + atk) / (100 + def);
  const tnBase  = tnFromRatio(r);
  const tnFinal = applyDifficulty(tnBase, diff);

  return { livraison, diff, atk, def, r, tnBase, tnFinal };
}

/**
 * Applique des dégâts finaux à la cible (retire PV).
 */
export async function applyFinalDamage({ targetActor, finalDamage }) {
  const pv    = Number(targetActor.system?.ressources?.pv?.valeur ?? 0);
  const pvMax = Number(targetActor.system?.ressources?.pv?.max    ?? 0);
  const newPv = Math.max(0, pv - Math.max(0, Number(finalDamage) || 0));
  await targetActor.update({ "system.ressources.pv.valeur": newPv });
  return { pvBefore: pv, pvAfter: newPv, pvMax };
}

/**
 * Calcule dégâts finaux (raw → après armure/rés fixe + %).
 * Utilise les réductions calculées dans actor.js (derived.reductions).
 */
export function computeFinalDamage({ targetActor, livraison, rawDamage }) {
  const sys    = targetActor.system ?? {};
  const effD   = sys.derived?.effective?.defenses ?? sys.defenses ?? {};
  const red    = sys.derived?.reductions ?? {};
  const isPhys = livraison === "physique";

  const fixe = isPhys
    ? Number(effD.armureFixe       ?? 0)
    : Number(effD.resistanceFixe   ?? 0);

  const pct = isPhys
    ? Number(red.physiquePct ?? 0)
    : Number(red.magiquePct  ?? 0);

  const final = mitigateDamage(rawDamage, fixe, pct, 70);
  return { fixe, pct, final };
}
