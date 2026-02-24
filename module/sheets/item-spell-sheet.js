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
  
    // ✅ IMPORTANT : fourni au HBS
    data.isReadOnly = !this.isEditable;
  
    // ✅ UI flags (utilisés dans le HBS : ui.hasDamage, ui.hasDamageCrit, ui.hasAuraFields)
    data.ui = data.ui ?? {};
  
    // ---- defaults ----
    data.system.speed = data.system.speed ?? "normal";
    data.system.range = data.system.range ?? { min: 0, max: 0 };
    data.system.cooldown = data.system.cooldown ?? { max: 0, restant: 0 };
  
    data.system.damage = data.system.damage ?? {
      enabled: false,
      flat: 0,
      dice: "0",
      scaling: { stat: "intelligence", per: 10, perStep: 0 }
    };
  
    data.system.damageCrit = data.system.damageCrit ?? {
      enabled: false,
      flat: 0,
      dice: "0",
      scaling: { stat: "intelligence", per: 10, perStep: 0 }
    };
  
    data.system.aura = data.system.aura ?? { active: false, range: { min: 0, max: 0 }, target: "both", key: "" };
    data.system.description = String(data.system.description ?? "");
  
    // ---- helpers ----
    const n = (v, d = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : d;
    };
  
    const hasRealDamage = (dmg) => {
      if (!dmg) return false;
      const dice = String(dmg.dice ?? "").trim();
      const flat = n(dmg.flat, 0);
      const perStep = n(dmg?.scaling?.perStep, 0);
  
      // "0", "" => pas de dés ; "1d6" placeholder si tu veux le considérer comme vide
      const isDiceOk = !!dice && dice !== "0" && dice.toLowerCase() !== "none";
      const isPlaceholder = dice === "1d6"; // si tu veux continuer à ignorer 1d6 par défaut
  
      // dégâts réels si : dé réel (pas placeholder) OU flat != 0 OU scaling != 0
      return ((isDiceOk && !isPlaceholder) || flat !== 0 || perStep !== 0);
    };
  
    // ---- effects UI ----
    data.system.effectsUI = Array.isArray(data.system.effectsUI) ? data.system.effectsUI : [];
    for (const fx of data.system.effectsUI) {
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
  
      // dégâts de l'effet
      fx.damage = fx.damage ?? {
        enabled: false,
        flat: 0,
        dice: "0",
        scaling: { stat: "intelligence", per: 10, perStep: 0 }
      };
  
      // ✅ côté joueur: n'affiche la section "Dégâts de l'effet" que si vraiment renseigné
      fx.uiShowDamage = data.isReadOnly ? hasRealDamage(fx.damage) : !!fx.damage.enabled;
    }
  
    // ---- UI visibility for sections (joueurs ne voient que si "réel") ----
    // Dégâts sort
    data.ui.hasDamage = hasRealDamage(data.system.damage);
  
    // Crit sort : visible côté joueur uniquement si dégâts crit réels ET enabled (tu peux ajuster)
    data.ui.hasDamageCrit = !!data.system.damageCrit?.enabled && hasRealDamage(data.system.damageCrit);
  
    // Aura : visible côté joueur uniquement si aura active + champs utiles
    const aura = data.system.aura ?? {};
    data.ui.hasAuraFields = !!aura.active && (
      n(aura?.range?.min, 0) !== 0 ||
      n(aura?.range?.max, 0) !== 0 ||
      String(aura?.key ?? "").trim() !== "" ||
      String(aura?.target ?? "").trim() !== ""
    );
  
    return data;
  }

  /** ✅ Empêche le rerender qui te “reset” les détails pendant l’édition */
  async _updateObject(event, formData) {
    const expanded = foundry.utils.expandObject(formData);

    // ⚠️ normalise effectsUI si FormData la donne sous forme d'objet {0:{},1:{}}
    if (expanded?.system?.effectsUI && !Array.isArray(expanded.system.effectsUI)) {
      expanded.system.effectsUI = Object.values(expanded.system.effectsUI);
    }
    const fx = expanded?.system?.effectsUI;
    if (Array.isArray(fx)) {
      for (const e of fx) {
        if (e?.mods && !Array.isArray(e.mods)) e.mods = Object.values(e.mods);
      }
    }

    // ✅ Sauvegarde réelle, mais sans rerender destructeur
    await this.item.update(expanded, { render: false });
  }

  activateListeners(html) {
    super.activateListeners(html);
  
    const deepClone = (v) => foundry.utils.deepClone(v);
  
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
  
    // Toujours faire l'ajustement UI
    refreshModInputs();
    html.on("change", "select.mod-type", () => refreshModInputs());
  
    // 🔒 Mode lecture (joueur non-owner) : disable tout + pas de listeners d’édition
    if (!this.isEditable) {
      html.find("input, select, textarea, button").prop("disabled", true);
  
      // Tu peux laisser le scroll / lecture
      // Et éventuellement ré-activer les <details> si tu veux qu’ils s’ouvrent :
      html.find("details").prop("open", true);
  
      return;
    }
  
    // --- Helpers ---
    const patchAndRerender = async (path, value) => {
      console.log("[RPG][SpellSheet] toggle", path, "=", value);
      await this.item.update({ [path]: value });
      this.render(false);
    };
  
    // --- Toggles ---
    html.find('input[name="system.damage.enabled"]').on("change", (ev) => {
      patchAndRerender("system.damage.enabled", ev.currentTarget.checked);
    });
  
    html.find('input[name="system.damageCrit.enabled"]').on("change", (ev) => {
      patchAndRerender("system.damageCrit.enabled", ev.currentTarget.checked);
    });
  
    html.find('input[name="system.aura.active"]').on("change", (ev) => {
      patchAndRerender("system.aura.active", ev.currentTarget.checked);
    });
  
    // --- Effets : toggle dégâts d'effet ---
    html.find("input.fx-dmg-enabled").on("change", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    
      const i = Number(ev.currentTarget.dataset.fxIndex ?? -1);
      if (!Number.isInteger(i) || i < 0) return;
    
      const checked = !!ev.currentTarget.checked;
    
      // ✅ On clone le TABLEAU, on modifie, puis on update le tableau entier
      const effects = foundry.utils.deepClone(this.item.system.effectsUI ?? []);
      if (!Array.isArray(effects) || !effects[i]) return;
    
      effects[i].damage = effects[i].damage ?? {
        enabled: false,
        flat: 0,
        dice: "0",
        scaling: { stat: "intelligence", per: 10, perStep: 0 }
      };
    
      effects[i].damage.enabled = checked;
    
      console.log("[RPG][SpellSheet] fx damage.enabled", i, "=", checked);
    
      // ✅ update tableau complet (évite la conversion array -> object)
      await this.item.update({ "system.effectsUI": effects }, { render: true });
    });
  
    // --- CRUD effets/mods ---
    const getEffects = () => deepClone(this.item.system.effectsUI ?? []);
    const setEffects = async (effects) => this.item.update({ "system.effectsUI": effects }, { render: true });
  
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
        damage: {
          enabled: false,
          dice: "0",
          flat: 0,
          scaling: { stat: "intelligence", per: 10, perStep: 0 }
        },
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
