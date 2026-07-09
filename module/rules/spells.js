// systems/rpg/module/rules/spells.js
import { manhattanDistanceTokens } from "../utils/grid.js";
import { applyResistances } from "./resistances.js";
import { computeTN } from "./combat.js";

/* ------------------------------------------------------------ */
/* Utils                                                        */
/* ------------------------------------------------------------ */

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
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

function effectsForResult(item, result) {
  const arr = Array.isArray(item?.system?.effectsUI) ? item.system.effectsUI : [];
  const res = String(result);

  const allowWhen = new Set();
  allowWhen.add("cast"); // toujours
  if (res === "success") allowWhen.add("hit");
  if (res === "crit") allowWhen.add("crit");

  return arr.filter(fx => allowWhen.has(String(fx?.when ?? "").toLowerCase()));
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

  // effectsUI default
  if (sys.effectsUI === undefined) patch["system.effectsUI"] = [];
  if (sys.coutMana === undefined) patch["system.coutMana"] = 0;
  if (sys.difficulte === undefined) patch["system.difficulte"] = 0;
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

  const auraEnabled = !!(sys.aura?.enabled || sys.aura?.active);
  const auraMin = n(sys.aura?.range?.min, 0);
  const auraMax = n(sys.aura?.range?.max, 0);
  const auraTarget = str(sys.aura?.target, "allies");

  const manaCost = n(sys.coutMana, 0);
  const speed = str(sys.speed, "normal");
  const diff = n(sys.difficulte, 0);

  // IMPORTANT: modsSummary = HIT ONLY (jamais hit+crit)
  const fxHit = getFxByWhen(item, "hit")[0] ?? null;
  const hitMods = fxHit ? buildModsFromFxMods(fxHit.mods) : {};
  const modsSummary = summarizeMods(hitMods);

  return {
    text: {
      speed,
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
    const dist = measureSquares(casterT, targetT); // ✅ Manhattan
    if (dist < rmin || dist > rmax) {
      return { ok: false, reason: `Hors portée (${dist} cases, ${rmin}–${rmax})` };
    }
  }

  // mana
  const manaCost = n(sys.coutMana, 0);
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

export function buildSpellEffectsPreview({ actor, item }) {
  if (!item || item.type !== "spell") return [];

  const sys = item.system ?? {};
  const auraEnabled = !!(sys.aura?.enabled || sys.aura?.active);
  const list = [];

  const fxHit = getFxByWhen(item, "hit")[0] ?? null;
  const fxCrit = getFxByWhen(item, "crit")[0] ?? null;

  if (fxHit) {
    const mods = buildModsFromFxMods(fxHit.mods);
    list.push({
      label: str(fxHit.label, "Effet"),
      when: "Touché",
      target: str(fxHit.target, "target"),
      duration: n(fxHit.duration, 0),
      summary: summarizeMods(mods)
    });
  }

  if (fxCrit) {
    const mods = buildModsFromFxMods(fxCrit.mods);
    list.push({
      label: str(fxCrit.label, "Effet Crit"),
      when: "Crit",
      target: str(fxCrit.target, "target"),
      duration: n(fxCrit.duration, 0),
      summary: summarizeMods(mods)
    });
  }

  if (auraEnabled) {
    const amin = n(sys.aura?.range?.min, 0);
    const amax = n(sys.aura?.range?.max, 0);
    const tgt = str(sys.aura?.target, "allies");
    const key = str(sys.aura?.key, "") || item.name;

    const dot = n(sys.aura?.dotFlat, 0);
    const dc = n(sys.aura?.cleanseDC, 0);

    // mods affichés = HIT ONLY
    const auraMods = fxHit ? summarizeMods(buildModsFromFxMods(fxHit.mods)) : "";

    const parts = [
      `Portée ${amin}–${amax}`,
      auraMods ? `Mods: ${auraMods}` : null,
      dot ? `DOT ${dot}/tour` : null,
      dc ? `Retrait ${dc}+` : null
    ].filter(Boolean);

    list.push({
      label: `Aura (${key})`,
      when: "—",
      target: tgt,
      duration: "—",
      summary: parts.join(" • ")
    });
  }

  if (!list.length) list.push({ label: "Aucun effet", when: "—", target: "—", duration: "—", summary: "" });
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

function measureSquares(tokenA, tokenB) {
  try {
    return manhattanDistanceTokens(tokenA, tokenB); // ✅ diagonale=2
  } catch (e) {
    return 999999;
  }
}

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
  const targetTokens = targetToken ? [targetToken] : Array.from(game.user.targets);
  const targetActors = targetTokens.map(t => t.actor).filter(Boolean);
  const targetActor  = targetActors[0] ?? null; // rétrocompat (effets self/caster n'en ont pas besoin)

  // ── Validation nombre de cibles ───────────────────────────────────────
  const tcMin = n(sys.targetCount?.min, 1);
  const tcMax = n(sys.targetCount?.max, 1);
  const tcCount = targetTokens.length;

  if (tcMin > 0 || tcMax > 0) {
    if (tcCount < tcMin) {
      return { ok: false, reason: `Ce sort nécessite au moins ${tcMin} cible(s) — ${tcCount} sélectionnée(s)` };
    }
    if (tcMax > 0 && tcCount > tcMax) {
      return { ok: false, reason: `Ce sort ne prend que ${tcMax} cible(s) maximum — ${tcCount} sélectionnée(s)` };
    }
  }

  // ── Portée : vérifie TOUTES les cibles ────────────────────────────────
  if (casterT && targetTokens.length) {
    const rmin = n(sys.range?.min, 0);
    const rmax = n(sys.range?.max, 0);
    for (const tT of targetTokens) {
      const dist = measureSquares(casterT, tT);
      if (dist < rmin || dist > rmax) {
        return { ok: false, reason: `${tT.actor?.name ?? tT.name} hors portée (${dist.toFixed(1)} cases, ${rmin}–${rmax})` };
      }
    }
  }

  // mana
  const manaCost = n(sys.coutMana, 0);
  const manaCur  = n(actor.system?.ressources?.mana?.valeur, 0);
  if (manaCost > 0 && manaCur < manaCost) return { ok: false, reason: "Mana insuffisant" };
  if (manaCost > 0) await actor.update({ "system.ressources.mana.valeur": Math.max(0, manaCur - manaCost) });

  // CD
  if (cdMax > 0) await item.update({ "system.cooldown.restant": cdMax, "system.recharge.restant": cdMax });

  // --- Résumés (déclare) : on affiche ce qui existe
  const dmgHit = computeDamageExpr({ actor, block: sys.damage });
  const dmgCrit = computeDamageExpr({ actor, block: sys.damageCrit });

  const fxHit = (Array.isArray(sys.effectsUI) ? sys.effectsUI : []).filter(f => String(f?.when ?? "") === "hit");
  const fxCrit = (Array.isArray(sys.effectsUI) ? sys.effectsUI : []).filter(f => String(f?.when ?? "") === "crit");
  const fxCast = (Array.isArray(sys.effectsUI) ? sys.effectsUI : []).filter(f => String(f?.when ?? "") === "cast");

  const summarizeFxList = (list) => {
    if (!list?.length) return null;

    const lines = [];
    for (const fx of list) {
      const mods = buildModsFromFxMods(fx.mods);
      const modInfo = summarizeModsWithKind(mods);

      const fxDmg = computeDamageExpr({ actor, block: fx.damage });
      const parts = [];
      if (fxDmg?.expr) parts.push(`💥 ${fxDmg.expr}`);
      if (modInfo?.summary) parts.push(`${modInfo.kind === "debuff" ? "⬇️ Debuff" : "⬆️ Buff"}: ${modInfo.summary}`);

      // si l'effet n'a rien, on ne l'affiche pas
      if (!parts.length) continue;

      lines.push(`<li><b>${str(fx.label, "Effet")}</b> — ${parts.join(" • ")}</li>`);
    }
    if (!lines.length) return null;
    return `<ul style="margin:6px 0 0 18px;">${lines.join("")}</ul>`;
  };

  const auraEnabled = !!(sys.aura?.active || sys.aura?.enabled);
  const auraSummary = auraEnabled
    ? `🌀 <b>Aura</b> — Cible: <b>${str(sys.aura?.target, "allies")}</b> • Portée: <b>${n(sys.aura?.range?.min, 0)}–${n(sys.aura?.range?.max, 0)}</b> • Clé: <b>${str(sys.aura?.key, item.name)}</b>`
    : null;

  const speaker = ChatMessage.getSpeaker({ actor, token: casterT?.document ?? undefined });

  const actorUuid = actor.uuid;
  const itemUuid = item.uuid;
  const casterTokenUuid = casterT?.document?.uuid ?? null;
  const targetTokenUuids = targetTokens.map(t => t?.document?.uuid).filter(Boolean);
  const targetNamesList = targetActors.map(a => a.name).join(", ");

  // Calcule le TN pour la première cible (ou sans cible)
  const firstTarget = targetActors[0] ?? null;
  let tnInfo = null;
  if (firstTarget) {
    try {
      const tnData = computeTN(actor, firstTarget, item);
      tnInfo = tnData;
    } catch(e) { /* pas grave si ça échoue */ }
  }

  const tnLine = tnInfo
    ? `🎯 <b>Jet de touché</b> : il faut faire <b style="color:#e05a00;font-size:1.1em">${tnInfo.tnFinal}+</b> sur 1d20
       <button type="button" class="rpg-roll-d20-btn"
         data-actor-id="${actor.id}" data-tn="${tnInfo.tnFinal}" data-spell="${item.name}"
         style="margin-left:8px;padding:2px 10px;cursor:pointer;border-radius:6px;font-size:11px">
         🎲 Lancer le d20
       </button>`
      + (sys.difficulte ? `<div style="font-size:11px;opacity:.7">(difficulté +${n(sys.difficulte,0)} déjà incluse dans le TN)</div>` : ``)
    : `🎯 <b>Jet de touché</b> : fais ton jet${sys.difficulte ? ` (difficulté +${n(sys.difficulte,0)})` : ``}`;

  const content = `
  <div class="rpg-spell-declare">
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
      ${auraSummary ? `${auraSummary}<br>` : ``}
    </div>

    ${summarizeFxList(fxCast) ? `<div style="margin-top:6px;"><b>Effets (au lancement)</b>${summarizeFxList(fxCast)}</div>` : ``}
    ${summarizeFxList(fxHit)  ? `<div style="margin-top:6px;"><b>Effets (touché)</b>${summarizeFxList(fxHit)}</div>`   : ``}
    ${summarizeFxList(fxCrit) ? `<div style="margin-top:6px;"><b>Effets (crit)</b>${summarizeFxList(fxCrit)}</div>`     : ``}

    <hr style="margin:8px 0;opacity:.2"/>

    <div style="opacity:.8"><i>En attente de validation MJ.</i></div>
  </div>`;

  const gmContent2 = `
  <div class="rpg-spell-declare rpg-gm-panel">
    <div style="font-size:11px;color:#c8960a;font-weight:600;margin-bottom:6px">⚙️ Validation MJ — ${actor.name} → ${item.name}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="rpg-spell-resolve" data-result="critfail" style="color:#8b1a12;font-weight:700">Échec Critique</button>
      <button type="button" class="rpg-spell-resolve" data-result="fail">Échec</button>
      <button type="button" class="rpg-spell-resolve" data-result="success">Réussite</button>
      <button type="button" class="rpg-spell-resolve" data-result="crit">Réussite Crit</button>
    </div>
  </div>`;

  const msg = await ChatMessage.create({
    speaker,
    content,
    flags: {
      rpg: {
        spellDeclare: { actorUuid, itemUuid, casterTokenUuid, targetTokenUuids, actionId: actionId ?? null }
      }
    }
  });

  await ChatMessage.create({
    speaker,
    content: gmContent2,
    whisper: gmUserIds(),
    flags: {
      rpg: {
        spellDeclare: { actorUuid, itemUuid, casterTokenUuid, targetTokenUuids, actionId: actionId ?? null }
      }
    }
  });

  return { ok: true, messageId: msg.id };
}

/**
 * Bind des boutons MJ dans le chat (centralisé)
 */
export async function resolveDeclaredSpellFromMessage(message, result) {
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

  const targetTokens = [];
  for (const uuid of uuidList) {
    const doc = await fromUuidSafe(uuid);
    const tok = doc?.object ?? null;
    if (tok) targetTokens.push(tok);
  }
  const targetActors = targetTokens.map(t => t.actor).filter(Boolean);

  // Rétrocompat : variables singulières utilisées pour les effets "self/caster"
  const targetToken = targetTokens[0] ?? null;
  const targetActor = targetActors[0] ?? null;

  const targetNames = targetActors.map(a => a.name).join(", ") || null;

  // ── Échec Critique ───────────────────────────────────────────────────
  // Le MJ choisit toujours lui-même la conséquence (jamais de hasard ici)
  if (res === "critfail") {
    const { promptCritFailConsequence } = await import("./critfail-dialog.js");
    const choice = await promptCritFailConsequence({ kind: "spell", actorName: actor.name });
    if (!choice) return false; // MJ a annulé — message conservé, boutons réactivés

    const actionId = data.actionId ?? null;
    await confirmBudgetSlot(actionId);
    await bumpFatigue(actor, n(item.system?.fatigueCost, 1));
    await message.delete();

    let selfDmgLine = "";
    if (choice.selfDamage > 0) {
      const pvCur = n(actor.system?.ressources?.pv?.valeur, 0);
      const pvMax = n(actor.system?.ressources?.pv?.max, 0);
      const pvNew = Math.max(0, pvCur - choice.selfDamage);
      await actor.update({ "system.ressources.pv.valeur": pvNew });
      selfDmgLine = `<br>${actor.name} subit <b>${choice.selfDamage}</b> dégâts (${pvCur} → <b>${pvNew}</b>/${pvMax} PV)`;
    }

    await ChatMessage.create({
      content: `<b style="color:#8b1a12">☠ ÉCHEC CRITIQUE</b> — ${choice.label}${selfDmgLine}`,
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
    const actionId = data.actionId ?? null;
    await confirmBudgetSlot(actionId);
    await bumpFatigue(actor, n(item.system?.fatigueCost, 1));
    await message.delete();
    const failMsg = pickSpellFailMessage(actor.name, targetNames);
    await ChatMessage.create({
      content: `<b style="color:#c0392b">✗ ÉCHEC</b> — ${failMsg}`,
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
  for (const d of (Array.isArray(sys.damages) ? sys.damages : [])) {
    if (!d) continue;
    const statKey = String(d.stat ?? "");
    const per     = Math.max(1, n(d.per, 10) || 10);
    const perStep = n(d.perStep, 0);
    const effP    = getEffP(actor);
    const statBonus = statKey ? Math.floor(n(effP?.[statKey], 0) / per) * perStep : 0;
    const flat    = n(d.flat, 0) + statBonus;
    const dice    = String(d.dice ?? "").trim() || null;
    dmgBlocks.push({
      dice, flat, livraison: String(d.livraison ?? sys.livraison ?? "magique"),
      label: `Dégâts ${d.livraison ?? ""}`.trim(),
      statKey, statBonus
    });
  }

  // ── Effets/États — appliqués immédiatement après réussite ────────────
  const fxList = effectsForResult(item, res);
  const fxResultRows = [];

  for (const fx of fxList) {
    const mods = buildModsFromFxMods(fx.mods);
    const fxTarget = String(fx.target ?? "target").toLowerCase();
    const applyToList =
      (fxTarget === "self" || fxTarget === "caster") ? [actor] :
      (fxTarget === "target") ? targetActors : [];

    for (const applyTo of applyToList) {
      if (!applyTo) continue;
      const stateId  = `spell_${item.id}_${fx.id ?? foundry.utils.randomID(6)}_${applyTo.id}`;
      const dotFlat  = n(fx.damage?.flat, 0);
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
        mods
      };
      if (isAura) state.aura = { min: n(fx.auraMin, 0), max: n(fx.auraMax, 3), key: state.label };

      const resistResult = await upsertState(applyTo, state);
      const info = resistResult?.resistanceInfo;

      if (resistResult?.resisted) {
        const reason = info?.immune ? "immunité" : "durée ramenée à 0";
        fxResultRows.push(`🛡️ <b>${str(fx.label, "Effet")}</b> → ${applyTo.name} résiste (${reason})`);
        continue;
      }
      addedStatesTracker.push({ actorId: applyTo.id, stateId });
      const modSummary = summarizeMods(mods);
      const durTxt = permanent ? "permanent" : `${info?.finalDuration ?? duration} tours`;
      fxResultRows.push(`✨ <b>${str(fx.label, "Effet")}</b> → ${applyTo.name}${modSummary ? ` (${modSummary})` : ""} — ${durTxt}`);
    }
  }

  // Aura
  const auraEnabled = !!(sys.aura?.active || sys.aura?.enabled);
  if (auraEnabled && globalThis.RPG_AURAS?.refreshAuras) {
    setTimeout(() => globalThis.RPG_AURAS.refreshAuras(), 200);
    fxResultRows.push(`🌀 <b>Aura</b> active — ${str(sys.aura?.target, "alliés")}`);
  }

  await message.delete();
  const actionId = data.actionId ?? null;
  await confirmBudgetSlot(actionId, addedStatesTracker.length ? { addedStates: addedStatesTracker } : null);
  await bumpFatigue(actor, n(item.system?.fatigueCost, 1));

  // ── Message de résolution : effets + formule dégâts + bouton joueur ──
  if (dmgBlocks.length > 0 && targetActors.length > 0) {
    // Formule lisible par ligne
    const formulaLines = dmgBlocks.map(b => {
      const parts = [];
      if (b.dice) parts.push(`<b>${b.dice}</b>`);
      if (b.flat !== 0) parts.push(`<b>${b.flat > 0 ? "+" : ""}${b.flat}</b>${b.statBonus ? ` (dont +${b.statBonus} ${b.statKey})` : ""}`);
      const formula = parts.join(" + ") || "<b>0</b>";
      return `${b.label} : ${formula} dégâts ${b.livraison}`;
    });

    // Encode les blocs + réductions pour le handler du bouton
    const targetData = targetActors.map(tActor => {
      const tSys = tActor.system ?? {};
      const effD = tSys.derived?.effective?.defenses ?? tSys.defenses ?? {};
      const red  = tSys.derived?.reductions ?? {};
      return {
        id: tActor.id,
        name: tActor.name,
        pvCur: n(tActor.system?.ressources?.pv?.valeur, 0),
        pvMax: n(tActor.system?.ressources?.pv?.max, 0),
        blocks: dmgBlocks.map(b => {
          const isPhys = b.livraison === "physique";
          return {
            ...b,
            fixe: isPhys ? n(effD.armureFixe, 0) : n(effD.resistanceFixe, 0),
            pct:  isPhys ? n(red.physiquePct, 0)  : n(red.magiquePct, 0),
          };
        })
      };
    });

    const encodedData = encodeURIComponent(JSON.stringify({
      actorId: actor.id,
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
          ${fxSection}
          <div style="margin:8px 0 4px;font-weight:600">💥 Dégâts à infliger :</div>
          ${formulaLines.map(l => `<div style="opacity:.85">${l}</div>`).join("")}
          <button type="button" class="rpg-dmg-roll-btn" data-spell-dmg="${encodedData}"
            style="width:100%;margin-top:8px;padding:6px;cursor:pointer;border-radius:6px;font-weight:700;font-size:13px">
            🎲 Lancer les dégâts
          </button>
        </div>`
    });
  } else {
    // Pas de dégâts — message de résolution simple
    const fxBody = fxResultRows.length ? `<br>${fxResultRows.join("<br>")}` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<b>✅ ${title}</b>${targetNames ? ` sur <b>${targetNames}</b>` : ""}${fxBody}`,
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

      // lock UI
      for (const b of buttons) b.disabled = true;

      try {
        const res = await RPG_SPELLS.resolveDeclaredSpellFromMessage(message, result);
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