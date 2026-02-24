// systems/rpg/module/sheets/character-sheet.js
import { buildSpellUI, buildSpellEffectsPreview, declareSpell } from "../rules/spells.js";

/* -------------------------------------------- */
/* Utils XP / Skills                            */
/* -------------------------------------------- */

function xpPalierForLevel(level) {
  const n = Math.max(1, Number(level) || 1);
  const x = n - 1;
  return Math.round(100 + 40 * x + 15 * x * x);
}

function skillXpToNext(currentLevel) {
  return 100 + 50 * Math.max(0, Number(currentLevel) || 0);
}
function skillsTotalLevels(skills) {
  if (!skills) return 0;
  return Object.values(skills).reduce((a, s) => a + (Number(s?.level) || 0), 0);
}
function skillsLevelCap(actor) {
  const lvl = Number(actor.system?.niveau || 1);
  return 10 + 2 * lvl;
}

function getSpellDamagePreview(actor, item, result = "success") {
  const sys = item.system ?? {};

  // si pas de damage config => rien
  const dice = String(sys.damage?.dice ?? sys.degats ?? "").trim();
  const flatBase = Number(sys.damage?.flat ?? 0) || 0;

  if (!dice && !flatBase) return null;

  const effP =
    actor.system?.derived?.effP ??
    actor.system?.derived?.effective?.principales ??
    actor.system?.principales ??
    {};

  // scaling “damage.scaling”
  const sc = sys.damage?.scaling ?? null;
  let scaleFlat = 0;

  if (sc) {
    const stat = String(sc.stat ?? "intelligence");
    const per = Math.max(1, Number(sc.per ?? 10) || 10);
    const step = Number(sc.perStep ?? 1) || 1;
    const statVal = Number(effP?.[stat] ?? 0) || 0;
    scaleFlat = Math.floor(statVal / per) * step;
  }

  let flat = flatBase + scaleFlat;

  // crit => double flat (comme tes états)
  if (result === "crit") flat *= 2;

  return { flat, dice };
}

async function addXpToSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  const add = Number(amount) || 0;
  if (!add) return;

  s.xp = Math.max(0, (Number(s.xp) || 0) + add);

  const cap = skillsLevelCap(actor);

  while (true) {
    const total = skillsTotalLevels(skills);
    if (total >= cap) break;

    const lvl = Number(s.level) || 0;
    const need = skillXpToNext(lvl);
    if (s.xp < need) break;

    s.xp -= need;
    s.level = lvl + 1;
  }

  skills[skillKey] = s;
  await actor.update({ "system.skills": skills });
  if (actor.sheet) actor.sheet.render(false);
}

async function removeXpFromSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  let sub = Math.abs(Number(amount) || 0);
  if (!sub) return;

  while (sub > 0) {
    const curXp = Number(s.xp) || 0;

    if (curXp >= sub) {
      s.xp = curXp - sub;
      sub = 0;
      break;
    }

    sub -= curXp;
    s.xp = 0;

    const lvl = Number(s.level) || 0;
    if (lvl <= 0) {
      sub = 0;
      break;
    }

    s.level = lvl - 1;
    s.xp = skillXpToNext(s.level) - 1;
  }

  skills[skillKey] = s;
  await actor.update({ "system.skills": skills });
  if (actor.sheet) actor.sheet.render(false);
}

/* -------------------------------------------- */
/* Effets / Auras helpers                        */
/* -------------------------------------------- */

const LABELS = {
  // primaires
  force: "Force",
  dexterite: "Dextérité",
  intelligence: "Intelligence",
  acuite: "Acuité",
  endurance: "Endurance",

  // ressources & divers
  pvMax: "PV max",
  manaMax: "Mana max",
  regenPv: "Régén PV",
  regenMana: "Régén Mana",
  vitesse: "Vitesse",

  // défenses
  scoreArmure: "Score Armure",
  scoreResistance: "Score Résistance",
  armureFixe: "Armure fixe",
  resistanceFixe: "Résistance fixe",

  // (si tu utilises des dérivés perso)
  defense: "Défense",
  resistance: "Résistance",
  savoir: "Savoir",
  initiative: "Initiative"
};

/**
 * Convertit item.system.effectsUI (UI) -> mods: { force:{flat,pct}, ... }
 * Ici on garde uniquement flat/pct numériques.
 */
function buildModsFromEffectsUI(effectsUI) {
  const mods = {};
  const arr = Array.isArray(effectsUI) ? effectsUI : [];
  for (const fx of arr) {
    const mds = Array.isArray(fx?.mods) ? fx.mods : [];
    for (const m of mds) {
      const stat = String(m?.stat ?? "").trim();
      if (!stat) continue;

      const mode = (m?.mode === "pct") ? "pct" : "flat";
      const valueType = (m?.valueType === "formula") ? "formula" : "fixed";

      let v = 0;
      if (valueType === "fixed") v = Number(m?.value ?? 0) || 0;
      else v = Number(m?.value ?? 0) || 0; // fallback

      if (!mods[stat]) mods[stat] = { flat: 0, pct: 0 };
      mods[stat][mode] += v;
    }
  }
  return mods;
}

/**
 * Résumé lisible
 */
function summarizeMods(mods = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(mods)) {
    const flat = Number(v?.flat ?? 0) || 0;
    const pct = Number(v?.pct ?? 0) || 0;
    if (flat) parts.push(`${LABELS[k] ?? k} ${flat > 0 ? "+" : ""}${flat}`);
    if (pct) parts.push(`${LABELS[k] ?? k} ${pct > 0 ? "+" : ""}${pct}%`);
  }
  return parts.join(" • ");
}

/**
 * Applique le critique sur un état:
 * - double mods
 * - double dot.flat
 */
function applyCritToState(state) {
  const out = foundry.utils.deepClone(state);

  if (out.mods) {
    for (const k of Object.keys(out.mods)) {
      const flat = Number(out.mods[k]?.flat ?? 0) || 0;
      const pct = Number(out.mods[k]?.pct ?? 0) || 0;
      out.mods[k] = { flat: flat * 2, pct: pct * 2 };
    }
  }

  if (out.dot) {
    const flat = Number(out.dot.flat ?? 0) || 0;
    out.dot.flat = flat * 2;
    out.dot.perTick = Number(out.dot.perTick ?? out.dot.flat) || 0;
  }

  out.label = `${out.label} (Crit)`;
  return out;
}

/**
 * Normalize state (format v2)
 */
function normalizeState(st, forcedId = null) {
  const out = foundry.utils.deepClone(st ?? {});
  out.id = String(forcedId || out.id || foundry.utils.randomID());

  out.label = String(out.label ?? "").trim() || "État";
  out.type = String(out.type ?? "custom").trim();

  out.isAura = !!out.isAura;

  out.duration = Math.max(1, Number(out.duration ?? 1) || 1);
  out.remaining = Math.max(0, Number(out.remaining ?? out.duration) || 0);
  out.cleanseDC = Math.max(0, Number(out.cleanseDC ?? 0) || 0);

  out.dot = out.dot ?? {};
  out.dot.flat = Number(out.dot.flat ?? 0) || 0;
  out.dot.formula = String(out.dot.formula ?? "").trim();
  out.dot.perTick = Number(out.dot.perTick ?? out.dot.flat) || 0;

  out.mods = out.mods ?? {};

  if (out.isAura) {
    out.aura = out.aura ?? {};
    out.aura.min = Number(out.aura.min ?? 0) || 0;
    out.aura.max = Number(out.aura.max ?? 0) || 0;
    out.aura.target = String(out.aura.target ?? "allies"); // allies|enemies|both
    out.aura.linkedItemId = String(out.aura.linkedItemId ?? "");
    out.aura.expiresWithCooldown = !!out.aura.expiresWithCooldown;
  }

  return out;
}

/**
 * Upsert dans system.etatsActifs
 */
async function upsertStateOnActor(actor, state) {
  const list = Array.isArray(actor.system?.etatsActifs) ? foundry.utils.deepClone(actor.system.etatsActifs) : [];
  const id = String(state.id || foundry.utils.randomID());
  const idx = list.findIndex(e => String(e.id) === id);

  const normalized = normalizeState(state, id);

  if (idx >= 0) list[idx] = { ...list[idx], ...normalized };
  else list.push(normalized);

  await actor.update({ "system.etatsActifs": list });

  if (game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);
}

/**
 * Crée un état "aura source" à partir d’un sort
 * IMPORTANT: aura range = system.aura.range si présent, sinon fallback sur system.range
 */
function buildAuraStateFromSpell({ actor, item, result }) {
  const auraMin =
    Number(item.system?.aura?.range?.min ?? item.system?.aura?.min ?? item.system?.range?.min ?? 0) || 0;

  const auraMax =
    Number(item.system?.aura?.range?.max ?? item.system?.aura?.max ?? item.system?.range?.max ?? 0) || 0;

  const auraTarget = String(item.system?.aura?.target ?? "allies");

  const cdRestant = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
  const cdMax = Number(item.system?.cooldown?.max ?? item.system?.recharge?.max ?? 0) || 0;

  const mods = buildModsFromEffectsUI(item.system?.effectsUI);
  const dotFlat = Number(item.system?.aura?.dotFlat ?? 0) || 0;

  let state = {
    id: foundry.utils.randomID(),
    label: item.name,
    type: "aura",
    isAura: true,

    duration: Math.max(1, cdMax || cdRestant || 1),
    remaining: Math.max(1, cdRestant || cdMax || 1),

    cleanseDC: Number(item.system?.aura?.cleanseDC ?? 0) || 0,
    dot: { flat: dotFlat, formula: "", perTick: dotFlat },
    mods,

    aura: {
      min: auraMin,
      max: auraMax,
      target: auraTarget,
      linkedItemId: item.id,
      expiresWithCooldown: true
    }
  };

  if (result === "crit") state = applyCritToState(state);
  return normalizeState(state);
}

/**
 * Résolution MJ : fail / success / crit
 * - success/crit : applique effets
 * - aura : crée l’état aura source + refresh propagation
 */
// async function resolveSpell({ actor, item, result }) {
//   if (!game.user.isGM) return { ok: false, reason: "GM only" };

//   if (result === "fail") {
//     await ChatMessage.create({
//       speaker: ChatMessage.getSpeaker({ actor }),
//       content: `<b>${actor.name}</b> échoue <b>${item.name}</b>.`
//     });
//     return { ok: true };
//   }

//   if (result !== "success" && result !== "crit") result = "success";

//   // ✅ aura active/enabled (compat)
//   const isAura = !!(item.system?.aura?.active || item.system?.aura?.enabled);

//   if (isAura) {
//     const auraState = buildAuraStateFromSpell({ actor, item, result });

//     await upsertStateOnActor(actor, auraState);

//     const modsTxt = summarizeMods(auraState.mods) || "<i>aucun</i>";
//     const dot = Number(auraState?.dot?.flat ?? 0) || 0;
//     const dotTxt = dot ? ` • DOT <b>${dot}</b>/tour` : "";
//     const dmgPreview = getSpellDamagePreview(actor, item, result);
//     const dmgTxt = dmgPreview
//       ? `💥 <b>Dégâts (preview)</b> → <b>${dmgPreview.flat}</b> + <b>${dmgPreview.dice}</b><br>`
//       : "";
//     await ChatMessage.create({
//       speaker: ChatMessage.getSpeaker({ actor }),
//       content:
//         `<b>${actor.name}</b> ${result === "crit" ? "valide en <b>CRITIQUE</b>" : "valide"} le sort <b>${item.name}</b>.<br>` +
//         `🌀 <b>Aura</b> → Cible: <b>${auraState.aura.target}</b> • Portée: <b>${auraState.aura.min}–${auraState.aura.max}</b>${dotTxt}<br>` +
//         `✨ <b>Effets</b> → ${modsTxt}`
//         + (dmgTxt ? `<hr>${dmgTxt}` : "")
//     });

//     if (globalThis.RPG_AURAS?.refreshAuras) await globalThis.RPG_AURAS.refreshAuras();
//     return { ok: true };
//   }

//   // non aura : applique sur une cible (token ciblé par le MJ)
//   const targetToken = Array.from(game.user.targets)[0] ?? null;
//   const targetActor = targetToken?.actor ?? null;

//   const mods = buildModsFromEffectsUI(item.system?.effectsUI);
//   const dotFlat = Number(item.system?.dotFlat ?? 0) || 0;
//   const hasSomething = summarizeMods(mods) || dotFlat;

//   if (!hasSomething) {
//     await ChatMessage.create({
//       speaker: ChatMessage.getSpeaker({ actor }),
//       content: `<b>${actor.name}</b> ${result === "crit" ? "réussit en <b>CRITIQUE</b>" : "réussit"} <b>${item.name}</b>.`
//     });
//     return { ok: true };
//   }

//   if (!targetActor) {
//     ui.notifications.warn("MJ: cible un token (T) pour appliquer l'effet du sort.");
//     await ChatMessage.create({
//       speaker: ChatMessage.getSpeaker({ actor }),
//       content:
//         `<b>${actor.name}</b> ${result === "crit" ? "réussit en <b>CRITIQUE</b>" : "réussit"} <b>${item.name}</b>, ` +
//         `mais aucune cible n’est sélectionnée pour appliquer l’effet.`
//     });
//     return { ok: true };
//   }

//   let st = normalizeState({
//     id: foundry.utils.randomID(),
//     label: item.name,
//     type: "spell",
//     isAura: false,
//     duration: Number(item.system?.effectsDuration ?? 2) || 2,
//     remaining: Number(item.system?.effectsDuration ?? 2) || 2,
//     cleanseDC: Number(item.system?.cleanseDC ?? 0) || 0,
//     dot: { flat: dotFlat, formula: "", perTick: dotFlat },
//     mods
//   });

//   if (result === "crit") st = applyCritToState(st);

//   await upsertStateOnActor(targetActor, st);

//   await ChatMessage.create({
//     speaker: ChatMessage.getSpeaker({ actor }),
//     content:
//       `<b>${actor.name}</b> ${result === "crit" ? "réussit en <b>CRITIQUE</b>" : "réussit"} <b>${item.name}</b> sur <b>${targetActor.name}</b>.<br>` +
//       `<b>Mods:</b> ${summarizeMods(st.mods) || "<i>aucun</i>"}`
//   });

//   return { ok: true };
// }

/* -------------------------------------------- */
/* Sheet Class                                  */
/* -------------------------------------------- */

export class RPGCharacterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["rpg-sheet", "sheet", "actor"],
      template: "systems/rpg/templates/actor/character-sheet.hbs",
      width: 980,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  async getData(options) {
    const data = await super.getData(options);

    const itemDocs = Array.from(this.actor.items);
    const itemsObj = itemDocs.map(i => i.toObject());
    const categorized = this._categorizeItems(itemsObj);
    const charge = this._calcCharge(categorized);

    const isGM = game.user.isGM;
    const isOwner = this.actor.isOwner;

    // --- Spells UI : utiliser le document ---
    for (const s of categorized.sorts) {
      const doc = this.actor.items.get(s._id);
      if (!doc) continue;

      const ui = buildSpellUI({ actor: this.actor, item: doc });
      s._ui = ui?.text ?? {};

      s._previewEffects = buildSpellEffectsPreview({ actor: this.actor, item: doc }) ?? [];

      const cdRestant = Number(doc.system?.cooldown?.restant ?? doc.system?.recharge?.restant ?? 0) || 0;
      s._ui.onCooldown = cdRestant > 0;
      s._ui.cdRestant = cdRestant;
      s._ui.cdMax = Number(doc.system?.cooldown?.max ?? doc.system?.recharge?.max ?? 0) || 0;

      // aura ?
      s._ui.isAura = !!(doc.system?.aura?.active || doc.system?.aura?.enabled);
    }

    data.items = categorized;
    data.charge = charge;
    data.equipSlots = this._buildEquipSlotsUI(itemsObj);

    data.flags = {
      isGM,
      isOwner,
      limitedView: !isGM && !isOwner,
      readOnly: !isGM
    };

    // XP display
    const lvl = Number(this.actor.system?.niveau) || 1;
    const xpValeur = Math.max(0, Number(this.actor.system?.xp?.valeur) || 0);
    const xpPalier = xpPalierForLevel(lvl);
    const xpPct = xpPalier > 0 ? Math.min(100, Math.round((xpValeur / xpPalier) * 100)) : 0;

    data.calc = { xpValeur, xpPalier, xpPct };

    data.system = data.actor.system;

    // states arrays
    data.system.etatsInit = Array.isArray(data.system.etatsInit) ? data.system.etatsInit : [];
    data.system.etatsActifs = Array.isArray(data.system.etatsActifs) ? data.system.etatsActifs : [];

    // skills
    data.system.skills = data.system.skills ?? {};
    data.skills = Object.entries(data.system.skills).map(([key, s]) => {
      const level = Number(s?.level ?? 0) || 0;
      const xp = Number(s?.xp ?? 0) || 0;
      const next = skillXpToNext(level);
      const pct = next > 0 ? Math.min(100, Math.round((xp / next) * 100)) : 0;

      return {
        key,
        label: s?.label ?? key,
        level,
        xp,
        next,
        pct,
        grants: s?.grants ?? {}
      };
    });

    data.calc.skillsTotal = skillsTotalLevels(data.system.skills);
    data.calc.skillsCap = skillsLevelCap(this.actor);

    // états actifs: summary + tags
    const states = Array.isArray(data.system?.etatsActifs)
      ? foundry.utils.deepClone(data.system.etatsActifs)
      : [];

    for (const e of states) {
      const parts = [];

      const dot = e?.dot?.perTick ?? 0;
      if (Number(dot) > 0) parts.push(`DOT ${dot}`);

      const mods = e?.mods ?? {};
      const modSummary = summarizeMods(mods);
      if (modSummary) parts.push(modSummary);

      let hasPlus = false, hasMinus = false;
      for (const v of Object.values(mods)) {
        const flat = Number(v?.flat ?? 0) || 0;
        const pct = Number(v?.pct ?? 0) || 0;
        if (flat > 0 || pct > 0) hasPlus = true;
        if (flat < 0 || pct < 0) hasMinus = true;
      }
      e.isBeneficial = hasPlus && !hasMinus;
      e.isHarmful = hasMinus && !hasPlus;

      e.summary = parts.join(" • ");
    }

    data.system.etatsActifs = states;

    // effP (compat initiative/formules)
    data.effP = this.actor.system?.derived?.effP
      ?? this.actor.system?.derived?.effective?.principales
      ?? this.actor.system?.principales
      ?? {};

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Debounce pods update
    if (typeof this._debouncedPodsUpdate !== "function") {
      this._debouncedPodsUpdate = foundry.utils.debounce(
        () => this._updatePodsToActor(),
        150
      );
    }

    // --- Item edit ---
    html.find(".item-edit").on("click", ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      item?.sheet?.render(true);
    });

    // --- Create/Delete items ---
    html.find("[data-action='createItem']").on("click", async ev => {
      const type = ev.currentTarget.dataset.type;
      await this._createItem(type);
      this._debouncedPodsUpdate?.();
    });

    html.find("[data-action='deleteItem']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      const itemId = ev.currentTarget.dataset.itemId || li?.dataset?.itemId;
      if (!itemId) return;
      await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
      this._debouncedPodsUpdate?.();
    });

    // --- Equip toggle (bouton) ---
    html.find("[data-action='toggleEquip']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      if (!item) return;

      const equipe = !!item.system.equipe;
      const type = item.type;
      const slot = item.system?.emplacement;

      const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);

      const unequipItems = async (items) => {
        if (!items.length) return;
        await this.actor.updateEmbeddedDocuments("Item",
          items.map(it => ({ _id: it.id, "system.equipe": false }))
        );
      };

      if (equipe) {
        await item.update({ "system.equipe": false });
        return;
      }

      const equipped = this.actor.items.filter(i => i.system?.equipe);

      if (type === "weapon") {
        const twoHands = !!item.system?.twoHands;

        if (!HAND_SLOTS.has(slot)) {
          return ui.notifications.warn("Une arme doit avoir emplacement mainDroite ou mainGauche.");
        }

        const equippedInHands = equipped.filter(i => HAND_SLOTS.has(i.system?.emplacement));

        if (twoHands) {
          await unequipItems(equippedInHands);
          await item.update({ "system.equipe": true });
          return;
        } else {
          const equippedTwoHands = equipped.filter(i => i.type === "weapon" && i.system?.equipe && i.system?.twoHands);
          await unequipItems(equippedTwoHands);

          const sameSlot = equipped.filter(i => i.system?.emplacement === slot);
          await unequipItems(sameSlot);

          await item.update({ "system.equipe": true });
          return;
        }
      }

      if (!slot) {
        return ui.notifications.warn("Cet objet n'a pas d'emplacement défini (system.emplacement).");
      }

      const conflicts = equipped.filter(i => i.id !== item.id && i.system?.emplacement === slot);
      await unequipItems(conflicts);

      await item.update({ "system.equipe": true });
    });

    // Lancer un sort (PJ / propriétaire)
    html.find('[data-action="castSpell"]').on("click", async (ev) => {
      ev.preventDefault();

      const itemId =
        ev.currentTarget.dataset.itemId ||
        ev.currentTarget.closest("[data-item-id]")?.dataset?.itemId;

      if (!itemId) return;

      const item = this.actor.items.get(itemId);
      if (!item) return ui.notifications.warn("Sort introuvable.");

      const res = await declareSpell(this.actor, item);
      if (!res?.ok) return ui.notifications.warn(res?.reason ?? "Impossible de lancer le sort.");

      // Rafraîchit la fiche pour voir mana/cd
      this.render(false);
    });

    // --- Equip via slot select ---
    html.find("select[data-action='equipSlotSelect']").on("change", async (ev) => {
      ev.preventDefault();
      if (!this.actor.isOwner) return;

      const slot = ev.currentTarget.dataset.slot;
      const itemId = ev.currentTarget.value || "";
      await this._onEquipSlotChange(slot, itemId);

      this._debouncedPodsUpdate?.();
      this.render(false);
    });

    // --- Qty/poids update -> pods ---
    html.find("input[data-field]").on("change", async ev => {
      const input = ev.currentTarget;
      const li = input.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      if (!item) return;

      const field = input.dataset.field;
      const value = Number(input.value ?? 0);
      await item.update({ [field]: value });

      this._debouncedPodsUpdate?.();
    });

    // --- Ajustement PV/Mana GM ---
    html.find("[data-action='adjRes']").on("click", async ev => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const res = ev.currentTarget.dataset.res; // pv|mana
      const delta = Number(ev.currentTarget.dataset.delta) || 0;

      const path = `system.ressources.${res}.valeur`;
      const cur = Number(foundry.utils.getProperty(this.actor, path)) || 0;
      await this.actor.update({ [path]: cur + delta });
    });

    /* -------------------------------------------- */
    /* SPELL WORKFLOW : Déclarer / Resolve GM         */
    /* -------------------------------------------- */

    html.find('[data-action="declareSpell"]').on("click", async (ev) => {
      ev.preventDefault();

      const li = ev.currentTarget.closest("[data-item-id]");
      const itemId = li?.dataset?.itemId || ev.currentTarget.dataset.itemId;
      if (!itemId) return;

      const item = this.actor.items.get(itemId);
      if (!item) return;

      const res = await declareSpell(this.actor, item);
      if (!res?.ok) ui.notifications.warn(res?.reason ?? "Impossible de déclarer le sort.");
      this.render(false);
    });

    /* -------------------------------------------- */
    /* Attaque / déclaration TN (preview chat)       */
    /* -------------------------------------------- */

    html.find("[data-action='useItem']").on("click", async (ev) => {
      ev.preventDefault();

      const itemId =
        ev.currentTarget.dataset.itemId ||
        ev.currentTarget.closest(".item")?.dataset?.itemId;

      const item = this.actor.items.get(itemId);
      if (!item) return;

      const targetToken = Array.from(game.user.targets)[0];
      if (!targetToken) {
        return ui.notifications.warn("Cible un ennemi (Target : touche T) avant d'utiliser une attaque/sort.");
      }

      const target = targetToken.actor;
      if (!target) return;

      const cd = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
      if (cd > 0) return ui.notifications.warn(`Sort en recharge : ${cd} tour(s).`);

      const type = item.type;
      const livraison = item.system?.livraison ?? (type === "spell" ? "magique" : "physique");
      const diff = Number(item.system?.difficulte ?? 0) || 0;

      const Combat = game.rpg?.combat;
      if (!Combat?.computeTN) {
        ui.notifications.error("Combat API introuvable: game.rpg.combat.computeTN");
        return;
      }

      const tnRes = Combat.computeTN(this.actor, target, item);
      let tnBase = 11;
      let tnFinal = 11;

      if (typeof tnRes === "number") {
        tnBase = tnRes;
        tnFinal = tnRes + diff;
      } else if (tnRes && typeof tnRes === "object") {
        tnBase = Number(tnRes.tnBase ?? tnRes.base ?? tnRes.tn ?? 11) || 11;
        tnFinal = Number(tnRes.tnFinal ?? tnRes.final ?? (tnBase + diff)) || (tnBase + diff);
      } else {
        tnBase = 11;
        tnFinal = 11 + diff;
      }

      tnFinal = Math.max(2, Math.min(20, tnFinal));

      const effP =
        this.actor.system?.derived?.effP ??
        this.actor.system?.derived?.effective?.principales ??
        this.actor.system?.principales ??
        {};

      const dmgStat = (livraison === "physique")
        ? Number(effP.force ?? 0)
        : Number(effP.intelligence ?? 0);

      const statBonus = game.rpg.combat.bonusFromStat(dmgStat);

      const flatFixe = Number(item.system?.degatsFixes ?? 0) || 0;
      const flatAdd = Number(item.system?.degatsAdd ?? 0) || 0;

      const flatTotal = statBonus + flatFixe + flatAdd;
      const degatsFormula = String(item.system?.degats ?? "1d6");
      const etats = String(item.system?.etatsInfliges ?? "").trim();

      const content =
        `<b>${this.actor.name}</b> utilise <b>${item.name}</b> sur <b>${target.name}</b> ` +
        `(${livraison === "physique" ? "Physique" : "Magique"})<br>` +
        `Seuil toucher: <b>${tnFinal}+</b> (base ${tnBase}+ ; difficulté +${diff})<br>` +
        `Dégâts: <b>${flatTotal}</b> + <b>${degatsFormula}</b><br>` +
        (etats ? `États: <b>${etats}</b><br>` : "");

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content
      });
    });

    /* -------------------------------------------- */
    /* États add/edit/delete                         */
    /* -------------------------------------------- */

    html.find("[data-action='stateAdd']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const st = this._stateDefaults();
      const edited = await this._editStateDialog(st, { title: "Ajouter un état" });
      if (!edited) return;

      await this._stateUpsert(edited);
      this.render(false);
    });

    html.find("[data-action='stateEdit']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return ui.notifications.warn("État introuvable.");

      const edited = await this._editStateDialog(st, { title: "Modifier l’état" });
      if (!edited) return;

      await this._stateUpsert(edited);
      this.render(false);
    });

    html.find("[data-action='stateDelete']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const id = ev.currentTarget.dataset.id;
      await this._stateRemove(id);
      this.render(false);

      if (globalThis.RPG_AURAS?.refreshAuras) await globalThis.RPG_AURAS.refreshAuras();
    });

    html.find("[data-action='stateShow']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return;

      await this._postStateInfoToChat(st);
    });

    /* -------------------------------------------- */
    /* Skills XP                                     */
    /* -------------------------------------------- */

    html.find("[data-action='skillAddXp']").on("click", async (ev) => {
      ev.preventDefault();
      const li = ev.currentTarget.closest("[data-skill]");
      const key = li?.dataset?.skill;
      if (!key) return;

      const amt = Number(li.querySelector(".skill-xp-add")?.value || 0);
      await addXpToSkill(this.actor, key, amt);
    });

    html.find("[data-action='skillRemoveXp']").on("click", async (ev) => {
      ev.preventDefault();
      const li = ev.currentTarget.closest("[data-skill]");
      const key = li?.dataset?.skill;
      if (!key) return;

      const amt = Number(li.querySelector(".skill-xp-add")?.value || 0);
      await removeXpFromSkill(this.actor, key, amt);
    });
  }

  /* -------------------------------------------- */
  /* Pods calc                                     */
  /* -------------------------------------------- */

  async _updatePodsToActor() {
    if (!this.actor.isOwner && !game.user.isGM) return;

    let total = 0;
    for (const item of this.actor.items) {
      const sys = item.system ?? {};
      const qte = Number(sys.qte ?? 1) || 1;
      const poids = Number(sys.poids ?? 0) || 0;
      total += poids * qte;
    }

    total = Math.round(total * 10) / 10;

    const cur = Number(this.actor.system?.charge?.podsActuels ?? 0) || 0;
    if (Math.abs(cur - total) < 0.05) return;

    await this.actor.update({ "system.charge.podsActuels": total });
  }

  /* -------------------------------------------- */
  /* Item categorization / charge                  */
  /* -------------------------------------------- */

  _categorizeItems(items) {
    const out = { inventaire: [], equipe: [], nonEquipe: [], consommables: [], sorts: [], competences: [] };

    for (const it of items) {
      it.system = it.system ?? {};
      it.system.qte = it.system.qte ?? 1;
      it.system.poids = it.system.poids ?? 0;

      const qte = Number(it.system.qte) || 0;
      const poids = Number(it.system.poids) || 0;

      it._derived = it._derived ?? {};
      it._derived.poidsTotal = Number((qte * poids).toFixed(2));

      const t = it.type;
      const estEquip = (t === "weapon" || t === "armor");
      const equipe = !!it.system.equipe;

      if (t === "consumable") out.consommables.push(it);
      else if (t === "spell") out.sorts.push(it);
      else if (t === "skill") out.competences.push(it);
      else if (estEquip && equipe) out.equipe.push(it);
      else if (estEquip && !equipe) out.nonEquipe.push(it);
      else out.inventaire.push(it);
    }

    return out;
  }

  _calcCharge(cat) {
    const all = [
      ...cat.inventaire,
      ...cat.equipe,
      ...cat.nonEquipe,
      ...cat.consommables,
      ...cat.sorts,
      ...cat.competences
    ];

    const podsActuels = all.reduce((acc, it) => acc + (Number(it._derived?.poidsTotal) || 0), 0);
    const podsMax = Number(this.actor.system?.charge?.podsMax ?? 0) || 0;

    const pct = podsMax > 0 ? Math.min(999, Math.round((podsActuels / podsMax) * 100)) : 0;

    let etat = "Normal";
    if (podsMax > 0) {
      if (pct >= 120) etat = "Surchargé";
      else if (pct >= 90) etat = "Lourd";
      else if (pct >= 60) etat = "Chargé";
    }

    return { podsActuels: Number(podsActuels.toFixed(2)), podsMax, pct, etat };
  }

  /* -------------------------------------------- */
  /* Equip slots UI & equip logic                  */
  /* -------------------------------------------- */

  _buildEquipSlotsUI(items) {
    const SLOT_DEFS = [
      { key: "tete", label: "Tête", kind: "gear" },
      { key: "torse", label: "Torse", kind: "gear" },
      { key: "taille", label: "Taille", kind: "gear" },
      { key: "bras", label: "Bras", kind: "gear" },
      { key: "mains", label: "Mains", kind: "gear" },
      { key: "jambes", label: "Jambes", kind: "gear" },
      { key: "pieds", label: "Pieds", kind: "gear" },
      { key: "mainDroite", label: "Main droite", kind: "hand" },
      { key: "mainGauche", label: "Main gauche", kind: "hand" },
      { key: "artefact", label: "Artefact", kind: "gear" }
    ];

    const allEquipItems = items.filter(it => it.type === "weapon" || it.type === "armor");
    const equipped = allEquipItems.filter(it => !!it.system?.equipe);

    const bySlot = new Map();
    for (const it of equipped) {
      const slot = it.system?.emplacement;
      if (!slot) continue;

      bySlot.set(slot, it);

      if (it.type === "weapon" && it.system?.twoHands) {
        if (slot === "mainDroite") bySlot.set("mainGauche", it);
        if (slot === "mainGauche") bySlot.set("mainDroite", it);
      }
    }

    return SLOT_DEFS.map(s => {
      const equippedItem = bySlot.get(s.key) ?? null;

      const locked = !!(
        equippedItem &&
        equippedItem.type === "weapon" &&
        equippedItem.system?.twoHands &&
        equippedItem.system?.emplacement !== s.key
      );

      let options = [];
      if (s.kind === "hand") {
        options = allEquipItems
          .filter(i => i.type === "weapon")
          .map(i => ({ ...i, selected: equippedItem?._id === i._id }));
      } else {
        options = allEquipItems
          .filter(i => i.type === "armor")
          .filter(i => (i.system?.emplacement === s.key))
          .map(i => ({ ...i, selected: equippedItem?._id === i._id }));
      }

      if (equippedItem) {
        const qte = Number(equippedItem.system?.qte ?? 1) || 0;
        const poids = Number(equippedItem.system?.poids ?? 0) || 0;
        equippedItem._derived = equippedItem._derived ?? {};
        equippedItem._derived.poidsTotal = Number((qte * poids).toFixed(2));
      }

      return { key: s.key, label: s.label, item: equippedItem, locked, options };
    });
  }

  _findEquippedForSlot(slot) {
    const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);

    return this.actor.items.find(i => {
      if (!(i.type === "weapon" || i.type === "armor")) return false;
      if (!i.system?.equipe) return false;

      const s = i.system?.emplacement;
      if (s === slot) return true;

      if (i.type === "weapon" && i.system?.twoHands && HAND_SLOTS.has(slot)) {
        if (s === "mainDroite" && slot === "mainGauche") return true;
        if (s === "mainGauche" && slot === "mainDroite") return true;
      }
      return false;
    }) ?? null;
  }

  async _onEquipSlotChange(slot, itemId) {
    const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);

    const updates = [];
    const equip = (doc, yes) => updates.push({ _id: doc.id, "system.equipe": !!yes });

    const current = this._findEquippedForSlot(slot);

    if (!itemId) {
      if (current) equip(current, false);
      if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
      return;
    }

    const item = this.actor.items.get(itemId);
    if (!item) return;

    if (item.type === "weapon") {
      const twoHands = !!item.system?.twoHands;

      let targetSlot = HAND_SLOTS.has(slot) ? slot : "mainDroite";
      if (twoHands) targetSlot = "mainDroite";

      for (const w of this.actor.items) {
        if (w.type !== "weapon") continue;
        if (!w.system?.equipe) continue;
        if (!w.system?.twoHands) continue;
        if (w.id === item.id) continue;
        equip(w, false);
      }

      if (twoHands) {
        for (const w of this.actor.items) {
          if (w.type !== "weapon") continue;
          if (!w.system?.equipe) continue;
          const s = w.system?.emplacement;
          if (HAND_SLOTS.has(s) && w.id !== item.id) equip(w, false);
        }

        updates.push({ _id: item.id, "system.emplacement": targetSlot, "system.equipe": true });
        await this.actor.updateEmbeddedDocuments("Item", updates);
        return;
      }

      if (current && current.id !== item.id) equip(current, false);
      updates.push({ _id: item.id, "system.emplacement": targetSlot, "system.equipe": true });

      await this.actor.updateEmbeddedDocuments("Item", updates);
      return;
    }

    if (current && current.id !== item.id) equip(current, false);
    updates.push({ _id: item.id, "system.emplacement": slot, "system.equipe": true });

    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /* -------------------------------------------- */
  /* Create items                                  */
  /* -------------------------------------------- */

  async _createItem(type) {
    const defaults = {
      loot: { name: "Nouvel objet", type: "loot", system: { qte: 1, poids: 0 } },
      weapon: { name: "Nouvelle arme", type: "weapon", system: { equipe: false, emplacement: "mainDroite", qte: 1, poids: 1, difficulte: 0, degats: "1d6", livraison: "physique" } },
      armor: { name: "Nouvelle armure", type: "armor", system: { equipe: false, emplacement: "torse", qte: 1, poids: 2 } },
      consumable: { name: "Nouveau consommable", type: "consumable", system: { qte: 1, poids: 0.2, utilisations: 1, effet: "" } },

      // ✅ spell compat: aura.active (ton template) + aura.enabled supporté
      spell: {
        name: "Nouveau sort",
        type: "spell",
        system: {
          qte: 1,
          poids: 0,
          speed: "normal",
          range: { min: 0, max: 6 },
          coutMana: 0,
          difficulte: 0,
          livraison: "magique",
          cooldown: { max: 0, restant: 0 },

          aura: {
            active: false,
            enabled: false,
            target: "allies",
            range: { min: 0, max: 3 },
            dotFlat: 0,
            cleanseDC: 0
          },

          effectsDuration: 2,
          dotFlat: 0,
          cleanseDC: 0,

          effectsUI: [],
          description: "",
          effects: []
        }
      },

      skill: { name: "Nouvelle compétence", type: "skill", system: { qte: 1, poids: 0, rang: 0, statLiee: "dexterite", difficulte: 0 } }
    };

    const data = defaults[type] ?? { name: "Nouvel item", type, system: { qte: 1, poids: 0 } };
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /* -------------------------------------------- */
  /* States API (sheet)                            */
  /* -------------------------------------------- */

  _statePath() { return "system.etatsActifs"; }

  _stateList() {
    const cur = foundry.utils.getProperty(this.actor, this._statePath());
    return Array.isArray(cur) ? foundry.utils.deepClone(cur) : [];
  }

  _stateFindById(id) {
    const list = this._stateList();
    return list.find(e => e.id === id) ?? null;
  }

  async _stateUpsert(state) {
    const path = this._statePath();
    const list = this._stateList();

    const id = state.id || foundry.utils.randomID();
    const idx = list.findIndex(e => e.id === id);

    const normalized = this._normalizeState({ ...state, id });

    if (idx >= 0) list[idx] = { ...list[idx], ...normalized };
    else list.push(normalized);

    await this.actor.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.actor);

    if (normalized.isAura && globalThis.RPG_AURAS?.refreshAuras) {
      await globalThis.RPG_AURAS.refreshAuras();
    }
  }

  async _stateRemove(id) {
    const path = this._statePath();
    const list = this._stateList().filter(e => e.id !== id);
    await this.actor.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.actor);

    if (globalThis.RPG_AURAS?.refreshAuras) await globalThis.RPG_AURAS.refreshAuras();
  }

  _stateDefaults() {
    return this._normalizeState({
      id: foundry.utils.randomID(),
      label: "Poison",
      type: "poison",
      isAura: false,
      duration: 3,
      remaining: 3,
      cleanseDC: 0,
      dot: { flat: 0, formula: "", perTick: 0 },
      mods: {}
    });
  }

  _normalizeState(st) {
    return normalizeState(st);
  }

  _allModKeys() {
    return [
      "force", "dexterite", "intelligence", "acuite", "endurance",
      "pvMax", "manaMax", "regenPv", "regenMana",
      "scoreArmure", "scoreResistance", "armureFixe", "resistanceFixe",
      "vitesse"
    ];
  }

  async _editStateDialog(state, { title }) {
    const st = this._normalizeState(state);
    const keys = this._allModKeys();

    const row = (k, label) => {
      const cur = st.mods?.[k] ?? {};
      const flat = Number(cur.flat ?? 0) || 0;
      const pct = Number(cur.pct ?? 0) || 0;

      return `
      <div class="form-group" style="display:grid;grid-template-columns:1fr 90px 90px;gap:8px;align-items:center;">
        <label>${label}</label>
        <input type="number" name="mods.${k}.flat" value="${flat}" placeholder="Flat"/>
        <input type="number" name="mods.${k}.pct" value="${pct}" placeholder="%"/>
      </div>`;
    };

    const labels = {
      force: "Force", dexterite: "Dextérité", intelligence: "Intelligence", acuite: "Acuité", endurance: "Endurance",
      pvMax: "PV max", manaMax: "Mana max", regenPv: "Régén PV", regenMana: "Régén Mana",
      scoreArmure: "Score Armure", scoreResistance: "Score Résistance", armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
      vitesse: "Vitesse"
    };

    const modsHtml = keys.map(k => row(k, labels[k] ?? k)).join("");

    const html = `
    <form class="rpg-state-edit">
      <div class="form-group">
        <label>Nom (label)</label>
        <input type="text" name="label" value="${st.label}"/>
      </div>

      <div class="form-group">
        <label>Type</label>
        <select name="type">
          ${["poison", "burn", "buff", "debuff", "aura", "custom"].map(t =>
      `<option value="${t}" ${st.type === t ? "selected" : ""}>${t}</option>`
    ).join("")}
        </select>
      </div>

      <div class="form-group">
        <label>Aura (avec portée)</label>
        <input type="checkbox" name="isAura" ${st.isAura ? "checked" : ""}/>
      </div>

      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label>Durée (tours)</label>
          <input type="number" name="duration" value="${st.duration}" min="1"/>
        </div>
        <div>
          <label>Restant (tours)</label>
          <input type="number" name="remaining" value="${st.remaining}" min="0"/>
        </div>
      </div>

      <div class="form-group">
        <label>Difficulté retrait (cleanse DC)</label>
        <input type="number" name="cleanseDC" value="${st.cleanseDC}" min="0"/>
      </div>

      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label>Portée min (cases) (aura)</label>
          <input type="number" name="aura.min" value="${Number(st.aura?.min ?? 0) || 0}" min="0"/>
        </div>
        <div>
          <label>Portée max (cases) (aura)</label>
          <input type="number" name="aura.max" value="${Number(st.aura?.max ?? 0) || 0}" min="0"/>
        </div>
      </div>

      <div class="form-group">
        <label>Cible (aura)</label>
        <select name="aura.target">
          ${["allies", "enemies", "both"].map(t =>
      `<option value="${t}" ${(st.aura?.target ?? "allies") === t ? "selected" : ""}>${t}</option>`
    ).join("")}
        </select>
      </div>

      <hr/>
      <h3>DOT</h3>
      <p class="hint">DOT fixe = dégâts appliqués à chaque tick (ex: début de tour).</p>

      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label>DOT fixe</label>
          <input type="number" name="dot.flat" value="${Number(st.dot.flat ?? 0) || 0}"/>
        </div>
        <div>
          <label>DOT formule (optionnel)</label>
          <input type="text" name="dot.formula" value="${st.dot.formula ?? ""}" placeholder="ex: 1d4"/>
        </div>
      </div>

      <hr/>
      <h3>Modificateurs (buff / debuff)</h3>
      <p class="hint">Flat = +10 / -10. % = +10 / -10 (pour +10% / -10%).</p>

      ${modsHtml}
    </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: title || "État",
        content: html,
        buttons: {
          cancel: { label: "Annuler", callback: () => resolve(null) },
          ok: {
            label: "Enregistrer",
            callback: (dlgHtml) => {
              const form = dlgHtml[0].querySelector("form");
              const fd = new FormData(form);

              const getStr = (k, d = "") => String(fd.get(k) ?? d).trim();
              const getNum = (k, d = 0) => Number(fd.get(k) ?? d) || 0;
              const getChk = (k) => !!fd.get(k);

              const out = this._normalizeState(st);
              out.label = getStr("label", out.label);
              out.type = getStr("type", out.type);
              out.isAura = getChk("isAura");

              out.duration = Math.max(1, getNum("duration", out.duration));
              out.remaining = Math.max(0, getNum("remaining", out.remaining));
              out.cleanseDC = Math.max(0, getNum("cleanseDC", out.cleanseDC));

              out.dot = out.dot ?? {};
              out.dot.flat = getNum("dot.flat", 0);
              out.dot.formula = getStr("dot.formula", "");
              out.dot.perTick = out.dot.flat;

              if (out.isAura) {
                out.aura = out.aura ?? {};
                out.aura.min = Math.max(0, getNum("aura.min", 0));
                out.aura.max = Math.max(0, getNum("aura.max", 0));
                out.aura.target = getStr("aura.target", "allies") || "allies";
              } else {
                delete out.aura;
              }

              out.mods = out.mods ?? {};
              for (const k of keys) {
                const flat = getNum(`mods.${k}.flat`, 0);
                const pct = getNum(`mods.${k}.pct`, 0);
                if (flat !== 0 || pct !== 0) out.mods[k] = { flat, pct };
                else delete out.mods[k];
              }

              resolve(out);
            }
          }
        },
        default: "ok"
      }).render(true);
    });
  }

  async _postStateInfoToChat(st) {
    const dotTxt = (st.dot?.flat || st.dot?.formula)
      ? `DOT: <b>${st.dot?.flat ?? 0}</b>${st.dot?.formula ? ` + <b>${st.dot.formula}</b>` : ""}`
      : "DOT: <i>aucun</i>";

    const mods = st.mods ?? {};
    const modsTxt = Object.entries(mods)
      .map(([k, v]) => {
        const name = LABELS[k] ?? k;
        const flat = Number(v.flat ?? 0) || 0;
        const pct = Number(v.pct ?? 0) || 0;
        const a = flat ? `${flat > 0 ? "+" : ""}${flat}` : "";
        const b = pct ? `${pct > 0 ? "+" : ""}${pct}%` : "";
        return `${name}: ${[a, b].filter(Boolean).join(" ")}`.trim();
      })
      .filter(Boolean)
      .join("<br>") || "<i>Aucun modificateur</i>";

    const auraTxt = st.isAura && st.aura?.max
      ? `<br>Aura: <b>${st.aura.target}</b> • Portée <b>${st.aura.min}–${st.aura.max}</b>`
      : "";

    const content = `
      <b>${this.actor.name}</b> — État: <b>${st.label}</b><br>
      Type: <b>${st.type}</b> ${st.isAura ? "(Aura)" : ""}${auraTxt}<br>
      Durée: <b>${st.remaining}</b> / ${st.duration} tour(s)<br>
      Retrait: ${st.cleanseDC ? `<b>${st.cleanseDC}+</b>` : "<i>—</i>"}<br>
      ${dotTxt}<br>
      <hr>
      <b>Mods</b><br>${modsTxt}
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });
  }
}