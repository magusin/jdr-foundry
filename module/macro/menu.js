/**
 * Macro "Menu Sorts" (Foundry VTT v13)
 * - Liste les sorts du token contrôlé
 * - Filtres: recherche + Tous / Prêts / En CD / Auras / Cible (EN LIGNE)
 * - Bouton Déclarer (désactivé si non utilisable)
 * - Bouton 🔎 ouvre la fiche du sort
 * - Mana en haut à droite (token contrôlé)
 * - ✅ Toggle thème Clair/Sombre mémorisé par joueur
 *
 * IMPORTANT:
 * - Supporte Dialog (V1) et DialogV2
 * - N'utilise pas dlg.setPosition()
 * - Met à jour liste + mana via DOM
 */

(async () => {
  // ---------------- helpers ----------------
  const notify = (type, msg) => ui.notifications?.[type]?.(msg) ?? console.log(`[${type}]`, msg);

  const DialogClass =
    foundry?.applications?.api?.DialogV2 ??
    foundry?.applications?.api?.Dialog ??
    Dialog;

  const isV2 = DialogClass === foundry?.applications?.api?.DialogV2;

  const getControlledToken = () => canvas?.tokens?.controlled?.[0] ?? null;
  const getSpellAPI = () => globalThis.RPG_SPELLS ?? game.rpg?.spells ?? null;

  const n = (v, d = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };

  const htmlEscape = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // ---------------- actor/token/api ----------------
  const token = getControlledToken();
  const actor = token?.actor ?? null;
  if (!actor) return notify("warn", "Contrôle un token (PJ/monstre) avant d’ouvrir le menu des sorts.");

  const api = getSpellAPI();
  if (!api?.declareSpell) {
    console.error("RPG_SPELLS API:", api);
    return notify("error", "RPG_SPELLS.declareSpell introuvable. Vérifie init.js (globalThis.RPG_SPELLS).");
  }

  const getManaNow = (a) => n(a?.system?.ressources?.mana?.valeur, 0);
  const getManaCost = (item) => n(item?.system?.coutMana, 0);

  const getCD = (item) => {
    const sys = item?.system ?? {};
    const max = n(sys.cooldown?.max ?? sys.recharge?.max, 0);
    const restant = n(sys.cooldown?.restant ?? sys.recharge?.restant, 0);
    return { max, restant };
  };

  const getRange = (item) => {
    const sys = item?.system ?? {};
    const min = n(sys.range?.min, 0);
    const max = n(sys.range?.max, 0);
    return { min, max };
  };

  const isAura = (item) => !!(item?.system?.aura?.active || item?.system?.aura?.enabled);

  // “CIBLE” = sort qui a besoin d’une cible (dégâts OU aura)
  const requiresTarget = (item) => {
    const sys = item?.system ?? {};
    const hasDmg = !!sys.damage?.enabled;
    const hasAura = !!(sys.aura?.active || sys.aura?.enabled);
    return hasDmg || hasAura;
  };

  // ---------------- spells list ----------------
  const spellsAll = actor.items
    .filter((i) => i.type === "spell")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!spellsAll.length) return notify("info", `${actor.name} n'a aucun sort.`);

  const state = { q: "", tab: "all" }; // all | ready | cd | auras | target

  // ✅ thème mémorisé par joueur
  const THEME_SCOPE = "rpg";
  const THEME_FLAG = "menuSpellsTheme";
  let theme = (game.user.getFlag(THEME_SCOPE, THEME_FLAG) ?? "light");
if (theme !== "dark") theme = "light";

  const computeFiltered = () => {
    const q = state.q.trim().toLowerCase();
    return spellsAll.filter((s) => {
      const name = (s.name ?? "").toLowerCase();
      if (q && !name.includes(q)) return false;

      const cd = getCD(s);
      const ready = cd.restant <= 0;
      const aura = isAura(s);
      const needTarget = requiresTarget(s);

      if (state.tab === "ready" && !ready) return false;
      if (state.tab === "cd" && ready) return false;
      if (state.tab === "auras" && !aura) return false;
      if (state.tab === "target" && !needTarget) return false;

      return true;
    });
  };

  const buildRowsHTML = () => {
    const manaNow = getManaNow(actor);
    const filtered = computeFiltered();

    if (!filtered.length) return `<div class="rpg-empty">Aucun sort ne correspond aux filtres.</div>`;

    const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
    const hasTarget = !!targetToken;

    return filtered.map((s) => {
      const cd = getCD(s);
      const r = getRange(s);
      const manaCost = getManaCost(s);

      const ready = cd.restant <= 0;
      const aura = isAura(s);
      const needTarget = requiresTarget(s);

      const okMana = manaNow >= manaCost;
      const okTarget = !needTarget || hasTarget;
      const canUse = ready && okMana && okTarget;

      const cdTxt = cd.max > 0 ? `${cd.restant}/${cd.max}` : "—";
      const cdClass = ready ? "cd-ok" : "cd-bad";

      const badges = `
        <div class="rpg-badges">
          <span class="badge ${ready ? "b-ok" : "b-bad"}">${ready ? "PRÊT" : "EN CD"}</span>
          ${needTarget ? `<span class="badge ${hasTarget ? "b-ok" : "b-warn"}">CIBLE${hasTarget ? " ✓" : ""}</span>` : ``}
          ${aura ? `<span class="badge b-aura">AURA</span>` : ``}
        </div>
      `;

      return `
        <div class="rpg-spell-row" data-item-id="${s.id}">
          <img class="rpg-icon" src="${htmlEscape(s.img)}" />

          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(s.name)}">${htmlEscape(s.name)}</div>
              ${badges}
            </div>

            <div class="rpg-stats">
              <span>💧 Mana <b class="${okMana ? "" : "bad"}">${manaCost}</b></span>
              <span>📏 Portée <b>${r.min}–${r.max}</b></span>
              <span>⏳ CD <b class="${cdClass}">${cdTxt}</b></span>
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

  const buildContent = () => {
    const manaNow = getManaNow(actor);
    const themeIcon = theme === "light" ? "☀︎" : "🌙";
    const themeTitle = theme === "light" ? "Thème clair" : "Thème sombre";

    return `
      <div class="rpg-spell-menu ${theme === "light" ? "rpg-theme-light" : "rpg-theme-dark"}">
        <div class="rpg-head">
          <div class="rpg-sub">
            Acteur: <b>${htmlEscape(actor.name)}</b> • Token: <b>${htmlEscape(token.name)}</b>
          </div>

          <div style="display:flex; align-items:center; gap:10px;">
            <button type="button"
              class="rpg-theme-toggle"
              data-action="toggleTheme"
              title="${themeTitle}"
              style="width:40px;height:34px;border-radius:10px;cursor:pointer;">
              ${themeIcon}
            </button>

            <div class="rpg-mana">💧 Mana: <b class="rpg-mana-val">${manaNow}</b></div>
          </div>
        </div>

        <div class="rpg-filterbar">
          <input class="rpg-search" type="text" placeholder="Rechercher un sort..." value="${htmlEscape(state.q)}" />
          <div class="rpg-tabs">
            <button type="button" class="tab ${state.tab === "all" ? "active" : ""}" data-tab="all">Tous</button>
            <button type="button" class="tab ${state.tab === "ready" ? "active" : ""}" data-tab="ready">Prêts</button>
            <button type="button" class="tab ${state.tab === "cd" ? "active" : ""}" data-tab="cd">En CD</button>
            <button type="button" class="tab ${state.tab === "auras" ? "active" : ""}" data-tab="auras">Auras</button>
            <button type="button" class="tab ${state.tab === "target" ? "active" : ""}" data-tab="target">Cible</button>
          </div>
        </div>

        <div class="rpg-list">
          ${buildRowsHTML()}
        </div>

        <div class="rpg-hint">
          Astuce: cible une cible (T) avant de déclarer si le sort indique <b>CIBLE</b>.
        </div>
      </div>
    `;
  };

  // ---------------- bind UI after render ----------------
  const bindUI = (dlg) => {
    const el =
      dlg?.element instanceof HTMLElement ? dlg.element :
      dlg?.element?.[0] instanceof HTMLElement ? dlg.element[0] :
      dlg?.element?.get?.(0) instanceof HTMLElement ? dlg.element.get(0) :
      null;

    if (!el) {
      console.warn("[RPG][MenuSorts] Impossible de récupérer dlg.element pour binder les events.");
      return;
    }

    const $root = $(el);

    const rerenderListOnly = () => $root.find(".rpg-list").html(buildRowsHTML());
    const rerenderManaOnly = () => $root.find(".rpg-mana-val").text(String(getManaNow(actor)));
    const rerenderAll = () => $root.find(".window-content, .content, .dialog-content").first().html(buildContent());

    // évite double-bind si Foundry rerender
    $root.off(".rpgMenuSorts");

    $root.on("input.rpgMenuSorts", ".rpg-search", (ev) => {
      state.q = String(ev.currentTarget.value ?? "");
      rerenderListOnly();
    });

    $root.on("click.rpgMenuSorts", ".tab", (ev) => {
      state.tab = ev.currentTarget.dataset.tab ?? "all";
      $root.find(".tab").removeClass("active");
      $(ev.currentTarget).addClass("active");
      rerenderListOnly();
    });

    $root.on("click.rpgMenuSorts", "[data-action='open']", (ev) => {
      ev.preventDefault();
      const row = ev.currentTarget.closest(".rpg-spell-row");
      const itemId = row?.dataset?.itemId;
      const item = actor.items.get(itemId);
      item?.sheet?.render(true);
    });

    $root.on("click.rpgMenuSorts", "[data-action='declare']", async (ev) => {
      ev.preventDefault();

      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      const row = btn.closest(".rpg-spell-row");
      const itemId = row?.dataset?.itemId;
      const item = actor.items.get(itemId);

      if (!item) {
        btn.disabled = false;
        return notify("warn", "Sort introuvable.");
      }

      const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;

      try {
        const res = await api.declareSpell(actor, item, {
          casterToken: token ?? null,
          targetToken: targetToken ?? null
        });

        if (!res?.ok) {
          btn.disabled = false;
          return notify("warn", res?.reason ?? "Déclaration impossible.");
        }

        notify("info", `Sort déclaré: ${item.name}`);
        rerenderManaOnly();
        rerenderListOnly();
      } catch (e) {
        console.error(e);
        notify("error", `Erreur déclaration sort: ${e?.message ?? e}`);
      } finally {
        btn.disabled = false;
      }
    });

    // ✅ Toggle thème
    $root.on("click.rpgMenuSorts", "[data-action='toggleTheme']", async (ev) => {
      ev.preventDefault();
      theme = (theme === "light") ? "dark" : "light";
      await game.user.setFlag(THEME_SCOPE, THEME_FLAG, theme);

      // on remplace le contenu complet (comme ça le header + icône changent)
      rerenderAll();

      // rebinde (car on vient d'écraser le HTML)
      bindUI(dlg);
    });
  };

  // ---------------- create dialog ----------------
  const dlgConfig = {
    title: `Menu Sorts — ${actor.name}`,
    content: buildContent(),
    default: "close"
  };

  // ✅ OBLIGATOIRE : au moins 1 bouton, sinon crash
if (isV2) {
  dlgConfig.buttons = [{ action: "close", label: "Fermer", default: true }];
} else {
  dlgConfig.buttons = { close: { label: "Fermer" } };
}

  const dlg = new DialogClass(dlgConfig, { width: 1100, height: 620, resizable: true });

  await dlg.render(true);
  await new Promise((r) => setTimeout(r, 0));
  bindUI(dlg);
})();