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
import { RPGRecipeSheetV2 } from "./sheets/item-recipe-sheet-v2.js";
import { RPGQuestSheetV2 } from "./sheets/item-quest-sheet-v2.js";

import { measureDistanceManhattan } from "./rules/distance.js";

import { randomizeMonster, buildRandomUpdatesForActor } from "./monster-gen.js";
import { RPGActor } from "./documents/actor.js";
import { RPGItem } from "./documents/item.js";

import * as Status from "./rules/status-effects.js";
import { RPG_AURAS } from "./rules/auras.js";
import { GM_AURA } from "./rules/gm-aura.js";
import * as Combat from "./rules/combat.js";
import * as RPG_SPELLS from "./rules/spells.js";
import { onTurnStartForActor } from "./rules/turn-effects.js";
import { setTokenPosOverride } from "./rules/auras.js";
import { resolveEndOfCombat, lootMonsters } from "./rules/combat-end.js";
import { autoInstallMacros } from "./macro/auto-install.js";
import { bindAttackChatButtons } from "./rules/attack-resolve.js";
import { bindActionChatButtons, postConfirmedMessage } from "./rules/action-confirm.js";
import { onPreUpdateToken, onUpdateToken, bindOpportunityAttackButtons } from "./rules/movement-tracker.js";
import { checkIngredients, computeForgeChance, declareCraft, resolveCraft, getInventoryQty } from "./rules/forge.js";
import { bindForgeChatButtons } from "./rules/forge-resolve.js";
import * as EffectLibrary from "./rules/effect-library.js";
import * as Resistances from "./rules/resistances.js";
import { appendToCampaignJournal } from "./rules/campaign-journal.js";
import * as WoundLibrary from "./rules/wound-library.js";
import * as WeatherLibrary from "./rules/weather-library.js";
import * as Reputation from "./rules/reputation.js";
import * as TacticalLibrary from "./rules/tactical-library.js";
import * as QuestGroup from "./rules/quest-group.js";
import { syncDefeatedFlag, checkCombatEndCondition, markFled, isFled, isOutOfFight, findCombatantFor } from "./rules/combat-state.js";
import { hasRolledMoraleThisTurn, bindMoraleChatButtons, declareMoraleCheck } from "./rules/morale-resolve.js";
import * as Skills from "./rules/skills.js";
import { declareSkillCheck, bindSkillCheckChatButtons, DIFFICULTY_TIERS } from "./rules/skill-check.js";
import * as StateBuilder from "./rules/state-builder.js";
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

  appendToCampaignJournal(
    `<b>${actor.name}</b> passe ${levelsGained > 1 ? `${levelsGained} niveaux` : "niveau"} et atteint le niveau <b>${niveau}</b>.`
  ).catch(() => {});
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

  // ✅ Setting météo courante (monde) — influence la magie élémentaire
  game.settings.register("rpg", "currentWeather", {
    name: "Météo actuelle",
    scope: "world",
    config: false,
    type: String,
    default: "clair"
  });

  // ✅ Tendance du marché par région (monde) — influence les prix au marché
  game.settings.register("rpg", "regionMarketTrend", {
    name: "Tendance du marché par région",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

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
  Items.registerSheet("rpg", RPGRecipeSheetV2, { types: ["recipe"], makeDefault: true });
  Items.registerSheet("rpg", RPGQuestSheetV2, { types: ["quest"], makeDefault: true });

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

  Hooks.once("ready", async () => {
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

    // ✅ game.rpg.forge : API de craft (déclaration + résolution MJ)
    game.rpg.forge = { checkIngredients, computeForgeChance, declareCraft, resolveCraft, getInventoryQty };

    // ✅ game.rpg.turnEffects : API mécaniques de tour (debug / macro)
    game.rpg.turnEffects = { onTurnStartForActor };

    // ✅ game.rpg.effectLibrary : catalogue d'effets nommés (brûlure, poison...)
    game.rpg.effectLibrary = EffectLibrary;

    // ✅ game.rpg.resistances : calcul résistance équipement/buffs
    game.rpg.resistances = Resistances;

    // ✅ game.rpg.wounds : catalogue de blessures localisées permanentes
    game.rpg.wounds = WoundLibrary;

    // ✅ game.rpg.weather : météo courante, influence la magie élémentaire
    game.rpg.weather = WeatherLibrary;

    // ✅ game.rpg.reputation : réputation région/vendeur + tendance marché
    game.rpg.reputation = Reputation;

    // ✅ game.rpg.tactical : positions tactiques (couverture, flanc, angle mort)
    game.rpg.tactical = TacticalLibrary;

    // ✅ game.rpg.questGroup : synchronisation des quêtes partagées
    game.rpg.questGroup = QuestGroup;

    // ✅ game.rpg.combatState : K.O., fuite, fin de combat
    game.rpg.combatState = { syncDefeatedFlag, checkCombatEndCondition, markFled, isFled, isOutOfFight, findCombatantFor };

    // ✅ game.rpg.morale : jet de moral au seuil critique
    game.rpg.morale = { hasRolledMoraleThisTurn, declareMoraleCheck };

    // ✅ game.rpg.skills : XP/niveau de compétences (source unique)
    game.rpg.skills = Skills;

    // ✅ game.rpg.skillCheck : jet de compétence générique (Discrétion, Crochetage...)
    game.rpg.skillCheck = { declareSkillCheck, DIFFICULTY_TIERS };

    // ✅ game.rpg.stateBuilder : construction d'état personnalisé (MJ)
    game.rpg.stateBuilder = StateBuilder;

    // ✅ game.rpg.journal : journal de campagne automatique (accessible aux macros)
    game.rpg.journal = { appendToCampaignJournal };

    // ✅ Auto-installation des macros système (GM uniquement)
    autoInstallMacros().catch((e) => console.error("[RPG] autoInstallMacros :", e));

    // ✅ Boutons MJ dans les messages chat (sorts + attaques)
    Hooks.on("renderChatMessageHTML", (message, html) => {
      try { RPG_SPELLS.bindSpellChatButtons(html, message); } catch (e) { }
      try { bindAttackChatButtons(html, message); } catch (e) { }
      try { bindActionChatButtons(html, message); } catch (e) { }
      try { bindForgeChatButtons(html, message); } catch (e) { }
      try { bindMoraleChatButtons(html, message); } catch (e) { }
      try { bindSkillCheckChatButtons(html, message); } catch (e) { }
      try {
        // Bouton "Lancer le d20" dans le message de sort
        const root = html instanceof HTMLElement ? html : html?.[0];
        // Bouton "Lancer les dégâts" (sort)
        root?.querySelectorAll(".rpg-dmg-roll-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            btn.disabled = true;
            btn.textContent = "Lancé !";
            try {
              const actorId  = btn.dataset.actorId;
              const targetId = btn.dataset.targetId;
              const diceExpr = btn.dataset.dice || "";
              const flat     = Number(btn.dataset.flat) || 0;
              const fixe     = Number(btn.dataset.fixe) || 0;
              const pct      = Number(btn.dataset.pct)  || 0;

              const caster = game.actors.get(actorId);
              const target = game.actors.get(targetId);

              let rawDmg = flat;
              let rollDesc = flat !== 0 ? `${flat}` : "";

              if (diceExpr) {
                const roll = await (new Roll(diceExpr)).evaluate();
                await roll.toMessage({
                  speaker: ChatMessage.getSpeaker({ actor: caster }),
                  flavor: `🎲 Dégâts — ${diceExpr}`
                });
                rawDmg += roll.total;
                rollDesc = `${diceExpr} (${roll.total})${flat ? ` + ${flat}` : ""}`;
              }

              const afterFixe = Math.max(0, rawDmg - fixe);
              const finalDmg  = Math.max(1, Math.ceil(afterFixe * (1 - pct / 100)));

              let resultLine = `💥 <b>${rawDmg}</b> dégâts bruts`;
              if (fixe || pct) resultLine += ` → après réduction (−${fixe} fixe, −${pct}%) = <b style="color:#c0392b">${finalDmg}</b>`;
              else resultLine += ` = <b style="color:#c0392b">${finalDmg}</b>`;

              if (target) {
                const pvCur = Number(target.system?.ressources?.pv?.valeur ?? 0) || 0;
                const pvMax = Number(target.system?.ressources?.pv?.max ?? 0) || 0;
                const pvNew = Math.max(0, pvCur - finalDmg);
                await target.update({ "system.ressources.pv.valeur": pvNew });
                resultLine += `<br>${target.name} : ${pvCur} → <b>${pvNew}</b>/${pvMax} PV`;
              }

              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: caster }),
                content: resultLine
              });
            } catch(e) {
              console.error("[RPG] Erreur lancer dégâts :", e);
              btn.disabled = false;
              btn.textContent = "🎲 Lancer les dégâts";
            }
          });
        });

        root?.querySelectorAll(".rpg-roll-d20-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            btn.disabled = true;
            try {
              const actorId = btn.dataset.actorId;
              const tn = Number(btn.dataset.tn) || 11;
              const spellName = btn.dataset.spell ?? "Sort";
              const actor = game.actors.get(actorId);
              const roll = await (new Roll("1d20")).evaluate();
              const hit = roll.total >= tn;
              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `🎲 <b>${actor?.name ?? "?"}</b> — ${spellName} : <b>${roll.total}</b> vs TN <b>${tn}+</b> → <b style="color:${hit ? "#1d9e75" : "#c0392b"}">${hit ? "✅ Touché !" : "❌ Raté"}</b>`
              });
            } catch(e) {
              console.error("[RPG] Erreur lancer d20 sort :", e);
            } finally {
              btn.disabled = false;
            }
          });
        });
      } catch (e) { }
      try {
        // Résolution du jet de retrait d'état
        if (message?.flags?.rpg?.type === "removeStateDeclaration" && game.user.isGM) {
          const root = html instanceof HTMLElement ? html : html?.[0];
          if (root && !root.dataset.rpgRemoveBound) {
            root.dataset.rpgRemoveBound = "1";
            const buttons = root.querySelectorAll(".rpg-remove-resolve");
            root.querySelector(".rpg-remove-state-gm") && buttons.forEach(btn => {
              btn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                if (!game.user.isGM) return;
                for (const b of buttons) b.disabled = true;
                try {
                  const { actorId, stateId } = message.flags.rpg;
                  const actor = game.actors.get(actorId);
                  const success = btn.dataset.result === "success";
                  await message.delete();
                  if (success && actor) {
                    const list = (actor.system?.etatsActifs ?? []).filter(s => s.id !== stateId);
                    await actor.update({ "system.etatsActifs": list });
                    const stateName = (actor.system?.etatsActifs ?? []).find(s => s.id === stateId)?.label ?? "état";
                    await ChatMessage.create({
                      content: `✅ <b>${actor?.name ?? "?"}</b> se défait de l'état.`
                    });
                  } else {
                    await ChatMessage.create({
                      content: `❌ <b>${actor?.name ?? "?"}</b> n'arrive pas à se défaire de l'état.`
                    });
                  }
                } catch (e) {
                  console.error("[RPG][RemoveState]", e);
                  for (const b of buttons) b.disabled = false;
                }
              });
            });
          }
        }
      } catch (e) { }
      try { bindOpportunityAttackButtons(html); } catch (e) { }
      try {
        const root = html instanceof HTMLElement ? html : html?.[0];
        const lootBtn = root?.querySelector('[data-action="lootNow"]');
        if (lootBtn && !lootBtn.dataset.bound && game.user.isGM) {
          lootBtn.dataset.bound = "1";
          lootBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            lootBtn.disabled = true;
            lootBtn.textContent = "Butin tiré";
            const ids = (lootBtn.dataset.monsterIds ?? "").split(",").filter(Boolean);
            await lootMonsters(ids);
          });
        }
      } catch (e) { }
      try {
        if (message?.flags?.rpg?.combatEndPrompt && game.user.isGM) {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const btn = root?.querySelector('[data-action="endCombatNow"]');
          if (btn && !btn.dataset.bound) {
            btn.dataset.bound = "1";
            btn.addEventListener("click", async (ev) => {
              ev.preventDefault();
              const combat = game.combats.get(message.flags.rpg.combatId);
              btn.disabled = true;
              if (combat) await combat.delete();
              else ui.notifications?.warn?.("Combat déjà terminé.");
            });
          }
        }
      } catch (e) { }
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

      // ✅ Fuite par sortie de la carte : si un combattant actif quitte les
      // limites de la scène, on le marque comme ayant fui (compte comme
      // "hors combat" pour la condition de fin de combat)
      try {
        if (game.user.isGM && game.combat?.started) {
          const scene = tokenDoc.parent;
          const dims = scene?.dimensions;
          if (scene && dims) {
            const outOfBounds = x < 0 || y < 0 || x > dims.width || y > dims.height;
            if (outOfBounds) {
              const combatant = game.combat.combatants.find(c => c.actorId === tokenDoc.actor?.id);
              if (combatant && !combatant.getFlag("rpg", "fled") && !combatant.getFlag("core", "defeated")) {
                await markFled(game.combat, combatant.id, "sorti de la carte");
              }
            }
          }
        }
      } catch (e) {
        console.warn("[RPG] flee-on-exit:", e);
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
  // ── Gestion des acteurs monstres importés depuis le compendium ──────────
  // Foundry doit créer un acteur monde comme "prototype" pour les tokens non-
  // liés. On les range dans un dossier dédié et on évite les doublons.
  const MONSTER_IMPORT_FOLDER = "_Monstres (prototypes)";

  Hooks.on("createActor", async (actor, options, userId) => {
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;
    if (actor.type !== "monster") return;

    // Vérifie si cet acteur vient du compendium système
    const sourceId = actor._stats?.compendiumSource ?? actor.flags?.core?.sourceId ?? "";
    if (!sourceId) return;

    // Cherche ou crée le dossier "prototypes"
    let folder = game.folders.find(f => f.type === "Actor" && f.name === MONSTER_IMPORT_FOLDER);
    if (!folder) {
      folder = await Folder.create({ name: MONSTER_IMPORT_FOLDER, type: "Actor", color: "#4a3f6b" });
    }

    // Cherche un doublon existant (même sourceId, pas cet acteur)
    const duplicate = game.actors.find(a =>
      a.id !== actor.id &&
      a.type === "monster" &&
      (a._stats?.compendiumSource === sourceId || a.flags?.core?.sourceId === sourceId)
    );

    if (duplicate) {
      // Un prototype de ce type existe déjà → supprime le nouveau (doublon)
      await actor.delete();
    } else {
      // Premier import de ce type → range dans le dossier prototypes
      if (actor.folder?.id !== folder.id) {
        await actor.update({ folder: folder.id });
      }
    }
  });


  // preCreateToken : intercepte avant la création pour forcer actorLink:false
  // et injecter les stats randomisées dans le delta du token (chaque token
  // a ses propres stats indépendantes, même si l'acteur source est identique)
  Hooks.on("preCreateToken", (tokenDoc, createData, options, userId) => {
    if (!game.user.isGM) return;

    const actor = tokenDoc.actor ?? game.actors.get(tokenDoc.actorId);
    if (!actor || actor.type !== "monster") return;

    const bands = actor.system?.gen?.bands ?? {};
    if (!Object.keys(bands).length) return;

    // Tire des stats aléatoires pour CE token
    const randomUpdates = buildRandomUpdatesForActor(actor);
    if (!randomUpdates) return;

    // Convertit les clés pointées en objet imbriqué pour le delta V13
    const delta = {};
    for (const [k, v] of Object.entries(randomUpdates)) {
      foundry.utils.setProperty(delta, k, v);
    }

    // Force le token à être non-lié (indépendant) + injecte les stats dans son delta
    tokenDoc.updateSource({
      actorLink: false,
      delta
    });
  });

  // Nettoyage post-création (plus besoin du hook createToken pour la génération)
  Hooks.on("createToken", async (tokenDoc, options, userId) => {
    if (userId !== game.userId) return;
    await RPG_AURAS?.refreshAuras?.();
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

  // ---------------------------
  // Journal : note quand un PJ ou monstre tombe à 0 PV (une seule fois)
  // + synchronise le flag K.O. natif + vérifie la fin de combat
  // ---------------------------
  const _downLogged = new Set();
  Hooks.on("updateActor", async (actor, changed, options) => {
    if (!game.user.isGM) return;
    const newPv = changed?.system?.ressources?.pv?.valeur;
    if (newPv === undefined) return;

    // Synchronise le flag K.O. (icône crâne du tracker) + vérifie fin de combat
    await syncDefeatedFlag(actor);
    if (game.combat) await checkCombatEndCondition(game.combat);

    if (Number(newPv) > 0) {
      _downLogged.delete(actor.id); // remonté au-dessus de 0 -> peut re-logger une future chute
      return;
    }
    if (_downLogged.has(actor.id)) return; // déjà loggé, évite le spam
    _downLogged.add(actor.id);

    const label = actor.type === "character" ? "tombe inconscient" : "est vaincu";
    appendToCampaignJournal(`<b>${actor.name}</b> ${label} (PV à 0).`).catch(() => {});
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