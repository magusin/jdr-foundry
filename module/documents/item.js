// systems/rpg/module/documents/item.js

function ceil(n) {
    return Math.ceil(Number(n) || 0);
  }
  
  function sqrtStatBonus(stat, coef) {
    const s = Math.max(0, Number(stat) || 0);
    const c = Math.max(0, Number(coef) || 0);
    return ceil(Math.sqrt(s) * c);
  }
  
  export class RPGItem extends Item {
    prepareDerivedData() {
      super.prepareDerivedData();
  
      const sys = this.system ?? {};
      sys.derived = sys.derived ?? {};
  
      // Dégâts affichables / pré-calcul (facultatif, mais pratique)
      if (this.type === "weapon") {
        const dmg = sys.damage ?? {};
        const scale = sys.scaling ?? {};
        const crit = sys.crit ?? {};
  
        const die = (dmg.die || "1d6").trim();
        const flat = Number(dmg.flat) || 0;
        const addFlat = Number(dmg.addFlat) || 0;
  
        const statKey = scale.stat || "force";
        const coef = Number(scale.coef) || 0;
  
        sys.derived.damage = {
          die,
          flat,
          addFlat,
          statKey,
          coef,
          // texte résumé (sans cible)
          summary: `${die} + ${flat} + (√${statKey}×${coef}) + ${addFlat}`
        };
  
        sys.derived.crit = {
          multiplier: Number(crit.multiplier) || 2,
          die: (crit.die || "").trim(),
          flat: Number(crit.flat) || 0
        };
      }
    }
  
    /**
     * Calcul utilitaire (appelé par tes macros / mécanique d'attaque)
     * attackerActor: Actor qui attaque
     * targetActor: Actor cible
     * isCrit: bool
     * type: "physique" | "magique" (pour choisir armure vs résistance)
     */
    async rollDamage({ attackerActor, targetActor, isCrit = false, type = "physique" } = {}) {
      if (this.type !== "weapon") throw new Error("rollDamage: item non-weapon");
  
      const w = this.system ?? {};
      const dmg = w.damage ?? {};
      const scale = w.scaling ?? {};
      const crit = w.crit ?? {};
  
      const die = (dmg.die || "1d6").trim();
      const roll = await (new Roll(die)).roll();
      await roll.toMessage({ flavor: `${this.name} — Dé de dégâts (${die})` });
  
      const flat = Number(dmg.flat) || 0;
      const addFlat = Number(dmg.addFlat) || 0;
  
      const statKey = scale.stat || "force";
      const coef = Number(scale.coef) || 0;
      const attackerStat = attackerActor?.system?.principales?.[statKey] ?? 0;
      const statBonus = sqrtStatBonus(attackerStat, coef);
  
      let brut = flat + roll.total + statBonus + addFlat;
  
      // Défenses cible
      const tSys = targetActor?.system ?? {};
      const def = tSys.defenses ?? {};
      const red = tSys.derived?.reductions ?? {};
  
      const fixe = (type === "magique")
        ? Number(def.resistanceFixe) || 0
        : Number(def.armureFixe) || 0;
  
      const pct = (type === "magique")
        ? Number(red.magiquePct) || 0
        : Number(red.physiquePct) || 0;
  
      // Application fixe puis %
      const afterFixe = Math.max(0, brut - fixe);
      let final = ceil(afterFixe * (1 - pct / 100));
      final = Math.max(1, final);
  
      // Crit après réduction
      if (isCrit) {
        const mult = Number(crit.multiplier) || 2;
        final = ceil(final * mult);
  
        const critDie = (crit.die || "").trim();
        if (critDie) {
          const rCrit = await (new Roll(critDie)).roll();
          await rCrit.toMessage({ flavor: `${this.name} — Dé critique (${critDie})` });
          final += rCrit.total;
        }
  
        final += Number(crit.flat) || 0;
      }
  
      return {
        brut,
        fixe,
        pct,
        final,
        statBonus
      };
    }
  }
  