// systems/rpg/module/sheets/item-spell-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

// bool safe: gère "0/1", "on", true/false, et arrays ["0","1"]
function b(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function normScaling(s) {
  return {
    stat: String(s?.stat ?? "intelligence"),
    per: n(s?.per, 10) || 10,
    perStep: n(s?.perStep, 0)
  };
}

function normDamage(d) {
  return {
    enabled: b(d?.enabled),
    dice: String(d?.dice ?? "0"),
    flat: n(d?.flat, 0),
    scaling: normScaling(d?.scaling)
  };
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

function buildPreview(dmg, effP) {
  const stat = String(dmg?.scaling?.stat ?? "intelligence");
  const per = Number(dmg?.scaling?.per ?? 10) || 10;
  const perStep = Number(dmg?.scaling?.perStep ?? 0) || 0;

  const statVal = Number(effP?.[stat] ?? 0) || 0;
  const steps = per > 0 ? Math.floor(statVal / per) : 0;
  const scalingBonus = steps * perStep;

  const dice = estimateDiceMinMax(dmg?.dice);
  const flat = Number(dmg?.flat ?? 0) || 0;
  const totalFlat = flat + scalingBonus;

  return {
    scalingBonus,
    hasDice: dice.ok,
    min: (dice.ok ? dice.min : 0) + totalFlat,
    max: (dice.ok ? dice.max : 0) + totalFlat,
    totalFlat
  };
}

function hasRealDamage(dmg) {
  if (!dmg) return false;
  const dice = String(dmg.dice ?? "").trim();
  const flat = n(dmg.flat, 0);
  const perStep = n(dmg?.scaling?.perStep, 0);
  const hasDice = !!dice && dice !== "0";
  return hasDice || flat !== 0 || perStep !== 0;
}

/**
 * Convertit un objet expandé (issu du form) en une version normalisée + merge effectsUI façon V1
 */
function normalizeAndMergeEffects(document, expanded) {
  // normalize core toggles
  if (expanded?.system?.damage) expanded.system.damage.enabled = b(expanded.system.damage.enabled);
  if (expanded?.system?.damageCrit) expanded.system.damageCrit.enabled = b(expanded.system.damageCrit.enabled);
  if (expanded?.system?.aura) expanded.system.aura.active = b(expanded.system.aura.active);

  // effectsUI normalize (Object -> Array)
  const fxRaw = expanded?.system?.effectsUI;
  if (fxRaw && !Array.isArray(fxRaw)) expanded.system.effectsUI = Object.values(fxRaw);

  if (Array.isArray(expanded?.system?.effectsUI)) {
    for (const e of expanded.system.effectsUI) {
      if (e?.mods && !Array.isArray(e.mods)) e.mods = Object.values(e.mods);
      if (e?.damage) e.damage.enabled = b(e.damage.enabled);
    }
  }

  // merge like V1 (préserve les champs non-présents dans le form)
  const currentFx = foundry.utils.deepClone(document?.system?.effectsUI ?? []);
  const incomingFx = Array.isArray(expanded?.system?.effectsUI) ? expanded.system.effectsUI : [];

  if (incomingFx.length || currentFx.length) {
    const merged = [];
    const max = Math.max(currentFx.length, incomingFx.length);

    for (let i = 0; i < max; i++) {
      const cur = currentFx[i] ?? {};
      const inc = incomingFx[i] ?? null;

      merged[i] = (inc === null)
        ? cur
        : foundry.utils.mergeObject(foundry.utils.deepClone(cur), inc, {
            inplace: false,
            insertKeys: true,
            insertValues: true,
            overwrite: true
          });
    }

    expanded.system = expanded.system ?? {};
    expanded.system.effectsUI = merged;
  }

  return expanded;
}

export class RPGSpellSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: "rpg-spell-sheet-v2",
    classes: ["rpg", "sheet", "item", "spell"],
    position: { width: 720, height: 920 },
    window: { contentClasses: ["rpg-sheet-window"] },

    /**
     * IMPORTANT V2:
     * - submitOnChange déclenche la soumission sur changement
     * - handler reçoit (event, form, formData, options)
     */
    form: {
      closeOnSubmit: false,
      submitOnChange: true,
      handler: async function(event, form, formData, options) {
        // "this" = l'instance d'application (bind implicite côté Foundry)
        await this._onFormSubmitV2(event, form, formData, options);
      }
    },

    /**
     * Actions V2: data-action="..." appelle automatiquement ces handlers
     */
    actions: {
      addEffect: async function(event) { await this._actionAddEffect(event); },
      removeEffect: async function(event) { await this._actionRemoveEffect(event); },
      addMod: async function(event) { await this._actionAddMod(event); },
      removeMod: async function(event) { await this._actionRemoveMod(event); }
    }
},
{ inplace: false }   // ✅ IMPORTANT
);

static PARTS = foundry.utils.mergeObject(
  super.PARTS ?? {},
  {
    form: {
      id: "form",
      template: "systems/rpg/templates/item/spell-sheet.hbs",
      scrollable: [".rpg-sheet"]
    }
  },
  { inplace: false } // ✅ IMPORTANT
);

  get isEditable() {
    // Tu voulais: GM toujours éditable
    return game.user.isGM;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);

    const item = this.document;
    const actor = item?.parent ?? null;

    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});

    // permissions
    ctx.canEdit = this.isEditable;
    ctx.isReadOnly = !ctx.canEdit;

    // defaults
    ctx.system.speed = ctx.system.speed ?? "normal";
    ctx.system.range = ctx.system.range ?? { min: 0, max: 0 };
    ctx.system.cooldown = ctx.system.cooldown ?? { max: 0, restant: 0 };

    ctx.system.aura = ctx.system.aura ?? {};
    ctx.system.aura.active = b(ctx.system.aura.active);
    ctx.system.aura.range = ctx.system.aura.range ?? { min: 0, max: 0 };
    ctx.system.aura.target = ctx.system.aura.target ?? "both";
    ctx.system.aura.key = String(ctx.system.aura.key ?? "");

    ctx.system.description = String(ctx.system.description ?? "");

    ctx.system.damage = normDamage(ctx.system.damage);
    ctx.system.damageCrit = normDamage(ctx.system.damageCrit);

    // preview
    const effP = getEffP(actor);
    ctx.system.damage.preview = buildPreview(ctx.system.damage, effP);
    ctx.system.damageCrit.preview = buildPreview(ctx.system.damageCrit, effP);

    // effects
    ctx.system.effectsUI = Array.isArray(ctx.system.effectsUI) ? ctx.system.effectsUI : [];
    for (const fx of ctx.system.effectsUI) {
      fx.id = fx.id ?? foundry.utils.randomID();
      fx.label = fx.label ?? "Effet";
      fx.when = fx.when ?? "hit";
      fx.target = fx.target ?? "target";
      fx.duration = n(fx.duration, 0);
      fx.details = fx.details ?? "";

      fx.mods = Array.isArray(fx.mods) ? fx.mods : [];
      for (const m of fx.mods) {
        m.stat = m.stat ?? "armureFixe";
        m.mode = m.mode ?? "flat";
        m.valueType = m.valueType ?? "fixed";
        m.value = n(m.value, 0);
        m.formula = m.formula ?? "";
      }

      fx.damage = normDamage(fx.damage);
      fx.damage.preview = buildPreview(fx.damage, effP);

      const diceFx = String(fx.damage.dice ?? "").trim();
      const flatFx = n(fx.damage.flat, 0);
      const perStepFx = n(fx.damage.scaling?.perStep, 0);

      fx.uiHasDice = !!diceFx && diceFx !== "0";
      fx.uiHasFlat = flatFx !== 0;
      fx.uiHasScaling = perStepFx !== 0;

      fx.uiShowDamage = !!fx.damage.enabled;
      fx.uiStatBonus = fx?.damage?.preview?.scalingBonus ?? 0;
    }

    // ui flags joueur
    ctx.ui = ctx.ui ?? {};
    ctx.ui.hasDamage = hasRealDamage(ctx.system.damage);
    ctx.ui.hasDamageCrit = !!ctx.system.damageCrit.enabled && hasRealDamage(ctx.system.damageCrit);

    ctx.ui.hasAuraFields = !!ctx.system.aura.active && (
      n(ctx.system.aura.range?.min, 0) !== 0 ||
      n(ctx.system.aura.range?.max, 0) !== 0 ||
      String(ctx.system.aura.key ?? "").trim() !== ""
    );

    ctx.ui.damageStatBonus = ctx.system?.damage?.preview?.scalingBonus ?? 0;
    ctx.ui.damageCritStatBonus = ctx.system?.damageCrit?.preview?.scalingBonus ?? 0;

    return ctx;
  }

  /**
   * Handler officiel V2: DEFAULT_OPTIONS.form.handler
   * Signature: (event, form, formData, options) :contentReference[oaicite:3]{index=3}
   */
  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;

    // checkbox safety: si le template oublie un hidden, on force une valeur
    const t = event?.target;
    if (t?.type === "checkbox" && t?.name) {
      const raw = formData?.object ?? {};
      raw[t.name] = t.checked ? (t.value ?? "1") : "0";
    }

    const raw = formData?.object ?? {};
    const expanded = foundry.utils.expandObject(raw);

    // normalisations + merge effectsUI (préserve ce qui n'est pas dans le form)
    const prepared = normalizeAndMergeEffects(this.document, expanded);

    await this.document.update(prepared, { render: false });
    await this.render({ force: true });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    // read-only joueur
    if (!game.user.isGM) {
      root.querySelectorAll("input, select, textarea, button, [data-action]")
        .forEach(el => (el.disabled = true));
      return;
    }

    // toggle mod value/formula
    const refreshModInputs = () => {
      root.querySelectorAll(".mod-line").forEach((row) => {
        const sel = row.querySelector("select.mod-type");
        const vType = String(sel?.value ?? "fixed");
        const value = row.querySelector("input.mod-value");
        const formula = row.querySelector("input.mod-formula");
        if (!value || !formula) return;

        if (vType === "formula") {
          value.disabled = true; value.style.display = "none";
          formula.disabled = false; formula.style.display = "";
        } else {
          value.disabled = false; value.style.display = "";
          formula.disabled = true; formula.style.display = "none";
        }
      });
    };

    refreshModInputs();
    root.addEventListener("change", (ev) => {
      if (ev.target?.matches?.("select.mod-type")) refreshModInputs();
    });
  }

  // ===== Actions V2 =====

  async _actionAddEffect(event) {
    const effects = foundry.utils.deepClone(this.document.system.effectsUI ?? []);
    effects.push({
      id: foundry.utils.randomID(),
      label: "Effet",
      target: "target",
      when: "hit",
      duration: 0,
      details: "",
      damage: { enabled: false, dice: "0", flat: 0, scaling: { stat: "intelligence", per: 10, perStep: 0 } },
      mods: []
    });
    await this.document.update({ "system.effectsUI": effects }, { render: true });
  }

  async _actionRemoveEffect(event) {
    const btn = event?.target?.closest?.("[data-action]");
    const fxIndex = Number(btn?.closest?.("[data-fx-index]")?.dataset?.fxIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

    const effects = foundry.utils.deepClone(this.document.system.effectsUI ?? []);
    effects.splice(fxIndex, 1);
    await this.document.update({ "system.effectsUI": effects }, { render: true });
  }

  async _actionAddMod(event) {
    const btn = event?.target?.closest?.("[data-action]");
    const fxIndex = Number(btn?.dataset?.fxIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

    const effects = foundry.utils.deepClone(this.document.system.effectsUI ?? []);
    if (!effects[fxIndex]) return;

    effects[fxIndex].mods = Array.isArray(effects[fxIndex].mods) ? effects[fxIndex].mods : [];
    effects[fxIndex].mods.push({
      stat: "armureFixe",
      mode: "flat",
      valueType: "fixed",
      value: 0,
      formula: ""
    });

    await this.document.update({ "system.effectsUI": effects }, { render: true });
  }

  async _actionRemoveMod(event) {
    const btn = event?.target?.closest?.("[data-action]");
    const fxIndex = Number(btn?.dataset?.fxIndex ?? -1);
    const modIndex = Number(btn?.dataset?.modIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;
    if (!Number.isFinite(modIndex) || modIndex < 0) return;

    const effects = foundry.utils.deepClone(this.document.system.effectsUI ?? []);
    if (!effects[fxIndex]?.mods) return;

    effects[fxIndex].mods.splice(modIndex, 1);
    await this.document.update({ "system.effectsUI": effects }, { render: true });
  }
}