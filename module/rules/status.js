// systems/rpg/module/rules/status.js
/**
 * Recompute central:
 * - applique mods d'états (flat/pct) sur stats & ressources
 * - clamp PV/Mana
 * - recalc derived.effective.stats
 * - expose : game.rpg.status.recompute(actor)
 *
 * Convention:
 * - PV: system.ressources.pv.{valeur,max}
 * - Mana: system.ressources.mana.{valeur,max}
 * - Stats base: system.stats.{force,dexterite,intelligence,acuite,endurance}
 * - Défenses base: system.defenses.{scoreArmure,scoreResistance,armureFixe,resistanceFixe}
 * - Vitesse base: system.vitesse
 *
 * Mods acceptés dans états:
 * - force,dexterite,intelligence,acuite,endurance
 * - pvMax,manaMax
 * - vitesse
 * - scoreArmure, scoreResistance, armureFixe, resistanceFixe
 * - defense, resistance (si tu utilises ces dérivés)
 * - regenPv, regenMana (optionnel)
 */

function n(v, d = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  }
  
  function applyMods(base, mod) {
    const flat = n(mod?.flat, 0);
    const pct = n(mod?.pct, 0);
    return Math.round((base + flat) * (1 + pct / 100));
  }
  
  function collectActiveMods(actor) {
    const list = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
    const mods = {};
  
    for (const st of list) {
      const m = st?.mods ?? {};
      for (const [k, v] of Object.entries(m)) {
        if (!mods[k]) mods[k] = { flat: 0, pct: 0 };
        mods[k].flat += n(v?.flat, 0);
        mods[k].pct += n(v?.pct, 0);
      }
    }
    return mods;
  }
  
  function getBaseStats(sys) {
    const s = sys?.stats ?? {};
    return {
      force: n(s.force, 0),
      dexterite: n(s.dexterite, 0),
      intelligence: n(s.intelligence, 0),
      acuite: n(s.acuite, 0),
      endurance: n(s.endurance, 0)
    };
  }
  
  function getBaseDefenses(sys) {
    const d = sys?.defenses ?? {};
    return {
      scoreArmure: n(d.scoreArmure, 0),
      scoreResistance: n(d.scoreResistance, 0),
      armureFixe: n(d.armureFixe, 0),
      resistanceFixe: n(d.resistanceFixe, 0)
    };
  }
  
  export async function recompute(actor) {
    const sys = foundry.utils.deepClone(actor.system ?? {});
  
    // ensure containers
    sys.stats = sys.stats ?? { force: 0, dexterite: 0, intelligence: 0, acuite: 0, endurance: 0 };
    sys.defenses = sys.defenses ?? { scoreArmure: 0, scoreResistance: 0, armureFixe: 0, resistanceFixe: 0 };
    sys.ressources = sys.ressources ?? {};
    sys.ressources.pv = sys.ressources.pv ?? { valeur: 0, max: 0 };
    sys.ressources.mana = sys.ressources.mana ?? { valeur: 0, max: 0 };
    sys.derived = sys.derived ?? {};
    sys.derived.effective = sys.derived.effective ?? {};
    sys.derived.effective.stats = sys.derived.effective.stats ?? {};
    sys.derived.defenses = sys.derived.defenses ?? {};
    sys.derived.regen = sys.derived.regen ?? {};
  
    const mods = collectActiveMods(actor);
  
    // stats effective
    const baseStats = getBaseStats(sys);
    const effStats = {
      force: applyMods(baseStats.force, mods.force),
      dexterite: applyMods(baseStats.dexterite, mods.dexterite),
      intelligence: applyMods(baseStats.intelligence, mods.intelligence),
      acuite: applyMods(baseStats.acuite, mods.acuite),
      endurance: applyMods(baseStats.endurance, mods.endurance)
    };
    sys.derived.effective.stats = effStats;
  
    // defenses effective (si tu veux que des états puissent les modifier)
    const baseDef = getBaseDefenses(sys);
    sys.derived.defenses.scoreArmure = applyMods(baseDef.scoreArmure, mods.scoreArmure);
    sys.derived.defenses.scoreResistance = applyMods(baseDef.scoreResistance, mods.scoreResistance);
    sys.derived.defenses.armureFixe = applyMods(baseDef.armureFixe, mods.armureFixe);
    sys.derived.defenses.resistanceFixe = applyMods(baseDef.resistanceFixe, mods.resistanceFixe);
  
    // vitesse
    const baseVit = n(sys.vitesse, 3);
    sys.derived.vitesse = applyMods(baseVit, mods.vitesse);
  
    // ressources max modifiables
    const basePvMax = n(sys.ressources.pv.max, 0);
    const baseManaMax = n(sys.ressources.mana.max, 0);
  
    const pvMax = Math.max(0, applyMods(basePvMax, mods.pvMax));
    const manaMax = Math.max(0, applyMods(baseManaMax, mods.manaMax));
  
    sys.ressources.pv.max = pvMax;
    sys.ressources.mana.max = manaMax;
  
    // clamp valeurs
    sys.ressources.pv.valeur = Math.max(0, Math.min(n(sys.ressources.pv.valeur, 0), pvMax || 999999));
    sys.ressources.mana.valeur = Math.max(0, Math.min(n(sys.ressources.mana.valeur, 0), manaMax || 999999));
  
    // regen optionnel
    const baseRegenPv = n(sys.regenPv, 0);
    const baseRegenMana = n(sys.regenMana, 0);
    sys.derived.regen.pv = applyMods(baseRegenPv, mods.regenPv);
    sys.derived.regen.mana = applyMods(baseRegenMana, mods.regenMana);
  
    // initiative bonus (si tu utilises)
    sys.derived.initiativeBonus = Math.floor((effStats.dexterite + effStats.acuite) / 2);
  
    await actor.update({ system: sys });
  }
  
  // API système
  export const status = { recompute };
  if (!game.rpg) game.rpg = {};
  game.rpg.status = status;
  