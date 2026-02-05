// systems/rpg/module/bonus-manager.js

function n(x) { return Number(x) || 0; }

function getPath(obj, path, def = 0) {
  const v = foundry.utils.getProperty(obj, path);
  return v == null ? def : v;
}

function set(update, path, value) {
  foundry.utils.setProperty(update, path, value);
}

/**
 * Normalise les bonus d'un item en "delta" standard.
 * Compatible avec:
 * - item.system.bonus.force (ton ancien format)
 * - item.system.bonuses.principales.force (format structuré)
 */
export function extractDelta(item) {
  const sys = item.system ?? {};

  // 1) ancien format (plat): system.bonus.force, pvMax, armureFixe, regenPvPct...
  const bFlat = sys.bonus ?? null;

  // 2) format structuré: system.bonuses.principales.force, defenses.scoreArmure, ressources.pvMax...
  const bStruct = sys.bonuses ?? sys.bonus ?? null; // on tolère "bonus" structuré aussi

  // Helper: lire plat OU structuré
  const read = (flatKey, structPath) => {
    const vFlat = bFlat ? bFlat[flatKey] : undefined;
    if (vFlat != null) return n(vFlat);
    return n(getPath(bStruct ?? {}, structPath, 0));
  };

  return {
    principales: {
      force:        read("force",        "principales.force"),
      intelligence: read("intelligence", "principales.intelligence"),
      dexterite:    read("dexterite",    "principales.dexterite"),
      acuite:       read("acuite",       "principales.acuite"),
      endurance:    read("endurance",    "principales.endurance"),
    },
    defenses: {
      armureFixe:      read("armureFixe",      "defenses.armureFixe"),
      resistanceFixe:  read("resistanceFixe",  "defenses.resistanceFixe"),
      scoreArmure:     read("scoreArmure",     "defenses.scoreArmure"),
      scoreResistance: read("scoreResistance", "defenses.scoreResistance"),
    },
    ressourcesMax: {
      pv:   read("pvMax",   "ressources.pvMax"),
      mana: read("manaMax", "ressources.manaMax"),
    },
    regenPct: {
      pv:   read("regenPvPct",   "regeneration.pvPct"),
      mana: read("regenManaPct", "regeneration.manaPct"),
    },
    vitesse: read("vitesse", "deplacement.vitesse"),
  };
}

function deltaIsZero(d) {
  const p = d.principales, def = d.defenses, r = d.ressourcesMax, rg = d.regenPct;
  const sum =
    p.force+p.intelligence+p.dexterite+p.acuite+p.endurance +
    def.armureFixe+def.resistanceFixe+def.scoreArmure+def.scoreResistance +
    r.pv+r.mana + rg.pv+rg.mana + d.vitesse;
  return sum === 0;
}

/**
 * Applique un delta sur l'actor.system (sign = +1 ou -1)
 * - PV/Mana max: modifie system.ressources.*.max
 * - clamp valeur si le max baisse sous la valeur actuelle
 * - regen: ici on convertit regenPct en ajout sur system.regeneration (si tu veux autrement, dis-moi)
 */
export async function applyDeltaToActor(actor, delta, sign, { reason = "" } = {}) {
  if (!actor?.system) return;
  if (!delta || deltaIsZero(delta)) return;

  const sys = actor.system;
  const upd = {};

  // Principales
  for (const k of ["force","intelligence","dexterite","acuite","endurance"]) {
    const cur = n(sys.principales?.[k]);
    set(upd, `system.principales.${k}`, cur + sign * n(delta.principales[k]));
  }

  // Defenses
  for (const k of ["armureFixe","resistanceFixe","scoreArmure","scoreResistance"]) {
    const cur = n(sys.defenses?.[k]);
    set(upd, `system.defenses.${k}`, cur + sign * n(delta.defenses[k]));
  }

  // Vitesse
  {
    const cur = n(sys.deplacement?.vitesse);
    set(upd, "system.deplacement.vitesse", cur + sign * n(delta.vitesse));
  }

  // PV/Mana max
  {
    const curPvMax = n(sys.ressources?.pv?.max);
    const newPvMax = curPvMax + sign * n(delta.ressourcesMax.pv);
    set(upd, "system.ressources.pv.max", Math.max(0, newPvMax));

    const curPv = n(sys.ressources?.pv?.valeur);
    set(upd, "system.ressources.pv.valeur", Math.min(curPv, Math.max(0, newPvMax)));

    const curManaMax = n(sys.ressources?.mana?.max);
    const newManaMax = curManaMax + sign * n(delta.ressourcesMax.mana);
    set(upd, "system.ressources.mana.max", Math.max(0, newManaMax));

    const curMana = n(sys.ressources?.mana?.valeur);
    set(upd, "system.ressources.mana.valeur", Math.min(curMana, Math.max(0, newManaMax)));
  }

  // Regen : on applique en "add" direct sur system.regeneration (simple)
  // Si tu préfères regen en % calculée en derived (plus propre), on peut changer.
  {
    const curRegenPv = n(sys.regeneration?.pv);
    const curRegenMana = n(sys.regeneration?.mana);
    // ex: regenPvPct=10 => +10% de la valeur actuelle de regen (simpliste)
    // => on transforme en delta additif constant: cur * pct/100 au moment de l'application
    const addPv = curRegenPv * (n(delta.regenPct.pv) / 100);
    const addMana = curRegenMana * (n(delta.regenPct.mana) / 100);

    set(upd, "system.regeneration.pv", curRegenPv + sign * addPv);
    set(upd, "system.regeneration.mana", curRegenMana + sign * addMana);
  }

  await actor.update(upd, { diff: true, render: false, rpgReason: reason });
}

/**
 * Stockage des deltas appliqués par item dans flags.rpg.applied[itemId]
 * => permet de retirer exactement ce qui a été ajouté, même si l'item change ensuite.
 */
export async function setAppliedDelta(actor, itemId, delta) {
  const map = (actor.getFlag("rpg", "applied") ?? {});
  map[itemId] = delta;
  await actor.setFlag("rpg", "applied", map);
}

export async function clearAppliedDelta(actor, itemId) {
  const map = (actor.getFlag("rpg", "applied") ?? {});
  delete map[itemId];
  await actor.setFlag("rpg", "applied", map);
}

export function getAppliedDelta(actor, itemId) {
  const map = (actor.getFlag("rpg", "applied") ?? {});
  return map[itemId] ?? null;
}

/**
 * Détermine si l'item doit appliquer des bonus maintenant.
 * - weapon/armor: si equipe=true
 * - spell passif: si mode="passif" && isActive=true
 */
export function isBonusActive(item) {
    if (!item?.parent || item.parent.documentName !== "Actor") return false;
  
    // Armes/armures : bonus appliqué seulement si équipé
    if (item.type === "weapon" || item.type === "armor") return item.system?.equipe === true;
  
    // Sorts passifs : bonus appliqué seulement si mode=passif et actif=true
    if (item.type === "spell") return item.system?.mode === "passif" && item.system?.actif === true;
  
    return false;
  }
  
