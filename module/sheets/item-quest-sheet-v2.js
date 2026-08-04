// systems/rpg/module/sheets/item-quest-sheet-v2.js
import { applyUiTheme, bindImageEditors } from "./sheet-helpers.js";
import { bindSendToActorsButton, partyCharacters } from "./send-item-dialog.js";
import { setupItemRefDrop } from "./drop-helper.js";
import { ensureDistribGroupId, findDistribCopies } from "../rules/quest-group.js";

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RPGQuestSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-quest-sheet-v2",
      classes: ["rpg", "rpg-sheet", "sheet", "item", "quest"],
      position: { width: 520, height: 700 },
      window: { contentClasses: ["rpg-sheet-window"] },

      form: {
        closeOnSubmit: false,
        submitOnChange: true,
        handler: async function (event, form, formData, options) {
          await this._onFormSubmitV2(event, form, formData, options);
        }
      },

      actions: {
        addEtape:         async function (event) { await this._actionAddEtape(event); },
        removeEtape:      async function (event) { await this._actionRemoveEtape(event); },
        prevEtape:        async function (event) { await this._actionShiftEtape(event, -1); },
        nextEtape:        async function (event) { await this._actionShiftEtape(event, 1); },
        addObjectif:      async function (event) { await this._actionAddObjectif(event); },
        removeObjectif:   async function (event) { await this._actionRemoveObjectif(event); },
        addRewardItem:    async function (event) { await this._actionAddRewardItem(event); },
        removeRewardItem: async function (event) { await this._actionRemoveRewardItem(event); }
      }
    },
    { inplace: false }
  );

  static PARTS = foundry.utils.mergeObject(
    super.PARTS ?? {},
    {
      form: {
        id: "form",
        template: "systems/rpg/templates/item/item-quest-sheet.hbs",
        scrollable: [".sheet-body"]
      }
    },
    { inplace: false }
  );

  get isEditable() {
    return game.user.isGM;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    applyUiTheme(this.element);
    bindImageEditors(this.element, this.document);
    bindSendToActorsButton(this.element, this.document);

    const root = this.element;
    if (!root) return;

    // ── UUID cliquable (récompense) → ouvre la fiche de l'objet ──────────
    root.querySelectorAll(".rpg-open-uuid").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const uuid = btn.dataset.uuid;
        if (!uuid) return;
        try {
          const doc = await fromUuid(uuid);
          if (doc?.sheet) doc.sheet.render(true);
          else ui.notifications?.warn?.("Objet introuvable pour cet UUID.");
        } catch (e) {
          ui.notifications?.error?.(`UUID invalide : ${uuid}`);
        }
      });
    });

    // ── Glisser un objet (compendium, inventaire, barre d'items) → l'ajoute
    // en récompense, sans avoir à taper l'UUID à la main (même mécanisme que
    // le butin d'un monstre, voir drop-helper.js).
    if (game.user.isGM) {
      setupItemRefDrop(this, root, (item) => this._addRewardItemFromDrop(item));
    }

    // ── Destinataires : coche/décoche un PJ → donne/retire sa copie ────────
    root.querySelectorAll(".quest-recipient-check").forEach(input => {
      input.addEventListener("change", (ev) => this._toggleRecipient(ev.target));
    });
  }

  /** Ajoute une entrée de récompense à partir d'un Item glissé-déposé. */
  async _addRewardItemFromDrop(item) {
    if (!game.user.isGM || !item?.uuid) return;
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.push({ uuid: item.uuid, qty: 1 });
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const item = this.document;

    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});
    ctx.system.etapes = Array.isArray(ctx.system.etapes) ? ctx.system.etapes : [];
    ctx.system.etapes = ctx.system.etapes.map((e, i) => ({
      label: e?.label ?? "",
      description: e?.description ?? "",
      notesMJ: e?.notesMJ ?? "",
      objectifs: Array.isArray(e?.objectifs) ? e.objectifs : [],
      etapeNum: i + 1
    }));
    // etapeActuelle peut valoir etapes.length (un cran au-delà de la
    // dernière étape réelle) : c'est l'état "toutes les étapes terminées",
    // sinon la dernière étape ne pouvait jamais passer "terminée" — rien
    // dans l'ancien clamp (max etapes.length-1) ne permettait de la
    // dépasser via "Étape suivante".
    ctx.system.etapeActuelle = Math.max(0, Math.min(
      Number(ctx.system.etapeActuelle ?? 0) || 0,
      ctx.system.etapes.length
    ));
    ctx.system.recompense = ctx.system.recompense ?? { xp: 0, items: [] };
    ctx.system.recompense.items = Array.isArray(ctx.system.recompense.items) ? ctx.system.recompense.items : [];

    // Nom et image toujours résolus depuis l'objet lui-même (jamais un
    // instantané figé) : si le MJ renomme l'objet, la récompense suit sans
    // qu'il ait besoin de retoucher la quête — même logique que le butin
    // d'un monstre (monster-sheet-v2.js).
    if (game.user.isGM && ctx.system.recompense.items.length) {
      ctx.system.recompense.items = await Promise.all(ctx.system.recompense.items.map(async (ri) => {
        let name = "Objet introuvable", img = "icons/svg/item-bag.svg";
        const uuid = String(ri?.uuid ?? "").trim();
        if (uuid) {
          try {
            const doc = await fromUuid(uuid);
            if (doc) { name = doc.name; img = doc.img ?? img; }
          } catch { /* uuid invalide */ }
        }
        return { uuid, name, img, qty: Math.max(1, Number(ri?.qty ?? 1) || 1) };
      }));
    }

    ctx.system.statut = String(ctx.system.statut ?? "active");
    ctx.system.description = String(ctx.system.description ?? "");

    ctx.calc = {
      etapeActuelleNum: ctx.system.etapes.length ? ctx.system.etapeActuelle + 1 : 0,
      totalEtapes: ctx.system.etapes.length,
      complete: ctx.system.etapes.length > 0 && ctx.system.etapeActuelle >= ctx.system.etapes.length
    };

    // MJ peut toujours éditer, joueur uniquement s'il possède l'objet
    ctx.canEdit = game.user.isGM || this.isEditable;
    ctx.isGM = game.user.isGM;

    // ── Destinataires : quels PJ voient cette quête ─────────────────────────
    // Un PJ ne voit une quête que s'il en a sa PROPRE copie embarquée (voir
    // note d'architecture en tête de fichier) — il n'y a pas de "permission"
    // à cocher sur l'objet source lui-même. Cette liste rend ça visible et
    // modifiable directement depuis la fiche, au lieu du seul bouton
    // "Envoyer" (un aller simple, sans retour possible sur qui l'a déjà).
    if (ctx.isGM) {
      const distribId = String(item.system?.distribGroupId ?? "").trim();
      const copies = distribId ? findDistribCopies(distribId, item.uuid) : [];
      const actorIdsWithCopy = new Set(copies.map(c => c.actor?.id).filter(Boolean));
      // L'item lui-même, s'il est embarqué sur un PJ, compte comme sa propre copie.
      if (item.actor?.type === "character") actorIdsWithCopy.add(item.actor.id);

      ctx.recipients = partyCharacters().map(a => ({
        id: a.id,
        name: a.name,
        hasCopy: actorIdsWithCopy.has(a.id)
      }));
    }

    // ── Vue joueur : n'expose ni les étapes à venir, ni les notes MJ ────────
    // (PNJ, lieux, récompenses de mise en scène...), ni la note de casting
    // interne. Le joueur ne doit voir que l'étape en cours en détail, et les
    // étapes passées en titre seul — jamais ce qui n'est pas encore arrivé.
    if (!ctx.isGM) {
      const cur = ctx.system.etapeActuelle;
      ctx.system.etapes = ctx.system.etapes
        .filter((e, i) => i <= cur)
        .map((e, i) => i === cur
          ? { label: e.label, description: e.description, objectifs: e.objectifs, etapeNum: e.etapeNum }
          : { label: e.label, etapeNum: e.etapeNum, termine: true });
      ctx.system.classeRequise = "";
      ctx.system.recompense = { xp: 0, items: [] };
    }
    return ctx;
  }

  async _onFormSubmitV2(event, form, formData, options) {
    const expanded = foundry.utils.expandObject(formData.object);

    const etRaw = expanded?.system?.etapes;
    if (etRaw && !Array.isArray(etRaw)) expanded.system.etapes = Object.values(etRaw);
    if (Array.isArray(expanded?.system?.etapes)) {
      for (const e of expanded.system.etapes) {
        if (!e) continue;
        e.label = String(e.label ?? "").trim();
        e.description = String(e.description ?? "");
        e.notesMJ = String(e.notesMJ ?? "");
        const objRaw = e.objectifs;
        if (objRaw && !Array.isArray(objRaw)) e.objectifs = Object.values(objRaw);
        if (Array.isArray(e.objectifs)) {
          for (const o of e.objectifs) {
            if (o) { o.text = String(o.text ?? "").trim(); o.fait = !!o.fait; }
          }
        }
      }
    }

    // Nom/image ne sont jamais stockés (résolus en direct depuis l'objet à
    // chaque rendu, voir _prepareContext) — seuls uuid et qty sont persistés.
    const riRaw = expanded?.system?.recompense?.items;
    if (riRaw && !Array.isArray(riRaw)) expanded.system.recompense.items = Object.values(riRaw);
    if (Array.isArray(expanded?.system?.recompense?.items)) {
      expanded.system.recompense.items = expanded.system.recompense.items.map(ri => ri && {
        uuid: String(ri.uuid ?? "").trim(),
        qty:  Math.max(1, Number(ri.qty ?? 1) || 1)
      });
    }

    await this.document.update(expanded, { render: true });
  }

  async _actionAddEtape(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.etapes ?? []);
    list.push({ label: "", description: "", notesMJ: "", objectifs: [] });
    await this.document.update({ "system.etapes": list }, { render: true });
  }

  async _actionRemoveEtape(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-etape-idx]")?.dataset?.etapeIdx);
    if (!Number.isFinite(idx)) return;
    const oldEtapes = this.document.system?.etapes ?? [];
    const list = foundry.utils.deepClone(oldEtapes);
    list.splice(idx, 1);

    let etapeActuelle = Number(this.document.system?.etapeActuelle ?? 0) || 0;
    // Si la quête était déjà "toutes étapes terminées" (etapeActuelle au
    // cran sentinelle oldEtapes.length), elle doit le rester après retrait
    // d'une étape — pas retomber sur la dernière étape restante comme "en
    // cours".
    const wasComplete = etapeActuelle >= oldEtapes.length;
    etapeActuelle = wasComplete ? list.length : Math.min(etapeActuelle, Math.max(0, list.length - 1));

    await this.document.update({ "system.etapes": list, "system.etapeActuelle": etapeActuelle }, { render: true });
  }

  async _actionShiftEtape(event, delta) {
    event?.preventDefault?.();
    const etapes = this.document.system?.etapes ?? [];
    if (!etapes.length) return;
    let etapeActuelle = Number(this.document.system?.etapeActuelle ?? 0) || 0;
    // Le maximum est etapes.length (pas etapes.length - 1) : "Étape suivante"
    // depuis la dernière étape la marque terminée au lieu de rester bloquée
    // dessus indéfiniment (voir la note dans _prepareContext).
    etapeActuelle = Math.max(0, Math.min(etapes.length, etapeActuelle + delta));
    await this.document.update({ "system.etapeActuelle": etapeActuelle }, { render: true });
  }

  async _actionAddObjectif(event) {
    event?.preventDefault?.();
    const etapeIdx = Number(event?.target?.closest("[data-etape-idx]")?.dataset?.etapeIdx);
    if (!Number.isFinite(etapeIdx)) return;
    const list = foundry.utils.deepClone(this.document.system?.etapes ?? []);
    if (!list[etapeIdx]) return;
    list[etapeIdx].objectifs = Array.isArray(list[etapeIdx].objectifs) ? list[etapeIdx].objectifs : [];
    list[etapeIdx].objectifs.push({ text: "", fait: false });
    await this.document.update({ "system.etapes": list }, { render: true });
  }

  async _actionRemoveObjectif(event) {
    event?.preventDefault?.();
    const btn = event?.target?.closest("[data-obj-idx]");
    const etapeIdx = Number(btn?.dataset?.etapeIdx);
    const objIdx   = Number(btn?.dataset?.objIdx);
    if (!Number.isFinite(etapeIdx) || !Number.isFinite(objIdx)) return;
    const list = foundry.utils.deepClone(this.document.system?.etapes ?? []);
    if (!list[etapeIdx]?.objectifs) return;
    list[etapeIdx].objectifs.splice(objIdx, 1);
    await this.document.update({ "system.etapes": list }, { render: true });
  }

  async _actionAddRewardItem(event) {
    event?.preventDefault?.();
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.push({ uuid: "", qty: 1 });
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }

  async _actionRemoveRewardItem(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.splice(idx, 1);
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }

  /**
   * Coche/décoche un PJ dans la liste des destinataires : donne ou retire
   * SA COPIE de la quête. C'est cette copie embarquée — pas une permission
   * sur l'objet source — qui détermine s'il la voit (voir _prepareContext).
   */
  async _toggleRecipient(input) {
    if (!game.user.isGM) return;
    const actorId = input?.dataset?.actorId;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (!actor) return;

    const item = this.document;
    const checked = !!input.checked;

    try {
      if (checked) {
        const distribId = await ensureDistribGroupId(item);
        const already = actor.items.find(i => i.type === "quest"
          && String(i.system?.distribGroupId ?? "").trim() === distribId);
        if (already) return;

        const baseData = item.toObject();
        delete baseData._id;
        baseData.system = baseData.system ?? {};
        baseData.system.distribGroupId = distribId;
        await actor.createEmbeddedDocuments("Item", [baseData]);
        ui.notifications?.info?.(`« ${item.name} » envoyé à ${actor.name}.`);
      } else {
        const distribId = String(item.system?.distribGroupId ?? "").trim();
        const copy = distribId
          ? actor.items.find(i => i.type === "quest"
              && String(i.system?.distribGroupId ?? "").trim() === distribId)
          : null;
        if (!copy) return;
        await copy.delete();
        ui.notifications?.info?.(`« ${item.name} » retiré de ${actor.name}.`);
      }
    } catch (e) {
      console.error("[RPG] Bascule destinataire de quête :", e);
      ui.notifications?.error?.("Erreur — voir la console.");
      input.checked = !checked; // annule visuellement l'action ratée
      return;
    }
    this.render();
  }
}
