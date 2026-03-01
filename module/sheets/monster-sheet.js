// systems/rpg/module/sheets/monster-sheet.js
import { buildSpellUI, buildSpellEffectsPreview, declareSpell } from "../rules/spells.js";
const { ActorSheet } = foundry.appv1.sheets;

function parseLevels(csv) {
  return String(csv ?? "")
    .trim()
    .split(/[,\s;.]+/g)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0);
}

function uniqSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a - b);
}

function rangeArrToObj(arr) {
  return {
    min: Number(arr?.[0] ?? 0) || 0,
    max: Number(arr?.[1] ?? 0) || 0
  };
}

function ensureBand(system, lvl) {
  system.gen = system.gen ?? { levelsCsv: "", bands: {}, generated: false };
  system.gen.bands = system.gen.bands ?? {};

  const key = String(lvl);
  const cur = system.gen.bands[key] ?? {};

  const next = {
    stats: cur.stats ?? {},
    defenses: cur.defenses ?? {},
    pv: cur.pv ?? [0, 0],
    regenPv: cur.regenPv ?? [0, 0],
    vitesse: cur.vitesse ?? [0, 0],
    xpReward: cur.xpReward ?? [0, 0],
  };

  next.stats.force = next.stats.force ?? [0, 0];
  next.stats.intelligence = next.stats.intelligence ?? [0, 0];
  next.stats.dexterite = next.stats.dexterite ?? [0, 0];
  next.stats.acuite = next.stats.acuite ?? [0, 0];
  next.stats.endurance = next.stats.endurance ?? [0, 0];

  next.defenses.scoreArmure = next.defenses.scoreArmure ?? [0, 0];
  next.defenses.scoreResistance = next.defenses.scoreResistance ?? [0, 0];
  next.defenses.armureFixe = next.defenses.armureFixe ?? [0, 0];
  next.defenses.resistanceFixe = next.defenses.resistanceFixe ?? [0, 0];

  system.gen.bands[key] = next;
  return next;
}

function getBand(system, lvl) {
  const b = ensureBand(system, lvl);
  const stats = b.stats ?? {};
  const defenses = b.defenses ?? {};

  return {
    lvl,
    force: rangeArrToObj(stats.force),
    intelligence: rangeArrToObj(stats.intelligence),
    dexterite: rangeArrToObj(stats.dexterite),
    acuite: rangeArrToObj(stats.acuite),
    endurance: rangeArrToObj(stats.endurance),

    scoreArmure: rangeArrToObj(defenses.scoreArmure),
    scoreResistance: rangeArrToObj(defenses.scoreResistance),
    armureFixe: rangeArrToObj(defenses.armureFixe),
    resistanceFixe: rangeArrToObj(defenses.resistanceFixe),

    pv: rangeArrToObj(b.pv),
    regenPv: rangeArrToObj(b.regenPv),
    vitesse: rangeArrToObj(b.vitesse),
    xpReward: rangeArrToObj(b.xpReward)
  };
}

export class RPGMonsterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["rpg", "sheet", "actor", "monster"],
      template: "systems/rpg/templates/actor/monster-sheet.hbs",
      width: 1080,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  async getData(options) {
    const data = await super.getData(options);

    data.isGM = game.user.isGM;
    data.canSeeStats = game.user.isGM;

    data.system = data.actor.system;

    data.isToken = this.actor.isToken === true;
    data.showGenConfig = data.isGM && !data.isToken;

    data.system.gen = data.system.gen ?? { levelsCsv: "", bands: {}, generated: false };
    data.system.gen.bands = data.system.gen.bands ?? {};
    data.system.gen.levelsCsv = String(data.system.gen.levelsCsv ?? "");

    const levels = uniqSorted(parseLevels(data.system.gen.levelsCsv));
    data.genLevels = levels;
    data.genBands = levels.map(lvl => getBand(data.system, lvl));

    const all = this.actor.items.map(i => i.toObject());
    data.itemsAttaques = all.filter(i => i.type === "weapon" || i.type === "spell");

    for (const it of data.itemsAttaques) {
      if (it.type !== "spell") continue;
      // ici it est un objet; buildSpellUI accepte item doc/obj selon ton implémentation actuelle
      const ui = buildSpellUI({ actor: this.actor, item: it });
      it._ui = ui?.text ?? ui?.text;
      it._previewEffects = buildSpellEffectsPreview({ actor: this.actor, item: it });
    }

    // états: résumé lisible
    const labelMap = {
      force: "Force", dexterite: "Dextérité", intelligence: "Intelligence", acuite: "Acuité", endurance: "Endurance",
      scoreArmure: "Score Armure", scoreResistance: "Score Résistance", armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
      pvMax: "PV max", manaMax: "Mana max", regenPv: "Régén PV", regenMana: "Régén Mana",
      vitesse: "Vitesse"
    };

    const states = Array.isArray(data.system?.etatsActifs)
      ? foundry.utils.deepClone(data.system.etatsActifs)
      : [];

    for (const e of states) {
      const parts = [];

      const dot = Number(e?.dot?.perTick ?? e?.dot?.flat ?? 0) || 0;
      if (dot > 0) parts.push(`DOT ${dot}`);

      const mods = e?.mods ?? {};
      for (const [k, v] of Object.entries(mods)) {
        const flat = Number(v?.flat ?? 0) || 0;
        const pct = Number(v?.pct ?? 0) || 0;
        const name = labelMap[k] ?? k;
        if (flat) parts.push(`${name} ${flat > 0 ? "+" : ""}${flat}`);
        if (pct) parts.push(`${name} ${pct > 0 ? "+" : ""}${pct}%`);
      }

      let hasPlus = false, hasMinus = false;
      for (const v of Object.values(mods)) {
        const flat = Number(v?.flat ?? 0) || 0;
        const pct = Number(v?.pct ?? 0) || 0;
        if (flat > 0 || pct > 0) hasPlus = true;
        if (flat < 0 || pct < 0) hasMinus = true;
      }
      e.isBeneficial = hasPlus && !hasMinus;
      e.isHarmful = hasMinus && !hasPlus;

      e.summary = parts.join(" • ");
    }

    data.system.etatsActifs = states;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // =========================
    // ✅ Init bands (GEN)
    // =========================
    html.find("[data-action='genInitBands']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const sys = this.actor.system ?? {};
      const levels = uniqSorted(parseLevels(sys.gen?.levelsCsv));

      const clone = foundry.utils.deepClone(sys);
      clone.gen = clone.gen ?? { levelsCsv: "", bands: {}, generated: false };
      clone.gen.bands = clone.gen.bands ?? {};

      for (const lvl of levels) ensureBand(clone, lvl);

      await this.actor.update({ "system.gen.bands": clone.gen.bands });
      this.render(false);
    });

    // =========================
    // ✅ PV (+/-) clamp 0..max
    // =========================
    html.find("[data-action='hpPlus']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const delta = Number(ev.currentTarget.dataset.delta ?? 0) || 0;
      const path = "system.ressources.pv.valeur";

      const cur = Number(foundry.utils.getProperty(this.actor, path)) || 0;
      const max = Number(foundry.utils.getProperty(this.actor, "system.ressources.pv.max")) || 0;

      const next = Math.max(0, Math.min(max > 0 ? max : 999999, cur + delta));
      await this.actor.update({ [path]: next });
      this.render(false);
    });

    // =========================
    // ✅ Ouvrir item
    // =========================
    html.find(".item-edit").on("click", ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      item?.sheet?.render(true);
    });

    // =========================
    // ✅ UseItem (preview chat)
    // =========================
    html.find("[data-action='useItem']").on("click", async (ev) => {
      ev.preventDefault();

      const itemId = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;

      const targetToken = Array.from(game.user.targets)[0];
      if (!targetToken?.actor) return ui.notifications.warn("Cible un PJ/ennemi (T) avant d'utiliser une attaque/sort.");

      const Combat = game.rpg?.combat;
      if (!Combat?.computeTN || !Combat?.damagePreview) return ui.notifications.error("Combat API introuvable (game.rpg.combat).");

      const cd = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
      if (cd > 0) return ui.notifications.warn(`Sort en recharge : ${cd} tour(s).`);

      const rmin = Number(item.system?.range?.min ?? 0) || 0;
      const rmax = Number(item.system?.range?.max ?? item.system?.portee ?? 0) || 0;

      const casterToken = this.actor.getActiveTokens()?.[0];
      if (canvas?.grid && casterToken) {
        const dist = canvas.grid.measureDistance(casterToken.center, targetToken.center);
        if (dist < rmin || dist > rmax) {
          return ui.notifications.warn(`Hors portée: ${dist.toFixed(1)} cases (min ${rmin}, max ${rmax}).`);
        }
      }

      const tn = Combat.computeTN(this.actor, targetToken.actor, item);
      const dmgPrev = Combat.damagePreview(this.actor, item);

      const content =
        `<b>${this.actor.name}</b> utilise <b>${item.name}</b> sur <b>${targetToken.actor.name}</b> (${tn.livraison})<br>` +
        `Seuil toucher: <b>${tn.tnFinal}+</b> (base ${tn.tnBase}+ ; difficulté +${tn.diff})<br>` +
        `Dégâts: <b>${dmgPrev.text}</b>`;

      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content });
    });

    if (!game.user.isGM) return;

    /* -------------------------------------------- */
    /* SPELL WORKFLOW : Déclarer / Resolve GM         */
    /* -------------------------------------------- */

    html.find('[data-action="declareSpell"]').on("click", async (ev) => {
      ev.preventDefault();

      const li = ev.currentTarget.closest("[data-item-id]");
      const itemId = li?.dataset?.itemId || ev.currentTarget.dataset.itemId;
      if (!itemId) return;

      const item = this.actor.items.get(itemId);
      if (!item) return;

      const res = await declareSpell(this.actor, item);
      if (!res?.ok) ui.notifications.warn(res?.reason ?? "Impossible de déclarer le sort.");
      this.render(false);
    });

    // =========================
    // ✅ États (V2) : Add/Edit/Delete/Show
    // =========================
    html.find("[data-action='stateAdd']").on("click", async (ev) => {
      ev.preventDefault();

      const st = this._stateDefaults();
      const edited = await this._editStateDialog(st, { title: "Ajouter un état" });
      if (!edited) return;

      await this._stateUpsert(edited);
      this.render(false);
    });

    html.find("[data-action='stateEdit']").on("click", async (ev) => {
      ev.preventDefault();

      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return ui.notifications.warn("État introuvable.");

      const edited = await this._editStateDialog(st, { title: "Modifier l’état" });
      if (!edited) return;

      await this._stateUpsert(edited);
      this.render(false);
    });

    html.find("[data-action='stateDelete']").on("click", async (ev) => {
      ev.preventDefault();

      const id = ev.currentTarget.dataset.id;
      await this._stateRemove(id);
      this.render(false);
    });

    html.find("[data-action='stateShow']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return;

      const dot = Number(st?.dot?.perTick ?? st?.dot?.flat ?? 0) || 0;
      const lines = [];
      if (dot) lines.push(`DOT: <b>${dot}</b>`);

      const labels = {
        force: "Force", dexterite: "Dextérité", intelligence: "Intelligence", acuite: "Acuité", endurance: "Endurance",
        pvMax: "PV max", manaMax: "Mana max", regenPv: "Régén PV", regenMana: "Régén Mana",
        scoreArmure: "Score Armure", scoreResistance: "Score Résistance", armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
        vitesse: "Vitesse"
      };

      for (const [k, v] of Object.entries(st.mods ?? {})) {
        const f = Number(v.flat ?? 0) || 0;
        const p = Number(v.pct ?? 0) || 0;
        const name = labels[k] ?? k;
        if (f) lines.push(`${name}: ${f > 0 ? "+" : ""}${f}`);
        if (p) lines.push(`${name}: ${p > 0 ? "+" : ""}${p}%`);
      }

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `<b>${st.label}</b> (${st.remaining} tour(s))<br>${lines.join("<br>") || "<i>Aucun effet</i>"}`
      });
    });

    html.find('[data-action="castSpell"]').on("click", async (ev) => {
      ev.preventDefault();

      const li = ev.currentTarget.closest("[data-item-id]");
      const itemId = li?.dataset?.itemId;
      if (!itemId) return;

      const actor = this.actor;
      const item = actor.items.get(itemId);
      if (!item) return;

      const res = await castSpell(actor, item, {
        targetToken: Array.from(game.user.targets)[0] ?? null,
        casterToken: actor.getActiveTokens()?.[0] ?? null
      });

      if (!res?.ok) ui.notifications.warn(res?.reason ?? "Impossible de lancer le sort.");
    });

    html.find("[data-action='deleteItem']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      const itemId = ev.currentTarget.dataset.itemId || li?.dataset?.itemId;
      if (!itemId) return;
      await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
    });

    html.find('[data-action="gmAura"]').on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const token = this.actor.getActiveTokens()?.[0] ?? canvas.tokens.controlled?.[0];
      if (!token) return ui.notifications.warn("Sélectionne/affiche un token.");

      const content = `
        <form>
          <div class="form-group">
            <label>Rayon (cases)</label>
            <input type="number" name="radius" value="3" min="0" step="1"/>
          </div>

          <div class="form-group">
            <label>Couleur (hex)</label>
            <input type="text" name="color" value="#33aaff"/>
          </div>

          <div class="form-group">
            <label>Opacité (0 → 1)</label>
            <input type="number" name="alpha" value="0.2" min="0" max="1" step="0.05"/>
          </div>

          <div class="form-group">
            <label>Mode</label>
            <select name="mode">
              <option value="add">Créer / Mettre à jour</option>
              <option value="remove">Supprimer</option>
            </select>
          </div>
        </form>
      `;

      new Dialog({
        title: `Aura (MJ) — ${token.name}`,
        content,
        buttons: {
          ok: {
            label: "OK",
            callback: async (dlgHtml) => {
              const form = dlgHtml[0].querySelector("form");
              const fd = new FormData(form);

              const radius = Number(fd.get("radius") ?? 0) || 0;
              const color = String(fd.get("color") ?? "#33aaff").trim() || "#33aaff";
              const alpha = Math.max(0, Math.min(1, Number(fd.get("alpha") ?? 0.2) || 0.2));
              const mode = String(fd.get("mode") ?? "add");

              await game.rpg?.gmAura?.toggle(token, { radius, color, alpha, mode });
            }
          },
          cancel: { label: "Annuler" }
        },
        default: "ok"
      }).render(true);
    });
  }

  // ========= Helpers états (V2 sheet) =========
  _statePath() { return "system.etatsActifs"; }

  _stateList() {
    const cur = foundry.utils.getProperty(this.actor, this._statePath());
    return Array.isArray(cur) ? foundry.utils.deepClone(cur) : [];
  }

  _stateFindById(id) {
    return this._stateList().find(e => e.id === id) ?? null;
  }

  async _stateUpsert(state) {
    const path = this._statePath();
    const list = this._stateList();

    const id = state.id || foundry.utils.randomID();
    const idx = list.findIndex(e => e.id === id);

    const normalized = this._normalizeState({ ...state, id });

    if (idx >= 0) list[idx] = { ...list[idx], ...normalized };
    else list.push(normalized);

    await this.actor.update({ [path]: list });
  }

  async _stateRemove(id) {
    const path = this._statePath();
    const list = this._stateList().filter(e => e.id !== id);
    await this.actor.update({ [path]: list });
  }

  _stateDefaults() {
    return this._normalizeState({
      id: foundry.utils.randomID(),
      label: "Brûlure",
      type: "burn",
      isAura: false,
      duration: 2,
      remaining: 2,
      cleanseDC: 0,
      dot: { flat: 0, formula: "", perTick: 0 },
      mods: {}
    });
  }

  _normalizeState(st) {
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
    return out;
  }

  _allModKeys() {
    return [
      "force", "dexterite", "intelligence", "acuite", "endurance",
      "pvMax", "manaMax",
      "regenPv", "regenMana",
      "scoreArmure", "scoreResistance", "armureFixe", "resistanceFixe",
      "vitesse"
    ];
  }

  async _editStateDialog(state, { title }) {
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

    const row = (k) => {
      const cur = st.mods?.[k] ?? {};
      const flat = Number(cur.flat ?? 0) || 0;
      const pct = Number(cur.pct ?? 0) || 0;

      return `
      <div class="form-group" style="display:grid;grid-template-columns:1fr 90px 90px;gap:8px;align-items:center;">
        <label>${labels[k] ?? k}</label>
        <input type="number" name="mods.${k}.flat" value="${flat}" placeholder="Flat"/>
        <input type="number" name="mods.${k}.pct" value="${pct}" placeholder="%"/>
      </div>`;
    };

    const modsHtml = keys.map(row).join("");

    const html = `
    <form class="rpg-state-edit">
      <div class="form-group">
        <label>Nom</label>
        <input type="text" name="label" value="${st.label}"/>
      </div>

      <div class="form-group">
        <label>Type</label>
        <select name="type">
          ${["poison", "burn", "buff", "debuff", "aura", "custom"].map(t =>
            `<option value="${t}" ${st.type === t ? "selected" : ""}>${t}</option>`
          ).join("")}
        </select>
      </div>

      <div class="form-group">
        <label>Aura</label>
        <input type="checkbox" name="isAura" ${st.isAura ? "checked" : ""}/>
      </div>

      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label>Durée (tours)</label>
          <input type="number" name="duration" value="${st.duration}" min="1"/>
        </div>
        <div>
          <label>Restant</label>
          <input type="number" name="remaining" value="${st.remaining}" min="0"/>
        </div>
      </div>

      <div class="form-group">
        <label>Difficulté retrait (DC)</label>
        <input type="number" name="cleanseDC" value="${st.cleanseDC}" min="0"/>
      </div>

      <hr/>
      <h3>DOT</h3>
      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label>DOT fixe</label>
          <input type="number" name="dot.flat" value="${Number(st.dot.flat ?? 0) || 0}"/>
        </div>
        <div>
          <label>DOT formule (optionnel)</label>
          <input type="text" name="dot.formula" value="${st.dot.formula ?? ""}" placeholder="ex: 1d4"/>
        </div>
      </div>

      <hr/>
      <h3>Modificateurs</h3>
      <p class="hint">Flat = +10 / -10. % = +10 / -10.</p>
      ${modsHtml}
    </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: title || "État",
        content: html,
        buttons: {
          cancel: { label: "Annuler", callback: () => resolve(null) },
          ok: {
            label: "Enregistrer",
            callback: (dlgHtml) => {
              const form = dlgHtml[0].querySelector("form");
              const fd = new FormData(form);

              const getStr = (k, d = "") => String(fd.get(k) ?? d).trim();
              const getNum = (k, d = 0) => Number(fd.get(k) ?? d) || 0;
              const getChk = (k) => !!fd.get(k);

              const out = this._normalizeState(st);
              out.label = getStr("label", out.label);
              out.type = getStr("type", out.type);
              out.isAura = getChk("isAura");

              out.duration = Math.max(1, getNum("duration", out.duration));
              out.remaining = Math.max(0, getNum("remaining", out.remaining));
              out.cleanseDC = Math.max(0, getNum("cleanseDC", out.cleanseDC));

              out.dot = out.dot ?? {};
              out.dot.flat = getNum("dot.flat", 0);
              out.dot.formula = getStr("dot.formula", "");
              out.dot.perTick = out.dot.flat;

              out.mods = out.mods ?? {};
              for (const k of keys) {
                const flat = getNum(`mods.${k}.flat`, 0);
                const pct = getNum(`mods.${k}.pct`, 0);
                if (flat !== 0 || pct !== 0) out.mods[k] = { flat, pct };
                else delete out.mods[k];
              }

              resolve(out);
            }
          }
        },
        default: "ok"
      }).render(true);
    });
  }
}