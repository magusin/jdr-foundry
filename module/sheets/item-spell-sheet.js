// systems/rpg/module/sheets/item-spell-sheet.js

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

    // ------------------------------------------------------------
    // Permissions : seul le MJ édite (sinon un joueur owner devient editable)
    // ------------------------------------------------------------
    const canEdit = game.user.isGM;
    data.canEdit = canEdit;
    data.isReadOnly = !canEdit;

    // ------------------------------------------------------------
    // Base system
    // ------------------------------------------------------------
    data.system = data.item.system ?? {};

    // ------------------------------------------------------------
    // Actor parent (un Item de type "spell" est généralement dans un Actor)
    // ------------------------------------------------------------
    const actor = this.item?.parent ?? null;

    // ------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------
    const n = (v, d = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : d;
    };

    const getEffP = (a) =>
      a?.system?.effP ??                               // ✅ ton chemin actuel
      a?.system?.derived?.effective?.principales ??     // fallback éventuel
      a?.system?.derived?.effP ??                       // fallback
      a?.system?.principales ??                         // fallback
      {};

    const normScaling = (s) => ({
      stat: String(s?.stat ?? "intelligence"),
      per: n(s?.per, 10) || 10,
      perStep: n(s?.perStep, 0)
    });

    const b = (v) => {
      if (Array.isArray(v)) v = v[v.length - 1]; // ✅ prend la dernière valeur ("1" si coché)
      if (v === true || v === 1) return true;
      if (v === false || v === 0) return false;
      if (v == null) return false;
      const s = String(v).trim().toLowerCase();
      return s === "1" || s === "true" || s === "on" || s === "yes";
    };

const normDamage = (d) => ({
  enabled: b(d?.enabled),
  dice: String(d?.dice ?? "0"),
  flat: n(d?.flat, 0),
  scaling: normScaling(d?.scaling)
});

    const bonusFromScaling = (scaling, effP) => {
      const stat = String(scaling?.stat ?? "intelligence");
      const per = Number(scaling?.per ?? 10) || 10;
      const perStep = Number(scaling?.perStep ?? 0) || 0;

      const statVal = Number(effP?.[stat] ?? 0) || 0;
      const steps = per > 0 ? Math.floor(statVal / per) : 0;
      return steps * perStep;
    };

    const estimateDiceMinMax = (diceStr) => {
      const s = String(diceStr ?? "").trim();
      if (!s || s === "0") return { min: 0, max: 0, ok: false };

      // support simple: "2d6", "2d6+3", "2d6-1"
      const m = s.match(/^(\d+)\s*d\s*(\d+)\s*([+\-]\s*\d+)?$/i);
      if (!m) return { min: 0, max: 0, ok: false };

      const nb = Number(m[1] || 0);
      const faces = Number(m[2] || 0);
      const mod = Number(String(m[3] || "").replace(/\s/g, "")) || 0;

      return { min: nb * 1 + mod, max: nb * faces + mod, ok: true };
    };

    const hasRealDamage = (dmg) => {
      if (!dmg) return false;
      const dice = String(dmg.dice ?? "").trim();
      const flat = n(dmg.flat, 0);
      const perStep = n(dmg?.scaling?.perStep, 0);

      const hasDice = !!dice && dice !== "0";
      return hasDice || flat !== 0 || perStep !== 0;
    };

    // ------------------------------------------------------------
    // Defaults principaux
    // ------------------------------------------------------------
    data.system.speed = data.system.speed ?? "normal";
    data.system.range = data.system.range ?? { min: 0, max: 0 };
    data.system.cooldown = data.system.cooldown ?? { max: 0, restant: 0 };

    data.system.damage = normDamage(data.system.damage);
    data.system.damageCrit = normDamage(data.system.damageCrit);

    // ------------------------------------------------------------
    // PREVIEW sort (dégâts & crit) basé sur effP du parent actor
    // ------------------------------------------------------------
    const effP = getEffP(actor);

    const buildPreview = (dmg) => {
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
        scalingText: perStep !== 0
          ? `Dégâts / stats : +${scalingBonus} (⌊${statVal}/${per}⌋ × ${perStep})`
          : `Dégâts / stats : +0`,
        hasDice: dice.ok,
        min: (dice.ok ? dice.min : 0) + totalFlat,
        max: (dice.ok ? dice.max : 0) + totalFlat,
        totalFlat
      };
    };

    data.system.damage.preview = buildPreview(data.system.damage);
    data.system.damageCrit.preview = buildPreview(data.system.damageCrit);

    // ------------------------------------------------------------
    // Aura
    // ------------------------------------------------------------
    data.system.aura = data.system.aura ?? {};
    data.system.aura.active = b(data.system.aura.active);
    data.system.aura.range = data.system.aura.range ?? { min: 0, max: 0 };
    data.system.aura.target = data.system.aura.target ?? "both";
    data.system.aura.key = String(data.system.aura.key ?? "");

    data.system.description = String(data.system.description ?? "");

    // ------------------------------------------------------------
    // Effects
    // ------------------------------------------------------------
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

      // damage sur effet (toujours normaliser)
      fx.damage = normDamage(fx.damage);
      fx.damage.preview = buildPreview(fx.damage);

      // flags d'affichage dégâts effet
      const diceFx = String(fx.damage.dice ?? "").trim();
      const flatFx = n(fx.damage.flat, 0);
      const perStepFx = n(fx.damage.scaling?.perStep, 0);

      fx.uiHasDice = !!diceFx && diceFx !== "0";
      fx.uiHasFlat = flatFx !== 0;
      fx.uiHasScaling = perStepFx !== 0;

      // Joueur : section visible si dégâts "réels"
      // GM : section visible si enabled (même si vide)
      fx.uiShowDamage = data.isReadOnly
  ? !!fx.damage.enabled   // ✅ joueur : si enabled => on montre
  : !!fx.damage.enabled;  // ✅ MJ : pareil

      // Joueur : ne montrer que les champs réellement renseignés
      fx.uiShowDice = data.isReadOnly ? fx.uiHasDice : true;
      fx.uiShowFlat = data.isReadOnly ? fx.uiHasFlat : true;
      fx.uiShowScaling = data.isReadOnly ? fx.uiHasScaling : true;
    }

    // ------------------------------------------------------------
    // Flags UI globaux (joueur)
    // ------------------------------------------------------------
    data.ui = data.ui ?? {};
    data.ui.hasDamage = hasRealDamage(data.system.damage);
    data.ui.hasDamageCrit = !!data.system.damageCrit.enabled && hasRealDamage(data.system.damageCrit);

    const aura = data.system.aura;
    data.ui.hasAuraFields = !!aura.active && (
      n(aura.range?.min, 0) !== 0 ||
      n(aura.range?.max, 0) !== 0 ||
      String(aura.key ?? "").trim() !== ""
    );

    // --- affichage joueur : bonus "dégâts des stats" ---
    data.ui = data.ui ?? {};
    data.ui.damageStatBonus = data.system?.damage?.preview?.scalingBonus ?? 0;
    data.ui.damageCritStatBonus = data.system?.damageCrit?.preview?.scalingBonus ?? 0;

    // bonus scaling par effet (pour l'affichage joueur)
    for (const fx of (data.system.effectsUI ?? [])) {
      fx.uiStatBonus = fx?.damage?.preview?.scalingBonus ?? 0;
    }

    return data;
  }

  /** ✅ Empêche le rerender qui te “reset” les détails pendant l’édition */
  async _updateObject(event, formData) {
    const expanded = foundry.utils.expandObject(formData);

    // ✅ Normalise tous les enabled qui peuvent arriver en ["0","1"]
const normalizeEnabled = (val) => {
  if (Array.isArray(val)) val = val[val.length - 1];
  return val === true || val === 1 || val === "1" || val === "true";
};

// damage du sort
if (expanded?.system?.damage) {
  expanded.system.damage.enabled = normalizeEnabled(expanded.system.damage.enabled);
}
if (expanded?.system?.damageCrit) {
  expanded.system.damageCrit.enabled = normalizeEnabled(expanded.system.damageCrit.enabled);
}
if (expanded?.system?.aura) {
  expanded.system.aura.active = normalizeEnabled(expanded.system.aura.active);
}

// damage des effets
const fx = expanded?.system?.effectsUI;
if (fx && !Array.isArray(fx)) expanded.system.effectsUI = Object.values(fx);

if (Array.isArray(expanded?.system?.effectsUI)) {
  for (const e of expanded.system.effectsUI) {
    if (e?.damage) e.damage.enabled = normalizeEnabled(e.damage.enabled);
  }
}

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
    const changed = event?.target?.name ?? "";

// On rerender uniquement sur les toggles (sinon tu gardes ton édition stable)
const shouldRender =
  /system\.damage\.enabled$/.test(changed) ||
  /system\.damageCrit\.enabled$/.test(changed) ||
  /system\.aura\.active$/.test(changed) ||
  /system\.effectsUI\.\d+\.damage\.enabled$/.test(changed);

await this.item.update(expanded, { render: shouldRender });
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

    // Mode joueur : lecture seule stricte, même s'il est owner de l'acteur
    if (!game.user.isGM) {
      // On laisse <details>/<summary> et l'UI Foundry respirer.
      html.find("input, select, textarea").prop("disabled", true);

      // Désactive uniquement tes boutons d'édition (pas tous les button du monde)
      html.find("[data-action], .fx-dmg-enabled").prop("disabled", true);
      return;
    }

    // const patchAndRerender = async (path, value) => {
    //   console.log("[RPG][SpellSheet] toggle", path, "=", value);
    //   await this.item.update({ [path]: value }, { render: true }); // <- IMPORTANT
    //   this.render(false);
    // };

    // html.find('input[name="system.damage.enabled"]').on("change", (ev) => {
    //   patchAndRerender("system.damage.enabled", ev.currentTarget.checked);
    // });

    // html.find('input[name="system.damageCrit.enabled"]').on("change", (ev) => {
    //   patchAndRerender("system.damageCrit.enabled", ev.currentTarget.checked);
    // });

    // html.find('input[name="system.aura.active"]').on("change", (ev) => {
    //   patchAndRerender("system.aura.active", ev.currentTarget.checked);
    // });

    // CRUD effets/mods
    const deepClone = (v) => foundry.utils.deepClone(v);
    const getEffects = () => deepClone(this.item.system.effectsUI ?? []);

    const setEffects = async (effects) => {
      await this.item.update({ "system.effectsUI": effects }, { render: true });
    };

    // ✅ ADD EFFECT
    html.off("click.rpgSpellAddEffect").on("click.rpgSpellAddEffect", "[data-action='addEffect']", async (ev) => {
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

    // ✅ REMOVE EFFECT
    html.off("click.rpgSpellRemoveEffect").on("click.rpgSpellRemoveEffect", "[data-action='removeEffect']", async (ev) => {
      ev.preventDefault();
      const fxIndex = Number($(ev.currentTarget).closest("[data-fx-index]")?.data("fxIndex") ?? -1);
      if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

      const effects = getEffects();
      effects.splice(fxIndex, 1);
      await setEffects(effects);
    });

    // ✅ ADD MOD
    html.off("click.rpgSpellAddMod").on("click.rpgSpellAddMod", "[data-action='addMod']", async (ev) => {
      ev.preventDefault();
      const fxIndex = Number(ev.currentTarget.dataset.fxIndex ?? -1);
      if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

      const effects = getEffects();
      if (!effects[fxIndex]) return;

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

    // ✅ REMOVE MOD
    html.off("click.rpgSpellRemoveMod").on("click.rpgSpellRemoveMod", "[data-action='removeMod']", async (ev) => {
      ev.preventDefault();
      const fxIndex = Number(ev.currentTarget.dataset.fxIndex ?? -1);
      const modIndex = Number(ev.currentTarget.dataset.modIndex ?? -1);
      if (!Number.isFinite(fxIndex) || fxIndex < 0) return;
      if (!Number.isFinite(modIndex) || modIndex < 0) return;

      const effects = getEffects();
      if (!effects[fxIndex]?.mods) return;

      effects[fxIndex].mods.splice(modIndex, 1);
      await setEffects(effects);
    });
  }
}
