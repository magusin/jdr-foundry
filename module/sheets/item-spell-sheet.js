function deepClone(o) { return foundry.utils.deepClone(o ?? {}); }

export class RPGSpellSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["rpg", "sheet", "item", "spell"],
      template: "systems/rpg/templates/item/spell-sheet.hbs",
      width: 720,
      height: 920,

      // ✅ IMPORTANT : sinon Foundry ne déclenche pas _updateObject sur change
      submitOnChange: true,

      // ✅ on évite la fermeture / rerender agressif
      closeOnSubmit: false,
      submitOnClose: true
    });
  }

  async getData(options) {
    const data = await super.getData(options);
  
    data.system = data.item.system ?? {};
    data.isReadOnly = !this.isEditable;
  
    // helpers
    const n = (v, d = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : d;
    };
  
    const normScaling = (s) => ({
      stat: String(s?.stat ?? "intelligence"),
      per: n(s?.per, 10) || 10,
      perStep: n(s?.perStep, 0)
    });
  
    const normDamage = (d) => ({
      enabled: !!d?.enabled,
      dice: String(d?.dice ?? "0"),
      flat: n(d?.flat, 0),
      scaling: normScaling(d?.scaling)
    });
  
    const hasRealDamage = (dmg) => {
      if (!dmg) return false;
      const dice = String(dmg.dice ?? "").trim();
      const flat = n(dmg.flat, 0);
      const perStep = n(dmg?.scaling?.perStep, 0);
  
      const hasDice = !!dice && dice !== "0";
      return hasDice || flat !== 0 || perStep !== 0;
    };
  
    // ---- defaults principaux ----
    data.system.speed = data.system.speed ?? "normal";
    data.system.range = data.system.range ?? { min: 0, max: 0 };
    data.system.cooldown = data.system.cooldown ?? { max: 0, restant: 0 };
  
    data.system.damage = normDamage(data.system.damage);
    data.system.damageCrit = normDamage(data.system.damageCrit);
  
    data.system.aura = data.system.aura ?? {};
    data.system.aura.active = !!data.system.aura.active;
    data.system.aura.range = data.system.aura.range ?? { min: 0, max: 0 };
    data.system.aura.target = data.system.aura.target ?? "both";
    data.system.aura.key = String(data.system.aura.key ?? "");
  
    data.system.description = String(data.system.description ?? "");
  
    // ---- effects ----
    data.system.effectsUI = Array.isArray(data.system.effectsUI) ? data.system.effectsUI : [];
  
    for (const fx of data.system.effectsUI) {
      fx.id = fx.id ?? foundry.utils.randomID();
      fx.label = fx.label ?? "Effet";
      fx.when = fx.when ?? "hit";
      fx.target = fx.target ?? "target";
      fx.duration = n(fx.duration, 0);
      fx.details = fx.details ?? "";
  
      // mods
      fx.mods = Array.isArray(fx.mods) ? fx.mods : [];
      for (const m of fx.mods) {
        m.stat = m.stat ?? "armureFixe";
        m.mode = m.mode ?? "flat";
        m.valueType = m.valueType ?? "fixed";
        m.value = n(m.value, 0);
        m.formula = m.formula ?? "";
      }
  
      // damage sur effet (IMPORTANT : toujours normaliser)
      fx.damage = normDamage(fx.damage);
  
      // flags d'affichage dégâts effet
      const diceFx = String(fx.damage.dice ?? "").trim();
      const flatFx = n(fx.damage.flat, 0);
      const perStepFx = n(fx.damage.scaling?.perStep, 0);
  
      fx.uiHasDice = !!diceFx && diceFx !== "0";
      fx.uiHasFlat = flatFx !== 0;
      fx.uiHasScaling = perStepFx !== 0;
  
      // joueur: on n'affiche la section que si "réel"
      // GM: section affichable si enabled (même si vide) car il édite
      fx.uiShowDamage = data.isReadOnly ? (fx.uiHasDice || fx.uiHasFlat || fx.uiHasScaling) : !!fx.damage.enabled;
  
      // joueur: on ne montre un champ que s'il est renseigné
      fx.uiShowDice = data.isReadOnly ? fx.uiHasDice : true;
      fx.uiShowFlat = data.isReadOnly ? fx.uiHasFlat : true;
      fx.uiShowScaling = data.isReadOnly ? fx.uiHasScaling : true;
    }
  
    // ---- flags UI globaux (joueur) ----
    data.ui = data.ui ?? {};
    data.ui.hasDamage = hasRealDamage(data.system.damage);
    data.ui.hasDamageCrit = !!data.system.damageCrit.enabled && hasRealDamage(data.system.damageCrit);
  
    const aura = data.system.aura;
    data.ui.hasAuraFields = !!aura.active && (
      n(aura.range?.min, 0) !== 0 ||
      n(aura.range?.max, 0) !== 0 ||
      String(aura.key ?? "").trim() !== ""
    );
  
    return data;
  }

  /** ✅ Empêche le rerender qui te “reset” les détails pendant l’édition */
  async _updateObject(event, formData) {
    const expanded = foundry.utils.expandObject(formData);
  
    // normaliser effectsUI / mods si Foundry renvoie des objets indexés
    const incomingFxRaw = expanded?.system?.effectsUI;
    if (incomingFxRaw && !Array.isArray(incomingFxRaw)) {
      expanded.system.effectsUI = Object.values(incomingFxRaw);
    }
  
    const incomingFx = expanded?.system?.effectsUI;
    if (Array.isArray(incomingFx)) {
      for (const e of incomingFx) {
        if (e?.mods && !Array.isArray(e.mods)) e.mods = Object.values(e.mods);
      }
  
      // ✅ MERGE avec l'existant pour garder les champs non présents dans formData
      const currentFx = foundry.utils.deepClone(this.item.system.effectsUI ?? []);
      const merged = [];
  
      const max = Math.max(currentFx.length, incomingFx.length);
      for (let i = 0; i < max; i++) {
        const cur = currentFx[i] ?? {};
        const inc = incomingFx[i] ?? null;
  
        if (inc === null) {
          // si l'incoming n'a pas cet index, on garde l'existant
          merged[i] = cur;
        } else {
          // merge profond : inc écrase cur, mais conserve les clés absentes
          merged[i] = foundry.utils.mergeObject(
            foundry.utils.deepClone(cur),
            inc,
            { inplace: false, insertKeys: true, insertValues: true, overwrite: true }
          );
        }
      }
  
      expanded.system.effectsUI = merged;
    }
  
    // ✅ update sans rerender destructeur sur cette sheet
    await this.item.update(expanded, { render: false });
  }

  activateListeners(html) {
  super.activateListeners(html);

  const refreshModInputs = () => {
    html.find(".mod-line").each((_, row) => {
      const $row = $(row);
      const vType = String($row.find("select.mod-type").val() ?? "fixed");
      const $value = $row.find("input.mod-value");
      const $formula = $row.find("input.mod-formula");

      if (vType === "formula") {
        $value.prop("disabled", true).hide();
        $formula.prop("disabled", false).show();
      } else {
        $value.prop("disabled", false).show();
        $formula.prop("disabled", true).hide();
      }
    });
  };

  refreshModInputs();
  html.on("change", "select.mod-type", () => refreshModInputs());

  // mode joueur: aucun listener d'édition
  if (!this.isEditable) return;

  const patchAndRerender = async (path, value) => {
    console.log("[RPG][SpellSheet] toggle", path, "=", value);
    await this.item.update({ [path]: value }, { render: true }); // <- IMPORTANT
    this.render(false);
  };

  html.find('input[name="system.damage.enabled"]').on("change", (ev) => {
    patchAndRerender("system.damage.enabled", ev.currentTarget.checked);
  });

  html.find('input[name="system.damageCrit.enabled"]').on("change", (ev) => {
    patchAndRerender("system.damageCrit.enabled", ev.currentTarget.checked);
  });

  html.find('input[name="system.aura.active"]').on("change", (ev) => {
    patchAndRerender("system.aura.active", ev.currentTarget.checked);
  });

  // --- Effets : toggle dégâts d'effet (SAFE: update l'array complet) ---
html.on("change", "input.fx-dmg-enabled", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const i = Number(ev.currentTarget.dataset.fxIndex ?? -1);
  if (!Number.isFinite(i) || i < 0) return;

  const checked = !!ev.currentTarget.checked;

  const effects = foundry.utils.deepClone(this.item.system.effectsUI ?? []);
  if (!Array.isArray(effects) || !effects[i]) return;

  // garantir la structure
  effects[i].damage = effects[i].damage ?? {
    enabled: false,
    dice: "0",
    flat: 0,
    scaling: { stat: "intelligence", per: 10, perStep: 0 }
  };
  effects[i].damage.scaling = effects[i].damage.scaling ?? { stat: "intelligence", per: 10, perStep: 0 };

  effects[i].damage.enabled = checked;

  console.log("[RPG][SpellSheet] fx damage enabled", i, "=", checked);

  await this.item.update({ "system.effectsUI": effects }, { render: true });
  this.render(false);
});

  // CRUD effets/mods
  const deepClone = (v) => foundry.utils.deepClone(v);
  const getEffects = () => deepClone(this.item.system.effectsUI ?? []);

  const setEffects = async (effects) => {
    await this.item.update({ "system.effectsUI": effects }, { render: true }); // <- IMPORTANT
  };

  html.find("[data-action='addEffect']").on("click", async (ev) => {
    ev.preventDefault();
    const effects = getEffects();
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
    await setEffects(effects);
  });

  html.find("[data-action='removeEffect']").on("click", async (ev) => {
    ev.preventDefault();
    const fxIndex = Number(ev.currentTarget.closest("[data-fx-index]")?.dataset?.fxIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

    const effects = getEffects();
    effects.splice(fxIndex, 1);
    await setEffects(effects);
  });

  html.find("[data-action='addMod']").on("click", async (ev) => {
    ev.preventDefault();
    const fxIndex = Number(ev.currentTarget.dataset.fxIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

    const effects = getEffects();
    effects[fxIndex].mods = Array.isArray(effects[fxIndex].mods) ? effects[fxIndex].mods : [];
    effects[fxIndex].mods.push({
      stat: "armureFixe",
      mode: "flat",
      valueType: "fixed",
      value: 0,
      formula: ""
    });
    await setEffects(effects);
  });

  html.find("[data-action='removeMod']").on("click", async (ev) => {
    ev.preventDefault();
    const fxIndex = Number(ev.currentTarget.dataset.fxIndex ?? -1);
    const modIndex = Number(ev.currentTarget.dataset.modIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;
    if (!Number.isFinite(modIndex) || modIndex < 0) return;

    const effects = getEffects();
    effects[fxIndex].mods.splice(modIndex, 1);
    await setEffects(effects);
  });
}
}
