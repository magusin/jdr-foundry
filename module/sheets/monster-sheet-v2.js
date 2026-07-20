// systems/rpg/module/sheets/monster-sheet-v2.js
import { buildSpellUI, buildSpellEffectsPreview, declareSpell } from "../rules/spells.js";
import { setupActorItemDrop } from "./drop-helper.js";
import { randomizeMonster } from "../monster-gen.js";
import { normalizeState, ensureStateDialogCSS, LABELS } from "./character-sheet-v2.js";
const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

function parseLevels(csv) {
  return String(csv ?? "").trim().split(/[,\s;.]+/g).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0);
}
function uniqSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a - b);
}
function rangeArrToObj(arr) {
  return { min: Number(arr?.[0] ?? 0) || 0, max: Number(arr?.[1] ?? 0) || 0 };
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
    fatigueMax: cur.fatigueMax ?? [10, 10],
    toucherPhysique: cur.toucherPhysique ?? [0, 0],
    toucherMagique: cur.toucherMagique ?? [0, 0],
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
    xpReward: rangeArrToObj(b.xpReward),
    fatigueMax: rangeArrToObj(b.fatigueMax),
    toucherPhysique: rangeArrToObj(b.toucherPhysique),
    toucherMagique: rangeArrToObj(b.toucherMagique)
  };
}

export class RPGMonsterSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {

  static PARTS = {
    main: { template: "systems/rpg/templates/actor/monster-sheet.hbs" }
  };

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: "rpg-monster-sheet-v2",
    classes: ["rpg", "sheet", "actor", "monster"],
    position: { width: 1080, height: 820 },
    window: { resizable: true }
  });

  _activeTab = "main";

  async _prepareContext(options) {
    const ctx = (await super._prepareContext(options)) ?? {};
    const actor = this.document;
    const sys = actor.system ?? {};

    ctx.actor = actor;
    ctx.system = sys;
    ctx.flags = ctx.flags ?? {};
    ctx.flags.isGM = game.user.isGM;
    ctx.flags.canSeeStats = game.user.isGM;
    ctx.canSeeStats = game.user.isGM;
    ctx.isToken = actor.isToken === true;
    ctx.showGenConfig = game.user.isGM && !ctx.isToken;
    const _entries = Array.isArray(actor.system?.butin?.entries) ? actor.system.butin.entries : [];
    const _tableUuid = String(actor.system?.butin?.tableUuid ?? "").trim();
    ctx.hasLoot = game.user.isGM && (_entries.length > 0 || !!_tableUuid);

    ctx.system.gen = ctx.system.gen ?? { levelsCsv: "", bands: {}, generated: false };
    ctx.system.gen.bands = ctx.system.gen.bands ?? {};
    ctx.system.gen.levelsCsv = String(ctx.system.gen.levelsCsv ?? "");

    const levels = uniqSorted(parseLevels(ctx.system.gen.levelsCsv));
    ctx.genLevels = levels;
    ctx.genBands = levels.map(lvl => getBand(ctx.system, lvl));

    const itemDocs = Array.from(actor.items);
    const itemsObj = itemDocs.map(i => i.toObject());
    ctx.itemsAttaques = itemsObj.filter(i => i.type === "weapon" || i.type === "spell");

    for (const it of ctx.itemsAttaques) {
      if (it.type !== "spell") continue;
      const doc = actor.items.get(it._id);
      if (!doc) continue;
      const ui = buildSpellUI({ actor, item: doc });
      it._ui = ui?.text ?? {};
      it._previewEffects = buildSpellEffectsPreview({ actor, item: doc }) ?? [];
    }

    ctx.effP =
      actor.system?.derived?.effP ??
      actor.system?.derived?.effective?.principales ??
      actor.system?.principales ??
      {};

    const labelMap = {
      force: "Force", dexterite: "Dextérité", intelligence: "Intelligence", acuite: "Acuité", endurance: "Endurance",
      scoreArmure: "Score Armure", scoreResistance: "Score Résistance", armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
      pvMax: "PV max", manaMax: "Mana max", regenPv: "Régén PV", regenMana: "Régén Mana", vitesse: "Vitesse",
      toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique", initiativeMod: "Initiative",
      fatigueMax: "Fatigue max", podsMax: "Pods max"
    };

    const states = Array.isArray(sys?.etatsActifs) ? foundry.utils.deepClone(sys.etatsActifs) : [];
    for (const e of states) {
      const parts = [];
      const dot = Number(e?.dot?.perTick ?? e?.dot?.flat ?? 0) || 0;
      if (dot > 0) parts.push(`Dégâts/tour ${dot}`);
      else if (dot < 0) parts.push(`Soin/tour ${Math.abs(dot)}`);

      const fatDot = Number(e?.dot?.fatiguePerTick ?? 0) || 0;
      if (fatDot > 0) parts.push(`Épuise +${fatDot} fatigue/tour`);
      else if (fatDot < 0) parts.push(`Repose ${fatDot} fatigue/tour`);
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
    ctx.system.etatsActifs = states;
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    // ✅ Clic images (illustration + token) — MJ only, portrait ne sync pas token
    root.querySelectorAll(".rpg-img-edit").forEach(img => {
      if (!game.user.isGM) return;
      const field = img.dataset.field;
      if (!field) return;
      img.addEventListener("click", async () => {
        const current = foundry.utils.getProperty(this.document, field) ?? "";
        const fp = new foundry.applications.apps.FilePicker({
          type: "image",
          current,
          callback: async (path) => {
            if (field === "img") {
              // Portrait UNIQUEMENT — ne pas synchro vers le token
              await this.document.update({ "img": path }, { noTokenUpdate: true });
            } else {
              await this.document.update({ [field]: path });
            }
          }
        });
        fp.render(true);
      });
    });

    // Drag & drop d'item (GM only)
    setupActorItemDrop(this, root);

    const qsAll = (sel) => Array.from(root.querySelectorAll(sel));

    // ── TABS ──────────────────────────────────────────
    const switchTab = (name) => {
      this._activeTab = name;
      qsAll(".sheet-tabs .item").forEach(a => {
        a.classList.toggle("active", a.dataset.tab === name);
      });
      qsAll(".sheet-body .tab").forEach(div => {
        div.style.display = div.dataset.tab === name ? "block" : "none";
      });
    };

    qsAll(".sheet-tabs .item").forEach(a => {
      a.addEventListener("click", ev => {
        ev.preventDefault();
        switchTab(a.dataset.tab);
      });
    });

    switchTab(this._activeTab);

    // ── AUTO-SAVE tous les champs ─────────────────────
    // En V2 les inputs ne sont plus soumis automatiquement,
    // on écoute "change" sur chaque champ et on update le document.
    qsAll("input[name], select[name], textarea[name]").forEach(el => {
      el.addEventListener("change", async (ev) => {
        ev.stopPropagation();
        const name = el.getAttribute("name");

        // Cas spécial : levelsCsv → re-render pour recalculer les bands
        const isLevelsCsv = name === "system.gen.levelsCsv";

        let value;
        if (el.type === "checkbox") value = el.checked;
        else if (el.type === "number") value = el.value === "" ? null : Number(el.value);
        else value = el.value;

        await this.document.update({ [name]: value });

        if (isLevelsCsv) this.render({ force: false });
      });
    });

    // ── GEN init bands ────────────────────────────────
    qsAll("[data-action='genInitBands']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const sys = this.document.system ?? {};
        const levels = uniqSorted(parseLevels(sys.gen?.levelsCsv));
        const clone = foundry.utils.deepClone(sys);
        clone.gen = clone.gen ?? { levelsCsv: "", bands: {}, generated: false };
        clone.gen.bands = clone.gen.bands ?? {};
        for (const lvl of levels) ensureBand(clone, lvl);
        await this.document.update({ "system.gen.bands": clone.gen.bands });
        this.render({ force: false });
      });
    });

    // ── Régénérer les stats du monstre (bouton manquant jusqu'ici) ──
    qsAll("[data-action='rerollMonster']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        btn.disabled = true;
        try {
          await randomizeMonster(this.document);
          ui.notifications?.info?.(`${this.document.name} régénéré.`);
          this.render({ force: true });
        } catch (e) {
          console.error("[RPG] rerollMonster:", e);
          ui.notifications?.error?.(`Erreur régénération : ${e?.message ?? e}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // ── Looter CE monstre depuis sa fiche ─────────────────────────────
    qsAll("[data-action='lootThisMonster']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        btn.disabled = true;
        try {
          const { lootMonsters } = await import("../rules/combat-end.js");
          // Utilise l'id de l'acteur OU du token selon le contexte
          const id = this.document.id;
          await lootMonsters([id]);
        } catch(e) {
          console.error("[RPG] lootThisMonster:", e);
          ui.notifications?.error?.(`Erreur loot : ${e?.message ?? e}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // ── PV +/- ────────────────────────────────────────
    qsAll("[data-action='hpPlus']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        if (this._btnUpdating) return;
        this._btnUpdating = true;
        try {
          const delta = Number(btn.dataset.delta ?? 0) || 0;
          const cur = Number(foundry.utils.getProperty(this.document, "system.ressources.pv.valeur")) || 0;
          const max = Number(foundry.utils.getProperty(this.document, "system.ressources.pv.max")) || 0;
          const next = Math.max(0, Math.min(max > 0 ? max : 999999, cur + delta));
          if (next !== cur) await this.document.update({ "system.ressources.pv.valeur": next });
        } catch(e) { console.error("[RPG] hpChange:", e); }
        finally { setTimeout(() => { this._btnUpdating = false; }, 300); }
      });
    });

    // ── Item edit ─────────────────────────────────────
    qsAll(".item-edit").forEach(a => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const li = ev.currentTarget.closest(".item");
        const item = this.document.items.get(li?.dataset?.itemId);
        item?.sheet?.render(true);
      });
    });

    // ── UseItem ───────────────────────────────────────
    qsAll("[data-action='useItem']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const item = this.document.items.get(btn.dataset.itemId);
        if (!item) return;
        const targetToken = Array.from(game.user.targets)[0] ?? null;
        if (!targetToken?.actor) return ui.notifications.warn("Cible un PJ/ennemi (T) avant d'utiliser une attaque/sort.");
        const Combat = game.rpg?.combat;
        if (!Combat?.computeTN || !Combat?.damagePreview) return ui.notifications.error("Combat API introuvable.");
        const cd = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
        if (cd > 0) return ui.notifications.warn(`Sort en recharge : ${cd} tour(s).`);
        const rmin = Number(item.system?.range?.min ?? 0) || 0;
        const rmax = Number(item.system?.range?.max ?? item.system?.portee ?? 0) || 0;
        const casterToken = this.document.getActiveTokens()?.[0] ?? null;
        if (canvas?.grid && casterToken) {
          const dist = canvas.grid.measureDistance(casterToken.center, targetToken.center);
          if (dist < rmin || dist > rmax) return ui.notifications.warn(`Hors portée: ${dist.toFixed(1)} cases (min ${rmin}, max ${rmax}).`);
        }
        const tn = Combat.computeTN(this.document, targetToken.actor, item);
        const dmgPrev = Combat.damagePreview(this.document, item);
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.document }),
          content:
            `<b>${this.document.name}</b> utilise <b>${item.name}</b> sur <b>${targetToken.actor.name}</b> (${tn.livraison})<br>` +
            `Seuil toucher: <b>${tn.tnFinal}+</b> (base ${tn.tnBase}+ ; difficulté +${tn.diff})<br>` +
            `Dégâts: <b>${dmgPrev.text}</b>`
        });
      });
    });

    // ── DeclareSpell / castSpell ──────────────────────
    const onDeclare = async (ev) => {
      ev.preventDefault();
      const li = ev.currentTarget.closest("[data-item-id]");
      const itemId = li?.dataset?.itemId || ev.currentTarget.dataset.itemId;
      if (!itemId) return;
      const item = this.document.items.get(itemId);
      if (!item) return;
      const casterToken = this.document.getActiveTokens()?.[0] ?? null;
      const targetToken = Array.from(game.user.targets)[0] ?? null;
      const res = await declareSpell(this.document, item, { casterToken, targetToken });
      if (!res?.ok) ui.notifications.warn(res?.reason ?? "Impossible de déclarer le sort.");
      this.render({ force: false });
    };
    qsAll('[data-action="declareSpell"]').forEach(btn => btn.addEventListener("click", onDeclare));
    qsAll('[data-action="castSpell"]').forEach(btn => btn.addEventListener("click", onDeclare));

    // ── Delete item ───────────────────────────────────
    qsAll('[data-action="deleteItem"]').forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const li = ev.currentTarget.closest(".item");
        const itemId = btn.dataset.itemId || li?.dataset?.itemId;
        if (!itemId) return;
        await this.document.deleteEmbeddedDocuments("Item", [itemId]);
        this.render({ force: false });
      });
    });

    // ── UUID cliquable → ouvre la fiche de l'item ─────────────────────
    qsAll(".rpg-open-uuid").forEach(btn => {
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

    // ── Butin : ajouter / retirer une entrée ──────────────────────────
    qsAll("[data-action='addLootEntry']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const entries = foundry.utils.deepClone(this.document.system?.butin?.entries ?? []);

        // Ouvre un mini-dialogue pour saisir l'UUID
        const uuid = await new Promise(resolve => {
          new Dialog({
            title: "Ajouter un item au butin",
            content: `<div style="padding:4px">
              <label style="font-size:12px">UUID de l'item (clic droit → Copy UUID)</label>
              <input id="loot-uuid" type="text" style="width:100%;margin-top:4px"
                placeholder="Compendium.rpg.items-reference.Item.xxxx" />
            </div>`,
            buttons: {
              ok: {
                label: "Ajouter",
                callback: (html) => resolve(html[0]?.querySelector("#loot-uuid")?.value?.trim())
              },
              cancel: { label: "Annuler", callback: () => resolve(null) }
            },
            default: "ok"
          }).render(true);
        });

        if (!uuid) return;

        // Résout l'item pour récupérer nom + image
        let name = "Item inconnu", img = "icons/svg/item-bag.svg";
        try {
          const doc = await fromUuid(uuid);
          if (doc) { name = doc.name; img = doc.img ?? img; }
          else { ui.notifications?.warn?.("UUID introuvable — ajouté quand même."); }
        } catch(e) { ui.notifications?.warn?.("UUID invalide."); }

        entries.push({ uuid, name, img, pct: 100, qty: 1, tries: 1 });
        await this.document.update({ "system.butin.entries": entries });
        this.render({ force: true });
      });
    });

    qsAll("[data-action='removeLootEntry']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const idx = Number(btn.dataset.idx);
        if (!Number.isFinite(idx)) return;
        const entries = foundry.utils.deepClone(this.document.system?.butin?.entries ?? []);
        entries.splice(idx, 1);
        await this.document.update({ "system.butin.entries": entries });
        this.render({ force: true });
      });
    });

    // ── États ─────────────────────────────────────────
    qsAll("[data-action='stateAdd']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const edited = await this._editStateDialog(this._stateDefaults(), { title: "Ajouter un état" });
        if (!edited) return;
        await this._stateUpsert(edited);
        this.render({ force: false });
      });
    });

    qsAll("[data-action='stateEdit']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const st = this._stateFindById(btn.dataset.id);
        if (!st) return ui.notifications.warn("État introuvable.");
        const edited = await this._editStateDialog(st, { title: "Modifier l'état" });
        if (!edited) return;
        await this._stateUpsert(edited);
        this.render({ force: false });
      });
    });

    qsAll("[data-action='stateDelete']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        await this._stateRemove(btn.dataset.id);
        this.render({ force: false });
      });
    });

    qsAll("[data-action='stateShow']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const st = this._stateFindById(btn.dataset.id);
        if (!st) return;
        const dot = Number(st?.dot?.perTick ?? st?.dot?.flat ?? 0) || 0;
        const lines = [];
        if (dot) lines.push(`DOT: <b>${dot}</b>`);
        const labels = {
          force: "Force", dexterite: "Dextérité", intelligence: "Intelligence", acuite: "Acuité", endurance: "Endurance",
          pvMax: "PV max", manaMax: "Mana max", regenPv: "Régén PV", regenMana: "Régén Mana",
          scoreArmure: "Score Armure", scoreResistance: "Score Résistance", armureFixe: "Armure fixe",
          resistanceFixe: "Résistance fixe", vitesse: "Vitesse"
        };
        for (const [k, v] of Object.entries(st.mods ?? {})) {
          const f = Number(v.flat ?? 0) || 0;
          const p = Number(v.pct ?? 0) || 0;
          const name = labels[k] ?? k;
          if (f) lines.push(`${name}: ${f > 0 ? "+" : ""}${f}`);
          if (p) lines.push(`${name}: ${p > 0 ? "+" : ""}${p}%`);
        }
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.document }),
          content: `<b>${st.label}</b> (${st.remaining} tour(s))<br>${lines.join("<br>") || "<i>Aucun effet</i>"}`
        });
      });
    });

    // ── GM Aura ───────────────────────────────────────
    qsAll('[data-action="gmAura"]').forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const token = this.document.getActiveTokens()?.[0] ?? canvas.tokens.controlled?.[0] ?? null;
        if (!token) return ui.notifications.warn("Sélectionne/affiche un token.");
        new Dialog({
          title: `Aura (MJ) — ${token.name}`,
          content: `<form>
            <div class="form-group"><label>Rayon (cases)</label><input type="number" name="radius" value="3" min="0" step="1"/></div>
            <div class="form-group"><label>Couleur (hex)</label><input type="text" name="color" value="#33aaff"/></div>
            <div class="form-group"><label>Opacité (0 → 1)</label><input type="number" name="alpha" value="0.2" min="0" max="1" step="0.05"/></div>
            <div class="form-group"><label>Mode</label><select name="mode">
              <option value="add">Créer / Mettre à jour</option>
              <option value="remove">Supprimer</option>
            </select></div>
          </form>`,
          buttons: {
            ok: {
              label: "OK",
              callback: async (dlgHtml) => {
                const fd = new FormData(dlgHtml[0].querySelector("form"));
                await game.rpg?.gmAura?.toggle(token, {
                  radius: Number(fd.get("radius")) || 0,
                  color: String(fd.get("color") || "#33aaff").trim(),
                  alpha: Math.max(0, Math.min(1, Number(fd.get("alpha")) || 0.2)),
                  mode: String(fd.get("mode") || "add")
                });
              }
            },
            cancel: { label: "Annuler" }
          },
          default: "ok"
        }).render(true);
      });
    });
  }

  /* -------------------------------------------- */
  /* STATES API                                   */
  /* -------------------------------------------- */

  _statePath() { return "system.etatsActifs"; }

  _stateList() {
    const cur = foundry.utils.getProperty(this.document, this._statePath());
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
    await this.document.update({ [path]: list });
    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.document);
  }

  async _stateRemove(id) {
    const path = this._statePath();
    const list = this._stateList().filter(e => e.id !== id);
    await this.document.update({ [path]: list });
    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.document);
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
