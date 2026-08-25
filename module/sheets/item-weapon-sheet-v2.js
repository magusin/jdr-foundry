// systems/rpg/module/sheets/item-weapon-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { applyUiTheme, applySheetViewMode, bindImageEditors, restoreScrollPositions, uniqueSheetOptions, itemTypeLabel } from "./sheet-helpers.js";
import { bindSendToActorsButton, bindLinkSyncCheckbox } from "./send-item-dialog.js";
import {
  DAMAGE_TYPES, DAMAGE_TYPE_KEYS, damageTypeLabel,
  normalizeResistMap, resistRows, nonZeroResistRows
} from "../rules/damage-types.js";
import { gearStateResistRows } from "../rules/resistances.js";
import { computeItemValue } from "../rules/item-value.js";
import { WEAPON_CATEGORIES, weaponCategory } from "../rules/attack-bonus.js";
import { EFFECT_TAGS, effectCatalogByTag } from "../rules/effect-library.js";

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

/**
 * Base du scaling de dégâts : `per 10`, gain `+1`, comme template.json.
 *
 * Le repli valait 0 ici alors que `RPGItem#rollDamage` lit `?? 1` : une arme
 * dont l'objet `scaling` ne portait pas la clé affichait « +0 par tranche »
 * sur sa fiche et infligeait quand même le bonus de stat au jet. Les deux
 * bouts lisent maintenant la même base. Une valeur 0 réellement enregistrée
 * (le MJ a écrit 0) est respectée : seul l'ABSENCE de champ retombe sur 1.
 *
 * Le dé de critique garde 0 par défaut, lui — il s'AJOUTE au coup au lieu de
 * le remplacer, et le doubler d'un bonus de stat n'a jamais été l'intention
 * (template.json dit 0 de son côté aussi).
 */
function normScaling(s, fallback = {}) {
  return {
    stat: String(s?.stat ?? fallback.stat ?? "force"),
    per: n(s?.per ?? fallback.per, 10) || 10,
    perStep: n(s?.perStep ?? fallback.perStep, 1)
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


  /**
   * Un id de fenêtre UNIQUE par document — voir uniqueSheetOptions() : sans
   * lui, ouvrir une deuxième fiche du même type arrache du DOM la fenêtre de
   * la première, qui devient alors impossible à rouvrir sans erreur visible.
   */
  _initializeApplicationOptions(options) {
    return uniqueSheetOptions(super._initializeApplicationOptions(options), options,
                              "rpg-weapon-sheet-v2");
  }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      classes: ["rpg", "rpg-sheet", "sheet", "item", "weapon"],
      position: { width: 700, height: 800 },
      window: { contentClasses: ["rpg-sheet-window"], resizable: true },

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
        removeResistance: async function (event) { await this._actionRemoveResistance(event); },
        addAmplification: async function (event) { await this._actionAddAmplification(event); },
        removeAmplification: async function (event) { await this._actionRemoveAmplification(event); },
        resetCooldown: async function (event) { await this._actionResetCooldown(event); }
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
    ctx.typeLabel = itemTypeLabel(item.type);   // « Arme », jamais « weapon »
    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;
    ctx.isReadOnly = !ctx.canEdit;

    // Pesée (théoriecraft) — MJ uniquement, jamais placée dans le contexte
    // rendu d'un joueur (voir item-armor-sheet-v2.js pour le raisonnement).
    ctx.itemValue = ctx.isGM ? computeItemValue(this.document) : null;

    ctx.system.resistances = Array.isArray(ctx.system.resistances) ? ctx.system.resistances : [];
    ctx.system.amplifications = Array.isArray(ctx.system.amplifications) ? ctx.system.amplifications : [];
    // Voir item-armor-sheet-v2.js : liste figée à huit types (Lumière et
    // Obscurité manquaient), et saisie libre du nom d'effet remplacée par le
    // catalogue réel, dont la valeur est le LIBELLÉ.
    ctx.EFFECT_TAGS = { "": "(N'importe quel type — filtre seulement par nom d'effet)", ...EFFECT_TAGS };
    ctx.EFFECT_CATALOG = effectCatalogByTag({ value: "label" });

    // ---- Defaults infos
    ctx.system.qte = n(ctx.system.qte, 0);
    ctx.system.poids = n(ctx.system.poids, 0);
    ctx.system.emplacement = String(ctx.system.emplacement ?? "mainDroite");
    ctx.system.twoHands = b(ctx.system.twoHands);

    // ---- Catégorie (mêlée / jet / tir) : lue par les bonus de dégâts d'un
    // effet, qui peuvent ne viser qu'une famille d'armes (attack-bonus.js).
    ctx.system.categorie = weaponCategory({ system: ctx.system });
    ctx.weaponCategoryChoices = Object.entries(WEAPON_CATEGORIES).map(([key, label]) => ({
      key, label, selected: key === ctx.system.categorie
    }));
    ctx.categorieLabel = WEAPON_CATEGORIES[ctx.system.categorie] ?? ctx.system.categorie;
    ctx.system.difficulte = n(ctx.system.difficulte, 0);

    // ---- Recharge (arbalète, arc long…). Même forme que celle d'un sort :
    // `max` est la définition, `restant` l'état de CETTE copie — le décompte
    // au début du tour du porteur est déjà générique (turn-effects.js parcourt
    // tous les objets qui portent system.cooldown.restant, pas seulement les
    // sorts).
    ctx.system.cooldown = {
      max: Math.max(0, n(ctx.system.cooldown?.max, 0)),
      restant: Math.max(0, n(ctx.system.cooldown?.restant, 0))
    };
    ctx.cooldownRestant = ctx.system.cooldown.restant;

    // ---- Dégâts
    ctx.system.livraison = String(ctx.system.livraison ?? "physique");
    ctx.system.allonge = n(ctx.system.allonge, 1);

    // Élément de l'arme (facultatif) : sert de type pour les résistances
    // élémentaires de la cible. Vide = c'est la livraison qui fait foi.
    ctx.system.tag = String(ctx.system.tag ?? "");
    ctx.damageTypeChoices = DAMAGE_TYPE_KEYS.map(key => ({
      key, label: DAMAGE_TYPES[key], selected: key === ctx.system.tag
    }));
    ctx.tagLabel = damageTypeLabel(ctx.system.tag);

    // ---- Résistances élémentaires accordées par l'arme quand elle est
    // équipée (réduction des dégâts REÇUS, pas des dégâts infligés).
    ctx.system.resistancesElem = normalizeResistMap(ctx.system.resistancesElem);
    ctx.resistElemRows = resistRows(ctx.system.resistancesElem);
    ctx.resistElemActive = nonZeroResistRows(ctx.system.resistancesElem);
    // Résistances aux ÉTATS, en lecture pour le joueur : la grille d'édition
    // reste MJ, mais le porteur doit pouvoir lire ce que l'arme lui apporte.
    ctx.resistStateRows = gearStateResistRows(ctx.system.resistances);

    // Portée min/max (un arc ne tire pas à bout portant). L'ancien champ
    // unique `portee` sert de valeur de départ pour le max.
    ctx.system.portee = n(ctx.system.portee, 1);
    ctx.system.range = ctx.system.range ?? {};
    ctx.system.range.min = n(ctx.system.range.min, 0);
    ctx.system.range.max = n(ctx.system.range.max, ctx.system.portee);

    // Malus de distance : 0 = règle désactivée, ce qui est l'état de toute
    // arme écrite avant ce champ (voir rangeDifficulty, weapon-range.js).
    ctx.system.range.efficace = Math.max(0, n(ctx.system.range.efficace, 0));
    ctx.system.range.tranche  = Math.max(0.1, n(ctx.system.range.tranche, 5));

    // Compat ancien stockage
    const legacyDice = String(ctx.system.degats ?? "1d6");
    const legacyFlat = n(ctx.system.degatsFixes, 0);

    ctx.system.damage = normDamageBlock(ctx.system.damage, {
      dice: legacyDice,
      flat: legacyFlat,
      scaling: { stat: "force", per: 10, perStep: 1 }
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
    // Toutes les clés de equipBonus.bonus (template.json). Une clé absente
    // d'ici rend son champ vide sur la fiche (undefined au lieu de 0) et
    // l'exclut du résumé lisible par le joueur — c'est le cinquième endroit
    // où un bonus peut mourir en silence, après les quatre de CLAUDE.md.
    const BONUS_KEYS = [
      "force","intelligence","dexterite","acuite","endurance",
      "pvMax","manaMax","fatigueMax","regenPv","regenMana","vitesse","initiativeMod",
      "podsMax","retraitMod",
      "armureFixe","resistanceFixe","scoreArmure","scoreResistance",
      "toucherPhysique","toucherMagique"
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
      fatigueMax: "Fatigue max",
      regenPv: "Régén PV",
      regenMana: "Régén Mana",
      podsMax: "Pods max",
      retraitMod: "Mod. retrait d'état",
      vitesse: "Vitesse",
      initiativeMod: "Initiative",
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

    // Barème de distance en clair : deux nombres abstraits ne disent pas ce
    // qu'ils coûtent réellement, et le seuil de touché ne bouge que de 10
    // valeurs au total — +1 de difficulté, c'est 5% de chance en moins.
    const eff = ctx.system.range.efficace;
    const tr  = ctx.system.range.tranche;
    ctx.ui.rangePenaltyText = eff > 0
      ? `Jusqu'à ${eff} m : aucun malus. Ensuite +1 de difficulté par tranche de ${tr} m entamée `
        + `(${eff}–${eff + tr} m : +1 ; ${eff + tr}–${eff + 2 * tr} m : +2 …), soit −5% de chance de toucher par point.`
      : "";

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
      if (expanded.system.allonge != null) expanded.system.allonge = n(expanded.system.allonge, 1);
      if (expanded.system.range) {
        expanded.system.range.min = Math.max(0, n(expanded.system.range.min, 0));
        expanded.system.range.max = Math.max(0, n(expanded.system.range.max, 0));
        if (expanded.system.range.efficace != null)
          expanded.system.range.efficace = Math.max(0, n(expanded.system.range.efficace, 0));
        // Une tranche à 0 diviserait par zéro : rangeDifficulty la borne déjà
        // à 0,1, on fait pareil à l'écriture pour que la fiche ne garde pas
        // une valeur que le moteur n'appliquera jamais telle quelle.
        if (expanded.system.range.tranche != null)
          expanded.system.range.tranche = Math.max(0.1, n(expanded.system.range.tranche, 5));
        // `portee` reste synchronisée sur le max pour tout le code existant
        expanded.system.portee = expanded.system.range.max;
      }

      // recharge : seul `max` se saisit ici. `restant` est l'état de la copie,
      // écrit par la résolution de l'attaque et décompté au tour — l'écraser
      // depuis le formulaire rendrait l'arme disponible à chaque frappe de
      // touche dans un autre champ.
      if (expanded.system.cooldown?.max != null) {
        expanded.system.cooldown.max = Math.max(0, n(expanded.system.cooldown.max, 0));
        delete expanded.system.cooldown.restant;
      }

      // bonus
      if (expanded.system.bonus) {
        for (const [k, v] of Object.entries(expanded.system.bonus)) expanded.system.bonus[k] = n(v, 0);
        // Ancien couple en pourcentage : la régén se saisit désormais en
        // points par tour (system.bonus.regenPv/regenMana). sumBonuses lit
        // encore l'ancien champ en repli pour ne rien casser sur un objet
        // jamais rouvert ; on le retire ici, à la première sauvegarde de la
        // fiche, pour qu'il ne coexiste pas avec le nouveau.
        expanded.system.bonus["-=regenPvPct"] = null;
        expanded.system.bonus["-=regenManaPct"] = null;
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
          // Négatif = VULNÉRABILITÉ (l'effet fait plus mal), bornée comme du côté
        // moteur : computeResistanceFor (resistances.js) clampe déjà la somme
        // à [-100, 100]. Le plancher à 0 d'avant rendait le malus impossible
        // à écrire sur un équipement, alors que le calcul le gère depuis
        // toujours (c'est ainsi que l'amplification météo fonctionne).
        r.dotReductionPct = Math.min(100, Math.max(-100, n(r.dotReductionPct, 0)));
          r.immune = !!r.immune;
        }
      }

      // résistances élémentaires : garde les clés connues, borne les %
      if (expanded.system.resistancesElem) {
        expanded.system.resistancesElem = normalizeResistMap(expanded.system.resistancesElem);
      }

      // amplifications : normalise Object -> Array + types
      const ampRaw = expanded.system.amplifications;
      if (ampRaw && !Array.isArray(ampRaw)) expanded.system.amplifications = Object.values(ampRaw);
      if (Array.isArray(expanded.system.amplifications)) {
        for (const a of expanded.system.amplifications) {
          if (!a) continue;
          a.tag = String(a.tag ?? "").trim();
          a.durationBonus = n(a.durationBonus, 0);
          a.dotBonusPct = Math.min(500, Math.max(-100, n(a.dotBonusPct, 0)));
          a.modBonusPct = Math.min(500, Math.max(-100, n(a.modBonusPct, 0)));
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

  async _actionAddEffect(event) {
    if (!this.isEditable) return;
    const effects = foundry.utils.deepClone(this.document.system.effects ?? []);
    effects.push({
      id: foundry.utils.randomID(8),
      label: "Nouvel effet",
      when: "hit",
      duration: 1,
      cleanseDC: 0,
      stacking: "replace",
      dot: { mode: "none", base: 0, stat: "intelligence", per: 10, livraison: "physique" },
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

  /**
   * Remet l'arme disponible tout de suite.
   *
   * Une recharge se décompte au début du tour de son porteur : hors combat,
   * rien ne la fait descendre, et une arbalète tirée en fin de combat resterait
   * bloquée jusqu'au combat suivant. Ce bouton est la sortie de secours du MJ.
   */
  async _actionResetCooldown(event) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    await this.document.update({ "system.cooldown.restant": 0, "system.recharge.restant": 0 });
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