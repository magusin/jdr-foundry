// systems/rpg/module/rules/spells.js
import { checkRange, fmtMeters } from "../utils/grid.js";
import { applyResistances } from "./resistances.js";
import { resistanceFor, fxResistTextParts } from "./damage-types.js";
import { computeTN } from "./combat.js";
import { getManaCostReduction, getWeatherModifierFor, getBiomeManaBonus } from "./weather-library.js";
import { hpSecret, gmOnly } from "./chat-visibility.js";
import {
  collectAttackBonuses, collectAttackBonusEffects, attackBonusText, normalizeAttackBonus
} from "./attack-bonus.js";
import { advanceCasterTowardTarget } from "./spell-move.js";

/* ------------------------------------------------------------ */
/* Utils                                                        */
/* ------------------------------------------------------------ */

/**
 * Quantité par tour d'un état accordé par un bonus d'attaque.
 *
 * Même calcul que `upsertHitState` côté arme (attack-resolve.js) : base +
 * (stat du porteur ÷ per), figée au moment du coup, positive pour des dégâts
 * et négative pour un soin. Les deux chemins doivent donner le MÊME nombre —
 * c'est le même effet, seule la façon de le déclencher change.
 */
function grantedTick(effect, actor) {
  const effP = actor?.system?.derived?.effective?.principales
            ?? actor?.system?.principales ?? {};
  const stat = String(effect?.dot?.stat ?? "").trim();
  const per  = Math.max(1, Number(effect?.dot?.per) || 10);
  const base = Math.abs(Number(effect?.dot?.base) || 0);
  const bonus = stat ? Math.floor((Number(effP?.[stat]) || 0) / per) : 0;
  const mode = String(effect?.dot?.mode ?? "none");
  if (mode === "damage") return base + bonus;
  if (mode === "heal")   return -(base + bonus);
  return 0;
}

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function fromUuidSafeTop(uuid) {
  try {
    if (!uuid) return null;
    return await fromUuid(uuid);
  } catch (e) {
    return null;
  }
}

/**
 * Contenu du message public (visible de tous), phase par phase :
 * - "pending"      : en attente de validation MJ, pas de jet possible
 * - "awaitingRoll" : validé, bouton "Lancer le d20" pour le joueur
 * - "ready"         : jet fait (ou pas nécessaire), en attente du verdict MJ
 * - "rejected"      : refusé par le MJ
 */
function spellPublicContent(d, phase) {
  let footer;
  if (phase === "pending") {
    footer = `<div style="opacity:.8"><i>En attente de validation MJ.</i></div>`;
  } else if (phase === "awaitingRoll") {
    footer = `
      <div style="opacity:.8;margin-bottom:6px"><i>Validé par le MJ — lance ton jet de touché.</i></div>
      <button type="button" class="rpg-roll-d20-btn"
        data-actor-id="${d.actorId}" data-tn="${d.tnFinal}" data-spell="${htmlEsc(d.itemName)}"
        style="width:100%;padding:6px 8px;cursor:pointer;border-radius:6px;font-weight:600">
        🎲 Lancer le d20
      </button>`;
  } else if (phase === "ready") {
    footer = `<div style="opacity:.8"><i>Validé par le MJ — en attente du verdict.</i></div>`;
  } else {
    footer = `<div style="opacity:.75"><b>❌ Sort refusé par le MJ.</b></div>`;
  }
  return `<div class="rpg-spell-declare">${d.bodyHtml ?? ""}${footer}</div>`;
}

/** Contenu du message MJ (whisper), phase par phase — voir spellPublicContent. */
function spellGmContent(d, phase) {
  const header = `<div style="font-size:11px;color:#c8960a;font-weight:600;margin-bottom:6px">`
               + `⚙️ ${phase === "ready" ? "Validation MJ — " : ""}${htmlEsc(d.actorName)} → ${htmlEsc(d.itemName)}</div>`;

  if (phase === "pending") {
    return `<div class="rpg-spell-declare rpg-spell-gm">${header}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="rpg-spell-confirm" data-ok="1"
          style="flex:1;padding:4px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-weight:600">✅ Valider</button>
        <button type="button" class="rpg-spell-confirm" data-ok="0"
          style="flex:1;padding:4px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">❌ Annuler</button>
      </div></div>`;
  }

  if (phase === "awaitingRoll") {
    return `<div class="rpg-spell-declare rpg-spell-gm">${header}
      <div style="opacity:.8;font-size:12px"><i>Validé — en attente du jet du joueur.</i></div></div>`;
  }

  if (phase === "ready") {
    const failButtons = d.noFailOption ? "" : `
        <button type="button" class="rpg-spell-resolve" data-result="critfail" style="color:#8b1a12;font-weight:700">Échec Critique</button>
        <button type="button" class="rpg-spell-resolve" data-result="fail">Échec</button>`;
    const successLabel = d.noFailOption ? "Touché" : "Réussite";
    const critLabel = d.noFailOption ? "Critique" : "Réussite Crit";

    // ── Multi-cible : le MJ tranche cible par cible ─────────────────────
    // Un seul d20 a été lancé ; chaque cible a son propre seuil. On pré-coche
    // celles que le jet atteint (d20 >= TN, ou aucune opposition), mais rien
    // n'est verrouillé : la case reste décochable/cochable, c'est le MJ qui a
    // le dernier mot. Seules les cibles cochées subissent dégâts et effets.
    const list = Array.isArray(d.targetTNs) ? d.targetTNs : [];
    let targetsBlock = "";
    if (list.length > 1) {
      const d20 = Number(d.d20);
      const hasRoll = Number.isFinite(d20);
      const rows = list.map((t, i) => {
        const auto    = !!t.autoSuccess;
        const reached = auto || !hasRoll || d20 >= Number(t.tn);
        const verdict = auto
          ? `<span style="opacity:.7">aucun jet</span>`
          : `seuil <b>${Number(t.tn)}+</b>`
            + (hasRoll
                ? ` → <b style="color:${reached ? "#1d9e75" : "#c0392b"}">${reached ? "atteint" : "raté"}</b>`
                : ``);
        return `<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer">
          <input type="checkbox" class="rpg-spell-target-hit"
            data-uuid="${htmlEsc(t.uuid ?? "")}" data-idx="${i}" ${reached ? "checked" : ""}>
          <span><b>${htmlEsc(t.name ?? "?")}</b> — ${verdict}</span>
        </label>`;
      });
      targetsBlock = `
        <div class="rpg-spell-targets" style="margin-bottom:8px;font-size:12px">
          <div style="font-weight:600;margin-bottom:2px">
            🎯 Cibles touchées${hasRoll ? ` <span style="opacity:.75">(d20 = ${Number(d.d20)})</span>` : ``} :
          </div>
          ${rows.join("")}
          <div style="font-size:11px;opacity:.7;margin-top:2px">Décoche une cible pour qu'elle soit épargnée.</div>
        </div>`;
    }

    return `<div class="rpg-spell-declare rpg-spell-gm">${header}
      ${targetsBlock}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${failButtons}
        <button type="button" class="rpg-spell-resolve" data-result="success">${successLabel}</button>
        <button type="button" class="rpg-spell-resolve" data-result="crit">${critLabel}</button>
      </div></div>`;
  }

  // "rejected"
  return `<div class="rpg-spell-declare rpg-spell-gm">${header}
    <div style="font-size:12px;opacity:.75">❌ Refusé.</div></div>`;
}

/** Retourne la liste des userIds GM pour les whispers MJ-only */
function gmUserIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

const SPELL_FAIL_MESSAGES = [
  "{target} résiste au sort de {actor} !",
  "Le sort de {actor} est bloqué par {target} !",
  "La magie de {actor} se dissipe sans effet !",
  "{actor} perd le contrôle du sort au dernier moment !",
  "{target} esquive le sort de justesse !",
  "L'incantation de {actor} échoue à se former !"
];

function pickSpellFailMessage(actorName, targetName) {
  const list = SPELL_FAIL_MESSAGES;
  const tpl = list[Math.floor(Math.random() * list.length)];
  return tpl.replace("{actor}", actorName).replace("{target}", targetName || "la cible");
}

/**
 * Confirme le slot de budget (pending -> confirmed) pour un actionId donné.
 * Utilisé pour réussite ET échec — l'action a été tentée, le slot doit
 * sortir de l'état "pending" dans tous les cas.
 * extraSnapshot (optionnel) : fusionné dans le snapshot du log (ex: addedStates
 * pour permettre le retrait des effets posés lors d'une annulation MJ).
 */
async function confirmBudgetSlot(actionId, extraSnapshot = null) {
  if (!actionId || !game.combat) return;
  try {
    const { updateLogEntry, confirmSlot, getBudget, saveBudget, findLogEntry } = await import("./action-budget.js");
    const found = findLogEntry(game.combat, actionId);
    if (found) {
      const { combatantId } = found;
      const budget    = getBudget(game.combat, combatantId);
      const slot      = found.entry.slot ?? "sortNormal";
      const newBudget = confirmSlot(budget, slot);
      await saveBudget(game.combat, combatantId, newBudget);

      const updates = { status: "confirmed" };
      if (extraSnapshot) updates.snapshot = { ...(found.entry.snapshot ?? {}), ...extraSnapshot };
      await updateLogEntry(game.combat, actionId, updates);
    }
  } catch (e) { /* ignore si pas de budget actif */ }
}

/**
 * Augmente la fatigue du lanceur (action confirmée = effort magique).
 */
async function bumpFatigue(actor, amount = 1) {
  if (!actor) return;
  try {
    const { incrementFatigue } = await import("./action-budget.js");
    await incrementFatigue(actor, Math.max(0, Number(amount) || 0));
  } catch (e) { /* ignore */ }
}

async function fromUuidSafe(uuid) {
  try {
    if (!uuid) return null;
    return await fromUuid(uuid);
  } catch (e) {
    return null;
  }
}

function str(v, d = "") {
  const s = String(v ?? d).trim();
  return s;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Qui un effet ou une aura touche. `target`, `self`, `allies`… sont des CLÉS
 * techniques : écrites telles quelles dans une carte de chat ou sur la fiche de
 * personnage, elles s'affichaient en anglais au milieu d'une interface
 * française (« [Touché • target] », « Aura — Cible: allies »).
 */
const FX_TARGET_LABELS = {
  target: "cible", self: "soi",
  allies: "alliés", enemies: "ennemis", both: "tout le monde"
};
const fxTargetLabel = (t) => FX_TARGET_LABELS[String(t ?? "").toLowerCase()] ?? t;

/** « magique » / « physique » accordés au pluriel (« dégâts magiques »). */
const livraisonLabel = (l) => (String(l ?? "magique") === "physique" ? "physiques" : "magiques");

/**
 * Bénéficiaire d'un effet secondaire, tel qu'annoncé dans le chat.
 * Miroir exact du dispatch de applyEffectsFor() : « cible(s) » est le défaut,
 * y compris pour une valeur inconnue, pour ne jamais annoncer autre chose que
 * ce qui sera réellement appliqué.
 */
export function fxApplyLabel(target) {
  const t = String(target ?? "target").toLowerCase();
  if (t === "self" || t === "caster") return "sur le lanceur";
  if (t === "both" || t === "selftarget") return "sur le lanceur + la/les cible(s)";
  return "sur la/les cible(s)";
}

function getEffP(actor) {
  return actor?.system?.derived?.effective?.principales
    ?? actor?.system?.derived?.effP
    ?? actor?.system?.principales
    ?? {};
}

function normalizeDiceStr(s) {
  const v = String(s ?? "").trim();
  if (!v || v === "0" || v === "—" || v.toLowerCase() === "none") return "";
  return v;
}

function computeFlatScaling({ actor, scaling }) {
  const sc = scaling ?? {};
  const statKey = String(sc.stat ?? "intelligence");
  const perRaw = n(sc.per, 0);
  const perStep = n(sc.perStep, 0);

  if (perRaw <= 0 || perStep === 0) return { scaled: 0, statKey, per: perRaw, perStep, statVal: 0 };

  const effP = getEffP(actor);
  const statVal = n(effP?.[statKey], 0);
  const per = Math.max(1, perRaw);
  const steps = Math.floor(Math.max(0, statVal) / per);
  const scaled = steps * perStep;

  return { scaled, statKey, per, perStep, statVal };
}

function hasAnyDamageBlock(dmg) {
  if (!dmg || typeof dmg !== "object") return false;

  const enabled = !!dmg.enabled;
  const dice = normalizeDiceStr(dmg.dice);
  const flat = n(dmg.flat, 0);

  const sc = dmg.scaling ?? {};
  const per = n(sc.per, 0);
  const perStep = n(sc.perStep, 0);

  // Si pas enabled, on considère "pas de dégâts"
  if (!enabled) return false;

  // S’il est enabled mais tout vide/0 => on considère pas de dégâts pour affichage
  const hasDice = !!dice;
  const hasFlat = flat !== 0;
  const hasScaling = (per > 0 && perStep !== 0);

  return hasDice || hasFlat || hasScaling;
}

/**
 * Retourne { expr, flatTotal } ou null si pas de dégâts à afficher.
 * - Ne lance PAS les dés, juste une formule lisible.
 * - Applique le scaling (stat/per/perStep) sur le flat.
 */
function computeDamageExpr({ actor, block }) {
  // block = { enabled, dice, flat, scaling{stat,per,perStep} }
  if (!block || !block.enabled) return null;

  const dice = String(block.dice ?? "").trim();
  const flatBase = n(block.flat, 0);

  const scaling = block.scaling ?? {};
  const statKey = String(scaling.stat ?? "intelligence");
  const per = Math.max(1, n(scaling.per, 10) || 10);
  const perStep = n(scaling.perStep, 0);

  const effP = getEffP(actor);
  const statVal = n(effP?.[statKey], 0);
  const steps = Math.floor(Math.max(0, statVal) / per);
  const scaled = steps * perStep;

  const flatTotal = flatBase + scaled;

  // "0", "—", "", etc => pas de dés
  const diceOk = dice && dice !== "0" && dice !== "—";

  // si rien du tout => null (donc n'affiche pas)
  if (!diceOk && flatTotal === 0) return null;

  if (!diceOk) return { expr: `${flatTotal}` };

  return { expr: flatTotal ? `${dice} + ${flatTotal}` : `${dice}` };
}

function summarizeModsWithKind(mods = {}) {
  const parts = [];
  let hasPlus = false;
  let hasMinus = false;

  for (const [k, v] of Object.entries(mods)) {
    const flat = n(v?.flat, 0);
    const pct = n(v?.pct, 0);

    if (flat > 0 || pct > 0) hasPlus = true;
    if (flat < 0 || pct < 0) hasMinus = true;

    if (flat) parts.push(`${labelStat(k)} ${flat > 0 ? "+" : ""}${flat}`);
    if (pct) parts.push(`${labelStat(k)} ${pct > 0 ? "+" : ""}${pct}%`);
  }

  const summary = parts.join(" • ");
  if (!summary) return null;

  let kind = "buff";
  if (hasMinus && !hasPlus) kind = "debuff";
  else if (hasPlus && !hasMinus) kind = "buff";
  else kind = "mixed"; // si tu veux éviter mixed, on le traitera comme buff (ou debuff). Ici on le garde interne.

  return { kind, summary };
}

/**
 * Valeur par tour d'un effet secondaire, SIGNÉE pour le moteur de tour :
 * positive = dégâts, négative = soin.
 *
 * Source : fx.tick { mode:"none"|"damage"|"heal", flat, stat, per, perStep }
 * où `flat` est toujours positif — c'est `mode` qui donne le sens.
 * Replis successifs sur les anciens formats : dot{}/hot{} séparés, puis
 * l'ancien champ unique signé damage.flat.
 */
function tickPerTick(fx, effP) {
  const scaled = (blk) => {
    if (!blk) return 0;
    const stat = String(blk.stat ?? "").trim();
    const per = Math.max(1, n(blk.per, 10) || 10);
    const perStep = n(blk.perStep, 0);
    const bonus = stat ? Math.floor(n(effP?.[stat], 0) / per) * perStep : 0;
    return n(blk.flat, 0) + bonus;
  };

  const t = fx?.tick;
  if (t && typeof t === "object" && t.mode) {
    if (t.mode === "none") return 0;
    const total = Math.abs(scaled(t));
    return t.mode === "heal" ? -total : total;
  }

  // Anciens formats
  const dotHas = fx?.dot && (n(fx.dot.flat, 0) !== 0 || n(fx.dot.perStep, 0) !== 0);
  const hotHas = fx?.hot && (n(fx.hot.flat, 0) !== 0 || n(fx.hot.perStep, 0) !== 0);
  if (dotHas || hotHas) return scaled(fx.dot) - scaled(fx.hot);

  return n(fx?.damage?.flat, 0);
}

function effectsForResult(item, result) {
  const arr = Array.isArray(item?.system?.effectsUI) ? item.system.effectsUI : [];
  const res = String(result);

  // Un effet ne part QUE sur une touche validée par le MJ. Un sort raté ne
  // pose rien : ni sur la cible, ni sur le lanceur. Échec et échec critique
  // ne retiennent donc aucun effet — pas même « au lancement », qui partait
  // auparavant quel que soit le résultat et posait des états sur un sort qui
  // n'avait rien touché.
  if (res !== "success" && res !== "crit") return [];

  const allowWhen = new Set();
  // "hit"     = toute touche réussie, critique compris
  // "hitonly" = touche normale seulement (exclu sur un critique)
  // "crit"    = critique uniquement
  // "cast"    = ancienne valeur « au lancement (même sur échec) ». L'option
  //             n'existe plus sur la fiche ; les sorts déjà écrits avec elle
  //             sont traités comme "hit" plutôt qu'ignorés en silence — leur
  //             effet part toujours, mais désormais seulement s'ils touchent.
  allowWhen.add("cast");
  if (res === "success") { allowWhen.add("hit"); allowWhen.add("hitonly"); }
  if (res === "crit")    { allowWhen.add("hit"); allowWhen.add("crit"); }

  return arr.filter(fx => allowWhen.has(String(fx?.when ?? "hit").toLowerCase()));
}

function classifyMods(mods = {}) {
  let pos = 0;
  let neg = 0;

  for (const v of Object.values(mods)) {
    const flat = n(v?.flat, 0);
    const pct = n(v?.pct, 0);

    if (flat > 0) pos++;
    if (flat < 0) neg++;
    if (pct > 0) pos++;
    if (pct < 0) neg++;
  }

  if (pos > 0 && neg === 0) return "buff";
  if (neg > 0 && pos === 0) return "debuff";
  if (pos > 0 && neg > 0) return "mixed";
  return "none";
}

function labelBuffDebuff(mods) {
  const k = classifyMods(mods);
  if (k === "buff") return "Buffs";
  if (k === "debuff") return "Debuffs";
  if (k === "mixed") return "Buffs/Debuffs";
  return "";
}

function getActorToken(actor) {
  // prefer controlled token, else first active token
  return canvas?.tokens?.controlled?.find(t => t.actor?.id === actor.id)
    ?? actor.getActiveTokens?.()[0]
    ?? null;
}

function getTokenById(tokenId) {
  if (!tokenId) return null;
  return canvas?.tokens?.get(tokenId) ?? null;
}

// ✅ devient async et applique le patch

async function ensureSpellDefaults(item) {
  const sys = item.system ?? {};
  const patch = {};

  // range
  if (!sys.range || typeof sys.range !== "object") patch["system.range"] = { min: 0, max: 6 };
  else {
    if (sys.range.min === undefined) patch["system.range.min"] = 0;
    if (sys.range.max === undefined) patch["system.range.max"] = 6;
  }

  // targetCount
  if (!sys.targetCount || typeof sys.targetCount !== "object") patch["system.targetCount"] = { min: 1, max: 1 };
  else {
    if (sys.targetCount.min === undefined) patch["system.targetCount.min"] = 1;
    if (sys.targetCount.max === undefined) patch["system.targetCount.max"] = 1;
  }

  // cooldown
  if (!sys.cooldown || typeof sys.cooldown !== "object") patch["system.cooldown"] = { max: 0, restant: 0 };
  else {
    if (sys.cooldown.max === undefined) patch["system.cooldown.max"] = 0;
    if (sys.cooldown.restant === undefined) patch["system.cooldown.restant"] = 0;
  }

  // aura
  if (!sys.aura || typeof sys.aura !== "object") {
    patch["system.aura"] = {
      active: false,
      enabled: false,
      target: "allies",
      key: "",
      range: { min: 0, max: 3 },
      dotFlat: 0,
      cleanseDC: 0
    };
  } else {
    if (sys.aura.active === undefined) patch["system.aura.active"] = false;
    if (sys.aura.enabled === undefined) patch["system.aura.enabled"] = false;
    if (sys.aura.target === undefined) patch["system.aura.target"] = "allies";
    if (sys.aura.key === undefined) patch["system.aura.key"] = "";
    if (!sys.aura.range || typeof sys.aura.range !== "object") patch["system.aura.range"] = { min: 0, max: 3 };
    else {
      if (sys.aura.range.min === undefined) patch["system.aura.range.min"] = 0;
      if (sys.aura.range.max === undefined) patch["system.aura.range.max"] = 3;
    }
    if (sys.aura.dotFlat === undefined) patch["system.aura.dotFlat"] = 0;
    if (sys.aura.cleanseDC === undefined) patch["system.aura.cleanseDC"] = 0;
  }

  // --- DAMAGE (success)
  if (sys.damage === undefined || typeof sys.damage !== "object") {
    patch["system.damage"] = {
      enabled: false,
      flat: 0,
      dice: "",
      scaling: { stat: "intelligence", per: 10, perStep: 0 }
    };
  } else {
    if (sys.damage.enabled === undefined) patch["system.damage.enabled"] = false;
    if (sys.damage.flat === undefined) patch["system.damage.flat"] = 0;
    if (sys.damage.dice === undefined) patch["system.damage.dice"] = "";
    if (!sys.damage.scaling || typeof sys.damage.scaling !== "object") patch["system.damage.scaling"] = { stat: "intelligence", per: 10, perStep: 0 };
    else {
      if (sys.damage.scaling.stat === undefined) patch["system.damage.scaling.stat"] = "intelligence";
      if (sys.damage.scaling.per === undefined) patch["system.damage.scaling.per"] = 10;
      if (sys.damage.scaling.perStep === undefined) patch["system.damage.scaling.perStep"] = 0;
    }
  }

  // --- DAMAGE CRIT (separate)
  if (sys.damageCrit === undefined || typeof sys.damageCrit !== "object") {
    patch["system.damageCrit"] = {
      enabled: false,
      flat: 0,
      dice: "",
      scaling: { stat: "intelligence", per: 10, perStep: 0 }
    };
  } else {
    if (sys.damageCrit.enabled === undefined) patch["system.damageCrit.enabled"] = false;
    if (sys.damageCrit.flat === undefined) patch["system.damageCrit.flat"] = 0;
    if (sys.damageCrit.dice === undefined) patch["system.damageCrit.dice"] = "";
    if (!sys.damageCrit.scaling || typeof sys.damageCrit.scaling !== "object") patch["system.damageCrit.scaling"] = { stat: "intelligence", per: 10, perStep: 0 };
    else {
      if (sys.damageCrit.scaling.stat === undefined) patch["system.damageCrit.scaling.stat"] = "intelligence";
      if (sys.damageCrit.scaling.per === undefined) patch["system.damageCrit.scaling.per"] = 10;
      if (sys.damageCrit.scaling.perStep === undefined) patch["system.damageCrit.scaling.perStep"] = 0;
    }
  }

  // ── Migration : ancien bloc unique system.damage / system.damageCrit ────
  // Ces deux blocs ne sont plus éditables sur la fiche (remplacés par les
  // lignes system.damages[]), mais la résolution les applique toujours : un
  // sort créé avant la refonte inflige donc des dégâts que le MJ ne voit
  // nulle part et ne peut plus corriger. On les convertit en une ligne
  // normale, puis on les désactive — le sort garde exactement la même
  // puissance, mais elle devient visible et modifiable.
  const legacy     = sys.damage;
  const legacyCrit = sys.damageCrit;
  const legacyDice = String(legacy?.dice ?? "").trim();
  const hasLegacy  = !!legacy?.enabled && (
    (legacyDice && legacyDice !== "0") ||
    n(legacy.flat, 0) !== 0 ||
    n(legacy.scaling?.perStep, 0) !== 0
  );
  if (hasLegacy) {
    const lines = Array.isArray(sys.damages) ? foundry.utils.deepClone(sys.damages) : [];
    lines.push({
      id: foundry.utils.randomID(),
      dice:    legacyDice || "0",
      flat:    n(legacy.flat, 0),
      stat:    String(legacy.scaling?.stat ?? ""),
      per:     Math.max(1, n(legacy.scaling?.per, 10) || 10),
      perStep: n(legacy.scaling?.perStep, 0),
      // Bloc crit désactivé côté ancien format = aucun dégât sur critique.
      // On reprend ici les valeurs normales plutôt que de conserver ce trou :
      // un critique qui fait moins qu'une réussite normale n'a jamais été
      // voulu, c'était un effet de bord de l'ancien découpage.
      critDice: legacyCrit?.enabled ? String(legacyCrit.dice ?? "").trim() : "",
      critFlat: legacyCrit?.enabled ? n(legacyCrit.flat, 0) : n(legacy.flat, 0),
      siphon: 0,
      livraison: String(sys.livraison ?? "magique")
    });
    patch["system.damages"] = lines;
    patch["system.damage.enabled"] = false;
    patch["system.damageCrit.enabled"] = false;
  }

  // effectsUI default
  if (sys.effectsUI === undefined) patch["system.effectsUI"] = [];
  if (sys.coutMana === undefined) patch["system.coutMana"] = 0;
  if (sys.difficulte === undefined) patch["system.difficulte"] = 0;
  if (sys.moveSelf === undefined) patch["system.moveSelf"] = 0;
  if (sys.speed === undefined) patch["system.speed"] = "normal";
  if (sys.livraison === undefined) patch["system.livraison"] = "magique";

  if (Object.keys(patch).length) await item.update(patch);
}

/* ------------------------------------------------------------ */
/* FX parsing                                                    */
/* ------------------------------------------------------------ */

const STAT_LABELS = {
  force: "Force",
  dexterite: "Dextérité",
  intelligence: "Intelligence",
  acuite: "Acuité",
  endurance: "Endurance",
  pvMax: "PV max",
  manaMax: "Mana max",
  regenPv: "Régén PV",
  regenMana: "Régén Mana",
  vitesse: "Vitesse",
  scoreArmure: "Score Armure",
  scoreResistance: "Score Résistance",
  armureFixe: "Armure fixe",
  resistanceFixe: "Résistance fixe"
};

function labelStat(k) {
  return STAT_LABELS[k] ?? k;
}

function getFxByWhen(item, when) {
  const arr = Array.isArray(item?.system?.effectsUI) ? item.system.effectsUI : [];
  return arr.filter(fx => String(fx?.when ?? "").toLowerCase() === String(when).toLowerCase());
}

function buildModsFromFxMods(fxMods) {
  const mods = {};
  const mds = Array.isArray(fxMods) ? fxMods : [];
  for (const m of mds) {
    const stat = String(m?.stat ?? "").trim();
    if (!stat) continue;
    const mode = (m?.mode === "pct") ? "pct" : "flat";
    const v = n(m?.value, 0);
    if (!mods[stat]) mods[stat] = { flat: 0, pct: 0 };
    mods[stat][mode] += v;
  }
  return mods;
}

function summarizeMods(mods = {}) {
  const label = (k) => ({
    force: "Force",
    dexterite: "Dextérité",
    intelligence: "Intelligence",
    acuite: "Acuité",
    endurance: "Endurance",
    pvMax: "PV max",
    manaMax: "Mana max",
    regenPv: "Régén PV",
    regenMana: "Régén Mana",
    vitesse: "Vitesse",
    scoreArmure: "Score Armure",
    scoreResistance: "Score Résistance",
    armureFixe: "Armure fixe",
    resistanceFixe: "Résistance fixe",
    podsMax: "Pods max",
    initiativeMod: "Initiative",
    toucherPhysique: "Toucher physique",
    toucherMagique: "Toucher magique",
    fatigueMax: "Fatigue max"
  }[k] ?? k);

  const parts = [];
  for (const [k, v] of Object.entries(mods)) {
    const flat = n(v?.flat, 0);
    const pct = n(v?.pct, 0);
    if (flat) parts.push(`${label(k)} ${flat > 0 ? "+" : ""}${flat}`);
    if (pct) parts.push(`${label(k)} ${pct > 0 ? "+" : ""}${pct}%`);
  }
  return parts.join(" • ");
}

/** hit (success) or crit: pick first matching, fallback to other */
function pickFx(item, result) {
  const fxCrit = getFxByWhen(item, "crit")[0] ?? null;
  const fxHit = getFxByWhen(item, "hit")[0] ?? null;
  if (result === "crit") return fxCrit ?? fxHit;
  return fxHit ?? fxCrit;
}

/* ------------------------------------------------------------ */
/* Damage preview (no roll)                                      */
/* ------------------------------------------------------------ */

function computeDamageSimple({ actor, item }) {
  const sys = item.system ?? {};
  const dmg = sys.damage ?? {};


  // ✅ normalise le champ dice : "0" => vide
  const diceRaw = String(dmg.dice ?? "").trim();
  const dice = (diceRaw === "0" || diceRaw === "—" || diceRaw.toLowerCase() === "none") ? "" : diceRaw;

  const flatBase = n(dmg.flat, 0);

  const scaling = dmg.scaling ?? {};
  const statKey = String(scaling.stat ?? "intelligence");

  // ✅ per=0 veut dire "pas de scaling"
  const perRaw = n(scaling.per, 0);
  const perStep = n(scaling.perStep, 0);

  const hasScaling = perRaw > 0 && perStep !== 0;

  let scaled = 0;
  if (hasScaling) {
    const per = Math.max(1, perRaw);
    const effP = getEffP(actor);
    const statVal = n(effP?.[statKey], 0);
    const steps = Math.floor(Math.max(0, statVal) / per);
    scaled = steps * perStep;
  }

  const flatTotal = flatBase + scaled;

  // ✅ "aucun dégât" si :
  // - pas de dé réel
  // - ET flatTotal = 0
  // (et on considère aussi "1d6" comme placeholder)
  const isNoDice = !dice || dice === "1d6";
  if (isNoDice && flatTotal === 0) {
      return null;
  }

  // ✅ expr final
  let expr = "";
  if (dice && flatTotal) expr = `${dice} + ${flatTotal}`;
  else if (dice) expr = `${dice}`;
  else expr = `${flatTotal}`;

  return { dice, flatTotal, expr };
}

function shouldShowDamagePreview(dmg) {
  if (!dmg) return false;

  const dice = String(dmg.dice ?? "").trim();
  const flat = Number(dmg.flatTotal ?? 0) || 0;

  // dé réel = non vide ET pas placeholder
  const hasRealDice = dice && dice !== "1d6";

  // flat réel
  const hasRealFlat = flat !== 0;

  return hasRealDice || hasRealFlat;
}

/* ------------------------------------------------------------ */
/* UI helpers (sheet)                                            */
/* ------------------------------------------------------------ */

export function buildSpellUI({ actor, item }) {
  if (!item || item.type !== "spell") return { text: {} };

  const sys = item.system ?? {};
  const cdMax = n(sys.cooldown?.max, 0);
  const cdRest = n(sys.cooldown?.restant, 0);

  const rangeMin = n(sys.range?.min, 0);
  const rangeMax = n(sys.range?.max, 0);

  // L'aura d'un sort vient de ses EFFETS (fx.isAura) — l'ancien bloc
  // system.aura n'est plus éditable et ne pose plus rien. La pastille « Aura »
  // de la liste de sorts se lisait pourtant uniquement sur lui : elle
  // manquait donc sur tous les sorts d'aura créés depuis la refonte.
  const fxAura = (Array.isArray(sys.effectsUI) ? sys.effectsUI : []).find(fx => fx?.isAura) ?? null;
  const auraEnabled = !!fxAura || !!(sys.aura?.enabled || sys.aura?.active);
  const auraMin = fxAura ? n(fxAura.auraMin, 0) : n(sys.aura?.range?.min, 0);
  const auraMax = fxAura ? n(fxAura.auraMax, 0) : n(sys.aura?.range?.max, 0);
  const auraTarget = fxTargetLabel(fxAura ? str(fxAura.auraTarget, "allies") : str(sys.aura?.target, "allies"));

  const _manaCostBase  = n(sys.coutMana, 0);
  const _tag           = sys.tag ?? "neutre";
  const _weatherReduc  = getManaCostReduction(_tag);
  const _biomeReduc    = getBiomeManaBonus(_tag);
  const manaCost = Math.max(0, _manaCostBase + _weatherReduc + _biomeReduc);
  const speed = str(sys.speed, "normal");
  const diff = n(sys.difficulte, 0);

  // IMPORTANT: modsSummary = HIT ONLY (jamais hit+crit)
  const fxHit = getFxByWhen(item, "hit")[0] ?? null;
  const hitMods = fxHit ? buildModsFromFxMods(fxHit.mods) : {};
  const modsSummary = summarizeMods(hitMods);

  // Natures du sort, pour le filtrage des listes (« kinds » séparés par |)
  const kinds = new Set();
  if ((Array.isArray(sys.damages) && sys.damages.length) || sys.damage?.enabled) kinds.add("damage");
  // Une ligne de récupération EST un soin : sans ça, le filtre « soin » de la
  // liste de sorts ne trouvait que les soins par tour (HOT), jamais un soin
  // direct — c'est-à-dire l'immense majorité d'entre eux.
  if (Array.isArray(sys.restores) && sys.restores.length) kinds.add("heal");
  for (const fx of (Array.isArray(sys.effectsUI) ? sys.effectsUI : [])) {
    const mode = String(fx?.tick?.mode ?? "");
    if (mode === "damage") kinds.add("damage");
    if (mode === "heal")   kinds.add("heal");
    if (fx?.isAura) kinds.add("aura");
    for (const m of (Array.isArray(fx?.mods) ? fx.mods : [])) {
      const v = n(m?.value, 0);
      if (v > 0) kinds.add("buff");
      if (v < 0) kinds.add("debuff");
    }
  }
  if (auraEnabled) kinds.add("aura");

  return {
    text: {
      speed,
      tag: _tag,
      kinds: Array.from(kinds).join("|"),
      coutMana: manaCost,
      difficulte: diff,
      rangeMin,
      rangeMax,
      onCooldown: cdRest > 0,
      cdRestant: cdRest,
      cdMax,
      auraEnabled,
      auraMin,
      auraMax,
      auraTarget,
      modsSummary
    }
  };
}

/* -------------------------------------------- */
/* ✅ DECLARE (castSpell)                         */
/* -------------------------------------------- */

export async function castSpell(actor, item, { targetToken = null, casterToken = null } = {}) {
  if (!actor || !item) return { ok: false, reason: "Missing actor/item" };
  if (item.type !== "spell") return { ok: false, reason: "Not a spell" };

  await ensureSpellDefaults(item);
  const sys = item.system ?? {};

  const cdRest = n(sys.cooldown?.restant, 0);
  const cdMax = n(sys.cooldown?.max, 0);
  if (cdRest > 0) return { ok: false, reason: `Sort en recharge : ${cdRest} tour(s)` };

  const casterT = casterToken ?? actor.getActiveTokens()?.[0] ?? canvas.tokens.controlled?.[0] ?? null;
  const targetT = targetToken ?? Array.from(game.user.targets)[0] ?? null;
  const targetActor = targetT?.actor ?? null;

  // portée si cible
  const rmin = n(sys.range?.min, 0);
  const rmax = n(sys.range?.max, 0);
  if (casterT && targetT) {
    const r = checkRange(casterT, targetT, rmin, rmax);
    if (!r.ok) {
      return { ok: false, reason: `Hors portée (${fmtMeters(r.dist)}, ${rmin}–${rmax} m)` };
    }
  }

  // mana
  const _manaCostBase  = n(sys.coutMana, 0);
  const _tag           = sys.tag ?? "neutre";
  const _weatherReduc  = getManaCostReduction(_tag);
  const _biomeReduc    = getBiomeManaBonus(_tag);
  const manaCost = Math.max(0, _manaCostBase + _weatherReduc + _biomeReduc);
  const manaCur = n(actor.system?.ressources?.mana?.valeur, 0);
  if (manaCost > 0 && manaCur < manaCost) return { ok: false, reason: "Mana insuffisant" };
  if (manaCost > 0) await actor.update({ "system.ressources.mana.valeur": Math.max(0, manaCur - manaCost) });

  // CD
  if (cdMax > 0) await item.update({ "system.cooldown.restant": cdMax, "system.recharge.restant": cdMax });

  const speaker = ChatMessage.getSpeaker({ actor, token: casterT?.document ?? undefined });

  // ✅ stocker des UUID (PJ + monstres + tokens non-linkés)
  const actorUuid = actor.uuid;
  const itemUuid = item.uuid;
  const targetTokenUuid = targetT?.document?.uuid ?? null;
  const casterTokenUuid = casterT?.document?.uuid ?? null;

  const publicContent = `
  <div class="rpg-spell-declare">
    <div><b>${actor.name}</b> déclare <b>${item.name}</b>${targetActor ? ` sur <b>${targetActor.name}</b>` : ""} (mana -${manaCost}, CD=${cdMax}).</div>
    <div style="opacity:.8;margin-top:4px;"><i>En attente de validation MJ.</i></div>
  </div>`;

  const gmContent = `
  <div class="rpg-spell-declare rpg-gm-panel">
    <div style="font-size:11px;color:#c8960a;font-weight:600;margin-bottom:4px">⚙️ Validation MJ — ${actor.name} → ${item.name}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="rpg-spell-resolve" data-result="fail">Refuser</button>
      <button type="button" class="rpg-spell-resolve" data-result="success">Valider</button>
      <button type="button" class="rpg-spell-resolve" data-result="crit">Valider Crit</button>
    </div>
  </div>`;

  // Message public (tout le monde voit)
  const msg = await ChatMessage.create({
    speaker,
    content: publicContent,
    flags: {
      rpg: {
        spellDeclare: { actorUuid, itemUuid, targetTokenUuid, casterTokenUuid, actionId: actionId ?? null }
      }
    }
  });

  // Message séparé en whisper MJ avec les boutons de validation
  await ChatMessage.create({
    speaker,
    content: gmContent,
    whisper: gmUserIds(),
    flags: {
      rpg: {
        spellDeclare: { actorUuid, itemUuid, targetTokenUuid, casterTokenUuid, actionId: actionId ?? null }
      }
    }
  });

  return { ok: true, messageId: msg.id };
}

const PREVIEW_WHEN_LABELS = {
  hit: "Touché + crit", hitonly: "Touché normal", crit: "Crit uniquement",
  // Ancien « au lancement (même sur échec) » : se comporte comme "hit"
  // depuis qu'un effet ne part plus jamais sur un échec.
  cast: "Touché + crit"
};

/**
 * Aperçu des effets d'un sort pour la liste de sorts d'une fiche.
 *
 * Liste TOUS les effets. L'ancienne version n'en montrait que deux — le
 * premier « touché » et le premier « crit » — donc un sort à trois buffs n'en
 * affichait qu'un, et un effet « touché normal uniquement » ou « au
 * lancement » n'apparaissait jamais. Elle ajoutait par ailleurs une ligne
 * « Aura » lue sur l'ancien bloc system.aura, qui ne pose aucune aura : les
 * auras réelles sont portées par les effets (fx.isAura) et sont donc
 * désormais décrites dans la ligne de leur propre effet.
 */
export function buildSpellEffectsPreview({ actor, item }) {
  if (!item || item.type !== "spell") return [];

  const sys = item.system ?? {};
  const list = [];

  for (const fx of (Array.isArray(sys.effectsUI) ? sys.effectsUI : [])) {
    const parts = [];
    const perTick = tickPerTick(fx, getEffP(actor));
    if (perTick > 0) parts.push(`💥 ${perTick} dégâts/tour`);
    else if (perTick < 0) parts.push(`💚 ${Math.abs(perTick)} soin/tour`);

    const modSummary = summarizeMods(buildModsFromFxMods(fx.mods));
    if (modSummary) parts.push(modSummary);

    if (fx.isAura) {
      parts.push(`🌀 Aura ${n(fx.auraMin, 0)}–${n(fx.auraMax, 0)} m (${fxTargetLabel(str(fx.auraTarget, "allies"))})`);
    }

    // Résistances accordées : même formulation que la fiche de sort et que
    // la liste des états actifs d'un acteur (damage-types.js).
    parts.push(...fxResistTextParts(fx).all);

    // Bonus de dégâts accordé aux attaques (partie 8 de l'effet) : même
    // formateur que la fiche de sort, la fiche de personnage et le chat.
    const atkTxt = attackBonusText({
      scope: fx.atkScope, categories: fx.atkCategories,
      flat: fx.atkFlat, pct: fx.atkPct, dice: fx.atkDice,
      livraison: fx.atkLivraison, tag: fx.atkTag
    });
    if (atkTxt) parts.push(atkTxt);

    list.push({
      label: str(fx.label, "Effet"),
      when: PREVIEW_WHEN_LABELS[String(fx.when ?? "hit").toLowerCase()] ?? str(fx.when, "Touché"),
      target: fxApplyLabel(fx.target).replace(/^sur /, ""),
      duration: fx.permanent ? "permanent" : (n(fx.duration, 0) ? `${n(fx.duration, 0)} tours` : ""),
      summary: parts.join(" • ")
    });
  }

  // Liste vide = pas d'aperçu du tout. Les fiches masquent le bloc quand la
  // liste est vide ; une ligne « Aucun effet » remplissait l'écran de cadres
  // vides pour tous les sorts qui n'en ont pas.
  return list;
}

/* ------------------------------------------------------------ */
/* State helpers (v2 format)                                     */
/* ------------------------------------------------------------ */

function normalizeState(st, forcedId = null) {
  const out = foundry.utils.deepClone(st ?? {});
  out.id = String(forcedId || out.id || foundry.utils.randomID());

  out.label = str(out.label, "État");
  out.type = str(out.type, "custom");
  out.isAura = !!out.isAura;

  out.duration = Math.max(1, n(out.duration, 1));
  out.remaining = clamp(n(out.remaining, out.duration), 0, 999999);
  out.cleanseDC = Math.max(0, n(out.cleanseDC, 0));

  out.dot = out.dot ?? {};
  out.dot.flat = n(out.dot.flat, 0);
  out.dot.formula = str(out.dot.formula, "");
  out.dot.perTick = n(out.dot.perTick, out.dot.flat);

  out.mods = out.mods ?? {};

  if (out.isAura) {
    out.aura = out.aura ?? {};
    out.aura.key = str(out.aura.key, out.label);
    out.aura.min = Math.max(0, n(out.aura.min, 0));
    out.aura.max = Math.max(0, n(out.aura.max, 0));
    out.aura.target = str(out.aura.target, "allies");
    out.aura.linkedItemId = str(out.aura.linkedItemId, "");
  }

  return out;
}

async function upsertState(actor, state) {
  const adjusted = applyResistances(actor, state);

  if (adjusted?._resisted) {
    return { resisted: true, resistanceInfo: adjusted.resistanceInfo };
  }

  const list = Array.isArray(actor.system?.etatsActifs) ? foundry.utils.deepClone(actor.system.etatsActifs) : [];
  const id = String(adjusted.id || foundry.utils.randomID());
  const idx = list.findIndex(e => String(e.id) === id);
  const normalized = normalizeState(adjusted, id);
  if (idx >= 0) list[idx] = { ...list[idx], ...normalized };
  else list.push(normalized);

  await actor.update({ "system.etatsActifs": list });
  if (game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);

  return { resisted: false, resistanceInfo: adjusted.resistanceInfo };
}

/* ------------------------------------------------------------ */
/* Distances / range check                                       */
/* ------------------------------------------------------------ */

/* La mesure de portée vit dans utils/grid.js (checkRange) : elle est en
   mètres, partagée avec le menu de combat et la fiche de monstre, et calée
   sur le cercle réellement dessiné sur le canevas. */

/* ------------------------------------------------------------ */
/* WORKFLOW CENTRALISE : declare -> chat buttons -> resolve      */
/* ------------------------------------------------------------ */

/**
 * DECLARE = immédiat après annonce :
 * - check portée (si cible)
 * - consomme mana
 * - lance CD
 * - poste message chat avec boutons MJ
 * - n'applique aucun effet ici
 *
 * Compatible PJ + monstre (tous sont Actor)
 */
export async function declareSpell(actor, item, { casterToken = null, targetToken = null, actionId = null } = {}) {
  if (!actor || !item) return { ok: false, reason: "Missing actor/item" };
  if (item.type !== "spell") return { ok: false, reason: "Not a spell" };

  await ensureSpellDefaults(item);

  const sys = item.system ?? {};

  // Sort passif : ne passe jamais par declareSpell — toujours actif
  if (sys.speed === "passif") return { ok: false, reason: "Sort passif — toujours actif, pas de déclaration" };

  const cdRest = n(sys.cooldown?.restant, 0);
  const cdMax  = n(sys.cooldown?.max, 0);
  if (cdRest > 0) return { ok: false, reason: `Sort en recharge : ${cdRest} tour(s)` };

  const casterT = casterToken ?? getActorToken(actor);

  // ✅ Multi-cible : si targetToken explicite, une seule cible (compat menu.js attaque) ;
  // sinon on prend TOUS les tokens actuellement ciblés (game.user.targets)
  // Les deux listes doivent rester ALIGNÉES index par index : un token sans
  // acteur filtré d'un seul côté décalait toutes les paires suivantes (la
  // cible n°2 recevait le seuil/les résistances de la n°3). On filtre donc
  // les paires, jamais une des deux listes isolément.
  const targetPairs = (targetToken ? [targetToken] : Array.from(game.user.targets))
    .map(t => ({ token: t, actor: t?.actor ?? null }))
    .filter(p => p.actor);
  const targetTokens = targetPairs.map(p => p.token);
  const targetActors = targetPairs.map(p => p.actor);
  const targetActor  = targetActors[0] ?? null; // rétrocompat (effets self/caster n'en ont pas besoin)

  // ── Validation nombre de cibles ───────────────────────────────────────
  const tcMin = n(sys.targetCount?.min, 1);
  const tcMax = n(sys.targetCount?.max, 1);
  const tcCount = targetTokens.length;

  // Rappel du geste : viser plusieurs tokens n'a rien d'évident dans Foundry
  // (outil Ciblage ✛ de la barre d'outils Token, clic = 1 cible, Maj+clic pour
  // en ajouter). Sans ce rappel, le refus ressemblait à un bug du sort.
  const HOW_TO_TARGET = "outil Ciblage ✛ : clic sur la 1re cible, Maj+clic sur les suivantes";
  if (tcMin > 0 || tcMax > 0) {
    if (tcCount < tcMin) {
      return { ok: false, reason: `Ce sort nécessite au moins ${tcMin} cible(s) — ${tcCount} visée(s) (${HOW_TO_TARGET})` };
    }
    if (tcMax > 0 && tcCount > tcMax) {
      return { ok: false, reason: `Ce sort ne prend que ${tcMax} cible(s) maximum — ${tcCount} visée(s) : retire des cibles (Maj+clic) avant de lancer` };
    }
  }

  // ── Portée : vérifie TOUTES les cibles ────────────────────────────────
  if (casterT && targetTokens.length) {
    const rmin = n(sys.range?.min, 0);
    const rmax = n(sys.range?.max, 0);
    for (const tT of targetTokens) {
      const r = checkRange(casterT, tT, rmin, rmax);
      if (!r.ok) {
        const why = r.tooClose ? "trop près" : "hors portée";
        return { ok: false, reason: `${tT.actor?.name ?? tT.name} ${why} (${fmtMeters(r.dist)}, ${rmin}–${rmax} m)` };
      }
    }
  }

  // mana
  const _manaCostBase  = n(sys.coutMana, 0);
  const _tag           = sys.tag ?? "neutre";
  const _weatherReduc  = getManaCostReduction(_tag);
  const _biomeReduc    = getBiomeManaBonus(_tag);
  const manaCost = Math.max(0, _manaCostBase + _weatherReduc + _biomeReduc);
  const manaCur  = n(actor.system?.ressources?.mana?.valeur, 0);
  if (manaCost > 0 && manaCur < manaCost) return { ok: false, reason: "Mana insuffisant" };
  if (manaCost > 0) await actor.update({ "system.ressources.mana.valeur": Math.max(0, manaCur - manaCost) });

  // CD
  if (cdMax > 0) await item.update({ "system.cooldown.restant": cdMax, "system.recharge.restant": cdMax });

  // --- Résumés (déclare) : on affiche ce qui existe
  const dmgHit = computeDamageExpr({ actor, block: sys.damage });
  const dmgCrit = computeDamageExpr({ actor, block: sys.damageCrit });

  const fxAll     = Array.isArray(sys.effectsUI) ? sys.effectsUI : [];
  const whenOf    = (f) => String(f?.when ?? "hit").toLowerCase();
  // "cast" est l'ancienne valeur « au lancement (même sur échec) » : elle se
  // comporte maintenant comme "hit", donc elle est annoncée avec elle plutôt
  // que dans une rubrique séparée qui promettrait un déclenchement sur échec.
  const fxHit     = fxAll.filter(f => whenOf(f) === "hit" || whenOf(f) === "cast");
  const fxHitOnly = fxAll.filter(f => whenOf(f) === "hitonly");
  const fxCrit    = fxAll.filter(f => whenOf(f) === "crit");

  const summarizeFxList = (list) => {
    if (!list?.length) return null;

    const lines = [];
    for (const fx of list) {
      const mods = buildModsFromFxMods(fx.mods);
      const modInfo = summarizeModsWithKind(mods);

      const parts = [];
      const perTick = tickPerTick(fx, getEffP(actor));
      if (perTick > 0) parts.push(`💥 ${perTick} dégâts/tour`);
      else if (perTick < 0) parts.push(`💚 ${Math.abs(perTick)} soin/tour`);
      if (fx.isAura) parts.push(`🌀 Aura ${n(fx.auraMin, 0)}–${n(fx.auraMax, 0)} m (${fxTargetLabel(str(fx.auraTarget, "allies"))})`);
      if (modInfo?.summary) parts.push(`${modInfo.kind === "debuff" ? "⬇️ Debuff" : "⬆️ Buff"}: ${modInfo.summary}`);

      // si l'effet n'a rien, on ne l'affiche pas
      if (!parts.length) continue;

      // Sur qui il tombe : sans cette mention, un buff pour le lanceur et un
      // malus pour la cible s'affichaient exactement de la même façon.
      const onWhom = fxApplyLabel(fx.target);
      lines.push(`<li><b>${str(fx.label, "Effet")}</b> <span style="opacity:.75">(${onWhom})</span> — ${parts.join(" • ")}</li>`);
    }
    if (!lines.length) return null;
    return `<ul style="margin:6px 0 0 18px;">${lines.join("")}</ul>`;
  };

  /**
   * Formule lisible d'une ligne (dégâts ou récupération) : dés + plat +
   * apport de la stat du lanceur, déjà chiffré. Les lignes system.damages[] /
   * system.restores[] n'étaient jusqu'ici annoncées NULLE PART à la
   * déclaration — seuls les anciens blocs system.damage l'étaient — donc un
   * sort moderne s'annonçait sans un mot sur ce qu'il allait faire.
   */
  const lineFormula = (b) => {
    const statKey  = String(b.stat ?? "").trim();
    const per      = Math.max(1, n(b.per, 10) || 10);
    const perStep  = n(b.perStep, 0);
    const statBonus = statKey ? Math.floor(n(getEffP(actor)?.[statKey], 0) / per) * perStep : 0;
    const flat     = n(b.flat, 0) + statBonus;
    const dice     = String(b.dice ?? "").trim();
    const parts    = [];
    if (dice && dice !== "0") parts.push(dice);
    if (flat) parts.push(`${flat}`);
    return parts.join(" + ");
  };

  const damageLines = (Array.isArray(sys.damages) ? sys.damages : []).map(d => {
    const f = lineFormula(d);
    if (!f) return null;
    const siphon = n(d.siphon, 0);
    return `💥 <b>Dégâts ${livraisonLabel(d.livraison)}</b> : ${f}`
         + (siphon > 0 ? ` <span style="opacity:.75">(vol de vie ${siphon} %)</span>` : "");
  }).filter(Boolean);

  const RES_DECL = { pv: "❤️ PV rendus", mana: "🔷 Mana rendu", fatigue: "😴 Fatigue rendue" };
  const restoreLines = (Array.isArray(sys.restores) ? sys.restores : []).map(r => {
    const f = lineFormula(r);
    if (!f) return null;
    const who = String(r.cible ?? "self");
    const whoTxt = who === "target" ? "cible(s)" : (who === "both" ? "soi + cible(s)" : "soi");
    return `<b>${RES_DECL[String(r.resource ?? "pv")] ?? "✨ Récupération"}</b> (${whoTxt}) : ${f}`;
  }).filter(Boolean);

  // NB : l'ancien bloc system.aura (aura « du sort ») n'est plus annoncé ici.
  // Il n'est plus éditable sur la fiche et ne posait aucune aura à la
  // résolution : seule une aura portée par un EFFET (fx.isAura, résumé
  // ci-dessus par summarizeFxList) en crée une réellement. L'annoncer donnait
  // au joueur une aura qui n'existait pas.

  const speaker = ChatMessage.getSpeaker({ actor, token: casterT?.document ?? undefined });

  const actorUuid = actor.uuid;
  const itemUuid = item.uuid;
  const casterTokenUuid = casterT?.document?.uuid ?? null;
  const targetTokenUuids = targetTokens.map(t => t?.document?.uuid).filter(Boolean);
  const targetNamesList = targetActors.map(a => a.name).join(", ");

  // ── Seuil de touché : UN PAR CIBLE ────────────────────────────────────
  // Chaque cible a ses propres stats (et sa propre distance au lanceur), donc
  // son propre seuil. N'en calculer qu'un sur la première cible faisait juger
  // le mage en robe et le chevalier en plates au même seuil — celui de la
  // cible visée en premier, au petit bonheur de l'ordre de ciblage.
  // Le JET, lui, reste unique : un seul d20 est comparé à chacun des seuils.
  // Sans cible, le sort porte sur le lanceur : computeTN traite ce cas comme
  // une cible amie, sans comparaison de stats — la difficulté saisie sur la
  // fiche est alors le seuil lui-même.
  const tnFor = (tActor, tTok) => {
    try {
      return computeTN(actor, tActor, item, { attackerToken: casterT, targetToken: tTok ?? null });
    } catch (e) { return null; }   // pas grave si ça échoue
  };

  /** @type {{uuid:string|null,name:string,tn:number,autoSuccess:boolean,friendly:boolean}[]} */
  const targetTNs = targetPairs.map(({ actor: tActor, token: tTok }) => {
    const info = tnFor(tActor, tTok);
    return {
      uuid: tTok?.document?.uuid ?? null,
      name: tActor.name,
      tn: n(info?.tnFinal, 11),
      autoSuccess: !!info?.autoSuccess,
      friendly: !!info?.friendly
    };
  });

  // Sans cible : seuil du lanceur sur lui-même, gardé hors de targetTNs (il
  // n'y a personne à cocher côté MJ, et rien à toucher).
  const selfInfo = targetTNs.length ? null : tnFor(actor, casterT);

  // Un jet de touché est nécessaire dès qu'AU MOINS une cible s'y oppose : un
  // sort qui soigne un allié (auto) et brûle un ennemi (jet) doit être lancé.
  const needsRoll = targetTNs.length
    ? targetTNs.some(t => !t.autoSuccess)
    : !(selfInfo?.autoSuccess);

  const diffNote = (friendly) => friendly
    ? `<div style="font-size:11px;opacity:.7">(difficulté ${n(sys.difficulte, 0)} du sort — la cible ne s'y oppose pas)</div>`
    : (sys.difficulte
        ? `<div style="font-size:11px;opacity:.7">(difficulté +${n(sys.difficulte, 0)} déjà incluse dans le TN)</div>`
        : ``);

  let tnLine;
  if (!targetTNs.length) {
    // Aucune cible : le sort porte sur le lanceur.
    tnLine = selfInfo?.autoSuccess
      ? `🌀 <b>Action sur soi</b> — aucun jet de touché`
      : (selfInfo
          ? `🎯 <b>Jet de touché</b> : il faut faire `
            + `<b style="color:#e05a00;font-size:1.1em">${selfInfo.tnFinal}+</b> sur 1d20`
            + diffNote(selfInfo.friendly)
          : `🎯 <b>Jet de touché</b> : fais ton jet`
            + (sys.difficulte ? ` (difficulté +${n(sys.difficulte, 0)})` : ``));
  } else if (targetTNs.length === 1) {
    const t = targetTNs[0];
    tnLine = t.autoSuccess
      ? `🌿 <b>Action bienveillante</b> — aucun jet, le sort prend effet`
      : `🎯 <b>Jet de touché</b> : il faut faire `
        + `<b style="color:#e05a00;font-size:1.1em">${t.tn}+</b> sur 1d20`
        + diffNote(t.friendly);
  } else {
    // Multi-cible : un seuil par cible, annoncé AVANT le jet pour que le
    // joueur sache d'un coup d'œil ce qu'il lui faut pour toucher chacune.
    const rows = targetTNs.map(t => t.autoSuccess
      ? `<li><b>${htmlEsc(t.name)}</b> — <span style="color:#1d9e75;font-weight:700">aucun jet</span>`
        + `<span style="opacity:.7;font-size:11px"> (ne s'y oppose pas)</span></li>`
      : `<li><b>${htmlEsc(t.name)}</b> — il faut `
        + `<b style="color:#e05a00">${t.tn}+</b></li>`);
    tnLine = `🎯 <b>Jet de touché</b> — <b>un seul d20</b> pour toutes les cibles :`
           + `<ul style="margin:4px 0 0 18px">${rows.join("")}</ul>`
           + (sys.difficulte
               ? `<div style="font-size:11px;opacity:.7">(difficulté +${n(sys.difficulte, 0)} déjà incluse dans chaque seuil)</div>`
               : ``);
  }

  const bodyHtml = `
    <div>
      <b>${actor.name}</b> déclare <b>${item.name}</b>
      ${targetNamesList ? ` sur <b>${targetNamesList}</b>` : ""}
      (mana -${manaCost}, CD=${cdMax})
    </div>

    <div style="opacity:.9;margin-top:4px;">
      ${tnLine}
    </div>

    <div style="margin-top:8px;">
      ${dmgHit?.expr ? `💥 <b>Dégâts (réussite)</b> : ${dmgHit.expr}<br>` : ``}
      ${dmgCrit?.expr ? `💥 <b>Dégâts (crit)</b> : ${dmgCrit.expr}<br>` : ``}
      ${damageLines.map(l => `${l}<br>`).join("")}
      ${restoreLines.map(l => `${l}<br>`).join("")}
    </div>

    ${summarizeFxList(fxHit)  ? `<div style="margin-top:6px;"><b>Effets (touché + crit)</b>${summarizeFxList(fxHit)}</div>`   : ``}
    ${summarizeFxList(fxHitOnly) ? `<div style="margin-top:6px;"><b>Effets (touché normal uniquement)</b>${summarizeFxList(fxHitOnly)}</div>` : ``}
    ${summarizeFxList(fxCrit) ? `<div style="margin-top:6px;"><b>Effets (crit uniquement)</b>${summarizeFxList(fxCrit)}</div>`     : ``}

    <hr style="margin:8px 0;opacity:.2"/>`;

  // Repos (action de base) ne peut jamais échouer : souffler ne se rate pas.
  // Le MJ ne tranche donc qu'entre Touché (récupération normale) et Critique
  // (récupération renforcée), sans option Échec / Échec Critique.
  const noFailOption = item.getFlag?.("rpg", "defaultActionKey") === "repos";

  const d = {
    bodyHtml,
    actorName: actor.name,
    itemName: item.name,
    actorId: actor.id,
    needsRoll,
    noFailOption,
    // tnFinal reste le seuil de la 1re cible (compat des messages/flags déjà
    // postés) ; targetTNs est la vraie liste, seuil par cible.
    tnFinal: targetTNs[0]?.tn ?? n(selfInfo?.tnFinal, 11),
    targetTNs,
    manaCost, cdMax,
    actorUuid, itemUuid, casterTokenUuid, targetTokenUuids,
    actionId: actionId ?? null,
    d20: null
  };

  const msg = await ChatMessage.create({
    speaker,
    content: spellPublicContent(d, "pending"),
    flags: { rpg: { spellDeclare: { ...d, phase: "pending" } } }
  });

  const gmMsg = await ChatMessage.create({
    speaker,
    content: spellGmContent(d, "pending"),
    whisper: gmUserIds(),
    flags: { rpg: { spellDeclare: { ...d, phase: "pending", linkedPublicId: msg.id } } }
  });

  await msg.update({ "flags.rpg.spellDeclare.linkedGmId": gmMsg.id });

  return { ok: true, messageId: msg.id };
}

/**
 * Le MJ valide ou annule la déclaration (avant tout jet de touché).
 * Sur annulation, rembourse mana/cooldown et libère le slot de budget réservé.
 */
export async function confirmSpellDeclaration(message, approve) {
  if (!game.user.isGM) return;

  const flags = message?.flags?.rpg ?? {};
  const d = flags.spellDeclare ?? {};
  const publicMsg = d.linkedPublicId ? game.messages.get(d.linkedPublicId) : null;

  if (!approve) {
    const actor = d.actorUuid ? await fromUuidSafeTop(d.actorUuid) : null;
    const item  = d.itemUuid  ? await fromUuidSafeTop(d.itemUuid)  : null;

    if (actor && n(d.manaCost, 0) > 0) {
      const cur = n(actor.system?.ressources?.mana?.valeur, 0);
      await actor.update({ "system.ressources.mana.valeur": cur + n(d.manaCost, 0) });
    }
    if (item && n(d.cdMax, 0) > 0) {
      await item.update({ "system.cooldown.restant": 0, "system.recharge.restant": 0 });
    }
    if (d.actionId && game.combat) {
      try {
        const { findLogEntry, getBudget, saveBudget, releaseSlot, updateLogEntry } = await import("./action-budget.js");
        const found = findLogEntry(game.combat, d.actionId);
        if (found) {
          const budget = getBudget(game.combat, found.combatantId);
          await saveBudget(game.combat, found.combatantId, releaseSlot(budget, found.entry.slot ?? "sortNormal", false));
          await updateLogEntry(game.combat, d.actionId, { status: "rejected" });
        }
      } catch (e) { /* ignore si pas de budget actif */ }
    }

    await message.update({ content: spellGmContent(d, "rejected"), "flags.rpg.spellDeclare.phase": "rejected" });
    if (publicMsg) await publicMsg.update({ content: spellPublicContent(d, "rejected"), "flags.rpg.spellDeclare.phase": "rejected" });
    return;
  }

  const nextPhase = d.needsRoll ? "awaitingRoll" : "ready";
  await message.update({ content: spellGmContent(d, nextPhase), "flags.rpg.spellDeclare.phase": nextPhase });
  if (publicMsg) await publicMsg.update({ content: spellPublicContent(d, nextPhase), "flags.rpg.spellDeclare.phase": nextPhase });
}

/**
 * Le joueur lance son jet de touché, une fois la déclaration validée par le MJ.
 * Révèle ensuite les boutons de verdict sur le message MJ lié.
 */
export async function rollSpellDie(message) {
  const flags = message?.flags?.rpg ?? {};
  const d = flags.spellDeclare ?? {};
  if (d.phase !== "awaitingRoll" || !d.needsRoll) return;

  const actor = game.actors.get(d.actorId);
  const tn = Number(d.tnFinal) || 11;
  const roll = await (new Roll("1d20")).evaluate();

  // UN SEUL d20, comparé au seuil de CHAQUE cible. Le détail par cible reste
  // sous gmOnly() comme le verdict simple l'était déjà : annoncer publiquement
  // qui est touché avant que le MJ ait tranché révélerait le résultat.
  const list = Array.isArray(d.targetTNs) ? d.targetTNs : [];
  let head;
  let detail;
  if (list.length > 1) {
    head = `🎲 <b>${actor?.name ?? "?"}</b> — ${htmlEsc(d.itemName ?? "Sort")} : <b>${roll.total}</b> sur 1d20`;
    const rows = list.map(t => {
      const auto    = !!t.autoSuccess;
      const reached = auto || roll.total >= Number(t.tn);
      return `<div>${htmlEsc(t.name ?? "?")} — ${auto ? "aucun jet" : `${Number(t.tn)}+`} `
           + `<b style="color:${reached ? "#1d9e75" : "#c0392b"}">${reached ? "✅ touché" : "❌ raté"}</b></div>`;
    });
    detail = gmOnly(`<div style="font-size:11px;margin-top:2px">${rows.join("")}</div>`);
  } else {
    const hit = roll.total >= tn;
    head = `🎲 <b>${actor?.name ?? "?"}</b> — ${htmlEsc(d.itemName ?? "Sort")} : <b>${roll.total}</b> vs TN <b>${tn}+</b>`;
    detail = gmOnly(` → <b style="color:${hit ? "#1d9e75" : "#c0392b"}">${hit ? "✅ Touché !" : "❌ Raté"}</b>`);
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: head + detail
          + `<span style="display:block;font-size:11px;opacity:.7">En attente de la validation du MJ.</span>`
  });

  const newD = { ...d, d20: roll.total };
  await message.update({
    content: spellPublicContent(newD, "ready"),
    "flags.rpg.spellDeclare": { ...newD, phase: "ready" }
  });

  const gmMsg = d.linkedGmId ? game.messages.get(d.linkedGmId) : null;
  if (gmMsg) {
    await gmMsg.update({
      content: spellGmContent(newD, "ready"),
      "flags.rpg.spellDeclare": { ...newD, phase: "ready" }
    });
  }
}

/**
 * Bind des boutons MJ dans le chat (centralisé)
 */
export async function resolveDeclaredSpellFromMessage(message, result, opts = {}) {
  if (!game.user.isGM) return;

  const data =
    message?.getFlag?.("rpg", "spellDeclare") ??
    message?.flags?.rpg?.spellDeclare ??
    null;

  if (!data) return ui.notifications.warn("Impossible : flags manquants sur le message.");

  const actor = data.actorUuid ? await fromUuidSafe(data.actorUuid) : null;
  const item  = data.itemUuid  ? await fromUuidSafe(data.itemUuid)  : null;

  if (!actor || !item) return ui.notifications.warn("Impossible : actor ou sort introuvable (UUID).");

  await ensureSpellDefaults(item);

  const sys = item.system ?? {};
  const res = String(result ?? "success");

  // ✅ Support multi-cible : targetTokenUuids (array) avec fallback targetTokenUuid (legacy, 1 seule cible)
  const uuidList = Array.isArray(data.targetTokenUuids) && data.targetTokenUuids.length
    ? data.targetTokenUuids
    : (data.targetTokenUuid ? [data.targetTokenUuid] : []);

  // Paires token+acteur, gardées ALIGNÉES (cf. declareSpell) : filtrer une des
  // deux listes seule décalerait résistances et seuils d'une cible à l'autre.
  const allPairs = [];
  for (const uuid of uuidList) {
    const doc = await fromUuidSafe(uuid);
    const tok = doc?.object ?? null;
    if (tok?.actor) allPairs.push({ uuid, token: tok, actor: tok.actor });
  }

  // ── Cibles retenues par le MJ ────────────────────────────────────────
  // opts.hitUuids vient des cases à cocher du message MJ (multi-cible) : un
  // seul d20 a été lancé, mais chaque cible avait son propre seuil et le MJ
  // tranche pour chacune. Absent (cible unique, ou message posté avant cette
  // version) → toutes les cibles sont touchées, comportement d'origine.
  //
  // Échec / Échec Critique sont des verdicts GLOBAUX : le sort rate dans son
  // ensemble et ne pose plus rien sur personne (effectsForResult renvoie une
  // liste vide, et aucune ligne de dégâts n'est produite). Les cases n'ont
  // donc plus rien à filtrer ; on garde la liste complète pour que le message
  // d'échec nomme bien toutes les cibles visées.
  const perTarget = (res !== "fail" && res !== "critfail");
  const hitUuids = (perTarget && Array.isArray(opts.hitUuids)) ? opts.hitUuids : null;
  const pairs       = hitUuids ? allPairs.filter(p => hitUuids.includes(p.uuid)) : allPairs;
  const missedPairs = hitUuids ? allPairs.filter(p => !hitUuids.includes(p.uuid)) : [];

  const targetTokens = pairs.map(p => p.token);
  const targetActors = pairs.map(p => p.actor);
  const missedNames  = missedPairs.map(p => p.actor.name);

  // Jeton du lanceur : nécessaire pour viser le bon acteur synthétique quand
  // le lanceur est un token non lié (monstre posé sur la scène).
  const casterToken = data.casterTokenUuid
    ? (await fromUuidSafe(data.casterTokenUuid))?.object ?? null
    : null;

  // Rétrocompat : variables singulières utilisées pour les effets "self/caster"
  // Le déplacement du lanceur (charge) vise la 1re cible DÉCLARÉE, touchée ou
  // non : il est appliqué hors du branchement sur le verdict (voir plus bas),
  // donc il ne peut pas dépendre des cases cochées par le MJ. C'est le seul
  // usage d'une « première cible » ici — tout le reste boucle sur les paires.
  const chargeToken = allPairs[0]?.token ?? null;
  const chargeActor = allPairs[0]?.actor ?? null;

  const targetNames = targetActors.map(a => a.name).join(", ") || null;

  // Le message public (déclaration) est distinct de ce message MJ — il faut
  // le nettoyer aussi, sinon son "en attente du verdict" reste affiché
  // indéfiniment une fois le sort résolu.
  const publicMsg = data.linkedPublicId ? game.messages.get(data.linkedPublicId) : null;
  const deletePublicMsg = () => publicMsg?.delete().catch(() => {});

  // ── Déplacement du lanceur (charge, bond...) ─────────────────────────
  // Placé AVANT le branchement sur le verdict, donc appliqué quel que soit
  // le résultat — y compris sur un échec : la bête a chargé, qu'elle touche
  // ou non. C'est aussi ce qui rend le déplacement lisible pour la table :
  // il ne dépend que de la validation MJ, jamais du dé.
  {
    const moveM = n(sys.moveSelf, 0);
    if (moveM > 0) {
      const fromTok = casterToken ?? actor.getActiveTokens?.()?.[0] ?? null;
      try {
        const mv = await advanceCasterTowardTarget(fromTok, chargeToken, moveM);
        if (mv.moved) {
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `🏃 <b>${htmlEsc(actor.name)}</b> avance de <b>${fmtMeters(mv.meters)}</b> vers `
                   + `<b>${htmlEsc(chargeActor?.name ?? "sa cible")}</b> `
                   + `<span style="opacity:.7">(déplacement du sort — ne consomme ni mètres ni slot d'action)</span>`
          });
        } else if (mv.reason) {
          console.debug(`[RPG] ${item.name} : déplacement du lanceur non appliqué — ${mv.reason}`);
        }
      } catch (e) {
        // Un déplacement raté ne doit jamais empêcher le sort de se résoudre.
        console.warn("[RPG] Déplacement du lanceur impossible :", e);
      }
    }
  }

  // ── Effets/États — appliqués immédiatement après réussite ────────────
  const fxResultRows = [];
  const addedStatesTracker = [];

  /**
   * Applique les effets secondaires correspondant à un résultat donné.
   * Ne pose quelque chose que sur une touche validée : effectsForResult()
   * renvoie une liste vide pour un échec ou un échec critique, et la liste
   * des cibles a déjà été réduite à celles que le MJ a cochées.
   */
  const applyEffectsFor = async (outcome) => {
    const fxList = effectsForResult(item, outcome);

    // Le sort visait des cibles et le MJ n'en a validé aucune : il n'a rien
    // touché, donc il ne pose rien — pas même le buff « sur soi » du lanceur,
    // qui sinon serait le seul morceau du sort à survivre à un raté complet.
    // Un sort SANS cible (Repos, buff personnel) n'est pas concerné : sa liste
    // de cibles est vide dès le départ, pas vidée par le MJ.
    if (allPairs.length > 0 && targetActors.length === 0) return;

    for (const fx of fxList) {
      const mods = buildModsFromFxMods(fx.mods);
      // Qui reçoit l'effet : la ou les cibles visées, le lanceur, ou les deux.
      // Une valeur inconnue (ancien format) retombe sur les cibles plutôt que
      // sur une liste vide — un effet qui ne s'applique à personne, sans un mot
      // dans le chat, est le pire des comportements par défaut.
      const fxTarget = String(fx.target ?? "target").toLowerCase();
      const applyToList =
        (fxTarget === "self" || fxTarget === "caster") ? [actor] :
        (fxTarget === "both" || fxTarget === "selftarget")
          ? [actor, ...targetActors.filter(a => a.id !== actor.id)] :
        targetActors;

      for (const applyTo of applyToList) {
        if (!applyTo) continue;
        const stateId  = `spell_${item.id}_${fx.id ?? foundry.utils.randomID(6)}_${applyTo.id}`;

        // Effet par tour : la nature (dégâts / soin) est explicite dans
        // tick.mode, la quantité est toujours positive et monte avec une stat
        // du lanceur (stat ÷ per × perStep), figée au lancement.
        // En interne le moteur de tour traite un perTick négatif comme un soin.
        const dotFlat  = tickPerTick(fx, getEffP(actor));
        const dotDice  = String(fx.damage?.dice ?? "").trim();
        const tag = String(fx.tag ?? "").trim() || null;
        const effectKey = String(fx.effectKey ?? "").trim() || null;
        const isAura = !!fx.isAura;
        const permanent = !!fx.permanent;
        const duration = permanent ? 0 : Math.max(1, n(fx.duration, 1));

        const state = {
          id: stateId, label: String(fx.label ?? item.name),
          type: "spellEffect", tag, effectKey, isAura, permanent, duration, remaining: duration,
          dot: { flat: dotFlat, perTick: dotFlat, formula: dotDice, fatiguePerTick: n(fx.fatigueDot, 0) },
          mods: {
            ...mods,
            ...(fx.movementTypeGrant ? { movementTypeGrant: fx.movementTypeGrant } : {})
          },
          removeBaseTN: n(fx.removeBaseTN, 0) || null,
          // Résistance/vulnérabilité ACCORDÉE par cet effet (ex: "Écaille de
          // dragon" réduit la durée/les dégâts des effets tag "feu" reçus
          // ENSUITE par la cible) — lu par resistances.js's applyResistances()
          // via getStateResistances() tant que cet effet reste actif sur elle.
          // Toujours construit, même vide : {tag:null,...} est filtré sans
          // effet côté lecture (computeResistanceFor ignore une résistance sans
          // tag ni effectKey), pas besoin d'un if ici.
          resistance: {
            tag: String(fx.resistTag ?? "").trim() || null,
            durationReduction: n(fx.resistDurationReduction, 0),
            dotReductionPct: n(fx.resistDotPct, 0),
            immune: !!fx.resistImmune
          },
          // Résistance aux DÉGÂTS d'un type : objet SÉPARÉ de `resistance`
          // ci-dessus, avec son propre type visé. Les deux ne se recouvrent
          // pas (protéger des dégâts de feu n'a pas à protéger des brûlures)
          // et ne sont pas lus par le même code : celui-ci est agrégé dans
          // derived.resistancesElem par actor.js puis appliqué par
          // computeFinalDamage(), l'autre par resistances.js.
          resistanceDamage: {
            tag: String(fx.resistDamageTag ?? "").trim() || null,
            pct: n(fx.resistDamagePct, 0)
          },
          // Bonus de dégâts accordé aux ATTAQUES du porteur (attack-bonus.js).
          // Normalisé ici, une fois : les points d'application (jet d'arme,
          // résolution de sort) lisent une forme unique et n'ont pas à
          // connaître les champs à plat de la fiche.
          attackBonus: normalizeAttackBonus({
            scope: fx.atkScope, categories: fx.atkCategories,
            flat: fx.atkFlat, pct: fx.atkPct, dice: fx.atkDice,
            livraison: fx.atkLivraison, tag: fx.atkTag,
            // État posé sur la cible quand une attaque du porteur porte —
            // « tes lames empoisonnent ». Sans nom (atkFxLabel vide),
            // normalizeBonusEffect rend null et le bonus reste purement
            // chiffré, comme avant l'existence de ce champ.
            effect: {
              label: fx.atkFxLabel, when: fx.atkFxWhen,
              duration: fx.atkFxDuration, removeBaseTN: fx.atkFxRemoveTN,
              tag: fx.atkFxTag,
              dot: {
                mode: fx.atkFxDotMode, base: fx.atkFxDotBase,
                stat: fx.atkFxDotStat, per: fx.atkFxDotPer
              }
            }
          })
        };
        if (isAura) state.aura = {
          min: n(fx.auraMin, 0),
          max: n(fx.auraMax, 3),
          key: state.label,
          target: String(fx.auraTarget ?? "allies")
        };

        // Amplification côté LANCEUR (équipement + états) : allonge la durée,
        // renforce les dégâts/soin par tour et les bonus/malus. S'applique
        // AVANT les résistances de la cible.
        let ampInfo = null;
        let outgoing = state;
        try {
          const { amplifyState } = await import("./amplification.js");
          const amped = amplifyState(actor, state);
          outgoing = amped.state;
          ampInfo = amped.info;
        } catch (e) {
          console.warn("[RPG] amplification d'effet :", e);
        }

        const resistResult = await upsertState(applyTo, outgoing);
        const info = resistResult?.resistanceInfo;

        if (resistResult?.resisted) {
          const reason = info?.immune ? "immunité" : "durée ramenée à 0";
          fxResultRows.push(`🛡️ <b>${str(fx.label, "Effet")}</b> → ${applyTo.name} résiste (${reason})`);
          continue;
        }
        addedStatesTracker.push({ actorId: applyTo.id, stateId });
        const modSummary = summarizeMods(mods);
        const durTxt = permanent ? "permanent" : `${info?.finalDuration ?? n(outgoing.duration, duration)} tours`;
        // Trace l'amplification pour que le MJ voie d'où vient le renfort
        const ampBits = [];
        if (ampInfo?.durationBonus) ampBits.push(`durée ${ampInfo.durationBonus > 0 ? "+" : ""}${ampInfo.durationBonus}`);
        if (ampInfo?.dotBonusPct)   ampBits.push(`puissance ${ampInfo.dotBonusPct > 0 ? "+" : ""}${ampInfo.dotBonusPct}%`);
        if (ampInfo?.modBonusPct)   ampBits.push(`bonus/malus ${ampInfo.modBonusPct > 0 ? "+" : ""}${ampInfo.modBonusPct}%`);
        const ampTxt = ampBits.length ? ` <span style="opacity:.8">· ⚗️ amplifié (${ampBits.join(", ")})</span>` : "";
        fxResultRows.push(`✨ <b>${str(fx.label, "Effet")}</b> → ${applyTo.name}${modSummary ? ` (${modSummary})` : ""} — ${durTxt}${ampTxt}`);
      }
    }

    // États accordés aux ATTAQUES du lanceur par un bonus actif (« tes coups
    // empoisonnent »), quand ce bonus porte aussi sur les sorts. Sans ce
    // branchement, un bonus réglé sur « Armes et sorts » aurait posé son état
    // à l'épée et rien du tout au sort — une moitié muette, invisible.
    // Le déclencheur de l'effet est jugé sur le verdict du MJ, comme pour une
    // arme : `outcome` vaut ici "crit" ou "success" (un échec n'atteint jamais
    // cette ligne, effectsForResult renvoie une liste vide).
    if (outcome === "success" || outcome === "crit") {
      try {
        const granted = collectAttackBonusEffects(actor, { kind: "sort", isCrit: outcome === "crit" });
        for (const g of granted) {
          for (const tActor of targetActors) {
            await upsertState(tActor, {
              id: `atkfx_${g.stateId}_${tActor.id}`,
              label: g.effect.label,
              duration: g.effect.duration,
              remaining: g.effect.duration,
              cleanseDC: g.effect.removeBaseTN,
              removeBaseTN: g.effect.removeBaseTN,
              tag: g.effect.tag || null,
              dot: {
                flat: grantedTick(g.effect, actor),
                perTick: grantedTick(g.effect, actor),
                formula: "", fatiguePerTick: 0
              },
              mods: {}
            });
            fxResultRows.push(
              `🧪 <b>${htmlEsc(g.effect.label)}</b> → ${htmlEsc(tActor.name)} — `
            + `${g.effect.duration} tour(s) <span style="opacity:.7">(${htmlEsc(g.label)})</span>`);
          }
        }
      } catch (e) {
        console.warn("[RPG] états accordés aux sorts :", e);
      }
    }

    // Une aura ne vit que par l'état qu'on vient de poser sur son porteur :
    // c'est refreshAuras() qui la propage ensuite aux tokens alentour.
    if (fxList.some(fx => fx?.isAura) && globalThis.RPG_AURAS?.refreshAuras) {
      setTimeout(() => globalThis.RPG_AURAS.refreshAuras(), 200);
    }
  };

  // ── Échec Critique ───────────────────────────────────────────────────
  // Le MJ choisit toujours lui-même la conséquence (jamais de hasard ici)
  if (res === "critfail") {
    const { promptCritFailConsequence } = await import("./critfail-dialog.js");
    const choice = await promptCritFailConsequence({ kind: "spell", actorName: actor.name });
    if (!choice) return false; // MJ a annulé — message conservé, boutons réactivés

    // Aucun effet sur un échec critique : le sort n'a rien touché, il ne pose
    // donc rien. L'appel est conservé pour que la conséquence choisie par le
    // MJ reste la seule chose qui s'applique ici.
    await applyEffectsFor("critfail");

    const actionId = data.actionId ?? null;
    await confirmBudgetSlot(actionId, addedStatesTracker.length ? { addedStates: addedStatesTracker } : null);
    await bumpFatigue(actor, n(item.system?.fatigueCost, 1));
    await message.delete();
    await deletePublicMsg();

    let selfDmgLine = "";
    if (choice.selfDamage > 0) {
      const pvCur = n(actor.system?.ressources?.pv?.valeur, 0);
      const pvMax = n(actor.system?.ressources?.pv?.max, 0);
      const pvNew = Math.max(0, pvCur - choice.selfDamage);
      await actor.update({ "system.ressources.pv.valeur": pvNew });
      selfDmgLine = hpSecret(actor, `<br>${actor.name} subit <b>${choice.selfDamage}</b> dégâts (${pvCur} → <b>${pvNew}</b>/${pvMax} PV)`);
    }

    const fxLineCF = fxResultRows.length ? `<br>${fxResultRows.join("<br>")}` : "";
    await ChatMessage.create({
      content: `<b style="color:#8b1a12">☠ ÉCHEC CRITIQUE</b> — ${choice.label}${selfDmgLine}${fxLineCF}`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return true;
  }

  const title =
    res === "fail" ? `${actor.name} : ÉCHEC sur ${item.name}` :
    res === "crit" ? `${actor.name} : RÉUSSITE CRIT sur ${item.name}` :
    `${actor.name} : RÉUSSITE sur ${item.name}`;

  // ── Échec ────────────────────────────────────────────────────────────
  if (res === "fail") {
    // Idem : effectsForResult() ne retient plus rien sur un échec, donc aucun
    // état n'est posé. Le sort a coûté son mana et sa fatigue, rien de plus.
    await applyEffectsFor("fail");

    const actionId = data.actionId ?? null;
    await confirmBudgetSlot(actionId, addedStatesTracker.length ? { addedStates: addedStatesTracker } : null);
    await bumpFatigue(actor, n(item.system?.fatigueCost, 1));
    await message.delete();
    await deletePublicMsg();
    const failMsg = pickSpellFailMessage(actor.name, targetNames);
    const fxLineFail = fxResultRows.length ? `<br>${fxResultRows.join("<br>")}` : "";
    await ChatMessage.create({
      content: `<b style="color:#c0392b">✗ ÉCHEC</b> — ${failMsg}${fxLineFail}`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return;
  }

  // ── Collecte toutes les lignes de dégâts (ancien format ET nouveau) ──
  const dmgBlocks = [];

  // Ancien format system.damage / system.damageCrit
  const dmgBlock = (res === "crit") ? sys.damageCrit : sys.damage;
  if (dmgBlock?.enabled) {
    const scaling = dmgBlock.scaling ?? {};
    const statKey = String(scaling.stat ?? "intelligence");
    const per     = Math.max(1, n(scaling.per, 10) || 10);
    const perStep = n(scaling.perStep, 0);
    const effP    = getEffP(actor);
    const statBonus = Math.floor(n(effP?.[statKey], 0) / per) * perStep;
    const flat    = n(dmgBlock.flat, 0) + statBonus;
    const dice    = String(dmgBlock.dice ?? "").trim() || null;
    dmgBlocks.push({
      dice, flat, livraison: String(sys.livraison ?? "magique"),
      label: res === "crit" ? "Dégâts (Critique)" : "Dégâts",
      statKey, statBonus
    });
  }

  // Nouveau format system.damages[]
  const isCrit = (res === "crit");
  for (const d of (Array.isArray(sys.damages) ? sys.damages : [])) {
    if (!d) continue;
    const statKey = String(d.stat ?? "");
    const per     = Math.max(1, n(d.per, 10) || 10);
    const perStep = n(d.perStep, 0);
    const effP    = getEffP(actor);
    const statBonus = statKey ? Math.floor(n(effP?.[statKey], 0) / per) * perStep : 0;

    // Sur réussite critique, on utilise les valeurs de crit propres à la ligne :
    //   - critDice (vide → mêmes dés que le coup normal)
    //   - critFlat (bonus plat de crit ; remplace le plat normal)
    // Le scaling de stat (stat/per × perStep) reste appliqué dans les deux cas.
    // Ex : normal 1d6 + 0 + stat/10, crit 1d6 + 2 + stat/10.
    const critDice = String(d.critDice ?? "").trim();
    const baseFlat = isCrit ? n(d.critFlat, 0) : n(d.flat, 0);
    const flat     = baseFlat + statBonus;
    const dice     = (isCrit && critDice) ? critDice : (String(d.dice ?? "").trim() || null);
    const livr     = String(d.livraison ?? sys.livraison ?? "magique");
    dmgBlocks.push({
      dice, flat, livraison: livr,
      label: `Dégâts${isCrit ? " (crit)" : ""} ${livraisonLabel(livr)}`.trim(),
      statKey, statBonus,
      // Vol de vie : part des dégâts RÉELLEMENT infligés (après armure)
      // rendue en PV au lanceur.
      siphon: Math.max(0, Math.min(100, n(d.siphon, 0)))
    });
  }

  // ── Bonus de dégâts accordés par un état actif du lanceur ────────────
  // « Puissance arcanique », « Lames aiguisées » réglée sur « Armes et sorts ».
  // Un bonus qui porte sa PROPRE nature (physique/magique) ou son PROPRE
  // élément devient une ligne à part : il sera opposé à la résistance
  // correspondante de la cible, pas à celle du sort. Un bonus sans type
  // renseigné se fond dans la première ligne du sort, qu'il partage.
  // Le pourcentage, lui, n'est pas une ligne : il multiplie le brut au moment
  // du jet (voir bonusPct plus bas et le handler de « Lancer les dégâts »).
  const atkBonus = collectAttackBonuses(actor, { kind: "sort" });
  const bonusPct = n(atkBonus.pct, 0);
  if (dmgBlocks.length) {
    if (atkBonus.flatSame || atkBonus.sameDice.length) {
      const dice = atkBonus.sameDice.map(d => d.dice).filter(Boolean).join(" + ");
      dmgBlocks.push({
        dice: dice || null, flat: n(atkBonus.flatSame, 0),
        livraison: dmgBlocks[0].livraison,
        tag: sys.tag ?? null,
        label: `Bonus — ${atkBonus.entries.map(e => e.label).join(", ")}`,
        isBonus: true
      });
    }
    for (const e of atkBonus.own) {
      dmgBlocks.push({
        dice: e.dice || null, flat: n(e.flat, 0),
        livraison: e.livraison || String(sys.livraison ?? "magique"),
        tag: e.tag || sys.tag || null,
        label: `Bonus — ${e.label}`,
        isBonus: true
      });
    }
  }

  // ── Lignes de récupération (PV / mana / fatigue rendus) ──────────────
  // Symétrique de damages[] : même formule dés + plat + stat/per × perStep,
  // mais on RE-DONNE au lieu de retirer. Le bénéficiaire est le lanceur
  // (« Soi », cas du sort Repos) ou les cibles visées.
  const RES_LABEL = { pv: "PV", mana: "Mana", fatigue: "Fatigue" };
  const restoreEntries = [];   // [{ actorId, tokenUuid, name, blocks: [...] }]
  {
    const byBeneficiary = new Map();
    const push = (benefActor, benefToken, block) => {
      if (!benefActor) return;
      const key = benefToken?.document?.uuid ?? benefActor.uuid;
      if (!byBeneficiary.has(key)) {
        byBeneficiary.set(key, {
          actorId: benefActor.id,
          tokenUuid: benefToken?.document?.uuid ?? null,
          name: benefActor.name,
          blocks: []
        });
      }
      byBeneficiary.get(key).blocks.push(block);
    };

    for (const r of (Array.isArray(sys.restores) ? sys.restores : [])) {
      if (!r) continue;
      const resource = String(r.resource ?? "pv");
      const statKey  = String(r.stat ?? "");
      const per      = Math.max(1, n(r.per, 10) || 10);
      const perStep  = n(r.perStep, 0);
      const effP     = getEffP(actor);
      const statBonus = statKey ? Math.floor(n(effP?.[statKey], 0) / per) * perStep : 0;

      // Sur critique : critDice remplace les dés (si renseigné) et critFlat
      // remplace le plat — même convention que les lignes de dégâts.
      const critDice = String(r.critDice ?? "").trim();
      const baseFlat = isCrit ? n(r.critFlat, 0) : n(r.flat, 0);
      const flat     = baseFlat + statBonus;
      const dice     = (isCrit && critDice) ? critDice : (String(r.dice ?? "").trim() || null);
      if (!dice && flat === 0) continue;   // ligne vide : on l'ignore

      const block = {
        resource, dice, flat, statKey, statBonus,
        label: `${RES_LABEL[resource] ?? resource}${isCrit ? " (crit)" : ""}`
      };

      const benef = String(r.cible ?? "self");
      if (benef === "target" || benef === "both") {
        targetActors.forEach((tActor, idx) => push(tActor, targetTokens[idx], block));
      }
      if (benef === "self" || benef === "both") {
        // « Soi + cible(s) » alors qu'on s'est ciblé soi-même : une seule
        // part, sinon le lanceur encaisse deux fois la même ligne de soin.
        const casterKey = casterToken?.document?.uuid ?? actor.uuid;
        const alreadyTargeted = benef === "both" && targetActors.some((tA, idx) =>
          (targetTokens[idx]?.document?.uuid ?? tA.uuid) === casterKey);
        if (!alreadyTargeted) push(actor, casterToken, block);
      }
    }
    restoreEntries.push(...byBeneficiary.values());
  }

  // ── Effets/États : appliqués maintenant que le MJ a tranché ──────────
  await applyEffectsFor(res);

  await message.delete();
  await deletePublicMsg();
  const actionId = data.actionId ?? null;
  await confirmBudgetSlot(actionId, addedStatesTracker.length ? { addedStates: addedStatesTracker } : null);
  await bumpFatigue(actor, n(item.system?.fatigueCost, 1));

  // ── Bloc « récupération » — commun aux deux formes de message ────────
  // Comme pour les dégâts, on ne applique rien tout de suite : le joueur
  // lance ses dés, puis le MJ valide.
  let restoreSection = "";
  if (restoreEntries.length) {
    const encodedHeal = encodeURIComponent(JSON.stringify({
      actorId: actor.id,
      entries: restoreEntries
    }));
    const formula = (b) => {
      const parts = [];
      if (b.dice) parts.push(`<b>${b.dice}</b>`);
      if (b.flat !== 0) parts.push(`<b>${b.flat < 0 ? "−" : ""}${Math.abs(b.flat)}</b>${b.statBonus ? ` (dont +${b.statBonus} ${b.statKey})` : ""}`);
      return parts.join(" + ") || "<b>0</b>";
    };
    const lines = restoreEntries.flatMap(e =>
      e.blocks.map(b => `<div style="opacity:.85">${e.name} — ${b.label} : ${formula(b)}</div>`));

    restoreSection = `
      <div style="margin:8px 0 4px;font-weight:600">💚 Récupération :</div>
      ${lines.join("")}
      <button type="button" class="rpg-heal-roll-btn" data-spell-heal="${encodedHeal}"
        style="width:100%;margin-top:8px;padding:6px;cursor:pointer;border-radius:6px;font-weight:700;font-size:13px">
        🎲 Lancer la récupération
      </button>`;
  }

  // Cibles que le MJ a laissées de côté (seuil non atteint, ou décochées) :
  // annoncées explicitement, sinon leur absence du message se lit comme un
  // oubli plutôt que comme un raté.
  const missedLine = missedNames.length
    ? `<div style="margin-top:4px;font-size:12px;color:#c0392b">✗ Raté sur <b>${htmlEsc(missedNames.join(", "))}</b></div>`
    : "";

  // ── Message de résolution : effets + formule dégâts + bouton joueur ──
  if (dmgBlocks.length > 0 && targetActors.length > 0) {
    // Formule lisible par ligne
    const formulaLines = dmgBlocks.map(b => {
      const parts = [];
      if (b.dice) parts.push(`<b>${b.dice}</b>`);
      if (b.flat !== 0) parts.push(`<b>${b.flat < 0 ? "−" : ""}${Math.abs(b.flat)}</b>${b.statBonus ? ` (dont +${b.statBonus} ${b.statKey})` : ""}`);
      const formula = parts.join(" + ") || "<b>0</b>";
      return `${b.label} : ${formula}`;
    });

    // ── Un seul jet de dés, partagé par toutes les cibles ───────────────
    // Les dés appartiennent au SORT, pas à la cible : une boule de feu fait
    // le même jet pour tout le monde, et seule la mitigation (armure, %,
    // résistance élémentaire) fait diverger les dégâts réellement encaissés.
    // La charge utile est donc scindée en deux : `blocks` (les lignes de
    // dégâts, une seule copie, lancées une fois par le handler) et, par
    // cible, `mit[]` — sa mitigation, alignée index par index sur `blocks`.
    const targetData = targetActors.map((tActor, idx) => {
      const tSys = tActor.system ?? {};
      const effD = tSys.derived?.effective?.defenses ?? tSys.defenses ?? {};
      const red  = tSys.derived?.reductions ?? {};
      const tokenUuid = targetTokens[idx]?.document?.uuid ?? null;
      return {
        id: tActor.id,
        tokenUuid,
        name: tActor.name,
        pvCur: n(tActor.system?.ressources?.pv?.valeur, 0),
        pvMax: n(tActor.system?.ressources?.pv?.max, 0),
        mit: dmgBlocks.map(b => {
          const isPhys = b.livraison === "physique";
          // Résistance élémentaire de la cible au type du SORT (system.tag).
          // Sans élément ("neutre"), la livraison de la ligne fait office de
          // type — voir resolveDamageType() dans damage-types.js.
          // L'élément de la LIGNE d'abord : un bonus « +1d6 de feu » sur un
          // sort de glace est encaissé par la résistance au feu de la cible,
          // pas par sa résistance à la glace. Sans élément propre, la ligne
          // retombe sur celui du sort — le comportement d'avant.
          const res = resistanceFor(tActor, { tag: b.tag ?? item.system?.tag, livraison: b.livraison });
          return {
            fixe: isPhys ? n(effD.armureFixe, 0) : n(effD.resistanceFixe, 0),
            pct:  isPhys ? n(red.physiquePct, 0)  : n(red.magiquePct, 0),
            elemPct: res.pct,
            elemLabel: res.label
          };
        })
      };
    });

    const encodedData = encodeURIComponent(JSON.stringify({
      actorId: actor.id,
      casterUuid: casterToken?.document?.uuid ?? actor.uuid,
      casterName: actor.name,
      blocks: dmgBlocks.map(b => ({
        dice: b.dice ?? null, flat: n(b.flat, 0), label: b.label,
        livraison: b.livraison, tag: b.tag ?? null,
        siphon: n(b.siphon, 0), isBonus: !!b.isBonus
      })),
      // Pourcentage de bonus : appliqué au brut de chaque ligne PROPRE au sort
      // au moment du jet — il ne peut pas l'être ici, les dés ne sont pas
      // encore lancés (c'est le joueur qui les lance).
      bonusPct,
      targets: targetData
    }));

    const fxSection = fxResultRows.length
      ? `<div style="margin-top:6px;font-size:12px;opacity:.85">${fxResultRows.join("<br>")}</div>`
      : "";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div style="font-size:13px">
          <b>✅ ${title}</b>${targetNames ? ` sur <b>${targetNames}</b>` : ""}<br>
          ${missedLine}
          ${fxSection}
          <div style="margin:8px 0 4px;font-weight:600">💥 Dégâts à infliger :</div>
          ${formulaLines.map(l => `<div style="opacity:.85">${l}</div>`).join("")}
          <button type="button" class="rpg-dmg-roll-btn" data-spell-dmg="${encodedData}"
            style="width:100%;margin-top:8px;padding:6px;cursor:pointer;border-radius:6px;font-weight:700;font-size:13px">
            🎲 Lancer les dégâts
          </button>
          ${restoreSection}
        </div>`
    });
  } else if (!targetActors.length && missedNames.length) {
    // Toutes les cibles ont été écartées par le MJ : le sort part bien (mana,
    // fatigue et slot déjà consommés plus haut) mais ne touche personne. Sans
    // ce cas, le message annonçait « ✅ RÉUSSITE sur » suivi du vide.
    const fxBody = fxResultRows.length ? `<br>${fxResultRows.join("<br>")}` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div style="font-size:13px"><b style="color:#c0392b">✗ ${htmlEsc(actor.name)} : `
             + `${htmlEsc(item.name)} ne touche aucune cible</b>`
             + `<div style="margin-top:4px;font-size:12px;opacity:.85">Raté sur <b>${htmlEsc(missedNames.join(", "))}</b></div>`
             + `${fxBody}${restoreSection}</div>`,
      flags: actionId ? { rpg: { confirmedAction: true, actionId } } : {}
    });
  } else {
    // Pas de dégâts — message de résolution simple (+ récupération éventuelle)
    const fxBody = fxResultRows.length ? `<br>${fxResultRows.join("<br>")}` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div style="font-size:13px"><b>✅ ${title}</b>`
             + `${targetNames ? ` sur <b>${targetNames}</b>` : ""}${missedLine}${fxBody}${restoreSection}</div>`,
      flags: actionId ? { rpg: { confirmedAction: true, actionId } } : {}
    });
  }
}

export function bindSpellChatButtons(htmlEl, message) {
  const data =
    message?.getFlag?.("rpg", "spellDeclare") ??
    message?.flags?.rpg?.spellDeclare ??
    null;

  if (!data) return;

  const phase = data.phase ?? "pending";

  // ── Phase "pending" : le MJ valide ou annule la déclaration ────────────
  if (phase === "pending") {
    if (!game.user.isGM) {
      htmlEl.querySelector(".rpg-spell-gm")?.remove();
      return;
    }
    if (htmlEl.dataset.rpgSpellConfirmBound === "1") return;
    htmlEl.dataset.rpgSpellConfirmBound = "1";

    const confirmBtns = htmlEl.querySelectorAll(".rpg-spell-confirm");
    confirmBtns.forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;
        confirmBtns.forEach(b => b.disabled = true);
        try {
          await confirmSpellDeclaration(message, btn.dataset.ok === "1");
        } catch (e) {
          console.error("[RPG] confirmation sort:", e);
          ui.notifications.error("Erreur validation sort (voir console).");
          confirmBtns.forEach(b => b.disabled = false);
        }
      });
    });
    return;
  }

  // ── Phase "awaitingRoll" : le joueur lance son d20 (bouton branché dans
  // init.js) ; rien à lier ici, seule la zone MJ (vide) est masquée. ──────
  if (phase === "awaitingRoll") {
    if (!game.user.isGM) htmlEl.querySelector(".rpg-spell-gm")?.remove();
    return;
  }

  // ── Phase "rejected" : plus rien à lier ─────────────────────────────────
  if (phase === "rejected") return;

  // ── Phase "ready" : verdict MJ (Échec critique/Échec/Réussite/Réussite Crit) ──
  // Joueurs : on retire la zone GM
  if (!game.user.isGM) {
    htmlEl.querySelector(".rpg-spell-gm")?.remove();
    return;
  }

  // IMPORTANT: éviter de binder 20 fois si Foundry re-render
  // -> on marque le message DOM comme déjà bindé
  if (htmlEl.dataset.rpgSpellBound === "1") return;
  htmlEl.dataset.rpgSpellBound = "1";

  const buttons = htmlEl.querySelectorAll(".rpg-spell-resolve");
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const result = btn.dataset.result;
      if (!result) return;

      // Multi-cible : le MJ a coché les cibles réellement touchées (cases
      // pré-remplies par comparaison du d20 unique aux seuils de chacune).
      // Aucune case dans le DOM = cible unique ou message d'avant cette
      // version → on n'envoie rien et resolve garde toutes les cibles.
      const boxes = htmlEl.querySelectorAll(".rpg-spell-target-hit");
      const opts = boxes.length
        ? { hitUuids: Array.from(boxes).filter(cb => cb.checked).map(cb => cb.dataset.uuid) }
        : {};

      // lock UI
      for (const b of buttons) b.disabled = true;

      try {
        const res = await RPG_SPELLS.resolveDeclaredSpellFromMessage(message, result, opts);
        if (res === false) {
          // Annulé (ex: MJ a fermé le dialog Échec Critique sans valider) -> on réactive
          for (const b of buttons) b.disabled = false;
        }
      } catch (err) {
        console.error("[RPG] resolve error:", err);
        ui.notifications.error("Erreur résolution sort (voir console).");
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}