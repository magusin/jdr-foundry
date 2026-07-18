// systems/rpg/module/sheets/item-armor-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { applySheetViewMode, bindImageEditors } from "./sheet-helpers.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export class RPGArmorSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-armor-sheet-v2",
      classes: ["rpg", "sheet", "item", "armor"],
      position: { width: 640, height: 720 },
      window: { contentClasses: ["rpg-sheet-window"] },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      },

      actions: {
        addResistance:    async function (event) { await this._actionAddResistance(event); },
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
        template: "systems/rpg/templates/item/armor-sheet.hbs",
        scrollable: [".rpg-sheet"]
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
    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});

    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;
    ctx.isReadOnly = !ctx.canEdit;

    // defaults
    ctx.system.emplacement = String(ctx.system.emplacement ?? "");
    ctx.system.poids = n(ctx.system.poids, 0);
    ctx.system.description = String(ctx.system.description ?? "");

    ctx.system.prix = ctx.system.prix ?? { cuivre: 0, argent: 0, or: 0 };
    ctx.system.prix.cuivre = n(ctx.system.prix.cuivre, 0);
    ctx.system.prix.argent = n(ctx.system.prix.argent, 0);
    ctx.system.prix.or = n(ctx.system.prix.or, 0);

    ctx.system.bonus = ctx.system.bonus ?? {};

    // ✅ toutes les stats (aligné avec tes mods + ressources)
    const LABELS = {
      // Caractéristiques
      force: "Force",
      intelligence: "Intelligence",
      dexterite: "Dextérité",
      acuite: "Acuité",
      endurance: "Endurance",

      // Défenses
      armureFixe: "Armure fixe",
      resistanceFixe: "Résistance fixe",
      scoreArmure: "Score Armure",
      scoreResistance: "Score Résistance",

      // Ressources
      pvMax: "PV max",
      manaMax: "Mana max",
      regenPv: "Régén PV",
      regenMana: "Régén Mana",

      // Autres
      vitesse: "Vitesse",
      podsMax: "Pods max",

      // Combat
      toucherPhysique: "Toucher physique",
      toucherMagique: "Toucher magique"
    };

    // assure toutes les keys existent (évite undefined dans inputs)
    for (const k of Object.keys(LABELS)) {
      ctx.system.bonus[k] = n(ctx.system.bonus?.[k], 0);
    }

    // affichage joueur : seulement non-zéro
    ctx.displayBonuses = Object.entries(LABELS)
      .map(([key, label]) => ({ key, label, value: n(ctx.system.bonus?.[key], 0) }))
      .filter((row) => row.value !== 0);

    // ✅ résistances (tag, durationReduction, dotReductionPct, immune)
    ctx.system.resistances = Array.isArray(ctx.system.resistances) ? ctx.system.resistances : [];
    ctx.EFFECT_TAGS = {
      "": "(N'importe quel type — filtre seulement par nom d'effet)",
      magique: "Magique", physique: "Physique",
      feu: "Feu", air: "Air", eau: "Eau", glace: "Glace", eclair: "Éclair", terre: "Terre"
    };

    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;

    const raw = formData?.object ?? {};
    const expanded = foundry.utils.expandObject(raw);

    // (optionnel) normalisation types numériques
    if (expanded?.system?.poids != null) expanded.system.poids = n(expanded.system.poids, 0);

    // bonus : force les nombres
    if (expanded?.system?.bonus) {
      for (const [k, v] of Object.entries(expanded.system.bonus)) {
        expanded.system.bonus[k] = n(v, 0);
      }
    }

    if (expanded?.system?.prix) {
      expanded.system.prix.cuivre = n(expanded.system.prix.cuivre, 0);
      expanded.system.prix.argent = n(expanded.system.prix.argent, 0);
      expanded.system.prix.or = n(expanded.system.prix.or, 0);
    }

    // résistances : normalise Object -> Array + types
    const resRaw = expanded?.system?.resistances;
    if (resRaw && !Array.isArray(resRaw)) expanded.system.resistances = Object.values(resRaw);
    if (Array.isArray(expanded?.system?.resistances)) {
      for (const r of expanded.system.resistances) {
        if (!r) continue;
        r.tag = String(r.tag ?? "").trim();
        r.durationReduction = n(r.durationReduction, 0);
        r.dotReductionPct = Math.min(100, Math.max(0, n(r.dotReductionPct, 0)));
        r.immune = !!r.immune;
      }
    }

    await this.document.update(expanded, { render: false });
    await this.render({ force: true });
  }

  async _actionAddResistance(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.resistances ?? []);
    list.push({ tag: "feu", effectKey: "", durationReduction: 0, dotReductionPct: 0, immune: false });
    await this.document.update({ "system.resistances": list }, { render: true });
  }

  async _actionRemoveResistance(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.resistances ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.resistances": list }, { render: true });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

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
}