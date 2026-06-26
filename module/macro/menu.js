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
  const isMyTurn        = (a) => {
    const combat = getCombat();
    if (!combat || !combat.started) return true; // hors combat : pas de restriction
    const current = combat.combatant;
    if (!current) return true;
    if (game.user.isGM) return true; // le MJ peut toujours agir pour débogage/correction
    return current.actorId === a?.id;
  };
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

  const spellsPassif  = spellsAll.filter(s => s.system?.speed === "passif");
  const spellsActive  = spellsAll.filter(s => s.system?.speed !== "passif");
  const spellsRapide  = spellsActive.filter(s => s.system?.speed === "rapide" || s.system?.speed === "quick");
  const spellsNormal  = spellsActive.filter(s => s.system?.speed !== "rapide" && s.system?.speed !== "quick");

  if (!weaponsEquipped.length && !spellsAll.length)
    return notify("info", `${actor.name} n'a ni arme équipée ni sort.`);

  // ── état UI ────────────────────────────────────────────────────────────────
  const defaultSection = weaponsEquipped.length ? "weapons"
    : spellsNormal.length ? "spells_normal"
    : spellsRapide.length ? "spells_rapide"
    : spellsPassif.length ? "spells_passif"
    : "weapons";
  const state = { q: "", tab: "all", section: defaultSection };

  const THEME_SCOPE = "rpg";
  const THEME_FLAG  = "menuSpellsTheme";
  let theme = (game.user.getFlag(THEME_SCOPE, THEME_FLAG) ?? "light");
  if (theme !== "dark") theme = "light";

  // ── filtrage sorts ─────────────────────────────────────────────────────────
  const computeFilteredSpells = (src = null) => {
    const q = state.q.trim().toLowerCase();
    return (src ?? spellsActive).filter((s) => {
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

      // Vérification de portée (distance case caster -> cible)
      const portee = n(w.system?.portee, 1);
      let distCases = null;
      let outOfRange = false;
      if (token && targetToken && game.rpg?.measureDistance) {
        distCases = game.rpg.measureDistance(token.center, targetToken.center);
        outOfRange = distCases > portee;
      }

      const targets = Array.from(game.user.targets ?? []);
      const tooManyTargets = targets.length > 1;

      const reasons = [];
      if (atkBlocked) reasons.push("Slot Attaque épuisé pour ce tour");
      if (!hasTarget) reasons.push("Sélectionne une cible (T)");
      if (outOfRange) reasons.push(`Hors portée (${distCases} cases, portée ${portee})`);
      if (tooManyTargets) reasons.push(`Une seule cible utilisée (${targets.length} sélectionnées)`);

      const myTurn = isMyTurn(actor);
      const canAttack = myTurn && hasTarget && !atkBlocked && !outOfRange;
      if (!myTurn) reasons.unshift("Pas ton tour");
      const atkTitle  = reasons.join(" • ");

      return `
        <div class="rpg-spell-row" data-item-id="${w.id}" data-item-type="weapon">
          <img class="rpg-icon" src="${htmlEscape(w.img)}" />

          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(w.name)}">${htmlEscape(w.name)}</div>
              <div class="rpg-badges">
                <span class="badge b-ok">${livr}</span>
                <span class="badge b-info">${twoH}</span>
                ${atkBlocked ? `<span class="badge b-bad">SLOT ✗</span>` :
                  outOfRange ? `<span class="badge b-bad">PORTÉE ✗</span>` :
                  hasTarget ? `<span class="badge b-ok">CIBLE ✓</span>` : `<span class="badge b-warn">CIBLE</span>`}
              </div>
            </div>
            <div class="rpg-stats">
              <span>⚔️ Dégâts <b>${dmgTxt}</b></span>
              <span>${tnTxt}</span>
              <span>📏 Portée <b>${portee}</b>${distCases !== null ? ` (cible à ${distCases})` : ""}</span>
            </div>
            ${reasons.length ? `<div style="font-size:11px;color:#c0392b;margin-top:2px">${htmlEscape(atkTitle)}</div>` : ""}
          </div>

          <div class="rpg-right">
            <button type="button" class="rpg-open" data-action="open" title="Ouvrir la fiche">🔎</button>
            <button type="button"
              class="rpg-declare ${canAttack ? "btn-ok" : "btn-off"}"
              data-action="attack"
              title="${htmlEscape(atkTitle)}"
              ${canAttack ? "" : "disabled"}>
              Attaquer
            </button>
          </div>
        </div>
      `;
    }).join("");
  };

  // ── section SORTS ──────────────────────────────────────────────────────────
  const buildSpellsHTML = (spellsList = null) => {
    const manaNow  = getManaNow(actor);
    const filtered = computeFilteredSpells(spellsList ?? spellsActive);
    if (!filtered.length)
      return `<div class="rpg-empty">Aucun sort ne correspond aux filtres.</div>`;

    const targets     = Array.from(game.user.targets ?? []);
    const targetToken = targets[0] ?? null;
    const hasTarget    = targets.length > 0;

    return filtered.map((s) => {
      const sSys     = s.system ?? {};
      const cd       = getCD(s);
      const r        = getRange(s);
      const manaCost = getManaCost(s);
      const ready    = cd.restant <= 0;
      const aura     = isAura(s);
      const needTgt  = requiresTarget(s);
      const okMana   = manaNow >= manaCost;

      // ── Nombre de cibles requis ──────────────────────────────────────
      const tcMin = n(sSys.targetCount?.min, 1);
      const tcMax = n(sSys.targetCount?.max, 1);
      const tcCount = targets.length;
      let okTargetCount = true;
      let targetCountMsg = "";
      if (needTgt && (tcMin > 0 || tcMax > 0)) {
        if (tcCount < tcMin) {
          okTargetCount = false;
          targetCountMsg = `Nécessite au moins ${tcMin} cible(s) — ${tcCount} sélectionnée(s)`;
        } else if (tcMax > 0 && tcCount > tcMax) {
          okTargetCount = false;
          targetCountMsg = `Ne prend que ${tcMax} cible(s) max — ${tcCount} sélectionnée(s)`;
        }
      }

      // ── Portée : vérifie chaque cible sélectionnée ───────────────────
      let okRange = true;
      let rangeMsg = "";
      if (needTgt && token && targets.length && game.rpg?.measureDistance) {
        for (const t of targets) {
          const dist = game.rpg.measureDistance(token.center, t.center);
          if (dist < r.min || dist > r.max) {
            okRange = false;
            rangeMsg = `${t.actor?.name ?? t.name} hors portée (${dist} cases, ${r.min}–${r.max})`;
            break;
          }
        }
      }

      const okTarget = !needTgt || (hasTarget && okTargetCount && okRange);
      const slotKey  = sSys.speed === "rapide" || sSys.speed === "quick" ? "sortRapide" : "sortNormal";
      const hasSlot  = canUseSlot(actor, slotKey);
      const myTurn   = isMyTurn(actor);
      const canUse   = myTurn && ready && okMana && okTarget && hasSlot;
      const cdTxt    = cd.max > 0 ? `${cd.restant}/${cd.max}` : "—";

      const reasons = [];
      if (!myTurn) reasons.push("Pas ton tour");
      if (!ready) reasons.push(`En recharge (${cd.restant} tour(s))`);
      if (!okMana) reasons.push(`Mana insuffisant (${manaNow}/${manaCost})`);
      if (!hasSlot) reasons.push("Slot épuisé pour ce tour");
      if (needTgt && !hasTarget) reasons.push("Sélectionne une cible (T)");
      if (needTgt && !okTargetCount) reasons.push(targetCountMsg);
      if (needTgt && !okRange) reasons.push(rangeMsg);

      const tcTxt = (tcMin > 0 || tcMax > 0) ? `${tcMin}${tcMax !== tcMin ? `–${tcMax}` : ""}` : "—";

      return `
        <div class="rpg-spell-row" data-item-id="${s.id}" data-item-type="spell">
          <img class="rpg-icon" src="${htmlEscape(s.img)}" />
          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(s.name)}">${htmlEscape(s.name)}</div>
              <div class="rpg-badges">
                <span class="badge ${ready ? "b-ok" : "b-bad"}">${ready ? "PRÊT" : "EN CD"}</span>
                ${!hasSlot ? `<span class="badge b-bad">SLOT ✗</span>` : ""}
                ${needTgt ? `<span class="badge ${(hasTarget && okTargetCount && okRange) ? "b-ok" : "b-warn"}">CIBLE${(hasTarget && okTargetCount && okRange) ? " ✓" : ""}</span>` : ""}
                ${aura ? `<span class="badge b-aura">AURA</span>` : ""}
              </div>
            </div>
            <div class="rpg-stats">
              <span>💧 Mana <b class="${okMana ? "" : "bad"}">${manaCost}</b></span>
              <span>📏 Portée <b>${r.min}–${r.max}</b></span>
              <span>🎯 Cibles <b>${tcTxt}</b></span>
              <span>⏳ CD <b class="${ready ? "cd-ok" : "cd-bad"}">${cdTxt}</b></span>
            </div>
            ${reasons.length ? `<div style="font-size:11px;color:#c0392b;margin-top:2px">${htmlEscape(reasons.join(" • "))}</div>` : ""}
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

        <!-- Bannière tour actif -->
        ${(() => {
          const combat = getCombat();
          if (!combat || !combat.started || isMyTurn(actor)) return "";
          const currentName = combat.combatant?.actor?.name ?? combat.combatant?.name ?? "?";
          return `<div style="background:#c0392b;color:#fff;padding:6px 10px;border-radius:8px;
                       font-size:12px;font-weight:600;margin-bottom:8px;text-align:center">
                    ⏳ Ce n'est pas ton tour — c'est à <b>${htmlEscape(currentName)}</b> d'agir
                  </div>`;
        })()}

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
          const hasDepl = isMyTurn(actor) && canUseSlot(actor, "deplacement");
          return `<div style="margin-bottom:6px">
            <button type="button" data-action="move"
              style="width:100%;padding:5px 10px;border-radius:7px;cursor:pointer;font-size:12px;
                     background:${hasDepl ? "#1d9e75" : "#888"};color:#fff;border:none;opacity:${hasDepl ? "1" : "0.5"}"
              ${hasDepl ? "" : "disabled"}>
              🏃 Déclarer Déplacement (${actor.system?.deplacement?.vitesse ?? "?"} cases)
            </button>
          </div>`;
        })()}

        <!-- Bouton Récupération (réduit la fatigue, coûte 1 slot) -->
        ${(() => {
          const fatigueCur = actor.system?.ressources?.fatigue?.valeur ?? 0;
          const fatigueMax = actor.system?.ressources?.fatigue?.max ?? 10;
          const hasRecup = isMyTurn(actor) && canUseSlot(actor, "recuperation");
          return `<div style="margin-bottom:6px">
            <button type="button" data-action="recuperation"
              style="width:100%;padding:5px 10px;border-radius:7px;cursor:pointer;font-size:12px;
                     background:${hasRecup ? "#3a7bd5" : "#888"};color:#fff;border:none;opacity:${hasRecup ? "1" : "0.5"}"
              ${hasRecup ? "" : "disabled"}
              title="Réduit la fatigue de 3 (+1 par 20 Endurance) — coûte 1 action">
              🧘 Récupération — Fatigue ${fatigueCur}/${fatigueMax}
            </button>
          </div>`;
        })()}

        <!-- Section tabs -->
        <div class="rpg-section-tabs">
          ${weaponsEquipped.length ? `
          <button type="button" class="section-tab ${secWeapon ? "active" : ""}" data-section="weapons">
            ⚔️ Armes (${weaponsEquipped.length})
          </button>` : ""}
          ${spellsNormal.length ? `
          <button type="button" class="section-tab ${state.section === "spells_normal" ? "active" : ""}" data-section="spells_normal">
            ✨ Normaux (${spellsNormal.length})
          </button>` : ""}
          ${spellsRapide.length ? `
          <button type="button" class="section-tab ${state.section === "spells_rapide" ? "active" : ""}" data-section="spells_rapide">
            ⚡ Rapides (${spellsRapide.length})
          </button>` : ""}
          ${spellsPassif.length ? `
          <button type="button" class="section-tab ${state.section === "spells_passif" ? "active" : ""}" data-section="spells_passif">
            🔮 Passifs (${spellsPassif.length})
          </button>` : ""}
        </div>

        <!-- Section ARMES -->
        <div class="rpg-section" id="sec-weapons" ${state.section === "weapons" ? "" : 'style="display:none"'}>
          <div class="rpg-list rpg-weapons-list">
            ${buildWeaponsHTML()}
          </div>
        </div>

        <!-- Section SORTS NORMAUX -->
        <div class="rpg-section" id="sec-spells_normal" ${state.section === "spells_normal" ? "" : 'style="display:none"'}>
          <div class="rpg-filterbar">
            <input class="rpg-search" type="text" placeholder="Rechercher..." value="${htmlEscape(state.q)}" />
            <div class="rpg-tabs">
              ${["all","ready","cd","auras","target"].map(t =>
                `<button type="button" class="tab ${state.tab === t ? "active" : ""}" data-tab="${t}">${
                  {all:"Tous",ready:"Prêts",cd:"En CD",auras:"Auras",target:"Cible"}[t]
                }</button>`
              ).join("")}
            </div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0 6px">
            <b>1 sort normal</b> par tour • Coûte 1 slot
          </div>
          <div class="rpg-list rpg-spells-list">
            ${buildSpellsHTML(spellsNormal)}
          </div>
        </div>

        <!-- Section SORTS RAPIDES -->
        <div class="rpg-section" id="sec-spells_rapide" ${state.section === "spells_rapide" ? "" : 'style="display:none"'}>
          <div class="rpg-filterbar">
            <input class="rpg-search" type="text" placeholder="Rechercher..." value="${htmlEscape(state.q)}" />
            <div class="rpg-tabs">
              ${["all","ready","cd","auras","target"].map(t =>
                `<button type="button" class="tab ${state.tab === t ? "active" : ""}" data-tab="${t}">${
                  {all:"Tous",ready:"Prêts",cd:"En CD",auras:"Auras",target:"Cible"}[t]
                }</button>`
              ).join("")}
            </div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0 6px">
            <b>2 sorts rapides</b> par tour • 1 slot chacun
          </div>
          <div class="rpg-list rpg-spells-list">
            ${buildSpellsHTML(spellsRapide)}
          </div>
        </div>

        <!-- Section SORTS PASSIFS -->
        <div class="rpg-section" id="sec-spells_passif" ${state.section === "spells_passif" ? "" : 'style="display:none"'}>
          <div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0 6px">
            🔮 <b>Passifs</b> — toujours actifs, aucun slot requis. Toggle on/off.
          </div>
          <div class="rpg-list rpg-passif-list">
            ${buildPassifHTML()}
          </div>
        </div>

        <div class="rpg-hint">Cible un token (T) avant d'attaquer ou de lancer un sort ciblé.</div>

      </div>
    `;
  };

  // ── section PASSIFS ───────────────────────────────────────────────────────
  const buildPassifHTML = () => {
    if (!spellsPassif.length)
      return `<div class="rpg-empty">Aucun sort passif.</div>`;

    return spellsPassif.map((s) => {
      const sys      = s.system ?? {};
      const isActive = sys.speed === "passif"; // toujours actif par défaut
      // Le toggle contrôle si le passif est inclus dans sumBonuses via aura.active
      const toggled  = sys.aura?.active !== false; // true par défaut
      const color    = toggled ? "#1d9e75" : "#888";

      // Résumé des bonus du passif
      const bonuses  = sys.bonus ?? {};
      const bonusParts = [];
      for (const [k,v] of Object.entries(bonuses)) {
        if (Number(v) !== 0) bonusParts.push(`${k} ${v > 0 ? "+" : ""}${v}`);
      }
      const bonusTxt = bonusParts.slice(0,4).join(", ") || "Aucun bonus configuré";

      return `
        <div class="rpg-spell-row" data-item-id="${s.id}" data-item-type="passif"
          style="opacity:${toggled ? "1" : "0.5"}">
          <img class="rpg-icon" src="${htmlEscape(s.img)}" />
          <div class="rpg-mid">
            <div class="rpg-topline">
              <div class="rpg-name" title="${htmlEscape(s.name)}">${htmlEscape(s.name)}</div>
              <div class="rpg-badges">
                <span class="badge" style="background:${color}20;color:${color};font-weight:600">
                  ${toggled ? "ACTIF" : "INACTIF"}
                </span>
              </div>
            </div>
            <div class="rpg-stats" style="font-size:11px;color:var(--color-text-secondary)">
              ${bonusTxt}
            </div>
          </div>
          <div class="rpg-right">
            <button type="button" class="rpg-open" data-action="open" title="Ouvrir la fiche">🔎</button>
            <button type="button"
              class="rpg-declare"
              data-action="toggle-passif"
              data-toggled="${toggled}"
              style="background:${toggled ? "#888" : "#1d9e75"};color:#fff;border:none;border-radius:5px;
                     padding:3px 8px;cursor:pointer;font-size:11px">
              ${toggled ? "Désactiver" : "Activer"}
            </button>
          </div>
        </div>
      `;
    }).join("");
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
    const rerenderSpells  = (src) => $root.find(".rpg-spells-list").html(buildSpellsHTML(src));
    const rerenderPassif  = () => $root.find(".rpg-passif-list").html(buildPassifHTML());
    const rerenderMana    = () => $root.find(".rpg-mana-val").text(String(getManaNow(actor)));

    $root.off(".rpgMenu");

    // Section tabs
    $root.on("click.rpgMenu", ".section-tab", (ev) => {
      state.section = ev.currentTarget.dataset.section ?? "weapons";
      $root.find(".section-tab").removeClass("active");
      $(ev.currentTarget).addClass("active");
      $root.find(".rpg-section").hide();
      $root.find(`#sec-${state.section.replace("_", "\\-")}`).show();
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

      if (!isMyTurn(actor)) {
        btn.disabled = false;
        return notify("warn", "Ce n'est pas ton tour.");
      }

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

        // 3. TN calculé AVANT le jet, pour que le joueur sache combien il doit faire
        const tnData = combatAPI?.computeTN
          ? combatAPI.computeTN(actor, targetToken.actor, weapon)
          : { tnFinal: 11, tnBase: 11, diff: 0, livraison: "physique" };

        // 4. Jet d20 du joueur (visible dans le chat) — UNIQUEMENT le jet de touché,
        //    les dégâts ne sont lancés qu'après décision du MJ (cf. attack-resolve.js)
        const roll20 = await (new Roll("1d20")).evaluate();
        await roll20.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `⚔️ <b>${actor.name}</b> attaque <b>${targetToken.actor.name}</b> avec <b>${weapon.name}</b> — il faut faire <b>${tnData.tnFinal}+</b>`
        });
        const d20 = roll20.total;

        const isCrit  = d20 === 20;
        const isAutoF = d20 <= 5;
        const isAutoS = d20 >= 16;
        const suggested = isCrit ? "crit" : isAutoF ? "fail" : (isAutoS || d20 >= tnData.tnFinal) ? "hit" : "fail";

        // 5. Message pending — boutons DÉDIÉS Échec / Touché / Critique
        //    (même pattern que les sorts : le MJ choisit librement, pas d'auto-confirm)
        const pendingLabel = `Attaque : <b>${htmlEscape(weapon.name)}</b> → <b>${htmlEscape(targetToken.actor.name)}</b>`;
        const detail       = `🎲 d20 = <b>${d20}</b> (TN ${tnData.tnFinal}+) — ${
          isAutoF ? "Échec automatique (≤5)" : isAutoS ? "Succès automatique (≥16)" : isCrit ? "CRITIQUE !" : "résultat normal"
        }`;

        const msgContent = `
          <div class="rpg-attack-declare" style="font-size:13px;line-height:1.6">
            <div>${pendingLabel}</div>
            <div style="opacity:.85;margin-top:2px">${detail}</div>
            <div class="rpg-attack-gm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <button type="button" class="rpg-attack-resolve" data-result="critfail"
                style="flex:1;padding:4px 8px;cursor:pointer;color:#8b1a12;font-weight:700">Échec Critique</button>
              <button type="button" class="rpg-attack-resolve" data-result="fail"
                style="flex:1;padding:4px 8px;cursor:pointer">Échec</button>
              <button type="button" class="rpg-attack-resolve" data-result="hit"
                style="flex:1;padding:4px 8px;cursor:pointer">Touché</button>
              <button type="button" class="rpg-attack-resolve" data-result="crit"
                style="flex:1;padding:4px 8px;cursor:pointer;font-weight:700;color:gold">Critique !</button>
            </div>
          </div>`;

        const msg = await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: msgContent,
          flags: {
            rpg: {
              type: "attackDeclaration",
              actionId,
              attackDeclaration: {
                actorId: actor.id, weaponId: weapon.id, targetId: targetToken.actor.id,
                d20, tnFinal: tnData.tnFinal, livraison: tnData.livraison
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

      if (!isMyTurn(actor)) {
        btn.disabled = false;
        return notify("warn", "Ce n'est pas ton tour.");
      }

      const row  = btn.closest("[data-item-id]");
      const item = actor.items.get(row?.dataset?.itemId);
      if (!item) { btn.disabled = false; return notify("warn", "Sort introuvable."); }

      const targets      = Array.from(game.user.targets ?? []);
      const targetToken  = targets[0] ?? null; // rétrocompat affichage label
      const sys          = item.system ?? {};
      const speed        = String(sys.speed ?? "normal");
      const slot         = (speed === "rapide" || speed === "quick") ? "sortRapide" : "sortNormal";
      const manaCost     = n(sys.coutMana, 0);

      // Vérification budget
      const budgetAPI = getBudgetAPI();
      const combat    = getCombat();
      const cbt       = getCombatant(actor);
      if (budgetAPI && combat && cbt && !budgetAPI.canUseSlot(budgetAPI.getBudget(combat, cbt.id), slot)) {
        btn.disabled = false;
        return notify("warn", `Slot "${slot === "sortRapide" ? "Sort rapide" : "Sort normal"}" épuisé pour ce tour.`);
      }

      try {
        // 1. Snapshot AVANT (mana + cooldown + PV de TOUTES les cibles sélectionnées)
        const snapshot = {
          casterId:  actor.id,
          casterMana: n(actor.system?.ressources?.mana?.valeur, 0),
          // Rétrocompat (1ère cible) — utilisé par l'ancien format d'undo mono-cible
          targetId:   targetToken?.actor?.id ?? null,
          targetPv:   n(targetToken?.actor?.system?.ressources?.pv?.valeur, undefined),
          // ✅ Multi-cible : tableau de snapshots, un par cible touchée
          targetsSnapshot: targets
            .map(t => t.actor)
            .filter(Boolean)
            .map(a => ({ targetId: a.id, targetPv: n(a.system?.ressources?.pv?.valeur, 0) })),
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
            label: `${item.name}${targets.length ? " → " + targets.map(t => t.actor?.name ?? t.name).join(", ") : ""}`,
            actorId: actor.id, snapshot, timestamp: Date.now()
          });
        }

        // 3. Déclare via spellAPI (targetToken:null → lit lui-même TOUTES les cibles
        //    sélectionnées via game.user.targets, supporte le multi-cible)
        const res = await spellAPI.declareSpell(actor, item, {
          casterToken: token ?? null,
          targetToken: null,
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

    // ── Déclarer Récupération (réduit la fatigue de 3, coûte 1 slot en combat) ──
    $root.on("click.rpgMenu", "[data-action='recuperation']", async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      if (!isMyTurn(actor)) {
        btn.disabled = false;
        return notify("warn", "Ce n'est pas ton tour.");
      }

      const budgetAPI = getBudgetAPI();
      const combat    = getCombat();
      const cbt       = getCombatant(actor);
      const inCombat  = !!(budgetAPI && combat && cbt);

      if (inCombat && !budgetAPI.canUseSlot(budgetAPI.getBudget(combat, cbt.id), "recuperation")) {
        btn.disabled = false;
        return notify("warn", "Slot Récupération déjà utilisé ce tour.");
      }

      try {
        const actionId = foundry.utils.randomID();

        if (inCombat) {
          const budget    = budgetAPI.getBudget(combat, cbt.id);
          const newBudget = budgetAPI.reserveSlot(budget, "recuperation");
          await budgetAPI.saveBudget(combat, cbt.id, newBudget);
          await budgetAPI.addLogEntry(combat, cbt.id, {
            id: actionId, slot: "recuperation", status: "pending",
            label: `Récupération — ${actor.name}`,
            actorId: actor.id,
            snapshot: { casterId: actor.id, casterMana: undefined, targetId: null, targetPv: undefined, addedStateIds: [], cooldown: null },
            timestamp: Date.now()
          });
        }

        const fatigueCur = actor.system?.ressources?.fatigue?.valeur ?? 0;
        const confirmAPI = getConfirmAPI();
        const msgContent = confirmAPI
          ? confirmAPI.buildPendingMessage({
              actor: actor.name, label: `Prend un moment pour récupérer son souffle`,
              slotLabel: "Récupération", slotIcon: "🧘",
              detail: `Fatigue actuelle : ${fatigueCur}. Réduira de 3 si validé.`,
              actionId, type: "recuperation", outcome: "confirm"
            })
          : `<b>${actor.name}</b> récupère.`;

        const msg = await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: msgContent,
          flags: { rpg: { pendingAction: { type: "recuperation", actionId, outcome: "confirm" }, recuperationActorId: actor.id } }
        });

        if (inCombat) await budgetAPI.updateLogEntry(combat, actionId, { chatMessageId: msg.id });

        rerenderAll();
        notify("info", "Récupération déclarée — en attente du MJ.");
      } catch (e) {
        console.error("[RPG][Menu] Erreur récupération :", e);
        notify("error", `Erreur récupération : ${e?.message ?? e}`);
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

      if (!isMyTurn(actor)) {
        btn.disabled = false;
        return notify("warn", "Ce n'est pas ton tour.");
      }

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

    // ── Toggle sort passif ────────────────────────────────────────────────
    $root.on("click.rpgMenu", "[data-action='toggle-passif']", async (ev) => {
      ev.preventDefault();
      const btn    = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;

      const row    = btn.closest("[data-item-id]");
      const item   = actor.items.get(row?.dataset?.itemId);
      if (!item) { btn.disabled = false; return; }

      const waToggled = btn.dataset.toggled === "true";
      const newState  = !waToggled;

      try {
        // Logue le changement pour que le MJ puisse annuler
        const actionId = foundry.utils.randomID();
        const combat   = getCombat();
        const cbt      = getCombatant(actor);
        const budgetAPI = getBudgetAPI();

        if (budgetAPI && combat && cbt) {
          await budgetAPI.addLogEntry(combat, cbt.id, {
            id: actionId, slot: "sortPassif", status: "confirmed",
            label: `Passif ${newState ? "activé" : "désactivé"} : ${item.name}`,
            actorId: actor.id,
            snapshot: {
              casterId: actor.id,
              passifItemId: item.id,
              oldAuraActive: waToggled
            },
            timestamp: Date.now()
          });
        }

        // Toggle l'état
        await item.update({ "system.aura.active": newState });

        // Message dans le chat (logué pour MJ)
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div style="font-size:13px">
            🔮 <b>${item.name}</b> (passif) : <b style="color:${newState ? "#1d9e75" : "#888"}">${newState ? "Activé" : "Désactivé"}</b>
            ${budgetAPI && combat && cbt ? `<div style="margin-top:4px;text-align:right">
              <button type="button" data-action-undo data-action-id="${actionId}"
                style="font-size:11px;padding:2px 8px;cursor:pointer;opacity:0.7">
                ↩️ Annuler
              </button>
            </div>` : ""}
          </div>`,
          flags: budgetAPI && combat && cbt
            ? { rpg: { confirmedAction: true, actionId } }
            : {}
        });

        rerenderPassif();
        rerenderAll();
      } catch (e) {
        console.error("[RPG][Passif]", e);
        notify("error", `Erreur toggle passif : ${e?.message ?? e}`);
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
