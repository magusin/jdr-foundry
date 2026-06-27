// systems/rpg/module/documents/item.js

function ceil(n) {
  return Math.ceil(Number(n) || 0);
}

export class RPGItem extends Item {
  prepareDerivedData() {
    super.prepareDerivedData();

    const sys = this.system ?? {};
    sys.derived = sys.derived ?? {};

    if (this.type === "weapon") {
      const dmg   = sys.damage ?? {};
      const crit  = sys.crit   ?? {};

      // ── Champ principal ──────────────────────────────────────────
      const die  = String(dmg.dice ?? dmg.die ?? "1d6").trim();
      const flat = Number(dmg.flat) || 0;

      const sc       = dmg.scaling ?? {};
      const statKey  = String(sc.stat ?? "force");
      const per      = Math.max(1, Number(sc.per ?? 10) || 10);
      const perStep  = Number(sc.perStep ?? 1) || 1;

      sys.derived.damage = {
        die,
        flat,
        statKey,
        per,
        perStep,
        summary: `${die} + ${flat} (stat/${per}×${perStep})`
      };

      // ── Crit ──────────────────────────────────────────────────────
      // Structure réelle soumise par le formulaire : crit.damage.{dice,flat,scaling}
      const critDmg   = crit.damage ?? {};
      const critDie   = String(critDmg.dice ?? crit.extraDice ?? crit.extraDie ?? "").trim();
      const critFlat  = Number(critDmg.flat ?? crit.extraFlat ?? 0) || 0;
      const critMode  = String(crit.mode ?? "max+die");

      sys.derived.crit = {
        mode:       critMode,
        extraDice:  critDie,
        extraFlat:  critFlat
      };
    }
  }

  /**
   * Calcule et retourne les dégâts finaux d'une attaque physique avec une arme.
   *
   * Pipeline :
   *   1. Tire le dé de dégâts
   *   2. Ajoute flat + scaling (stat effective / per × perStep)
   *   3. Sur crit : rerolls + bonus crit AVANT mitigation
   *   4. Mitigation : armure fixe, puis % (cap 70%)
   *   5. Minimum 1
   *
   * @param {object} opts
   * @param {Actor}   opts.attackerActor  - Actor qui attaque
   * @param {Actor}   [opts.targetActor]  - Actor cible (pour mitigation)
   * @param {boolean} [opts.isCrit=false]
   * @param {"physique"|"magique"} [opts.type="physique"]
   * @returns {Promise<{brut, critBonus, beforeMitigation, fixe, pct, final, statBonus, rollTotal}>}
   */
  async rollDamage({ attackerActor, targetActor = null, isCrit = false, type = "physique" } = {}) {
    if (this.type !== "weapon") throw new Error("rollDamage: item non-weapon");

    const w    = this.system ?? {};
    const dmg  = w.damage ?? {};
    const crit = w.crit   ?? {};

    // ── 1) Dé ─────────────────────────────────────────────────────
    const die = String(dmg.dice ?? dmg.die ?? "1d6").trim();
    const roll = await (new Roll(die)).evaluate();

    const flat = Number(dmg.flat) || 0;

    // ── 2) Scaling depuis STATS EFFECTIVES ────────────────────────
    const sc      = dmg.scaling ?? {};
    const statKey = String(sc.stat ?? "force");
    const per     = Math.max(1, Number(sc.per ?? 10) || 10);
    const perStep = Number(sc.perStep ?? 1) || 1;

    // ✅ toujours lire les stats effectives (derived.effective.principales)
    const effP       = attackerActor?.system?.derived?.effective?.principales
                    ?? attackerActor?.system?.principales
                    ?? {};
    const statVal    = Number(effP?.[statKey] ?? 0) || 0;
    const statBonus  = Math.floor(Math.max(0, statVal) / per) * perStep;

    let rawBrut = flat + roll.total + statBonus;

    // ── 3) Crit AVANT mitigation ──────────────────────────────────
    let critBonus = 0;
    if (isCrit) {
      // ✅ Le formulaire d'arme soumet crit.damage.{dice,flat,scaling.stat/per/perStep}
      // (même structure riche que les dégâts normaux, scaling possible sur le crit).
      // Repli sur l'ancienne structure plate crit.extraDice/extraFlat si présente
      // (objets créés avant cette correction).
      const critDmg     = crit.damage ?? {};
      const mode        = String(crit.mode ?? "max+die");
      const critDie     = String(critDmg.dice ?? crit.extraDice ?? crit.extraDie ?? "").trim();
      const critFlat    = Number(critDmg.flat ?? crit.extraFlat ?? 0) || 0;
      const critSc      = critDmg.scaling ?? {};
      const critStatKey = String(critSc.stat ?? statKey);
      const critPer     = Math.max(1, Number(critSc.per ?? per) || per);
      const critPerStep = Number(critSc.perStep ?? 0) || 0;
      const critStatVal = Number(effP?.[critStatKey] ?? 0) || 0;
      const critStatBonus = critPerStep ? Math.floor(Math.max(0, critStatVal) / critPer) * critPerStep : 0;

      if (mode === "max+die") {
        // On remplace le dé par son max + on tire un dé bonus
        const faces    = roll.dice?.[0]?.faces ?? 6;
        const critRoll = critDie
          ? await (new Roll(critDie)).evaluate()
          : await (new Roll(die)).evaluate();

        critBonus = (faces - roll.total) + critRoll.total + critFlat + critStatBonus;
      } else {
        // mode "double" ou autre : on double le brut
        critBonus = rawBrut + critFlat + critStatBonus;
      }
    }

    const beforeMitigation = rawBrut + critBonus;

    // ── 4) Mitigation cible ───────────────────────────────────────
    let fixe = 0;
    let pct  = 0;

    if (targetActor) {
      const tSys = targetActor.system ?? {};
      // toujours lire les défenses effectives
      const effD = tSys.derived?.effective?.defenses ?? tSys.defenses ?? {};
      const red  = tSys.derived?.reductions ?? {};

      fixe = type === "magique"
        ? (Number(effD.resistanceFixe) || 0)
        : (Number(effD.armureFixe) || 0);

      pct = type === "magique"
        ? (Number(red.magiquePct) || 0)
        : (Number(red.physiquePct) || 0);
    }

    const afterFixe = Math.max(0, beforeMitigation - fixe);
    const final     = Math.max(1, Math.ceil(afterFixe * (1 - pct / 100)));

    return {
      brut:             rawBrut,
      critBonus,
      beforeMitigation,
      fixe,
      pct,
      final,
      statBonus,
      rollTotal:        roll.total
    };
  }
}
