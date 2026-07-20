// systems/rpg/module/sheets/character-sheet-v2.js
import { buildSpellUI, buildSpellEffectsPreview, declareSpell } from "../rules/spells.js";

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
  background: rgba(255,255,255,.12) !important;
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

export class RPGCharacterSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Actor";

  /** Empêche DocumentSheetV2 de crasher (tabs undefined -> reduce) */
  _prepareTabs() {
    return [];
  }

  get id() {
    return `rpg-character-sheet-v2-${this.document.id}`;
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
      window: { contentClasses: ["rpg-sheet-window"] },
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
  /* Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);

    const actor = this.document;
    const isGM = game.user.isGM;
    const isOwner = actor.isOwner;

    const itemDocs = Array.from(actor.items);
    const itemsObj = itemDocs.map(i => i.toObject());

    const categorized = this._categorizeItems(itemsObj);
    const charge = this._calcCharge(categorized);

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

      s._ui.isAura = !!(doc.system?.aura?.active || doc.system?.aura?.enabled);
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

    // ── Tableau des stats pour la vue lisible ─────────────────────────
    const effP  = actor.system?.derived?.effective?.principales ?? {};
    const baseP = actor.system?.principales ?? {};
    const fsb   = actor.system?.derived?.fromSkills ?? {};
    const niv   = Number(actor.system?.niveau ?? 1) || 1;
    ctx.stats = [
      { key:"force",        label:"Force",        base: baseP.force        ?? 0, total: effP.force        ?? 0, fromSkills: fsb.force        || 0, fromBonus: (effP.force        ?? 0) - (baseP.force        ?? 0) - niv - (fsb.force        || 0) },
      { key:"intelligence", label:"Intelligence",  base: baseP.intelligence ?? 0, total: effP.intelligence ?? 0, fromSkills: fsb.intelligence || 0, fromBonus: (effP.intelligence ?? 0) - (baseP.intelligence ?? 0) - niv - (fsb.intelligence || 0) },
      { key:"dexterite",    label:"Dextérité",     base: baseP.dexterite    ?? 0, total: effP.dexterite    ?? 0, fromSkills: fsb.dexterite    || 0, fromBonus: (effP.dexterite    ?? 0) - (baseP.dexterite    ?? 0) - niv - (fsb.dexterite    || 0) },
      { key:"acuite",       label:"Acuité",        base: baseP.acuite       ?? 0, total: effP.acuite       ?? 0, fromSkills: fsb.acuite       || 0, fromBonus: (effP.acuite       ?? 0) - (baseP.acuite       ?? 0) - niv - (fsb.acuite       || 0) },
      { key:"endurance",    label:"Endurance",     base: baseP.endurance    ?? 0, total: effP.endurance    ?? 0, fromSkills: fsb.endurance    || 0, fromBonus: (effP.endurance    ?? 0) - (baseP.endurance    ?? 0) - niv - (fsb.endurance    || 0) },
    ];
    ctx.equipSlots = this._buildEquipSlotsUI(itemsObj);

    ctx.flags = {
      isGM,
      isOwner,
      limitedView: !isGM && !isOwner,
      readOnly: !isGM,
      // Portrait : MJ ou propriétaire peuvent changer leur illustration
      canEditImg: isGM || isOwner
    };

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
      autoStates.push({
        id: "_auto_surcharge", label: "🏋️ Surchargé", type: "auto",
        tag: null, permanent: true, duration: 0, remaining: 0,
        summary: "-1 Vitesse (charge ≥ 90%)",
        isBeneficial: false, isHarmful: true, isAuto: true,
        dot: { flat: 0, perTick: 0 }, mods: {}
      });
    }

    for (const e of states) {
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
        pct,
        grants: s?.grants ?? {}
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

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;

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
    root.addEventListener("click", async (evEquip) => {
      const btn = evEquip.target?.closest("[data-action='toggleEquip']");
      if (!btn || btn.disabled) return;
      evEquip.preventDefault();
      evEquip.stopPropagation();
      const itemId = btn.dataset.itemId ?? btn.closest(".item")?.dataset?.itemId;
      const item = this.document.items.get(itemId);
      if (!item) return;
      btn.disabled = true;
      try {
        await this._toggleEquipItem(item);
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
      } finally { btn.disabled = false; }
    }, { capture: true });

    // Player: disable inputs and most actions
    if (!game.user.isGM) {
      root.querySelectorAll("input, select, textarea").forEach(el => el.disabled = true);
      root.querySelectorAll("button[data-action]:not([data-action='toggleEquip'])").forEach(el => el.disabled = true);
      if (!this.document.isOwner) {
        root.querySelectorAll("button[data-action='toggleEquip']").forEach(el => el.disabled = true);
      }
      return;
    }

    // Debounced pods update
    if (typeof this._debouncedPodsUpdate !== "function") {
      this._debouncedPodsUpdate = foundry.utils.debounce(() => this._updatePodsToActor(), 150);
    }

    // Click delegation
    root.addEventListener("click", async (ev) => {
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
        await this.document.deleteEmbeddedDocuments("Item", [itemId]);
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
        return;
      }

      if (action === "castSpell" || action === "declareSpell") {
        const itemId = btn.dataset.itemId || btn.closest("[data-item-id]")?.dataset?.itemId;
        if (!itemId) return;
        const item = this.document.items.get(itemId);
        if (!item) return;
        const res = await declareSpell(this.document, item);
        if (!res?.ok) ui.notifications.warn(res?.reason ?? "Impossible de lancer le sort.");
        await this.render({ force: true });
        return;
      }

      if (action === "adjRes") {
        const res   = btn.dataset.res;
        const delta = Number(btn.dataset.delta) || 0;
        if (!res || !delta) return;
        const valPath = `system.ressources.${res}.valeur`;
        const maxPath = `system.ressources.${res}.max`;
        const cur = Number(foundry.utils.getProperty(this.document, valPath) ?? 0) || 0;
        const max = Number(foundry.utils.getProperty(this.document, maxPath) ?? 9999) || 9999;
        const next = Math.max(0, Math.min(max, cur + delta));
        if (next === cur) return; // rien à faire
        await this.document.update({ [valPath]: next }, { render: false });
        this.render({ force: false });
        return;
      }

      if (action === "fatigueChange") {
        if (!game.user.isGM) return;
        const delta = Number(btn.dataset.delta ?? 0) || 0;
        if (!delta) return;
        const cur = Number(this.document.system?.ressources?.fatigue?.valeur ?? 0) || 0;
        const max = Number(this.document.system?.ressources?.fatigue?.max ?? 10) || 10;
        const next = Math.max(0, Math.min(max, cur + delta));
        if (next === cur) return;
        await this.document.update({ "system.ressources.fatigue.valeur": next }, { render: false });
        this.render({ force: false });
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
    root.addEventListener("change", async (ev) => {
      const el = ev.target;

      if (el?.matches?.("select[data-action='equipSlotSelect']")) {
        const slot = el.dataset.slot;
        const itemId = el.value || "";
        await this._onEquipSlotChange(slot, itemId);
        this._debouncedPodsUpdate?.();
        await this.render({ force: true });
        return;
      }

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
    // GM-only
    let total = 0;

    for (const item of this.document.items) {
      if (item.type === "spell" || item.type === "skill") continue;

      const sys = item.system ?? {};
      const qte = Number(sys.qte ?? 1) || 1;
      const poids = Number(sys.poids ?? 0) || 0;
      total += poids * qte;
    }

    total = Math.round(total * 10) / 10;

    const cur = Number(this.document.system?.charge?.podsActuels ?? 0) || 0;
    if (Math.abs(cur - total) < 0.05) return;

    await this.document.update({ "system.charge.podsActuels": total });
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

      const t = it.type;
      const estEquip = (t === "weapon" || t === "armor");
      const equipe = !!it.system.equipe;

      if (t === "consumable") out.consommables.push(it);
      else if (t === "spell") out.sorts.push(it);
      else if (t === "skill") out.competences.push(it);
      else if (estEquip && equipe) out.equipe.push(it);
      else if (estEquip && !equipe) out.nonEquipe.push(it);
      else out.inventaire.push(it);
    }

    return out;
  }

  _calcCharge(cat) {
    const inventaire = Array.isArray(cat?.inventaire) ? cat.inventaire : [];
    const equipe = Array.isArray(cat?.equipe) ? cat.equipe : [];
    const nonEquipe = Array.isArray(cat?.nonEquipe) ? cat.nonEquipe : [];
    const consommables = Array.isArray(cat?.consommables) ? cat.consommables : [];

    // ✅ pods = inventaire + equip + non-equip + consommables
    // (sorts + compétences exclus)
    const all = [].concat(inventaire, equipe, nonEquipe, consommables);

    const podsActuels = all.reduce((acc, it) => acc + (Number(it?._derived?.poidsTotal) || 0), 0);
    const podsMax = Number(this.document.system?.charge?.podsMax ?? 0) || 0;

    const pct = podsMax > 0 ? Math.min(999, Math.round((podsActuels / podsMax) * 100)) : 0;

    let etat = "Normal";
    if (podsMax > 0) {
      if (pct >= 120) etat = "Surchargé";
      else if (pct >= 90) etat = "Lourd";
      else if (pct >= 60) etat = "Chargé";
    }

    const cssFill = pct >= 120 ? "enc-surcharge" : pct >= 90 ? "enc-lourd" : pct >= 60 ? "enc-charge" : "";
    const cssBadge = pct >= 120 ? "badge-surcharge" : pct >= 90 ? "badge-lourd" : pct >= 60 ? "badge-charge" : "badge-normal";
    const cssSurcharge = pct >= 120 ? "enc-surcharge" : pct >= 90 ? "enc-lourd" : "";
    const pctCapped = Math.min(100, pct);

    return { podsActuels: Number(podsActuels.toFixed(2)), podsMax, pct, pctCapped, etat, cssFill, cssBadge, cssSurcharge };
  }

  /* -------------------------------------------- */
  /* Equip logic (same as your V1)                */
  /* -------------------------------------------- */

  async _toggleEquipItem(item) {
    const equipe = !!item.system.equipe;
    const type = item.type;
    const slot = item.system?.emplacement;

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

    const conflicts = equipped.filter(i => i.id !== item.id && i.system?.emplacement === slot);
    await unequipItems(conflicts);

    await item.update({ "system.equipe": true });
  }


  _buildEquipSlotsUI(items) {
    const SLOT_DEFS = [
      { key: "tete", label: "Tête", kind: "gear" },
      { key: "torse", label: "Torse", kind: "gear" },
      { key: "taille", label: "Taille", kind: "gear" },
      { key: "bras", label: "Bras", kind: "gear" },
      { key: "mains", label: "Mains", kind: "gear" },
      { key: "jambes", label: "Jambes", kind: "gear" },
      { key: "pieds", label: "Pieds", kind: "gear" },
      { key: "mainDroite", label: "Main droite", kind: "hand" },
      { key: "mainGauche", label: "Main gauche", kind: "hand" },
      { key: "artefact", label: "Artefact", kind: "gear" }
    ];

    const allEquipItems = items.filter(it => it.type === "weapon" || it.type === "armor");
    const equipped = allEquipItems.filter(it => !!it.system?.equipe);

    const bySlot = new Map();
    for (const it of equipped) {
      const slot = it.system?.emplacement;
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
        options = allEquipItems
          .filter(i => i.type === "weapon")
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
      if (!(i.type === "weapon" || i.type === "armor")) return false;
      if (!i.system?.equipe) return false;

      const s = i.system?.emplacement;
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
        for (const w of this.document.items) {
          if (w.type !== "weapon") continue;
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

    if (current && current.id !== item.id) equip(current, false);
    updates.push({ _id: item.id, "system.emplacement": slot, "system.equipe": true });

    await this.document.updateEmbeddedDocuments("Item", updates);
  }

  async _createItem(type) {
    const defaults = {
      loot: { name: "Nouvel objet", type: "loot", system: { qte: 1, poids: 0 } },
      weapon: { name: "Nouvelle arme", type: "weapon", system: { equipe: false, emplacement: "mainDroite", qte: 1, poids: 1, difficulte: 0, damage: { dice: "1d6", flat: 0, scaling: { stat: "force", per: 10, perStep: 1 } }, livraison: "physique" } },
      armor: { name: "Nouvelle armure", type: "armor", system: { equipe: false, emplacement: "torse", qte: 1, poids: 2 } },
      consumable: { name: "Nouveau consommable", type: "consumable", system: { qte: 1, poids: 0.2, utilisations: 1, effet: "" } },

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

      skill: { name: "Nouvelle compétence", type: "skill", system: { qte: 1, poids: 0, rang: 0, statLiee: "dexterite", difficulte: 0 } }
    };

    const data = defaults[type] ?? { name: "Nouvel item", type, system: { qte: 1, poids: 0 } };
    await this.document.createEmbeddedDocuments("Item", [data]);
  }

  async _useItemPreviewFromId(itemId) {
    const item = this.document.items.get(itemId);
    if (!item) return;

    const targetToken = Array.from(game.user.targets)[0];
    if (!targetToken) {
      return ui.notifications.warn("Cible un ennemi (Target : touche T) avant d'utiliser une attaque/sort.");
    }

    const target = targetToken.actor;
    if (!target) return;

    const cd = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
    if (cd > 0) return ui.notifications.warn(`Sort en recharge : ${cd} tour(s).`);

    const type = item.type;
    const livraison = item.system?.livraison ?? (type === "spell" ? "magique" : "physique");
    const diff = Number(item.system?.difficulte ?? 0) || 0;

    const Combat = game.rpg?.combat;
    if (!Combat?.computeTN) {
      ui.notifications.error("Combat API introuvable: game.rpg.combat.computeTN");
      return;
    }

    const tnRes = Combat.computeTN(this.document, target, item);
    let tnBase = 11;
    let tnFinal = 11;

    if (typeof tnRes === "number") {
      tnBase = tnRes;
      tnFinal = tnRes + diff;
    } else if (tnRes && typeof tnRes === "object") {
      tnBase = Number(tnRes.tnBase ?? tnRes.base ?? tnRes.tn ?? 11) || 11;
      tnFinal = Number(tnRes.tnFinal ?? tnRes.final ?? (tnBase + diff)) || (tnBase + diff);
    } else {
      tnBase = 11;
      tnFinal = 11 + diff;
    }

    tnFinal = Math.max(2, Math.min(20, tnFinal));

    const effP =
      this.document.system?.derived?.effP ??
      this.document.system?.derived?.effective?.principales ??
      this.document.system?.principales ??
      {};

    const dmgStat = (livraison === "physique")
      ? Number(effP.force ?? 0)
      : Number(effP.intelligence ?? 0);

    const statBonus = game.rpg?.combat?.bonusFromStat ? game.rpg.combat.bonusFromStat(dmgStat) : 0;

    // ✅ si tu as migré les armes/sorts vers system.damage, tu peux le lire ici aussi
    const flatFixe = Number(item.system?.degatsFixes ?? item.system?.damage?.flat ?? 0) || 0;
    const flatAdd = Number(item.system?.degatsAdd ?? 0) || 0;

    const flatTotal = statBonus + flatFixe + flatAdd;
    const degatsFormula = String(item.system?.degats ?? item.system?.damage?.dice ?? "1d6");

    const content =
      `<b>${this.document.name}</b> utilise <b>${item.name}</b> sur <b>${target.name}</b> ` +
      `(${livraison === "physique" ? "Physique" : "Magique"})<br>` +
      `Seuil toucher: <b>${tnFinal}+</b> (base ${tnBase}+ ; difficulté +${diff})<br>` +
      `Dégâts: <b>${flatTotal}</b> + <b>${degatsFormula}</b><br>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      content
    });
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
    const idx = list.findIndex(e => e.id === id);

    const normalized = this._normalizeState({ ...state, id });

    if (idx >= 0) list[idx] = { ...list[idx], ...normalized };
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
      "vitesse"
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
      vitesse: "Vitesse"
    };

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
            <label>Portée min (cases) (aura)</label>
            <input type="number" name="aura.min" value="${Number(st.aura?.min ?? 0) || 0}" min="0"/>
          </div>
          <div>
            <label>Portée max (cases) (aura)</label>
            <input type="number" name="aura.max" value="${Number(st.aura?.max ?? 0) || 0}" min="0"/>
          </div>
        </div>

        <div class="line">
          <div class="lbl">Cible (aura)</div>
          <select name="aura.target">
            ${["allies", "enemies", "both"].map(t =>
      `<option value="${t}" ${(st.aura?.target ?? "allies") === t ? "selected" : ""}>${t}</option>`
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

      dlg.render(true);
    });
  }

  async _postStateInfoToChat(st) {
    const dotTxt = (st.dot?.flat || st.dot?.formula)
      ? `DOT: <b>${st.dot?.flat ?? 0}</b>${st.dot?.formula ? ` + <b>${st.dot.formula}</b>` : ""}`
      : "DOT: <i>aucun</i>";

    const mods = st.mods ?? {};
    const modsTxt = Object.entries(mods)
      .map(([k, v]) => {
        const name = LABELS[k] ?? k;
        const flat = Number(v.flat ?? 0) || 0;
        const pct = Number(v.pct ?? 0) || 0;
        const a = flat ? `${flat > 0 ? "+" : ""}${flat}` : "";
        const b = pct ? `${pct > 0 ? "+" : ""}${pct}%` : "";
        return `${name}: ${[a, b].filter(Boolean).join(" ")}`.trim();
      })
      .filter(Boolean)
      .join("<br>") || "<i>Aucun modificateur</i>";

    const auraTxt = st.isAura && st.aura?.max
      ? `<br>Aura: <b>${st.aura.target}</b> • Portée <b>${st.aura.min}–${st.aura.max}</b>`
      : "";

    const content = `
      <b>${this.document.name}</b> — État: <b>${st.label}</b><br>
      Type: <b>${st.type}</b> ${st.isAura ? "(Aura)" : ""}${auraTxt}<br>
      Durée: <b>${st.remaining}</b> / ${st.duration} tour(s)<br>
      Retrait: ${st.cleanseDC ? `<b>${st.cleanseDC}+</b>` : "<i>—</i>"}<br>
      ${dotTxt}<br>
      <hr>
      <b>Mods</b><br>${modsTxt}
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      content
    });
  }
}