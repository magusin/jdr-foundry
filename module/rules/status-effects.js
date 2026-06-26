// systems/rpg/module/rules/status-effects.js

import { mitigateDamage } from "./combat.js";

/**
 * Structure stockée dans actor.system.etatsActifs:
 * {
 *   id: string,
 *   key: string,              // ex: "poison"
 *   label: string,            // ex: "Poison affaiblissant"
 *   remaining: number,        // tours restants
 *   cleanseDC: number,        // jet min d20 pour retirer (info)
 *   source: { actorId, itemId, stat, snap },
 *   dot: { base, per, perStep, livraison }, // optionnel
 *   modsFlat: { principales?, defenses?, move? }, // nombres
 *   modsPct:  { principales?, defenses?, move? }  // nombres (ex -10 => -10%)
 * }
 */

function uid() {
  return foundry.utils.randomID();
}

function n(x) {
  return Number(x) || 0;
}

function clamp(nv, a, b) {
  return Math.max(a, Math.min(b, nv));
}

function deepClone(o) {
  return foundry.utils.deepClone(o ?? {});
}

function ensureBuckets() {
  return {
    principales: { force: 0, intelligence: 0, dexterite: 0, acuite: 0, endurance: 0 },
    defenses: { armureFixe: 0, resistanceFixe: 0, scoreArmure: 0, scoreResistance: 0 },
    ressources: { pvMax: 0, manaMax: 0 },
    regen: { pv: 0, mana: 0 },
    move: { vitesse: 0 },
    initiative: { mod: 0 }
  };
}


function addBuckets(dst, src) {
  if (!src) return;
  for (const group of ["principales", "defenses", "ressources", "regen", "move", "initiative"]) {
    const g = src[group] ?? {};
    const d = dst[group] ?? {};
    for (const k of Object.keys(d)) d[k] = n(d[k]) + n(g[k]);
    dst[group] = d;
  }
}

function scaleValue(def, snap) {
  // def: { base, per, perStep }
  const base = n(def?.base);
  const per = Math.max(1, n(def?.per) || 10);
  const perStep = n(def?.perStep);
  const steps = Math.floor(Math.max(0, n(snap)) / per);
  return base + steps * perStep;
}

/**
 * Convertit un "mods" qui peut contenir des nombres OU des objets scalés
 * en valeurs numériques finales (avec snap).
 *
 * Exemple accepté:
 * modsFlat.principales.force = -10
 * OU
 * modsFlat.principales.force = { base:-5, per:10, perStep:-1 }
 */
function computeModsNumeric(mods, snap) {
  const out = ensureBuckets();
  if (!mods) return out;

  for (const group of ["principales", "defenses", "ressources", "regen", "move", "initiative"]) {
    const g = mods[group] ?? {};
    for (const key of Object.keys(out[group])) {
      const v = g[key];
      if (v == null) continue;

      if (typeof v === "number" || typeof v === "string") {
        out[group][key] += n(v);
      } else if (typeof v === "object") {
        out[group][key] += scaleValue(v, snap);
      }
    }
  }

  return out;
}

export function getItemEffects(item) {
  const arr = item?.system?.effects;
  return Array.isArray(arr) ? arr : [];
}

function slugKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "etat";
}

function legacyToNew(legacy, actorForSnap) {
  const effP = actorForSnap?.system?.derived?.effective?.principales
    ?? actorForSnap?.system?.principales
    ?? {};

  const name = String(legacy?.name ?? "").trim();
  const duration = Math.max(1, n(legacy?.duration ?? 1));
  const remaining = clamp(n(legacy?.remaining ?? duration), 0, 999);
  const dc = clamp(n(legacy?.dc ?? 0), 0, 20);

  const dotFlat = n(legacy?.dotFlat ?? 0);
  const dotStat = String(legacy?.dotStat ?? "").trim();
  const dotDiv = Math.max(1, n(legacy?.dotDiv ?? 10) || 10);

  // Convertit l'ancien DOT: dotFlat + floor(stat/dotDiv)
  // => scaleValue(base=dotFlat, per=dotDiv, perStep=1, snap=statVal)
  const stat = dotStat || "intelligence";
  const snap = n(effP?.[stat] ?? 0);

  const dot = (dotFlat !== 0 || dotStat)
    ? { base: dotFlat, per: dotDiv, perStep: 1, livraison: "physique" }
    : null;

  // Convertit debuff -> modsFlat/modsPct (signés)
  // IMPORTANT: on considère que tes valeurs sont déjà SIGNÉES (ex: -10 = malus)
  const d = legacy?.debuff ?? {};
  const modsFlat = ensureBuckets();
  const modsPct = ensureBuckets();

  modsFlat.principales.force += n(d.forceFlat ?? 0);
  modsPct.principales.force += n(d.forcePct ?? 0);

  modsFlat.principales.dexterite += n(d.dexFlat ?? 0);
  modsPct.principales.dexterite += n(d.dexPct ?? 0);

  // ancien code: intFlat/intPct
  modsFlat.principales.intelligence += n(d.intFlat ?? 0);
  modsPct.principales.intelligence += n(d.intPct ?? 0);

  // si tu ajoutes acuite/endurance dans la sheet plus tard
  modsFlat.principales.acuite += n(d.acuiteFlat ?? 0);
  modsPct.principales.acuite += n(d.acuitePct ?? 0);
  modsFlat.principales.endurance += n(d.enduranceFlat ?? 0);
  modsPct.principales.endurance += n(d.endurancePct ?? 0);

  return {
    id: legacy?.id ?? uid(),
    key: slugKey(name),
    label: name || "État",
    remaining,
    cleanseDC: dc,
    source: { actorId: actorForSnap?.id ?? null, itemId: null, stat, snap },
    dot,
    modsFlat,
    modsPct
  };
}

export function normalizeEffectInstance(e, actorForSnap) {
  if (!e) return null;

  // déjà au nouveau format
  if (e.key && e.label && e.modsFlat && e.modsPct) {
    const out = deepClone(e);
    out.id = out.id ?? uid();
    out.remaining = clamp(n(out.remaining ?? 0), 0, 999);
    out.cleanseDC = clamp(n(out.cleanseDC ?? 0), 0, 20);
    out.source = out.source ?? { actorId: null, itemId: null, stat: "intelligence", snap: 0 };
    out.modsFlat = out.modsFlat ?? ensureBuckets();
    out.modsPct = out.modsPct ?? ensureBuckets();
    return out;
  }

  // ancien format (name/duration/dc/dotFlat/debuff)
  if (e.name || e.duration || e.debuff || e.dotFlat != null) {
    return legacyToNew(e, actorForSnap);
  }

  return null;
}


/**
 * Applique un effet défini par l'item sur la cible (MJ only recommandé).
 * - stacking "replace" : remplace un effet existant avec la même key
 * - stacking "stack" : ajoute un nouvel état
 */
export async function applyEffect({ sourceActor, targetActor, item, effectDef }) {
  if (!targetActor || !item || !effectDef) return;

  const key = String(effectDef.key ?? "").trim();
  if (!key) return ui.notifications.warn("Effet invalide: il manque 'key'.");

  const label = String(effectDef.label ?? key);
  const duration = Math.max(1, n(effectDef.duration ?? 1));
  const stacking = String(effectDef.stacking ?? "replace"); // replace | stack
  const cleanseDC = clamp(n(effectDef.cleanseDC ?? 0), 0, 20);
  const dotPerTick = n(effectDef?.dot?.perTick ?? 0);
  const dotDef = dotPerTick > 0 ? { perTick: dotPerTick } : null;

  // Snapshot stat de l'attaquant (si scaling)
  const stat = String(effectDef.sourceStat ?? effectDef.dot?.stat ?? "intelligence");
  const effP = sourceActor?.system?.derived?.effective?.principales ?? sourceActor?.system?.principales ?? {};
  const snap = n(effP?.[stat] ?? 0);

  // Debuffs flat/% (convertis en nombres)
  const modsFlat = computeModsNumeric(effectDef.modsFlat, snap);
  const modsPct = computeModsNumeric(effectDef.modsPct, snap);

  const instance = {
    id: uid(),
    key,
    label,
    remaining: duration,
    cleanseDC,
    source: {
      actorId: sourceActor?.id ?? null,
      itemId: item?.id ?? null,
      stat,
      snap
    },
    dot: dotDef,
    modsFlat,
    modsPct
  };

  const current = Array.isArray(targetActor.system?.etatsActifs) ? targetActor.system.etatsActifs : [];
  let next = [...current];

  if (stacking === "replace") {
    next = next.filter(e => e?.key !== key);
  }

  next.push(instance);

  await targetActor.update({ "system.etatsActifs": next });

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content:
      `<b>${sourceActor?.name ?? "Quelqu'un"}</b> applique <b>${label}</b> à <b>${targetActor.name}</b> ` +
      `(${duration} tour(s)${cleanseDC ? `, retrait: ${cleanseDC}+` : ""}).`
  });
}

/**
 * Retire un état (MJ).
 */
export async function removeEffect(targetActor, effectId) {
  const cur = Array.isArray(targetActor.system?.etatsActifs) ? targetActor.system.etatsActifs : [];
  const next = cur.filter(e => e?.id !== effectId);
  await targetActor.update({ "system.etatsActifs": next });
}

/**
 * Affiche au chat le jet requis (sans lancer à la place du joueur).
 */
export async function postCleanseInfo(targetActor, effectId) {
  const cur = Array.isArray(targetActor.system?.etatsActifs) ? targetActor.system.etatsActifs : [];
  const e = cur.find(x => x?.id === effectId);
  if (!e) return;

  const dc = n(e.cleanseDC);
  const txt = dc > 0
    ? `Jet requis pour retirer <b>${e.label}</b> : <b>${dc}+</b> au d20.`
    : `Cet effet (<b>${e.label}</b>) n'a pas de difficulté de retrait définie.`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: txt
  });
}

/**
 * Calcule le DOT brut (avant mitigation).
 */
export function computeDotRaw(effectInstance) {
  return Math.max(0, n(effectInstance?.dot?.perTick ?? 0));
}

function normalizeStateV2(st) {
  if (!st) return null;

  // Si c’est déjà ton format V2 (sheet)
  if (st.label && (st.mods || st.dot || st.type || st.isAura != null)) {
    const out = foundry.utils.deepClone(st);
    out.id = String(out.id ?? foundry.utils.randomID());
    out.label = String(out.label ?? "État").trim() || "État";
    out.type = String(out.type ?? "custom");
    out.isAura = !!out.isAura;

    out.duration = Math.max(1, Number(out.duration ?? out.remaining ?? 1) || 1);
    out.remaining = Math.max(0, Number(out.remaining ?? out.duration) || 0);
    out.cleanseDC = Math.max(0, Number(out.cleanseDC ?? 0) || 0);

    out.dot = out.dot ?? {};
    out.dot.flat = Number(out.dot.flat ?? 0) || 0;
    out.dot.formula = String(out.dot.formula ?? "").trim();
    out.dot.perTick = Number(out.dot.perTick ?? out.dot.flat) || 0;

    out.mods = out.mods ?? {};
    out.aura = out.aura ?? null;
    if (out.isAura) {
      out.aura = out.aura ?? {};
      out.aura.min = Number(out.aura.min ?? 0) || 0;
      out.aura.max = Number(out.aura.max ?? 0) || 0;
      out.aura.target = String(out.aura.target ?? "allies");
      out.aura.key = String(out.aura.key ?? out.label ?? "aura");
    }
    return out;
  }

  // Si c’est l’ancien format V1 (modsFlat/modsPct + dot.perTick ou dot.base/per/perStep)
  if (st.key && st.label && (st.modsFlat || st.modsPct || st.dot)) {
    const out = {
      id: String(st.id ?? foundry.utils.randomID()),
      label: String(st.label ?? "État").trim() || "État",
      type: String(st.key ?? "custom"),
      isAura: false,
      duration: Math.max(1, Number(st.remaining ?? 1) || 1),
      remaining: Math.max(0, Number(st.remaining ?? 0) || 0),
      cleanseDC: Math.max(0, Number(st.cleanseDC ?? 0) || 0),
      dot: { flat: 0, formula: "", perTick: 0 },
      mods: {}
    };

    // DOT : si perTick existe
    if (st.dot?.perTick != null) {
      out.dot.flat = Number(st.dot.perTick) || 0;
      out.dot.perTick = out.dot.flat;
    }

    // DOT : si “scalé” base/per/perStep (legacyToNew)
    if (st.dot?.base != null || st.dot?.perStep != null) {
      const snap = Number(st.source?.snap ?? 0) || 0;
      const perTick = scaleValue(st.dot, snap); // réutilise TA fonction scaleValue déjà dans ce fichier
      out.dot.flat = Number(perTick) || 0;
      out.dot.perTick = out.dot.flat;
    }

    // Convertit modsFlat/modsPct -> mods[key]={flat,pct}
    const groups = ["principales", "defenses", "ressources", "regen", "move", "initiative"];
    const mapBack = {
      principales: { force: "force", dexterite: "dexterite", intelligence: "intelligence", acuite: "acuite", endurance: "endurance" },
      defenses: { armureFixe: "armureFixe", resistanceFixe: "resistanceFixe", scoreArmure: "scoreArmure", scoreResistance: "scoreResistance" },
      ressources: { pvMax: "pvMax", manaMax: "manaMax" },
      regen: { pv: "regenPv", mana: "regenMana" },
      move: { vitesse: "vitesse" },
      initiative: { mod: "initiativeMod" }
    };

    for (const g of groups) {
      const f = st.modsFlat?.[g] ?? {};
      const p = st.modsPct?.[g] ?? {};
      for (const [k, v2Key] of Object.entries(mapBack[g] ?? {})) {
        const flat = Number(f?.[k] ?? 0) || 0;
        const pct = Number(p?.[k] ?? 0) || 0;
        if (flat !== 0 || pct !== 0) out.mods[v2Key] = { flat, pct };
      }
    }

    return out;
  }

  // Si c’est très vieux format (name/duration/dotFlat/debuff)
  if (st.name || st.duration || st.debuff || st.dotFlat != null) {
    const v1 = legacyToNew(st, null);   // tu as déjà legacyToNew dans ce fichier
    return normalizeStateV2(v1);        // convertit ensuite en V2
  }

  return null;
}


/**
 * Tick au début du tour d'un actor:
 * - applique DOT (si présent)
 * - décrémente remaining
 * - supprime les effets à 0
 *
 * IMPORTANT: pas de jets ici, juste les ticks.
 */
export async function tickActorEffectsAtTurnStart(actor) {
  const list = Array.isArray(actor.system?.etatsActifs) ? foundry.utils.deepClone(actor.system.etatsActifs) : [];
  if (!list.length) return;

  let pv = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
  const pvMax = Number(actor.system?.ressources?.pv?.max ?? 0) || 0;

  const survivors = [];
  let totalDot = 0;

  for (const e of list) {
    const remaining = Math.max(0, Number(e?.remaining ?? 0) || 0);
    if (remaining <= 0) continue;

    // DOT
    const rawDot = Math.max(0, Number(e?.dot?.perTick ?? e?.dot?.flat ?? 0) || 0);
    if (rawDot > 0) totalDot += rawDot;

    // ✅ auraApplied: ne décrémente jamais (géré par refreshAuras)
    if (String(e?.type) === "auraApplied") {
      survivors.push(e);
      continue;
    }

    // ✅ le reste décrémente normalement (y compris aura source)
    const nextRemaining = Math.max(0, remaining - 1);
    if (nextRemaining > 0) survivors.push({ ...e, remaining: nextRemaining });
  }

  const updates = { "system.etatsActifs": survivors };

  if (totalDot > 0) {
    pv = Math.max(0, pv - totalDot);
    updates["system.ressources.pv.valeur"] = pv;
  }

  await actor.update(updates);

  if (totalDot > 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<b>${actor.name}</b> subit <b>${totalDot}</b> dégâts (effets). PV: ${pv}/${pvMax}`
    });
  }
}


/**
 * Sommes des debuffs à appliquer en "temps réel" dans prepareDerivedData()
 * Retour: { flat, pct }
 */
function add(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  while (parts.length > 1) {
    const k = parts.shift();
    cur[k] = cur[k] ?? {};
    cur = cur[k];
  }
  const last = parts[0];
  cur[last] = (Number(cur[last]) || 0) + (Number(value) || 0);
}

const KEY_TO_BUCKET = {
  // principales
  force: ["principales", "force"],
  intelligence: ["principales", "intelligence"],
  dexterite: ["principales", "dexterite"],
  acuite: ["principales", "acuite"],
  endurance: ["principales", "endurance"],

  // defenses
  armureFixe: ["defenses", "armureFixe"],
  resistanceFixe: ["defenses", "resistanceFixe"],
  scoreArmure: ["defenses", "scoreArmure"],
  scoreResistance: ["defenses", "scoreResistance"],

  // ressources max
  pvMax: ["ressources", "pvMax"],
  manaMax: ["ressources", "manaMax"],

  // regen
  regenPv: ["regen", "pv"],
  regenMana: ["regen", "mana"],

  // move
  vitesse: ["move", "vitesse"],

  // initiative
  initiativeMod: ["initiative", "mod"],

  // combat — bonus direct à la chance de toucher (réduit le TN nécessaire)
  toucherPhysique: ["combat", "toucherPhysique"],
  toucherMagique: ["combat", "toucherMagique"],

  // ressources — fatigue max (équipement/buffs)
  fatigueMax: ["ressources", "fatigueMax"],

  // charge — capacité de transport (le sheet l'offrait déjà sans qu'il soit câblé)
  podsMax: ["charge", "podsMax"]
};

export function sumActiveEffectMods(actor) {
  const states = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];

  const out = {
    flat: {
      principales: {}, defenses: {}, ressources: {}, regen: {}, move: {}, initiative: {}
    },
    pct: {
      principales: {}, defenses: {}, ressources: {}, regen: {}, move: {}, initiative: {}
    },
    dot: {
      flatTotal: 0,
      formulas: []
    }
  };

  for (const stRaw of states) {
    // ── Normalise vers format V2 si besoin ──────────────────────
    let st = stRaw;
    if (!st?.mods && (st?.debuff || st?.modsFlat || st?.modsPct)) {
      st = normalizeStateV2(stRaw) ?? stRaw;
    }

    const mods = st?.mods ?? {};

    // DOT
    const dotFlat = Number(st?.dot?.flat ?? st?.dot?.perTick ?? 0) || 0;
    if (dotFlat) out.dot.flatTotal += dotFlat;

    const dotFormula = String(st?.dot?.formula ?? "").trim();
    if (dotFormula) out.dot.formulas.push(dotFormula);

    // MODS flat / pct
    for (const [key, mod] of Object.entries(mods)) {
      const map = KEY_TO_BUCKET[key];
      if (!map) continue;

      const flat = Number(mod?.flat ?? 0) || 0;
      const pct  = Number(mod?.pct  ?? 0) || 0;

      const pathBase = map[0] + "." + map[1];
      if (flat) add(out.flat, pathBase, flat);
      if (pct)  add(out.pct,  pathBase, pct);
    }
  }

  return out;
}

export async function upsertEffect(targetActor, effectLike) {
  const e = normalizeEffectInstance(effectLike, targetActor);
  if (!e) return;

  const cur = Array.isArray(targetActor.system?.etatsActifs) ? targetActor.system.etatsActifs : [];
  const next = cur.map(x => normalizeEffectInstance(x, targetActor)).filter(Boolean);

  const idx = next.findIndex(x => x.id === e.id);
  if (idx >= 0) next[idx] = e;
  else next.push(e);

  await targetActor.update({ "system.etatsActifs": next });
}

