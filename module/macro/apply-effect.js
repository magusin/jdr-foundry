/**
 * Macro "JDR — Appliquer un Effet (MJ)"
 *
 * Le MJ choisit un effet dans la liste des noms connus, puis entre
 * lui-même TOUTES les valeurs : durée, dégâts/tour, bonus/malus de stat
 * (fixe ou %), difficulté de retrait, aura. Rien n'est pré-configuré —
 * le catalogue sert uniquement à avoir la liste des noms disponibles.
 */
(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }

  const lib    = game.rpg?.effectLibrary;
  const resAPI = game.rpg?.resistances;
  if (!lib || !resAPI) { ui.notifications.error("API effectLibrary/resistances introuvable."); return; }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const targets = Array.from(game.user.targets ?? []);
  const tokens  = targets.length ? targets : (canvas?.tokens?.controlled ?? []);
  if (!tokens.length) { ui.notifications.warn("Cible ou contrôle au moins un token."); return; }

  const DIFF = {
    "":              "— Pas de retrait par jet —",
    trivial:         "Trivial (TN 6+)",
    facile:          "Facile (TN 9+)",
    moyen:           "Moyen (TN 11+)",
    difficile:       "Difficile (TN 14+)",
    tresDifficile:   "Très difficile (TN 17+)",
    quasiImpossible: "Quasi impossible (TN 19+)"
  };

  const STAT_LABELS = {
    force:"Force", intelligence:"Intelligence", dexterite:"Dextérité", acuite:"Acuité", endurance:"Endurance",
    armureFixe:"Armure fixe", resistanceFixe:"Résistance fixe", scoreArmure:"Score Armure",
    scoreResistance:"Score Résistance", pvMax:"PV max", manaMax:"Mana max",
    regenPv:"Régén PV", regenMana:"Régén Mana", vitesse:"Vitesse", initiativeMod:"Initiative",
    toucherPhysique:"Toucher phys.", toucherMagique:"Toucher mag.",
    fatigueMax:"Fatigue max", podsMax:"Pods max"
  };

  // Groupement par type pour l'optgroup
  const effects = lib.listEffects();
  const BY_TAG = {};
  const TAG_LABEL = { feu:"🔥 Feu", air:"🌬️ Air", eau:"💧 Eau", glace:"❄️ Glace",
                      eclair:"⚡ Éclair", terre:"🌿 Terre", magique:"✨ Magique",
                      physique:"⚔️ Physique" };
  for (const e of effects) {
    const g = e.tag ?? "autre";
    if (!BY_TAG[g]) BY_TAG[g] = [];
    BY_TAG[g].push(e);
  }

  const effectOptions = Object.entries(BY_TAG).map(([tag, list]) =>
    `<optgroup label="${TAG_LABEL[tag] ?? tag}">` +
    list.map(e => `<option value="${e.key}">${htmlEscape(e.label)}</option>`).join("") +
    `</optgroup>`
  ).join("");

  const diffOptions = Object.entries(DIFF)
    .map(([k, label]) => `<option value="${k}">${htmlEscape(label)}</option>`).join("");

  const STAT_OPTIONS = Object.entries(STAT_LABELS)
    .map(([k,v]) => `<option value="${k}">${htmlEscape(v)}</option>`).join("");

  let modIdx = 0;
  const makeModRow = () => {
    modIdx++;
    return `<div class="ae-mod-row" style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
      <select class="ae-mod-stat" style="flex:2">${STAT_OPTIONS}</select>
      <input type="number" class="ae-mod-flat" placeholder="Fixe" value="0" style="flex:1;width:55px"/>
      <input type="number" class="ae-mod-pct" placeholder="%" value="0" style="flex:1;width:50px"/>
      <button type="button" class="ae-mod-del" style="cursor:pointer;color:#c0392b">✕</button>
    </div>`;
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px;max-height:540px;overflow-y:auto">
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Cible(s) : <b>${tokens.map(t => htmlEscape(t.actor?.name ?? t.name)).join(", ")}</b>
      </div>

      <div>
        <label style="font-weight:700;display:block;margin-bottom:4px">Nom de l'effet</label>
        <select id="ae-effect" style="width:100%">${effectOptions}</select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Durée (tours)</label>
          <input id="ae-duration" type="number" min="1" value="3" style="width:100%" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Difficulté de retrait</label>
          <select id="ae-diff" style="width:100%">${diffOptions}</select>
        </div>
      </div>

      <hr style="margin:4px 0"/>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Dégâts/tour <span style="font-weight:400;font-size:11px">(négatif = soin)</span></label>
          <input id="ae-dot" type="number" value="0" style="width:100%" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Fatigue/tour <span style="font-weight:400;font-size:11px">(négatif = repos)</span></label>
          <input id="ae-fatigue" type="number" value="0" style="width:100%" />
        </div>
      </div>

      <div>
        <div style="font-weight:700;margin-bottom:4px">Bonus / Malus de stat
          <span style="font-weight:400;font-size:11px">— Fixe : valeur absolue (+5, -3…) · % : pourcentage de la stat</span>
        </div>
        <div id="ae-mods-list"></div>
        <button type="button" id="ae-add-mod" style="font-size:11px;cursor:pointer;margin-top:2px">+ Ajouter une stat</button>
      </div>

      <hr style="margin:4px 0"/>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="display:flex;align-items:center;gap:6px">
          <input id="ae-permanent" type="checkbox" />
          Permanent (ne s'estompe jamais seul)
        </label>
        <label style="display:flex;align-items:center;gap:6px">
          <input id="ae-aura" type="checkbox" />
          Aura (rayonne autour de la cible)
        </label>
      </div>
      <div id="ae-aura-fields" style="display:none;gap:8px">
        <div style="display:flex;gap:8px">
          <label style="flex:1;font-size:11px">Portée min<input id="ae-aura-min" type="number" min="0" value="0" style="width:100%"/></label>
          <label style="flex:1;font-size:11px">Portée max<input id="ae-aura-max" type="number" min="0" value="3" style="width:100%"/></label>
        </div>
      </div>
    </div>`;

  new Dialog({
    title: "Appliquer un Effet (MJ)",
    content,
    buttons: {
      apply: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const effectKey    = root.querySelector("#ae-effect").value;
          const duration     = Number(root.querySelector("#ae-duration").value) || 1;
          const diffKey      = root.querySelector("#ae-diff").value || null;
          const dot          = Number(root.querySelector("#ae-dot").value) || 0;
          const fatiguePerTick = Number(root.querySelector("#ae-fatigue").value) || 0;
          const permanent    = root.querySelector("#ae-permanent").checked;
          const isAura       = root.querySelector("#ae-aura").checked;
          const auraMin      = Number(root.querySelector("#ae-aura-min")?.value) || 0;
          const auraMax      = Number(root.querySelector("#ae-aura-max")?.value) || 0;

          const mods = {};
          root.querySelectorAll(".ae-mod-row").forEach(row => {
            const stat = row.querySelector(".ae-mod-stat").value;
            const flat = Number(row.querySelector(".ae-mod-flat").value) || 0;
            const pct  = Number(row.querySelector(".ae-mod-pct").value) || 0;
            if (stat && (flat || pct)) mods[stat] = { flat, pct };
          });

          const aura = isAura ? { min: auraMin, max: auraMax, key: effectKey } : null;

          const state = lib.buildStateFromLibrary(effectKey, {
            duration, removeDifficulty: diffKey, dot, fatiguePerTick,
            mods, permanent, isAura, aura
          });
          if (!state) { ui.notifications.error("Effet introuvable."); return; }

          const results = [];
          for (const token of tokens) {
            const actor = token.actor;
            if (!actor) continue;
            const res = await resAPI.addStateWithResistance(actor, state);
            results.push({ name: actor.name, applied: res.applied, resisted: res.resisted });
          }

          if (isAura && game.rpg?.auras) await game.rpg.auras.refreshAuras();

          const def = lib.getEffectDef(effectKey);
          const lines = results.map(r =>
            r.resisted
              ? `<li>🛡️ ${htmlEscape(r.name)} résiste à <b>${htmlEscape(def?.label ?? effectKey)}</b></li>`
              : `<li>${htmlEscape(r.name)} : <b>${htmlEscape(def?.label ?? effectKey)}</b> — ${duration} tour${duration > 1 ? "s" : ""}${diffKey ? `, retrait ${htmlEscape(DIFF[diffKey]?.split(" (")[0] ?? diffKey)}` : ""}</li>`
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
  }, { width: 440, height: 680 }).render(true);
})();
