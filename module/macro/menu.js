/**
 * Macro "Menu Combat" (Foundry VTT v13)
 * - Section ARMES : armes équipées du token, bouton Attaquer (d20 → TN → dégâts)
 * - Section SORTS : sorts avec filtres + bouton Déclarer
 * - Toggle thème Clair/Sombre mémorisé par joueur
 */

(async () => {
  // ── helpers ────────────────────────────────────────────────────────────────
  const notify = (type, msg) =>
    ui.notifications?.[type]?.(msg) ?? console.log(`[${type}]`, msg);

  const DialogClass =
    foundry?.applications?.api?.DialogV2 ??
    foundry?.applications?.api?.Dialog ??
    Dialog;
  const isV2 = DialogClass === foundry?.applications?.api?.DialogV2;

  const getControlledToken = () => canvas?.tokens?.controlled?.[0] ?? null;
  const getSpellAPI    = () => globalThis.RPG_SPELLS ?? game.rpg?.spells ?? null;
  const getCombatAPI   = () => game.rpg?.combat ?? null;
  const getBudgetAPI   = () => game.rpg?.budget ?? null;
  const getConfirmAPI  = () => game.rpg?.actionConfirm ?? null;

  // Helpers budget
  const getCombat       = () => game.combat ?? null;
  const getCombatant    = (a) => getCombat()?.combatants?.find(c => c.actorId === a?.id) ?? null;
  const getBudget       = (a) => {
    const api = getBudgetAPI();
    const cbt = getCombatant(a);
    if (!api || !cbt || !getCombat()) return null;
    return api.getBudget(getCombat(), cbt.id);
  };
  const canUseSlot      = (a, slot) => {
    const api = getBudgetAPI();
    const b   = getBudget(a);
    if (!api || !b) return true; // pas de combat → pas de restriction
    return api.canUseSlot(b, slot);
  };

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  const htmlEscape = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // ── actor / token / APIs ───────────────────────────────────────────────────
  const token = getControlledToken();
  const actor = token?.actor ?? null;
  if (!actor) return notify("warn", "Contrôle un token avant d'ouvrir le menu.");

  const spellAPI  = getSpellAPI();
  const combatAPI = getCombatAPI();
  if (!spellAPI?.declareSpell)
    console.warn("[RPG][Menu] RPG_SPELLS.declareSpell introuvable.");

  // ── accesseurs items ───────────────────────────────────────────────────────
  const getManaNow   = (a) => n(a?.system?.ressources?.mana?.valeur, 0);
  const getManaCost  = (it) => n(it?.system?.coutMana, 0);
  const getCD        = (it) => {
    const sys = it?.system ?? {};
    return {
      max:     n(sys.cooldown?.max     ?? sys.recharge?.max,     0),
      restant: n(sys.cooldown?.restant ?? sys.recharge?.restant, 0),
    };
  };
  const getRange     = (it) => ({
    min: n(it?.system?.range?.min,  0),
    max: n(it?.system?.range?.max ?? it?.system?.portee, 0),
  });
  const isAura       = (it) => !!(it?.system?.aura?.active || it?.system?.aura?.enabled);
  const requiresTarget = (it) => !!(it?.system?.damage?.enabled || isAura(it));

  // ── listes ─────────────────────────────────────────────────────────────────
  const weaponsEquipped = actor.items
    .filter((i) => i.type === "weapon" && !!i.system?.equipe)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  const spellsAll = actor.items
    .filter((i) => i.type === "spell")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!weaponsEquipped.length && !spellsAll.length)
    return notify("info", `${actor.name} n'a ni arme équipée ni sort.`);

  // ── état UI ────────────────────────────────────────────────────────────────
  const state = { q: "", tab: "all", section: spellsAll.length ? "spells" : "weapons" };

  const THEME_SCOPE = "rpg";
  const THEME_FLAG  = "menuSpellsTheme";
  let theme = (game.user.getFlag(THEME_SCOPE, THEME_FLAG) ?? "light");
  if (theme !== "dark") theme = "light";

  // ── filtrage sorts ─────────────────────────────────────────────────────────
  const computeFilteredSpells = () => {
    const q = state.q.trim().toLowerCase();
    return spellsAll.filter((s) => {
      if (q && !(s.name ?? "").toLowerCase().includes(q)) return false;
      const cd      = getCD(s);
      const ready   = cd.restant <= 0;
      const aura    = isAura(s);
      const needTgt = requiresTarget(s);
      if (state.tab === "ready"  && !ready)   return false;
      if (state.tab === "cd"     && ready)    return false;
      if (state.tab === "auras"  && !aura)    return false;
      if (state.tab === "target" && !needTgt) return false;
      return true;
    });
  };

  // ── section ARMES ──────────────────────────────────────────────────────────
  const buildWeaponsHTML = () => {
    if (!weaponsEquipped.length)
      return `<div class="rpg-empty">Aucune arme équipée.</div>`;

    const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
    const hasTarget   = !!targetToken;

    return weaponsEquipped.map((w) => {
      const dmg     = w.system?.damage ?? {};
      const die     = String(dmg.dice ?? dmg.die ?? "1d6");
      const flat    = n(dmg.flat, 0);
      const scStat  = String(dmg.scaling?.stat ?? "force");
      const per     = Math.max(1, n(dmg.scaling?.per, 10));
      const perStep = n(dmg.scaling?.perStep, 1);

      const effP    = actor.system?.derived?.effective?.principales
                   ?? actor.system?.principales ?? {};
      const statVal = n(effP?.[scStat], 0);
      const bonus   = Math.floor(statVal / per) * perStep;

      const dmgTxt  = `${flat}+${die}+${bonus} (${scStat})`;
      const twoH    = w.system?.twoHands ? "2 mains" : "1 main";
      const livr    = String(w.system?.livraison ?? "physique");

      // TN si cible sélectionnée
      let tnTxt = hasTarget && combatAPI?.computeTN
        ? (() => {
            const r = combatAPI.computeTN(actor, targetToken.actor, w);
            return `TN <b>${r.tnFinal}+</b>`;
          })()
        : "TN <i>—</i>";

      // Vérification du budget
      const hasAtkSlot = canUseSlot(actor, "attaque");
      const atkBlocked = !hasAtkSlot;
      const atkTitle   = atkBlocked ? "Slot Attaque épuisé pour ce tour" : "";

      return `
        <div class="rpg-spell-row" data-item-id="${w.id}" data-item-type="weapon">
          <img class="rpg-icon" src="${htmlEscape(w.img)}" />

          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(w.name)}">${htmlEscape(w.name)}</div>
              <div class="rpg-badges">
                <span class="badge b-ok">${livr}</span>
                <span class="badge b-info">${twoH}</span>
                ${atkBlocked ? `<span class="badge b-bad">SLOT ✗</span>` : hasTarget ? `<span class="badge b-ok">CIBLE ✓</span>` : `<span class="badge b-warn">CIBLE</span>`}
              </div>
            </div>
            <div class="rpg-stats">
              <span>⚔️ Dégâts <b>${dmgTxt}</b></span>
              <span>${tnTxt}</span>
            </div>
          </div>

          <div class="rpg-right">
            <button type="button" class="rpg-open" data-action="open" title="Ouvrir la fiche">🔎</button>
            <button type="button"
              class="rpg-declare ${hasTarget && !atkBlocked ? "btn-ok" : "btn-off"}"
              data-action="attack"
              title="${atkTitle}"
              ${hasTarget && !atkBlocked ? "" : "disabled"}>
              Attaquer
            </button>
          </div>
        </div>
      `;
    }).join("");
  };

  // ── section SORTS ──────────────────────────────────────────────────────────
  const buildSpellsHTML = () => {
    const manaNow  = getManaNow(actor);
    const filtered = computeFilteredSpells();
    if (!filtered.length)
      return `<div class="rpg-empty">Aucun sort ne correspond aux filtres.</div>`;

    const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
    const hasTarget   = !!targetToken;

    return filtered.map((s) => {
      const cd       = getCD(s);
      const r        = getRange(s);
      const manaCost = getManaCost(s);
      const ready    = cd.restant <= 0;
      const aura     = isAura(s);
      const needTgt  = requiresTarget(s);
      const okMana   = manaNow >= manaCost;
      const okTarget = !needTgt || hasTarget;
      const slotKey  = sys?.speed === "rapide" || sys?.speed === "quick" ? "sortRapide" : "sortNormal";
      const hasSlot  = canUseSlot(actor, slotKey);
      const canUse   = ready && okMana && okTarget && hasSlot;
      const cdTxt    = cd.max > 0 ? `${cd.restant}/${cd.max}` : "—";

      return `
        <div class="rpg-spell-row" data-item-id="${s.id}" data-item-type="spell">
          <img class="rpg-icon" src="${htmlEscape(s.img)}" />
          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(s.name)}">${htmlEscape(s.name)}</div>
              <div class="rpg-badges">
                <span class="badge ${ready ? "b-ok" : "b-bad"}">${ready ? "PRÊT" : "EN CD"}</span>
                ${!hasSlot ? `<span class="badge b-bad">SLOT ✗</span>` : ""}
                ${needTgt ? `<span class="badge ${hasTarget ? "b-ok" : "b-warn"}">CIBLE${hasTarget ? " ✓" : ""}</span>` : ""}
                ${aura ? `<span class="badge b-aura">AURA</span>` : ""}
              </div>
            </div>
            <div class="rpg-stats">
              <span>💧 Mana <b class="${okMana ? "" : "bad"}">${manaCost}</b></span>
              <span>📏 Portée <b>${r.min}–${r.max}</b></span>
              <span>⏳ CD <b class="${ready ? "cd-ok" : "cd-bad"}">${cdTxt}</b></span>
            </div>
          </div>
          <div class="rpg-right">
            <button type="button" class="rpg-open" data-action="open" title="Ouvrir la fiche">🔎</button>
            <button type="button"
              class="rpg-declare ${canUse ? "btn-ok" : "btn-off"}"
              data-action="declare"
              ${canUse ? "" : "disabled"}>
              Déclarer
            </button>
          </div>
        </div>
      `;
    }).join("");
  };

  // ── HTML complet ───────────────────────────────────────────────────────────
  const buildContent = () => {
    const manaNow   = getManaNow(actor);
    const themeIcon = theme === "light" ? "☀︎" : "🌙";
    const secWeapon = state.section === "weapons";
    const secSpell  = state.section === "spells";

    return `
      <div class="rpg-spell-menu ${theme === "light" ? "rpg-theme-light" : "rpg-theme-dark"}">

        <div class="rpg-head">
          <div class="rpg-sub">
            <b>${htmlEscape(actor.name)}</b> • ${htmlEscape(token.name)}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <button type="button" class="rpg-theme-toggle" data-action="toggleTheme"
              title="${theme === "light" ? "Thème clair" : "Thème sombre"}"
              style="width:40px;height:34px;border-radius:10px;cursor:pointer;">${themeIcon}</button>
            <div class="rpg-mana">💧 Mana: <b class="rpg-mana-val">${manaNow}</b></div>
          </div>
        </div>

        <!-- Budget d'actions -->
        <div class="rpg-budget-widget">
          ${(() => {
            const budgetAPI = getBudgetAPI();
            const combat    = getCombat();
            const cbt       = getCombatant(actor);
            if (!budgetAPI || !combat || !cbt) {
              return `<div style="font-size:11px;color:var(--color-text-secondary);padding:4px 0">Hors combat — aucune restriction d'actions</div>`;
            }
            const b = budgetAPI.getBudget(combat, cbt.id);
            return budgetAPI.budgetHTML(b);
          })()}
        </div>

        <!-- Bouton déplacement rapide -->
        ${(() => {
          const hasDepl = canUseSlot(actor, "deplacement");
          return `<div style="margin-bottom:6px">
            <button type="button" data-action="move"
              style="width:100%;padding:5px 10px;border-radius:7px;cursor:pointer;font-size:12px;
                     background:${hasDepl ? "#1d9e75" : "#888"};color:#fff;border:none;opacity:${hasDepl ? "1" : "0.5"}"
              ${hasDepl ? "" : "disabled"}>
              🏃 Déclarer Déplacement (${actor.system?.deplacement?.vitesse ?? "?"} cases)
            </button>
          </div>`;
        })()}

        <!-- Section tabs -->
        <div class="rpg-section-tabs">
          ${weaponsEquipped.length ? `
          <button type="button" class="section-tab ${secWeapon ? "active" : ""}" data-section="weapons">
            ⚔️ Armes (${weaponsEquipped.length})
          </button>` : ""}
          ${spellsAll.length ? `
          <button type="button" class="section-tab ${secSpell ? "active" : ""}" data-section="spells">
            ✨ Sorts (${spellsAll.length})
          </button>` : ""}
        </div>

        <!-- Section ARMES -->
        <div class="rpg-section" id="sec-weapons" ${secWeapon ? "" : 'style="display:none"'}>
          <div class="rpg-list rpg-weapons-list">
            ${buildWeaponsHTML()}
          </div>
        </div>

        <!-- Section SORTS -->
        <div class="rpg-section" id="sec-spells" ${secSpell ? "" : 'style="display:none"'}>
          <div class="rpg-filterbar">
            <input class="rpg-search" type="text" placeholder="Rechercher un sort..." value="${htmlEscape(state.q)}" />
            <div class="rpg-tabs">
              ${["all","ready","cd","auras","target"].map(t =>
                `<button type="button" class="tab ${state.tab === t ? "active" : ""}" data-tab="${t}">${
                  {all:"Tous",ready:"Prêts",cd:"En CD",auras:"Auras",target:"Cible"}[t]
                }</button>`
              ).join("")}
            </div>
          </div>
          <div class="rpg-list rpg-spells-list">
            ${buildSpellsHTML()}
          </div>
          <div class="rpg-hint">
            Cible une cible (T) avant de déclarer si le sort indique <b>CIBLE</b>.
          </div>
        </div>

      </div>
    `;
  };

  // ── bind UI ────────────────────────────────────────────────────────────────
  const bindUI = (dlg) => {
    const el =
      dlg?.element instanceof HTMLElement             ? dlg.element :
      dlg?.element?.[0] instanceof HTMLElement        ? dlg.element[0] :
      dlg?.element?.get?.(0) instanceof HTMLElement   ? dlg.element.get(0) :
      null;
    if (!el) {
      console.warn("[RPG][Menu] Impossible de récupérer dlg.element.");
      return;
    }

    const $root = $(el);
    const rerenderAll    = () =>
      $root.find(".window-content, .content, .dialog-content").first().html(buildContent());
    const rerenderWeapons = () => $root.find(".rpg-weapons-list").html(buildWeaponsHTML());
    const rerenderSpells  = () => $root.find(".rpg-spells-list").html(buildSpellsHTML());
    const rerenderMana    = () => $root.find(".rpg-mana-val").text(String(getManaNow(actor)));

    $root.off(".rpgMenu");

    // Section tabs
    $root.on("click.rpgMenu", ".section-tab", (ev) => {
      state.section = ev.currentTarget.dataset.section ?? "spells";
      $root.find(".section-tab").removeClass("active");
      $(ev.currentTarget).addClass("active");
      $root.find("#sec-weapons").toggle(state.section === "weapons");
      $root.find("#sec-spells").toggle(state.section === "spells");
    });

    // Filtre sorts
    $root.on("input.rpgMenu", ".rpg-search", (ev) => {
      state.q = String(ev.currentTarget.value ?? "");
      rerenderSpells();
    });
    $root.on("click.rpgMenu", ".tab", (ev) => {
      state.tab = ev.currentTarget.dataset.tab ?? "all";
      $root.find(".tab").removeClass("active");
      $(ev.currentTarget).addClass("active");
      rerenderSpells();
    });

    // Ouvrir fiche
    $root.on("click.rpgMenu", "[data-action='open']", (ev) => {
      const row    = ev.currentTarget.closest("[data-item-id]");
      const itemId = row?.dataset?.itemId;
      actor.items.get(itemId)?.sheet?.render(true);
    });

    // ── Attaque avec arme (flow : joueur déclare → snapshot → pending → MJ valide) ────
    $root.on("click.rpgMenu", "[data-action='attack']", async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      const row    = btn.closest("[data-item-id]");
      const weapon = actor.items.get(row?.dataset?.itemId);
      if (!weapon) { btn.disabled = false; return notify("warn", "Arme introuvable."); }

      const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
      if (!targetToken?.actor) {
        btn.disabled = false;
        return notify("warn", "Cible un ennemi (T) avant d'attaquer.");
      }

      // Vérification budget
      const budgetAPI = getBudgetAPI();
      const combat    = getCombat();
      const cbt       = getCombatant(actor);
      if (budgetAPI && combat && cbt && !budgetAPI.canUseSlot(budgetAPI.getBudget(combat, cbt.id), "attaque")) {
        btn.disabled = false;
        return notify("warn", "Slot Attaque épuisé pour ce tour.");
      }

      try {
        // 1. Snapshot AVANT action
        const snapshot = {
          casterId:  actor.id,
          casterMana: n(actor.system?.ressources?.mana?.valeur, 0),
          targetId:   targetToken.actor.id,
          targetPv:   n(targetToken.actor.system?.ressources?.pv?.valeur, 0),
          addedStateIds: [],
          cooldown:   null
        };

        // 2. Réserve le slot (pending)
        const actionId = foundry.utils.randomID();
        if (budgetAPI && combat && cbt) {
          const budget    = budgetAPI.getBudget(combat, cbt.id);
          const newBudget = budgetAPI.reserveSlot(budget, "attaque");
          await budgetAPI.saveBudget(combat, cbt.id, newBudget);
          await budgetAPI.addLogEntry(combat, cbt.id, {
            id: actionId, slot: "attaque", status: "pending",
            label: `Attaque ${weapon.name} → ${targetToken.actor.name}`,
            actorId: actor.id, snapshot, timestamp: Date.now()
          });
        }

        // 3. Jet d20 du joueur (visible dans le chat)
        const roll20 = await (new Roll("1d20")).evaluate();
        await roll20.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `⚔️ <b>${actor.name}</b> attaque <b>${targetToken.actor.name}</b> avec <b>${weapon.name}</b>`
        });
        const d20 = roll20.total;

        // 4. TN + pré-calcul dégâts
        const tnData = combatAPI?.computeTN
          ? combatAPI.computeTN(actor, targetToken.actor, weapon)
          : { tnFinal: 11, tnBase: 11, diff: 0, livraison: "physique" };

        const dmgResult = await weapon.rollDamage({
          attackerActor: actor,
          targetActor:   targetToken.actor,
          isCrit:        d20 === 20,
          type:          tnData.livraison
        });

        const isCrit  = d20 === 20;
        const isAutoF = d20 <= 5;
        const isAutoS = d20 >= 16;
        const dmgSummary = `${dmgResult.beforeMitigation}${dmgResult.critBonus ? ` (+${dmgResult.critBonus} crit)` : ""} → <b>${dmgResult.final}</b> après mitigation`;

        // 5. Message pending (boutons MJ : Confirmer / Corriger / Refuser)
        const confirmAPI   = getConfirmAPI();
        const pendingLabel = `Attaque : <b>${htmlEscape(weapon.name)}</b> → <b>${htmlEscape(targetToken.actor.name)}</b>`;
        const detail       = `🎲 d20 = <b>${d20}</b> (TN ${tnData.tnFinal}+) — ${
          isAutoF ? "Échec auto" : isAutoS ? "Succès auto" : isCrit ? "CRITIQUE !" : "résultat normal"
        } — ${dmgSummary}`;

        const msgContent = confirmAPI
          ? confirmAPI.buildPendingMessage({
              actor: actor.name, label: pendingLabel, detail,
              slotLabel: "Attaque", slotIcon: "⚔️",
              actionId, type: "attack",
              outcome: isCrit ? "crit" : isAutoF ? "fail" : "hit"
            })
          : `<div>${pendingLabel}<br>${detail}</div>`;

        const msg = await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: msgContent,
          flags: {
            rpg: {
              pendingAction: {
                type: "attack", actionId, outcome: isCrit ? "crit" : isAutoF ? "fail" : "hit"
              },
              attackDeclaration: {
                actorId: actor.id, weaponId: weapon.id, targetId: targetToken.actor.id,
                d20, tnFinal: tnData.tnFinal, livraison: tnData.livraison,
                dmgBrut: dmgResult.beforeMitigation, dmgFinal: dmgResult.final,
                dmgFixe: dmgResult.fixe, dmgPct: dmgResult.pct, critBonus: dmgResult.critBonus
              }
            }
          }
        });

        // Enregistre l'id du message dans le log
        if (budgetAPI && combat && cbt) {
          await budgetAPI.updateLogEntry(combat, actionId, { chatMessageId: msg.id });
        }

        rerenderWeapons();
        rerenderAll();  // met à jour le widget budget
        notify("info", "Attaque déclarée — en attente du MJ.");
      } catch (e) {
        console.error("[RPG][Menu] Erreur attaque :", e);
        // Libère le slot en cas d'erreur
        if (budgetAPI && combat && cbt) {
          const b = budgetAPI.getBudget(combat, cbt.id);
          await budgetAPI.saveBudget(combat, cbt.id, budgetAPI.releaseSlot(b, "attaque", false));
        }
        notify("error", `Erreur attaque : ${e?.message ?? e}`);
      } finally {
        btn.disabled = false;
      }
    });

    // ── Déclarer sort (flow : snapshot → budget → pending → MJ valide) ──────
    $root.on("click.rpgMenu", "[data-action='declare']", async (ev) => {
      ev.preventDefault();
      const btn  = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      const row  = btn.closest("[data-item-id]");
      const item = actor.items.get(row?.dataset?.itemId);
      if (!item) { btn.disabled = false; return notify("warn", "Sort introuvable."); }

      const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
      const sys         = item.system ?? {};
      const speed       = String(sys.speed ?? "normal");
      const slot        = (speed === "rapide" || speed === "quick") ? "sortRapide" : "sortNormal";
      const manaCost    = n(sys.coutMana, 0);

      // Vérification budget
      const budgetAPI = getBudgetAPI();
      const combat    = getCombat();
      const cbt       = getCombatant(actor);
      if (budgetAPI && combat && cbt && !budgetAPI.canUseSlot(budgetAPI.getBudget(combat, cbt.id), slot)) {
        btn.disabled = false;
        return notify("warn", `Slot "${slot === "sortRapide" ? "Sort rapide" : "Sort normal"}" épuisé pour ce tour.`);
      }

      try {
        // 1. Snapshot AVANT (mana + cooldown)
        const snapshot = {
          casterId:  actor.id,
          casterMana: n(actor.system?.ressources?.mana?.valeur, 0),
          targetId:   targetToken?.actor?.id ?? null,
          targetPv:   n(targetToken?.actor?.system?.ressources?.pv?.valeur, undefined),
          addedStateIds: [],
          cooldown: {
            itemId:     item.id,
            oldRestant: n(sys.cooldown?.restant, 0)
          }
        };

        // 2. Réserve slot pending
        const actionId = foundry.utils.randomID();
        if (budgetAPI && combat && cbt) {
          const budget    = budgetAPI.getBudget(combat, cbt.id);
          const newBudget = budgetAPI.reserveSlot(budget, slot);
          await budgetAPI.saveBudget(combat, cbt.id, newBudget);
          await budgetAPI.addLogEntry(combat, cbt.id, {
            id: actionId, slot, status: "pending",
            label: `${item.name}${targetToken ? " → " + targetToken.actor.name : ""}`,
            actorId: actor.id, snapshot, timestamp: Date.now()
          });
        }

        // 3. Déclare via spellAPI (inclut actionId pour que le resolve puisse update le log)
        const res = await spellAPI.declareSpell(actor, item, {
          casterToken: token ?? null,
          targetToken: targetToken ?? null,
          actionId
        });

        if (!res?.ok) {
          // Libère le slot en cas d'échec de déclaration
          if (budgetAPI && combat && cbt) {
            const b = budgetAPI.getBudget(combat, cbt.id);
            await budgetAPI.saveBudget(combat, cbt.id, budgetAPI.releaseSlot(b, slot, false));
            await budgetAPI.updateLogEntry(combat, actionId, { status: "rejected" });
          }
          btn.disabled = false;
          return notify("warn", res?.reason ?? "Déclaration impossible.");
        }

        notify("info", `Sort déclaré : ${item.name} — en attente du MJ.`);
        rerenderMana();
        rerenderSpells();
        rerenderAll();
      } catch (e) {
        console.error(e);
        if (budgetAPI && combat && cbt) {
          const b = budgetAPI.getBudget(combat, cbt.id);
          await budgetAPI.saveBudget(combat, cbt.id, budgetAPI.releaseSlot(b, slot, false));
        }
        notify("error", `Erreur déclaration : ${e?.message ?? e}`);
      } finally {
        btn.disabled = false;
      }
    });

    // ── Déclarer Déplacement ──────────────────────────────────────────────
    $root.on("click.rpgMenu", "[data-action='move']", async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      const budgetAPI = getBudgetAPI();
      const combat    = getCombat();
      const cbt       = getCombatant(actor);

      if (!budgetAPI || !combat || !cbt) {
        btn.disabled = false;
        return notify("info", "Hors combat — déplacement libre.");
      }

      if (!budgetAPI.canUseSlot(budgetAPI.getBudget(combat, cbt.id), "deplacement")) {
        btn.disabled = false;
        return notify("warn", "Slot Déplacement déjà utilisé ce tour.");
      }

      try {
        const actionId = foundry.utils.randomID();
        const budget    = budgetAPI.getBudget(combat, cbt.id);
        const newBudget = budgetAPI.reserveSlot(budget, "deplacement");
        await budgetAPI.saveBudget(combat, cbt.id, newBudget);
        await budgetAPI.addLogEntry(combat, cbt.id, {
          id: actionId, slot: "deplacement", status: "pending",
          label: `Déplacement — ${actor.name}`,
          actorId: actor.id,
          snapshot: { casterId: actor.id, casterMana: undefined, targetId: null, targetPv: undefined, addedStateIds: [], cooldown: null },
          timestamp: Date.now()
        });

        const confirmAPI = getConfirmAPI();
        const msgContent = confirmAPI
          ? confirmAPI.buildPendingMessage({
              actor: actor.name, label: `Se déplace (vitesse : <b>${actor.system?.deplacement?.vitesse ?? "?"}</b> cases)`,
              slotLabel: "Déplacement", slotIcon: "🏃",
              detail: "Le déplacement est libre sur la carte.",
              actionId, type: "move", outcome: "confirm"
            })
          : `<b>${actor.name}</b> se déplace.`;

        const msg = await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: msgContent,
          flags: { rpg: { pendingAction: { type: "move", actionId, outcome: "confirm" } } }
        });
        await budgetAPI.updateLogEntry(combat, actionId, { chatMessageId: msg.id });

        rerenderAll();
        notify("info", "Déplacement déclaré — en attente du MJ.");
      } catch (e) {
        console.error(e);
        notify("error", `Erreur déplacement : ${e?.message ?? e}`);
      } finally {
        btn.disabled = false;
      }
    });

    // ── Toggle thème ───────────────────────────────────────────────────────
    $root.on("click.rpgMenu", "[data-action='toggleTheme']", async () => {
      theme = theme === "light" ? "dark" : "light";
      await game.user.setFlag(THEME_SCOPE, THEME_FLAG, theme);
      rerenderAll();
      bindUI(dlg);
    });
  };

  // ── Ouvrir le dialog ───────────────────────────────────────────────────────
  const dlgCfg = {
    title:   `Menu Combat — ${actor.name}`,
    content: buildContent(),
    default: "close"
  };
  if (isV2) {
    dlgCfg.buttons = [{ action: "close", label: "Fermer", default: true }];
  } else {
    dlgCfg.buttons = { close: { label: "Fermer" } };
  }

  const dlg = new DialogClass(dlgCfg, { width: 1100, height: 640, resizable: true });
  await dlg.render(true);
  await new Promise((r) => setTimeout(r, 0));
  bindUI(dlg);
})();
