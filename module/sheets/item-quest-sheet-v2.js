// systems/rpg/module/sheets/item-quest-sheet-v2.js
import { applyUiTheme, applySheetViewMode, bindImageEditors } from "./sheet-helpers.js";
import { bindSendToActorsButton, partyCharacters } from "./send-item-dialog.js";
import { setupItemRefDrop } from "./drop-helper.js";
import { ensureDistribGroupId, findDistribCopies } from "../rules/quest-group.js";

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * system.etapes doit toujours être lu comme un vrai Array. Un update() vers
 * un chemin pointé indexé (ex. "system.etapes.0.description") peut laisser
 * Foundry le stocker comme un objet à clés numériques ({0:{...}, 1:{...}})
 * plutôt qu'un Array — Object.values() ici récupère les entrées existantes
 * au lieu de les faire silencieusement disparaître. _onFormSubmitV2 avait
 * déjà cette normalisation pour les données venant du formulaire ; tous les
 * autres points de lecture de system.etapes (actions, _prepareContext, le
 * commit ProseMirror) doivent la partager pour ne pas re-perdre les mêmes
 * données à la prochaine lecture.
 */
function asEtapesArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

export class RPGQuestSheetV2 extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static documentName = "Item";

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      id: "rpg-quest-sheet-v2",
      classes: ["rpg", "rpg-sheet", "sheet", "item", "quest"],
      position: { width: 780, height: 660 },
      window: { contentClasses: ["rpg-sheet-window"] },
      tabs: [
        { navSelector: ".quest-page-nav", contentSelector: ".quest-page-content", initial: "apercu" }
      ],

      /**
       * submitOnChange est VOLONTAIREMENT désactivé (même choix que
       * item-spell-sheet-v2.js, voir son commentaire DEFAULT_OPTIONS.form) :
       * une soumission complète du formulaire à chaque frappe déclenche un
       * re-render — qui, avant même de considérer la course avec les
       * boutons d'action (+Objectif...), pouvait tout simplement retomber
       * sur un formulaire dont un <prose-mirror> ou un <input> venait
       * d'être remplacé sous les doigts de l'utilisateur (rapporté : rien
       * n'était plus sauvegardé du tout, même les paragraphes, à la
       * fermeture/réouverture de la fiche). On enregistre désormais champ
       * par champ, sans re-render — voir _bindLiveSave().
       */
      form: {
        closeOnSubmit: false,
        submitOnChange: false,
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

  /** Pages façon journal : navigation propre (Tabs), pas le tabbing auto de
   *  DocumentSheetV2 — même mécanisme que RPGCharacterSheetV2, voir
   *  _prepareTabs() juste en dessous pour la raison du court-circuit. */
  static TABS = {
    primary: {
      navSelector: ".quest-page-nav",
      contentSelector: ".quest-page-content",
      initial: "apercu"
    }
  };

  /** Empêche DocumentSheetV2 de crasher (tabs undefined -> reduce) */
  _prepareTabs() {
    return [];
  }

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

    // ✅ Le libellé de la barre de titre (fenêtre) n'est pas systématiquement
    // rafraîchi par le rendu "léger" déclenché par document.update({render:true})
    // — seul le contenu des PARTS l'est de façon fiable. Renommer la quête se
    // reflétait donc bien sur le champ <input name="name"> (relu depuis
    // item.name à chaque rendu) mais jamais sur la barre de titre elle-même
    // tant que la fiche n'était pas fermée puis rouverte. this.title est un
    // getter qui lit déjà this.document.name en direct : il suffit de le
    // réappliquer nous-mêmes à chaque rendu. Ciblé par classe CSS plutôt que
    // via l'API this.window (jamais vérifiée en direct dans Foundry — une
    // précédente tentative avec this.window.title a cassé tout le reste de
    // _onRender, y compris le ré-attachement du listener "change" juste en
    // dessous, en plantant ici avant de l'atteindre) et protégé par
    // try/catch pour ne jamais pouvoir interrompre le reste de la méthode.
    try {
      const titleEl = this.element?.querySelector(".window-header .window-title");
      if (titleEl) titleEl.textContent = this.title;
    } catch (e) {
      console.warn("[RPG] Rafraîchissement du titre de fenêtre (quête) :", e);
    }

    applyUiTheme(this.element);
    applySheetViewMode(this.element, { isGM: game.user.isGM });
    bindImageEditors(this.element, this.document);
    bindSendToActorsButton(this.element, this.document);

    const root = this.element;
    if (!root) return;

    // ── Pages façon journal : liste à gauche, contenu de la page active à
    // droite. Un vrai re-render (via changeTab de DocumentSheetV2) perdrait
    // l'état d'édition ProseMirror en cours — on utilise donc la même
    // instance de Tabs bindée en DOM que RPGCharacterSheetV2, recréée une
    // seule fois et re-bindée à chaque render pour survivre aux
    // submitOnChange (elle garde sa page active en mémoire toute seule).
    if (!this._tabs) {
      this._tabs = new foundry.applications.ux.Tabs({
        navSelector: ".quest-page-nav",
        contentSelector: ".quest-page-content",
        initial: "apercu"
      });
    }
    this._tabs.bind(root);
    if (this._pendingTab) {
      this._tabs.activate(this._pendingTab);
      this._pendingTab = null;
    }

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

    this._bindLiveSave(root);
  }

  /**
   * Enregistre chaque champ individuellement dès qu'il change, sans jamais
   * re-render (même principe que item-spell-sheet-v2.js#_bindLiveSave) —
   * PAS de sérialisation du formulaire entier via FormDataExtended : un
   * champ édité déclenche une seule écriture ciblée sur SON chemin pointé
   * (ex. "system.etapes.0.label"), que Foundry applique très bien même à
   * l'intérieur d'un tableau existant. Ça élimine d'un coup :
   *  - le risque qu'un re-render en cours de frappe remplace le DOM sous
   *    les doigts de l'utilisateur et fasse "disparaître" ce qu'il tape ;
   *  - la course entre la sauvegarde d'un champ et un bouton d'action
   *    (+Objectif, +Étape...) qui lisait auparavant this.document AVANT
   *    que la sauvegarde en cours n'ait fini d'appliquer sa valeur —
   *    chaque action attend maintenant explicitement _lastFieldSave (voir
   *    _awaitPendingFieldSave) avant de relire this.document.
   * <prose-mirror> est un élément form-associated (ElementInternals) qui
   * expose son contenu courant via sa propriété .value et déclenche un
   * évènement "change" comme n'importe quel champ natif — écouté ici au
   * même titre que les <input>/<select>/<textarea>, plus l'évènement
   * "save" spécifique à cet élément en filet de sécurité.
   */
  _bindLiveSave(root) {
    if (root.dataset.rpgLiveSave) return;
    root.dataset.rpgLiveSave = "1";

    const commit = async (path, val, fieldLabel) => {
      try {
        this._lastFieldSave = this.document.update({ [path]: val }, { render: false });
        await this._lastFieldSave;
      } catch (e) {
        console.error("[RPG] Enregistrement fiche Quête :", e, "| champ :", fieldLabel);
        ui.notifications?.error?.("Impossible d'enregistrer ce champ — voir la console (F12).");
      }
    };

    const persist = async (el) => {
      if (!(game.user.isGM || this.isEditable)) return;
      const name = el.getAttribute?.("name");
      if (!name) return;

      let value;
      if (el.tagName === "PROSE-MIRROR") value = el.value ?? "";
      else if (el.type === "checkbox") value = el.checked;
      else if (el.type === "number") value = el.value === "" ? null : Number(el.value);
      else value = el.value ?? "";

      // system.etapes.{i}.objectifs.{j}.(text|fait) est un DEUXIÈME niveau
      // de tableau imbriqué (etapes[i].objectifs[j], contre un seul niveau
      // pour system.etapes.{i}.label qui, lui, persiste correctement) —
      // Foundry ne fusionne pas ce chemin pointé proprement à cette
      // profondeur : chaque frappe réduisait le tableau objectifs de
      // l'étape aux seuls index explicitement écrits, supprimant les
      // autres objectifs déjà remplis en silence. Symptôme : "+Objectif
      // efface les objectifs déjà renseignés" persistait même après avoir
      // éliminé la course de lecture (_awaitPendingFieldSave) — le bug
      // était dans l'ÉCRITURE elle-même, pas dans l'ordre lecture/écriture.
      // Fixé en remontant d'un cran : on réécrit l'étape ENTIÈRE
      // (system.etapes.{i}, un objet complet) — structurellement
      // identique au cas label, qui fonctionne déjà.
      const objMatch = name.match(/^system\.etapes\.(\d+)\.objectifs\.(\d+)\.(text|fait)$/);
      if (objMatch) {
        const [, eIdx, oIdx, field] = objMatch;
        const etapes = foundry.utils.deepClone(asEtapesArray(this.document.system?.etapes));
        const etape = etapes[Number(eIdx)];
        if (!etape) return;
        etape.objectifs = asEtapesArray(etape.objectifs);
        if (!etape.objectifs[Number(oIdx)]) return;
        etape.objectifs[Number(oIdx)][field] = value;
        await commit(`system.etapes.${eIdx}`, etape, name);
        return;
      }

      await commit(name, value, name);
    };

    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!el?.matches?.("input, select, textarea, prose-mirror")) return;
      persist(el);
    });
    // Filet de sécurité : si <prose-mirror> ne déclenche pas "change" dans
    // cette version de Foundry, son propre évènement "save" (émis quand
    // l'éditeur commit son contenu) prend le relais.
    root.addEventListener("save", (ev) => {
      const el = ev.target;
      if (el?.tagName !== "PROSE-MIRROR") return;
      persist(el);
    });
  }

  /**
   * À appeler avant qu'une action (+Objectif, +Étape, ✕...) ne lise
   * this.document : attend que la dernière sauvegarde de champ démarrée
   * par _bindLiveSave soit bien appliquée, pour ne jamais lire une copie
   * de this.document plus ancienne que ce qui est affiché à l'écran (voir
   * _bindLiveSave plus haut).
   */
  async _awaitPendingFieldSave() {
    if (!this._lastFieldSave) return;
    try { await this._lastFieldSave; } catch { /* déjà loggé dans _bindLiveSave */ }
  }

  /** Ajoute une entrée de récompense à partir d'un Item glissé-déposé. */
  async _addRewardItemFromDrop(item) {
    if (!game.user.isGM || !item?.uuid) return;
    await this._awaitPendingFieldSave();
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.push({ uuid: item.uuid, qty: 1 });
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const item = this.document;
    // Même repli défensif que drop-helper.js pour TextEditor : .implementation
    // porte l'API V13, avec le global comme filet si jamais absent.
    const TextEditorImpl = foundry.applications.ux.TextEditor?.implementation ?? foundry.applications.ux.TextEditor;

    ctx.item = item;
    ctx.system = foundry.utils.deepClone(item.system ?? {});
    ctx.system.etapes = asEtapesArray(ctx.system.etapes);
    // Récit et notes MJ passent par enrichHTML pour que @UUID[...] (PNJ,
    // objet, scène glissé dans l'éditeur) devienne un lien cliquable —
    // value= (source brute) alimente l'éditeur ProseMirror en mode édition,
    // le HTML enrichi ci-dessous alimente l'affichage lecture seule/joueur.
    ctx.system.etapes = await Promise.all(ctx.system.etapes.map(async (e, i) => {
      const description = e?.description ?? "";
      const notesMJ = e?.notesMJ ?? "";
      return {
        label: e?.label ?? "",
        // Titre de secours pour la liste de pages seulement — ne remplace
        // jamais la vraie valeur (vide) de l'input éditable.
        navLabel: (e?.label ?? "").trim() || `Étape ${i + 1}`,
        description,
        descriptionHTML: await TextEditorImpl.enrichHTML(description, { secrets: game.user.isGM, relativeTo: item }),
        notesMJ,
        notesMJHTML: await TextEditorImpl.enrichHTML(notesMJ, { secrets: true, relativeTo: item }),
        objectifs: Array.isArray(e?.objectifs) ? e.objectifs : [],
        etapeNum: i + 1
      };
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
    ctx.descriptionHTML = await TextEditorImpl.enrichHTML(ctx.system.description, { secrets: game.user.isGM, relativeTo: item });

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
          ? { label: e.label, navLabel: e.navLabel, description: e.description, descriptionHTML: e.descriptionHTML, objectifs: e.objectifs, etapeNum: e.etapeNum }
          : { label: e.label, navLabel: e.navLabel, etapeNum: e.etapeNum, termine: true });
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
    await this._awaitPendingFieldSave();
    const list = foundry.utils.deepClone(asEtapesArray(this.document.system?.etapes));
    list.push({ label: "", description: "", notesMJ: "", objectifs: [] });
    // Amène directement le MJ sur la page de la nouvelle étape plutôt que
    // de le laisser sur "Aperçu" en devinant où elle a atterri.
    this._pendingTab = `etape-${list.length - 1}`;
    await this.document.update({ "system.etapes": list }, { render: true });
  }

  async _actionRemoveEtape(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-etape-idx]")?.dataset?.etapeIdx);
    if (!Number.isFinite(idx)) return;
    await this._awaitPendingFieldSave();
    const oldEtapes = asEtapesArray(this.document.system?.etapes);
    const list = foundry.utils.deepClone(oldEtapes);
    list.splice(idx, 1);

    let etapeActuelle = Number(this.document.system?.etapeActuelle ?? 0) || 0;
    // Si la quête était déjà "toutes étapes terminées" (etapeActuelle au
    // cran sentinelle oldEtapes.length), elle doit le rester après retrait
    // d'une étape — pas retomber sur la dernière étape restante comme "en
    // cours".
    const wasComplete = etapeActuelle >= oldEtapes.length;
    etapeActuelle = wasComplete ? list.length : Math.min(etapeActuelle, Math.max(0, list.length - 1));

    // La page retirée n'existe plus : retour à "Aperçu" plutôt que de
    // laisser Tabs pointer vers un data-tab qui n'a plus de panneau.
    this._pendingTab = "apercu";
    await this.document.update({ "system.etapes": list, "system.etapeActuelle": etapeActuelle }, { render: true });
  }

  async _actionShiftEtape(event, delta) {
    event?.preventDefault?.();
    const etapes = asEtapesArray(this.document.system?.etapes);
    if (!etapes.length) return;
    let etapeActuelle = Number(this.document.system?.etapeActuelle ?? 0) || 0;
    // Le maximum est etapes.length (pas etapes.length - 1) : "Étape suivante"
    // depuis la dernière étape la marque terminée au lieu de rester bloquée
    // dessus indéfiniment (voir la note dans _prepareContext).
    etapeActuelle = Math.max(0, Math.min(etapes.length, etapeActuelle + delta));
    this._pendingTab = etapeActuelle < etapes.length ? `etape-${etapeActuelle}` : "apercu";
    await this.document.update({ "system.etapeActuelle": etapeActuelle }, { render: true });
  }

  async _actionAddObjectif(event) {
    event?.preventDefault?.();
    const etapeIdx = Number(event?.target?.closest("[data-etape-idx]")?.dataset?.etapeIdx);
    if (!Number.isFinite(etapeIdx)) return;
    await this._awaitPendingFieldSave();
    const list = foundry.utils.deepClone(asEtapesArray(this.document.system?.etapes));
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
    await this._awaitPendingFieldSave();
    const list = foundry.utils.deepClone(asEtapesArray(this.document.system?.etapes));
    if (!list[etapeIdx]?.objectifs) return;
    list[etapeIdx].objectifs.splice(objIdx, 1);
    await this.document.update({ "system.etapes": list }, { render: true });
  }

  async _actionAddRewardItem(event) {
    event?.preventDefault?.();
    await this._awaitPendingFieldSave();
    const list = foundry.utils.deepClone(this.document.system?.recompense?.items ?? []);
    list.push({ uuid: "", qty: 1 });
    await this.document.update({ "system.recompense.items": list }, { render: true });
  }

  async _actionRemoveRewardItem(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest("[data-idx]")?.dataset?.idx);
    if (!Number.isFinite(idx)) return;
    await this._awaitPendingFieldSave();
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
