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
  const getSpellAPI = () => globalThis.RPG_SPELLS ?? game.rpg?.spells ?? null;
  const getCombatAPI = () => game.rpg?.combat ?? null;

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

      return `
        <div class="rpg-spell-row" data-item-id="${w.id}" data-item-type="weapon">
          <img class="rpg-icon" src="${htmlEscape(w.img)}" />

          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(w.name)}">${htmlEscape(w.name)}</div>
              <div class="rpg-badges">
                <span class="badge b-ok">${livr}</span>
                <span class="badge b-info">${twoH}</span>
                ${hasTarget ? `<span class="badge b-ok">CIBLE ✓</span>` : `<span class="badge b-warn">CIBLE</span>`}
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
              class="rpg-declare ${hasTarget ? "btn-ok" : "btn-off"}"
              data-action="attack"
              ${hasTarget ? "" : "disabled"}>
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
      const canUse   = ready && okMana && okTarget;
      const cdTxt    = cd.max > 0 ? `${cd.restant}/${cd.max}` : "—";

      return `
        <div class="rpg-spell-row" data-item-id="${s.id}" data-item-type="spell">
          <img class="rpg-icon" src="${htmlEscape(s.img)}" />
          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(s.name)}">${htmlEscape(s.name)}</div>
              <div class="rpg-badges">
                <span class="badge ${ready ? "b-ok" : "b-bad"}">${ready ? "PRÊT" : "EN CD"}</span>
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

    // ── Attaque avec arme ──────────────────────────────────────────────────
    $root.on("click.rpgMenu", "[data-action='attack']", async (ev) => {
      ev.preventDefault();
      const btn    = ev.currentTarget;
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

      try {
        // 1. Jet d20
        const roll20 = await (new Roll("1d20")).evaluate();
        const d20    = roll20.total;

        // 2. TN
        const tnData = combatAPI?.computeTN
          ? combatAPI.computeTN(actor, targetToken.actor, weapon)
          : { tnFinal: 11, tnBase: 11, diff: 0, livraison: "physique" };

        const { hit, crit } = combatAPI?.isHit
          ? combatAPI.isHit(d20, tnData.tnFinal)
          : { hit: d20 >= tnData.tnFinal, crit: d20 === 20 };

        // 3. Message de toucher
        let content =
          `<b>${actor.name}</b> attaque <b>${targetToken.actor.name}</b> avec <b>${weapon.name}</b><br>` +
          `Jet : <b>${d20}</b> (TN ${tnData.tnFinal}+) — ` +
          `<b style="color:${hit ? (crit ? "gold" : "green") : "red"}">${crit ? "CRITIQUE !" : hit ? "TOUCHÉ !" : "RATÉ"}</b>`;

        // 4. Si touché → dégâts
        if (hit) {
          const dmgResult = await weapon.rollDamage({
            attackerActor: actor,
            targetActor:   targetToken.actor,
            isCrit:        crit,
            type:          tnData.livraison
          });

          content +=
            `<br>Dégâts bruts : ${dmgResult.beforeMitigation}` +
            (dmgResult.critBonus ? ` (<b>+${dmgResult.critBonus} crit</b>)` : "") +
            `<br>Après mitigation (−${dmgResult.fixe} fixe, −${dmgResult.pct}%) : <b>${dmgResult.final}</b>`;

          // 5. Applique les PV si API disponible
          if (combatAPI?.applyFinalDamage) {
            const pvRes = await combatAPI.applyFinalDamage({
              targetActor:  targetToken.actor,
              finalDamage:  dmgResult.final
            });
            content += `<br>${targetToken.actor.name} : ${pvRes.pvBefore} → <b>${pvRes.pvAfter}</b> PV`;
          }
        }

        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content
        });

        rerenderWeapons();
      } catch (e) {
        console.error("[RPG][Menu] Erreur attaque :", e);
        notify("error", `Erreur attaque : ${e?.message ?? e}`);
      } finally {
        btn.disabled = false;
      }
    });

    // ── Déclarer sort ──────────────────────────────────────────────────────
    $root.on("click.rpgMenu", "[data-action='declare']", async (ev) => {
      ev.preventDefault();
      const btn  = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      const row    = btn.closest("[data-item-id]");
      const item   = actor.items.get(row?.dataset?.itemId);
      if (!item) { btn.disabled = false; return notify("warn", "Sort introuvable."); }

      const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;

      try {
        const res = await spellAPI.declareSpell(actor, item, {
          casterToken: token ?? null,
          targetToken: targetToken ?? null
        });
        if (!res?.ok) {
          btn.disabled = false;
          return notify("warn", res?.reason ?? "Déclaration impossible.");
        }
        notify("info", `Sort déclaré : ${item.name}`);
        rerenderMana();
        rerenderSpells();
      } catch (e) {
        console.error(e);
        notify("error", `Erreur déclaration : ${e?.message ?? e}`);
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
