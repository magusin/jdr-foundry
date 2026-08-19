// systems/rpg/module/documents/item.js

import { resistanceFor, applyResistPct } from "../rules/damage-types.js";
import { rollAttackBonuses } from "../rules/attack-bonus.js";

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
  /**
   * @param {Item|null} [offhand] - seconde arme d'une attaque à deux armes.
   *   Elle n'ajoute QUE son dé : ni part fixe, ni bonus de stat. Sur coup
   *   critique elle passe à son propre dé de crit s'il est renseigné, mais
   *   n'obtient toujours aucun bonus additif.
   */
  async rollDamage({ attackerActor, targetActor = null, isCrit = false, type = "physique",
                     offhand = null } = {}) {
    // Les monstres n'ont pas d'armes : ils frappent avec leurs compétences,
    // qui sont des items de type « spell ». On les accepte donc ici, avec
    // leur propre format de dégâts (lignes system.damages[]).
    if (this.type === "spell") {
      return this._rollSpellDamage({ attackerActor, targetActor, isCrit, type });
    }
    if (this.type !== "weapon") throw new Error("rollDamage: item non-weapon");

    const w    = this.system ?? {};
    const dmg  = w.damage ?? {};
    const crit = w.crit   ?? {};

    // ── 1) Dé ─────────────────────────────────────────────────────
    const die = String(dmg.dice ?? dmg.die ?? "1d6").trim();
    const roll = await (new Roll(die)).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      flavor: `💥 <b>${attackerActor?.name ?? "?"}</b> — dégâts (${this.name})`
    });

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
        await critRoll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
          flavor: `✦ <b>${attackerActor?.name ?? "?"}</b> — dé bonus critique (${this.name})`
        });

        critBonus = (faces - roll.total) + critRoll.total + critFlat + critStatBonus;
      } else {
        // mode "double" ou autre : on double le brut
        critBonus = rawBrut + critFlat + critStatBonus;
      }
    }

    // ── 3 bis) Seconde arme : son dé, rien d'autre ────────────────
    let offhandTotal = 0;
    let offhandDie   = null;
    let offhandName  = null;
    if (offhand) {
      const oSys  = offhand.system ?? {};
      const oCrit = String(oSys.crit?.damage?.dice ?? "").trim();
      offhandDie  = (isCrit && oCrit) ? oCrit
                  : (String(oSys.damage?.dice ?? "").trim() || null);
      offhandName = offhand.name ?? "Seconde arme";
      if (offhandDie) {
        const oRoll  = await (new Roll(offhandDie)).evaluate();
        await oRoll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
          flavor: `🗡️ <b>${attackerActor?.name ?? "?"}</b> — dégâts (${offhandName})`
        });
        offhandTotal = oRoll.total;
      }
    }

    // ── 3 ter) Bonus de dégâts accordés par un état actif ─────────────
    // « Lames aiguisées », « Arme enflammée » : un effet peut ajouter des
    // dégâts à chaque attaque, et n'en viser qu'une famille (mêlée / jet /
    // tir, voir system.categorie). Deux sorts de bonus :
    //   • sans type propre → ils se fondent dans le coup et sont encaissés
    //     comme lui ;
    //   • avec une nature ou un élément à eux → une ligne séparée, mitigée
    //     par la résistance correspondante de la cible (c'est tout l'intérêt
    //     d'un « +1d6 de feu » : l'armure n'y peut rien).
    const attackRaw = rawBrut + critBonus + offhandTotal;
    const bonus = await rollAttackBonuses(attackerActor, {
      kind: "arme", weapon: this, rawBase: attackRaw
    });

    // La mitigation s'applique au coup entier, pas arme par arme : c'est une
    // seule attaque, l'armure ne l'absorbe qu'une fois.
    const beforeMitigation = attackRaw + bonus.same;

    // ── 4) Mitigation cible ───────────────────────────────────────
    let fixe = 0;
    let pct  = 0;
    // Résistance élémentaire : second étage, après l'armure. Une arme n'a pas
    // d'élément propre (system.tag reste optionnel) — sans lui, sa livraison
    // fait office de type, c'est ce qui rend une résistance « physique »
    // opérante face à une épée. Voir damage-types.js.
    let elem = { type: null, label: "", pct: 0 };

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

      elem = resistanceFor(targetActor, { tag: w.tag ?? null, livraison: type });
    }

    const afterFixe = Math.max(0, beforeMitigation - fixe);
    const afterArmor = Math.max(1, Math.ceil(afterFixe * (1 - pct / 100)));
    // Le plancher à 1 est celui de l'armure : une immunité (100 %) doit
    // pouvoir ramener le coup à 0.
    const mainFinal = elem.pct ? applyResistPct(afterArmor, elem.pct) : afterArmor;

    // Lignes de bonus au type propre : chacune passe par SA mitigation.
    // Le plancher à 1 est celui de l'armure et ne s'applique donc qu'une fois
    // par ligne, jamais après la résistance élémentaire — une immunité doit
    // pouvoir ramener une ligne à 0 sans annuler le coup entier.
    const bonusLines = [];
    for (const blk of bonus.blocks) {
      const blkLivr = blk.livraison ?? type;
      const isMagic = blkLivr === "magique";
      // L'armure/résistance FIXE est une absorption par coup, pas par ligne :
      // le coup principal l'a déjà payée. Ne la reprendre que si la ligne
      // relève de l'AUTRE défense (magique quand le coup est physique) —
      // celle-là n'a rien absorbé encore. Sans cette distinction, un « +1d6
      // de feu » sur une épée était amputé une seconde fois de toute l'armure
      // et ne rendait presque rien.
      const memePool = blkLivr === type;
      let bFixe = 0, bPct = 0;
      if (targetActor) {
        const tSys = targetActor.system ?? {};
        const effD = tSys.derived?.effective?.defenses ?? tSys.defenses ?? {};
        const red  = tSys.derived?.reductions ?? {};
        bFixe = memePool ? 0
              : (isMagic ? (Number(effD.resistanceFixe) || 0) : (Number(effD.armureFixe) || 0));
        bPct  = isMagic ? (Number(red.magiquePct) || 0)      : (Number(red.physiquePct) || 0);
      }
      const bElem = targetActor
        ? resistanceFor(targetActor, { tag: blk.tag, livraison: blk.livraison ?? type })
        : { pct: 0, label: "" };
      const bAfterFixe = Math.max(0, blk.amount - bFixe);
      const bAfterArmor = Math.max(1, Math.ceil(bAfterFixe * (1 - bPct / 100)));
      const bFinal = bElem.pct ? applyResistPct(bAfterArmor, bElem.pct) : bAfterArmor;
      bonusLines.push({
        label: blk.label, raw: blk.amount, final: bFinal,
        livraison: blk.livraison ?? type, tag: blk.tag,
        elemPct: bElem.pct, elemLabel: bElem.label
      });
    }
    const final = mainFinal + bonusLines.reduce((sum, l) => sum + l.final, 0);

    return {
      brut:             rawBrut,
      bonusSame:        bonus.same,
      bonusLines,
      mainFinal,
      critBonus,
      beforeMitigation,
      fixe,
      pct,
      elemPct:          elem.pct,
      elemType:         elem.type,
      elemLabel:        elem.label,
      final,
      statBonus,
      rollTotal:        roll.total,
      offhandTotal,
      offhandDie,
      offhandName
    };
  }

  /**
   * Dégâts d'une COMPÉTENCE de monstre (item de type « spell ») utilisée comme
   * attaque — attaque d'opportunité, déclaration depuis la fiche monstre…
   *
   * Lit le format multi-lignes system.damages[] : chaque ligne a ses dés, sa
   * part fixe, sa montée en stat, et ses valeurs de critique propres
   * (critDice / critFlat). Repli sur l'ancien bloc unique system.damage.
   * La mitigation est identique à celle d'une arme.
   */
  async _rollSpellDamage({ attackerActor, targetActor = null, isCrit = false, type = "magique" } = {}) {
    const sys = this.system ?? {};
    const effP = attackerActor?.system?.derived?.effective?.principales
              ?? attackerActor?.system?.principales
              ?? {};

    const lines = Array.isArray(sys.damages) && sys.damages.length
      ? sys.damages
      : (sys.damage ? [{
          dice: sys.damage.dice,
          flat: sys.damage.flat,
          stat: sys.damage.scaling?.stat,
          per: sys.damage.scaling?.per,
          perStep: sys.damage.scaling?.perStep,
          livraison: sys.livraison
        }] : []);

    let rawBrut = 0;
    let statBonus = 0;
    let rollTotal = 0;
    let livraison = String(sys.livraison ?? type ?? "magique");

    for (const d of lines) {
      const stat    = String(d?.stat ?? "").trim();
      const per     = Math.max(1, Number(d?.per ?? 10) || 10);
      const perStep = Number(d?.perStep ?? 0) || 0;
      const bonus   = stat ? Math.floor(Math.max(0, Number(effP?.[stat]) || 0) / per) * perStep : 0;
      statBonus += bonus;

      // Sur critique : dés et part fixe propres à la ligne (dés vides =
      // mêmes dés que le coup normal), cohérent avec la fiche de sort.
      const critDice = String(d?.critDice ?? "").trim();
      const dice = (isCrit && critDice) ? critDice : String(d?.dice ?? "").trim();
      const flat = isCrit ? (Number(d?.critFlat ?? 0) || 0) : (Number(d?.flat ?? 0) || 0);

      if (dice && dice !== "0") {
        const r = await (new Roll(dice)).evaluate();
        await r.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
          flavor: `💥 <b>${attackerActor?.name ?? "?"}</b> — dégâts (${this.name})`
        });
        rollTotal += r.total;
        rawBrut += r.total;
      }
      rawBrut += flat + bonus;
      if (d?.livraison) livraison = String(d.livraison);
    }

    // Bonus de dégâts accordés par un état actif de l'attaquant. Une
    // compétence de monstre est un sort : c'est la portée « sorts » qui la
    // couvre, pas celle des armes (le monstre n'en porte pas).
    const bonus = await rollAttackBonuses(attackerActor, { kind: "sort", rawBase: rawBrut });
    const beforeMitigation = Math.max(0, rawBrut + bonus.same);

    let fixe = 0, pct = 0;
    let elem = { type: null, label: "", pct: 0 };
    if (targetActor) {
      const tSys = targetActor.system ?? {};
      const effD = tSys.derived?.effective?.defenses ?? tSys.defenses ?? {};
      const red  = tSys.derived?.reductions ?? {};
      const isMagic = livraison === "magique";
      fixe = isMagic ? (Number(effD.resistanceFixe) || 0) : (Number(effD.armureFixe) || 0);
      pct  = isMagic ? (Number(red.magiquePct) || 0)      : (Number(red.physiquePct) || 0);
      // Une compétence de monstre porte, elle, un élément (system.tag) :
      // c'est lui qui prime sur la livraison pour la résistance élémentaire.
      elem = resistanceFor(targetActor, { tag: sys.tag ?? null, livraison });
    }

    const afterFixe = Math.max(0, beforeMitigation - fixe);
    const afterArmor = Math.max(1, Math.ceil(afterFixe * (1 - pct / 100)));
    const mainFinal = elem.pct ? applyResistPct(afterArmor, elem.pct) : afterArmor;

    // Lignes de bonus au type propre : mitigées chacune par la résistance qui
    // la concerne, comme du côté des armes.
    const bonusLines = [];
    for (const blk of bonus.blocks) {
      const blkLivr = blk.livraison ?? livraison;
      const isMagic = blkLivr === "magique";
      // Même règle que pour une arme : la part fixe n'est reprise que si la
      // ligne relève de l'autre défense (voir rollDamage plus haut).
      const memePool = blkLivr === livraison;
      let bFixe = 0, bPct = 0;
      if (targetActor) {
        const tSys = targetActor.system ?? {};
        const effD = tSys.derived?.effective?.defenses ?? tSys.defenses ?? {};
        const red  = tSys.derived?.reductions ?? {};
        bFixe = memePool ? 0
              : (isMagic ? (Number(effD.resistanceFixe) || 0) : (Number(effD.armureFixe) || 0));
        bPct  = isMagic ? (Number(red.magiquePct) || 0)      : (Number(red.physiquePct) || 0);
      }
      const bElem = targetActor
        ? resistanceFor(targetActor, { tag: blk.tag, livraison: blk.livraison ?? livraison })
        : { pct: 0, label: "" };
      const bAfterArmor = Math.max(1, Math.ceil(Math.max(0, blk.amount - bFixe) * (1 - bPct / 100)));
      const bFinal = bElem.pct ? applyResistPct(bAfterArmor, bElem.pct) : bAfterArmor;
      bonusLines.push({ label: blk.label, raw: blk.amount, final: bFinal,
                        livraison: blk.livraison ?? livraison, tag: blk.tag,
                        elemPct: bElem.pct, elemLabel: bElem.label });
    }
    const final = mainFinal + bonusLines.reduce((sum, l) => sum + l.final, 0);

    return {
      brut: rawBrut,
      critBonus: 0,          // le critique est déjà intégré dans les lignes
      beforeMitigation,
      bonusSame: bonus.same,
      bonusLines,
      mainFinal,
      fixe, pct, final,
      elemPct: elem.pct, elemType: elem.type, elemLabel: elem.label,
      statBonus,
      rollTotal,
      livraison
    };
  }
}
