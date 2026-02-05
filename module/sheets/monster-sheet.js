function parseLevels(csv) {
  // accepte: "2,4,6" ou "2;4;6" ou "2 4 6" ou "2.4.6"
  return String(csv ?? "")
    .trim()
    .split(/[,\s;.]+/g)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0);
}

function rangeObj(arr) {
  return {
    min: Number(arr?.[0] ?? 0) || 0,
    max: Number(arr?.[1] ?? 0) || 0
  };
}

function getBand(system, lvl) {
  const key = String(lvl);
  const b = system?.gen?.bands?.[key] ?? {};
  const stats = b.stats ?? {};
  const defenses = b.defenses ?? {};

  return {
    lvl,
    force: rangeObj(stats.force),
    intelligence: rangeObj(stats.intelligence),
    dexterite: rangeObj(stats.dexterite),
    acuite: rangeObj(stats.acuite),
    endurance: rangeObj(stats.endurance),

    scoreArmure: rangeObj(defenses.scoreArmure),
    scoreResistance: rangeObj(defenses.scoreResistance),
    armureFixe: rangeObj(defenses.armureFixe),
    resistanceFixe: rangeObj(defenses.resistanceFixe),

    pv: rangeObj(b.pv),
    regenPv: rangeObj(b.regenPv),
    vitesse: rangeObj(b.vitesse),
    xpReward: rangeObj(b.xpReward)
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
    data.canSeeStats = game.user.isGM;
    data.system = data.actor.system;

    data.isGM = game.user.isGM;
    data.isToken = this.actor.isToken === true;          // IMPORTANT
    data.showGenConfig = data.isGM && !data.isToken;     // hide on token sheets

    const levels = parseLevels(data.system?.gen?.levelsCsv);
    data.genBands = levels.map(lvl => getBand(data.system, lvl));

    const all = this.actor.items.map(i => i.toObject());
    data.itemsAttaques = all.filter(i => i.type === "weapon" || i.type === "spell");

    data.statusEffects = this.actor.system?.etatsActifs ?? [];
    data.flags = data.flags ?? {};
    data.flags.isGM = game.user.isGM;

    const labelMap = {
      force: "Force",
      dexterite: "Dextérité",
      intelligence: "Intelligence",
      acuite: "Acuité",
      endurance: "Endurance",
    
      scoreArmure: "Score Armure",
      scoreResistance: "Score Résistance",
      armureFixe: "Armure fixe",
      resistanceFixe: "Résistance fixe",
    
      vieMax: "Vie max",
      manaMax: "Mana max",
      regenPv: "Régén PV",
      regenMana: "Régén Mana",
      vitesse: "Vitesse",
      initiative: "Initiative",
      defense: "Défense",
      resistance: "Résistance",
      savoir: "Savoir"
    };
    
    const states = Array.isArray(data.system?.etatsActifs) ? foundry.utils.deepClone(data.system.etatsActifs) : [];
    
    for (const e of states) {
      const parts = [];
    
      // DOT
      const dot = e?.dot?.perTick ?? 0;
      if (Number(dot) > 0) parts.push(`DOT ${dot}`);
    
      // Mods
      const mods = e?.mods ?? {};
      for (const [k, v] of Object.entries(mods)) {
        const flat = Number(v?.flat ?? 0) || 0;
        const pct  = Number(v?.pct ?? 0) || 0;
    
        if (flat) parts.push(`${labelMap[k] ?? k} ${flat > 0 ? "+" : ""}${flat}`);
        if (pct)  parts.push(`${labelMap[k] ?? k} ${pct > 0 ? "+" : ""}${pct}%`);
      }
    
      // Petit tag “bénéfique”
      // (on considère bénéfique si au moins un bonus >0 et aucun malus, sinon neutre/malus)
      let hasPlus = false, hasMinus = false;
      for (const v of Object.values(mods)) {
        const flat = Number(v?.flat ?? 0) || 0;
        const pct  = Number(v?.pct ?? 0) || 0;
        if (flat > 0 || pct > 0) hasPlus = true;
        if (flat < 0 || pct < 0) hasMinus = true;
      }
      e.isBeneficial = hasPlus && !hasMinus;
      e.isHarmful    = hasMinus && !hasPlus;
    
      e.summary = parts.join(" • ");
    }
    
    data.system.etatsActifs = states;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    if (!game.user.isGM) return;

    const applyDelta = async (path, delta) => {
      const cur = Number(foundry.utils.getProperty(this.actor, path)) || 0;
      await this.actor.update({ [path]: cur + delta });
    };

    html.find("[data-action='hpPlus']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const delta = Number(ev.currentTarget.dataset.delta || 0);
      const path = "system.ressources.pv.valeur";
      const cur = Number(foundry.utils.getProperty(this.actor, path)) || 0;
      await this.actor.update({ [path]: cur + delta });
    });

    html.find(".stat-total").on("change", async (ev) => {
      if (!game.user.isGM) return;

      const stat = ev.currentTarget.dataset.stat; // force/intelligence/...
      const totalWanted = Number(ev.currentTarget.value ?? 0) || 0;

      const bonus = Number(this.actor.system?.derived?.bonus?.principales?.[stat] ?? 0) || 0;

      // mods d'états (flat/pct) sont déjà inclus dans derived.effective
      // donc on ne peut pas "déduire" précisément une base si % est utilisé.
      // => on fait simple: base = total - bonusItemsSorts (comme PJ)
      const newBase = totalWanted - bonus;

      await this.actor.update({ [`system.principales.${stat}`]: newBase });
    });

    html.find(".def-total").on("change", async (ev) => {
      if (!game.user.isGM) return;

      const key = ev.currentTarget.dataset.def; // scoreArmure/scoreResistance/armureFixe/resistanceFixe
      const totalWanted = Number(ev.currentTarget.value ?? 0) || 0;

      const baseCur = Number(this.actor.system?.defenses?.[key] ?? 0) || 0;
      const bonusItem = Number(this.actor.system?.derived?.bonus?.defenses?.[key] ?? 0) || 0;

      // endurance peut influer chez toi (scoreFromEnd). Sur monstre c'est 0 dans ton actor.js,
      // mais on calcule génériquement au cas où.
      const effCur = Number(this.actor.system?.derived?.effective?.defenses?.[key] ?? 0) || 0;
      const contribOther = effCur - (baseCur + bonusItem); // ex: endurance, etc.

      const newBase = totalWanted - bonusItem - contribOther;
      await this.actor.update({ [`system.defenses.${key}`]: newBase });
    });

    // Ouvrir item sheet
    html.find(".item-edit").on("click", ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      item?.sheet?.render(true);
    });

    // Utiliser une attaque/sort
    html.find("[data-action='useItem']").on("click", async (ev) => {
      ev.preventDefault();

      const itemId = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;

      const targetToken = Array.from(game.user.targets)[0];
      if (!targetToken?.actor) {
        return ui.notifications.warn("Cible un PJ/ennemi (T) avant d'utiliser une attaque/sort.");
      }

      const Combat = game.rpg?.combat;
      if (!Combat?.computeTN || !Combat?.damagePreview) {
        return ui.notifications.error("Combat API introuvable (game.rpg.combat).");
      }

      const tn = Combat.computeTN(this.actor, targetToken.actor, item);
      const dmgPrev = Combat.damagePreview(this.actor, item);
      const etats = String(item.system?.etatsInfliges ?? "").trim();
      const content =
        `<b>${this.actor.name}</b> utilise <b>${item.name}</b> sur <b>${targetToken.actor.name}</b> (${tn.livraison})<br>` +
        `Seuil toucher: <b>${tn.tnFinal}+</b> (base ${tn.tnBase}+ ; difficulté +${tn.diff})<br>` +
        `Dégâts: <b>${dmgPrev.text}</b><br>` +
        (etats ? `États: <b>${etats}</b><br>` : "");

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content
      });
    });

    // --- Supprimer ---
    html.find("[data-action='etatDelete']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const row = ev.currentTarget.closest("[data-etat-id]");
      const id = row?.dataset?.etatId;
      if (!id) return;

      const list = Array.isArray(this.actor.system.etatsActifs) ? foundry.utils.deepClone(this.actor.system.etatsActifs) : [];
      const next = list.filter(e => e.id !== id);

      await game.rpg.status.upsertEffect(this.actor, editedState)

      // si on supprimait celui qu’on éditait
      const editId = html.find("[data-field='etat.editId']").val()?.trim();
      if (editId === id) this._fillEtatForm(html, null);

      this.render(false);
    });

    // --- Modifier (charge le form) ---
    html.find("[data-action='etatEdit']").on("click", (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const row = ev.currentTarget.closest("[data-etat-id]");
      const id = row?.dataset?.etatId;
      if (!id) return;

      const list = Array.isArray(this.actor.system.etatsActifs) ? this.actor.system.etatsActifs : [];
      const etat = list.find(e => e.id === id);
      if (!etat) return;

      this._fillEtatForm(html, etat);
    });

    html.find("[data-action='etatDec']").on("click", async (ev) => {
      ev.preventDefault();
      if (!this.actor.isOwner && !game.user.isGM) return;

      const li = ev.currentTarget.closest("[data-etat-id]");
      const id = li?.dataset?.etatId;
      if (!id) return;

      const list = Array.isArray(this.actor.system?.etatsActifs) ? this.actor.system.etatsActifs : [];
      const next = list
        .map(e => e.id === id ? ({ ...e, remaining: Math.max(0, (Number(e.remaining) || 0) - 1) }) : e)
        .filter(e => (Number(e.remaining) || 0) > 0);

      await game.rpg.status.upsertEffect(this.actor, editedState)
      this.render(false);
    });

    html.find("[data-action='stateDelete']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const id = ev.currentTarget.dataset.id;
      await this._stateRemove(id);
      this.render(false);
    });

    html.find("[data-action='statusShowCleanse']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      await game.rpg.status.postCleanseInfo(this.actor, ev.currentTarget.dataset.id);
    });

    html.find("[data-action='stateAdd']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const st = this._stateDefaults();
      const edited = await this._editStateDialog(st, { title: "Ajouter un état" });
      if (!edited) return;

      await this._stateUpsert(edited);
      this.render(false);
    });

    html.find("[data-action='stateEdit']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return ui.notifications.warn("État introuvable.");

      const edited = await this._editStateDialog(st, { title: "Modifier l’état" });
      if (!edited) return;

      await this._stateUpsert(edited);
      this.render(false);
    });

    html.find("[data-action='stateShow']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return;

      await this._postStateInfoToChat(st);
    });
  }

  // -------- Helpers --------
  _statePath() { return "system.etatsActifs"; }

  _stateList() {
    const cur = foundry.utils.getProperty(this.actor, this._statePath());
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

    await this.actor.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.actor);
  }

  async _stateRemove(id) {
    const path = this._statePath();
    const list = this._stateList().filter(e => e.id !== id);
    await this.actor.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.actor);
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
      "force", "dexterite", "intelligence", "acuite", "savoir",
      "initiative", "defense", "resistance",
      "vieMax", "manaMax", "regenPv", "regenMana",
      "scoreArmure", "scoreResistance", "armureFixe", "resistanceFixe",
      "vitesse"
    ];
  }

  async _editStateDialog(state, { title }) {
    const st = this._normalizeState(state);
    const keys = this._allModKeys();

    // mini helper pour générer les inputs flat/pct
    const row = (k, label) => {
      const cur = st.mods?.[k] ?? {};
      const flat = Number(cur.flat ?? 0) || 0;
      const pct  = Number(cur.pct ?? 0) || 0;

      return `
      <div class="form-group" style="display:grid;grid-template-columns:1fr 90px 90px;gap:8px;align-items:center;">
        <label>${label}</label>
        <input type="number" name="mods.${k}.flat" value="${flat}" placeholder="Flat"/>
        <input type="number" name="mods.${k}.pct" value="${pct}" placeholder="%"/>
      </div>`;
    };

    const labels = {
      force: "Force", dexterite: "Dextérité", intelligence: "Intelligence", acuite: "Acuité", savoir: "Savoir",
      initiative: "Initiative", defense: "Défense", resistance: "Résistance",
      vieMax: "Vie max", manaMax: "Mana max", regenPv: "Regen PV", regenMana: "Regen Mana",
      scoreArmure: "Score Armure", scoreResistance: "Score Résistance", armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
      vitesse: "Vitesse"
    };

    const modsHtml = keys.map(k => row(k, labels[k] ?? k)).join("");

    const html = `
    <form class="rpg-state-edit">
      <div class="form-group">
        <label>Nom (label)</label>
        <input type="text" name="label" value="${st.label}"/>
      </div>

      <div class="form-group">
        <label>Type</label>
        <select name="type">
          ${["poison","burn","buff","debuff","aura","custom"].map(t =>
            `<option value="${t}" ${st.type===t?"selected":""}>${t}</option>`
          ).join("")}
        </select>
      </div>

      <div class="form-group">
        <label>Aura (buff permanent tant que présent)</label>
        <input type="checkbox" name="isAura" ${st.isAura ? "checked" : ""}/>
      </div>

      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label>Durée (tours)</label>
          <input type="number" name="duration" value="${st.duration}" min="1"/>
        </div>
        <div>
          <label>Restant (tours)</label>
          <input type="number" name="remaining" value="${st.remaining}" min="0"/>
        </div>
      </div>

      <div class="form-group">
        <label>Difficulté retrait (cleanse DC)</label>
        <input type="number" name="cleanseDC" value="${st.cleanseDC}" min="0"/>
      </div>

      <hr/>
      <h3>DOT (Poison / Brûlure)</h3>
      <p class="hint">DOT fixe = dégâts appliqués à chaque tick (ex: début de tour). Tu peux aussi garder une formule optionnelle.</p>

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
      <h3>Modificateurs (buff / debuff)</h3>
      <p class="hint">Flat = +10 / -10. % = +10 / -10 (pour +10% / -10%). Laisse à 0 si non utilisé.</p>

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

              const getStr = (k, d="") => String(fd.get(k) ?? d).trim();
              const getNum = (k, d=0) => Number(fd.get(k) ?? d) || 0;
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
              out.dot.perTick = out.dot.flat; // affichage simple

              out.mods = out.mods ?? {};
              for (const k of keys) {
                const flat = getNum(`mods.${k}.flat`, 0);
                const pct  = getNum(`mods.${k}.pct`, 0);
                // n’enregistre pas des lignes vides
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

  async _postStateInfoToChat(st) {
    return RPGCharacterSheet.prototype._postStateInfoToChat.call(this, st);
  }

  _readEtatForm(html) {
    const get = (sel) => html.find(`[data-field='${sel}']`).val();

    const name = String(get("etat.name") ?? "").trim();
    const tours = Number(get("etat.duration") ?? 0) || 0;
    const dc = Number(get("etat.dc") ?? 0) || 0;

    const dotFlat = Number(get("etat.dotFlat") ?? 0) || 0;
    const dotStat = String(get("etat.dotStat") ?? "").trim();
    const dotDiv = Math.max(1, Number(get("etat.dotDiv") ?? 10) || 10);

    // debuffs: (valeurs SIGNÉES)
    const debuff = {
      forceFlat: Number(get("etat.debuff.forceFlat") ?? 0) || 0,
      forcePct: Number(get("etat.debuff.forcePct") ?? 0) || 0,
      dexFlat: Number(get("etat.debuff.dexFlat") ?? 0) || 0,
      dexPct: Number(get("etat.debuff.dexPct") ?? 0) || 0,
      intFlat: Number(get("etat.debuff.intFlat") ?? 0) || 0,
      intPct: Number(get("etat.debuff.intPct") ?? 0) || 0
    };

    const dot = (dotFlat !== 0 || dotStat)
      ? { flat: dotFlat, stat: dotStat || "", div: dotDiv }
      : null;

    return {
      id: foundry.utils.randomID(),
      name,
      duration: Math.max(1, tours),
      remaining: Math.max(1, tours),
      dc: Math.max(0, dc),
      dot,
      debuff: {
        forceFlat: debuff.forceFlat, forcePct: debuff.forcePct,
        intelligenceFlat: debuff.intFlat, intelligencePct: debuff.intPct,
        dexteriteFlat: debuff.dexFlat, dexteritePct: debuff.dexPct,
        acuiteFlat: 0, acuitePct: 0,
        enduranceFlat: 0, endurancePct: 0
      }
    };

  }

  _fillEtatForm(html, etat) {
    const set = (field, value) => html.find(`[data-field='${field}']`).val(value);

    if (!etat) {
      set("etat.editId", "");
      set("etat.name", "");
      set("etat.duration", 3);
      set("etat.dc", 0);
      set("etat.dotFlat", 0);
      set("etat.dotStat", "");
      set("etat.dotDiv", 10);

      set("etat.debuff.forceFlat", 0);
      set("etat.debuff.forcePct", 0);
      set("etat.debuff.dexFlat", 0);
      set("etat.debuff.dexPct", 0);
      set("etat.debuff.intFlat", 0);
      set("etat.debuff.intPct", 0);
      return;
    }

    set("etat.editId", etat.id ?? "");
    set("etat.name", etat.name ?? "");
    set("etat.dc", etat.dc ?? 0);
    set("etat.duration", etat.duration ?? 1);
    set("etat.dotFlat", etat.dot?.flat ?? 0);
    set("etat.dotStat", etat.dot?.stat ?? "");
    set("etat.dotDiv", etat.dot?.div ?? 10);

    const d = etat.debuff ?? {};
    set("etat.debuff.forceFlat", d.forceFlat ?? 0);
    set("etat.debuff.forcePct", d.forcePct ?? 0);
    set("etat.debuff.dexFlat", d.dexFlat ?? 0);
    set("etat.debuff.dexPct", d.dexPct ?? 0);
    set("etat.debuff.intFlat", d.intFlat ?? 0);
    set("etat.debuff.intPct", d.intPct ?? 0);
  }

  async _stateAdd(list) {
    const path = this._statePath(list);
    const arr = foundry.utils.deepClone(foundry.utils.getProperty(this.actor, path)) || [];
    const st = this._stateDefaults(list);

    // ouvre directement la modale d’édition pour le nouvel état
    const edited = await this._editStateDialog(st, { isActive: list === "etatsActifs" });
    if (!edited) return;

    arr.push(edited);
    await this.actor.update({ [path]: arr });
  }

  async _stateEdit(list, idx) {
    const path = this._statePath(list);
    const arr = foundry.utils.deepClone(foundry.utils.getProperty(this.actor, path)) || [];
    const st = arr[idx];
    if (!st) return;

    const edited = await this._editStateDialog(st, { isActive: list === "etatsActifs" });
    if (!edited) return;

    arr[idx] = edited;
    await this.actor.update({ [path]: arr });
  }

  async _stateDelete(list, idx) {
    const path = this._statePath(list);
    const arr = foundry.utils.deepClone(foundry.utils.getProperty(this.actor, path)) || [];
    if (idx < 0 || idx >= arr.length) return;

    arr.splice(idx, 1);
    await this.actor.update({ [path]: arr });
  }
}
