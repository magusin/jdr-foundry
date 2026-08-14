// systems/rpg/module/sheets/item-spell-sheet-v2.js
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { getManaCostReduction, getActiveWeathers, getBiomeManaBonus, getActiveBiome, ELEMENT_TAGS } from "../rules/weather-library.js";
import { applyUiTheme, sheetContent, sheetActionButtons, restoreScrollPositions, uniqueSheetOptions } from "./sheet-helpers.js";
import { bindSendToActorsButton, bindLinkSyncCheckbox } from "./send-item-dialog.js";
import {
  DAMAGE_TYPES, DAMAGE_TYPE_KEYS, RESIST_MIN, RESIST_MAX, fxResistTextParts
} from "../rules/damage-types.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/** % de résistance/vulnérabilité, borné comme dans damage-types.js. */
function clampResist(v) {
  return Math.max(RESIST_MIN, Math.min(RESIST_MAX, Math.round(n(v, 0))));
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

/** Libellés lisibles des stats modifiables par un effet. */
const STAT_LABELS = {
  force: "Force", dexterite: "Dextérité", intelligence: "Intelligence",
  acuite: "Acuité", endurance: "Endurance",
  armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
  scoreArmure: "Score Armure", scoreResistance: "Score Résistance",
  toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique",
  initiativeMod: "Initiative", vitesse: "Vitesse",
  pvMax: "PV max", manaMax: "Mana max",
  regenPv: "Régén PV", regenMana: "Régén Mana",
  fatigueMax: "Fatigue max", podsMax: "Pods max"
};

const WHEN_LABELS = {
  hit: "⚡ Touche + crit",
  hitonly: "⚡ Touche normale",
  crit: "✦ Crit uniquement",
  cast: "🪄 Au lancement"
};

const AURA_TARGET_LABELS = { allies: "alliés", enemies: "ennemis", both: "tous" };

/** Bénéficiaire d'un effet — mêmes clés que applyEffectsFor() dans spells.js. */
const FX_TARGET_LABELS = {
  target: "🎯 sur la cible", self: "🎯 sur soi", both: "🎯 soi + cible"
};

/**
 * Libellés des types/éléments d'un effet. `feu`, `eclair`, `obscurite`… sont
 * des CLÉS techniques : affichées telles quelles elles perdent accents et
 * majuscules (« eclair »). Reprend mot pour mot les options proposées par
 * spell-sheet.hbs, `magique`/`physique` compris — que la liste d'éléments de
 * weather-library.js ne connaît pas.
 */
const TAG_LABELS = {
  neutre: "⚪ Neutre", magique: "✨ Magique", physique: "⚔️ Physique",
  feu: "🔥 Feu", air: "🌬️ Air", eau: "💧 Eau", glace: "❄️ Glace",
  eclair: "⚡ Éclair", terre: "🌿 Terre",
  lumiere: "✨ Lumière", obscurite: "🌑 Obscurité"
};

/** Modes de déplacement qu'un effet peut accorder (mêmes options que la fiche). */
const MOVEMENT_GRANT_LABELS = {
  volant: "🦅 Vol", aquatique: "🐟 Nage", amphibie: "🐸 Amphibie",
  ethere: "👻 Éthéré", montagnard: "⛰️ Montagnard", forestier: "🌲 Forestier"
};

const tagLabel = (t) => TAG_LABELS[String(t ?? "").toLowerCase()] ?? t;

/** Décore un modificateur pour l'affichage (sens, quantité, libellé). */
function decorateMod(m) {
  const isMalus = m.sens === "malus";
  const abs = Math.abs(n(m.value, 0));
  const label = STAT_LABELS[m.stat] ?? m.stat;
  return {
    ...m,
    isMalus,
    absValue: abs,
    statLabel: label,
    text: `${isMalus ? "⬇️" : "⬆️"} ${label} ${isMalus ? "−" : "+"}${abs}${m.mode === "pct" ? "%" : ""}`
  };
}

/**
 * Résumé lisible d'un effet (pastilles d'en-tête). Partagé entre le rendu
 * Handlebars et la mise à jour en place après une saisie, pour que les deux
 * ne divergent jamais.
 */
/** Résumé lisible d'une résistance/vulnérabilité accordée, ou null si l'effet n'en accorde pas. */
function buildResistSummary(fx) {
  // Formulation partagée avec l'aperçu des effets d'un sort et la liste des
  // états actifs d'un acteur — voir fxResistTextParts() dans damage-types.js.
  const parts = fxResistTextParts(fx).all;
  return parts.length ? parts.join(" | ") : null;
}

function buildFxUi(fx) {
  const tick = fx.tick ?? {};
  let uiTick = null;
  if (tick.mode === "damage" || tick.mode === "heal") {
    const icon = tick.mode === "heal" ? "💚" : "💥";
    const word = tick.mode === "heal" ? "soin" : "dégâts";
    const scale = tick.stat && n(tick.perStep, 0)
      ? ` + ${STAT_LABELS[tick.stat] ?? tick.stat}÷${n(tick.per, 10)}×${n(tick.perStep, 0)}`
      : "";
    uiTick = `${icon} ${n(tick.flat, 0)}${scale} ${word}/tour`;
  }
  const mods = (fx.mods ?? []).map(decorateMod);
  return {
    uiTick,
    uiTag: fx.tag ? tagLabel(fx.tag) : null,
    uiTarget: FX_TARGET_LABELS[String(fx.target ?? "target")] ?? FX_TARGET_LABELS.target,
    uiWhen: WHEN_LABELS[String(fx.when ?? "hit").toLowerCase()] ?? fx.when,
    uiDuration: fx.permanent ? "♾️ Permanent" : `⏳ ${n(fx.duration, 0)} tour(s)`,
    uiAura: fx.isAura
      ? `🌀 Aura ${n(fx.auraMin, 0)}–${n(fx.auraMax, 0)} m · ${AURA_TARGET_LABELS[fx.auraTarget] ?? fx.auraTarget}`
      : null,
    uiMove: fx.movementTypeGrant
      ? `🏃 ${MOVEMENT_GRANT_LABELS[fx.movementTypeGrant] ?? fx.movementTypeGrant}`
      : null,
    uiRemove: n(fx.removeBaseTN, 0)
      ? `🧹 Retrait TN ${n(fx.removeBaseTN, 0)}+`
      : null,
    uiResist: buildResistSummary(fx),
    mods
  };
}

/**
 * Normalise les modificateurs de stat d'un effet vers le format tableau
 * [{ stat, mode:"flat"|"pct", value }] attendu par buildModsFromFxMods().
 * `value` reste SIGNÉE en base (négatif = malus) car c'est ce que le moteur
 * applique ; l'UI, elle, expose un sens explicite (bonus/malus) + une
 * quantité positive, décorés dans _prepareContext.
 * Accepte aussi l'ancien format objet { force: { flat, pct }, ... }.
 */
function normMods(raw) {
  const out = [];
  // `sens` est stocké EXPLICITEMENT : le déduire du signe cassait le choix
  // « Malus » tant que la quantité valait 0 (−0 n'est pas < 0, le select
  // repassait donc sur « Bonus » au rendu suivant).
  const push = (stat, mode, value, sens) => {
    const v = n(value, 0);
    const s = (sens === "malus" || sens === "bonus") ? sens : (v < 0 ? "malus" : "bonus");
    const qty = Math.abs(v);
    out.push({
      stat,
      mode: mode === "pct" ? "pct" : "flat",
      sens: s,
      value: s === "malus" ? -qty : qty
    });
  };
  if (Array.isArray(raw)) {
    for (const m of raw) {
      const stat = String(m?.stat ?? "").trim();
      if (!stat) continue;
      push(stat, m?.mode, m?.value, m?.sens);
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    for (const [stat, v] of Object.entries(raw)) {
      if (!stat) continue;
      const flat = n(v?.flat, 0);
      const pct = n(v?.pct, 0);
      if (flat) push(stat, "flat", flat);
      if (pct) push(stat, "pct", pct);
      if (!flat && !pct) push(stat, "flat", 0);
    }
  }
  return out;
}

/**
 * Normalise l'« effet par tour » d'un effet secondaire.
 * Format cible : { mode:"none"|"damage"|"heal", flat, stat, per, perStep, livraison }
 * avec `flat` toujours positif — c'est `mode` qui dit s'il s'agit de dégâts
 * ou de soin. Migre les anciens formats (dot/hot séparés, puis damage.flat signé).
 */
function normTick(fx) {
  const t = fx?.tick;
  if (t && typeof t === "object" && t.mode) {
    return {
      mode: ["damage", "heal", "none"].includes(t.mode) ? t.mode : "none",
      flat: Math.abs(n(t.flat, 0)),
      stat: String(t.stat ?? ""),
      per: Math.max(1, n(t.per, 10) || 10),
      perStep: Math.abs(n(t.perStep, 0)),
      livraison: String(t.livraison ?? "magique")
    };
  }

  // Migration depuis dot{} / hot{}
  const dot = fx?.dot ?? {};
  const hot = fx?.hot ?? {};
  const dotHas = n(dot.flat, 0) !== 0 || n(dot.perStep, 0) !== 0;
  const hotHas = n(hot.flat, 0) !== 0 || n(hot.perStep, 0) !== 0;
  if (dotHas || hotHas) {
    const src = dotHas ? dot : hot;
    return {
      mode: dotHas ? "damage" : "heal",
      flat: Math.abs(n(src.flat, 0)),
      stat: String(src.stat ?? ""),
      per: Math.max(1, n(src.per, 10) || 10),
      perStep: Math.abs(n(src.perStep, 0)),
      livraison: String(dot.livraison ?? "magique")
    };
  }

  // Migration depuis l'ancien champ unique signé
  const legacy = n(fx?.damage?.flat, 0);
  return {
    mode: legacy > 0 ? "damage" : (legacy < 0 ? "heal" : "none"),
    flat: Math.abs(legacy),
    stat: "",
    per: 10,
    perStep: 0,
    livraison: String(dot.livraison ?? "magique")
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
      if (e) { e.permanent = b(e.permanent); e.isAura = b(e.isAura); }
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

  // damages[] normalize (Object -> Array) + types numériques
  const resRaw = expanded?.system?.restores;
  if (resRaw && !Array.isArray(resRaw)) expanded.system.restores = Object.values(resRaw);
  if (Array.isArray(expanded?.system?.restores)) {
    for (const r of expanded.system.restores) {
      r.flat = Number(r.flat ?? 0) || 0;
      r.per = Number(r.per ?? 10) || 10;
      r.perStep = Number(r.perStep ?? 0) || 0;
      r.critFlat = Number(r.critFlat ?? 0) || 0;
    }
  }

  const dmgRaw = expanded?.system?.damages;
  if (dmgRaw && !Array.isArray(dmgRaw)) expanded.system.damages = Object.values(dmgRaw);
  if (Array.isArray(expanded?.system?.damages)) {
    for (const d of expanded.system.damages) {
      d.flat = Number(d.flat ?? 0) || 0;
      d.per = Number(d.per ?? 10) || 10;
      d.perStep = Number(d.perStep ?? 0) || 0;
      d.siphon = Math.max(0, Math.min(100, Number(d.siphon ?? 0) || 0));
    }
  }

  return expanded;
}

export class RPGSpellSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";


  /**
   * Un id de fenêtre UNIQUE par document — voir uniqueSheetOptions() : sans
   * lui, ouvrir une deuxième fiche du même type arrache du DOM la fenêtre de
   * la première, qui devient alors impossible à rouvrir sans erreur visible.
   */
  _initializeApplicationOptions(options) {
    return uniqueSheetOptions(super._initializeApplicationOptions(options), options,
                              "rpg-spell-sheet-v2");
  }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ["rpg", "rpg-sheet", "sheet", "item", "spell"],
    position: { width: 720, height: 920 },
    window: { contentClasses: ["rpg-sheet-window"], resizable: true },

    /**
     * submitOnChange est VOLONTAIREMENT désactivé.
     *
     * Il déclenchait une soumission + un re-render complet à chaque frappe :
     * la fenêtre remontait en haut, les accordéons d'effets se refermaient et
     * une saisie pouvait être écrasée par le rendu suivant (le champ semblait
     * revenir à sa valeur d'origine). On enregistre désormais champ par champ
     * dans _onRender, sans re-render — voir _bindLiveSave().
     */
    form: {
      closeOnSubmit: false,
      submitOnChange: false,
      handler: async function(event, form, formData, options) {
        await this._onFormSubmitV2(event, form, formData, options);
      }
    },

    /**
     * Actions V2: data-action="..." appelle automatiquement ces handlers
     */
    actions: {
      addEffect:     async function(event) { await this._actionAddEffect(event); },
      removeEffect:  async function(event) { await this._actionRemoveEffect(event); },
      addDmgLine:    async function(event) { await this._actionAddDmgLine(event); },
      removeDmgLine: async function(event) { await this._actionRemoveDmgLine(event); },
      addRestoreLine:    async function(event) { await this._actionAddRestoreLine(event); },
      removeRestoreLine: async function(event) { await this._actionRemoveRestoreLine(event); },
      addMod:        async function(event) { await this._actionAddMod(event); },
      removeMod:     async function(event) { await this._actionRemoveMod(event); },
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
      // .rpg-sheet est un simple conteneur flex, jamais l'élément qui
      // scrolle (voir item-sheet.css) — même correction que
      // item-armor-sheet-v2.js. Sans effet observable ici : le seul chemin
      // qui force un re-render (_updateAndKeepView) a déjà son propre
      // snapshot/restore de scroll manuel (_snapshotView/_restoreView),
      // mais ce sélecteur reste faux et inerte tant que rien d'autre ne
      // s'appuie dessus — corrigé pour rester cohérent avec les autres
      // fiches d'objet.
      scrollable: [".sheet-body"]
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

    // Normalise damages[] (multi-lignes de dégâts)
    if (!Array.isArray(ctx.system.damages)) ctx.system.damages = [];
    for (const dmg of ctx.system.damages) {
      dmg.dice = String(dmg.dice ?? "1d6");
      dmg.flat = Number(dmg.flat ?? 0) || 0;
      dmg.stat = String(dmg.stat ?? "intelligence");
      dmg.per = Number(dmg.per ?? 10) || 10;
      dmg.perStep = Number(dmg.perStep ?? 1) || 0;
      dmg.critDice = String(dmg.critDice ?? "");
      dmg.critFlat = Number(dmg.critFlat ?? 0) || 0;
      dmg.livraison = String(dmg.livraison ?? "magique");
      dmg.siphon = Math.max(0, Math.min(100, Number(dmg.siphon ?? 0) || 0));
    }

    // Normalise restores[] (soin PV / mana / fatigue rendus par le sort)
    if (!Array.isArray(ctx.system.restores)) ctx.system.restores = [];
    for (const res of ctx.system.restores) {
      res.resource = String(res.resource ?? "pv");
      res.cible    = String(res.cible ?? "self");
      res.dice     = String(res.dice ?? "");
      res.flat     = Number(res.flat ?? 0) || 0;
      res.stat     = String(res.stat ?? "");
      res.per      = Number(res.per ?? 10) || 10;
      res.perStep  = Number(res.perStep ?? 0) || 0;
      res.critDice = String(res.critDice ?? "");
      res.critFlat = Number(res.critFlat ?? 0) || 0;
    }

    // permissions
    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;

    // Grilles de saisie : MJ seul. Le joueur lit la même information dans le
    // résumé du haut (playerInfo), sans pouvoir toucher aux valeurs.
    ctx.showRestores = ctx.canEdit;
    // Carte « Effets secondaires » : inutile de l'afficher vide au joueur.
    ctx.showEffects  = ctx.canEdit || (Array.isArray(ctx.system.effectsUI) && ctx.system.effectsUI.length > 0);
    ctx.showDescription = ctx.canEdit || !!String(ctx.system.description ?? "").trim();

    // Catalogue d'effets groupé par type pour les optgroups du dropdown
    const lib = game.rpg?.effectLibrary;
    if (lib) {
      const TAG_LABEL = { feu:"🔥 Feu", air:"🌬️ Air", eau:"💧 Eau", glace:"❄️ Glace",
                          eclair:"⚡ Éclair", terre:"🌿 Terre", magique:"✨ Magique",
                          physique:"⚔️ Physique", lumiere:"✨ Lumière", obscurite:"🌑 Obscurité" };
      const byTag = {};
      for (const e of lib.listEffects()) {
        const g = e.tag ?? "autre";
        if (!byTag[g]) byTag[g] = [];
        byTag[g].push({ key: e.key, label: e.label });
      }
      ctx.EFFECT_CATALOG = Object.fromEntries(
        Object.entries(byTag).map(([tag, list]) => [TAG_LABEL[tag] ?? tag, list])
      );
    } else {
      ctx.EFFECT_CATALOG = {};
    }
    ctx.isReadOnly = !ctx.canEdit;

    // ── Vue joueur : résumé compact ────────────────────────────────────────
    // En lecture seule, les champs à 0 ou vides s'affichaient comme des cases
    // vides sans signification. On ne liste que ce qui est réellement renseigné.
    ctx.playerInfo = [];
    {
      const add = (icon, label, value, suffix = "") => {
        if (value === null || value === undefined || value === "" || value === 0) return;
        ctx.playerInfo.push({ icon, label, value: `${value}${suffix}` });
      };
      const SPEED = { passif: "Passif", rapide: "Rapide", normal: "Normal" };
      add("⚡", "Vitesse", SPEED[String(ctx.system.speed)] ?? ctx.system.speed);
      add("🎯", "Jet de touché", ctx.system.livraison === "physique"
        ? "Physique (Dextérité)" : "Magique (Acuité)");
      add("🔮", "Élément", tagLabel(ctx.system.tag ?? "neutre"));
      add("💧", "Coût mana", n(ctx.system.coutMana, 0));
      add("😫", "Coût fatigue", n(ctx.system.fatigueCost, 0));
      const rmin = n(ctx.system.range?.min, 0), rmax = n(ctx.system.range?.max, 0);
      if (rmax > 0) ctx.playerInfo.push({ icon: "📏", label: "Portée",
        value: rmin > 0 ? `${rmin} – ${rmax} m` : `${rmax} m` });
      const tmin = n(ctx.system.targetCount?.min, 0), tmax = n(ctx.system.targetCount?.max, 0);
      if (tmax > 0) ctx.playerInfo.push({ icon: "👥", label: "Cibles",
        value: tmin === tmax ? `${tmax}` : `${tmin} – ${tmax}` });
      add("🎲", "Difficulté", n(ctx.system.difficulte, 0), " au seuil");
      const cdMax = n(ctx.system.cooldown?.max, 0);
      const cdRest = n(ctx.system.cooldown?.restant, 0);
      if (cdMax > 0) ctx.playerInfo.push({ icon: "⏳", label: "Recharge",
        value: cdRest > 0 ? `${cdRest} / ${cdMax} tours` : `${cdMax} tours` });

      // Ce que le sort inflige, en clair — le joueur n'a plus la grille.
      const formulaOf = (b, flatKey, diceKey) => {
        const parts = [];
        const dice = String(b[diceKey] ?? "").trim() || String(b.dice ?? "").trim();
        if (dice) parts.push(dice);
        const flat = n(b[flatKey], 0);
        if (flat) parts.push(`${flat}`);
        if (b.stat && n(b.perStep, 0)) parts.push(`${STAT_LABELS[b.stat] ?? b.stat}/${n(b.per, 10)}`);
        return parts.join(" + ");
      };
      for (const d of ctx.system.damages) {
        const normal = formulaOf(d, "flat", "dice");
        if (!normal) continue;
        ctx.playerInfo.push({
          icon: "💥",
          label: `Dégâts ${d.livraison === "physique" ? "physiques" : "magiques"}`,
          value: normal, wide: true
        });
        const crit = formulaOf(d, "critFlat", "critDice");
        if (crit && crit !== normal) {
          ctx.playerInfo.push({ icon: "✦", label: "Dégâts (critique)", value: crit, wide: true });
        }
        if (n(d.siphon, 0) > 0) {
          ctx.playerInfo.push({ icon: "🩸", label: "Vol de vie",
            value: `${n(d.siphon, 0)} % des dégâts infligés`, wide: true });
        }
      }

      // Ce que le sort rend, en clair (ex : « 1d10 + 5 + Endurance/10 »)
      const RES_ICON  = { pv: "❤️", mana: "🔷", fatigue: "😴" };
      const RES_LABEL = { pv: "Rend des PV", mana: "Rend du mana", fatigue: "Rend de la fatigue" };
      const RES_WHO   = { target: " (cible)", both: " (soi + cible)" };
      for (const r of ctx.system.restores) {
        const parts = [];
        if (r.dice) parts.push(r.dice);
        if (r.flat) parts.push(`${r.flat}`);
        if (r.stat && r.perStep) parts.push(`${STAT_LABELS[r.stat] ?? r.stat}/${r.per}`);
        if (!parts.length) continue;
        ctx.playerInfo.push({
          icon: RES_ICON[r.resource] ?? "✨",
          label: `${RES_LABEL[r.resource] ?? "Récupération"}${RES_WHO[r.cible] ?? ""}`,
          value: parts.join(" + "), wide: true
        });
      }
    }

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

    // ── Effets météo + terrain sur ce sort ───────────────────────────────
    const tag       = String(ctx.system.tag ?? "neutre");
    const wReduc    = getManaCostReduction(tag);
    const bReduc    = getBiomeManaBonus(tag);
    const totalReduc = wReduc + bReduc;
    const baseMana  = n(ctx.system.coutMana, 0);
    const effectifMana = Math.max(0, baseMana + totalReduc);
    const actives   = getActiveWeathers();
    const biome     = getActiveBiome();
    const tagDef    = ELEMENT_TAGS[tag] ?? null;
    if (totalReduc !== 0 && tagDef) {
      const isBoosted = totalReduc < 0;
      const wIcons = actives.filter(w => (w.manaReduction?.[tag] ?? 0) !== 0).map(w => w.icon).join("");
      const bIcon  = biome && (biome.manaBonus?.[tag] ?? 0) !== 0 ? biome.icon : "";
      const parts  = [];
      if (wReduc !== 0) parts.push(`météo ${wReduc > 0 ? "+" : ""}${wReduc}`);
      if (bReduc !== 0) parts.push(`terrain ${bReduc > 0 ? "+" : ""}${bReduc}`);
      ctx.weatherEffect = {
        label:            (actives.map(w => w.label).join(", ") + (biome ? ` · ${biome.label}` : "")).replace(/^[, ]+/, ""),
        icon:             wIcons + bIcon,
        manaCoutEffectif: effectifMana,
        mult:             parts.join(", "),
        color:            isBoosted ? "#1d9e75" : "#c0392b",
        isBoosted
      };
    } else {
      ctx.weatherEffect = null;
    }

    // Liste des types de dégâts, partagée par le <select> « Élément / Type »
    // du sort et par celui de la résistance accordée (partie 6 d'un effet) —
    // une seule source pour les deux, sinon « Physique » finit par n'exister
    // que dans l'un des deux.
    ctx.damageTypeChoices = DAMAGE_TYPE_KEYS.map(key => ({
      key, label: DAMAGE_TYPES[key], selected: key === String(ctx.system.tag ?? "")
    }));
    ctx.tagLabel = tagLabel(String(ctx.system.tag ?? "neutre") || "neutre");

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
      // Seules ces trois valeurs sont proposées par la fiche et comprises par
      // applyEffectsFor() ; tout le reste (ancien format) retombe sur la cible.
      fx.target = ["self", "both", "target"].includes(String(fx.target))
        ? String(fx.target)
        : (String(fx.target) === "caster" ? "self" : "target");
      fx.duration = n(fx.duration, 0);
      fx.details = fx.details ?? "";

      // ── Effet par tour : UN seul bloc dont la nature est explicite
      //    (aucun / dégâts / soin). Plus de valeur négative à interpréter.
      //    Migration : ancien couple dot{} / hot{}, ou plus ancien encore
      //    damage.flat signé (négatif = soin).
      fx.tick = normTick(fx);

      fx.removeBaseTN = n(fx.removeBaseTN, 0);
      fx.auraTarget   = String(fx.auraTarget ?? "allies");

      // Deux résistances DISTINCTES, chacune avec son propre type visé :
      // celle aux dégâts d'un type (partie 6) et celle aux états (partie 7).
      // Les mélanger obligerait à protéger des brûlures dès qu'on protège
      // des dégâts de feu — ce sont deux décisions séparées du MJ.
      fx.resistDamageTag = String(fx.resistDamageTag ?? "");
      fx.resistDamagePct = clampResist(fx.resistDamagePct);

      fx.resistTag = String(fx.resistTag ?? "");
      fx.resistDurationReduction = n(fx.resistDurationReduction, 0);
      fx.resistDotPct = n(fx.resistDotPct, 0);
      fx.resistImmune = !!fx.resistImmune;

      // mods : tableau de { stat, mode:"flat"|"pct", value } — format attendu
      // par buildModsFromFxMods() dans rules/spells.js. On y ajoute, pour
      // l'affichage seulement, le sens (bonus/malus) et la quantité positive.
      fx.mods = normMods(fx.mods).map(decorateMod);

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

      // Défauts pour les nouveaux champs (permanent/aura)
      fx.permanent = !!fx.permanent;
      fx.isAura = !!fx.isAura;
      fx.auraMin = n(fx.auraMin, 0);
      fx.auraMax = n(fx.auraMax, 3);

      // ── Résumé lisible (pastilles) : visible replié pour le MJ et
      //    affiché tel quel au joueur, qui n'a pas besoin du formulaire.
      Object.assign(fx, buildFxUi(fx));
      fx.uiHasSummary = !!(fx.uiTick || fx.uiAura || fx.uiMove || fx.uiResist || fx.mods.length);
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
   * Lit tous les effets depuis le DOM (data-fx-field / data-mod-field) et
   * renvoie le tableau system.effectsUI complet, prêt à être enregistré.
   * Les champs non représentés dans l'UI (id, effectKey, target…) sont
   * repris depuis le document pour ne rien perdre.
   */
  _collectEffectsFromDOM(fxCards) {
    const current = Array.isArray(this.document.system?.effectsUI)
      ? foundry.utils.deepClone(this.document.system.effectsUI)
      : [];

    const out = [];
    fxCards.forEach(card => {
      const idx = Number(card.dataset.fxIndex);
      const prev = current[idx] ?? {};

      const el  = (field) => card.querySelector(`[data-fx-field="${field}"]`);
      const str = (field, dflt = "") => {
        const e = el(field);
        if (e) return String(e.value ?? "").trim();
        return String(foundry.utils.getProperty(prev, field) ?? dflt);
      };
      const num = (field, dflt = 0) => {
        const e = el(field);
        if (!e) return n(foundry.utils.getProperty(prev, field), dflt);
        return e.value === "" ? dflt : (Number(e.value) || 0);
      };
      const bool = (field) => {
        const e = el(field);
        return e ? !!e.checked : !!prev?.[field];
      };

      // Modificateurs de stat : l'UI saisit un sens (bonus/malus) + une
      // quantité positive. On stocke le sens ET la valeur signée : sans le
      // sens stocké, choisir « Malus » avec une quantité encore à 0 était
      // perdu au rendu suivant (−0 n'est pas négatif).
      const mods = [];
      card.querySelectorAll(".fx-mod-row[data-mod-index]").forEach(row => {
        const stat = row.querySelector('[data-mod-field="stat"]')?.value ?? "";
        if (!stat) return;
        const mode = row.querySelector('[data-mod-field="mode"]')?.value === "pct" ? "pct" : "flat";
        const sens = row.querySelector('[data-mod-field="sens"]')?.value === "malus" ? "malus" : "bonus";
        const qty = Math.abs(Number(row.querySelector('[data-mod-field="value"]')?.value) || 0);
        mods.push({ stat: String(stat), mode, sens, value: sens === "malus" ? -qty : qty });
      });

      out.push({
        ...prev,
        id:        prev.id ?? foundry.utils.randomID(),
        effectKey: str("effectKey", prev.effectKey ?? ""),
        label:     str("label", prev.label ?? ""),
        tag:       str("tag", prev.tag ?? ""),
        when:      str("when", prev.when ?? "hit") || "hit",
        // Bénéficiaire de l'effet : longtemps figé à « target » faute de champ
        // dans la fiche — impossible d'écrire un buff sur le lanceur, et une
        // aura lancée sur un ennemi rayonnait autour de LUI.
        target:    str("target", prev.target ?? "target") || "target",
        duration:  num("duration", 0),
        permanent: bool("permanent"),
        removeBaseTN: num("removeBaseTN", 0),
        // Champ retiré de l'UI (redondant avec TN de retrait ci-dessus : les
        // deux ne faisaient que s'additionner sur le MÊME effet — autant
        // saisir directement le total voulu dans removeBaseTN). Forcé à 0
        // ici plutôt que juste supprimé du template, pour qu'un effet créé
        // AVANT ce nettoyage perde sa valeur résiduelle dès son prochain
        // enregistrement au lieu de continuer à l'appliquer invisiblement
        // (remove-state-macro.js additionne toujours ce champ s'il existe).
        retraitMod: 0,
        // Résistance aux DÉGÂTS du type visé (damage-types.js) — son propre
        // type visé, indépendant de celui de la résistance aux états.
        resistDamageTag:         str("resistDamageTag", prev.resistDamageTag ?? ""),
        resistDamagePct:         clampResist(num("resistDamagePct", 0)),
        // Résistance aux ÉTATS (durée, dégâts par tour, immunité) — lue par
        // resistances.js, sans aucun effet sur les dégâts directs.
        resistTag:               str("resistTag", prev.resistTag ?? ""),
        resistDurationReduction: num("resistDurationReduction", 0),
        resistDotPct:            num("resistDotPct", 0),
        resistImmune:            bool("resistImmune"),
        movementTypeGrant: str("movementTypeGrant", prev.movementTypeGrant ?? ""),
        // L'effet lui-même ne consomme pas de fatigue : la fatigue se règle
        // via la stat « Fatigue max » dans les bonus/malus.
        fatigueDot: 0,
        tick: {
          mode:      str("tick.mode", "none") || "none",
          flat:      Math.abs(num("tick.flat", 0)),
          stat:      str("tick.stat", ""),
          per:       Math.max(1, num("tick.per", 10) || 10),
          perStep:   Math.abs(num("tick.perStep", 0)),
          livraison: str("tick.livraison", "magique") || "magique"
        },
        isAura:     bool("isAura"),
        auraMin:    num("auraMin", 0),
        auraMax:    num("auraMax", 0),
        auraTarget: str("auraTarget", "allies") || "allies",
        mods
      });
    });

    return out;
  }

  /**
   * Enregistrement « au fil de l'eau », sans re-render.
   *
   * Un re-render complet à chaque changement remettait la fenêtre en haut,
   * refermait les accordéons d'effets et pouvait écraser la saisie en cours.
   * Ici chaque champ écrit uniquement ce qu'il touche, avec { render: false } :
   *   - champ d'effet (data-fx-field / data-mod-field) → tout system.effectsUI
   *   - ligne de dégâts (name="system.damages.…")      → tout system.damages
   *   - autre champ nommé                              → ce champ seul
   * Seules les actions structurelles (ajout/suppression) re-rendent la fiche.
   */
  _bindLiveSave(root) {
    if (root.dataset.rpgLiveSave) return;
    root.dataset.rpgLiveSave = "1";

    root.addEventListener("change", async (ev) => {
      const el = ev.target;
      if (!el || !(el.matches?.("input, select, textarea"))) return;
      if (!game.user.isGM && !this.isEditable) return;

      try {
        // 1) Champs d'un effet secondaire
        const fxCard = el.closest?.("details[data-fx-index]");
        if (fxCard && (el.hasAttribute("data-fx-field") || el.hasAttribute("data-mod-field"))) {
          ev.stopPropagation();
          // Affiche/masque les champs dépendants avant d'enregistrer
          this._syncOptionalFields(root, fxCard);
          await this._saveEffects(root);
          return;
        }

        const name = el.getAttribute?.("name");
        if (!name) return;

        // 2) Lignes de dégâts : on réécrit le tableau complet
        if (name.startsWith("system.damages.")) {
          ev.stopPropagation();
          await this._saveDamages(root);
          return;
        }

        // 2 bis) Lignes de récupération : même principe
        if (name.startsWith("system.restores.")) {
          ev.stopPropagation();
          await this._saveRestores(root);
          return;
        }

        // 3) Champ simple (carte Général, description, nom…)
        ev.stopPropagation();
        let value;
        if (el.type === "checkbox") value = el.checked;
        else if (el.type === "number") value = el.value === "" ? null : Number(el.value);
        else value = el.value;

        await this.document.update({ [name]: value }, { render: false });

        // Même limite que les autres champs enregistrés sans re-render : le
        // titre de la fenêtre est une COPIE de system.name affichée dans le
        // chrome de la fenêtre, jamais rafraîchie par cette écriture ciblée
        // (voir _updateAndKeepView pour le seul chemin qui re-rend vraiment
        // cette fiche). Sans ce patch, renommer un sort semblait n'avoir
        // aucun effet tant que la fenêtre restait ouverte.
        if (name === "name") {
          const titleEl = this.element?.querySelector(".window-header .window-title");
          if (titleEl) titleEl.textContent = this.title;
        }
      } catch (e) {
        console.error("[RPG] enregistrement de la fiche de sort :", e);
        ui.notifications?.error?.("Impossible d'enregistrer ce champ — voir la console (F12).");
      }
    });
  }

  /**
   * Affichage progressif des blocs facultatifs d'un effet.
   *
   * Tous les champs restent dans le DOM (donc toujours enregistrés), mais on
   * masque ceux qui ne servent à rien tant que le bloc n'est pas activé :
   *   - « Effet par tour » : Fixe/Stat/Par/Gain/Livraison n'apparaissent que
   *     si la Nature est Dégâts ou Soin ;
   *   - « Aura » : portée et cible n'apparaissent que si la case est cochée.
   * Un bloc laissé au repos est ignoré par le moteur.
   */
  _syncOptionalFields(root, card = null) {
    const cards = card ? [card] : Array.from(root.querySelectorAll("details[data-fx-index]"));
    for (const c of cards) {
      const mode = c.querySelector('[data-fx-field="tick.mode"]')?.value ?? "none";
      c.querySelectorAll('[data-fx-when="tick"]').forEach(el => { el.hidden = (mode === "none"); });

      const aura = !!c.querySelector('[data-fx-field="isAura"]')?.checked;
      c.querySelectorAll('[data-fx-when="aura"]').forEach(el => { el.hidden = !aura; });
    }
  }

  /** Écrit tous les effets lus dans le DOM, puis rafraîchit les pastilles. */
  async _saveEffects(root) {
    const cards = root.querySelectorAll("details[data-fx-index]");
    if (!cards.length) return;
    const effects = this._collectEffectsFromDOM(cards);
    await this.document.update({ "system.effectsUI": effects }, { render: false });
    this._refreshFxChips(root, effects);
  }

  /** Écrit toutes les lignes de dégâts lues dans le DOM. */
  async _saveDamages(root) {
    const rows = root.querySelectorAll(".dmg-row[data-idx]");
    const damages = [];
    rows.forEach(row => {
      const get = (sel) => row.querySelector(sel);
      damages.push({
        id:        get("input[name*='.id']")?.value ?? foundry.utils.randomID(),
        dice:      get("input[name*='.dice']")?.value?.trim() || "1d6",
        flat:      Number(get("input[name*='.flat']")?.value) || 0,
        stat:      get("select[name*='.stat']")?.value || "intelligence",
        per:       Number(get("input[name*='.per']")?.value) || 10,
        perStep:   Number(get("input[name*='.perStep']")?.value) || 0,
        critDice:  get("input[name*='.critDice']")?.value?.trim() || "",
        critFlat:  Number(get("input[name*='.critFlat']")?.value) || 0,
        siphon:    Number(get("input[name$='.siphon']")?.value) || 0,
        livraison: get("select[name*='.livraison']")?.value || "magique"
      });
    });
    await this.document.update({ "system.damages": damages }, { render: false });
  }

  /**
   * Lit les lignes de récupération dans le DOM.
   * Sélecteurs en `$=` (fin de nom) et non `*=` : « .per » est un préfixe de
   * « .perStep », un `*=` renverrait le mauvais champ.
   */
  _collectRestoresFromDOM(root) {
    const rows = root?.querySelectorAll(".restore-row[data-idx]") ?? [];
    const restores = [];
    rows.forEach(row => {
      const v = (field) => row.querySelector(`[name$='.${field}']`)?.value;
      restores.push({
        id:       row.querySelector("[name$='.id']")?.value || foundry.utils.randomID(),
        resource: v("resource") || "pv",
        cible:    v("cible")    || "self",
        dice:     (v("dice")     ?? "").trim(),
        flat:     Number(v("flat"))     || 0,
        stat:     v("stat") ?? "",
        per:      Number(v("per"))      || 10,
        perStep:  Number(v("perStep"))  || 0,
        critDice: (v("critDice") ?? "").trim(),
        critFlat: Number(v("critFlat")) || 0
      });
    });
    return restores;
  }

  /** Écrit toutes les lignes de récupération lues dans le DOM. */
  async _saveRestores(root) {
    await this.document.update(
      { "system.restores": this._collectRestoresFromDOM(root) }, { render: false });
  }

  /**
   * Met à jour les pastilles de résumé (et le nom) de chaque effet en place,
   * sans re-render : la fenêtre ne bouge pas et les accordéons restent ouverts.
   */
  _refreshFxChips(root, effects) {
    root.querySelectorAll("details[data-fx-index]").forEach(card => {
      const idx = Number(card.dataset.fxIndex);
      const fx = effects[idx];
      if (!fx) return;

      const title = card.querySelector(".fx-title");
      if (title) title.textContent = String(fx.label ?? "").trim() || `Effet ${idx}`;

      const box = card.querySelector(".fx-chips");
      if (!box) return;

      const ui = buildFxUi(fx);
      const chips = [];
      const esc = (s) => String(s ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

      chips.push(`<span class="fx-chip fx-chip-when">${esc(ui.uiWhen)}</span>`);
      chips.push(`<span class="fx-chip">${esc(ui.uiTarget)}</span>`);
      chips.push(`<span class="fx-chip">${esc(ui.uiDuration)}</span>`);
      if (ui.uiTag)   chips.push(`<span class="fx-chip fx-chip-tag">${esc(ui.uiTag)}</span>`);
      if (ui.uiTick)  chips.push(`<span class="fx-chip fx-chip-tick">${esc(ui.uiTick)}</span>`);
      for (const m of ui.mods) {
        chips.push(`<span class="fx-chip ${m.isMalus ? "fx-chip-malus" : "fx-chip-bonus"}">${esc(m.text)}</span>`);
      }
      if (ui.uiAura)   chips.push(`<span class="fx-chip fx-chip-aura">${esc(ui.uiAura)}</span>`);
      if (ui.uiMove)   chips.push(`<span class="fx-chip">${esc(ui.uiMove)}</span>`);
      if (ui.uiRemove) chips.push(`<span class="fx-chip">${esc(ui.uiRemove)}</span>`);

      box.innerHTML = chips.join("");
    });
  }

  /**
   * Handler officiel V2: DEFAULT_OPTIONS.form.handler
   * Signature: (event, form, formData, options) :contentReference[oaicite:3]{index=3}
   */
  async _onFormSubmitV2(event, form, formData, options) {
    if (!game.user.isGM && !this.isEditable) return;

    const t = event?.target;

    // ── Mémorise l'état des accordéons avant le re-render ─────────────────
    const root = this.element;
    const openDetails = new Set();
    root?.querySelectorAll("details[data-fx-index]").forEach(d => {
      if (d.open) openDetails.add(d.dataset.fxIndex);
    });

    // ── Checkbox : ajoute la valeur manquante dans formData ────────────────
    if (t?.type === "checkbox" && t?.name) {
      const raw = formData?.object ?? {};
      raw[t.name] = t.checked ? "1" : "0";
    }

    const raw = formData?.object ?? {};

    // ── damages : collecte directement depuis le DOM pour éviter la perte ──
    const dmgRows = root?.querySelectorAll(".dmg-row[data-idx]") ?? [];
    if (dmgRows.length) {
      const damages = [];
      dmgRows.forEach(row => {
        const get = (sel) => row.querySelector(sel);
        damages.push({
          id: get("input[name*='.id']")?.value ?? foundry.utils.randomID(),
          dice:     get("input[name*='.dice']")?.value?.trim() || "1d6",
          flat:     Number(get("input[name*='.flat']")?.value) || 0,
          stat:     get("select[name*='.stat']")?.value || "intelligence",
          per:      Number(get("input[name*='.per']")?.value) || 10,
          perStep:  Number(get("input[name*='.perStep']")?.value) || 0,
          critDice: get("input[name*='.critDice']")?.value?.trim() || "",
          critFlat: Number(get("input[name*='.critFlat']")?.value) || 0,
          siphon:   Number(get("input[name$='.siphon']")?.value) || 0,
          livraison:get("select[name*='.livraison']")?.value || "magique",
        });
      });
      raw["system.damages"] = damages;
      // Retire les clés indexées du raw pour éviter les doublons
      Object.keys(raw).forEach(k => {
        if (k.startsWith("system.damages.")) delete raw[k];
      });
    }

    // ── restores : même traitement que damages ─────────────────────────────
    if (root?.querySelector(".restore-row[data-idx]")) {
      raw["system.restores"] = this._collectRestoresFromDOM(root);
      Object.keys(raw).forEach(k => {
        if (k.startsWith("system.restores.")) delete raw[k];
      });
    }

    // ── effectsUI : collecte directement depuis le DOM ─────────────────────
    // Les champs d'effet utilisent data-fx-field (et non name=) : le merge
    // générique via formData perdait les valeurs saisies, qui revenaient à
    // leur état d'origine au re-render. On lit le DOM et on écrit le tableau
    // complet, comme pour les lignes de dégâts.
    const fxCards = root?.querySelectorAll("details[data-fx-index]") ?? [];
    const collectedFx = fxCards.length ? this._collectEffectsFromDOM(fxCards) : null;
    if (collectedFx) {
      Object.keys(raw).forEach(k => {
        if (k.startsWith("system.effectsUI")) delete raw[k];
      });
    }

    const expanded = foundry.utils.expandObject(raw);

    // Si damages est un array direct on le place bien
    if (Array.isArray(raw["system.damages"])) {
      expanded.system = expanded.system ?? {};
      expanded.system.damages = raw["system.damages"];
    }
    if (Array.isArray(raw["system.restores"])) {
      expanded.system = expanded.system ?? {};
      expanded.system.restores = raw["system.restores"];
    }

    const prepared = normalizeAndMergeEffects(this.document, expanded);

    if (collectedFx) {
      prepared.system = prepared.system ?? {};
      prepared.system.effectsUI = collectedFx;
    }

    // Soumission explicite uniquement (touche Entrée) : submitOnChange est
    // désactivé, la saisie courante passe par _bindLiveSave sans re-render.
    // On enregistre sans re-rendre pour ne pas perdre la position ni les
    // accordéons ; les pastilles sont rafraîchies en place.
    await this.document.update(prepared, { render: false });
    if (collectedFx) this._refreshFxChips(root, collectedFx);
    void openDetails;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;
    applyUiTheme(root);
    restoreScrollPositions(root);

    // ✅ Vue joueur : les champs readonly deviennent invisibles comme du texte,
    // les boutons d'action sont masqués. Le MJ voit tout et peut tout éditer.
    if (!game.user.isGM) {
      root.classList.add("joueur-view");
      // Les selects readonly ne gèrent pas bien CSS — on les désactive visuellement
      // ⚠️ Cantonné au contenu : les boutons Fermer/Épingler de la barre de
      // titre sont eux aussi des button[data-action] — les masquer privait le
      // joueur de la croix de fermeture.
      const scope = sheetContent(root);
      // Filet de sécurité : on neutralise TOUT champ de saisie du contenu, pas
      // seulement les select[readonly]. Les grilles Dégâts et Récupération
      // n'ont pas d'attribut readonly — elles restaient donc pleinement
      // modifiables par le joueur alors que la fiche est réservée au MJ.
      scope.querySelectorAll("input, select, textarea").forEach(el => {
        el.disabled = true;
        el.style.cssText += ";background:transparent;border-color:transparent;pointer-events:none";
      });
      sheetActionButtons(root).forEach(el => { el.style.display = "none"; });
      return;
    }

    // Enregistrement au fil de la saisie, SANS re-render
    this._bindLiveSave(root);
    bindSendToActorsButton(root, this.document);
    bindLinkSyncCheckbox(root, this.document);

    // Affichage progressif : on ne montre les champs d'un bloc facultatif
    // que s'il est réellement utilisé (Nature ≠ Aucun, Aura cochée).
    this._syncOptionalFields(root);

    // MJ : image cliquable
    root.querySelectorAll(".rpg-img-edit").forEach(img => {
      img.style.cursor = "pointer";
      img.addEventListener("click", async () => {
        const field = img.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.document, field) ?? "";
        const fp = new foundry.applications.apps.FilePicker({ type:"image", current,
          callback: async (path) => this.document.update({ [field]: path }) });
        fp.render(true);
      });
    });

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
    root.addEventListener("change", async (ev) => {
      if (ev.target?.matches?.("select.mod-type")) refreshModInputs();

      // Auto-remplit nom + type quand le MJ choisit un effet du catalogue
      if (ev.target?.matches?.("select.fx-catalogue-select")) {
        const sel = ev.target;
        const key = sel.value;
        const fxIdx = sel.dataset.fxIdx;
        if (!key || fxIdx === undefined) return;

        const lib = game.rpg?.effectLibrary;
        if (!lib) return;
        const def = lib.getEffectDef(key);
        if (!def) return;

        // Remplit les champs visibles immédiatement…
        const card = sel.closest("details");
        const labelInput = card?.querySelector('[data-fx-field="label"]');
        const tagSel = card?.querySelector('[data-fx-field="tag"]');
        if (labelInput && !labelInput.value.trim()) labelInput.value = def.label;
        if (tagSel && def.tag && !tagSel.value) tagSel.value = def.tag;

        // …puis on enregistre depuis le DOM, sans re-render (la fenêtre ne
        // remonte pas et l'accordéon reste ouvert).
        await this._saveEffects(root);
      }
    });
  }

  // ===== Actions V2 =====

  async _actionAddEffect(event) {
    const effects = this._currentEffects();
    effects.push({
      id: foundry.utils.randomID(),
      effectKey: "",
      label: "",
      target: "target",
      when: "hit",
      duration: 3,
      permanent: false,
      isAura: false,
      auraMin: 0,
      auraMax: 3,
      auraTarget: "allies",
      details: "",
      tick: { mode: "none", flat: 0, stat: "", per: 10, perStep: 0, livraison: "magique" },
      mods: []
    });
    await this._updateAndKeepView({ "system.effectsUI": effects });
  }

  async _actionRemoveEffect(event) {
    const btn = event?.target?.closest?.("[data-action]");
    const fxIndex = Number(btn?.closest?.("[data-fx-index]")?.dataset?.fxIndex ?? btn?.dataset?.fxIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;
    const effects = this._currentEffects();
    effects.splice(fxIndex, 1);
    await this._updateAndKeepView({ "system.effectsUI": effects });
  }

  async _actionAddDmgLine(event) {
    const damages = foundry.utils.deepClone(this.document.system.damages ?? []);
    damages.push({
      id: foundry.utils.randomID(),
      dice: "1d6",
      flat: 0,
      stat: "intelligence",
      per: 10,
      perStep: 1,
      critDice: "",
      critFlat: 0,
      siphon: 0,
      livraison: "magique"
    });
    await this._updateAndKeepView({ "system.damages": damages });
  }

  async _actionRemoveDmgLine(event) {
    const btn = event?.target?.closest?.("[data-action='removeDmgLine']");
    const idx = Number(btn?.dataset?.idx ?? -1);
    if (!Number.isFinite(idx) || idx < 0) return;
    const damages = foundry.utils.deepClone(this.document.system.damages ?? []);
    damages.splice(idx, 1);
    await this._updateAndKeepView({ "system.damages": damages });
  }

  async _actionAddRestoreLine(event) {
    const restores = foundry.utils.deepClone(this.document.system.restores ?? []);
    restores.push({
      id: foundry.utils.randomID(),
      resource: "pv",
      cible: "self",
      dice: "1d6",
      flat: 0,
      stat: "endurance",
      per: 10,
      perStep: 1,
      critDice: "",
      critFlat: 0
    });
    await this._updateAndKeepView({ "system.restores": restores });
  }

  async _actionRemoveRestoreLine(event) {
    const btn = event?.target?.closest?.("[data-action='removeRestoreLine']");
    const idx = Number(btn?.dataset?.idx ?? -1);
    if (!Number.isFinite(idx) || idx < 0) return;
    const restores = foundry.utils.deepClone(this.document.system.restores ?? []);
    restores.splice(idx, 1);
    await this._updateAndKeepView({ "system.restores": restores });
  }

  async _actionAddMod(event) {
    const btn = event?.target?.closest?.("[data-action]");
    // Le bouton porte data-fx-idx (→ dataset.fxIdx) ; on accepte aussi
    // data-fx-index et, en dernier recours, la carte d'effet parente.
    const fxIndex = Number(
      btn?.dataset?.fxIdx ?? btn?.dataset?.fxIndex ??
      btn?.closest?.("[data-fx-index]")?.dataset?.fxIndex ?? -1
    );
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;

    // On repart de l'état affiché (et non du document) pour ne pas perdre
    // une saisie en cours dans un autre champ de l'effet.
    const effects = this._currentEffects();
    if (!effects[fxIndex]) return;

    effects[fxIndex].mods = normMods(effects[fxIndex].mods);
    effects[fxIndex].mods.push({ stat: "force", mode: "flat", value: 0 });

    await this._updateAndKeepView({ "system.effectsUI": effects });
  }

  /** État courant des effets : le DOM s'il est rendu, sinon le document. */
  _currentEffects() {
    const cards = this.element?.querySelectorAll("details[data-fx-index]");
    if (cards?.length) return this._collectEffectsFromDOM(cards);
    return foundry.utils.deepClone(this.document.system.effectsUI ?? []);
  }

  /**
   * Mémorise les accordéons ouverts avant un re-render structurel
   * (ajout/suppression), et les restaure juste après.
   *
   * Le défilement, lui, n'est plus géré ici : restoreScrollPositions()
   * (sheet-helpers.js, appelé depuis _onRender) le fait pour TOUS les rendus
   * de TOUTES les fiches, et surtout sur le bon conteneur — l'instantané pris
   * ici lisait `.sheet-body` en priorité, qui existe mais ne défile pas (c'est
   * `.window-content` qui porte l'ascenseur), donc il valait toujours 0.
   */
  _snapshotView() {
    const root = this.element;
    const open = new Set();
    root?.querySelectorAll("details[data-fx-index]").forEach(d => {
      if (d.open) open.add(d.dataset.fxIndex);
    });
    return { open };
  }

  _restoreView(snap) {
    if (!snap) return;
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("details[data-fx-index]").forEach(d => {
      if (snap.open.has(d.dataset.fxIndex)) d.open = true;
    });
  }

  /** Applique une modification structurelle puis re-rend en gardant la vue. */
  async _updateAndKeepView(data) {
    const snap = this._snapshotView();
    await this.document.update(data, { render: false });
    await this.render({ force: true });
    this._restoreView(snap);
  }

  async _actionRemoveMod(event) {
    const btn = event?.target?.closest?.("[data-action]");
    const fxIndex = Number(
      btn?.dataset?.fxIdx ?? btn?.dataset?.fxIndex ??
      btn?.closest?.("[data-fx-index]")?.dataset?.fxIndex ?? -1
    );
    const modIndex = Number(btn?.dataset?.modIndex ?? -1);
    if (!Number.isFinite(fxIndex) || fxIndex < 0) return;
    if (!Number.isFinite(modIndex) || modIndex < 0) return;

    const effects = this._currentEffects();
    if (!effects[fxIndex]) return;

    effects[fxIndex].mods = normMods(effects[fxIndex].mods);
    effects[fxIndex].mods.splice(modIndex, 1);
    await this._updateAndKeepView({ "system.effectsUI": effects });
  }
}