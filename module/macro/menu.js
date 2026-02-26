/**
 * Macro "Menu Sorts" (Foundry VTT v13)
 * - Liste les sorts du token contrôlé
 * - Filtres: recherche + Tous / Prêts / En CD / Auras / CIBLE (EN LIGNE)
 * - Bouton Déclarer (désactivé si non utilisable)
 * - Bouton 🔎 ouvre la fiche du sort
 * - Mana affichée en haut à droite: actor.system.ressources.mana.valeur
 */

(async () => {
    const notify = (type, msg) => ui.notifications?.[type]?.(msg) ?? console.log(`[${type}]`, msg);
  
    const getControlledToken = () => canvas?.tokens?.controlled?.[0] ?? null;
    const getSpellAPI = () => globalThis.RPG_SPELLS ?? game.rpg?.spells ?? null;
  
    const n = (v, d = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : d;
    };
  
    const getManaNow = (actor) => n(actor?.system?.ressources?.mana?.valeur, 0);
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
  
    const requiresTarget = (item) => {
      const sys = item?.system ?? {};
      const hasDmg = !!sys.damage?.enabled;
      const hasAura = !!(sys.aura?.active || sys.aura?.enabled);
      const hasFx = Array.isArray(sys.effectsUI) && sys.effectsUI.length > 0;
      return hasDmg || hasAura || hasFx;
    };
  
    const htmlEscape = (s) =>
      String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
  
    const token = getControlledToken();
    const actor = token?.actor ?? null;
    if (!actor) return notify("warn", "Contrôle un token (PJ/monstre) avant d’ouvrir le menu des sorts.");
  
    const api = getSpellAPI();
    if (!api?.declareSpell) {
      console.error("RPG_SPELLS API:", api);
      return notify("error", "RPG_SPELLS.declareSpell introuvable. Vérifie init.js (globalThis.RPG_SPELLS).");
    }
  
    const spellsAll = actor.items
      .filter((i) => i.type === "spell")
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));
    if (!spellsAll.length) return notify("info", `${actor.name} n'a aucun sort.`);
  
    const state = { q: "", tab: "all" }; // all | ready | cd | auras | target
  
    const buildRowsHTML = () => {
      const manaNow = getManaNow(actor);
      const filtered = spellsAll.filter((s) => {
        const name = (s.name ?? "").toLowerCase();
        const q = state.q.trim().toLowerCase();
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
  
      if (!filtered.length) return `<div class="rpg-empty">Aucun sort ne correspond aux filtres.</div>`;
  
      return filtered
        .map((s) => {
          const cd = getCD(s);
          const r = getRange(s);
          const manaCost = getManaCost(s);
  
          const ready = cd.restant <= 0;
          const aura = isAura(s);
          const needTarget = requiresTarget(s);
  
          const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
          const hasTarget = !!targetToken;
  
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
                  ${canUse ? "" : "disabled"}
                  title="${canUse ? "Déclarer le sort" : (!okMana ? "Mana insuffisant" : (!okTarget ? "Cible requise (T)" : "Sort en cooldown"))}">
                  Déclarer
                </button>
              </div>
            </div>
          `;
        })
        .join("");
    };
  
    const buildContent = () => {
      const manaNow = getManaNow(actor);
  
      return `
        <div class="rpg-spell-menu">
          <div class="rpg-head">
            <div class="rpg-sub">
              Acteur: <b>${htmlEscape(actor.name)}</b> • Token: <b>${htmlEscape(token.name)}</b>
            </div>
            <div class="rpg-mana">💧 Mana: <b>${manaNow}</b></div>
          </div>
  
          <!-- ✅ FILTRES EN COLONNE (search puis tabs en ligne) -->
          <div class="rpg-filterbar">
            <input class="rpg-search" type="text" placeholder="Rechercher un sort..." value="${htmlEscape(state.q)}" />
  
            <div class="rpg-tabs">
              <button type="button" class="tab ${state.tab === "all" ? "active" : ""}" data-tab="all">Tous</button>
              <button type="button" class="tab ${state.tab === "ready" ? "active" : ""}" data-tab="ready">Prêts</button>
              <button type="button" class="tab ${state.tab === "cd" ? "active" : ""}" data-tab="cd">En CD</button>
              <button type="button" class="tab ${state.tab === "auras" ? "active" : ""}" data-tab="auras">Auras</button>
              <button type="button" class="tab ${state.tab === "target" ? "active" : ""}" data-tab="target">CIBLE</button>
            </div>
          </div>
  
          <div class="rpg-list">
            ${buildRowsHTML()}
          </div>
  
          <div class="rpg-hint">
            Astuce: cible une cible (T) avant de déclarer si le sort indique <b>CIBLE</b>.
          </div>
        </div>
  
        <style>
          .rpg-spell-menu { font-family: inherit; }
          .rpg-spell-menu * { box-sizing: border-box; }
  
          .rpg-spell-menu .rpg-head {
            display:flex; align-items:center; justify-content:space-between;
            margin-bottom:10px;
          }
          .rpg-spell-menu .rpg-sub { opacity:.85; font-size:12px; }
          .rpg-spell-menu .rpg-mana { font-size:14px; opacity:.9; }
  
          /* ✅ nouveau layout filtres */
          .rpg-spell-menu .rpg-filterbar{
            display:flex;
            flex-direction:column;
            gap:10px;
            margin-bottom:12px;
          }
          .rpg-spell-menu .rpg-search {
            width:100%;
            padding:8px 10px;
            border-radius:999px;
          }
          /* ✅ BOUTONS TOUS SUR 1 LIGNE */
  .rpg-spell-menu .rpg-tabs{
    display:flex;
    flex-wrap:nowrap;        /* PAS de retour à la ligne */
    gap:10px;
    align-items:center;
    justify-content:flex-start;
    overflow-x:auto;         /* si trop de boutons -> scroll horizontal */
    padding-bottom:2px;
  }
          .rpg-spell-menu .tab{
    flex:0 0 auto;           /* empêche de prendre toute la largeur */
    width:auto !important;   /* écrase les styles Foundry */
    display:inline-flex;     /* empêche le mode block */
    align-items:center;
    justify-content:center;
    white-space:nowrap;      /* texte sur une ligne */
    padding:6px 12px;
    border-radius:999px;
    cursor:pointer;
    border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.06);
  }
  
  .rpg-spell-menu .tab.active{
    outline:2px solid rgba(80,160,255,.35);
    background:rgba(80,160,255,.10);
  }
  
          .rpg-spell-menu .rpg-list {
            max-height: 520px;
            overflow:auto;
            padding-right:6px;
          }
  
          .rpg-spell-menu .rpg-spell-row{
            display:flex; align-items:center; gap:12px;
            padding:10px 12px;
            border:1px solid rgba(255,255,255,.14);
            border-radius:14px;
            background:rgba(255,255,255,.03);
            margin-bottom:10px;
          }
          .rpg-spell-menu .rpg-icon{
            width:46px; height:46px; border-radius:12px; object-fit:cover;
            border:1px solid rgba(255,255,255,.15);
            flex:0 0 auto;
          }
          .rpg-spell-menu .rpg-mid{ flex:1; min-width:0; }
          .rpg-spell-menu .rpg-topline{
            display:flex; align-items:center; justify-content:space-between; gap:10px;
            margin-bottom:4px;
          }
          .rpg-spell-menu .rpg-name{
            font-weight:800;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
            max-width: 420px;
          }
  
          .rpg-spell-menu .rpg-badges{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
          .rpg-spell-menu .badge{
            font-size:11px; padding:4px 10px; border-radius:999px;
            border:1px solid rgba(255,255,255,.18);
            background:rgba(255,255,255,.05);
            opacity:.95;
          }
          .rpg-spell-menu .b-ok{ background:rgba(40,170,90,.16); border-color:rgba(40,170,90,.35); }
          .rpg-spell-menu .b-bad{ background:rgba(200,60,60,.14); border-color:rgba(200,60,60,.35); }
          .rpg-spell-menu .b-warn{ background:rgba(220,160,40,.14); border-color:rgba(220,160,40,.35); }
          .rpg-spell-menu .b-aura{ background:rgba(120,80,220,.14); border-color:rgba(120,80,220,.35); }
  
          .rpg-spell-menu .rpg-stats{
            display:flex; gap:14px; flex-wrap:wrap;
            font-size:12px; opacity:.9;
          }
          .rpg-spell-menu .cd-ok{ color:#16c172; }
          .rpg-spell-menu .cd-bad{ color:#d14c4c; }
          .rpg-spell-menu .bad{ color:#d14c4c; }
  
          .rpg-spell-menu .rpg-right{
            display:flex; align-items:center; gap:10px;
            flex:0 0 auto;
          }
          .rpg-spell-menu .rpg-open{
            width:40px; height:40px; border-radius:12px; cursor:pointer;
            border:1px solid rgba(255,255,255,.18);
            background:rgba(255,255,255,.06);
          }
          .rpg-spell-menu .rpg-declare{
            min-width:170px; height:44px;
            border-radius:14px;
            font-weight:800;
            cursor:pointer;
            border:1px solid rgba(255,255,255,.18);
            background:rgba(255,255,255,.06);
          }
          .rpg-spell-menu .btn-ok{
            background:rgba(40,170,90,.18);
            border-color:rgba(40,170,90,.35);
          }
          .rpg-spell-menu .btn-off{
            opacity:.45;
            cursor:not-allowed;
          }
  
          .rpg-spell-menu .rpg-empty{ opacity:.75; padding:10px; }
          .rpg-spell-menu .rpg-hint{ margin-top:10px; font-size:12px; opacity:.75; }
          .rpg-spell-menu .rpg-tabs::-webkit-scrollbar{ height:6px; }
  .rpg-spell-menu .rpg-tabs::-webkit-scrollbar-thumb{ border-radius:999px; }
        </style>
      `;
    };
  
    const dlg = new Dialog(
      {
        title: `Menu Sorts — ${actor.name}`,
        content: buildContent(),
        buttons: { close: { label: "Fermer" } },
        default: "close",
        render: (html) => {
          const rerenderList = () => html.find(".rpg-list").html(buildRowsHTML());
  
          html.find(".rpg-search").on("input", (ev) => {
            state.q = String(ev.currentTarget.value ?? "");
            rerenderList();
          });
  
          html.find(".tab").on("click", (ev) => {
            state.tab = ev.currentTarget.dataset.tab ?? "all";
            html.find(".tab").removeClass("active");
            $(ev.currentTarget).addClass("active");
            rerenderList();
          });
  
          html.on("click", "[data-action='open']", (ev) => {
            ev.preventDefault();
            const row = ev.currentTarget.closest(".rpg-spell-row");
            const itemId = row?.dataset?.itemId;
            const item = actor.items.get(itemId);
            if (item) item.sheet?.render(true);
          });
  
          html.on("click", "[data-action='declare']", async (ev) => {
            ev.preventDefault();
            const row = ev.currentTarget.closest(".rpg-spell-row");
            const itemId = row?.dataset?.itemId;
            const item = actor.items.get(itemId);
            if (!item) return notify("warn", "Sort introuvable.");
  
            const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;
  
            try {
              const res = await api.declareSpell(actor, item, {
                casterToken: token ?? null,
                targetToken: targetToken ?? null
              });
  
              if (!res?.ok) return notify("warn", res?.reason ?? "Déclaration impossible.");
              notify("info", `Sort déclaré: ${item.name}`);
  
              dlg.data.content = buildContent();
              dlg.render(false);
              dlg.setPosition({ width: 1100, height: 620 });
            } catch (e) {
              console.error(e);
              notify("error", `Erreur déclaration sort: ${e?.message ?? e}`);
            }
          });
        }
      },
      { width: 1100, height: 620, resizable: true }
    );
  
    dlg.render(true);
    dlg.setPosition({ width: 1100, height: 620 });
  })();