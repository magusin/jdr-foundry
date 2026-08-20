// module/sheets/item-talent-sheet-v2.js
//
// Fiche d'un TALENT — délibérément minimale.
//
// Un talent ne fait QUE des mods de stats : pas de dés, pas de portée, pas
// de cibles, pas de recharge. Réutiliser la fiche de sort aurait affiché
// quarante champs dont deux servent, et invité le MJ à remplir les
// trente-huit autres pour rien. Voir rules/loadout.js pour la règle
// d'emplacement.
//
// Le format d'une ligne est celui de `fx.mods` d'un effet de sort —
// `{stat, mode, sens, value}` — parce que `talentMods()` le relit par le
// même chemin que `sumActiveEffectMods`. `sens` est stocké EXPLICITEMENT
// plutôt que déduit du signe : c'est le correctif déjà appliqué à la fiche
// de sort (à quantité 0, « −0 » n'est pas < 0, donc le choix « Malus »
// repassait tout seul sur « Bonus » au rendu suivant).

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import {
  applyUiTheme, applySheetViewMode, bindImageEditors, restoreScrollPositions, uniqueSheetOptions
} from "./sheet-helpers.js";
import { bindSendToActorsButton, bindLinkSyncCheckbox } from "./send-item-dialog.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Stats modifiables — mêmes clés que KEY_TO_BUCKET (status-effects.js), donc
 * les 18, initiative comprise. C'est ce qui a fait préférer cette structure à
 * la grille `equipBonus` d'une armure, qui ne connaît pas l'initiative et
 * ignore le mode pourcentage.
 */
export const TALENT_STAT_GROUPS = [
  { label: "Principales", stats: {
    force: "Force", dexterite: "Dextérité", intelligence: "Intelligence",
    acuite: "Acuité", endurance: "Endurance"
  }},
  { label: "Combat", stats: {
    toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique",
    initiativeMod: "Initiative", vitesse: "Vitesse"
  }},
  { label: "Défenses", stats: {
    armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
    scoreArmure: "Score Armure", scoreResistance: "Score Résistance"
  }},
  { label: "Ressources", stats: {
    pvMax: "PV max", manaMax: "Mana max", fatigueMax: "Fatigue max",
    podsMax: "Pods max", regenPv: "Régén PV", regenMana: "Régén Mana"
  }}
];

/** Libellé d'une stat, tous groupes confondus. */
export function talentStatLabel(key) {
  for (const g of TALENT_STAT_GROUPS) if (g.stats[key]) return g.stats[key];
  return String(key ?? "");
}

/** Normalise une ligne saisie ou stockée. */
export function normalizeTalentMod(raw) {
  const stat = String(raw?.stat ?? "").trim();
  const mode = raw?.mode === "pct" ? "pct" : "flat";
  const v = n(raw?.value, 0);
  const sens = (raw?.sens === "malus" || raw?.sens === "bonus") ? raw.sens : (v < 0 ? "malus" : "bonus");
  const qty = Math.abs(v);
  return { stat, mode, sens, value: sens === "malus" ? -qty : qty };
}

/**
 * Résumé lisible d'un talent — « ⬆️ Dextérité +3 · ⬇️ Vitesse −1 ».
 *
 * Exporté parce que trois surfaces l'affichent (la fiche du talent, l'onglet
 * Talents d'un acteur, le menu de combat) et qu'un talent doit se lire
 * identiquement partout, comme les états actifs.
 */
export function talentSummary(item) {
  const rows = (Array.isArray(item?.system?.mods) ? item.system.mods : [])
    .map(normalizeTalentMod)
    .filter(m => m.stat && m.value !== 0);
  if (!rows.length) return "";
  return rows.map(m => {
    const abs = Math.abs(m.value);
    return `${m.sens === "malus" ? "⬇️" : "⬆️"} ${talentStatLabel(m.stat)} `
         + `${m.sens === "malus" ? "−" : "+"}${abs}${m.mode === "pct" ? " %" : ""}`;
  }).join(" · ");
}

export class RPGTalentSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  /** Un id de fenêtre unique par document — voir uniqueSheetOptions(). */
  _initializeApplicationOptions(options) {
    return uniqueSheetOptions(super._initializeApplicationOptions(options), options,
                              "rpg-talent-sheet-v2");
  }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ["rpg", "rpg-sheet", "sheet", "item", "talent"],
    position: { width: 480, height: 560 },
    window: { contentClasses: ["rpg-sheet-window"], resizable: true },
    form: {
      closeOnSubmit: false,
      submitOnChange: true,
      handler: async function (event, form, formData, options) {
        await this._onFormSubmitV2(event, form, formData, options);
      }
    },
    actions: {
      addMod:    async function (e) { await this._actionAddMod(e); },
      removeMod: async function (e) { await this._actionRemoveMod(e); }
    }
  }, { inplace: false });

  static PARTS = foundry.utils.mergeObject(super.PARTS ?? {}, {
    form: { id: "form", template: "systems/rpg/templates/item/talent-sheet.hbs", scrollable: [".sheet-body"] }
  }, { inplace: false });

  get isEditable() { return game.user.isGM; }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const item = this.document;
    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});
    ctx.system.description = String(ctx.system.description ?? "");

    const raw = Array.isArray(ctx.system.mods) ? ctx.system.mods : [];
    ctx.mods = raw.map(m => {
      const nm = normalizeTalentMod(m);
      return { ...nm, absValue: Math.abs(nm.value), isMalus: nm.sens === "malus" };
    });

    ctx.statGroups = TALENT_STAT_GROUPS.map(g => ({
      label: g.label,
      options: Object.entries(g.stats).map(([value, label]) => ({ value, label }))
    }));
    ctx.summary = talentSummary(item);
    ctx.canEdit = this.isEditable;
    ctx.isGM = game.user.isGM;
    return ctx;
  }

  /** Lit toutes les lignes depuis le DOM — voir _onFormSubmitV2. */
  _collectMods() {
    const root = this.element;
    if (!root) return [];
    const out = [];
    root.querySelectorAll(".talent-mod-row[data-mod-index]").forEach(row => {
      const stat = row.querySelector('[data-mod-field="stat"]')?.value ?? "";
      if (!String(stat).trim()) return;
      out.push(normalizeTalentMod({
        stat,
        mode: row.querySelector('[data-mod-field="mode"]')?.value,
        sens: row.querySelector('[data-mod-field="sens"]')?.value,
        value: Math.abs(n(row.querySelector('[data-mod-field="value"]')?.value, 0))
      }));
    });
    return out;
  }

  /**
   * Les lignes de mods ne portent pas de `name=` : elles sont relues du DOM
   * en bloc et réécrites en entier. Un `name="system.mods.0.stat"` aurait
   * marché aussi, mais la suppression d'une ligne du milieu laisse alors un
   * trou d'index que Foundry recompose en objet — le tableau devient une map
   * et `Array.isArray` échoue silencieusement partout en aval.
   */
  async _onFormSubmitV2(event, form, formData, options) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    const patch = foundry.utils.flattenObject(data);
    delete patch["system.mods"];
    patch["system.mods"] = this._collectMods();
    await this.document.update(patch);
  }

  async _actionAddMod() {
    const mods = this._collectMods();
    mods.push({ stat: "force", mode: "flat", sens: "bonus", value: 0 });
    await this.document.update({ "system.mods": mods });
    this.render();
  }

  async _actionRemoveMod(event) {
    const idx = Number(event?.target?.closest("[data-mod-index]")?.dataset?.modIndex);
    const mods = this._collectMods();
    if (Number.isInteger(idx) && idx >= 0 && idx < mods.length) mods.splice(idx, 1);
    await this.document.update({ "system.mods": mods });
    this.render();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    bindImageEditors(root, this.document);
    applyUiTheme(root);
    restoreScrollPositions(root);
    applySheetViewMode(root, { isGM: game.user.isGM });
    bindSendToActorsButton(root, this.document);
    bindLinkSyncCheckbox(root, this.document);
  }
}
