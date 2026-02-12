import { RPGCharacterSheet } from "./sheets/character-sheet.js";
import { RPGMonsterSheet } from "./sheets/monster-sheet.js";
import { RPGWeaponSheet } from "./sheets/item-weapon-sheet.js";
import { RPGArmorSheet } from "./sheets/item-armor-sheet.js";
import { RPGSpellSheet } from "./sheets/item-spell-sheet.js";
import { randomizeMonster } from "./monster-gen.js";
import { RPGActor } from "./documents/actor.js";
import * as Combat from "./rules/combat.js";
import { RPGItem } from "./documents/item.js";
import * as Status from "./rules/status-effects.js";
import { RPGGenericItemSheet } from "./sheets/item-generic-sheet.js";
// fonction level
function xpPalierForLevel(level) {
  const n = Math.max(1, Number(level) || 1);
  const x = n - 1;
  return Math.round(100 + 40 * x + 15 * x * x);
}

function buildActiveStateFromInit(initState, actor) {
  const effP = actor.system?.derived?.effective?.principales ?? actor.system?.principales ?? {};

  const name = String(initState.name ?? "").trim();
  const duration = Math.max(1, Number(initState.duration ?? 1) || 1);
  const dc = Math.max(0, Number(initState.dc ?? 0) || 0);

  const dotFlat = Number(initState.dotFlat ?? 0) || 0;
  const dotStat = String(initState.dotStat ?? "");
  const dotDiv = Math.max(1, Number(initState.dotDiv ?? 10) || 10);

  const dot =
    (dotFlat !== 0 || dotStat)
      ? { flat: dotFlat, stat: dotStat || "", div: dotDiv }
      : null;

  const d = initState.debuff ?? {};

  return {
    id: foundry.utils.randomID(),
    name,
    duration,
    remaining: duration,
    dc,
    dot,
    debuff: {
      forceFlat: Number(d.forceFlat ?? 0) || 0,
      forcePct: Number(d.forcePct ?? 0) || 0,

      intelligenceFlat: Number(d.intFlat ?? d.intelligenceFlat ?? 0) || 0,
      intelligencePct: Number(d.intPct ?? d.intelligencePct ?? 0) || 0,

      dexteriteFlat: Number(d.dexFlat ?? d.dexteriteFlat ?? 0) || 0,
      dexteritePct: Number(d.dexPct ?? d.dexteritePct ?? 0) || 0,

      acuiteFlat: Number(d.acuFlat ?? d.acuiteFlat ?? 0) || 0,
      acuitePct: Number(d.acuPct ?? d.acuitePct ?? 0) || 0,

      enduranceFlat: Number(d.endFlat ?? d.enduranceFlat ?? 0) || 0,
      endurancePct: Number(d.endPct ?? d.endurancePct ?? 0) || 0,
    }
  };
}

async function applyInitStatesToTokenActor(actor) {
  const init = Array.isArray(actor.system?.etatsInit) ? actor.system.etatsInit : [];
  if (!init.length) return;

  // On génère une liste active neuve à partir des init
  const actives = init
    .map(s => buildActiveStateFromInit(s, actor))
    .filter(s => s.name);

  // Important : on remplace les états actifs au spawn
  await actor.update({ "system.etatsActifs": actives });
}

// gestion des cooldowns et durées au tour
async function tickActorCooldowns(actor) {
  const spells = actor.items.filter(i => i.type === "spell");
  const updates = [];

  for (const s of spells) {
    const cd = Number(s.system?.recharge?.restant) || 0;
    const duree = Number(s.system?.duree?.restant) || 0;
    const actif = !!s.system?.actif;
    const mode = s.system?.mode ?? "attaque";

    const u = { _id: s.id };

    if (cd > 0) u["system.recharge.restant"] = Math.max(0, cd - 1);

    if (duree > 0) {
      const next = Math.max(0, duree - 1);
      u["system.duree.restant"] = next;

      // si durée finie, on coupe l’effet
      if (next === 0 && actif && mode !== "attaque") {
        u["system.actif"] = false;
      }
    }

    // push seulement si on a des champs à modifier
    if (Object.keys(u).length > 1) updates.push(u);
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

async function tickActorStates(actor) {
  const list = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
  if (!list.length) return;

  let pv = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
  const pvMax = Number(actor.system?.ressources?.pv?.max ?? 0) || 0;

  const effP = actor.system?.derived?.effective?.principales ?? actor.system?.principales ?? {};

  let totalDot = 0;
  const next = [];

  for (const e of list) {
    const remaining = Math.max(0, (Number(e.remaining ?? e.duration) || 0) - 1);

    // DOT
    let dotValue = 0;
    if (e.dot && (Number(e.dot.flat) || e.dot.stat)) {
      const flat = Number(e.dot.flat ?? 0) || 0;
      const stat = String(e.dot.stat ?? "");
      const div = Math.max(1, Number(e.dot.div ?? 10) || 10);
      const statVal = stat ? (Number(effP[stat] ?? 0) || 0) : 0;

      dotValue = Math.max(0, flat + Math.floor(statVal / div));
    }

    if (dotValue > 0) {
      pv = Math.max(0, pv - dotValue);
      totalDot += dotValue;
    }

    if (remaining > 0) {
      next.push({ ...e, remaining });
    }
  }

  await actor.update({
    "system.etatsActifs": next,
    "system.ressources.pv.valeur": Math.min(pvMax || pv, pv)
  });

  if (totalDot > 0) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<b>États</b> → ${actor.name} subit <b>${totalDot}</b> dégâts (DOT).`
    });
  }
}

// compétences de base 
const BASE_SKILLS = {
  crochetage: { level: 0, xp: 0 },
  larcin: { level: 0, xp: 0 },
  forge: { level: 0, xp: 0 },
  survie: { level: 0, xp: 0 },
  discretion: { level: 0, xp: 0 },
  perception: { level: 0, xp: 0 },
  detection: { level: 0, xp: 0 },
};

Hooks.once("init", async () => {
  console.log("RPG init chargé");

  // Actor custom (si tu as du derived/calculs dedans)
  CONFIG.Actor.documentClass = RPGActor;

  // API système
  game.rpg = game.rpg ?? {};
  game.rpg.randomizeMonster = randomizeMonster;
  // Import robuste (évite les erreurs de chemin relatif)
  const Combat = await import(new URL("./rules/combat.js", import.meta.url).href);
  game.rpg.combat = Combat;
  Items.unregisterSheet("core", ItemSheet);
  console.log("[RPG] Combat API OK:", Object.keys(game.rpg.combat));

  game.rpg.status = Status;
  console.log("[RPG] Status API OK:", Object.keys(game.rpg.status));

  Actors.registerSheet("rpg", RPGCharacterSheet, { types: ["character"], makeDefault: true });
  Actors.registerSheet("rpg", RPGMonsterSheet, { types: ["monster"], makeDefault: true });
  Items.registerSheet("rpg", RPGWeaponSheet, { types: ["weapon"], makeDefault: true });
  Items.registerSheet("rpg", RPGArmorSheet, { types: ["armor"], makeDefault: true });
  Items.registerSheet("rpg", RPGSpellSheet, { types: ["spell"], makeDefault: true });
  Items.registerSheet("rpg", RPGGenericItemSheet, {
    types: ["loot", "consumable"],
    makeDefault: true
  });


  // Defaults à la création (si tu en as besoin)
  Hooks.on("preCreateActor", (doc, createData,  options) => {
    const system = createData.system ?? {};

    system.base = system.base ?? {};

    const type = createData.type ?? doc.type ?? "character";

    // Valeurs de base immuables (1 seule fois)
    system.base.pvMax = system.base.pvMax ?? (system.ressources?.pv?.max ?? (type === "character" ? 30 : 30));
    system.base.manaMax = system.base.manaMax ?? (system.ressources?.mana?.max ?? (type === "character" ? 5 : 0));
    system.base.podsMax = system.base.podsMax ?? (system.charge?.podsMax ?? (type === "character" ? 50 : 0));

    system.base.regenPv = system.base.regenPv ?? (system.regeneration?.pv ?? (type === "character" ? 1.0 : 0.0));
    system.base.regenMana = system.base.regenMana ?? (system.regeneration?.mana ?? (type === "character" ? 1.0 : 0.0));

    system.base.vitesse = system.base.vitesse ?? (system.deplacement?.vitesse ?? (type === "character" ? 3 : 3));


    // sécurise xp/palier si MJ change niveau plus tard
    system.niveau = Math.max(1, Number(system.niveau ?? 1) || 1);
    system.xp = system.xp ?? { valeur: 0 };
    system.xp.valeur = Math.max(0, Number(system.xp.valeur) || 0);
    system.xp.palier = xpPalierForLevel(system.niveau);

    // ✅ SKILLS : on merge les bases
  system.skills = system.skills ?? {};
  let changed = false;

  for (const [k, v] of Object.entries(BASE_SKILLS)) {
    if (!system.skills[k]) {
      system.skills[k] = foundry.utils.deepClone(v);
      changed = true;
    }
  }

  // Si tu veux forcer même si déjà présent, enlève le if(!changed)
  if (!changed) return;

    doc.updateSource({ type, system });
  });

  // Recalcul palier si MJ change le niveau
  Hooks.on("preUpdateActor", (doc, changed, options, userId) => {
    const user = game.users.get(userId);
    if (user?.isGM) return true;

    // Autorise uniquement la dépense/regen de PV/Mana (combat & sorts)
    const flat = foundry.utils.flattenObject(changed);
    const allowed = new Set([
      "system.ressources.pv.valeur",
      "system.ressources.mana.valeur"
    ]);

    return Object.keys(flat).every(k => allowed.has(k));
  });

  CONFIG.Item.documentClass = RPGItem;

  CONFIG.Combat.initiative = {
    formula: "1d100 + floor((@effP.dexterite + @effP.acuite) / 2)",
    decimals: 0
  };

  function getTokenForActorOnScene(actor) {
    return canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ?? null;
  }

  function distanceBetweenTokens(t1, t2) {
    const m = canvas.grid.measureDistance(t1.center, t2.center);
    return m; // en unités de scène (souvent = cases si 1 case = 1 unité)
  }

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!("turn" in changed) && !("round" in changed)) return;
    if (!canvas?.ready) return;

    const combatant = combat.combatant;
    const actor = combatant?.actor;
    if (!actor) return;

    // --- TICK (GM only) ---
    if (game.user.isGM) {
      await tickActorCooldowns(actor);
      // await tickActorStates(actor);                 // DOT states system.etatsActifs
      await Status.tickActorEffectsAtTurnStart(actor); // ActiveEffects Foundry (optionnel)
    }

    // --- AURAS (regen) ---
    const targetToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ?? null;
    if (!targetToken) return;

    const distanceBetweenTokens = (t1, t2) => canvas.grid.measureDistance(t1.center, t2.center);

    let totalPv = 0;
    let totalMana = 0;

    for (const t of canvas.tokens.placeables) {
      const a = t.actor;
      if (!a) continue;

      const activeAuras = a.items
        .filter(i => i.type === "spell")
        .filter(i => i.system?.mode === "aura" && i.system?.aura?.active === true);

      if (!activeAuras.length) continue;

      const dist = distanceBetweenTokens(t, targetToken);

      for (const s of activeAuras) {
        const rayon = Number(s.system?.aura?.rayon ?? 0) || 0;
        if (rayon <= 0) continue;
        if (dist > rayon) continue;

        totalPv += Number(s.system?.aura?.regenPv ?? 0) || 0;
        totalMana += Number(s.system?.aura?.regenMana ?? 0) || 0;
      }
    }

    if (totalPv === 0 && totalMana === 0) return;

    const pv = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
    const pvMax = Number(actor.system?.ressources?.pv?.max ?? 0) || 0;
    const mana = Number(actor.system?.ressources?.mana?.valeur ?? 0) || 0;
    const manaMax = Number(actor.system?.ressources?.mana?.max ?? 0) || 0;

    await actor.update({
      "system.ressources.pv.valeur": Math.min(pvMax, pv + totalPv),
      "system.ressources.mana.valeur": Math.min(manaMax, mana + totalMana)
    });

    ChatMessage.create({
      content: `<b>Effets d'aura</b> → +${totalPv} PV, +${totalMana} Mana (cumul)`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  });

  // Permissions items (joueurs)
  Hooks.on("preCreateItem", (doc, createData, options, userId) => {
    const user = game.users.get(userId);
    if (user?.isGM) return true;
    return doc.parent?.documentName === "Actor" ? false : true;
  });

  Hooks.on("preDeleteItem", (doc, options, userId) => {
    const user = game.users.get(userId);
    if (user?.isGM) return true;
    return doc.parent?.documentName === "Actor" ? false : true;
  });

  Hooks.on("preUpdateItem", (doc, changed, options, userId) => {
    const user = game.users.get(userId);
    if (user?.isGM) return true;
    if (doc.parent?.documentName !== "Actor") return true;

    const flat = foundry.utils.flattenObject(changed);

    const allowed = new Set([
      "system.equipe",
      "system.actif",
      "system.aura.active"
    ]);

    return Object.keys(flat).every(k => allowed.has(k));
  });


  // IMPORTANT : génération automatique au drag&drop (token créé)
  Hooks.on("createToken", async (tokenDoc, options, userId) => {
    // ne traite que l'action du MJ qui a créé le token
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;

    try {
      if (tokenDoc.actorLink) return;

      const actor = tokenDoc.actor; // actor synthétique du token
      if (!actor || actor.type !== "monster") return;

      // évite double génération si Foundry renvoie plusieurs events
      if (actor.system?.gen?.generated === true) return;

      await game.rpg.randomizeMonster(actor);

      // 2) Appliquer les états initiaux (depuis la fiche monstre copiée dans le token)
      await applyInitStatesToTokenActor(actor);
    } catch (e) {
      console.error("[RPG] Erreur génération monstre createToken:", e);
    }
  });

  Hooks.on("updateActor", async (actor, changed, options, userId) => {
    if (!game.user.isGM) return;
    if (!("system" in changed) || !("niveau" in (changed.system ?? {}))) return;
    if (options.rpgXpSync) return;

    const lvl = Math.max(1, Number(actor.system?.niveau ?? 1) || 1);
    await actor.update(
      { "system.xp.palier": xpPalierForLevel(lvl) },
      { rpgXpSync: true }
    );
  });

  // --- BONUS EQUIP/PASSIF: applique/retire les stats directement dans system ---

  // Hooks.on("createItem", async (item, options, userId) => {
  //   const actor = item.parent;
  //   if (!actor || actor.documentName !== "Actor") return;

  //   if (!isBonusActive(item)) return;

  //   // Si l'item est créé déjà équipé/actif, on applique une fois
  //   const already = getAppliedDelta(actor, item.id);
  //   if (already) return;

  //   const delta = extractDelta(item);
  //   await applyDeltaToActor(actor, delta, +1, { reason: "createItem active bonus" });
  //   await setAppliedDelta(actor, item.id, delta);
  // });

  // Hooks.on("deleteItem", async (item, options, userId) => {
  //   const actor = item.parent;
  //   if (!actor || actor.documentName !== "Actor") return;

  //   // Retire ce qui avait été appliqué
  //   const applied = getAppliedDelta(actor, item.id);
  //   if (!applied) return;

  //   await applyDeltaToActor(actor, applied, -1, { reason: "deleteItem remove bonus" });
  //   await clearAppliedDelta(actor, item.id);
  // });

  // Hooks.on("updateItem", async (item, changed, options, userId) => {
  //   const actor = item.parent;
  //   if (!actor || actor.documentName !== "Actor") return;

  //   // Anti-boucle simple
  //   if (actor._rpgApplyingBonus) return;
  //   actor._rpgApplyingBonus = true;

  //   try {
  //     const wasApplied = getAppliedDelta(actor, item.id);
  //     const nowActive = isBonusActive(item);

  //     // 1) Cas: devient actif (equip true / passif active)
  //     if (nowActive && !wasApplied) {
  //       const delta = extractDelta(item);
  //       await applyDeltaToActor(actor, delta, +1, { reason: "updateItem activate bonus" });
  //       await setAppliedDelta(actor, item.id, delta);
  //       return;
  //     }

  //     // 2) Cas: devient inactif
  //     if (!nowActive && wasApplied) {
  //       await applyDeltaToActor(actor, wasApplied, -1, { reason: "updateItem deactivate bonus" });
  //       await clearAppliedDelta(actor, item.id);
  //       return;
  //     }

  //     // 3) Cas: reste actif MAIS ses bonus ont été modifiés -> appliquer la différence
  //     if (nowActive && wasApplied) {
  //       const newDelta = extractDelta(item);

  //       // calc diff = new - old
  //       const diff = foundry.utils.deepClone(newDelta);
  //       const sub = (a, b) => (Number(a) || 0) - (Number(b) || 0);

  //       for (const k of ["force", "intelligence", "dexterite", "acuite", "endurance"]) {
  //         diff.principales[k] = sub(newDelta.principales[k], wasApplied.principales[k]);
  //       }
  //       for (const k of ["armureFixe", "resistanceFixe", "scoreArmure", "scoreResistance"]) {
  //         diff.defenses[k] = sub(newDelta.defenses[k], wasApplied.defenses[k]);
  //       }
  //       diff.ressourcesMax.pv = sub(newDelta.ressourcesMax.pv, wasApplied.ressourcesMax.pv);
  //       diff.ressourcesMax.mana = sub(newDelta.ressourcesMax.mana, wasApplied.ressourcesMax.mana);
  //       diff.regenPct.pv = sub(newDelta.regenPct.pv, wasApplied.regenPct.pv);
  //       diff.regenPct.mana = sub(newDelta.regenPct.mana, wasApplied.regenPct.mana);
  //       diff.vitesse = sub(newDelta.vitesse, wasApplied.vitesse);

  //       await applyDeltaToActor(actor, diff, +1, { reason: "updateItem active bonus changed" });
  //       await setAppliedDelta(actor, item.id, newDelta);
  //     }
  //   } finally {
  //     actor._rpgApplyingBonus = false;
  //   }
  // });
});
