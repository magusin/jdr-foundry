// systems/rpg/module/sheets/item-armor-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { applyUiTheme, applySheetViewMode, bindImageEditors, restoreScrollPositions, uniqueSheetOptions } from "./sheet-helpers.js";
import { bindSendToActorsButton, bindLinkSyncCheckbox } from "./send-item-dialog.js";
import { normalizeResistMap, resistRows, nonZeroResistRows } from "../rules/damage-types.js";
import { gearStateResistRows } from "../rules/resistances.js";
import { computeItemValue } from "../rules/item-value.js";
import { EFFECT_TAGS, effectCatalogByTag } from "../rules/effect-library.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Fiche d'équipement porté : armures ET reliques (type `relic`).
 *
 * Les deux types partagent exactement la même mécanique — un emplacement,
 * des bonus permanents tant que l'objet est équipé, des résistances et des
 * amplifications — la seule différence étant que la relique occupe un
 * emplacement unique et dédié (`artefact`) au lieu d'une pièce d'armure.
 * D'où une seule classe et un seul template, avec une poignée de branches
 * `isRelic` : dupliquer 250 lignes de fiche pour un libellé et un <select>
 * en moins ferait diverger silencieusement les deux moitiés à la première
 * évolution des bonus.
 */
export class RPGArmorSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";


  /**
   * Un id de fenêtre UNIQUE par document — voir uniqueSheetOptions() : sans
   * lui, ouvrir une deuxième fiche du même type arrache du DOM la fenêtre de
   * la première, qui devient alors impossible à rouvrir sans erreur visible.
   */
  _initializeApplicationOptions(options) {
    return uniqueSheetOptions(super._initializeApplicationOptions(options), options,
                              "rpg-armor-sheet-v2");
  }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      classes: ["rpg", "rpg-sheet", "sheet", "item", "armor"],
      position: { width: 640, height: 720 },
      window: { contentClasses: ["rpg-sheet-window"], resizable: true },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      },

      actions: {
        addResistance:    async function (event) { await this._actionAddResistance(event); },
        removeResistance: async function (event) { await this._actionRemoveResistance(event); },
        addAmplification:    async function (event) { await this._actionAddAmplification(event); },
        removeAmplification: async function (event) { await this._actionRemoveAmplification(event); }
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
        // .rpg-sheet est un simple conteneur flex (voir item-sheet.css) — la
        // zone qui scrolle VRAIMENT est son enfant .sheet-body
        // (overflow-y:auto). scrollable pointait sur le mauvais élément :
        // le mécanisme de préservation de scroll intégré à
        // HandlebarsApplicationMixin n'avait donc jamais rien à restaurer,
        // et chaque champ modifié (submitOnChange déclenche un
        // document.update() + this.render({force:true}) à chaque frappe,
        // voir _onFormSubmitV2) faisait remonter la fiche tout en haut.
        // Même sélecteur que les autres fiches d'objet (arme, générique,
        // quête, recette, personnage), qui n'ont pas ce problème.
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
    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});

    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;
    ctx.isReadOnly = !ctx.canEdit;

    // Pesée (théoriecraft) — calculée UNIQUEMENT pour le MJ. Ce n'est pas
    // qu'un choix d'affichage : la valeur n'est même pas mise dans le contexte
    // de rendu d'un joueur, donc elle n'atteint jamais son navigateur. Même
    // règle en deux couches que la récompense de quête — masquer côté template
    // laisserait le chiffre lisible dans les données rendues.
    ctx.itemValue = ctx.isGM ? computeItemValue(item) : null;

    // Relique : même fiche que l'armure, mais l'emplacement n'est pas un
    // choix — il n'existe qu'un slot Relique, imposé ici pour qu'une relique
    // créée à la main (console, import) atterrisse toujours au bon endroit
    // plutôt que sans emplacement, donc impossible à équiper.
    ctx.isRelic = item.type === "relic";

    // defaults
    ctx.system.emplacement = String(ctx.system.emplacement ?? "");
    if (ctx.isRelic) ctx.system.emplacement = "artefact";
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
      fatigueMax: "Fatigue max",
      regenPvPct: "Régén PV %",
      regenManaPct: "Régén Mana %",
      retraitMod: "Mod. retrait d'état",

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
    ctx.system.amplifications = Array.isArray(ctx.system.amplifications) ? ctx.system.amplifications : [];
    // Liste des types tirée de la bibliothèque d'effets, plus une copie locale
    // écrite à la main : celle-ci avait été figée à huit types et ignorait
    // Lumière et Obscurité, pourtant définis dans le catalogue depuis — un
    // effet de ces deux familles ne pouvait donc recevoir aucune résistance.
    ctx.EFFECT_TAGS = { "": "(N'importe quel type — filtre seulement par nom d'effet)", ...EFFECT_TAGS };

    // Catalogue des effets réellement définis, groupé par type. Il remplace
    // une saisie libre : `effectKey` est comparé par égalité stricte au
    // libellé de l'état, donc « Brulure » sans accent ne correspondait à rien
    // et échouait sans le moindre message. La valeur portée est le LIBELLÉ,
    // pas la clé technique — c'est ce que compare computeResistanceFor().
    ctx.EFFECT_CATALOG = effectCatalogByTag({ value: "label" });

    // ✅ résistances élémentaires : réduction (%) des DÉGÂTS d'un type tant
    // que l'objet est équipé — à ne pas confondre avec system.resistances
    // ci-dessus, qui ne joue que sur les états (durée, dégâts par tour).
    ctx.system.resistancesElem = normalizeResistMap(ctx.system.resistancesElem);
    ctx.resistElemRows = resistRows(ctx.system.resistancesElem);
    ctx.resistElemActive = nonZeroResistRows(ctx.system.resistancesElem);
    // Résistances aux ÉTATS, en lecture pour le joueur : la grille d'édition
    // reste MJ, mais le porteur doit pouvoir lire ce que l'objet lui apporte.
    ctx.resistStateRows = gearStateResistRows(ctx.system.resistances);

    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    if (!this.isEditable) return;
    // La case "🔗 Synchro" (bindLinkSyncCheckbox) gère son propre
    // update+notification et n'a pas de "name" : la laisser passer ici
    // déclencherait une resoumission complète + render({force:true}) en
    // parallèle de son propre appel — rapporté comme "la fiche ne s'ouvre
    // plus après avoir coché". stopPropagation côté checkbox suffit déjà
    // en théorie, ce garde-fou n'a de rôle que si jamais l'évènement
    // l'atteint quand même (ex. ordre d'attache des listeners).
    if (event?.target?.dataset?.action === "toggleLinkSync") return;

    const raw = formData?.object ?? {};
    const expanded = foundry.utils.expandObject(raw);

    // (optionnel) normalisation types numériques
    if (expanded?.system?.poids != null) expanded.system.poids = n(expanded.system.poids, 0);

    // Relique : le template n'affiche aucun <select> d'emplacement (il n'y
    // a qu'un slot possible), donc rien ne le renverrait — on l'écrit ici
    // pour qu'une relique importée/créée hors fiche avec un emplacement
    // vide devienne équipable dès sa première sauvegarde.
    if (this.document.type === "relic" && this.document.system?.emplacement !== "artefact") {
      expanded.system = expanded.system ?? {};
      expanded.system.emplacement = "artefact";
    }

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

    // résistances élémentaires : garde les clés connues, borne les %
    if (expanded?.system?.resistancesElem) {
      expanded.system.resistancesElem = normalizeResistMap(expanded.system.resistancesElem);
    }

    // amplifications : normalise Object -> Array + types
    const ampRaw = expanded?.system?.amplifications;
    if (ampRaw && !Array.isArray(ampRaw)) expanded.system.amplifications = Object.values(ampRaw);
    if (Array.isArray(expanded?.system?.amplifications)) {
      for (const a of expanded.system.amplifications) {
        if (!a) continue;
        a.tag = String(a.tag ?? "").trim();
        a.durationBonus = n(a.durationBonus, 0);
        a.dotBonusPct = Math.min(500, Math.max(-100, n(a.dotBonusPct, 0)));
        a.modBonusPct = Math.min(500, Math.max(-100, n(a.modBonusPct, 0)));
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

    applyUiTheme(root);
    restoreScrollPositions(root);
    applySheetViewMode(root, { isGM: game.user.isGM });
    bindImageEditors(root, this.document);
    bindSendToActorsButton(root, this.document);
    bindLinkSyncCheckbox(root, this.document);
    // ── UUID cliquable → ouvre la fiche de l'item associé ─────────────────
    root.querySelectorAll(".rpg-open-uuid").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const uuid = btn.dataset.uuid;
        if (!uuid) return;
        try {
          const doc = await fromUuid(uuid);
          if (doc?.sheet) doc.sheet.render(true);
          else ui.notifications?.warn?.("Objet introuvable pour cet UUID.");
        } catch(e) { ui.notifications?.error?.(`UUID invalide : ${uuid}`); }
      });
    });
  }

  async _actionAddAmplification(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.amplifications ?? []);
    list.push({ tag: "feu", effectKey: "", durationBonus: 0, dotBonusPct: 0, modBonusPct: 0 });
    await this.document.update({ "system.amplifications": list }, { render: true });
  }

  async _actionRemoveAmplification(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.amplifications ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.amplifications": list }, { render: true });
  }
}