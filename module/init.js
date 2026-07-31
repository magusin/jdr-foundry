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
import { installRPGTokenRuler } from "./rules/movement-ruler.js";
import { installCustomStatusEffects, syncActorStatusIcons } from "./rules/status-icons.js";
import { installRangeOverlay, showSpellRangeOverlay, showTokenRanges, clearRanges, togglePinnedRanges } from "./rules/range-overlay.js";
import { installDragLimit, clearDragLimitCache } from "./rules/drag-limit.js";
import { applyGlobalTheme, themeWindow } from "./sheets/sheet-helpers.js";
import { installHotbarSupport, useItemFromHotbar } from "./rules/hotbar.js";
import { applyChatVisibility, gmOnly, hpSecret } from "./rules/chat-visibility.js";
import { installDefaultActions, grantDefaultActions, backfillDefaultActions,
         bindSwapChatButtons } from "./rules/default-actions.js";
import { installCodex } from "./rules/codex.js";

import { randomizeMonster, buildRandomUpdatesForActor } from "./monster-gen.js";
import { RPGActor } from "./documents/actor.js";
import { RPGItem } from "./documents/item.js";

import * as Status from "./rules/status-effects.js";
import { RPG_AURAS } from "./rules/auras.js";
import { GM_AURA } from "./rules/gm-aura.js";
import { RPG_AURA_RENDER } from "./rules/aura-render.js";
import * as Combat from "./rules/combat.js";
import * as RPG_SPELLS from "./rules/spells.js";
import { onTurnStartForActor } from "./rules/turn-effects.js";
import { setTokenPosOverride } from "./rules/auras.js";
import { resolveEndOfCombat, lootMonsters } from "./rules/combat-end.js";
import { autoInstallMacros } from "./macro/auto-install.js";
import { bindAttackChatButtons } from "./rules/attack-resolve.js";
import { bindActionChatButtons, postConfirmedMessage } from "./rules/action-confirm.js";
import { onPreUpdateToken, onUpdateToken, bindOpportunityAttackButtons } from "./rules/movement-tracker.js";
import { registerRegionBehaviors, registerRegionBehaviorSheets } from "./rules/region-behaviors.js";
import {
  registerZoneEffectBehavior, registerZoneEffectSheet,
  getZoneEffectsAt, triggerZoneEffectsForToken,
  declareZonePerceptionCheck, revealZoneToActor
} from "./rules/zone-effects.js";
import { MOVEMENT_TYPES, getActiveMovementTypes, isImmuneToTerrain, getEffectiveSpeedMult, getMovementTypeLabel } from "./rules/movement-types.js";
import { showSpellRange, showSpellRangeFromItem, clearSpellRange } from "./rules/spell-range.js";
import { installGlobalErrorHandler } from "./utils/error-handler.js";
import { checkIngredients, computeForgeChance, declareCraft, resolveCraft, getInventoryQty } from "./rules/forge.js";
import { bindForgeChatButtons } from "./rules/forge-resolve.js";
import * as EffectLibrary from "./rules/effect-library.js";
import * as Resistances from "./rules/resistances.js";
import { appendToCampaignJournal } from "./rules/campaign-journal.js";
import * as WoundLibrary from "./rules/wound-library.js";
import * as WeatherLibrary from "./rules/weather-library.js";
import { initWeatherHUD, initBiomeHUD } from "./rules/weather-library.js";
import * as Reputation from "./rules/reputation.js";
import * as TacticalLibrary from "./rules/tactical-library.js";
import * as QuestGroup from "./rules/quest-group.js";
import { syncDefeatedFlag, checkCombatEndCondition, markFled, isFled, isOutOfFight, findCombatantFor } from "./rules/combat-state.js";
import { hasRolledAgonieCheck, bindAgonieChatButtons, declareAgonieCheck } from "./rules/agonie-resolve.js";
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

/**
 * Aligne la règle de diagonale du cœur Foundry sur le réglage RP « diagonalRule »,
 * pour que la réglette de déplacement de Foundry affiche le même coût que le
 * système. Best-effort, MJ uniquement (réglage « monde »).
 */
async function rpgSyncCoreDiagonals() {
  if (!game?.user?.isGM) return;
  try {
    const GD = CONST?.GRID_DIAGONALS ?? {};
    const rule = game.settings.get("rpg", "diagonalRule");
    const target =
      rule === "chebyshev"   ? GD.EQUIDISTANT :
      rule === "alternating" ? GD.ALTERNATING_1 :
                               GD.EXACT;              // octile ≈ réaliste
    if (target == null) return;
    if (game.settings.get("core", "gridDiagonals") !== target) {
      await game.settings.set("core", "gridDiagonals", target);
      try { if (canvas?.ready) await canvas.draw(); } catch { /* redraw best-effort */ }
    }
  } catch (e) {
    console.warn("[RPG] Synchronisation de la règle de diagonale impossible :", e);
  }
}

// ✅ La barre d'actions (module/rules/hotbar.js) crée une macro de type
// « script » pour chaque sort/arme glissé — Foundry exige la permission
// MACRO_SCRIPT pour créer *et* exécuter ce type de macro. Si le rôle
// Joueur ne l'a pas (mondes migrés depuis une ancienne version de Foundry,
// ou juste jamais coché dans Configuration → Permissions), les sorts
// glissés dans la barre ne font simplement rien pour ce rôle — sans
// erreur visible côté joueur. On l'accorde donc automatiquement au
// démarrage plutôt que de compter sur le MJ pour le repérer.
async function ensureMacroScriptPermission() {
  if (!game?.user?.isGM) return;
  try {
    const perms = foundry.utils.deepClone(game.permissions ?? game.settings.get("core", "permissions") ?? {});
    const roles = new Set(perms.MACRO_SCRIPT ?? []);
    if (roles.has(CONST.USER_ROLES.PLAYER)) return;
    roles.add(CONST.USER_ROLES.PLAYER);
    perms.MACRO_SCRIPT = Array.from(roles);
    await game.settings.set("core", "permissions", perms);
    ui.notifications?.info?.(
      "Permission « Modifier/exécuter les macros de script » activée pour le rôle Joueur "
    + "(nécessaire pour utiliser les sorts glissés dans la barre d'actions)."
    );
  } catch (e) {
    console.warn("[RPG] Permission macros de script (rôle Joueur) :", e);
  }
}

// ---------------------------
// INIT
// ---------------------------
Hooks.once("init", async () => {
  console.log("RPG init chargé");

  // ✅ Protection globale contre les crashes non-catchés
  installGlobalErrorHandler();

  // ✅ Enregistrement des comportements de région (terrain difficile, eau, etc.)
  registerRegionBehaviors();
  registerZoneEffectBehavior();

  // Expose l'API terrain pour les macros
  Hooks.once("ready", () => {
    const { getTerrainAt, calculateMovementCost, TERRAIN_TYPES } = foundry.utils.mergeObject({},{});
  });

  // Sheets de configuration des terrains (après le hook setup)
  Hooks.once("setup", () => {
    registerRegionBehaviorSheets();
    registerZoneEffectSheet();
  });

  // ✅ Setting météo courante (monde) — influence la magie élémentaire
  // ✅ Thème visuel des fiches — choix INDIVIDUEL par joueur (scope client)
  game.settings.register("rpg", "uiTheme", {
    name: "Thème des fiches RPG",
    hint: "Choisis l'apparence de tes fiches de personnage, sorts, objets... Ce réglage est personnel : chaque joueur peut choisir le sien.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      sombre:    "🌑 Sombre — Grimoire Arcanique (par défaut)",
      clair:     "☀️ Clair — Parchemin",
      contraste: "⚡ Contraste élevé — accessibilité"
    },
    default: "sombre",
    requiresReload: false,
    onChange: () => {
      // Thème global (<body>) : les dialogues de macro le suivent aussi
      try { applyGlobalTheme(); } catch { /* ignore */ }
      // Réapplique le thème sur toutes les fenêtres d'app ouvertes
      for (const app of Object.values(ui.windows ?? {})) {
        try { app.render({ force: false }); } catch { /* ignore */ }
      }
    }
  });

  game.settings.register("rpg", "movementLimitScope", {
    name: "Limite de déplacement en combat",
    hint: "Empêche un token de dépasser sa Vitesse pendant son tour. Hors combat, personne n'est limité.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      players: "👥 Joueurs seulement — le MJ déplace librement (recommandé)",
      all:     "🔒 Tout le monde, MJ compris en permanence",
      off:     "🔓 Désactivée — simple avertissement dans le chat"
    },
    default: "players",
    requiresReload: false
  });

  // ── Coût en fatigue par action ────────────────────────────────────────
  // La fatigue règle le rythme du combat, elle ne doit pas le bloquer.
  // Par défaut seule l'attaque en coûte : bouger et changer d'arme sont
  // gratuits. Les sorts gardent leur coût propre, défini sur chaque sort.
  const FATIGUE_CHOICES = { 0: "Aucun", 1: "1 point", 2: "2 points", 3: "3 points" };

  game.settings.register("rpg", "fatigueAttaque", {
    name: "Fatigue — attaque (par défaut)",
    hint: "Utilisé pour les attaques à mains nues et les armes dont le champ « Coût fatigue » n'est pas renseigné. Sinon c'est la valeur de la fiche d'arme qui décide.",
    scope: "world", config: true, type: Number,
    choices: FATIGUE_CHOICES, default: 1, requiresReload: false
  });

  game.settings.register("rpg", "fatigueDeplacement", {
    name: "Fatigue — déplacement",
    hint: "Fatigue gagnée pour un déplacement dans le tour. 0 par défaut : se déplacer ne doit pas être puni.",
    scope: "world", config: true, type: Number,
    choices: FATIGUE_CHOICES, default: 0, requiresReload: false
  });

  game.settings.register("rpg", "dualWieldDifficulty", {
    name: "Attaque à deux armes — malus",
    hint: "Ajouté au seuil de touché quand on frappe des deux armes en une action. "
        + "À 0 le dé de la seconde arme est gratuit et frapper des deux est toujours "
        + "le meilleur choix ; monte-le si le double armement domine à ta table.",
    scope: "world", config: true, type: Number,
    choices: { 0: "Aucun", 1: "+1 (défaut)", 2: "+2", 3: "+3" },
    default: 1, requiresReload: false
  });

  game.settings.register("rpg", "fatigueEchangeArme", {
    name: "Fatigue — échange d'arme",
    hint: "Fatigue gagnée en dégainant ou rengainant en combat. 0 par défaut : l'action consommée suffit comme coût.",
    scope: "world", config: true, type: Number,
    choices: FATIGUE_CHOICES, default: 0, requiresReload: false
  });

  // Interrupteur MJ : le MJ reste libre par défaut (poussées, téléportations,
  // repositionnements), et active la limite à la volée quand il veut jouer un
  // monstre « à la règle ». Basculé par le raccourci clavier ci-dessous.
  game.settings.register("rpg", "gmMovementLimit", {
    name: "MJ : appliquer la limite de vitesse",
    hint: "Quand c'est actif, tes propres déplacements de tokens sont bloqués au-delà de la Vitesse du token, comme pour un joueur. Bascule avec le raccourci « Limite de déplacement (MJ) ».",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false
  });

  // Raccourci MJ : bascule la limite de vitesse pour ses propres déplacements.
  game.keybindings.register("rpg", "toggleGmMovementLimit", {
    name: "Limite de déplacement (MJ)",
    hint: "Active ou désactive la limite de vitesse pour les tokens que TU déplaces. Utile pour jouer un monstre à la règle, sans t'empêcher de repousser ou téléporter un token le reste du temps.",
    editable: [{ key: "KeyM", modifiers: ["Shift"] }],
    restricted: true,   // MJ uniquement
    onDown: () => {
      const cur = game.settings.get("rpg", "gmMovementLimit") === true;
      const next = !cur;
      game.settings.set("rpg", "gmMovementLimit", next);
      ui.notifications?.info?.(next
        ? "🔒 Limite de déplacement ACTIVE — tes tokens ne dépasseront plus leur Vitesse."
        : "🔓 Limite de déplacement LEVÉE — tu peux déplacer les tokens librement.");
      return true;
    }
  });

  // Affiche/masque en permanence les portées du token sélectionné (allonge de
  // mêlée + portée de l'arme équipée), sans avoir à garder la souris dessus.
  game.keybindings.register("rpg", "togglePinnedRanges", {
    name: "Afficher les portées du token sélectionné",
    hint: "Garde à l'écran la zone de mêlée et la portée de l'arme équipée du token sélectionné. Sinon, il suffit de survoler un token pour les voir brièvement.",
    editable: [{ key: "KeyR", modifiers: ["Shift"] }],
    restricted: false,
    onDown: () => {
      try { togglePinnedRanges(); } catch (e) { console.warn("[RPG] portées :", e); }
      return true;
    }
  });

  game.settings.register("rpg", "currentWeather", {
    name: "Météo actuelle",
    scope: "world",
    config: false,
    type: String,
    default: "nuageux"  // conservé pour compat — sera ignoré au profit de activeWeathers
  });

  // Nouveau : liste de conditions météo actives (array JSON)
  game.settings.register("rpg", "activeWeathers", {
    name: "Conditions météo actives",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Terrain / Biome actif
  game.settings.register("rpg", "activeBiome", {
    name: "Terrain actuel",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // ✅ Tendance du marché par région (monde) — influence les prix au marché
  game.settings.register("rpg", "regionMarketTrend", {
    name: "Tendance du marché par région",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // ✅ Règle des diagonales — coût d'un pas en diagonale (déplacement RP)
  game.settings.register("rpg", "diagonalRule", {
    name: "Règle des diagonales (déplacement)",
    hint: "Coût d'un pas en diagonale. « Réaliste » (1,41 m) est recommandé pour du RP : marcher en biais coûte plus qu'un pas droit. Aligne aussi la réglette de mesure de Foundry.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      octile:      "📐 Réaliste — diagonale = 1,41 m (recommandé)",
      alternating: "♦️ Alterné — 1 puis 2 m (moyenne 1,5 m)",
      chebyshev:   "▫️ Simple — diagonale = 1 m"
    },
    default: "octile",
    requiresReload: false,
    onChange: () => { rpgSyncCoreDiagonals(); }
  });

  game.rpg = game.rpg ?? {};
  game.rpg.randomizeMonster = randomizeMonster;
  game.rpg.status = Status;
  game.rpg.auras = RPG_AURAS;
  game.rpg.gmAura = GM_AURA;
  game.rpg.auraRender = RPG_AURA_RENDER;
  // API couleurs d'aura par élément (feu, air, lumière, ténèbres…) — pour
  // que la macro aura (qui ne peut pas faire d'import ES) affiche la même
  // palette que le rendu automatique.
  {
    const _auraColorsModule = await import("./rules/aura-colors.js");
    game.rpg.auraColors = {
      AURA_COLOR_BY_TAG: _auraColorsModule.AURA_COLOR_BY_TAG,
      auraColorHex:      _auraColorsModule.auraColorHex
    };
  }
  game[MODULE_ID] = game[MODULE_ID] || {};
  game.rpg.measureDistance = measureDistanceManhattan;
  // API terrain (types de terrain, coût de mouvement)
  const _terrainModule = await import("./rules/region-behaviors.js");
  game.rpg.terrain = {
    getTerrainAt:          _terrainModule.getTerrainAt,
    calculateMovementCost: _terrainModule.calculateMovementCost,
    TERRAIN_TYPES:         _terrainModule.TERRAIN_TYPES
  };
  // API types de déplacement (vol, nage, etc.)
  game.rpg.movementTypes = {
    MOVEMENT_TYPES,
    getActiveMovementTypes,
    isImmuneToTerrain,
    getEffectiveSpeedMult,
    getMovementTypeLabel
  };
  // API portée de sort visuelle
  game.rpg.spellRange = { showSpellRange, showSpellRangeFromItem, clearSpellRange };
  // Rendre getTerrainAt accessible globalement pour les macros
  globalThis.getTerrainAt = _terrainModule.getTerrainAt;

  game.rpg.combat = Combat;

  // Pièges / zones à effet — exposé pour les macros (placer/interroger une
  // zone, déclencher un jet de Perception pour la détecter).
  game.rpg.zones = { getZoneEffectsAt, triggerZoneEffectsForToken, declareZonePerceptionCheck, revealZoneToActor };

  // Diagnostic de la limite de déplacement : game.rpg.debugMovement()
  try {
    const _mt = await import("./rules/movement-tracker.js");
    game.rpg.debugMovement = _mt.debugMovement;
  } catch (e) { console.warn("[RPG] diagnostic déplacement indisponible :", e); }

  // Barre d'actions — appelée par les macros créées au glisser-déposer
  game.rpg.useItemFromHotbar = useItemFromHotbar;

  // Visibilité du chat — exposée pour les macros (qui ne peuvent pas importer)
  game.rpg.chat = { gmOnly, hpSecret };

  // Actions de base (Repos…) — exposées pour un rattrapage manuel du MJ
  game.rpg.defaultActions = { grantDefaultActions, backfillDefaultActions };

  // Affichage des portées — exposé pour les fiches et la macro « Menu Combat »
  game.rpg.ranges = { showSpellRange: showSpellRangeOverlay, showTokenRanges, clearRanges, togglePinnedRanges };

  // Attaque de base (mains nues) — exposée pour la macro « Menu Combat »,
  // qui n'est pas un module ES et ne peut pas importer.
  try {
    const _unarmed = await import("./rules/unarmed.js");
    game.rpg.unarmed = {
      UNARMED_ID: _unarmed.UNARMED_ID,
      buildUnarmedWeapon: _unarmed.buildUnarmedWeapon,
      getAttackWeapon: _unarmed.getAttackWeapon,
      resolveWeapon: _unarmed.resolveWeapon
    };
  } catch (e) {
    console.warn("[RPG] API mains nues indisponible :", e);
  }

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

  // Initiative — formule volontairement SIMPLE et robuste : @init est un nombre
  // garanti fourni par getRollData() (défaut 0). Évite tout terme non résolu
  // (@effP.x undefined -> "Unresolved StringTerm undefined" au rollInitiative).
  CONFIG.Combat.initiative = {
    formula: "1d100 + @init",
    decimals: 0
  };

  // ✅ États maison dans le menu clic-droit du token (icônes Foundry natives)
  installCustomStatusEffects();

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

    // ✅ Barres de token : Foundry édite '.value' (miroir) → recopie dans
    // '.valeur' (le vrai champ stocké) et retire '.value'. Fait AVANT le
    // contrôle des droits joueur pour que l'édition de barre reste autorisée.
    const rr = changed?.system?.ressources;
    if (rr) {
      for (const r of ["pv", "mana", "fatigue"]) {
        if (rr[r] && rr[r].value !== undefined) {
          rr[r].valeur = rr[r].value;
          delete rr[r].value;
        }
      }
    }

    // ✅ Empêche la synchro automatique portrait → token
    // Quand on change img avec noTokenUpdate:true, on retire la mise à jour du token
    if (options?.noTokenUpdate && "img" in changed) {
      // On garde seulement img, on ne laisse pas Foundry synchro vers prototypeToken
      delete changed["prototypeToken"];
    }

    if (user?.isGM) return true;

    const flat = foundry.utils.flattenObject(changed);
    // Joueurs peuvent changer leur propre illustration
    const allowed = new Set([
      "system.ressources.pv.valeur",
      "system.ressources.mana.valeur",
      // Fatigue : consommee automatiquement a chaque action. Son absence ici
      // faisait rejeter l'update, donc aucune fatigue n'etait jamais appliquee
      // aux joueurs.
      "system.ressources.fatigue.valeur",
      "img"  // portrait : le propriétaire peut changer son illustration
    ]);
    return Object.keys(flat).every(k => allowed.has(k));
  });

  Hooks.once("ready", async () => {
    console.log("Spell sheetClasses:", CONFIG.Item.sheetClasses?.spell);

    // ✅ HUD Météo + Terrain — affichés en haut de l'écran pour tous
    initWeatherHUD();
    initBiomeHUD();

    // ✅ Aligne la règle de diagonale de Foundry sur le réglage RP (réaliste par défaut)
    rpgSyncCoreDiagonals();

    // ✅ Réglette de déplacement custom : coût terrain + restant du tour en direct
    try { installRPGTokenRuler(); } catch (e) { console.warn("[RPG] réglette custom:", e); }

    // ✅ Indicateur d'allonge (zone de menace) au survol d'un token
    try { installRangeOverlay(); } catch (e) { console.warn("[RPG] affichage des portées:", e); }

    // ✅ Blocage du déplacement au glisser : le token bute sur sa réserve
    try { installDragLimit(); } catch (e) { console.warn("[RPG] blocage au glisser:", e); }

    // ✅ Rendu visuel des auras (anneaux colorés en mètres, auto + manuel)
    try { RPG_AURA_RENDER.init(); } catch (e) { console.warn("[RPG] rendu des auras:", e); }

    // ✅ Barre d'actions : glisser un sort/arme depuis une fiche y crée sa macro
    try { installHotbarSupport(); } catch (e) { console.warn("[RPG] barre d'actions:", e); }

    // ✅ Permission requise pour que les sorts glissés dans la barre d'actions
    //    fonctionnent pour le rôle Joueur (voir ensureMacroScriptPermission)
    try { await ensureMacroScriptPermission(); } catch (e) { console.warn("[RPG] permission macros:", e); }

    // ✅ Actions de base (Repos…) : rattrapage sur les acteurs déjà créés
    try { await backfillDefaultActions(); }
    catch (e) { console.warn("[RPG] actions de base:", e); }

    // ✅ Thème global : pose la classe sur <body> pour que TOUTES les fenêtres
    //    (y compris les dialogues de macro) héritent des variables de thème.
    try { applyGlobalTheme(); } catch (e) { console.warn("[RPG] thème global:", e); }

    // ✅ Habille les fenêtres du système au fil de leur ouverture : les macros
    //    créent des Dialog/DialogV2 sans classe à nous, qui gardaient donc
    //    l'habillage par défaut de Foundry quel que soit le thème choisi.
    //    On ne marque QUE ce qui nous appartient (contenu reconnaissable),
    //    pour ne pas repeindre les fenêtres du cœur ou d'autres modules.
    // Marqueurs volontairement restreints : un sélecteur large comme
    // [class*='rpg-'] repeindrait la barre latérale dès qu'un de nos messages
    // apparaît dans le chat.
    const RPG_MARKERS = ".rpg-sheet, .rpg-spell-menu, .rpg-state-dialog, .rpg-window";
    const themeIfOurs = (app, el) => {
      try {
        const root = el instanceof HTMLElement ? el : (el?.[0] ?? app?.element ?? null);
        if (!root?.querySelector) return;
        // Jamais la barre latérale, le chat ni la barre de macros
        if (root.id === "sidebar" || root.closest?.("#sidebar, #chat, #hotbar")) return;

        const isOurs = root.classList?.contains("rpg-window")
                    || root.matches?.(RPG_MARKERS)
                    || !!root.querySelector(RPG_MARKERS);
        if (isOurs) themeWindow(root);
      } catch { /* habillage optionnel */ }
    };
    Hooks.on("renderApplication", themeIfOurs);
    Hooks.on("renderApplicationV2", themeIfOurs);
    Hooks.on("renderDialog", themeIfOurs);
    Hooks.on("renderDialogV2", themeIfOurs);

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

    // ✅ game.rpg.agonie : jet de Volonté obligatoire à l'agonie (≤15% PV)
    game.rpg.agonie = { hasRolledAgonieCheck, declareAgonieCheck };

    // ✅ game.rpg.skills : XP/niveau de compétences (source unique)
    game.rpg.skills = Skills;

    // ✅ game.rpg.skillCheck : jet de compétence générique (Discrétion, Crochetage...)
    game.rpg.skillCheck = { declareSkillCheck, DIFFICULTY_TIERS };

    // ✅ game.rpg.stateBuilder : construction d'état personnalisé (MJ)
    game.rpg.stateBuilder = StateBuilder;

    // ✅ game.rpg.journal : journal de campagne automatique (accessible aux macros)
    game.rpg.journal = { appendToCampaignJournal };

    // ✅ Auto-installation des macros système (GM uniquement)
    // ── Mise à jour des macros système ────────────────────────────────
    try {
      const MACRO_DEFS = [
        ["Menu Combat",                        "menu.js",               "icons/svg/sword.svg",           "all"],
        ["Lancer un Sort",                     "cast-spell.js",         "icons/svg/lightning.svg",       "all"],
        ["Jet de Compétence",                  "skill-check-macro.js",  "systems/rpg/assets/icons/dice.svg","all"],
        ["Retirer un État (jet)",              "remove-state-macro.js", "icons/svg/cancel.svg",          "all"],
        ["Forge",                              "forge.js",              "systems/rpg/assets/icons/anvil.svg","all"],
        ["Cibler la Zone",                     "target-zone.js",        "icons/svg/target.svg",          "all"],
        ["🎮 Tableau de bord MJ",               "dashboard-mj.js",       "icons/svg/clockwork.svg",       "gm"],
        ["📋 Aide-mémoire MJ",                  "aide-memoire-mj.js",    "icons/svg/book.svg",            "gm"],
        ["Appliquer un Effet (MJ)",            "apply-effect.js",       "icons/svg/lightning.svg",       "gm"],
        ["Créer un État (MJ)",                 "state-builder-macro.js","icons/svg/aura.svg",            "gm"],
        ["Survie : Repos / Blessures (MJ)",    "survival-tools.js",     "icons/svg/blood.svg",           "gm"],
        ["Météo (MJ)",                         "weather-control.js",    "icons/svg/wave.svg",            "gm"],
        ["Marché (MJ)",                        "market.js",             "systems/rpg/assets/icons/coins.svg","gm"],
        ["Réputation & Marché Régional (MJ)",  "reputation-tools.js",   "icons/svg/eye.svg",             "gm"],
        ["Position Tactique (MJ)",             "tactical-tools.js",     "icons/svg/shield.svg",          "gm"],
        ["Compétences (MJ)",                   "skills-tools.js",       "icons/svg/book.svg",            "gm"],
        ["Distribuer un Objet (MJ)",           "item-distribute.js",    "icons/svg/item-bag.svg",        "gm"],
        ["Distribuer une Recette (MJ)",        "recipe-distribute.js",  "systems/rpg/assets/icons/anvil.svg","gm"],
        ["Gérer l'Or (MJ)",                    "gold.js",               "systems/rpg/assets/icons/coins.svg","gm"],
        ["Auras (mètres)",                     "aura.js",               "icons/svg/aura.svg",            "gm"],
        ["Forcer Effets de Tour (MJ)",         "force-turn.js",         "icons/svg/regen.svg",           "gm"],
        ["Déverrouiller les Compendiums (MJ)", "unlock-compendiums.js", "icons/svg/book.svg",            "gm"],
        ["Config Token Joueurs (MJ)",          "setup-player-tokens.js","icons/svg/eye.svg",             "gm"],
      ];
      const getFolder = async (name) => {
        let f = game.folders.find(x => x.type === "Macro" && x.name === name);
        if (!f) f = await Folder.create({ name, type: "Macro", color: "#4a3f6b" });
        return f;
      };
      const folderAll = await getFolder("Macros système");
      const folderGM  = await getFolder("Macros système (MJ)");
      let created = 0, updated = 0;
      for (const [name, file, img, scope] of MACRO_DEFS) {
        const folder = scope === "gm" ? folderGM : folderAll;
        let cmd;
        try {
          const r = await fetch(`systems/rpg/module/macro/${file}?t=${Date.now()}`);
          if (!r.ok) continue;
          cmd = await r.text();
        } catch { continue; }
        const existing = game.macros.filter(m =>
          m.name === name || m.name === `RPG — ${name}` || m.name === `JDR — ${name}`
        );
        if (existing.length > 1) for (const d of existing.slice(1)) await d.delete().catch(()=>{});
        if (existing[0]) {
          await existing[0].update({ name, command: cmd, img, folder: folder.id,
            flags: { rpg: { systemMacro: true, version: "2.1.2" } } });
          updated++;
        } else {
          await Macro.create({ name, type: "script", command: cmd, img, folder: folder.id,
            flags: { rpg: { systemMacro: true, version: "2.1.2" } } });
          created++;
        }
      }
      console.log(`[RPG] Macros : ${created} créée(s), ${updated} mise(s) à jour.`);
    } catch(e) { console.error("[RPG] Erreur macros :", e); }
    // ✅ Boutons MJ dans les messages chat (sorts + attaques)
    Hooks.on("renderChatMessageHTML", (message, html) => {
      // Retire d'abord ce que le spectateur n'a pas le droit de lire
      // (verdicts en attente de validation MJ, PV des ennemis).
      try { applyChatVisibility(html); } catch (e) { }
      try { RPG_SPELLS.bindSpellChatButtons(html, message); } catch (e) { }
      try { bindAttackChatButtons(html, message); } catch (e) { }
      try { bindActionChatButtons(html, message); } catch (e) { }
      try { bindForgeChatButtons(html, message); } catch (e) { }
      try { bindSwapChatButtons(html, message); } catch (e) { }
      try { bindAgonieChatButtons(html, message); } catch (e) { }
      // ── Nouveau : bouton "Lancer le dé" (jet de compétence initié par MJ) ──
      {
        const _root = html instanceof HTMLElement ? html : html?.[0];
        _root?.querySelectorAll(".rpg-skillcheck-roll-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault(); btn.disabled = true;
            try {
              const actorId = btn.dataset.actorId, skillLabel = btn.dataset.skillLabel;
              const tn = Number(btn.dataset.tn)||11, secret = btn.dataset.secret==="true";
              const actor = game.actors.get(actorId);
              if (!actor) throw new Error("Acteur introuvable");
              const roll = await (new Roll("1d20")).evaluate();
              await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `🎲 ${actor.name} — ${skillLabel}${secret ? " 🔒" : ""}` });
              const success = roll.total >= tn;
              await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div style="font-size:13px"><b>${actor.name}</b> — <b>${skillLabel}</b><br>
                  Jet : <b>${roll.total}</b> vs TN <b>${tn}+</b>
                  ${success ? `<span style="color:#1d9e75;font-weight:700"> — ✅ Passe</span>` : `<span style="color:#c0392b;font-weight:700"> — ❌ Sous le TN</span>`}
                  <div style="display:flex;gap:8px;margin-top:8px">
                    <button type="button" class="rpg-skillcheck-resolve" data-result="fail" data-actor-id="${actorId}" data-skill-key="${btn.dataset.skillKey}" style="flex:1;padding:4px;cursor:pointer;border-radius:5px">❌ Échec</button>
                    <button type="button" class="rpg-skillcheck-resolve" data-result="success" data-actor-id="${actorId}" data-skill-key="${btn.dataset.skillKey}" style="flex:1;padding:4px;cursor:pointer;border-radius:5px;${success?"background:rgba(29,158,117,0.2)":""}">✅ Réussite</button>
                  </div></div>`,
                whisper: game.users.filter(u=>u.isGM).map(u=>u.id) });
              btn.textContent = "Lancé !";
            } catch(e){ console.error("[RPG] skillcheck roll:",e); btn.disabled=false; }
          });
        });
        _root?.querySelectorAll(".rpg-skillcheck-resolve:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          if (!game.user.isGM) { btn.style.display="none"; return; }
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const allBtns = btn.closest("div")?.querySelectorAll("button");
            allBtns?.forEach(b => b.disabled=true);
            const actorId=btn.dataset.actorId, skillKey=btn.dataset.skillKey, success=btn.dataset.result==="success";
            const actor = game.actors.get(actorId);
            if (actor && skillKey) { const {addXpToSkill}=await import("./rules/skills.js"); await addXpToSkill(actor,skillKey,success?10:3); }
            await ChatMessage.create({ content: `${success?"✅":"❌"} <b>${actor?.name??"?"}</b> — ${success?"Réussite":"Échec"}` });
          });
        });
      }
      // ── Détection de piège/zone cachée : jet de Perception (declareZonePerceptionCheck) ──
      {
        const _root = html instanceof HTMLElement ? html : html?.[0];
        _root?.querySelectorAll(".rpg-zonecheck-roll-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault(); btn.disabled = true;
            try {
              const { actorId, tn, regionId, behaviorId, sceneId } = btn.dataset;
              const actor = game.actors.get(actorId);
              if (!actor) throw new Error("Acteur introuvable");
              const roll = await (new Roll("1d20")).evaluate();
              await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `🔍 ${actor.name} — Perception` });
              const success = roll.total >= Number(tn || 11);
              await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div style="font-size:13px"><b>${actor.name}</b> — Perception<br>
                  Jet : <b>${roll.total}</b> vs TN <b>${tn}+</b>
                  ${success ? `<span style="color:#1d9e75;font-weight:700"> — ✅ Passe</span>` : `<span style="color:#c0392b;font-weight:700"> — ❌ Sous le TN</span>`}
                  <div style="display:flex;gap:8px;margin-top:8px">
                    <button type="button" class="rpg-zonecheck-resolve" data-result="fail" data-actor-id="${actorId}" style="flex:1;padding:4px;cursor:pointer;border-radius:5px">❌ Échec</button>
                    <button type="button" class="rpg-zonecheck-resolve" data-result="success" data-actor-id="${actorId}" data-region-id="${regionId}" data-behavior-id="${behaviorId}" data-scene-id="${sceneId}" style="flex:1;padding:4px;cursor:pointer;border-radius:5px;${success?"background:rgba(29,158,117,0.2)":""}">✅ Réussite</button>
                  </div></div>`,
                whisper: game.users.filter(u=>u.isGM).map(u=>u.id) });
              btn.textContent = "Lancé !";
            } catch(e){ console.error("[RPG] zonecheck roll:",e); btn.disabled=false; }
          });
        });
        _root?.querySelectorAll(".rpg-zonecheck-resolve:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          if (!game.user.isGM) { btn.style.display="none"; return; }
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const allBtns = btn.closest("div")?.querySelectorAll("button");
            allBtns?.forEach(b => b.disabled=true);
            const { actorId, result, regionId, behaviorId, sceneId } = btn.dataset;
            const actor = game.actors.get(actorId);
            const success = result === "success";
            if (!success || !actor) {
              await ChatMessage.create({ content: `${success?"✅":"❌"} <b>${actor?.name??"?"}</b> — ${success?"Réussite":"Échec"} (Perception)` });
              return;
            }
            const scene = game.scenes.get(sceneId) ?? canvas?.scene;
            const region = scene?.regions?.get(regionId);
            const behavior = region?.behaviors?.get(behaviorId);
            if (region && behavior) {
              await revealZoneToActor(region, behavior, actor);
            } else {
              await ChatMessage.create({ content: `✅ <b>${actor.name}</b> — Réussite (Perception), mais la zone visée n'existe plus.` });
            }
          });
        });
      }
      try {
        // Bouton "Lancer le d20" dans le message de sort
        const root = html instanceof HTMLElement ? html : html?.[0];
        // ─── Étape 2 : Joueur lance les dés ───────────────────────────
        root?.querySelectorAll(".rpg-dmg-roll-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = "Calcul...";
            try {
              const raw = JSON.parse(decodeURIComponent(btn.dataset.spellDmg ?? btn.dataset.dmgBlocks ?? "{}"));
              const actorId = raw.actorId ?? btn.dataset.actorId;
              const caster  = game.actors.get(actorId);
              const targets = raw.targets ?? [];

              for (const tData of targets) {
                // ✅ Pour les tokens non-liés, utiliser le tokenUuid pour l'acteur synthétique
                const target = tData.tokenUuid
                  ? (await fromUuid(tData.tokenUuid))?.actor ?? game.actors.get(tData.id)
                  : game.actors.get(tData.id);
                let totalFinal = 0;
                let siphonTotal = 0;
                const resultLines = [];

                for (const b of (tData.blocks ?? [])) {
                  let raw = Number(b.flat) || 0;
                  if (b.dice) {
                    const roll = await (new Roll(b.dice)).evaluate();
                    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: caster }),
                      flavor: `🎲 ${b.label ?? "Dégâts"} — ${b.dice}` });
                    raw += roll.total;
                  }
                  const fixe = Number(b.fixe) || 0;
                  const pct  = Number(b.pct)  || 0;
                  const afterFixe = Math.max(0, raw - fixe);
                  const finalDmg  = Math.max(1, Math.ceil(afterFixe * (1 - pct / 100)));
                  totalFinal += finalDmg;
                  // Vol de vie : calculé sur les dégâts réellement encaissés,
                  // pas sur le jet brut — voler la vie d'un coup absorbé par
                  // l'armure n'aurait pas de sens.
                  const sPct = Math.max(0, Math.min(100, Number(b.siphon) || 0));
                  if (sPct > 0) siphonTotal += Math.floor(finalDmg * sPct / 100);
                  resultLines.push(`${b.label}: brut <b>${raw}</b> → <b style="color:#c0392b">${finalDmg}</b>`);
                }

                const pvCur = tData.pvCur ?? Number(target?.system?.ressources?.pv?.valeur ?? 0);
                const pvMax = tData.pvMax ?? Number(target?.system?.ressources?.pv?.max ?? 0);
                const pvNew = Math.max(0, pvCur - totalFinal);

                // Encode les données pour la confirmation MJ
                // Vol de vie : on prépare le soin du lanceur pour qu'il soit
                // appliqué dans la MÊME validation que les dégâts.
                let siphon = null;
                if (siphonTotal > 0) {
                  const casterDoc = raw.casterUuid
                    ? (await fromUuid(raw.casterUuid).catch(() => null)) : null;
                  const casterActor = casterDoc?.actor ?? casterDoc ?? caster;
                  if (casterActor) {
                    const cCur = Number(casterActor.system?.ressources?.pv?.valeur ?? 0) || 0;
                    const cMax = Number(casterActor.system?.ressources?.pv?.max ?? 0) || 0;
                    siphon = {
                      uuid: raw.casterUuid ?? null,
                      actorId: casterActor.id,
                      name: raw.casterName ?? casterActor.name,
                      amount: siphonTotal,
                      pvCur: cCur, pvMax: cMax,
                      pvNew: cMax > 0 ? Math.min(cMax, cCur + siphonTotal) : cCur + siphonTotal
                    };
                  }
                }

                const confirmData = encodeURIComponent(JSON.stringify({
                  actorId, targetId: tData.id, tokenUuid: tData.tokenUuid ?? null, pvNew, totalFinal,
                  pvCur, pvMax, targetName: tData.name ?? target?.name ?? "?", siphon
                }));

                await ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: caster }),
                  content: `
                    <div style="font-size:13px">
                      💥 Dégâts sur <b>${tData.name ?? target?.name}</b><br>
                      ${resultLines.join("<br>")}
                      <b>Total : <span style="color:#c0392b">${totalFinal}</span> dégâts</b>
                      ${hpSecret(target, `<br>${tData.name ?? target?.name} : ${pvCur} → <b>${pvNew}</b>/${pvMax} PV`)}
                      ${siphon ? `<br>🩸 Vol de vie : <b style="color:#1d9e75">+${siphon.amount}</b> PV pour ${siphon.name}` : ""}
                      <div class="rpg-dmg-confirm-gm" style="margin-top:8px;display:flex;gap:8px">
                        <button type="button" class="rpg-dmg-confirm-btn" data-confirm="1"
                          data-spell-confirm="${confirmData}"
                          style="flex:1;padding:4px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-weight:600">
                          ✅ Appliquer
                        </button>
                        <button type="button" class="rpg-dmg-confirm-btn" data-confirm="0"
                          data-spell-confirm="${confirmData}"
                          style="flex:1;padding:4px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">
                          ❌ Annuler
                        </button>
                      </div>
                    </div>`
                });
              }
            } catch(e) {
              console.error("[RPG] Erreur lancer dégâts :", e);
              btn.disabled = false;
              btn.textContent = "🎲 Lancer les dégâts";
            }
          });
        });

        // ─── Récupération : le joueur lance, le MJ applique ───────────
        // Miroir du flux « dégâts » pour les sorts qui rendent des PV, du
        // mana ou de la fatigue (ex. Repos). Aucune mitigation ici.
        root?.querySelectorAll(".rpg-heal-roll-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = "Calcul...";
            try {
              const raw = JSON.parse(decodeURIComponent(btn.dataset.spellHeal ?? "{}"));
              const caster = game.actors.get(raw.actorId);

              for (const entry of (raw.entries ?? [])) {
                const benef = entry.tokenUuid
                  ? (await fromUuid(entry.tokenUuid))?.actor ?? game.actors.get(entry.actorId)
                  : game.actors.get(entry.actorId);
                if (!benef) continue;

                const lines = [];
                const totals = {};   // ressource → montant rendu

                for (const b of (entry.blocks ?? [])) {
                  let amount = Number(b.flat) || 0;
                  if (b.dice) {
                    const roll = await (new Roll(b.dice)).evaluate();
                    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: caster }),
                      flavor: `🎲 ${b.label ?? "Récupération"} — ${b.dice}` });
                    amount += roll.total;
                  }
                  amount = Math.max(0, amount);
                  totals[b.resource] = (totals[b.resource] ?? 0) + amount;
                  lines.push(`${b.label} : <b style="color:#1d9e75">+${amount}</b>`);
                }

                // La fatigue est un malus : « en rendre » revient à la faire
                // baisser. PV et mana montent, plafonnés à leur maximum.
                const RES_META = {
                  pv:      { icon: "❤️", path: "system.ressources.pv.valeur",      label: "PV" },
                  mana:    { icon: "🔷", path: "system.ressources.mana.valeur",    label: "Mana" },
                  fatigue: { icon: "😴", path: "system.ressources.fatigue.valeur", label: "Fatigue" }
                };
                const applied = [];
                for (const [resource, amount] of Object.entries(totals)) {
                  const meta = RES_META[resource];
                  if (!meta || amount <= 0) continue;
                  const pool = benef.system?.ressources?.[resource] ?? {};
                  const cur = Number(pool.valeur ?? 0) || 0;
                  const max = Number(pool.max ?? 0) || 0;
                  const next = resource === "fatigue"
                    ? Math.max(0, cur - amount)
                    : (max > 0 ? Math.min(max, cur + amount) : cur + amount);
                  applied.push({ resource, path: meta.path, icon: meta.icon,
                                 label: meta.label, amount, cur, next, max });
                }
                if (!applied.length) continue;

                const confirmData = encodeURIComponent(JSON.stringify({
                  actorId: entry.actorId, tokenUuid: entry.tokenUuid ?? null,
                  name: entry.name, applied
                }));

                const detail = applied.map(a =>
                  `${a.icon} <b>${a.label}</b> +${a.amount}`
                  + hpSecret(benef, ` <span style="opacity:.75">(${a.cur} → <b>${a.next}</b>${a.max ? `/${a.max}` : ""})</span>`)
                ).join("<br>");

                await ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: caster }),
                  content: `
                    <div style="font-size:13px">
                      💚 Récupération de <b>${entry.name}</b><br>
                      ${lines.join("<br>")}
                      <div style="margin-top:4px">${detail}</div>
                      <div class="rpg-heal-confirm-gm" style="margin-top:8px;display:flex;gap:8px">
                        <button type="button" class="rpg-heal-confirm-btn" data-confirm="1"
                          data-heal-confirm="${confirmData}"
                          style="flex:1;padding:4px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-weight:600">
                          ✅ Appliquer
                        </button>
                        <button type="button" class="rpg-heal-confirm-btn" data-confirm="0"
                          data-heal-confirm="${confirmData}"
                          style="flex:1;padding:4px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">
                          ❌ Annuler
                        </button>
                      </div>
                    </div>`
                });
              }
            } catch(e) {
              console.error("[RPG] Erreur lancer récupération :", e);
              btn.disabled = false;
              btn.textContent = "🎲 Lancer la récupération";
            }
          });
        });

        root?.querySelectorAll(".rpg-heal-confirm-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          if (!game.user.isGM) { btn.style.display = "none"; return; }
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            if (btn.disabled) return;
            const allBtns = btn.closest(".rpg-heal-confirm-gm")?.querySelectorAll("button");
            allBtns?.forEach(b => b.disabled = true);
            try {
              const d = JSON.parse(decodeURIComponent(btn.dataset.healConfirm ?? "{}"));
              if (btn.dataset.confirm === "1") {
                const benef = d.tokenUuid
                  ? (await fromUuid(d.tokenUuid))?.actor ?? game.actors.get(d.actorId)
                  : game.actors.get(d.actorId);
                if (benef) {
                  const updates = {};
                  for (const a of (d.applied ?? [])) updates[a.path] = a.next;
                  await benef.update(updates);
                }
                const summary = (d.applied ?? []).map(a => `${a.icon} ${a.label} +${a.amount}`).join(", ");
                await ChatMessage.create({
                  content: `✅ <b>${d.name}</b> récupère : ${summary}.`
                });
              } else {
                await ChatMessage.create({ content: `❌ Récupération annulée par le MJ.` });
              }
              btn.closest(".message-content")?.querySelectorAll("button").forEach(b => b.style.display = "none");
            } catch(e) {
              console.error("[RPG] Erreur confirmation récupération :", e);
              allBtns?.forEach(b => b.disabled = false);
            }
          });
        });

        // ─── Étape 3 : MJ valide l'application des dégâts ─────────────
        root?.querySelectorAll(".rpg-dmg-confirm-btn:not([data-bound])").forEach(btn => {
          btn.dataset.bound = "1";
          if (!game.user.isGM) { btn.style.display = "none"; return; }
          btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            if (btn.disabled) return;
            const allBtns = btn.closest(".rpg-dmg-confirm-gm")?.querySelectorAll("button");
            allBtns?.forEach(b => b.disabled = true);
            try {
              const d = JSON.parse(decodeURIComponent(btn.dataset.spellConfirm ?? "{}"));
              if (btn.dataset.confirm === "1") {
                const target = d.tokenUuid
                  ? (await fromUuid(d.tokenUuid))?.actor ?? game.actors.get(d.targetId)
                  : game.actors.get(d.targetId);
                if (target) await target.update({ "system.ressources.pv.valeur": d.pvNew });

                // Vol de vie : soigne le lanceur dans la même validation.
                let siphonLine = "";
                if (d.siphon?.amount > 0) {
                  const cDoc = d.siphon.uuid
                    ? (await fromUuid(d.siphon.uuid).catch(() => null)) : null;
                  const cActor = cDoc?.actor ?? cDoc ?? game.actors.get(d.siphon.actorId);
                  if (cActor) {
                    await cActor.update({ "system.ressources.pv.valeur": d.siphon.pvNew });
                    siphonLine = `<br>🩸 <b>${d.siphon.name}</b> draine <b>${d.siphon.amount}</b> PV.`
                               + hpSecret(cActor, ` (${d.siphon.pvCur} → <b>${d.siphon.pvNew}</b>/${d.siphon.pvMax})`);
                  }
                }

                await ChatMessage.create({
                  content: `✅ <b>${d.targetName}</b> subit <b>${d.totalFinal}</b> dégâts.`
                         + hpSecret(target, ` ${d.pvCur} PV → <b>${d.pvNew}</b>/${d.pvMax} PV`)
                         + siphonLine
                });
              } else {
                await ChatMessage.create({ content: `❌ Dégâts annulés par le MJ.` });
              }
              btn.closest(".message-content")?.querySelectorAll("button").forEach(b => b.style.display = "none");
            } catch(e) {
              console.error("[RPG] Erreur confirmation dégâts :", e);
              allBtns?.forEach(b => b.disabled = false);
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
              // Le verdict reste réservé au MJ : c'est lui qui tranche avec les
              // boutons de validation. Le joueur voit son jet, pas le résultat.
              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `🎲 <b>${actor?.name ?? "?"}</b> — ${spellName} : <b>${roll.total}</b> vs TN <b>${tn}+</b>`
                      + gmOnly(` → <b style="color:${hit ? "#1d9e75" : "#c0392b"}">${hit ? "✅ Touché !" : "❌ Raté"}</b>`)
                      + `<span style="display:block;font-size:11px;opacity:.7">En attente de la validation du MJ.</span>`
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
    Hooks.on("preUpdateToken", (tokenDoc, changes, options) => {
      // ⚠️ On DOIT renvoyer le résultat : si onPreUpdateToken renvoie false
      // (déplacement au-delà de la réserve, pas son tour, K.O.…), Foundry annule
      // le déplacement. Sans ce return, la limite de Vitesse n'était jamais appliquée.
      try {
        return onPreUpdateToken(tokenDoc, changes, options);
      } catch (e) {
        // Ne pas avaler l'erreur en silence : sans trace, une limite qui ne
        // s'applique plus est indétectable.
        console.error("[RPG] limite de déplacement :", e);
        return;
      }
    });

    Hooks.on("updateToken", async (tokenDoc, changes, options) => {
      if (!("x" in changes || "y" in changes)) return;

      // Pousse la position dans l'override aura
      const x = ("x" in changes) ? changes.x : tokenDoc.x;
      const y = ("y" in changes) ? changes.y : tokenDoc.y;
      setTokenPosOverride(tokenDoc.id, x, y);
      requestAuraRefresh(0);

      // Suivi budget déplacement (GM seulement)
      try { await onUpdateToken(tokenDoc, changes, options); } catch (e) {
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

    // ✅ Auto-refresh du Menu Combat si ouvert
    try { game.rpg?._menuRefresh?.(); } catch { /* menu fermé ou non ouvert */ }

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
        content: hpSecret(actor, `<b>Régénération</b> → +${regenPv} PV, +${regenMana} Mana`),
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

    // Foundry joint sa propre comptabilité à toute écriture : `_id` sur les
    // écritures groupées (updateEmbeddedDocuments, utilisées dès qu'équiper
    // implique d'en déséquiper un autre), `_stats` sur les mises à jour de
    // document, `sort` au réordonnancement. Les comparer à la liste blanche
    // faisait échouer l'écriture entière, en silence : c'est ce qui empêchait
    // un joueur d'équiper quoi que ce soit. Seules les clés de données
    // comptent ici.
    const isBookkeeping = (k) =>
      k === "_id" || k === "sort" || k === "_key" ||
      k.startsWith("_stats") || k.startsWith("flags.") ||
      // Foundry rappelle le type du document dans les écritures groupées, pour
      // que le bon modèle de données valide la mise à jour. On ne l'ignore que
      // s'il est INCHANGÉ : transformer une armure en arme resterait refusé.
      (k === "type" && flat[k] === doc?.type);

    const allowed = new Set([
      "system.equipe",
      // Emplacement : écrit quand le joueur équipe via les slots de sa fiche
      // (une arme passe de main droite à main gauche). Sans cette clé la
      // sélection d'emplacement échouait en silence côté joueur.
      "system.emplacement",
      "system.actif",
      "system.aura.active",
      "system.aura.enabled",
      // Recharge : c'est le SYSTÈME qui l'écrit quand le joueur lance son
      // sort. Sans ces clés, l'update etait rejetee en silence et le sort
      // restait indefiniment disponible (aucune recharge appliquee).
      "system.cooldown.restant",
      "system.cooldown.max",
      "system.recharge.restant",
      "system.recharge.max"
    ]);

    const refusees = Object.keys(flat).filter(k => !isBookkeeping(k) && !allowed.has(k));
    if (refusees.length) {
      // Un refus de hook est silencieux côté Foundry : sans cette trace, une
      // clé oubliée se manifeste par « rien ne se passe », sans explication.
      console.warn("[RPG] Écriture d'objet refusée pour un joueur — clés non autorisées :",
                   refusees, "| objet :", doc?.name, "| reçu :", changed);
      return false;
    }
    return true;
  });

  // Actions de base (Repos…) attribuées à chaque nouvel acteur
  try { installDefaultActions(); } catch (e) { console.warn("[RPG] actions de base:", e); }

  // Codex : les joueurs ne voient dans les compendiums que ce qu'ils ont eu
  try { installCodex(); } catch (e) { console.warn("[RPG] codex:", e); }

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
    try {
    if (userId !== game.userId) return;
    await RPG_AURAS?.refreshAuras?.();
      } catch(e) { console.error("[RPG] createToken:", e); }
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
  // Miroir : états maison (system.etatsActifs) → icônes de statut du token
  // Les états posés par un sort ou l'éditeur s'affichent/disparaissent tout seuls.
  // ---------------------------
  Hooks.on("updateActor", async (actor, changed, options) => {
    if (!game.user.isGM) return;
    if (changed?.system?.etatsActifs === undefined) return;
    await syncActorStatusIcons(actor);
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