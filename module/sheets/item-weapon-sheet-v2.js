// systems/rpg/module/sheets/item-weapon-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { applyUiTheme, applySheetViewMode, bindImageEditors } from "./sheet-helpers.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function b(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function getEffP(actor) {
  return actor?.system?.effP ??
    actor?.system?.derived?.effective?.principales ??
    actor?.system?.derived?.effP ??
    actor?.system?.principales ??
    {};
}

function estimateDiceMinMax(diceStr) {
  const s = String(diceStr ?? "").trim();
  if (!s || s === "0") return { min: 0, max: 0, ok: false };
  const m = s.match(/^(\d+)\s*d\s*(\d+)\s*([+\-]\s*\d+)?$/i);
  if (!m) return { min: 0, max: 0, ok: false };
  const nb = Number(m[1] || 0);
  const faces = Number(m[2] || 0);
  const mod = Number(String(m[3] || "").replace(/\s/g, "")) || 0;
  return { min: nb * 1 + mod, max: nb * faces + mod, ok: true };
}

function normScaling(s, fallback = {}) {
  return {
    stat: String(s?.stat ?? fallback.stat ?? "force"),
    per: n(s?.per ?? fallback.per, 10) || 10,
    perStep: n(s?.perStep ?? fallback.perStep, 0)
  };
}

function normDamageBlock(d, fallback = {}) {
  return {
    dice: String(d?.dice ?? fallback.dice ?? "1d6"),
    flat: n(d?.flat ?? fallback.flat, 0),
    scaling: normScaling(d?.scaling, fallback.scaling ?? {})
  };
}

function buildPreview(dmg, effP) {
  const stat = String(dmg?.scaling?.stat ?? "force");
  const per = n(dmg?.scaling?.per, 10) || 10;
  const perStep = n(dmg?.scaling?.perStep, 0);

  const statVal = n(effP?.[stat], 0);
  const steps = per > 0 ? Math.floor(statVal / per) : 0;
  const scalingBonus = steps * perStep;

  const dice = estimateDiceMinMax(dmg?.dice);
  const flat = n(dmg?.flat, 0);
  const totalFlat = flat + scalingBonus;

  return {
    stat,
    per,
    perStep,
    statVal,
    steps,
    scalingBonus,
    flat,
    totalFlat,
    hasDice: dice.ok,
    min: (dice.ok ? dice.min : 0) + totalFlat,
    max: (dice.ok ? dice.max : 0) + totalFlat
  };
}

export class RPGWeaponSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-weapon-sheet-v2",
      classes: ["rpg", "sheet", "item", "weapon"],
      position: { width: 700, height: 800 },
      window: { contentClasses: ["rpg-sheet-window"] },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      },

      actions: {
        addEffect: async function (event) { await this._actionAddEffect(event); },
        removeEffect: async function (event) { await this._actionRemoveEffect(event); },
        addResistance: async function (event) { await this._actionAddResistance(event); },
        removeResistance: async function (event) { await this._actionRemoveResistance(event); }
      }
    },
    { inplace: false }
  );

  static PARTS = foundry.utils.mergeObject(
    super.PARTS ?? {},
    {
      form: {
        id: "form",
        template: "systems/rpg/templates/item/weapon-sheet.hbs",
        scrollable: [".sheet-body"]
      }
    },
    { inplace: false }
  );

  get isEditable() {
    return game.user.isGM;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);

    const item = this.document;
    const actor = item?.parent ?? null;

    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});
    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;
    ctx.isReadOnly = !ctx.canEdit;

    ctx.system.resistances = Array.isArray(ctx.system.resistances) ? ctx.system.resistances : [];
    ctx.EFFECT_TAGS = {
      "": "(N'importe quel type — filtre seulement par nom d'effet)",
      magique: "Magique", physique: "Physique",
      feu: "Feu", air: "Air", eau: "Eau", glace: "Glace", eclair: "Éclair", terre: "Terre"
    };

    // ---- Defaults infos
    ctx.system.qte = n(ctx.system.qte, 0);
    ctx.system.poids = n(ctx.system.poids, 0);
    ctx.system.emplacement = String(ctx.system.emplacement ?? "mainDroite");
    ctx.system.twoHands = b(ctx.system.twoHands);
    ctx.system.difficulte = n(ctx.system.difficulte, 0);

    // ---- Dégâts
    ctx.system.livraison = String(ctx.system.livraison ?? "physique");
    ctx.system.portee = n(ctx.system.portee, 1);

    // Compat ancien stockage
    const legacyDice = String(ctx.system.degats ?? "1d6");
    const legacyFlat = n(ctx.system.degatsFixes, 0);

    ctx.system.damage = normDamageBlock(ctx.system.damage, {
      dice: legacyDice,
      flat: legacyFlat,
      scaling: { stat: "force", per: 10, perStep: 0 }
    });

    // ---- Critique
    ctx.system.crit = ctx.system.crit ?? {};
    ctx.system.crit.mode = String(ctx.system.crit.mode ?? "max+die");

    const legacyCritDie = String(ctx.system.crit.extraDie ?? "0");
    const legacyCritFlat = n(ctx.system.crit.extraFlat, 0);

    ctx.system.crit.damage = normDamageBlock(ctx.system.crit.damage, {
      dice: legacyCritDie,
      flat: legacyCritFlat,
      scaling: { stat: "force", per: 10, perStep: 0 }
    });

    // ---- Bonus équipement (+ regen)
    ctx.system.bonus = ctx.system.bonus ?? {};
    const BONUS_KEYS = [
      "force","intelligence","dexterite","acuite","endurance",
      "pvMax","manaMax","regenPv","regenMana","vitesse",
      "armureFixe","resistanceFixe","scoreArmure","scoreResistance"
    ];
    for (const k of BONUS_KEYS) ctx.system.bonus[k] = n(ctx.system.bonus[k], 0);

    const LABELS_BONUS = {
      force: "Force",
      intelligence: "Intelligence",
      dexterite: "Dextérité",
      acuite: "Acuité",
      endurance: "Endurance",
      pvMax: "PV max",
      manaMax: "Mana max",
      regenPv: "Régén PV",
      regenMana: "Régén Mana",
      vitesse: "Vitesse",
      armureFixe: "Armure fixe",
      resistanceFixe: "Résistance fixe",
      scoreArmure: "Score Armure",
      scoreResistance: "Score Résistance",
      toucherPhysique: "Toucher physique",
      toucherMagique: "Toucher magique"
    };

    ctx.displayWeaponBonuses = Object.entries(LABELS_BONUS)
      .map(([key, label]) => ({ key, label, value: n(ctx.system.bonus?.[key], 0) }))
      .filter(r => r.value !== 0);

    // ---- Effets
    ctx.system.effects = Array.isArray(ctx.system.effects) ? ctx.system.effects : [];

    // ---- Prix
    ctx.system.prix = ctx.system.prix ?? { cuivre: 0, argent: 0, or: 0 };
    ctx.system.prix.cuivre = n(ctx.system.prix.cuivre, 0);
    ctx.system.prix.argent = n(ctx.system.prix.argent, 0);
    ctx.system.prix.or = n(ctx.system.prix.or, 0);

    // ---- Description
    ctx.system.description = String(ctx.system.description ?? "");

    // ---- Preview joueur (dégâts + crit)
    const effP = getEffP(actor);
    ctx.ui = ctx.ui ?? {};

    ctx.ui.damagePreview = buildPreview(ctx.system.damage, effP);
    ctx.ui.critPreview = buildPreview(ctx.system.crit.damage, effP);

    // "dé + (fixe+scaling)" => totalFlat = fixe + scalingBonus
    ctx.ui.damageExpr = `${ctx.system.damage.dice} + (${ctx.ui.damagePreview.totalFlat})`;
    ctx.ui.critExpr = `${ctx.system.crit.damage.dice} + (${ctx.ui.critPreview.totalFlat})`;

    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;

    // checkbox safety
    const t = event?.target;
    if (t?.type === "checkbox" && t?.name) {
      const raw = formData?.object ?? {};
      raw[t.name] = t.checked ? (t.value ?? "1") : "0";
    }

    const raw = formData?.object ?? {};
    const expanded = foundry.utils.expandObject(raw);

    if (expanded?.system) {
      // infos
      if (expanded.system.twoHands != null) expanded.system.twoHands = b(expanded.system.twoHands);
      if (expanded.system.qte != null) expanded.system.qte = n(expanded.system.qte, 0);
      if (expanded.system.poids != null) expanded.system.poids = n(expanded.system.poids, 0);
      if (expanded.system.difficulte != null) expanded.system.difficulte = n(expanded.system.difficulte, 0);
      if (expanded.system.portee != null) expanded.system.portee = n(expanded.system.portee, 1);

      // bonus
      if (expanded.system.bonus) {
        for (const [k, v] of Object.entries(expanded.system.bonus)) expanded.system.bonus[k] = n(v, 0);
      }

      // damage
      if (expanded.system.damage) {
        if (expanded.system.damage.flat != null) expanded.system.damage.flat = n(expanded.system.damage.flat, 0);
        if (expanded.system.damage.scaling) {
          expanded.system.damage.scaling.per = n(expanded.system.damage.scaling.per, 10) || 10;
          expanded.system.damage.scaling.perStep = n(expanded.system.damage.scaling.perStep, 0);
        }
      }

      // crit
      if (expanded.system.crit?.damage) {
        if (expanded.system.crit.damage.flat != null) expanded.system.crit.damage.flat = n(expanded.system.crit.damage.flat, 0);
        if (expanded.system.crit.damage.scaling) {
          expanded.system.crit.damage.scaling.per = n(expanded.system.crit.damage.scaling.per, 10) || 10;
          expanded.system.crit.damage.scaling.perStep = n(expanded.system.crit.damage.scaling.perStep, 0);
        }
      }

      // effects
      if (expanded.system.effects && !Array.isArray(expanded.system.effects)) {
        expanded.system.effects = Object.values(expanded.system.effects);
      }

      // prix
      if (expanded.system.prix) {
        expanded.system.prix.cuivre = n(expanded.system.prix.cuivre, 0);
        expanded.system.prix.argent = n(expanded.system.prix.argent, 0);
        expanded.system.prix.or = n(expanded.system.prix.or, 0);
      }

      // résistances
      const resRaw = expanded.system.resistances;
      if (resRaw && !Array.isArray(resRaw)) expanded.system.resistances = Object.values(resRaw);
      if (Array.isArray(expanded.system.resistances)) {
        for (const r of expanded.system.resistances) {
          if (!r) continue;
          r.tag = String(r.tag ?? "").trim();
          r.durationReduction = n(r.durationReduction, 0);
          r.dotReductionPct = Math.min(100, Math.max(0, n(r.dotReductionPct, 0)));
          r.immune = !!r.immune;
        }
      }
    }

    await this.document.update(expanded, { render: false });
    await this.render({ force: true });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    applyUiTheme(root);
    applySheetViewMode(root, { isGM: game.user.isGM });
    bindImageEditors(root, this.document);
    // ── UUID cliquable → ouvre la fiche de l'item associé ─────────────────
    root.querySelectorAll(".rpg-open-uuid").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const uuid = btn.dataset.uuid;
        if (!uuid) return;
        try {
          const doc = await fromUuid(uuid);
          if (doc?.sheet) doc.sheet.render(true);
          else ui.notifications?.warn?.("Item introuvable pour cet UUID.");
        } catch(e) { ui.notifications?.error?.(`UUID invalide : ${uuid}`); }
      });
    });

    bindImageEditors(root, this.document);
  }

  async _actionAddEffect(event) {
    if (!this.isEditable) return;
    const effects = foundry.utils.deepClone(this.document.system.effects ?? []);
    effects.push({
      id: foundry.utils.randomID(8),
      label: "Nouvel effet",
      duration: 1,
      cleanseDC: 0,
      stacking: "replace",
      dot: { base: 0, stat: "intelligence", per: 10, livraison: "physique" },
      modsFlat: { principales: {} },
      modsPct: { principales: {} }
    });
    await this.document.update({ "system.effects": effects }, { render: true });
  }

  async _actionRemoveEffect(event) {
    if (!this.isEditable) return;
    const btn = event?.target?.closest?.("[data-action]");
    const idx = Number(btn?.dataset?.idx ?? -1);
    if (!Number.isFinite(idx) || idx < 0) return;

    const effects = foundry.utils.deepClone(this.document.system.effects ?? []);
    effects.splice(idx, 1);
    await this.document.update({ "system.effects": effects }, { render: true });
  }

  async _actionAddResistance(event) {
    if (!this.isEditable) return;
    const list = foundry.utils.deepClone(this.document.system?.resistances ?? []);
    list.push({ tag: "feu", effectKey: "", durationReduction: 0, dotReductionPct: 0, immune: false });
    await this.document.update({ "system.resistances": list }, { render: true });
  }

  async _actionRemoveResistance(event) {
    if (!this.isEditable) return;
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.resistances ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.resistances": list }, { render: true });
  }
}