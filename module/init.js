// systems/rpg/module/init.js

// import { RPGCharacterSheet } from "./sheets/character-sheet.js";
import { RPGCharacterSheetV2 } from "./sheets/character-sheet-v2.js";
// import { RPGMonsterSheet } from "./sheets/monster-sheet.js";
import { RPGMonsterSheetV2 } from "./sheets/monster-sheet-v2.js";
// import { RPGWeaponSheet } from "./sheets/item-weapon-sheet.js";
import { RPGWeaponSheetV2 } from "./sheets/item-weapon-sheet-v2.js";
// import { RPGArmorSheet } from "./sheets/item-armor-sheet.js";
import { RPGArmorSheetV2 } from "./sheets/item-armor-sheet-v2.js";
// import { RPGSpellSheet } from "./sheets/item-spell-sheet.js";
import { RPGSpellSheetV2 } from "./sheets/item-spell-sheet-v2.js";
// import { RPGGenericItemSheet } from "./sheets/item-generic-sheet.js";
import { RPGGenericItemSheetV2 } from "./sheets/item-generic-sheet-v2.js";

import { measureDistanceManhattan } from "./rules/distance.js";

import { randomizeMonster } from "./monster-gen.js";
import { RPGActor } from "./documents/actor.js";
import { RPGItem } from "./documents/item.js";

import * as Status from "./rules/status-effects.js";
import { RPG_AURAS } from "./rules/auras.js";
import { GM_AURA } from "./rules/gm-aura.js";
import * as Combat from "./rules/combat.js";
import * as RPG_SPELLS from "./rules/spells.js";
import { onTurnStartForActor } from "./rules/turn-effects.js";
import { setTokenPosOverride } from "./rules/auras.js";
import { resolveEndOfCombat } from "./rules/combat-end.js";
import { autoInstallMacros } from "./macro/auto-install.js";
import { bindAttackChatButtons } from "./rules/attack-resolve.js";
import { bindActionChatButtons, postConfirmedMessage } from "./rules/action-confirm.js";
import { onPreUpdateToken, onUpdateToken } from "./rules/movement-tracker.js";
import {
  getBudget, saveBudget, resetBudget, canUseSlot, reserveSlot, confirmSlot,
  releaseSlot, budgetHTML, addLogEntry, updateLogEntry, findLogEntry, undoAction,
  SLOT_DEFS
} from "./rules/action-budget.js";
// ---------------------------
// XP palier
// ---------------------------
function xpPalierForLevel(level) {
  const n = Math.max(1, Number(level) || 1);
  const x = n - 1;
  return Math.round(100 + 40 * x + 15 * x * x);
}

// ---------------------------
// Level up automatique : +1 Force/Int/Dex/Acu/End par niveau gagné
// ---------------------------
async function applyLevelUps(actor) {
  let niveau = Math.max(1, Number(actor.system?.niveau ?? 1) || 1);
  const xpVal = Number(actor.system?.xp?.valeur ?? 0) || 0;
  let palier  = Number(actor.system?.xp?.palier ?? xpPalierForLevel(niveau)) || xpPalierForLevel(niveau);

  let levelsGained = 0;
  let iter = 0;
  const MAX_ITER = 50; // garde-fou anti-boucle infinie

  while (xpVal >= palier && iter < MAX_ITER) {
    niveau += 1;
    levelsGained += 1;
    palier = xpPalierForLevel(niveau);
    iter += 1;
  }

  if (levelsGained === 0) return;

  const p = actor.system?.principales ?? {};
  const updates = {
    "system.niveau":    niveau,
    "system.xp.palier":  palier,
    "system.principales.force":        Number(p.force ?? 0)        + levelsGained,
    "system.principales.intelligence": Number(p.intelligence ?? 0) + levelsGained,
    "system.principales.dexterite":    Number(p.dexterite ?? 0)    + levelsGained,
    "system.principales.acuite":       Number(p.acuite ?? 0)       + levelsGained,
    "system.principales.endurance":    Number(p.endurance ?? 0)    + levelsGained
  };

  await actor.update(updates, { rpgLevelSync: true });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `🎉 <b>${actor.name}</b> passe ${levelsGained > 1 ? `${levelsGained} niveaux` : "niveau"} ` +
      `! Niveau <b>${niveau}</b>.<br>` +
      `+${levelsGained} en Force, Intelligence, Dextérité, Acuité, Endurance.`
  });
}

const MODULE_ID = "Fanatsy";
const Actors = foundry.documents.collections.Actors;
const Items = foundry.documents.collections.Items;
const { ItemSheet } = foundry.appv1.sheets;
// ---------------------------
// États init -> états actifs (token)
// ---------------------------
function buildActiveStateFromInit(initState, actor) {
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

  const actives = init
    .map(s => buildActiveStateFromInit(s, actor))
    .filter(s => s.name);

  await actor.update({ "system.etatsActifs": actives });
}

// Tick cooldowns (spells)
function _getSpellCD(sys) {
  if (sys?.cooldown) return { max: Number(sys.cooldown.max ?? 0) || 0, restant: Number(sys.cooldown.restant ?? 0) || 0 };
  return { max: Number(sys?.recharge?.max ?? 0) || 0, restant: Number(sys?.recharge?.restant ?? 0) || 0 };
}

function _getSpellDuration(sys) {
  if (sys?.duration) return {
    max: Number(sys.duration.max ?? 0) || 0,
    restant: Number(sys.duration.restant ?? 0) || 0
  };
  const max = Number(sys?.dureeTours ?? 0) || 0;
  const restant = Number(sys?.dureeRestant ?? 0) || 0;
  return { max, restant: restant || max || 0 };
}

function _getSpellKind(sys) {
  if (sys?.kind) return String(sys.kind);
  const mode = String(sys?.mode ?? "attaque");
  if (mode === "passif") return "buff";
  if (mode === "aura") return "aura";
  return "attaque";
}

function _isSpellActive(sys) {
  return !!sys?.actif || !!sys?.aura?.active;
}

async function tickActorCooldowns(actor) {
  const spells = actor.items.filter(i => i.type === "spell");
  const updates = [];

  for (const s of spells) {
    const sys = s.system ?? {};
    const cd = _getSpellCD(sys);

    if (cd.restant > 0) {
      const next = Math.max(0, cd.restant - 1);
      updates.push({ _id: s.id, "system.cooldown.restant": next, "system.recharge.restant": next });
    }
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

// ---------------------------
// INIT
// ---------------------------
Hooks.once("init", async () => {
  console.log("RPG init chargé");

  game.rpg = game.rpg ?? {};
  game.rpg.randomizeMonster = randomizeMonster;
  game.rpg.status = Status;
  game.rpg.auras = RPG_AURAS;
  game.rpg.gmAura = GM_AURA;
  game[MODULE_ID] = game[MODULE_ID] || {};
  game.rpg.measureDistance = measureDistanceManhattan;

  game.rpg.combat = Combat;
  console.log("[RPG] Combat API OK:", Object.keys(game.rpg.combat ?? {}));
  // API publique
  game[MODULE_ID].api = {
    declareSpell: RPG_SPELLS.declareSpell,
    resolveDeclaredSpellFromMessage: RPG_SPELLS.resolveDeclaredSpellFromMessage
  };
  CONFIG.Actor.documentClass = RPGActor;
  CONFIG.Item.documentClass = RPGItem;

  Items.unregisterSheet("core", ItemSheet);

  // Actors.registerSheet("rpg", RPGCharacterSheet, { types: ["character"], makeDefault: true });
  Actors.registerSheet("rpg", RPGCharacterSheetV2, { types: ["character"], makeDefault: true });
  // Actors.registerSheet("rpg", RPGMonsterSheet, { types: ["monster"], makeDefault: true });
  Actors.registerSheet("rpg", RPGMonsterSheetV2, { types: ["monster"], makeDefault: true });

  // Items.registerSheet("rpg", RPGWeaponSheet, { types: ["weapon"], makeDefault: true });
  Items.registerSheet("rpg", RPGWeaponSheetV2, { types: ["weapon"], makeDefault: true });
  // Items.registerSheet("rpg", RPGArmorSheet, { types: ["armor"], makeDefault: true });
  Items.registerSheet("rpg", RPGArmorSheetV2, { types: ["armor"], makeDefault: true });
  // Items.registerSheet("rpg", RPGSpellSheet, { types: ["spell"], makeDefault: true });
  Items.registerSheet("rpg", RPGSpellSheetV2, { types: ["spell"], makeDefault: true });
  // Items.registerSheet("rpg", RPGGenericItemSheet, { types: ["loot", "consumable"], makeDefault: true });
  Items.registerSheet("rpg", RPGGenericItemSheetV2, { types: ["loot", "consumable"], makeDefault: true });

  // Initiative (compat avec @effP.*)
  CONFIG.Combat.initiative = {
    formula: "1d100 + floor((@effP.dexterite + @effP.acuite) / 2)",
    decimals: 0
  };

  // ---------------------------
  // Defaults Actor (création)
  // ---------------------------
  Hooks.on("preCreateActor", (doc, createData) => {
    const type = createData.type ?? doc.type ?? "character";
    const system = foundry.utils.deepClone(createData.system ?? {});
    let any = false;

    const setIfUndef = (path, value) => {
      const cur = foundry.utils.getProperty(system, path);
      if (cur === undefined) {
        foundry.utils.setProperty(system, path, value);
        any = true;
      }
    };

    // ✅ Niveau / XP
    setIfUndef("niveau", 1);
    const niveau = Math.max(1, Number(system.niveau ?? 1) || 1);
    if (system.niveau !== niveau) { system.niveau = niveau; any = true; }

    setIfUndef("xp", { valeur: 0 });
    setIfUndef("xp.valeur", 0);
    const xpVal = Math.max(0, Number(system.xp?.valeur ?? 0) || 0);
    if (system.xp.valeur !== xpVal) { system.xp.valeur = xpVal; any = true; }

    const palier = xpPalierForLevel(niveau);
    setIfUndef("xp.palier", palier);
    if (system.xp.palier !== palier) { system.xp.palier = palier; any = true; }

    // ✅ Stats de base = 0
    setIfUndef("principales", { force: 0, intelligence: 0, dexterite: 0, acuite: 0, endurance: 0 });
    for (const k of ["force", "intelligence", "dexterite", "acuite", "endurance"]) {
      setIfUndef(`principales.${k}`, 0);
    }

    // ✅ Défenses base = 0
    setIfUndef("defenses", { armureFixe: 0, resistanceFixe: 0, scoreArmure: 0, scoreResistance: 0 });
    for (const k of ["armureFixe", "resistanceFixe", "scoreArmure", "scoreResistance"]) {
      setIfUndef(`defenses.${k}`, 0);
    }

    // ✅ Vitesse = 3 (system.deplacement.vitesse)
    setIfUndef("deplacement", { vitesse: 3 });
    setIfUndef("deplacement.vitesse", 3);

    // ✅ Pods max = 50 (PJ) / 0 (monstre) + podsActuels 0
    setIfUndef("charge", { podsActuels: 0, podsMax: 0 });
    setIfUndef("charge.podsActuels", 0);
    setIfUndef("charge.podsMax", type === "character" ? 50 : 0);
    if (type === "character" && Number(system.charge.podsMax ?? 0) !== 50) { system.charge.podsMax = 50; any = true; }

    // ✅ Ressources PV/Mana (PV 30/30 ; Mana 5/5 PJ)
    setIfUndef("ressources", {});
    setIfUndef("ressources.pv", { valeur: 30, max: 30 });
    setIfUndef("ressources.pv.valeur", 30);
    setIfUndef("ressources.pv.max", 30);

    if (type === "character") {
      setIfUndef("ressources.mana", { valeur: 5, max: 5 });
      setIfUndef("ressources.mana.valeur", 5);
      setIfUndef("ressources.mana.max", 5);
    } else {
      setIfUndef("ressources.mana", { valeur: 0, max: 0 });
      setIfUndef("ressources.mana.valeur", 0);
      setIfUndef("ressources.mana.max", 0);
    }

    // ✅ Regen (tes chemins)
    setIfUndef("regeneration", { pv: type === "character" ? 1.0 : 0.0, mana: type === "character" ? 1.0 : 0.0 });
    setIfUndef("regeneration.pv", type === "character" ? 1.0 : 0.0);
    setIfUndef("regeneration.mana", type === "character" ? 1.0 : 0.0);

    // ✅ Skills : laisse ton template.json gérer le set complet si présent
    setIfUndef("skills", system.skills ?? {});

    // états
    setIfUndef("etatsActifs", []);
    setIfUndef("etatsInit", []);

    if (any) doc.updateSource({ type, system });
  });

  // ---------------------------
  // Bloquer update Actor par joueurs (sauf PV/Mana valeurs)
  // ---------------------------
  Hooks.on("preUpdateActor", (doc, changed, options, userId) => {
    const user = game.users.get(userId);
    if (user?.isGM) return true;

    const flat = foundry.utils.flattenObject(changed);
    const allowed = new Set([
      "system.ressources.pv.valeur",
      "system.ressources.mana.valeur"
    ]);
    return Object.keys(flat).every(k => allowed.has(k));
  });

  Hooks.once("ready", () => {
    console.log("Spell sheetClasses:", CONFIG.Item.sheetClasses?.spell);

    // Globals
    globalThis.RPG_AURAS = RPG_AURAS;

    // ✅ API globale + game.rpg.spells (pour macros / debug)
    globalThis.RPG_SPELLS = { ...RPG_SPELLS, castSpell: RPG_SPELLS.declareSpell };
    game.rpg = game.rpg ?? {};
    game.rpg.spells = globalThis.RPG_SPELLS;

    // ✅ game.rpg.combat : API utilisée par les sheets (monster, character)
    game.rpg.combat = Combat;

    // ✅ game.rpg.status : force recompute d'un acteur
    game.rpg.status = { recompute: async (actor) => { if (actor) { actor.reset(); actor.sheet?.render(false); } } };

    // ✅ game.rpg.budget : API budget d'actions
    game.rpg.budget = {
      getBudget, saveBudget, resetBudget, canUseSlot,
      reserveSlot, confirmSlot, releaseSlot, budgetHTML,
      addLogEntry, updateLogEntry, findLogEntry, undoAction, SLOT_DEFS
    };

    // ✅ game.rpg.actionConfirm : API messages de confirmation
    game.rpg.actionConfirm = { buildPendingMessage: (await import("./rules/action-confirm.js")).buildPendingMessage, postConfirmedMessage };

    // ✅ Auto-installation des macros système (GM uniquement)
    autoInstallMacros().catch((e) => console.error("[RPG] autoInstallMacros :", e));

    // ✅ Boutons MJ dans les messages chat (sorts + attaques)
    Hooks.on("renderChatMessageHTML", (message, html) => {
      try { RPG_SPELLS.bindSpellChatButtons(html, message); } catch (e) { }
      try { bindAttackChatButtons(html, message); } catch (e) { }
      try { bindActionChatButtons(html, message); } catch (e) { }
    });

    // ---------- Aura refresh debounce (centralisé) ----------
    let _auraRefreshTimeout = null;
    const requestAuraRefresh = (delay = 50) => {
      clearTimeout(_auraRefreshTimeout);
      _auraRefreshTimeout = setTimeout(() => {
        try { globalThis.RPG_AURAS?.refreshAuras?.(); } catch (e) { console.error(e); }
      }, delay);
    };

    // ---------- Token move : budget + refresh auras ----------
    Hooks.on("preUpdateToken", (tokenDoc, changes) => {
      try { onPreUpdateToken(tokenDoc, changes); } catch (e) {}
    });

    Hooks.on("updateToken", async (tokenDoc, changes) => {
      if (!("x" in changes || "y" in changes)) return;

      // Pousse la position dans l'override aura
      const x = ("x" in changes) ? changes.x : tokenDoc.x;
      const y = ("y" in changes) ? changes.y : tokenDoc.y;
      setTokenPosOverride(tokenDoc.id, x, y);
      requestAuraRefresh(0);

      // Suivi budget déplacement (GM seulement)
      try { await onUpdateToken(tokenDoc, changes); } catch (e) {
        console.warn("[RPG] movement-tracker:", e);
      }
    });

    // (Optionnel) si tu veux aussi quand on drop un token / téléport
    Hooks.on("createToken", () => requestAuraRefresh(200));

    // First refresh
    requestAuraRefresh(500);

    // ---------- Item changes : refresh auras si sort/aura modifié ----------
    Hooks.on("updateItem", (item, changed) => {
      const actor = item?.parent;
      if (!actor) return;

      const flat = foundry.utils.flattenObject(changed ?? {});
      const relevant = Object.keys(flat).some(k =>
        k.startsWith("system.aura") ||
        k.startsWith("system.range") ||
        k.startsWith("system.effectsUI") ||
        k.startsWith("system.cooldown") ||
        k.startsWith("system.recharge") ||
        k === "name" ||
        k === "img"
      );

      if (!relevant) return;
      requestAuraRefresh(150);
    });
  });

  let _lastTurnKey = null;

  // ---------------------------
  // Tick tour combat (cooldowns + effets + auras + regen)
  // ---------------------------
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user.isGM) return;
    if (!("turn" in changed) && !("round" in changed)) return;
    if (!canvas?.ready) return;

    // ✅ clé unique plus robuste (combat.id inclus)
    const key = `${combat.id}:${combat.round}:${combat.turn}`;
    if (key === _lastTurnKey) return;
    _lastTurnKey = key;

    const combatant = combat.combatant;
    const actor = combatant?.actor ?? null;
    if (!actor) return;

    // ✅ UNIQUE tick: cooldowns + états (-1) + suppression à 0 + recompute
    // Reset du budget d'actions au début du tour
    if (game.user.isGM) {
      const combatant = combat.combatants.find(c => c.actorId === actor.id);
      if (combatant) {
        await resetBudget(combat, combatant.id).catch(e => console.warn("[RPG] resetBudget:", e));
      }
    }

    await onTurnStartForActor(actor, { combat });

    // ✅ refresh auras après tick (si aura source expire, auraApplied disparaît)
    await RPG_AURAS?.refreshAuras?.();

    // ✅ Regen (PV/Mana uniquement)
    const pvCur = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
    const pvMax = Number(actor.system?.ressources?.pv?.max ?? 0) || 0;
    const manaCur = Number(actor.system?.ressources?.mana?.valeur ?? 0) || 0;
    const manaMax = Number(actor.system?.ressources?.mana?.max ?? 0) || 0;

    const regenPv = Number(actor.system?.regeneration?.pv ?? 0) || 0;
    const regenMana = Number(actor.system?.regeneration?.mana ?? 0) || 0;

    if (regenPv !== 0 || regenMana !== 0) {
      await actor.update({
        "system.ressources.pv.valeur": Math.min(pvMax, pvCur + regenPv),
        "system.ressources.mana.valeur": Math.min(manaMax, manaCur + regenMana)
      });

      await ChatMessage.create({
        content: `<b>Régénération</b> → +${regenPv} PV, +${regenMana} Mana`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    }
  });

  // ---------------------------
  // Permissions items (joueurs)
  // ---------------------------
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

    const flat = foundry.utils.flattenObject(changed ?? {});
    const allowed = new Set([
      "system.equipe",
      "system.actif",
      "system.aura.active",
      "system.aura.enabled"
    ]);

    return Object.keys(flat).every(k => allowed.has(k));
  });

  // ---------------------------
  // Génération automatique : token monstre
  // ---------------------------
  Hooks.on("createToken", async (tokenDoc, options, userId) => {
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;

    try {
      if (tokenDoc.actorLink) return;

      const actor = tokenDoc.actor;
      if (!actor || actor.type !== "monster") return;

      if (actor.system?.gen?.generated === true) return;

      await game.rpg.randomizeMonster(actor);
      await applyInitStatesToTokenActor(actor);
      await RPG_AURAS?.refreshAuras?.();
    } catch (e) {
      console.error("[RPG] Erreur génération monstre createToken:", e);
    }
  });

  // ---------------------------
  // Recalc palier si GM change le niveau
  // ---------------------------
  Hooks.on("updateActor", async (actor, changed, options) => {
    if (!game.user.isGM) return;
    if (!("system" in changed) || !("niveau" in (changed.system ?? {}))) return;
    if (options.rpgXpSync || options.rpgLevelSync) return;

    const lvl = Math.max(1, Number(actor.system?.niveau ?? 1) || 1);
    await actor.update({ "system.xp.palier": xpPalierForLevel(lvl) }, { rpgXpSync: true });
  });

  // ---------------------------
  // Level up automatique dès qu'un PJ gagne de l'XP
  // ---------------------------
  Hooks.on("updateActor", async (actor, changed, options) => {
    if (!game.user.isGM) return;
    if (actor.type !== "character") return;
    if (options.rpgXpSync || options.rpgLevelSync) return;
    if (changed?.system?.xp?.valeur === undefined) return;

    try {
      await applyLevelUps(actor);
    } catch (e) {
      console.error("[RPG] Erreur level up automatique :", e);
    }
  });

  Hooks.on("combatStart", async (combat) => {
    if (game.user.isGM) await RPG_AURAS.refreshAuras();

    // Message d'instruction initiative pour tous les joueurs
    if (game.user.isGM) {
      // Construit la liste des PJ participants
      const pjLines = combat.combatants
        .filter(c => c.actor?.type === "character")
        .map(c => {
          const ini = c.actor?.system?.derived?.initiativeMod ?? 0;
          return `<li><b>${c.name}</b> — bonus initiative : <b>+${ini}</b></li>`;
        }).join("");

      await ChatMessage.create({
        content:
          `<h3>⚔️ Début du combat — Jetez votre initiative !</h3>` +
          `<p>Chaque joueur doit cliquer sur son token dans le <b>Tracker de combat</b> ` +
          `et cliquer sur le dé 🎲 pour lancer son initiative (1d100 + bonus).</p>` +
          (pjLines ? `<ul>${pjLines}</ul>` : "") +
          `<p style="font-size:11px;opacity:0.7">Formule : 1d100 + (Dextérité + Acuité) / 2</p>`
      });
    }
  });

  // ---------------------------
  // Fin de combat → XP + Loot
  // ---------------------------
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM) return;
    try {
      await resolveEndOfCombat(combat);
    } catch (e) {
      console.error("[RPG] Erreur fin de combat (XP/Loot) :", e);
    }
  });
});