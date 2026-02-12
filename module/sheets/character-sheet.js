function xpPalierForLevel(level) {
  const n = Math.max(1, Number(level) || 1);
  const x = n - 1;
  return Math.round(100 + 40 * x + 15 * x * x);
}

async function setEquipped(actor, itemId, equipped) {
  const item = actor.items.get(itemId);
  if (!item) return;
  await item.update({ "system.equipe": !!equipped });
}

function skillXpToNext(currentLevel) {
  // L0->1:100, L1->2:150, L2->3:200...
  return 100 + 50 * Math.max(0, Number(currentLevel) || 0);
}

function skillsTotalLevels(skills) {
  if (!skills) return 0;
  return Object.values(skills).reduce((a, s) => a + (Number(s?.level) || 0), 0);
}

function skillsLevelCap(actor) {
  const lvl = Number(actor.system?.niveau || 1);
  return 10 + 2 * lvl;
}

async function addXpToSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  const add = Number(amount) || 0;
  if (!add) return;

  s.xp = Math.max(0, (Number(s.xp) || 0) + add);

  // cap global
  const cap = skillsLevelCap(actor);

  while (true) {
    const total = skillsTotalLevels(skills);
    if (total >= cap) break;

    const lvl = Number(s.level) || 0;
    const need = skillXpToNext(lvl);
    if (s.xp < need) break;

    s.xp -= need;
    s.level = lvl + 1;
  }

  skills[skillKey] = s;

  await actor.update({ "system.skills": skills });

  // force recalcul
  if (actor.sheet) actor.sheet.render(false);
}

async function removeXpFromSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  let sub = Math.abs(Number(amount) || 0);
  if (!sub) return;

  // on retire l'xp du niveau actuel, si ça passe sous 0 on "délevel"
  while (sub > 0) {
    const curXp = Number(s.xp) || 0;

    if (curXp >= sub) {
      s.xp = curXp - sub;
      sub = 0;
      break;
    }

    // il faut emprunter sur un niveau précédent
    sub -= curXp;
    s.xp = 0;

    const lvl = Number(s.level) || 0;
    if (lvl <= 0) {
      // déjà au niveau 0, on ne peut pas aller plus bas
      sub = 0;
      break;
    }

    // redescend d'un niveau et remet l'xp "full" du palier précédent
    s.level = lvl - 1;
    s.xp = skillXpToNext(s.level) - 1; // ex: 149/150
  }

  skills[skillKey] = s;
  await actor.update({ "system.skills": skills });
  if (actor.sheet) actor.sheet.render(false);
}


export class RPGCharacterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["rpg-sheet", "sheet", "actor"],
      template: "systems/rpg/templates/actor/character-sheet.hbs",
      width: 980,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  async getData(options) {
    const data = await super.getData(options);

    // Items -> catégories + calcul pods (affichage)
    const items = this.actor.items.map(i => i.toObject());
    const categorized = this._categorizeItems(items);
    const charge = this._calcCharge(categorized);

    const isGM = game.user.isGM;
    const isOwner = this.actor.isOwner;

    data.items = categorized;
    data.charge = charge;
    data.equipSlots = this._buildEquipSlotsUI(items);
    data.flags = {
      isGM,
      isOwner,
      limitedView: !isGM && !isOwner,
      readOnly: !isGM
    };
    data.statusEffects = this.actor.system?.etatsActifs ?? [];

    // XP display
    const lvl = Number(this.actor.system?.niveau) || 1;
    const xpValeur = Math.max(0, Number(this.actor.system?.xp?.valeur) || 0);
    const xpPalier = xpPalierForLevel(lvl);
    const xpPct = xpPalier > 0 ? Math.min(100, Math.round((xpValeur / xpPalier) * 100)) : 0;

    data.calc = {
      xpValeur,
      xpPalier,
      xpPct
    };

    data.system = data.actor.system;
    data.system.etatsInit = Array.isArray(data.system.etatsInit) ? data.system.etatsInit : [];
    data.system.etatsActifs = Array.isArray(data.system.etatsActifs) ? data.system.etatsActifs : [];
    data.system.skills = data.system.skills ?? {};

    // transforme l'objet skills en tableau pratique pour Handlebars
    data.skills = Object.entries(data.system.skills).map(([key, s]) => {
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

    // cap affichage
    data.calc = data.calc ?? {};
    data.calc.skillsTotal = skillsTotalLevels(data.system.skills);
    data.calc.skillsCap = skillsLevelCap(this.actor);

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
        const pct = Number(v?.pct ?? 0) || 0;

        if (flat) parts.push(`${labelMap[k] ?? k} ${flat > 0 ? "+" : ""}${flat}`);
        if (pct) parts.push(`${labelMap[k] ?? k} ${pct > 0 ? "+" : ""}${pct}%`);
      }

      // Petit tag “bénéfique”
      // (on considère bénéfique si au moins un bonus >0 et aucun malus, sinon neutre/malus)
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

    // Debounce (évite spam d'updates)
    this._debouncedPodsUpdate = this._debouncedPodsUpdate
      ?? foundry.utils.debounce(() => this._updatePodsToActor(), 150);

    html.find(".item-edit").on("click", ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      item?.sheet?.render(true);
    });

    html.find("[data-action='createItem']").on("click", async ev => {
      const type = ev.currentTarget.dataset.type;
      await this._createItem(type);
      this._debouncedPodsUpdate();
    });

    html.find("[data-action='deleteItem']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      if (!li?.dataset?.itemId) return;
      await this.actor.deleteEmbeddedDocuments("Item", [li.dataset.itemId]);
      this._debouncedPodsUpdate();
    });

    html.find("[data-action='toggleEquip']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      if (!item) return;

      const equipe = !!item.system.equipe;
      const type = item.type;
      const slot = item.system?.emplacement; // ex: "torse", "mainDroite"...

      // Liste des slots "mains armes"
      const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);

      // Helper: déséquiper une liste d'items
      const unequipItems = async (items) => {
        if (!items.length) return;
        await this.actor.updateEmbeddedDocuments("Item",
          items.map(it => ({ _id: it.id, "system.equipe": false }))
        );
      };

      // Si on déséquipe, simple
      if (equipe) {
        await item.update({ "system.equipe": false });
        return;
      }

      // Sinon on équipe : on doit gérer les conflits
      const equipped = this.actor.items.filter(i => i.system?.equipe);

      // 1) CAS ARME
      if (type === "weapon") {
        const twoHands = !!item.system?.twoHands;

        if (!HAND_SLOTS.has(slot)) {
          return ui.notifications.warn("Une arme doit avoir emplacement mainDroite ou mainGauche.");
        }

        // Conflits = tout ce qui occupe les mains (peu importe le type)
        const equippedInHands = equipped.filter(i => HAND_SLOTS.has(i.system?.emplacement));

        if (twoHands) {
          // Arme 2 mains : libère TOUTES les mains
          await unequipItems(equippedInHands);
          await item.update({ "system.equipe": true });
          return;
        } else {
          // Arme 1 main : si une arme 2 mains est équipée -> la retirer
          const equippedTwoHands = equipped.filter(i => i.type === "weapon" && i.system?.equipe && i.system?.twoHands);
          await unequipItems(equippedTwoHands);

          // Retire ce qui est déjà sur LE MÊME slot (mainDroite ou mainGauche)
          const sameSlot = equipped.filter(i => i.system?.emplacement === slot);
          await unequipItems(sameSlot);

          await item.update({ "system.equipe": true });
          return;
        }
      }

      // 2) CAS ARMURE / AUTRES ÉQUIPEMENTS (1 seul par slot)
      if (!slot) {
        return ui.notifications.warn("Cet objet n'a pas d'emplacement défini (system.emplacement).");
      }

      // Retire tout item déjà équipé sur le même slot
      const conflicts = equipped.filter(i => i.id !== item.id && i.system?.emplacement === slot);
      await unequipItems(conflicts);

      await item.update({ "system.equipe": true });
    });

    // Équipement via select de slot (sans bouton)
    html.find("select[data-action='equipSlotSelect']").on("change", async (ev) => {
      ev.preventDefault();
      if (!this.actor.isOwner) return;

      const slot = ev.currentTarget.dataset.slot;
      const itemId = ev.currentTarget.value || ""; // "" = Aucun

      await this._onEquipSlotChange(slot, itemId);

      this._debouncedPodsUpdate();
      this.render(false);
    });

    // Champ "stat-total" : l'utilisateur édite le TOTAL (final)
    // => on recalc la base: base = total - bonus
    html.find(".stat-total").on("change", async (ev) => {
      if (!game.user.isGM) return;

      const stat = ev.currentTarget.dataset.stat; // force, intelligence...
      const totalWanted = Number(ev.currentTarget.value ?? 0) || 0;

      const bonus = Number(this.actor.system?.derived?.bonus?.principales?.[stat] ?? 0) || 0;
      const newBase = totalWanted - bonus;

      await this.actor.update({ [`system.principales.${stat}`]: newBase });
    });

    // Scores défense : l'utilisateur édite le TOTAL (final)
    // => base = total - bonusItem - contributionEndurance
    html.find(".def-total").on("change", async (ev) => {
      if (!game.user.isGM) return;

      const key = ev.currentTarget.dataset.def; // scoreArmure | scoreResistance
      const totalWanted = Number(ev.currentTarget.value ?? 0) || 0;

      const baseCur = Number(this.actor.system?.defenses?.[key] ?? 0) || 0;
      const bonusItem = Number(this.actor.system?.derived?.bonus?.defenses?.[key] ?? 0) || 0;

      const effCur = Number(this.actor.system?.derived?.effective?.defenses?.[key] ?? 0) || 0;
      const contribEnd = effCur - (baseCur + bonusItem); // ce qui vient de l'endurance

      const newBase = totalWanted - bonusItem - contribEnd;

      await this.actor.update({ [`system.defenses.${key}`]: newBase });
    });

    html.find("[data-action='equipFromSlot']").on("click", async (ev) => {
      ev.preventDefault();

      if (!this.actor.isOwner) return;

      const slot = ev.currentTarget.dataset.slot; // ex "mainDroite"
      const container = ev.currentTarget.closest("[data-slot]");
      const select = container?.querySelector("select[data-field='equipChoice']");
      const itemId = select?.value;

      if (!itemId) return ui.notifications.warn("Choisis un objet à équiper.");
      const item = this.actor.items.get(itemId);
      if (!item) return;

      // Pour les armes : on force la main choisie (sauf 2 mains -> mainDroite)
      if (item.type === "weapon") {
        const twoHands = !!item.system?.twoHands;
        const targetSlot = twoHands ? "mainDroite" : slot;

        // mets à jour l’emplacement puis équipe (ton toggleEquip gère les conflits)
        await item.update({ "system.emplacement": targetSlot });
      }

      // Utilise ta logique existante (toggleEquip) : on déclenche l’équipement
      const isEquipped = !!item.system?.equipe;
      if (!isEquipped) {
        await this._equipWithConflicts(item); // fonction ajoutée juste après
      }

      this.render(false);
    });

    // Qty / Poids change -> update item -> pods auto
    html.find("input[data-field]").on("change", async ev => {
      const input = ev.currentTarget;
      const li = input.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      if (!item) return;

      const field = input.dataset.field;
      const value = Number(input.value ?? 0);
      await item.update({ [field]: value });

      this._debouncedPodsUpdate();
    });

    // Ajustement PV/Mana MJ (+/-)
    html.find("[data-action='adjRes']").on("click", async ev => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const res = ev.currentTarget.dataset.res; // "pv" | "mana"
      const delta = Number(ev.currentTarget.dataset.delta) || 0;

      const path = `system.ressources.${res}.valeur`;
      const cur = Number(foundry.utils.getProperty(this.actor, path)) || 0;
      await this.actor.update({ [path]: cur + delta });
    });

    // Lancer un sort d'attaque (mana peut devenir négatif)
    html.find("[data-action='castSpell']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      if (!item) return;

      const mode = item.system.mode ?? "attaque";
      if (mode !== "attaque") return ui.notifications.warn("Ce sort n'est pas un sort d'attaque (AURA/BUFF).");

      const cd = item.system.recharge ?? { max: 0, restant: 0 };
      if ((Number(cd.restant) || 0) > 0) {
        return ui.notifications.warn(`Sort en recharge : ${cd.restant} tour(s) restant(s).`);
      }

      const cout = Number(item.system.coutMana) || 0;
      const mana = Number(this.actor.system.ressources?.mana?.valeur) || 0;

      await this.actor.update({ "system.ressources.mana.valeur": mana - cout });

      if ((Number(cd.max) || 0) > 0) {
        await item.update({ "system.recharge.restant": Number(cd.max) || 0 });
      }

      ui.notifications.info(`Sort lancé : ${item.name} (-${cout} mana).`);
    });

    // Toggle aura/buff (actif) + cooldown possible
    html.find("[data-action='toggleSpell']").on("click", async ev => {
      const li = ev.currentTarget.closest(".item");
      const item = this.actor.items.get(li?.dataset?.itemId);
      if (!item) return;

      const next = ev.currentTarget.dataset.next; // "on" | "off"
      const mode = item.system.mode ?? "attaque";
      if (mode === "attaque") return ui.notifications.warn("Ce sort est un sort d'attaque.");

      const cd = item.system.recharge ?? { max: 0, restant: 0 };
      if ((Number(cd.restant) || 0) > 0 && next === "on") {
        return ui.notifications.warn(`Sort en recharge : ${cd.restant} tour(s) restant(s).`);
      }

      const cout = Number(item.system.coutMana) || 0;
      const mana = Number(this.actor.system.ressources?.mana?.valeur) || 0;

      if (next === "on") {
        // mana peut passer négatif
        await this.actor.update({ "system.ressources.mana.valeur": mana - cout });

        const up = { "system.actif": true };

        // optionnel : démarre cooldown si défini
        if ((Number(cd.max) || 0) > 0) up["system.recharge.restant"] = Number(cd.max) || 0;

        // optionnel : si tu veux une durée, on écrit un champ runtime (pas obligatoire)
        const dureeTours = Number(item.system.dureeTours ?? 0) || 0;
        if (dureeTours > 0) up["system.dureeRestant"] = dureeTours;

        await item.update(up);
        ui.notifications.info(`Effet activé : ${item.name} (-${cout} mana).`);
      } else {
        await item.update({
          "system.actif": false,
          "system.dureeRestant": 0
        });
        ui.notifications.info(`Effet désactivé : ${item.name}.`);
      }
    });

    // Déclarer une attaque (arme/sort) -> affiche TN + instructions
    html.find("[data-action='useItem']").on("click", async (ev) => {
      ev.preventDefault();

      const itemId =
        ev.currentTarget.dataset.itemId ||
        ev.currentTarget.closest(".item")?.dataset?.itemId;

      const item = this.actor.items.get(itemId);
      if (!item) return;

      const targetToken = Array.from(game.user.targets)[0];
      if (!targetToken) {
        return ui.notifications.warn("Cible un ennemi (Target : touche T) avant d'utiliser une attaque/sort.");
      }

      const target = targetToken.actor;
      if (!target) return;

      const type = item.type; // weapon / spell
      const livraison = item.system?.livraison ?? (type === "spell" ? "magique" : "physique");
      const diff = Number(item.system?.difficulte ?? 0) || 0;

      const Combat = game.rpg?.combat;
      if (!Combat?.computeTN) {
        ui.notifications.error("Combat API introuvable: game.rpg.combat.computeTN");
        return;
      }

      // computeTN peut renvoyer un nombre OU un objet (on gère les deux)
      const tnRes = Combat.computeTN(this.actor, target, item);
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

      // --- DÉGÂTS (affichage complet) ---
      const effP = this.actor.system?.derived?.effective?.principales ?? this.actor.system?.principales ?? {};

      // On garde un truc simple et stable :
      // Physique -> Force ; Magique -> Intelligence
      const dmgStat = (livraison === "physique")
        ? Number(effP.force ?? 0)
        : Number(effP.intelligence ?? 0);

      const statBonus = game.rpg.combat.bonusFromStat(dmgStat); // /10 (floor) chez toi

      // Champs optionnels (weapon a degatsFixes/degatsAdd dans ton template)
      const flatFixe = Number(item.system?.degatsFixes ?? 0) || 0;
      const flatAdd = Number(item.system?.degatsAdd ?? 0) || 0;

      const flatTotal = statBonus + flatFixe + flatAdd;

      // Formule de dé (weapon/spell)
      const degatsFormula = String(item.system?.degats ?? "1d6");
      const etats = String(item.system?.etatsInfliges ?? "").trim();
      const content =
        `<b>${this.actor.name}</b> utilise <b>${item.name}</b> sur <b>${target.name}</b> ` +
        `(${livraison === "physique" ? "Physique" : "Magique"})<br>` +
        `Seuil toucher: <b>${tnFinal}+</b> (base ${tnBase}+ ; difficulté +${diff})<br>` +
        `Dégâts: <b>${flatTotal}</b> + <b>${degatsFormula}</b><br>` +
        (etats ? `États: <b>${etats}</b><br>` : "");

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content
      });
    });

    html.find("[data-action='statusShowCleanse']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      const id = ev.currentTarget.dataset.id;
      await game.rpg.status.postCleanseInfo(this.actor, id);
    });

    // --- ÉTATS: add/edit/delete ---
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

    html.find("[data-action='stateDelete']").on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const id = ev.currentTarget.dataset.id;
      await this._stateRemove(id);
      this.render(false);
    });

    html.find("[data-action='stateShow']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.id;
      const st = this._stateFindById(id);
      if (!st) return;

      await this._postStateInfoToChat(st);
    });

    html.find("[data-action='skillAddXp']").on("click", async (ev) => {
      ev.preventDefault();
      const li = ev.currentTarget.closest("[data-skill]");
      const key = li?.dataset?.skill;
      if (!key) return;

      const amt = Number(li.querySelector(".skill-xp-add")?.value || 0);
      await addXpToSkill(this.actor, key, amt);
    });

    html.find("[data-action='skillRemoveXp']").on("click", async (ev) => {
      ev.preventDefault();
      const li = ev.currentTarget.closest("[data-skill]");
      const key = li?.dataset?.skill;
      if (!key) return;
    
      const amt = Number(li.querySelector(".skill-xp-add")?.value || 0);
      await removeXpFromSkill(this.actor, key, amt);
    });    

  }

  // ✅ Auto pods : calcule depuis TOUS les items et met à jour system.charge.podsActuels
  async _updatePodsToActor() {
    // Si l'utilisateur n'a pas le droit d'update l'actor => on abandonne silencieusement
    if (!this.actor.isOwner && !game.user.isGM) return;

    let total = 0;

    for (const item of this.actor.items) {
      const sys = item.system ?? {};
      const qte = Number(sys.qte ?? 1) || 1;
      const poids = Number(sys.poids ?? 0) || 0;
      total += poids * qte;
    }

    // arrondi 0.1
    total = Math.round(total * 10) / 10;

    const cur = Number(this.actor.system?.charge?.podsActuels ?? 0) || 0;
    if (Math.abs(cur - total) < 0.05) return;

    await this.actor.update({ "system.charge.podsActuels": total });
  }

  _categorizeItems(items) {
    const out = { inventaire: [], equipe: [], nonEquipe: [], consommables: [], sorts: [], competences: [] };

    for (const it of items) {
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
    const all = [
      ...cat.inventaire,
      ...cat.equipe,
      ...cat.nonEquipe,
      ...cat.consommables,
      ...cat.sorts,
      ...cat.competences
    ];

    const podsActuels = all.reduce((acc, it) => acc + (Number(it._derived?.poidsTotal) || 0), 0);
    const podsMax = Number(this.actor.system?.charge?.podsMax ?? 0) || 0;

    const pct = podsMax > 0 ? Math.min(999, Math.round((podsActuels / podsMax) * 100)) : 0;

    let etat = "Normal";
    if (podsMax > 0) {
      if (pct >= 120) etat = "Surchargé";
      else if (pct >= 90) etat = "Lourd";
      else if (pct >= 60) etat = "Chargé";
    }

    return { podsActuels: Number(podsActuels.toFixed(2)), podsMax, pct, etat };
  }

  async _equipWithConflicts(item) {
    const type = item.type;
    const slot = item.system?.emplacement;

    const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);
    const equipped = this.actor.items.filter(i => i.system?.equipe);

    const unequipItems = async (items) => {
      if (!items.length) return;
      await this.actor.updateEmbeddedDocuments("Item",
        items.map(it => ({ _id: it.id, "system.equipe": false }))
      );
    };

    // Arme
    if (type === "weapon") {
      const twoHands = !!item.system?.twoHands;
      if (!HAND_SLOTS.has(slot)) {
        return ui.notifications.warn("Une arme doit être en mainDroite ou mainGauche.");
      }

      const equippedInHands = equipped.filter(i => HAND_SLOTS.has(i.system?.emplacement));

      if (twoHands) {
        // libère les 2 mains
        await unequipItems(equippedInHands);
        await item.update({ "system.equipe": true });
        return;
      } else {
        // retire toute arme 2 mains équipée
        const equippedTwoHands = equipped.filter(i => i.type === "weapon" && i.system?.twoHands);
        await unequipItems(equippedTwoHands);

        // retire le slot uniquement (droite/gauche)
        const sameSlot = equipped.filter(i => i.system?.emplacement === slot);
        await unequipItems(sameSlot);

        await item.update({ "system.equipe": true });
        return;
      }
    }

    // Armure / autre : 1 par slot
    if (!slot) return ui.notifications.warn("Cet objet n’a pas d’emplacement (system.emplacement).");
    const conflicts = equipped.filter(i => i.id !== item.id && i.system?.emplacement === slot);
    await unequipItems(conflicts);

    await item.update({ "system.equipe": true });
  }

  _buildEquipSlotsUI(items, categorized) {
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

    // Tous les équipements du perso (armes+armures)
    const allEquipItems = items.filter(it => it.type === "weapon" || it.type === "armor");

    // Équipés (equipe=true)
    const equipped = allEquipItems.filter(it => !!it.system?.equipe);

    // Map slot -> item équipé
    const bySlot = new Map();
    for (const it of equipped) {
      const slot = it.system?.emplacement;
      if (!slot) continue;

      bySlot.set(slot, it);

      // arme 2 mains : affichée sur les 2 slots
      if (it.type === "weapon" && it.system?.twoHands) {
        if (slot === "mainDroite") bySlot.set("mainGauche", it);
        if (slot === "mainGauche") bySlot.set("mainDroite", it);
      }
    }

    return SLOT_DEFS.map(s => {
      const equippedItem = bySlot.get(s.key) ?? null;

      // Slot "lié" si arme 2 mains affichée sur la main secondaire
      const locked = !!(equippedItem && equippedItem.type === "weapon" && equippedItem.system?.twoHands && equippedItem.system?.emplacement !== s.key);

      // Options du select
      let options = [];
      if (s.kind === "hand") {
        // toutes les armes du perso (pour choisir dans une main)
        options = allEquipItems.filter(i => i.type === "weapon").map(i => ({
          ...i,
          selected: equippedItem?._id === i._id
        }));
      } else {
        // armures/artefacts etc : on propose les armures dont l’emplacement = slot
        options = allEquipItems
          .filter(i => i.type === "armor")
          .filter(i => (i.system?.emplacement === s.key))
          .map(i => ({
            ...i,
            selected: equippedItem?._id === i._id
          }));
      }

      // ajoute _derived poidsTotal pour l’affichage slot
      if (equippedItem) {
        const qte = Number(equippedItem.system?.qte ?? 1) || 0;
        const poids = Number(equippedItem.system?.poids ?? 0) || 0;
        equippedItem._derived = equippedItem._derived ?? {};
        equippedItem._derived.poidsTotal = Number((qte * poids).toFixed(2));
      }

      return {
        key: s.key,
        label: s.label,
        item: equippedItem,
        locked,
        options
      };
    });
  }

  _findEquippedForSlot(slot) {
    const HAND_SLOTS = new Set(["mainDroite", "mainGauche"]);

    return this.actor.items.find(i => {
      if (!(i.type === "weapon" || i.type === "armor")) return false;
      if (!i.system?.equipe) return false;

      const s = i.system?.emplacement;
      if (s === slot) return true;

      // Arme 2 mains occupe les 2 slots
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

    // 1) Si "Aucun" => déséquipe ce qui est présent (y compris arme 2 mains)
    if (!itemId) {
      if (current) equip(current, false);
      if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
      return;
    }

    const item = this.actor.items.get(itemId);
    if (!item) return;

    // --- CAS ARME ---
    if (item.type === "weapon") {
      const twoHands = !!item.system?.twoHands;

      // target slot : doit être une main
      let targetSlot = HAND_SLOTS.has(slot) ? slot : "mainDroite";
      if (twoHands) targetSlot = "mainDroite"; // convention

      // Si une arme 2 mains est équipée et que ce n'est pas celle-ci, on la retire
      for (const w of this.actor.items) {
        if (w.type !== "weapon") continue;
        if (!w.system?.equipe) continue;
        if (!w.system?.twoHands) continue;
        if (w.id === item.id) continue;
        equip(w, false);
      }

      if (twoHands) {
        // Arme 2 mains => libère toutes les armes en mains
        for (const w of this.actor.items) {
          if (w.type !== "weapon") continue;
          if (!w.system?.equipe) continue;
          const s = w.system?.emplacement;
          if (HAND_SLOTS.has(s) && w.id !== item.id) equip(w, false);
        }

        // place + équipe
        updates.push({ _id: item.id, "system.emplacement": targetSlot, "system.equipe": true });
        await this.actor.updateEmbeddedDocuments("Item", updates);
        return;
      }

      // Arme 1 main :
      // - si le slot contient une arme (ou n'importe quoi en main), on retire l'occupant de CE slot
      if (current && current.id !== item.id) equip(current, false);

      // - si l'item était équipé ailleurs, on le déplace
      updates.push({ _id: item.id, "system.emplacement": targetSlot, "system.equipe": true });

      await this.actor.updateEmbeddedDocuments("Item", updates);
      return;
    }

    // --- CAS ARMURE / GEAR ---
    // 1 seul par slot (hors mains)
    // Déséquipe occupant du slot (si présent)
    if (current && current.id !== item.id) equip(current, false);

    // Place + équipe l’armure
    updates.push({ _id: item.id, "system.emplacement": slot, "system.equipe": true });

    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  async _createItem(type) {
    const defaults = {
      loot: { name: "Nouvel objet", type: "loot", system: { qte: 1, poids: 0 } },
      weapon: { name: "Nouvelle arme", type: "weapon", system: { equipe: false, emplacement: "main", qte: 1, poids: 1, difficulte: 0, degats: "1d6", livraison: "physique" } },
      armor: { name: "Nouvelle armure", type: "armor", system: { equipe: false, emplacement: "torse", qte: 1, poids: 2 } },
      consumable: { name: "Nouveau consommable", type: "consumable", system: { qte: 1, poids: 0.2, utilisations: 1, effet: "" } },
      spell: { name: "Nouveau sort", type: "spell", system: { qte: 1, poids: 0, mode: "attaque", coutMana: 5, difficulte: 0, degats: "1d6", livraison: "magique", recharge: { max: 0, restant: 0 }, actif: false } },
      skill: { name: "Nouvelle compétence", type: "skill", system: { qte: 1, poids: 0, rang: 0, statLiee: "dexterite", difficulte: 0 } }
    };

    const data = defaults[type] ?? { name: "Nouvel item", type, system: { qte: 1, poids: 0 } };
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

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

    // optionnel mais recommandé: recalcul derived
    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.actor);
  }

  async _stateRemove(id) {
    const path = this._statePath();
    const list = this._stateList().filter(e => e.id !== id);
    await this.actor.update({ [path]: list });

    if (game.rpg?.status?.recompute) await game.rpg.status.recompute(this.actor);
  }

  _stateDefaults() {
    // label utilisé par ton HBS : {{e.label}}
    return this._normalizeState({
      id: foundry.utils.randomID(),
      label: "Poison",
      type: "poison",          // poison | burn | buff | debuff | aura | custom
      isAura: false,           // aura = buff tant qu’actif
      duration: 3,
      remaining: 3,
      cleanseDC: 0,

      // DOT dégâts fixes (et optionnel formula)
      dot: {
        flat: 0,               // dégâts fixes / tick
        formula: "",           // ex: "1d4" si tu veux plus tard (optionnel)
        perTick: 0             // pour l’affichage, tu peux remplir à partir de flat/formula
      },

      // Mods : { <statKey>: { flat, pct } }
      // pct = 10 signifie +10% (ou -10 si tu mets -10)
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
    // affichage simple : perTick = flat (tu peux enrichir plus tard)
    out.dot.perTick = Number(out.dot.perTick ?? out.dot.flat) || 0;

    out.mods = out.mods ?? {};
    return out;
  }

  _allModKeys() {
    // "toutes les stats possible" : adapte/ajoute selon ton système
    return [
      // principales
      "force", "dexterite", "intelligence", "acuite", "savoir",
      // secondaires / combats
      "initiative", "defense", "resistance",
      // ressources
      "vieMax", "manaMax", "regenPv", "regenMana",
      // defenses détaillées
      "scoreArmure", "scoreResistance", "armureFixe", "resistanceFixe",
      // autres
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
      const pct = Number(cur.pct ?? 0) || 0;

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
          ${["poison", "burn", "buff", "debuff", "aura", "custom"].map(t =>
      `<option value="${t}" ${st.type === t ? "selected" : ""}>${t}</option>`
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
              out.dot.perTick = out.dot.flat; // affichage simple

              out.mods = out.mods ?? {};
              for (const k of keys) {
                const flat = getNum(`mods.${k}.flat`, 0);
                const pct = getNum(`mods.${k}.pct`, 0);
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
    const dotTxt = (st.dot?.flat || st.dot?.formula)
      ? `DOT: <b>${st.dot?.flat ?? 0}</b>${st.dot?.formula ? ` + <b>${st.dot.formula}</b>` : ""}`
      : "DOT: <i>aucun</i>";

    const mods = st.mods ?? {};
    const modsTxt = Object.entries(mods)
      .map(([k, v]) => `${k}: ${v.flat ? (v.flat > 0 ? "+" : "") + v.flat : ""}${v.pct ? ` ${v.pct > 0 ? "+" : ""}${v.pct}%` : ""}`.trim())
      .filter(Boolean)
      .join("<br>") || "<i>Aucun modificateur</i>";

    const content = `
      <b>${this.actor.name}</b> — État: <b>${st.label}</b><br>
      Type: <b>${st.type}</b> ${st.isAura ? "(Aura)" : ""}<br>
      Durée: <b>${st.remaining}</b> / ${st.duration} tour(s)<br>
      Retrait: ${st.cleanseDC ? `<b>${st.cleanseDC}+</b>` : "<i>—</i>"}<br>
      ${dotTxt}<br>
      <hr>
      <b>Mods</b><br>${modsTxt}
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });
  }

  // _stateDefaults(list) {
  //   // Un modèle simple, tu peux enrichir plus tard
  //   const base = {
  //     id: foundry.utils.randomID(),
  //     name: "Poison",
  //     duration: 3,
  //     dc: 0,

  //     // DOT : dotFlat + floor(stat/dotDiv)
  //     dotFlat: 0,
  //     dotStat: "intelligence", // ou "" si aucun
  //     dotDiv: 10,

  //     // Debuffs (exemples)
  //     debuff: {
  //       forceFlat: 0, forcePct: 0,
  //       dexFlat: 0, dexPct: 0,
  //       intFlat: 0, intPct: 0,
  //     }
  //   };

  //   // États actifs ont un "remaining"
  //   if (list === "etatsActifs") {
  //     return { ...base, remaining: base.duration, dotPerTick: 0 };
  //   }
  //   return base;
  // }

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
