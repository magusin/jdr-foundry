// systems/rpg/module/sheets/character-sheet-v2.js
import { buildSpellUI, buildSpellEffectsPreview, declareSpell } from "../rules/spells.js";
import { getBudget, saveBudget, canUseSlot, confirmSlot, movementRemaining, movementSpent } from "../rules/action-budget.js";
import {
  talentsOf, passifsOf, equippedTalent, equippedPassif, passifManaCost, hasPaidThisCombat,
  passifCooldownLeft
} from "../rules/loadout.js";
import { talentSummary } from "./item-talent-sheet-v2.js";
import { listEffects, getEffectDef, EFFECT_TAGS } from "../rules/effect-library.js";
import { STATE_TYPES, AURA_TARGETS, stateTypeLabel, auraTargetLabel } from "../rules/state-builder.js";
import { isNpcActor } from "../rules/actor-roles.js";
import {
  normalizeResistMap, resistRows, nonZeroResistRows, stateResistTextParts
} from "../rules/damage-types.js";
import { actorStateResistRows } from "../rules/resistances.js";

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------- */
/* Utils XP / Skills                            */
/* -------------------------------------------- */

export const LABELS = {
  force: "Force",
  dexterite: "Dextérité",
  intelligence: "Intelligence",
  acuite: "Acuité",
  endurance: "Endurance",
  pvMax: "PV max",
  manaMax: "Mana max",
  fatigueMax: "Fatigue max",
  regenPv: "Régén PV",
  regenMana: "Régén Mana",
  vitesse: "Vitesse",
  scoreArmure: "Score Armure",
  scoreResistance: "Score Résistance",
  armureFixe: "Armure fixe",
  resistanceFixe: "Résistance fixe",
  toucherPhysique: "Toucher physique",
  toucherMagique: "Toucher magique",
  initiativeMod: "Initiative",
  fatigueMax: "Fatigue max",
  podsMax: "Pods max"
};

/** Clé technique du seul emplacement où une relique peut aller. */
export const RELIC_SLOT = "artefact";

/** Libellés des emplacements — source unique pour les slots et les listes. */
export const SLOT_LABELS = {
  tete: "Tête",
  torse: "Torse",
  taille: "Taille",
  bras: "Bras",
  mains: "Mains",
  jambes: "Jambes",
  pieds: "Pieds",
  mainDroite: "Main droite",
  mainGauche: "Main gauche",
  [RELIC_SLOT]: "Relique"
};

/**
 * Emplacement effectif d'un item porté. Identique à `system.emplacement`,
 * SAUF pour une relique : son emplacement est imposé par son type, jamais
 * choisi. Sans ça une relique dont le champ est resté vide (import, copie
 * console, objet créé avant l'existence du type) s'équipe sans jamais
 * apparaître dans aucun slot — le symptôme classique « je l'équipe et il ne
 * se passe rien ».
 */
export function slotOfItem(item) {
  if (item?.type === "relic") return RELIC_SLOT;
  return item?.system?.emplacement ?? "";
}

// ⚠️ soit tu recopies ta fonction normalizeState complète depuis le V1,
// soit tu l'importes si tu l'as mise dans un fichier util.
export function normalizeState(st) {
  const out = foundry.utils.deepClone(st ?? {});
  out.id = String(out.id || foundry.utils.randomID());
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
    out.aura.target = String(out.aura.target ?? "allies");
    out.aura.linkedItemId = String(out.aura.linkedItemId ?? "");
    out.aura.expiresWithCooldown = !!out.aura.expiresWithCooldown;
  }
  return out;
}

/**
 * Complète chaque état actif avec son résumé lisible (« Force -2 • Dégâts/tour 3 »)
 * et ses drapeaux buff/affliction. Muté sur place, comme l'attend le template.
 *
 * Extrait de _prepareContext pour être réutilisable par la vue PNJ, qui
 * n'expose QUE les états (aucune caractéristique) et doit néanmoins les
 * décrire exactement comme la fiche complète.
 */
export function decorateStates(states) {
  for (const e of states ?? []) {
    const parts = [];

    const dot = Number(e?.dot?.perTick ?? e?.dot?.flat ?? 0) || 0;
    if (dot > 0) parts.push(`Dégâts/tour ${dot}`);
    else if (dot < 0) parts.push(`Soin/tour ${Math.abs(dot)}`);

    const fatDot = Number(e?.dot?.fatiguePerTick ?? 0) || 0;
    if (fatDot > 0) parts.push(`Épuise +${fatDot} fatigue/tour`);
    else if (fatDot < 0) parts.push(`Repose ${fatDot} fatigue/tour`);

    const mods = e?.mods ?? {};
    const modsTxt = Object.entries(mods)
      .map(([k, v]) => {
        const name = LABELS[k] ?? k;
        const flat = Number(v?.flat ?? 0) || 0;
        const pct = Number(v?.pct ?? 0) || 0;
        const a = flat ? `${flat > 0 ? "+" : ""}${flat}` : "";
        const b = pct ? `${pct > 0 ? "+" : ""}${pct}%` : "";
        const t = [a, b].filter(Boolean).join(" ");
        return t ? `${name} ${t}` : "";
      })
      .filter(Boolean)
      .join(" • ");

    if (modsTxt) parts.push(modsTxt);

    // Résistances accordées par l'état — sans elles, un buff « Écaille de
    // dragon » s'affichait comme une ligne vide de toute information alors
    // qu'il est justement là pour ça. Décrit avec la même formulation que
    // la fiche de sort (damage-types.js).
    parts.push(...stateResistTextParts(e).all);

    // Bonus de dégâts accordé aux attaques (attack-bonus.js) : même
    // formulation que la fiche de sort et que le chat, pour que le joueur
    // relise sur sa fiche exactement ce que le sort lui a promis.
    const atkTxt = attackBonusText(e?.attackBonus);
    if (atkTxt) parts.push(atkTxt);

    e.summary = parts.join(" • ");

    // tags buff/debuff
    let hasPlus = false, hasMinus = false;
    for (const v of Object.values(mods)) {
      const flat = Number(v?.flat ?? 0) || 0;
      const pct = Number(v?.pct ?? 0) || 0;
      if (flat > 0 || pct > 0) hasPlus = true;
      if (flat < 0 || pct < 0) hasMinus = true;
    }
    e.isBeneficial = hasPlus && !hasMinus;
    e.isHarmful = hasMinus && !hasPlus;
  }
  return states;
}

export function ensureStateDialogCSS() {
  if (document.getElementById("rpg-state-dialog-css")) return;

  const style = document.createElement("style");
  style.id = "rpg-state-dialog-css";
  style.textContent = `
/* ===== RPG State Dialog (V2) ===== */

/* on scroll sur le contenu du dialog */
.rpg-state-dialog-window {
  overflow-y: auto !important;
  overflow-x: hidden !important;
}

/* wrapper interne */
.rpg-state-dialog {
  max-height: 70vh !important;
  overflow: auto !important;
  padding-right: 12px !important;
}

/* inputs */
.rpg-state-dialog input,
.rpg-state-dialog select {
  width: 100% !important;
  box-sizing: border-box !important;
  min-width: 0 !important;
  margin: 0 !important;
}

/* lignes label/champ */
.rpg-state-dialog .line {
  display: grid !important;
  grid-template-columns: 220px 1fr !important;
  gap: 14px !important;
  align-items: center !important;
  margin-bottom: 12px !important;
}
.rpg-state-dialog .lbl {
  font-weight: 700 !important;
  opacity: .9 !important;
}

/* grilles 2 colonnes (durée/restant, portée min/max) */
.rpg-state-dialog .two {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 14px !important;
  margin-bottom: 12px !important;
}
.rpg-state-dialog .two label {
  display: block !important;
  font-weight: 700 !important;
  opacity: .9 !important;
  margin: 0 0 6px 0 !important;
}

/* mods : label + 2 inputs côte à côte (avec espace) */
.rpg-state-dialog .mods-row {
  display: grid !important;
  grid-template-columns: 220px 1fr !important;
  gap: 14px !important;
  align-items: center !important;
  margin: 10px 0 !important;
}
.rpg-state-dialog .mods-label {
  font-weight: 700 !important;
  opacity: .9 !important;
}
.rpg-state-dialog .mods-inputs {
  display: grid !important;
  grid-template-columns: 110px 110px !important;
  gap: 14px !important;
  justify-content: end !important;
  justify-items: end !important;
}
.rpg-state-dialog .mods-inputs input {
  width: 110px !important;
}

/* séparateurs */
.rpg-state-dialog hr {
  border: 0 !important;
  height: 1px !important;
  background: var(--border-soft, rgba(255,255,255,.12)) !important;
  margin: 16px 0 !important;
}

@media (max-width: 560px) {
  .rpg-state-dialog .line { grid-template-columns: 1fr !important; gap: 8px !important; }
  .rpg-state-dialog .two { grid-template-columns: 1fr !important; gap: 10px !important; }
  .rpg-state-dialog .mods-row { grid-template-columns: 1fr !important; gap: 8px !important; }
  .rpg-state-dialog .mods-inputs { justify-content: start !important; justify-items: start !important; }
}
  `;
  document.head.appendChild(style);
}

function xpPalierForLevel(level) {
  const n = Math.max(1, Number(level) || 1);
  const x = n - 1;
  return Math.round(100 + 40 * x + 15 * x * x);
}

import { skillXpToNext, skillsTotalLevels, skillsLevelCap, addXpToSkill, removeXpFromSkill } from "../rules/skills.js";

/* -------------------------------------------- */
/* Sheet Class (V2)                             */
/* -------------------------------------------- */

import { setupActorItemDrop } from "./drop-helper.js";
import { BASE_VITESSE } from "../rules/base-speed.js";
import { attackBonusText } from "../rules/attack-bonus.js";
import {
  applyUiTheme, sheetContent, sheetActionButtons, openImageLightbox,
  restoreScrollPositions, uniqueSheetOptions,
  tokenSizeContext, bindTokenSize, applyTokenSizeToPlaced
} from "./sheet-helpers.js";

export class RPGCharacterSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Actor";

  /** Empêche DocumentSheetV2 de crasher (tabs undefined -> reduce) */
  _prepareTabs() {
    return [];
  }


  static TABS = {
    primary: {
      navSelector: ".sheet-tabs",
      contentSelector: ".sheet-body",
      initial: "stats"
    }
  };

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      classes: ["rpg-sheet", "sheet", "actor", "character"],
      position: { width: 980, height: 820 },
      window: { contentClasses: ["rpg-sheet-window"], resizable: true },
      tabs: [
        { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }
      ],
      form: { closeOnSubmit: false, submitOnChange: true }
    },
    { inplace: false }
  );

  static PARTS = foundry.utils.mergeObject(
    super.PARTS ?? {},
    {
      form: {
        id: "form",
        template: "systems/rpg/templates/actor/character-sheet.hbs",
        scrollable: [".sheet-body"]
      }
    },
    { inplace: false }
  );

  get isEditable() {
    return game.user.isGM; // GM only for actor fields
  }

  /* -------------------------------------------- */
  /* Vue PNJ                                      */
  /* -------------------------------------------- */

  /**
   * Un joueur qui ouvre la fiche d'un personnage qui n'est pas le sien (lien
   * @UUID dans une quête, un journal, le chat…) ne doit voir qu'une « carte de
   * PNJ » : illustration en grand, nom, description et états qui l'affectent —
   * jamais ses caractéristiques, son inventaire ni ses sorts.
   *
   * `system.pnjView` laisse le MJ trancher au cas par cas :
   *   - "auto"    (défaut) : c'est un PNJ si aucun joueur ne le possède
   *                          (`hasPlayerOwner`), ce qui est vrai de tous les
   *                          PNJ et faux de tous les personnages joueurs, sans
   *                          que le MJ ait à cocher quoi que ce soit ;
   *   - "always"  : carte PNJ même si un joueur le possède (familier, mercenaire
   *                 confié à un joueur dont on veut cacher la fiche aux autres) ;
   *   - "never"   : fiche complète comme avant (PJ pas encore attribué,
   *                 groupe qui partage ses feuilles).
   * Le MJ et le propriétaire gardent TOUJOURS la fiche complète.
   *
   * Le critère lui-même vit dans rules/actor-roles.js : les listes de
   * distribution (Envoyer, destinataires d'une quête, macro Distribuer)
   * séparent PJ et PNJ avec EXACTEMENT la même règle, elles ne doivent pas
   * en réinventer une seconde qui finirait par diverger.
   */
  static isNpcViewFor(doc) {
    if (!doc || game.user.isGM || doc.isOwner) return false;
    return isNpcActor(doc);
  }

  _isNpcView() {
    return RPGCharacterSheetV2.isNpcViewFor(this.document);
  }

  /**
   * Deux préoccupations dans une seule méthode, et c'est délibéré : une classe
   * JavaScript ne peut pas définir deux fois `_initializeApplicationOptions`
   * — la seconde écrase silencieusement la première. Elles ont cohabité un
   * temps, et l'id unique ci-dessous ne s'appliquait donc jamais à cette
   * fiche, qui continuait d'entrer en collision avec ses semblables.
   *
   * 1. Un id de fenêtre UNIQUE par document (voir uniqueSheetOptions) : sans
   *    lui, ouvrir une deuxième fiche du même type arrache du DOM celle déjà
   *    ouverte, qui devient impossible à rouvrir sans erreur visible.
   * 2. La carte PNJ n'a pas de grille de stats à caser : la fenêtre large de
   *    la fiche complète la laisserait flotter au milieu du vide.
   */
  _initializeApplicationOptions(options) {
    const opts = uniqueSheetOptions(super._initializeApplicationOptions(options), options,
                                    "rpg-character-sheet-v2");
    try {
      if (RPGCharacterSheetV2.isNpcViewFor(options?.document)) {
        opts.position = { ...(opts.position ?? {}), width: 620, height: 780 };
      }
    } catch (e) {
      console.warn("[RPG] Vue PNJ — dimensionnement de la fenêtre :", e);
    }
    return opts;
  }

  /**
   * Contexte minimal de la carte PNJ. On ne se contente pas de masquer les
   * sections dans le template : rien de sensible n'est même mis dans le
   * contexte de rendu (même principe que la récompense d'une quête, cf.
   * item-quest-sheet-v2.js).
   */
  async _prepareNpcContext(ctx) {
    const actor = this.document;
    const TextEditorImpl = foundry.applications.ux.TextEditor?.implementation ?? foundry.applications.ux.TextEditor;

    let descriptionHTML = "";
    try {
      descriptionHTML = await TextEditorImpl.enrichHTML(String(actor.system?.description ?? ""), {
        secrets: false,
        relativeTo: actor
      });
    } catch (e) {
      console.warn("[RPG] Vue PNJ — enrichissement de la description :", e);
    }

    const states = Array.isArray(actor.system?.etatsActifs)
      ? foundry.utils.deepClone(actor.system.etatsActifs)
      : [];
    decorateStates(states);

    // Aucune donnée de fiche ne doit rester dans le contexte de rendu.
    delete ctx.source;
    delete ctx.fields;
    ctx.system = {};
    ctx.items = {};

    ctx.actor = actor;
    ctx.flags = {
      isGM: false, isOwner: false, limitedView: true, readOnly: true,
      canEditImg: false, npcView: true
    };
    ctx.npc = {
      name: actor.name,
      img: actor.img,
      descriptionHTML,
      hasDescription: !!String(actor.system?.description ?? "").trim(),
      states
    };
    return ctx;
  }

  /* -------------------------------------------- */
  /* Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);

    if (this._isNpcView()) return this._prepareNpcContext(ctx);

    const actor = this.document;
    const isGM = game.user.isGM;
    const isOwner = actor.isOwner;

    const itemDocs = Array.from(actor.items);
    const itemsObj = itemDocs.map(i => i.toObject());

    const categorized = this._categorizeItems(itemsObj);
    const charge = this._calcCharge();

    // Spells UI
    for (const s of categorized.sorts) {
      const doc = actor.items.get(s._id);
      if (!doc) continue;

      const uiSpell = buildSpellUI({ actor, item: doc });
      s._ui = uiSpell?.text ?? {};

      s._previewEffects = buildSpellEffectsPreview({ actor, item: doc }) ?? [];

      const cdRestant = Number(doc.system?.cooldown?.restant ?? doc.system?.recharge?.restant ?? 0) || 0;
      s._ui.onCooldown = cdRestant > 0;
      s._ui.cdRestant = cdRestant;
      s._ui.cdMax = Number(doc.system?.cooldown?.max ?? doc.system?.recharge?.max ?? 0) || 0;

      // Une aura vient d'un EFFET (fx.isAura), jamais du bloc hérité
      // system.aura — que setEquippedPassif utilise comme marqueur
      // d'équipement, si bien que tout passif porté se disait « aura ».
      s._ui.isAura = s._ui.auraEnabled;
    }

    ctx.actor = actor;
    ctx.system = foundry.utils.deepClone(actor.system ?? {});
    ctx.items = categorized;
    ctx.charge = charge;

    // ── Blessures ─────────────────────────────────────────────────────────
    ctx.hasBlessures = Array.isArray(actor.system?.blessures) && actor.system.blessures.length > 0;
    // États actifs liés aux blessures (type "wound" ou blessure permanente)
    ctx.autoStatesForBlessures = (actor.system?.etatsActifs ?? [])
      .filter(s => s.type === "wound" || s.permanent)
      .map(s => ({ label: s.label, summary: s.summary ?? "" }));

    // ── Tableau des stats : trois couches lisibles ────────────────────
    //   base      = valeur brute saisie par le MJ
    //   permanent = base + niveau + équipement (hors combat)
    //   total     = permanent + effets temporaires actifs (en combat)
    const effP  = actor.system?.derived?.effective?.principales ?? {};
    const permP = actor.system?.derived?.permanent?.principales ?? effP;
    const baseP = actor.system?.principales ?? {};
    const equip = actor.system?.derived?.bonus?.principales ?? {};
    const niv   = Number(actor.system?.niveau ?? 1) || 1;

    const mkStat = (key, label) => {
      const base = Number(baseP[key] ?? 0) || 0;
      const perm = Number(permP[key] ?? 0) || 0;
      const total = Number(effP[key] ?? 0) || 0;
      const gear = Number(equip[key] ?? 0) || 0;
      const fromEffects = total - perm;
      return {
        key, label, base, perm, total,
        fromLevel: niv,
        fromGear: gear,
        fromEffects,
        hasEffects: fromEffects !== 0,
        effectsUp: fromEffects > 0,
        // Détail affiché en infobulle sur la valeur permanente
        permTooltip: `Base ${base} + Niveau ${niv} + Équipement ${gear >= 0 ? "+" : ""}${gear}`,
        // Conservé pour compatibilité avec l'ancien affichage
        fromBonus: total - base - niv
      };
    };

    ctx.stats = [
      mkStat("force", "Force"),
      mkStat("intelligence", "Intelligence"),
      mkStat("dexterite", "Dextérité"),
      mkStat("acuite", "Acuité"),
      mkStat("endurance", "Endurance")
    ];

    // Défenses : mêmes trois couches
    const effD  = actor.system?.derived?.effective?.defenses ?? {};
    const permD = actor.system?.derived?.permanent?.defenses ?? effD;
    ctx.defStats = ["armureFixe", "resistanceFixe", "scoreArmure", "scoreResistance"].map(k => {
      const perm = Number(permD[k] ?? 0) || 0;
      const total = Number(effD[k] ?? 0) || 0;
      return { key: k, perm, total, fromEffects: total - perm, hasEffects: (total - perm) !== 0, effectsUp: (total - perm) > 0 };
    }).reduce((acc, r) => { acc[r.key] = r; return acc; }, {});

    // Résistances élémentaires : la grille MJ édite la valeur INNÉE
    // (system.resistancesElem), les pastilles affichent le TOTAL effectif
    // (derived.resistancesElem : inné + équipement porté + états actifs).
    ctx.resistElemRows = resistRows(normalizeResistMap(actor.system?.resistancesElem));
    ctx.resistElemActive = nonZeroResistRows(
      actor.system?.derived?.resistancesElem ?? actor.system?.resistancesElem
    );
    // Grille complète du TOTAL effectif : les pastilles ci-dessus ne montrent
    // que les lignes non nulles, ce qui est le bon défaut mais ne permet pas
    // de vérifier d'un coup d'œil « qu'est-ce que je vaux contre chaque type ».
    ctx.resistElemTotalRows = resistRows(
      normalizeResistMap(actor.system?.derived?.resistancesElem ?? actor.system?.resistancesElem)
    );
    // Résistances aux ÉTATS (équipement porté + états actifs). Elles étaient
    // appliquées mais n'apparaissaient sur aucune fiche d'acteur.
    ctx.stateResist = actorStateResistRows(actor);

    // Vitesse : permanente vs effective (épuisement, surcharge, effets)
    const vitPerm = Number(actor.system?.derived?.permanent?.vitesse ?? 0) || 0;
    const vitTot  = Number(actor.system?.deplacement?.vitesse ?? 0) || 0;
    ctx.vitesseInfo = {
      perm: vitPerm, total: vitTot,
      fromEffects: vitTot - vitPerm,
      hasEffects: vitTot !== vitPerm,
      effectsUp: vitTot > vitPerm
    };

    ctx.equipSlots = this._buildEquipSlotsUI(itemsObj);
    ctx.loadout = this._buildLoadoutUI();

    // Le joueur peut toujours s'équiper hors combat ; en combat le changement
    // consomme l'action « Échange d'arme » (voir _canEquipNow). On le lui dit
    // au lieu de le laisser découvrir le refus au clic.
    ctx.equipLocked = !isGM && !!game.combat?.active
      && !!game.combat.combatants.find(c => c.actorId === this.document.id);

    ctx.flags = {
      isGM,
      isOwner,
      limitedView: !isGM && !isOwner,
      readOnly: !isGM,
      // Portrait : MJ ou propriétaire peuvent changer leur illustration
      canEditImg: isGM || isOwner
    };

    ctx.tokenSize = tokenSizeContext(actor);

    // XP display
    const lvl = Number(actor.system?.niveau) || 1;
    const xpValeur = Math.max(0, Number(actor.system?.xp?.valeur) || 0);
    const xpPalier = xpPalierForLevel(lvl);
    const xpPct = xpPalier > 0 ? Math.min(100, Math.round((xpValeur / xpPalier) * 100)) : 0;
    ctx.calc = { xpValeur, xpPalier, xpPct };

    // states arrays
    ctx.system.etatsInit = Array.isArray(ctx.system.etatsInit) ? ctx.system.etatsInit : [];

    const states = Array.isArray(ctx.system.etatsActifs) ? foundry.utils.deepClone(ctx.system.etatsActifs) : [];

    // ✅ États automatiques (dérivés) — injectés en tête de liste pour que le
    // joueur les voit dans l'onglet États sans que le MJ ait à les appliquer
    const autoStates = [];
    if (ctx.system.derived?.epuise) {
      autoStates.push({
        id: "_auto_fatigue", label: "😴 Fatigué", type: "auto",
        tag: null, permanent: true, duration: 0, remaining: 0,
        summary: "-10% stats principales • -1 Vitesse",
        isBeneficial: false, isHarmful: true, isAuto: true,
        dot: { flat: 0, perTick: 0 }, mods: {}
      });
    }
    if (ctx.system.derived?.surcharge) {
      // Le résumé suit le palier réellement atteint : afficher « -1 Vitesse »
      // en toutes circonstances mentait dès 100 %, où le malus est de -50 %.
      const state = String(ctx.system.derived?.chargeState ?? "lourd");
      const SUMMARIES = {
        lourd:     "-1 Vitesse (charge ≥ 90 %)",
        surcharge: "-50 % Vitesse (charge ≥ 100 %)",
        bloque:    "-50 % Vitesse • sac plein, aucun objet ne peut être ajouté (charge ≥ 120 %)"
      };
      autoStates.push({
        id: "_auto_surcharge", label: state === "lourd" ? "🏋️ Chargé lourd" : "🏋️ Surchargé", type: "auto",
        tag: null, permanent: true, duration: 0, remaining: 0,
        summary: SUMMARIES[state] ?? SUMMARIES.lourd,
        isBeneficial: false, isHarmful: true, isAuto: true,
        dot: { flat: 0, perTick: 0 }, mods: {}
      });
    }

    decorateStates(states);

    ctx.system.etatsActifs = [...autoStates, ...states];
    // skills
    ctx.system.skills = ctx.system.skills ?? {};
    ctx.skills = Object.entries(ctx.system.skills).map(([key, s]) => {
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
        pct
      };
    });

    ctx.calc.skillsTotal = skillsTotalLevels(ctx.system.skills);
    ctx.calc.skillsCap = skillsLevelCap(actor);

    // Quêtes
    const STATUT_LABELS = { active: "En cours", reussie: "Réussie", echouee: "Échouée" };
    ctx.quests = actor.items
      .filter(i => i.type === "quest")
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"))
      .map(q => {
        const etapes = Array.isArray(q.system?.etapes) ? q.system.etapes : [];
        const etapeActuelle = Math.max(0, Math.min(Number(q.system?.etapeActuelle ?? 0) || 0, Math.max(0, etapes.length - 1)));

        // ✅ Toutes les étapes sont exposées avec un flag 'hidden' (étapes futures
        // pour un joueur) — le template masque selon qui regarde (MJ voit tout)
        const allEtapes = etapes.map((e, i) => ({
          num: i + 1,
          label: e?.label ?? `Étape ${i + 1}`,
          isCurrent: i === etapeActuelle,
          isPast: i < etapeActuelle,
          isFuture: i > etapeActuelle,
          hidden: i > etapeActuelle, // masqué aux joueurs uniquement
          objectifs: Array.isArray(e?.objectifs) ? e.objectifs : []
        }));

        return {
          id: q.id,
          name: q.name,
          statut: String(q.system?.statut ?? "active"),
          statutLabel: STATUT_LABELS[q.system?.statut ?? "active"] ?? "En cours",
          isActive: (q.system?.statut ?? "active") === "active",
          etapeActuelleNum: etapes.length ? etapeActuelle + 1 : 0,
          totalEtapes: etapes.length,
          hasMoreEtapes: etapeActuelle < etapes.length - 1,
          allEtapes
        };
      });

    // effP
    ctx.effP = actor.system?.derived?.effP
      ?? actor.system?.derived?.effective?.principales
      ?? actor.system?.principales
      ?? {};

    // ── Déplacement restant ce tour (uniquement en combat) ──────────────
    ctx.combatMove = null;
    try {
      const combat = game.combat;
      if (combat?.started) {
        const combatant = combat.combatants.find(c => c.actorId === actor.id);
        if (combatant) {
          const budget    = getBudget(combat, combatant.id);
          const vitesse   = Number(actor.system?.deplacement?.vitesse ?? BASE_VITESSE) || BASE_VITESSE;
          const remaining = movementRemaining(budget, vitesse);
          const spent     = movementSpent(budget);
          const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
          ctx.combatMove = {
            vitesse:      r1(vitesse),
            remaining:    r1(remaining),
            spent:        r1(spent),
            pct:          vitesse > 0 ? Math.max(0, Math.min(100, (remaining / vitesse) * 100)) : 0,
            isActiveTurn: combat.combatant?.id === combatant.id,
            depleted:     remaining <= 0.05
          };
        }
      }
    } catch (_e) { /* hors combat / pas de scène active */ }

    return ctx;
  }



  /* -------------------------------------------- */
  /* Submit handling                              */
  /* -------------------------------------------- */

  async _onSubmit(event, { updateData = null, preventClose = true } = {}) {
    if (!this.isEditable) return;
    await super._onSubmit(event, { updateData, preventClose });

    // pods recalculated after any actor update
    await this._updatePodsToActor();
  }

  /* -------------------------------------------- */
  /* Render + listeners                            */
  /* -------------------------------------------- */

  /**
   * Filtrage de la liste des sorts, entièrement côté DOM (aucun re-render) :
   * recherche par nom, élément, vitesse, disponibilité et nature de l'effet.
   * Chaque <li> porte ses critères en data-*, posés par buildSpellUI().
   */
  _bindSpellFilters(root) {
    const bar = root?.querySelector(".spell-filters");
    if (!bar || bar.dataset.rpgBound) return;
    bar.dataset.rpgBound = "1";

    const list = () => Array.from(root.querySelectorAll('[data-tab="spells"] .items-list .item'));
    const counter = root.querySelector(".spell-filter-count");
    const manaNow = Number(this.document.system?.ressources?.mana?.valeur ?? 0) || 0;

    const apply = () => {
      const q = (bar.querySelector(".spell-filter-q")?.value ?? "").trim().toLowerCase();
      const get = (f) => bar.querySelector(`.spell-filter[data-filter="${f}"]`)?.value ?? "";
      const elem = get("elem"), speed = get("speed"), avail = get("avail"), kind = get("kind");

      let shown = 0;
      for (const li of list()) {
        const name  = (li.querySelector(".name")?.textContent ?? "").toLowerCase();
        const cd    = Number(li.dataset.cd ?? 0) || 0;
        const mana  = Number(li.dataset.mana ?? 0) || 0;
        const kinds = String(li.dataset.kinds ?? "").split("|").filter(Boolean);

        let ok = true;
        if (q && !name.includes(q)) ok = false;
        if (ok && elem && String(li.dataset.elem || "neutre") !== elem) ok = false;
        if (ok && speed && String(li.dataset.speed || "normal") !== speed) ok = false;
        if (ok && avail === "ready" && cd > 0) ok = false;
        if (ok && avail === "cd" && cd <= 0) ok = false;
        if (ok && avail === "affordable" && mana > manaNow) ok = false;
        if (ok && kind && !kinds.includes(kind)) ok = false;

        li.hidden = !ok;
        if (ok) shown++;
      }

      const total = list().length;
      if (counter) {
        const filtered = shown !== total;
        counter.hidden = !filtered;
        counter.textContent = filtered ? `${shown} sort(s) sur ${total}` : "";
      }
    };

    bar.addEventListener("input", (ev) => {
      if (ev.target?.matches?.(".spell-filter-q")) apply();
    });
    bar.addEventListener("change", (ev) => {
      if (ev.target?.matches?.(".spell-filter")) apply();
    });
    bar.addEventListener("click", (ev) => {
      if (!ev.target?.closest?.(".spell-filter-reset")) return;
      ev.preventDefault();
      const q = bar.querySelector(".spell-filter-q");
      if (q) q.value = "";
      bar.querySelectorAll(".spell-filter").forEach(s => { s.value = ""; });
      apply();
    });
  }

  /**
   * Filtre par nom, entièrement côté DOM, pour les onglets qui n'ont qu'une
   * recherche simple (Inventaire, Équipement, Consommables, Quêtes — Sorts a
   * son propre filtre plus riche, cf. _bindSpellFilters). Un seul input par
   * onglet, ciblé via [data-filter-tab], filtre les lignes [data-item-id] de
   * ce même onglet en comparant leur nom (.item-edit, commun à tous les
   * onglets) à la recherche.
   */
  _bindSimpleNameFilters(root) {
    root.querySelectorAll(".name-filter-q").forEach((input) => {
      if (input.dataset.rpgBound) return;
      input.dataset.rpgBound = "1";

      const tab = input.dataset.filterTab;
      if (!tab) return;

      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        const rows = root.querySelectorAll(`[data-tab="${tab}"] .item[data-item-id]`);
        rows.forEach((row) => {
          const name = (row.querySelector(".item-edit")?.textContent ?? "").toLowerCase();
          row.hidden = !!q && !name.includes(q);
        });
      });
    });
  }

  /**
   * Survoler une ligne de sort, d'arme ou d'équipement dessine sa portée sur
   * le canevas, autour du token de ce personnage. Beaucoup plus lisible que
   * d'aller relire les chiffres dans la fiche de l'objet.
   */
  _bindRangePreview(root) {
    if (!root || root.dataset.rpgRangePreview) return;
    root.dataset.rpgRangePreview = "1";

    const api = () => game.rpg?.ranges;

    root.addEventListener("mouseover", (ev) => {
      const li = ev.target?.closest?.("[data-item-id]");
      if (!li) return;
      const item = this.document.items.get(li.dataset.itemId);
      if (!item) return;
      try {
        if (item.type === "spell") api()?.showSpellRange?.(this.document, item);
        else if (item.type === "weapon") {
          // Pour une arme, on montre les portées du personnage tel qu'il est
          // équipé (mêlée + tir), ce qui reflète ce qu'il peut réellement faire.
          const token = this.document.getActiveTokens?.()?.[0] ?? canvas?.tokens?.controlled?.[0];
          if (token) api()?.showTokenRanges?.(token);
        }
      } catch (e) { console.warn("[RPG] aperçu de portée :", e); }
    });

    root.addEventListener("mouseout", (ev) => {
      if (!ev.target?.closest?.("[data-item-id]")) return;
      try { api()?.clearRanges?.(); } catch { /* ignore */ }
    });
  }

  /**
   * Rend les lignes d'objets (sorts, armes, consommables) glissables vers la
   * barre d'actions. Foundry lit le JSON déposé et déclenche le hook
   * « hotbarDrop », que le système intercepte pour créer la macro d'usage.
   */
  /**
   * Permet au MJ de glisser un PNJ / lieu / objet / journal DANS les champs
   * texte de l'onglet PNJ pour y insérer un @UUID[...] au curseur — même
   * confort que sur la fiche de quête (cf. item-quest-sheet-v2.js), qui est
   * précisément d'où viennent les liens cliquables vers les PNJ.
   *
   * stopPropagation est indispensable : setupActorItemDrop pose un drop sur
   * TOUTE la fiche pour ajouter un objet à l'acteur.
   */
  _bindUuidDropTargets(root) {
    if (!game.user.isGM) return;
    root?.querySelectorAll?.("textarea.rpg-uuid-drop").forEach(ta => {
      if (ta.dataset.rpgUuidDrop) return;
      ta.dataset.rpgUuidDrop = "1";

      ta.addEventListener("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
      ta.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        let data;
        try {
          data = foundry.applications.ux.TextEditor?.implementation?.getDragEventData?.(ev)
              ?? foundry.applications.ux.TextEditor?.getDragEventData?.(ev);
        } catch (e) {
          console.warn("[RPG] Insertion @UUID (fiche personnage) :", e);
          return;
        }
        const uuid = String(data?.uuid ?? "").trim();
        if (!uuid) return;

        // Pas de libellé entre accolades : Foundry affiche alors le nom ACTUEL
        // du document, qui suit automatiquement un renommage.
        const snippet = `@UUID[${uuid}]`;
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        ta.value = `${ta.value.slice(0, start)}${snippet}${ta.value.slice(end)}`;
        const caret = start + snippet.length;
        ta.setSelectionRange?.(caret, caret);

        const name = ta.getAttribute("name");
        if (name) await this.document.update({ [name]: ta.value });
      });
    });
  }

  _bindItemDragOut(root) {
    if (!root || root.dataset.rpgItemDrag) return;
    root.dataset.rpgItemDrag = "1";

    for (const li of root.querySelectorAll("[data-item-id]")) {
      const item = this.document.items.get(li.dataset.itemId);
      if (!item) continue;
      li.setAttribute("draggable", "true");
      li.classList.add("rpg-draggable");
      li.title = li.title || "Glisse-moi dans la barre d'actions en bas de l'écran";
    }

    root.addEventListener("dragstart", (ev) => {
      const li = ev.target?.closest?.("[data-item-id]");
      if (!li) return;
      const item = this.document.items.get(li.dataset.itemId);
      if (!item) return;
      try {
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          type: "Item",
          uuid: item.uuid,
          actorId: this.document.id,
          itemId: item.id
        }));
        ev.dataTransfer.effectAllowed = "copy";
      } catch (e) {
        console.warn("[RPG] glisser d'un objet :", e);
      }
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    applyUiTheme(root);
    // Équiper un objet, cocher une case… re-rend toute la fiche : sans ceci
    // la fenêtre remonte tout en haut à chaque clic (voir sheet-helpers.js).
    restoreScrollPositions(root);

    // ── Vue PNJ (joueur, personnage qui n'est pas le sien) ────────────────
    // Rien à brancher hormis l'agrandissement de l'illustration : la carte ne
    // contient ni champ, ni bouton, ni onglet.
    if (this._isNpcView()) {
      root.querySelectorAll(".rpg-npc-illu").forEach(img => {
        if (img.dataset.rpgZoomBound) return;
        img.dataset.rpgZoomBound = "1";
        img.addEventListener("click", () => openImageLightbox(img.src, this.document.name));
      });
      return;
    }

    bindTokenSize(root, this.document);

    // ⚠️ _onRender est rappelé à CHAQUE rendu, mais `root` (l'élément de la
    // fenêtre) survit aux rendus : réenregistrer les écouteurs délégués les
    // empilait, si bien qu'un clic déclenchait l'action autant de fois qu'il y
    // avait eu de rendus — d'où les suppressions en double (« Item does not
    // exist ») et les XP comptées plusieurs fois. On ne branche qu'une fois.
    const NOOP_TARGET = { addEventListener() {} };
    const bindOnce = (key) => {
      const flag = `rpgBound_${key}`;
      if (root.dataset[flag]) return NOOP_TARGET;
      root.dataset[flag] = "1";
      return root;
    };

    this._bindSpellFilters(root);
    this._bindSimpleNameFilters(root);
    this._bindRangePreview(root);
    this._bindItemDragOut(root);
    this._bindUuidDropTargets(root);

    // ✅ Clic sur les images (portrait + token) → sélecteur de fichier Foundry V13
    root.querySelectorAll(".rpg-img-edit").forEach(img => {
      if (!this.isEditable && !this.document.isOwner) return;
      const field = img.dataset.field;
      if (!field) return;
      // Le token ne peut être modifié que par le MJ
      if (field.startsWith("prototypeToken") && !game.user.isGM) return;
      // Le portrait peut être modifié par le propriétaire même non-MJ
      if (field === "img" && !this.document.isOwner) return;

      img.addEventListener("click", async () => {
        const current = foundry.utils.getProperty(this.document, field) ?? "";
        const fp = new foundry.applications.apps.FilePicker({
          type: "image",
          current,
          callback: async (path) => {
            if (field === "img") {
              // Mise à jour du portrait UNIQUEMENT — pas de synchro vers le token
              await this.document.update({ "img": path }, { noTokenUpdate: true });
            } else {
              await this.document.update({ [field]: path });
            }
          }
        });
        fp.render(true);
      });
    });


    // ✅ Toggle du header (masquer/afficher le résumé pour plus d'espace)
    const headerToggle = root.querySelector(".header-toggle");
    const header = root.querySelector(".sheet-header");
    const isCollapsed = game.user.getFlag("rpg", `headerCollapsed.${this.document.id}`) ?? false;
    if (isCollapsed) {
      header?.classList.add("header-collapsed");
      if (headerToggle) headerToggle.textContent = "▼ Résumé";
    }
    headerToggle?.addEventListener("click", async () => {
      const collapsed = header?.classList.toggle("header-collapsed");
      if (headerToggle) headerToggle.textContent = collapsed ? "▼ Résumé" : "▲ Résumé";
      await game.user.setFlag("rpg", `headerCollapsed.${this.document.id}`, collapsed);
    });

    if (!this._tabs) {
      const Tabs = foundry.applications.ux.Tabs;
      this._tabs = new Tabs({
        navSelector: ".sheet-tabs",
        contentSelector: ".sheet-body",
        initial: "stats"
      });
    }
    this._tabs.bind(root);

    if (!root) return;

    // Drag & drop d'item (GM only) — doit être branché AVANT le early-return non-GM
    setupActorItemDrop(this, root);

    // ── Handler toggleEquip (joueurs ET MJ) ─────────────────────────────
    // Doit être branché avant le return joueur pour que les boutons fonctionnent
    bindOnce("equip").addEventListener("click", async (evEquip) => {
      const btn = evEquip.target?.closest("[data-action='toggleEquip']");
      if (!btn || btn.disabled) return;
      evEquip.preventDefault();
      evEquip.stopPropagation();
      const itemId = btn.dataset.itemId ?? btn.closest(".item")?.dataset?.itemId;
      const item = this.document.items.get(itemId);
      if (!item) return;
      btn.disabled = true;
      try {
        // En combat, changer d'équipement coûte une action (voir _canEquipNow)
        const gate = await this._canEquipNow(item);
        if (!gate.ok) {
          ui.notifications?.warn?.(gate.reason);
          return;
        }
        // On vérifie que l'écriture a réellement abouti : un refus de hook de
        // permission est silencieux, et annoncer « dégaine » alors que rien
        // n'a bougé est pire que ne rien dire.
        const avant = !!item.system?.equipe;
        await this._toggleEquipItem(item);
        if (!!item.system?.equipe === avant) {
          ui.notifications?.error?.(
            "Le changement d'équipement a été refusé — ouvre la console (F12) "
          + "pour voir la clé en cause.");
          return;
        }
        if (gate.consume) await gate.consume();
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
      } finally { btn.disabled = false; }
    }, { capture: true });

    // ── Slots d'équipement (joueurs ET MJ) ───────────────────────────────
    // Branché avant le retour joueur : sinon les listes déroulantes des
    // emplacements ne réagissaient pas du tout côté joueur.
    bindOnce("equipSlot").addEventListener("change", async (evSlot) => {
      const el = evSlot.target;
      if (!el?.matches?.("select[data-action='equipSlotSelect']")) return;
      if (!game.user.isGM && !this.document.isOwner) return;
      evSlot.stopPropagation();

      const slot = el.dataset.slot;
      const itemId = el.value || "";
      // Verrou de combat : on teste l'objet concerné (celui qu'on prend, ou
      // celui qu'on repose quand le joueur remet le slot à « Vide »).
      const subject = this.document.items.get(itemId)
                   ?? this._findEquippedForSlot(slot)
                   ?? null;
      el.disabled = true;
      try {
        const gate = await this._canEquipNow(subject ?? { name: "cet équipement" });
        if (!gate.ok) {
          ui.notifications?.warn?.(gate.reason);
          await this.render({ force: true });   // remet la liste sur son état réel
          return;
        }
        // Même contrôle que pour le bouton Équiper : on ne confirme que si
        // l'emplacement a réellement changé.
        const avant = this._findEquippedForSlot(slot)?.id ?? "";
        await this._onEquipSlotChange(slot, itemId);
        if ((this._findEquippedForSlot(slot)?.id ?? "") === avant) {
          ui.notifications?.error?.(
            "Le changement d'emplacement a été refusé — ouvre la console (F12) "
          + "pour voir la clé en cause.");
          await this.render({ force: true });
          return;
        }
        if (gate.consume) await gate.consume();
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
      } catch (e) {
        console.error("[RPG] changement d'emplacement :", e);
        ui.notifications?.error?.("Impossible de changer cet emplacement — voir la console (F12).");
      } finally { el.disabled = false; }
    }, { capture: true });

    // ── Déclarer un sort / une action (joueurs ET MJ) ────────────────────
    // Le gestionnaire générique est branché après le retour non-MJ : sans ce
    // branchement, le bouton « Déclarer » ne faisait rien côté joueur.
    bindOnce("declare").addEventListener("click", async (evDecl) => {
      const btn = evDecl.target?.closest?.("[data-action='declareSpell'], [data-action='castSpell']");
      if (!btn || btn.disabled) return;
      if (!this.document.isOwner) return;
      evDecl.preventDefault();
      evDecl.stopPropagation();
      const itemId = btn.dataset.itemId ?? btn.closest("[data-item-id]")?.dataset?.itemId;
      const item = this.document.items.get(itemId);
      if (!item) return;
      btn.disabled = true;
      try {
        await this._declareItem(item);
      } finally { btn.disabled = false; }
    }, { capture: true });

    // ── Emplacements Talent / Passif (joueurs ET MJ) ─────────────────────
    // Branché avant le retour joueur, comme les slots d'équipement : c'est
    // le joueur qui choisit ce qu'il porte, pas le MJ.
    bindOnce("loadout").addEventListener("click", async (evLo) => {
      const btn = evLo.target?.closest?.("[data-action='pickTalent'], [data-action='pickPassif']");
      if (!btn || btn.disabled) return;
      if (!game.user.isGM && !this.document.isOwner) return;
      evLo.preventDefault();
      evLo.stopPropagation();
      const kind = btn.dataset.action === "pickTalent" ? "talent" : "passif";
      btn.disabled = true;
      try {
        await this._pickLoadout(kind, btn.dataset.itemId || null);
      } catch (e) {
        console.error("[RPG] changement d'emplacement Talent/Passif :", e);
        ui.notifications?.error?.("Impossible de changer cet emplacement — voir la console (F12).");
      } finally {
        btn.disabled = false;
        await this.render({ force: true });
      }
    }, { capture: true });

    // ── Ouvrir la fiche d'un objet possédé (joueurs ET MJ) ───────────────
    // Doit être branché AVANT le retour joueur : sinon les joueurs ne
    // pouvaient pas consulter leurs propres armes/armures/objets.
    bindOnce("itemEdit").addEventListener("click", (ev) => {
      const link = ev.target?.closest?.(".item-edit");
      if (!link) return;
      ev.preventDefault();
      ev.stopPropagation();
      const li = link.closest("[data-item-id]") ?? link.closest(".item");
      const item = this.document.items.get(li?.dataset?.itemId);
      item?.sheet?.render(true);
    }, { capture: true });

    // Player: disable inputs and most actions
    // ⚠️ Uniquement dans le CONTENU : la barre de titre porte les boutons
    // Fermer/Épingler (eux aussi data-action) — les désactiver empêchait les
    // joueurs de fermer leur fiche avec la croix.
    if (!game.user.isGM) {
      const scope = sheetContent(root);
      const owned = this.document.isOwner;

      // Commandes qui appartiennent au joueur, pas des champs de la fiche :
      // elles restent actives s'il possède le personnage.
      const OWNER_CTRL = "[data-action='equipSlotSelect'], [data-action='toggleEquip'],"
                       + "[data-action='declareSpell'], [data-action='castSpell'],"
                       // Emplacements Talent / Passif : ils appartiennent au
                       // joueur, pas au MJ — c'est tout l'objet de l'onglet.
                       + "[data-action='pickTalent'], [data-action='pickPassif']";
      // Pur confort d'affichage : actif pour tout le monde.
      const VIEW_CTRL  = ".spell-filter, .spell-filter-q, .spell-filter-reset";

      scope.querySelectorAll("input, select, textarea").forEach(el => {
        if (el.matches(VIEW_CTRL))  { el.disabled = false;  return; }
        if (el.matches(OWNER_CTRL)) { el.disabled = !owned; return; }
        el.disabled = true;
      });
      // Un seul passage : sheetActionButtons concatène son argument au
      // sélecteur, une liste à virgules y perdrait son préfixe.
      sheetActionButtons(root).forEach(el => {
        if (el.matches(VIEW_CTRL))  { el.disabled = false; return; }
        el.disabled = el.matches(OWNER_CTRL) ? !owned : true;
      });
      root.querySelectorAll(".spell-filter-reset").forEach(el => { el.disabled = false; });
      return;
    }

    // Debounced pods update
    if (typeof this._debouncedPodsUpdate !== "function") {
      this._debouncedPodsUpdate = foundry.utils.debounce(() => this._updatePodsToActor(), 150);
    }

    // Click delegation — protégé contre les erreurs non-catchées
    bindOnce("actions").addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("[data-action], .item-edit");
      if (!btn) return;

      // item-edit is clickable anchor without data-action
      if (btn.classList.contains("item-edit")) {
        ev.preventDefault();
        const li = btn.closest(".item");
        const item = this.document.items.get(li?.dataset?.itemId);
        item?.sheet?.render(true);
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();

      const action = btn.dataset.action;

      if (action === "configurePrototype") {
        await this._openPrototypeToken();
        return;
      }

      if (action === "applyTokenSize") {
        const n = await applyTokenSizeToPlaced(this.document);
        ui.notifications?.info?.(n
          ? `${n} token(s) redimensionné(s).`
          : "Aucun token posé à redimensionner.");
        return;
      }

      if (action === "createItem") {
        await this._createItem(btn.dataset.type);
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
        return;
      }

      if (action === "deleteItem") {
        const li = btn.closest(".item");
        const itemId = btn.dataset.itemId || li?.dataset?.itemId;
        if (!itemId) return;
        // L'objet peut déjà avoir disparu (double clic, ligne obsolète après
        // un rendu) : on ne demande la suppression que s'il existe encore,
        // sinon le serveur renvoie « Item does not exist ».
        if (this.document.items.get(itemId)) {
          await this.document.deleteEmbeddedDocuments("Item", [itemId]);
        }
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
        return;
      }

      // castSpell / declareSpell sont gérés par bindOnce("declare"), branché
      // plus haut pour rester accessible aux joueurs.

      if (action === "adjRes" || action === "fatigueChange") {
        // Verrou anti-crash : empêche les clics rapides simultanés
        if (this._btnUpdating) return;
        this._btnUpdating = true;

        try {
          if (action === "adjRes") {
            const res   = btn.dataset.res;
            const delta = Number(btn.dataset.delta) || 0;
            if (!res || !delta) return;
            const valPath = `system.ressources.${res}.valeur`;
            const maxPath = `system.ressources.${res}.max`;
            const cur = Number(foundry.utils.getProperty(this.document, valPath) ?? 0) || 0;
            const max = Number(foundry.utils.getProperty(this.document, maxPath) ?? 9999) || 9999;
            const next = Math.max(0, Math.min(max, cur + delta));
            if (next !== cur) await this.document.update({ [valPath]: next });
          } else {
            if (!game.user.isGM) return;
            const delta = Number(btn.dataset.delta ?? 0) || 0;
            if (!delta) return;
            const cur = Number(this.document.system?.ressources?.fatigue?.valeur ?? 0) || 0;
            // Pas de plafond : le max est le seuil d'épuisement (voir actor.js)
            const next = Math.max(0, cur + delta);
            if (next !== cur) await this.document.update({ "system.ressources.fatigue.valeur": next });
          }
        } finally {
          // Délai court avant de déverrouiller — laisse le re-render se terminer
          setTimeout(() => { this._btnUpdating = false; }, 300);
        }
        return;
      }

      if (action === "adjSpellCooldown") {
        const itemId = btn.dataset.itemId || btn.closest(".item")?.dataset?.itemId;
        const delta  = Number(btn.dataset.delta) || 0;
        const item   = this.document.items.get(itemId);
        if (!item || !delta) return;
        const max = Number(item.system?.cooldown?.max ?? item.system?.recharge?.max ?? 0) || 0;
        const cur = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
        const next = Math.max(0, Math.min(max, cur + delta));
        if (next !== cur) {
          await item.update({ "system.cooldown.restant": next, "system.recharge.restant": next });
        }
        return;
      }

      if (action === "useItem") {
        const itemId =
          btn.dataset.itemId ||
          btn.closest(".item")?.dataset?.itemId;
        if (!itemId) return;
        await this._useItemPreviewFromId(itemId);
        return;
      }

      // States actions (kept as placeholders so you can wire existing methods)
      if (action === "stateAdd") { await this._stateAdd?.(); return; }

      if (action === "addBlessure" && game.user.isGM) {
        const raw  = this.document.system?.blessures;
        const list = Array.isArray(raw) ? foundry.utils.deepClone(raw) :
                     (raw && typeof raw === "object") ? Object.values(foundry.utils.deepClone(raw)) : [];
        list.push({
          id: foundry.utils.randomID(),
          label: "Nouvelle blessure",
          localisation: "",
          gravite: "moderee",
          notes: "",
          date: game.time?.worldTime ?? 0
        });
        await this.document.update({ "system.blessures": list }, { render: false });
        this.render({ force: false });
        return;
      }

      if (action === "removeBlessure" && game.user.isGM) {
        const idx  = Number(btn.dataset.idx);
        if (!Number.isFinite(idx)) return;
        const raw  = this.document.system?.blessures;
        const list = Array.isArray(raw) ? foundry.utils.deepClone(raw) :
                     (raw && typeof raw === "object") ? Object.values(foundry.utils.deepClone(raw)) : [];
        list.splice(idx, 1);
        await this.document.update({ "system.blessures": list });
        return;
      }
      if (action === "stateEdit") { await this._stateEdit?.(btn.dataset.id); return; }
      if (action === "stateDelete") { await this._stateDelete?.(btn.dataset.id); return; }
      if (action === "stateShow") { await this._stateShow?.(btn.dataset.id); return; }

      if (action === "questComplete" || action === "questFail") {
        if (!game.user.isGM) return;
        const itemId = btn.dataset.itemId || btn.closest(".item")?.dataset?.itemId;
        const quest  = this.document.items.get(itemId);
        if (!quest) return;
        const { resolveQuest } = await import("../rules/quest-resolve.js");
        await resolveQuest(this.document, quest, { success: action === "questComplete" });
        await this.render({ force: true });
        return;
      }

      if (action === "questNextEtape") {
        if (!game.user.isGM) return;
        const itemId = btn.dataset.itemId || btn.closest(".item")?.dataset?.itemId;
        const quest  = this.document.items.get(itemId);
        if (!quest) return;
        const etapes = Array.isArray(quest.system?.etapes) ? quest.system.etapes : [];
        const cur = Math.max(0, Number(quest.system?.etapeActuelle ?? 0) || 0);
        const next = Math.min(etapes.length - 1, cur + 1);
        if (next === cur) return;
        await quest.update({ "system.etapeActuelle": next }, { render: false });
        this.render({ force: false });

        // ✅ Quête partagée : synchronise la même étape sur toutes les autres copies
        const { propagateQuestUpdate } = await import("../rules/quest-group.js");
        const synced = await propagateQuestUpdate(quest, { "system.etapeActuelle": next });

        const label = etapes[next]?.label ? ` — ${etapes[next].label}` : "";
        const syncTxt = synced.length ? ` (synchronisé pour ${synced.length} autre(s) PJ)` : "";
        await ChatMessage.create({
          content: `📜 <b>${this.document.name}</b> avance dans <b>${quest.name}</b> : Étape ${next + 1}${label}${syncTxt}`
        });
        if (game.rpg?.journal) {
          game.rpg.journal.appendToCampaignJournal(`<b>${this.document.name}</b> avance dans la quête <b>${quest.name}</b> (étape ${next + 1}).`).catch(() => {});
        }
        await this.render({ force: true });
        return;
      }

      if (action === "skillAddXp" || action === "skillRemoveXp") {
        const li = btn.closest("[data-skill]");
        const key = li?.dataset?.skill;
        const amt = Number(li?.querySelector(".skill-xp-add")?.value || 0);
        if (!key) return;
        if (action === "skillAddXp") await addXpToSkill(this.document, key, amt);
        else await removeXpFromSkill(this.document, key, amt);
        await this.render({ force: true });
        return;
      }
    }, { passive: false });

    // Change delegation
    bindOnce("change").addEventListener("change", async (ev) => {
      const el = ev.target;

      // Les emplacements sont gérés plus haut par bindOnce("equipSlot"),
      // branché avant le retour joueur et commun au MJ et aux joueurs.

      if (el?.matches?.("input[data-field]")) {
        const li = el.closest(".item");
        const item = this.document.items.get(li?.dataset?.itemId);
        if (!item) return;

        const field = el.dataset.field;
        const value = Number(el.value ?? 0);
        await item.update({ [field]: value });

        this._debouncedPodsUpdate?.();
        return;
      }
    }, { passive: true });
  }

  /* -------------------------------------------- */
  /* Pods calc (exclude spells/skills)            */
  /* -------------------------------------------- */

  async _updatePodsToActor() {
    // No-op délibéré : `system.charge.podsActuels` est désormais une valeur
    // DÉRIVÉE, recalculée depuis les objets à chaque prepareDerivedData
    // (carriedWeight(), documents/actor.js) et publiée par lui.
    //
    // Cette méthode persistait auparavant sa propre version du poids porté.
    // Entretenir une copie stockée à côté d'une copie calculée est exactement
    // ce qui a produit le bug d'origine — trois calculs du même poids, dont
    // celui que lisait prepareDerivedData pointait sur un champ inexistant, si
    // bien que la surcharge n'était jamais détectée. On garde la méthode et
    // ses appelants (les recalculs déclenchés par l'inventaire restent des
    // points d'entrée légitimes) mais elle n'écrit plus rien : la mise à jour
    // du document par l'ajout/retrait d'objet suffit à relancer le calcul.
  }

  /* -------------------------------------------- */
  /* Items categorization / charge                */
  /* -------------------------------------------- */

  _categorizeItems(items) {
    const out = {
      inventaire: [],
      equipe: [],
      nonEquipe: [],
      consommables: [],
      sorts: [],
      competences: []
    };

    for (const it of (items ?? [])) {
      it.system = it.system ?? {};
      it.system.qte = it.system.qte ?? 1;
      it.system.poids = it.system.poids ?? 0;

      const qte = Number(it.system.qte) || 0;
      const poids = Number(it.system.poids) || 0;

      it._derived = it._derived ?? {};
      it._derived.poidsTotal = Number((qte * poids).toFixed(2));
      // Libellé lisible de l'emplacement : les listes « Porté »/« Dans le
      // sac » affichaient la clé technique brute, ce qui donnait
      // « artefact » pour une relique alors que le slot s'appelle
      // « Relique » deux centimètres plus haut.
      it._derived.emplacementLabel = SLOT_LABELS[slotOfItem(it)] ?? slotOfItem(it);

      const t = it.type;
      const estEquip = (t === "weapon" || t === "armor" || t === "relic");
      const equipe = !!it.system.equipe;

      if (t === "consumable") out.consommables.push(it);
      // Un talent a son propre onglet (rules/loadout.js) : le laisser tomber
      // dans le sac le ferait apparaître deux fois, avec un poids et une
      // quantité qui ne veulent rien dire pour lui.
      else if (t === "talent") continue;
      else if (t === "spell") out.sorts.push(it);
      else if (t === "skill") out.competences.push(it);
      else if (t === "quest") continue; // gérée par le bloc Quêtes dédié (ctx.quests), pas ici
      else if (estEquip && equipe) out.equipe.push(it);
      else if (estEquip && !equipe) out.nonEquipe.push(it);
      else out.inventaire.push(it);
    }

    return out;
  }

  _calcCharge() {
    // Poids porté et palier viennent des données dérivées (carriedWeight /
    // chargeTierOf, documents/actor.js). La barre les LIT, elle ne les
    // recalcule plus : la version locale d'avant partait des listes déjà
    // catégorisées et pouvait donc afficher un pourcentage différent de celui
    // qui décide du malus de vitesse et du refus d'objet — un joueur bloqué à
    // « 118 % » affiché est exactement le symptôme que ça produit.
    const sys = this.document.system ?? {};
    const podsActuels = Number(sys.charge?.podsActuels ?? 0) || 0;
    const podsMax = Number(sys.charge?.podsMax ?? 0) || 0;
    const state = String(sys.derived?.chargeState ?? "normal");

    const pct = Math.min(999, Number(sys.derived?.chargePct ?? 0) || 0);

    // « Chargé » (60 %) est un palier purement visuel : il prévient sans rien
    // appliquer. Les trois autres correspondent aux paliers mécaniques.
    const ETATS = {
      bloque:    { etat: "Sac plein", fill: "enc-surcharge", badge: "badge-surcharge" },
      surcharge: { etat: "Surchargé", fill: "enc-surcharge", badge: "badge-surcharge" },
      lourd:     { etat: "Lourd",     fill: "enc-lourd",     badge: "badge-lourd" }
    };
    const info = ETATS[state] ?? (podsMax > 0 && pct >= 60
      ? { etat: "Chargé", fill: "enc-charge", badge: "badge-charge" }
      : { etat: "Normal", fill: "", badge: "badge-normal" });

    return {
      podsActuels: Number(podsActuels.toFixed(2)),
      podsMax,
      pct,
      pctCapped: Math.min(100, pct),
      etat: info.etat,
      cssFill: info.fill,
      cssBadge: info.badge,
      cssSurcharge: info.fill,
      state,
      plafond: Math.round(podsMax * 1.2 * 10) / 10
    };
  }

  /* -------------------------------------------- */
  /* Equip logic (same as your V1)                */
  /* -------------------------------------------- */

  /**
   * Peut-on (dés)équiper cet objet maintenant ?
   *
   * Hors combat : oui, librement — c'est du rangement de sac.
   * En combat   : rengainer/dégainer prend du temps. Il faut être à son tour
   *               et dépenser l'action « Échange d'arme » (1 par tour).
   * Le MJ n'est jamais bloqué.
   *
   * @returns {Promise<{ok:boolean, reason?:string, consume?:Function}>}
   */
  /**
   * Déclare un objet de l'onglet Sorts.
   * Les actions de base (Attaquer, Changer d'arme) ont leur propre logique ;
   * tout le reste passe par le workflow de sort habituel.
   */
  async _declareItem(item) {
    try {
      const { runDefaultAction } = await import("../rules/default-actions.js");
      const special = await runDefaultAction(this.document, item);
      if (special.handled) {
        // `cancelled` = fenêtre de choix fermée par le joueur : pas d'alerte.
        if (!special.ok && !special.cancelled) {
          ui.notifications?.warn?.(special.reason ?? "Action impossible.");
        }
        await this.render({ force: true });
        return;
      }
    } catch (e) {
      console.error("[RPG] action de base :", e);
    }

    const res = await declareSpell(this.document, item);
    if (!res?.ok) ui.notifications?.warn?.(res?.reason ?? "Impossible de lancer le sort.");
    await this.render({ force: true });
  }

  /**
   * Contexte des deux emplacements — Talent et Passif (rules/loadout.js).
   *
   * Les deux listes contiennent TOUJOURS une entrée « Aucun » : ne rien
   * porter est un choix légitime des deux côtés (aucun malus subi pour un
   * talent, aucun mana dépensé pour un passif), pas un état à corriger.
   */
  _buildLoadoutUI() {
    const actor = this.document;
    const combat = game.combat?.active ? game.combat : null;

    const talentRow = (it, worn) => ({
      id: it.id, name: it.name, img: it.img,
      summary: talentSummary(it),
      description: String(it.system?.description ?? ""),
      worn
    });

    // `cooldown` n'est bloquant qu'en combat, comme le refus dans
    // setEquippedPassif : hors combat rien ne décompte, donc rien ne bloque.
    const passifRow = (it, worn) => {
      const left = passifCooldownLeft(it);
      return {
        id: it.id, name: it.name, img: it.img,
        cost: passifManaCost(it),
        // Ce que le passif donne, ligne par ligne. L'appel se faisait avec
        // l'item nu alors que la signature attend { actor, item }, et son
        // retour est un TABLEAU : le résumé rendu valait « [object Object] »
        // au mieux, rien la plupart du temps — l'onglet ne disait donc jamais
        // ce qu'un passif apporte, alors que c'est la seule information qui
        // permet d'en choisir un.
        effects: buildSpellEffectsPreview({ actor, item: it }),
        description: String(it.system?.description ?? ""),
        cooldownLeft: left,
        locked: !!combat && left > 0 && !worn,
        worn
      };
    };

    const wornT = equippedTalent(actor);
    const wornP = equippedPassif(actor);

    return {
      inCombat: !!combat,
      // Après son premier tour, l'acteur a déjà payé : changer de passif
      // recoûte donc son mana. Avant, le prélèvement de début de tour n'a pas
      // encore eu lieu et prendra le NOUVEAU passif — le changement est donc
      // gratuit sur le moment. Le dire évite de faire croire à un oubli.
      passifWillCharge: !!combat && hasPaidThisCombat(actor, combat),
      talents: talentsOf(actor).map(it => talentRow(it, wornT?.id === it.id)),
      passifs: passifsOf(actor).map(it => passifRow(it, wornP?.id === it.id)),
      talentWorn: wornT ? talentRow(wornT, true) : null,
      passifWorn: wornP ? passifRow(wornP, true) : null
    };
  }

  /**
   * Change un emplacement. `itemId` à null vide l'emplacement.
   *
   * En combat, le changement consomme une place d'action — normale pour un
   * talent, rapide pour un passif. La réservation est enveloppée comme
   * ailleurs : un client JOUEUR ne peut pas écrire les flags du document
   * Combat (Foundry le lui refuse), donc l'échec est journalisé et le
   * changement a quand même lieu, exactement comme le fait macro/menu.js
   * pour les attaques et les sorts. La place n'est réellement décomptée que
   * lorsque le client du MJ la confirme — c'est le trou connu de l'économie
   * d'action, pas une particularité des emplacements.
   */
  async _pickLoadout(kind, itemId) {
    const actor = this.document;
    if (!game.user.isGM && !actor.isOwner) return;

    const lo = await import("../rules/loadout.js");
    const combat = game.combat?.active ? game.combat : null;
    const isTalent = kind === "talent";

    const current = isTalent ? lo.equippedTalent(actor) : lo.equippedPassif(actor);
    if ((current?.id ?? null) === (itemId ?? null)) return;   // rien à faire

    // Mana d'abord, tant que l'ancien passif est encore en place : si la
    // bourse est vide, on n'a rien écrit et l'état reste cohérent.
    // Le refus pour cause de recharge doit précéder le prélèvement : payer
    // puis se voir refuser l'échange aurait vidé la bourse pour rien.
    if (!isTalent && itemId && combat && lo.passifCooldownLeft(actor.items.get(itemId)) > 0) {
      const it = actor.items.get(itemId);
      ui.notifications?.warn?.(
        `${it?.name ?? "Ce passif"} est encore en recharge — `
      + `${lo.passifCooldownLeft(it)} tour(s) à attendre.`);
      return;
    }

    let charge = null;
    if (!isTalent && combat && lo.hasPaidThisCombat(actor, combat) && itemId) {
      const next = actor.items.get(itemId);
      charge = await lo.chargePassif(actor, next);
    }

    const chosen = isTalent
      ? await lo.setEquippedTalent(actor, itemId)
      : await lo.setEquippedPassif(actor, itemId);

    // Pris en cours de combat APRÈS le premier tour : il est lancé sur-le-
    // champ, donc sa recharge part maintenant. Avant le premier tour, il n'y
    // a rien à armer — chargePassifOnFirstTurn s'en chargera le moment venu,
    // sur le passif effectivement porté à cet instant.
    if (!isTalent && chosen && combat && lo.hasPaidThisCombat(actor, combat)) {
      await lo.startPassifCooldown(actor, chosen);
    }

    if (combat) await this._consumeLoadoutSlot(isTalent ? "sortNormal" : "sortRapide", chosen, kind);

    const what = chosen?.name ?? "Aucun";
    const cost = charge?.paid ? ` <span style="opacity:.7">(−${charge.paid} mana)</span>` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `${isTalent ? "🎭" : "🔮"} <b>${actor.name}</b> — `
             + `${isTalent ? "Talent" : "Passif"} : <b>${what}</b>${cost}`
    });
  }

  /** Réserve puis confirme la place d'action d'un changement d'emplacement. */
  async _consumeLoadoutSlot(slot, item, kind) {
    try {
      const combat = game.combat;
      const cbt = combat?.combatants?.find(c => c.actorId === this.document.id);
      if (!combat || !cbt) return;

      const budget = await getBudget(combat, cbt.id);
      if (!canUseSlot(budget, slot)) {
        ui.notifications?.warn?.(
          `Plus de place d'action ${slot === "sortRapide" ? "rapide" : "normale"} ce tour — `
        + `le changement est fait, préviens le MJ.`);
        return;
      }
      // Ni réservation ni attente : le changement est déjà écrit quand on
      // arrive ici, il n'y a rien à valider. confirmSlot rend un NOUVEAU
      // budget (il ne modifie pas le sien), d'où le passage direct à
      // saveBudget.
      await saveBudget(combat, cbt.id, confirmSlot(budget, slot));
    } catch (e) {
      // Refus attendu côté joueur : Foundry n'autorise pas un non-MJ à
      // écrire les flags d'un Combat. On journalise et on continue.
      console.warn(`[RPG] place d'action du changement de ${kind} non réservée :`, e);
    }
  }

  async _canEquipNow(item) {
    if (game.user.isGM) return { ok: true };
    if (!this.document.isOwner) return { ok: false, reason: "Cet équipement n'est pas le tien." };

    // Hors combat c'est libre. En combat, l'échange doit avoir été déclaré via
    // l'action « Changer d'arme » ET validé par le MJ : c'est cette validation
    // qui consomme l'action du tour. Le joueur n'écrit jamais sur le document
    // Combat lui-même — Foundry le lui refuserait.
    try {
      const { swapAllowed } = await import("../rules/default-actions.js");
      const gate = swapAllowed(this.document);
      if (!gate.ok) return gate;
      return {
        ok: true,
        consume: async () => {
          const nowEquipped = !!item?.system?.equipe;
          if (!item?.name) return;
          // Simple accusé de réception pour celui qui manipule son sac :
          // ni les autres joueurs ni le MJ n'ont besoin de le lire.
          ui.notifications?.info?.(
            `${nowEquipped ? "Équipé" : "Rangé"} : ${item.name}.`);
        }
      };
    } catch (e) {
      console.warn("[RPG] autorisation d'échange d'arme :", e);
      return { ok: true };   // en cas de souci, on ne bloque pas le joueur
    }
  }

  async _toggleEquipItem(item) {
    const equipe = !!item.system.equipe;
    const type = item.type;
    const slot = slotOfItem(item);

    const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);

    const unequipItems = async (items) => {
      if (!items.length) return;
      await this.document.updateEmbeddedDocuments("Item",
        items.map(it => ({ _id: it.id, "system.equipe": false }))
      );
    };

    if (equipe) {
      await item.update({ "system.equipe": false });
      return;
    }

    const equipped = this.document.items.filter(i => i.system?.equipe);

    if (type === "weapon") {
      const twoHands = !!item.system?.twoHands;

      if (!HAND_SLOTS.has(slot)) {
        ui.notifications.warn("Une arme doit avoir emplacement mainDroite ou mainGauche.");
        return;
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
      ui.notifications.warn("Cet objet n'a pas d'emplacement défini (system.emplacement).");
      return;
    }

    const conflicts = equipped.filter(i => i.id !== item.id && slotOfItem(i) === slot);
    await unequipItems(conflicts);

    // Relique équipée depuis le sac : on fige aussi son emplacement, pour
    // qu'elle apparaisse bien dans le slot Relique même si le champ était
    // resté vide (cf. slotOfItem).
    const patch = { "system.equipe": true };
    if (item.type === "relic" && item.system?.emplacement !== RELIC_SLOT) {
      patch["system.emplacement"] = RELIC_SLOT;
    }
    await item.update(patch);
  }


  _buildEquipSlotsUI(items) {
    const HAND_SLOT_KEYS = new Set(["mainDroite", "mainGauche"]);
    const L = SLOT_LABELS;
    const SLOT_DEFS = [
      { key: "tete", label: L.tete, kind: "gear" },
      { key: "torse", label: L.torse, kind: "gear" },
      { key: "taille", label: L.taille, kind: "gear" },
      { key: "bras", label: L.bras, kind: "gear" },
      { key: "mains", label: L.mains, kind: "gear" },
      { key: "jambes", label: L.jambes, kind: "gear" },
      { key: "pieds", label: L.pieds, kind: "gear" },
      { key: "mainDroite", label: L.mainDroite, kind: "hand" },
      { key: "mainGauche", label: L.mainGauche, kind: "hand" },
      // Emplacement réservé aux items de type `relic`. La clé technique
      // reste "artefact" (elle existait déjà avant que le type n'existe :
      // le slot était affiché mais aucun objet ne pouvait y entrer).
      { key: RELIC_SLOT, label: L[RELIC_SLOT], kind: "relic" }
    ];

    const allEquipItems = items.filter(it => it.type === "weapon" || it.type === "armor" || it.type === "relic");
    const equipped = allEquipItems.filter(it => !!it.system?.equipe);

    const bySlot = new Map();
    for (const it of equipped) {
      const slot = slotOfItem(it);
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
        // Une main peut tenir une arme… ou un bouclier. Un bouclier est une
        // armure (il donne de la protection, pas des dégâts) dont
        // l'emplacement est une main : sans ce cas il n'apparaissait nulle
        // part et restait impossible à équiper.
        options = allEquipItems
          .filter(i => i.type === "weapon" || HAND_SLOT_KEYS.has(i.system?.emplacement))
          .map(i => ({ ...i, selected: equippedItem?._id === i._id }));
      } else if (s.kind === "relic") {
        // Le slot relique liste TOUTES les reliques possédées, sans filtrer
        // sur system.emplacement : c'est leur unique destination possible,
        // et une relique importée avec un emplacement vide resterait sinon
        // introuvable ici (donc inéquipable) sans que rien ne l'explique.
        options = allEquipItems
          .filter(i => i.type === "relic")
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

    return this.document.items.find(i => {
      if (!(i.type === "weapon" || i.type === "armor" || i.type === "relic")) return false;
      if (!i.system?.equipe) return false;

      const s = slotOfItem(i);
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
      if (updates.length) await this.document.updateEmbeddedDocuments("Item", updates);
      return;
    }

    const item = this.document.items.get(itemId);
    if (!item) return;

    if (item.type === "weapon") {
      const twoHands = !!item.system?.twoHands;

      let targetSlot = HAND_SLOTS.has(slot) ? slot : "mainDroite";
      if (twoHands) targetSlot = "mainDroite";

      for (const w of this.document.items) {
        if (w.type !== "weapon") continue;
        if (!w.system?.equipe) continue;
        if (!w.system?.twoHands) continue;
        if (w.id === item.id) continue;
        equip(w, false);
      }

      if (twoHands) {
        // Une arme à deux mains vide LES DEUX mains : armes comme boucliers.
        // Le filtre sur le type d'objet laissait un bouclier en place, donc
        // porté en même temps qu'une arme censée occuper les deux mains.
        for (const w of this.document.items) {
          if (!w.system?.equipe) continue;
          const s = w.system?.emplacement;
          if (HAND_SLOTS.has(s) && w.id !== item.id) equip(w, false);
        }

        updates.push({ _id: item.id, "system.emplacement": targetSlot, "system.equipe": true });
        await this.document.updateEmbeddedDocuments("Item", updates);
        return;
      }

      if (current && current.id !== item.id) equip(current, false);
      updates.push({ _id: item.id, "system.emplacement": targetSlot, "system.equipe": true });

      await this.document.updateEmbeddedDocuments("Item", updates);
      return;
    }

    // Objet non-arme (bouclier, gantelet…) : s'il prend une main, il chasse
    // l'arme à deux mains qui l'occupait — on ne tient pas une épée bâtarde
    // et un bouclier avec les mêmes deux mains.
    if (HAND_SLOTS.has(slot)) {
      for (const w of this.document.items) {
        if (w.type !== "weapon" || !w.system?.equipe || !w.system?.twoHands) continue;
        if (w.id !== item.id) equip(w, false);
      }
    }

    if (current && current.id !== item.id) equip(current, false);
    updates.push({ _id: item.id, "system.emplacement": slot, "system.equipe": true });

    await this.document.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Ouvre la configuration du Prototype Token de l'acteur (lien, vision, barres…).
   * Défensif : tente plusieurs voies selon la version de l'API Foundry V13.
   */
  async _openPrototypeToken() {
    if (!game.user.isGM) return;
    try {
      const pt = this.document?.prototypeToken;
      // Voie 1 : PrototypeToken possède un getter .sheet (cas le plus courant)
      if (pt?.sheet?.render) return pt.sheet.render(true);
      // Voie 2 : classe de config de token exposée par l'API
      const Cls = foundry.applications?.sheets?.PrototypeTokenConfig
               ?? foundry.applications?.sheets?.TokenConfig
               ?? globalThis.TokenConfig;
      if (Cls && pt) return new Cls(pt, {}).render(true);
      ui.notifications?.warn?.("Configuration du Prototype Token indisponible sur cette version.");
    } catch (e) {
      console.error("[RPG] Ouverture Prototype Token :", e);
      ui.notifications?.error?.("Impossible d'ouvrir la config du Prototype Token (voir console).");
    }
  }

  async _createItem(type) {
    const defaults = {
      loot: { name: "Nouvel objet", type: "loot", system: { qte: 1, poids: 0 } },
      weapon: { name: "Nouvelle arme", type: "weapon", system: { equipe: false, emplacement: "mainDroite", qte: 1, poids: 1, difficulte: 0, damage: { dice: "1d6", flat: 0, scaling: { stat: "force", per: 10, perStep: 1 } }, livraison: "physique" } },
      armor: { name: "Nouvelle armure", type: "armor", system: { equipe: false, emplacement: "torse", qte: 1, poids: 2 } },
      relic: { name: "Nouvelle relique", type: "relic", system: { equipe: false, emplacement: RELIC_SLOT, qte: 1, poids: 0.5 } },
      consumable: { name: "Nouveau consommable", type: "consumable", system: { qte: 1, poids: 0.2, effet: "" } },

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

      skill: { name: "Nouvelle compétence", type: "skill", system: { qte: 1, poids: 0, rang: 0, statLiee: "dexterite", difficulte: 0 } },

      recipe: { name: "Nouvelle recette", type: "recipe", system: { ingredients: [], result: { uuid: "", name: "" }, difficulte: 0 } },
      quest: { name: "Nouvelle quête", type: "quest", system: { statut: "active", etapeActuelle: 0, etapes: [] } }
    };

    const data = defaults[type] ?? { name: "Nouvel item", type, system: { qte: 1, poids: 0 } };
    await this.document.createEmbeddedDocuments("Item", [data]);
  }

  async _useItemPreviewFromId(itemId) {
    const item = this.document.items.get(itemId);
    if (!item) return;

    const targetToken = Array.from(game.user.targets)[0];
    if (!targetToken) {
      return ui.notifications.warn("Cible un ennemi (touche T) avant d'utiliser une attaque/sort.");
    }

    const target = targetToken.actor;
    if (!target) return;

    const cd = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
    if (cd > 0) return ui.notifications.warn(`Sort en recharge : ${cd} tour(s).`);

    // Passe par la déclaration d'attaque commune : jet de touché + boutons
    // de validation MJ. On publiait auparavant un simple aperçu, sans jet ni
    // validation, ce qui laissait l'attaque sans résolution possible.
    const { declareAttack } = await import("../rules/attack-declare.js");
    await declareAttack(this.document, item, target, { targetToken });
  }

  _statePath() { return "system.etatsActifs"; }

  _stateList() {
    const cur = foundry.utils.getProperty(this.document, this._statePath());
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
    let idx = list.findIndex(e => e.id === id);

    // Pas de correspondance par id (nouvel ajout, cf. _stateAdd) : un effet
    // IDENTIQUE déjà présent sur la cible (même nom) doit être REMPLACÉ —
    // durée/valeurs rafraîchies — plutôt qu'empilé en double.
    if (idx < 0) {
      const label = String(state.label ?? "").trim().toLowerCase();
      if (label) idx = list.findIndex(e => String(e.label ?? "").trim().toLowerCase() === label);
    }

    const finalId = idx >= 0 ? list[idx].id : id;
    const normalized = this._normalizeState({ ...state, id: finalId });

    if (idx >= 0) list[idx] = normalized;
    else list.push(normalized);

    await this.document.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.document);

    if (normalized.isAura && globalThis.RPG_AURAS?.refreshAuras) {
      await globalThis.RPG_AURAS.refreshAuras();
    }
  }

  async _stateAdd() {
    if (!game.user.isGM) return;
    const st = this._stateDefaults();
    const edited = await this._editStateDialog(st, { title: "Ajouter un état" });
    if (!edited) return;
    await this._stateUpsert(edited);
    await this.render({ force: true });
  }

  async _stateEdit(id) {
    if (!game.user.isGM) return;
    const st = this._stateFindById(id);
    if (!st) return ui.notifications.warn("État introuvable.");
    const edited = await this._editStateDialog(st, { title: "Modifier l’état" });
    if (!edited) return;
    await this._stateUpsert(edited);
    await this.render({ force: true });
  }

  async _stateDelete(id) {
    if (!game.user.isGM) return;
    await this._stateRemove(id);
    await this.render({ force: true });
    if (globalThis.RPG_AURAS?.refreshAuras) await globalThis.RPG_AURAS.refreshAuras();
  }

  async _stateShow(id) {
    const st = this._stateFindById(id);
    if (!st) return;
    await this._postStateInfoToChat(st);
  }

  async _stateRemove(id) {
    const path = this._statePath();
    const list = this._stateList().filter(e => e.id !== id);
    await this.document.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.document);

    if (globalThis.RPG_AURAS?.refreshAuras) await globalThis.RPG_AURAS.refreshAuras();
  }

  _stateDefaults() {
    return this._normalizeState({
      id: foundry.utils.randomID(),
      label: "Poison",
      type: "poison",
      tag: "",
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
      "vitesse", "initiativeMod", "toucherPhysique", "toucherMagique",
      "fatigueMax", "podsMax"
    ];
  }

  async _editStateDialog(state, { title } = {}) {
    const st = this._normalizeState(state);
    const keys = this._allModKeys();

    const labels = {
      force: "Force",
      dexterite: "Dextérité",
      intelligence: "Intelligence",
      acuite: "Acuité",
      endurance: "Endurance",
      pvMax: "PV max",
      manaMax: "Mana max",
      regenPv: "Régén PV",
      regenMana: "Régén Mana",
      scoreArmure: "Score Armure",
      scoreResistance: "Score Résistance",
      armureFixe: "Armure fixe",
      resistanceFixe: "Résistance fixe",
      vitesse: "Vitesse",
      initiativeMod: "Initiative",
      toucherPhysique: "Toucher physique",
      toucherMagique: "Toucher magique",
      fatigueMax: "Fatigue max",
      podsMax: "Pods max"
    };

    // Catalogue d'effets nommés (Ardeur, Brûlure…), groupé par élément —
    // ne fait que pré-remplir le nom + l'élément ; tout reste éditable.
    const byTag = {};
    for (const e of listEffects()) {
      if (!byTag[e.tag]) byTag[e.tag] = [];
      byTag[e.tag].push(e);
    }
    const effectCatalogOptions = `<option value="">— Personnalisé —</option>` +
      Object.entries(byTag).map(([tag, list]) =>
        `<optgroup label="${EFFECT_TAGS[tag] ?? tag}">` +
        list.map(e => `<option value="${e.key}">${e.label}</option>`).join("") +
        `</optgroup>`
      ).join("");

    const tagOptions = Object.entries(STATE_TYPES)
      .map(([k, v]) => `<option value="${k}" ${(st.tag ?? "") === k ? "selected" : ""}>${v}</option>`).join("");

    const row = (k, label) => {
      const cur = st.mods?.[k] ?? {};
      const flat = Number(cur.flat ?? 0) || 0;
      const pct = Number(cur.pct ?? 0) || 0;

      return `
        <div class="mods-row">
          <div class="mods-label">${label}</div>
          <div class="mods-inputs">
            <input type="number" name="mods.${k}.flat" value="${flat}" placeholder="Flat"/>
            <input type="number" name="mods.${k}.pct" value="${pct}" placeholder="%"/>
          </div>
        </div>
      `;
    };

    const modsHtml = keys.map(k => row(k, labels[k] ?? k)).join("");

    const content = `
  <div class="rpg-state-dialog">

    <div class="scroll">
      <form class="rpg-state-edit">

        <div class="line">
          <div class="lbl">Nom de l'effet (catalogue)</div>
          <select name="catalogEffect">${effectCatalogOptions}</select>
        </div>

        <div class="line">
          <div class="lbl">Nom (label)</div>
          <input type="text" name="label" value="${st.label}"/>
        </div>

        <div class="line">
          <div class="lbl">Type</div>
          <select name="type">
            ${["poison", "burn", "buff", "debuff", "aura", "custom"].map(t =>
      `<option value="${t}" ${st.type === t ? "selected" : ""}>${t}</option>`
    ).join("")}
          </select>
        </div>

        <div class="line">
          <div class="lbl">Type / Élément (résistances, couleur d'aura)</div>
          <select name="tag">${tagOptions}</select>
        </div>

        <div class="line">
          <div class="lbl">Aura (avec portée)</div>
          <div><input type="checkbox" name="isAura" ${st.isAura ? "checked" : ""}/></div>
        </div>

        <div class="two">
          <div>
            <label>Durée (tours)</label>
            <input type="number" name="duration" value="${st.duration}" min="1"/>
          </div>
          <div>
            <label>Restant (tours)</label>
            <input type="number" name="remaining" value="${st.remaining}" min="0"/>
          </div>
        </div>

        <div class="line">
          <div class="lbl">Difficulté retrait (cleanse DC)</div>
          <input type="number" name="cleanseDC" value="${st.cleanseDC}" min="0"/>
        </div>

        <div class="two">
          <div>
            <label>Portée min (m) (aura)</label>
            <input type="number" name="aura.min" value="${Number(st.aura?.min ?? 0) || 0}" min="0" step="0.1"/>
          </div>
          <div>
            <label>Portée max (m) (aura)</label>
            <input type="number" name="aura.max" value="${Number(st.aura?.max ?? 0) || 0}" min="0" step="0.1"/>
          </div>
        </div>

        <div class="line">
          <div class="lbl">Cible (aura)</div>
          <select name="aura.target">
            ${Object.entries(AURA_TARGETS).map(([t, lbl]) =>
      `<option value="${t}" ${(st.aura?.target ?? "allies") === t ? "selected" : ""}>${lbl}</option>`
    ).join("")}
          </select>
        </div>

        <hr/>
        <h3>DOT</h3>
        <p class="hint">DOT fixe = dégâts appliqués à chaque tick (ex: début de tour).</p>

        <div class="line">
          <div class="lbl">DOT fixe</div>
          <input type="number" name="dot.flat" value="${Number(st.dot.flat ?? 0) || 0}"/>
        </div>

        <hr/>
        <h3>Modificateurs (buff / debuff)</h3>
        <p class="hint">Flat = +10 / -10. % = +10 / -10 (pour +10% / -10%).</p>

        ${modsHtml}
      </form>
    </div>
  </div>
`;

    const parseForm = (htmlRoot) => {
      const form = htmlRoot.querySelector("form");
      const fd = new FormData(form);

      const getStr = (k, d = "") => String(fd.get(k) ?? d).trim();
      const getNum = (k, d = 0) => Number(fd.get(k) ?? d) || 0;
      const getChk = (k) => fd.get(k) !== null;

      const out = this._normalizeState(st);
      out.label = getStr("label", out.label);
      out.type = getStr("type", out.type);
      out.tag = getStr("tag", out.tag ?? "") || null;
      out.isAura = getChk("isAura");

      out.duration = Math.max(1, getNum("duration", out.duration));
      out.remaining = Math.max(0, getNum("remaining", out.remaining));
      out.cleanseDC = Math.max(0, getNum("cleanseDC", out.cleanseDC));

      out.dot = out.dot ?? {};
      out.dot.flat = getNum("dot.flat", 0);
      out.dot.formula = "";
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

      return out;
    };

    const DialogV2 = foundry.applications.api.DialogV2 ?? foundry.applications.api.Dialog;

    return await new Promise((resolve) => {
      ensureStateDialogCSS();

      const dlg = new DialogV2({
        window: {
          title: title || "État",
          contentClasses: ["rpg-state-dialog-window"]
        },
        position: { width: 680, height: 760 },
        content,
        buttons: [
          {
            action: "cancel",
            label: "Annuler",
            default: false,
            callback: () => resolve(null)
          },
          {
            action: "ok",
            label: "Enregistrer",
            default: true,
            callback: (_event, _button, dialog) => {
              const root = dialog.element ?? dialog?.form ?? dialog;
              resolve(parseForm(root));
            }
          }
        ],
        close: () => resolve(null)
      });

      dlg.render(true).then(() => {
        // Choisir un effet du catalogue ne fait que pré-remplir nom + élément :
        // le MJ garde la main sur toutes les valeurs (durée, mods, aura…).
        const root = dlg.element;
        const catalogSel = root?.querySelector('select[name="catalogEffect"]');
        const labelInput = root?.querySelector('input[name="label"]');
        const tagSel = root?.querySelector('select[name="tag"]');
        catalogSel?.addEventListener("change", () => {
          const def = getEffectDef(catalogSel.value);
          if (!def) return;
          if (labelInput) labelInput.value = def.label;
          if (tagSel) tagSel.value = def.tag;
        });
      });
    });
  }

  async _postStateInfoToChat(st) {
    const dotTxt = (st.dot?.flat || st.dot?.formula)
      ? `Dégâts par tour : <b>${st.dot?.flat ?? 0}</b>${st.dot?.formula ? ` + <b>${st.dot.formula}</b>` : ""}`
      : "Dégâts par tour : <i>aucun</i>";

    const mods = st.mods ?? {};
    const modsTxt = Object.entries(mods)
      .map(([k, v]) => {
        const name = LABELS[k] ?? k;
        const flat = Number(v.flat ?? 0) || 0;
        const pct = Number(v.pct ?? 0) || 0;
        const a = flat ? `${flat > 0 ? "+" : ""}${flat}` : "";
        const b = pct ? `${pct > 0 ? "+" : ""}${pct}%` : "";
        return `${name} : ${[a, b].filter(Boolean).join(" ")}`.trim();
      })
      .filter(Boolean)
      .join("<br>") || "<i>Aucun modificateur</i>";

    const auraTxt = st.isAura && st.aura?.max
      ? `<br>Aura : <b>${auraTargetLabel(st.aura.target)}</b> • Portée <b>${st.aura.min}–${st.aura.max}</b>`
      : "";

    const content = `
      <b>${this.document.name}</b> — État : <b>${st.label}</b><br>
      Type : <b>${stateTypeLabel(st.type)}</b> ${st.isAura ? "(Aura)" : ""}${auraTxt}<br>
      Durée : <b>${st.remaining}</b> / ${st.duration} tour(s)<br>
      Retrait : ${st.cleanseDC ? `<b>${st.cleanseDC}+</b>` : "<i>—</i>"}<br>
      ${dotTxt}<br>
      <hr>
      <b>Modificateurs</b><br>${modsTxt}
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      content
    });
  }
}