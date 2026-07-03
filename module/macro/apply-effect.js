/**
 * Macro "JDR — Appliquer un Effet (MJ)" v2.0
 *
 * Affiche la liste complète des effets nommés du catalogue, avec un aperçu
 * de ce que chaque effet fait (dégâts, bonus/malus, etc.) et permet au MJ
 * d'en personnaliser les valeurs clés sur place avant d'appliquer (durée,
 * intensité, difficulté de retrait, aura ou non).
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const lib    = game.rpg?.effectLibrary;
  const resAPI = game.rpg?.resistances;
  const builderAPI = game.rpg?.stateBuilder;
  if (!lib || !resAPI) { ui.notifications.error("API effectLibrary/resistances introuvable."); return; }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  const targets = Array.from(game.user.targets ?? []);
  const tokens  = targets.length ? targets : (canvas?.tokens?.controlled ?? []);
  if (!tokens.length) { ui.notifications.warn("Cible ou contrôle au moins un token."); return; }

  const DIFF = builderAPI?.DIFFICULTY_TIERS ?? {
    null:           { label: "Pas de retrait possible", tn: null },
    trivial:        { label: "Trivial (TN 6+)", tn: 6 },
    facile:         { label: "Facile (TN 9+)", tn: 9 },
    moyen:          { label: "Moyen (TN 11+)", tn: 11 },
    difficile:      { label: "Difficile (TN 14+)", tn: 14 },
    tresDifficile:  { label: "Très difficile (TN 17+)", tn: 17 },
    quasiImpossible:{ label: "Quasi impossible (TN 19+)", tn: 19 }
  };
  const DIFF_OPTIONS = ["", "trivial","facile","moyen","difficile","tresDifficile","quasiImpossible"]
    .map(k => {
      const label = k === "" ? "— Pas de retrait par jet —" : DIFF[k]?.label ?? k;
      return `<option value="${k}">${htmlEscape(label)}</option>`;
    }).join("");

  const STAT_LABELS = {
    force:"Force", intelligence:"Intelligence", dexterite:"Dextérité", acuite:"Acuité", endurance:"Endurance",
    armureFixe:"Armure fixe", resistanceFixe:"Résistance fixe", scoreArmure:"Score Armure",
    scoreResistance:"Score Résistance", pvMax:"PV max", manaMax:"Mana max",
    regenPv:"Régén PV", regenMana:"Régén Mana", vitesse:"Vitesse", initiativeMod:"Initiative",
    toucherPhysique:"Toucher phys.", toucherMagique:"Toucher mag.",
    fatigueMax:"Fatigue max", podsMax:"Pods max"
  };

  const effects = lib.listEffects();

  // ─── Construction du résumé lisible d'un effet ────────────────────────
  const summarize = (def) => {
    const parts = [];
    if (def.dot?.perTick > 0) parts.push(`${def.dot.perTick} dégâts/tour`);
    if (def.dot?.perTick < 0) parts.push(`${Math.abs(def.dot.perTick)} soin/tour`);
    for (const [stat, v] of Object.entries(def.mods ?? {})) {
      const name = STAT_LABELS[stat] ?? stat;
      if (v.flat) parts.push(`${v.flat > 0 ? "+" : ""}${v.flat} ${name}`);
      if (v.pct)  parts.push(`${v.pct > 0 ? "+" : ""}${v.pct}% ${name}`);
    }
    return parts.length ? parts.join(", ") : "Aucun effet chiffré";
  };

  // ─── Groupement par tag ────────────────────────────────────────────────
  const BY_TAG = {};
  for (const e of effects) {
    const g = e.tag ?? "autre";
    if (!BY_TAG[g]) BY_TAG[g] = [];
    BY_TAG[g].push(e);
  }
  const TAG_LABEL = { feu:"🔥 Feu", air:"🌬️ Air", eau:"💧 Eau", glace:"❄️ Glace",
                      eclair:"⚡ Éclair", terre:"🌿 Terre", magique:"✨ Magique",
                      physique:"⚔️ Physique", autre:"📦 Autre" };

  const effectOptions = Object.entries(BY_TAG).map(([tag, list]) => {
    const opts = list.map(e =>
      `<option value="${e.key}" data-duration="${e.defaultDuration}" data-diff="${e.removeDifficulty ?? ""}"
        data-dot="${n(e.dot?.perTick,0)}" data-summary="${htmlEscape(summarize(e))}" data-tag="${e.tag ?? ""}">
        ${htmlEscape(e.label)}
      </option>`
    ).join("");
    return `<optgroup label="${TAG_LABEL[tag] ?? tag}">${opts}</optgroup>`;
  }).join("");

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Cible(s) : <b>${tokens.map(t => htmlEscape(t.actor?.name ?? t.name)).join(", ")}</b>
      </div>

      <div>
        <label style="font-weight:700;display:block;margin-bottom:4px">Effet</label>
        <select id="ae-effect" style="width:100%">${effectOptions}</select>
      </div>

      <div id="ae-preview" style="font-size:11px;padding:6px;border-radius:6px;background:rgba(255,255,255,0.05)">
        <span id="ae-preview-txt"></span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Durée (tours)</label>
          <input id="ae-duration" type="number" min="1" style="width:100%" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Difficulté de retrait</label>
          <select id="ae-diff" style="width:100%">${DIFF_OPTIONS}</select>
        </div>
      </div>

      <hr/>
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">Modifier les valeurs (optionnel)</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-size:11px">Dégâts/tour (négatif = soin)</label>
          <input id="ae-dot" type="number" value="0" style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px">Fatigue/tour (négatif = repos)</label>
          <input id="ae-fatigue" type="number" value="0" style="width:100%" />
        </div>
      </div>

      <div>
        <div style="font-size:11px;font-weight:700;margin-bottom:4px">Bonus / Malus de stat supplémentaires</div>
        <div id="ae-mods-list"></div>
        <button type="button" id="ae-add-mod" style="font-size:11px;cursor:pointer;margin-top:2px">+ Ajouter une stat</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <input id="ae-permanent" type="checkbox" />
          <label style="font-size:11px">Permanent</label>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <input id="ae-aura" type="checkbox" />
          <label style="font-size:11px">Aura</label>
        </div>
      </div>
      <div id="ae-aura-fields" style="display:none;gap:8px">
        <div style="display:flex;gap:8px">
          <label style="flex:1;font-size:11px">Portée min<input id="ae-aura-min" type="number" min="0" value="0" style="width:100%"/></label>
          <label style="flex:1;font-size:11px">Portée max<input id="ae-aura-max" type="number" min="0" value="3" style="width:100%"/></label>
        </div>
      </div>
    </div>`;

  const STAT_OPTIONS = Object.entries(STAT_LABELS)
    .map(([k,v]) => `<option value="${k}">${htmlEscape(v)}</option>`).join("");

  let modIdx = 0;
  const makeModRow = () => {
    const idx = modIdx++;
    return `<div class="ae-mod-row" style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
      <select class="ae-mod-stat" style="flex:2">${STAT_OPTIONS}</select>
      <input type="number" class="ae-mod-flat" placeholder="Fixe" value="0" style="flex:1;width:55px"/>
      <input type="number" class="ae-mod-pct" placeholder="%" value="0" style="flex:1;width:50px"/>
      <button type="button" class="ae-mod-del" style="cursor:pointer">✕</button>
    </div>`;
  };

  new Dialog({
    title: "Appliquer un Effet (MJ)",
    content,
    buttons: {
      apply: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const effectKey = root.querySelector("#ae-effect").value;
          const duration  = Number(root.querySelector("#ae-duration").value) || 1;
          const diffKey   = root.querySelector("#ae-diff").value || null;
          const dotOverride = Number(root.querySelector("#ae-dot").value) || null;
          const fatiguePerTick = Number(root.querySelector("#ae-fatigue").value) || 0;
          const permanent = root.querySelector("#ae-permanent").checked;
          const isAura    = root.querySelector("#ae-aura").checked;
          const auraMin   = Number(root.querySelector("#ae-aura-min")?.value) || 0;
          const auraMax   = Number(root.querySelector("#ae-aura-max")?.value) || 0;

          const extraMods = {};
          root.querySelectorAll(".ae-mod-row").forEach(row => {
            const stat = row.querySelector(".ae-mod-stat").value;
            const flat = Number(row.querySelector(".ae-mod-flat").value) || 0;
            const pct  = Number(row.querySelector(".ae-mod-pct").value) || 0;
            if (stat && (flat || pct)) {
              extraMods[stat] = { flat, pct };
            }
          });

          // Construit l'état depuis le catalogue, puis surcharge les valeurs MJ
          const base = lib.buildStateFromLibrary(effectKey, { duration });
          if (!base) { ui.notifications.error("Effet introuvable."); return; }

          if (dotOverride !== null) { base.dot.flat = dotOverride; base.dot.perTick = dotOverride; }
          if (fatiguePerTick) base.dot.fatiguePerTick = fatiguePerTick;
          if (Object.keys(extraMods).length) {
            for (const [k, v] of Object.entries(extraMods)) {
              if (!base.mods[k]) base.mods[k] = { flat: 0, pct: 0 };
              base.mods[k].flat += v.flat;
              base.mods[k].pct  += v.pct;
            }
          }
          if (diffKey) base.removeDifficulty = diffKey;
          base.permanent = permanent;
          base.isAura = isAura;
          if (isAura) base.aura = { min: auraMin, max: auraMax, key: base.label };

          const results = [];
          for (const token of tokens) {
            const actor = token.actor;
            if (!actor) continue;
            const res = await resAPI.addStateWithResistance(actor, base);
            results.push({ name: actor.name, applied: res.applied, resisted: res.resisted });
          }

          if (isAura && game.rpg?.auras) await game.rpg.auras.refreshAuras();

          const def = lib.getEffectDef(effectKey);
          const tn  = diffKey ? (DIFF[diffKey]?.tn ?? null) : null;
          const lines = results.map(r =>
            r.resisted
              ? `<li>🛡️ ${htmlEscape(r.name)} résiste à <b>${htmlEscape(def?.label ?? effectKey)}</b></li>`
              : `<li>${htmlEscape(r.name)} : <b>${htmlEscape(def?.label ?? effectKey)}</b> (${duration} tour${duration > 1 ? "s" : ""}${tn ? `, retrait TN ${tn}+` : ""})</li>`
          ).join("");

          await ChatMessage.create({
            content: `<div style="font-size:13px">⚗️ <b>${htmlEscape(def?.label ?? effectKey)}</b><ul>${lines}</ul></div>`
          });
          ui.notifications.info("Effet appliqué.");
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "apply",
    render: (html) => {
      const root = html?.[0] ?? html;
      const sel  = root.querySelector("#ae-effect");
      const durIn = root.querySelector("#ae-duration");
      const diffSel = root.querySelector("#ae-diff");
      const dotIn   = root.querySelector("#ae-dot");
      const prevTxt = root.querySelector("#ae-preview-txt");

      const refresh = () => {
        const opt = sel.options[sel.selectedIndex];
        if (!opt) return;
        durIn.value  = opt.dataset.duration ?? 1;
        diffSel.value = opt.dataset.diff ?? "";
        dotIn.value   = opt.dataset.dot ?? 0;
        prevTxt.textContent = opt.dataset.summary ?? "";
      };
      sel.addEventListener("change", refresh);
      refresh();

      root.querySelector("#ae-add-mod").addEventListener("click", () => {
        root.querySelector("#ae-mods-list").insertAdjacentHTML("beforeend", makeModRow());
      });
      root.querySelector("#ae-mods-list").addEventListener("click", ev => {
        if (ev.target.classList.contains("ae-mod-del")) ev.target.closest(".ae-mod-row").remove();
      });

      const auraCheck = root.querySelector("#ae-aura");
      const auraFields = root.querySelector("#ae-aura-fields");
      auraCheck.addEventListener("change", () => {
        auraFields.style.display = auraCheck.checked ? "block" : "none";
      });
    }
  }, { width: 460, height: 750 }).render(true);
})();
