// systems/rpg/module/rules/spell-damage.js
function n(x){ return Number(x)||0; }

function scale({ stat, per=10, perStep=1 }, actor) {
  const eff = actor.system?.derived?.effective?.principales ?? actor.system?.principales ?? {};
  const val = n(eff?.[stat] ?? 0);
  return Math.floor(Math.max(0,val) / Math.max(1,n(per))) * n(perStep);
}

export async function computeSpellDamage({ actor, item, isCrit=false }) {
  const dmg = item.system?.damage ?? {};
  const flat = n(dmg.flat);
  const dice = String(dmg.dice ?? "1d6");
  const s = dmg.scaling ?? { stat:"intelligence", per:10, perStep:1 };
  const scaled = scale(s, actor);

  const roll = await (new Roll(dice)).evaluate({ async: true });
  let total = flat + scaled + roll.total;

  if (isCrit) {
    const crit = dmg.crit ?? {};
    const mode = String(crit.mode ?? "max+die");
    if (mode === "max+die") {
      const faces = roll.dice?.[0]?.faces ?? 6;
      const extraDice = String(crit.extraDice ?? dice);
      const extra = await (new Roll(extraDice)).evaluate({ async:true });
      total = flat + scaled + faces + extra.total + n(crit.extraFlat);
    }
  }

  return { total, flat, scaled, rollTotal: roll.total };
}
