/**
 * Macro "JDR — Créer un État (MJ)"
 *
 * Construit un état entièrement personnalisé : nom, type/élément, durée
 * (ou permanent), dégâts/soin par tour, fatigue/tour, bonus/malus de
 * stat (fixe ou %, plusieurs possibles), et aura (avec portée) si voulu.
 * Complète les catalogues fixes déjà existants pour les cas non prévus.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const builderAPI = game.rpg?.stateBuilder;
  const resAPI = game.rpg?.resistances;
  if (!builderAPI || !resAPI) {
    ui.notifications.error("API stateBuilder/resistances introuvable.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const targets = Array.from(game.user.targets ?? []);
  const tokens = targets.length ? targets : (canvas?.tokens?.controlled ?? []);

  if (!tokens.length) {
    ui.notifications.warn("Cible ou contrôle au moins un token.");
    return;
  }

  const typeOptions = Object.entries(builderAPI.STATE_TYPES)
    .map(([k, label]) => `<option value="${k}">${htmlEscape(label)}</option>`).join("");

  const statOptions = Object.entries(builderAPI.STAT_KEYS)
    .map(([k, label]) => `<option value="${k}">${htmlEscape(label)}</option>`).join("");

  let modRowCount = 0;
  const buildModRow = () => {
    const idx = modRowCount++;
    return `
      <div class="sb-mod-row" data-idx="${idx}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
        <select class="sb-mod-stat" style="flex:2">${statOptions}</select>
        <input type="number" class="sb-mod-flat" placeholder="Fixe" value="0" style="flex:1;width:60px" />
        <input type="number" class="sb-mod-pct" placeholder="%" value="0" style="flex:1;width:50px" />
        <button type="button" class="sb-mod-remove" style="cursor:pointer">✕</button>
      </div>`;
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px;max-height:520px;overflow-y:auto">
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Cible(s) : ${tokens.map(t => htmlEscape(t.actor?.name ?? t.name)).join(", ")}
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Nom de l'état</label>
        <input id="sb-label" type="text" style="width:100%" placeholder="ex: Brûlure" />
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Type / Élément</label>
        <select id="sb-tag" style="width:100%">${typeOptions}</select>
      </div>

      <div style="display:flex;gap:10px;align-items:center">
        <label style="font-weight:600">Durée (tours)</label>
        <input id="sb-duration" type="number" min="1" value="3" style="width:70px" />
        <label style="display:flex;align-items:center;gap:4px;font-size:12px">
          <input id="sb-permanent" type="checkbox" /> Permanent (jusqu'à retrait manuel)
        </label>
      </div>

      <div>
        <label style="display:flex;align-items:center;gap:6px;font-weight:600">
          <input id="sb-has-dot" type="checkbox" /> Infliger des dégâts/tour
        </label>
        <input id="sb-dot" type="number" value="0" placeholder="Dégâts/tour (négatif = soin)" style="width:100%;margin-top:4px" disabled />
      </div>

      <div>
        <label style="display:flex;align-items:center;gap:6px;font-weight:600">
          <input id="sb-has-fatigue" type="checkbox" /> Affecter la fatigue/tour
        </label>
        <input id="sb-fatigue" type="number" value="0" placeholder="Fatigue/tour (négatif = repos)" style="width:100%;margin-top:4px" disabled />
      </div>

      <div>
        <label style="display:flex;align-items:center;gap:6px;font-weight:600">
          <input id="sb-has-mods" type="checkbox" /> Bonus / malus de stat
        </label>
        <div id="sb-mods-list" style="margin-top:6px;display:none"></div>
        <button type="button" id="sb-add-mod" style="display:none;margin-top:2px">+ Ajouter une stat</button>
      </div>

      <div>
        <label style="display:flex;align-items:center;gap:6px;font-weight:600">
          <input id="sb-is-aura" type="checkbox" /> Aura (rayonne autour de la cible)
        </label>
        <div id="sb-aura-fields" style="display:none;margin-top:6px;gap:8px;display:none">
          <div style="display:flex;gap:8px">
            <label style="flex:1">Portée min<input id="sb-aura-min" type="number" min="0" value="0" style="width:100%" /></label>
            <label style="flex:1">Portée max<input id="sb-aura-max" type="number" min="0" value="3" style="width:100%" /></label>
          </div>
          <small class="muted">Allié/ennemi est déterminé automatiquement (malus/dégâts → ennemis, bonus/soin → alliés).</small>
        </div>
      </div>
    </div>`;

  new Dialog({
    title: "Créer un État (MJ)",
    content,
    buttons: {
      apply: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const root = html?.[0] ?? html;

          const label = root.querySelector("#sb-label").value.trim() || "État personnalisé";
          const tag = root.querySelector("#sb-tag").value;
          const duration = Number(root.querySelector("#sb-duration").value) || 1;
          const permanent = root.querySelector("#sb-permanent").checked;

          const hasDot = root.querySelector("#sb-has-dot").checked;
          const dotPerTick = hasDot ? Number(root.querySelector("#sb-dot").value) || 0 : 0;

          const hasFatigue = root.querySelector("#sb-has-fatigue").checked;
          const fatiguePerTick = hasFatigue ? Number(root.querySelector("#sb-fatigue").value) || 0 : 0;

          const hasMods = root.querySelector("#sb-has-mods").checked;
          const mods = [];
          if (hasMods) {
            root.querySelectorAll(".sb-mod-row").forEach(row => {
              mods.push({
                stat: row.querySelector(".sb-mod-stat").value,
                flat: Number(row.querySelector(".sb-mod-flat").value) || 0,
                pct: Number(row.querySelector(".sb-mod-pct").value) || 0
              });
            });
          }

          const isAura = root.querySelector("#sb-is-aura").checked;
          const auraMin = Number(root.querySelector("#sb-aura-min")?.value) || 0;
          const auraMax = Number(root.querySelector("#sb-aura-max")?.value) || 0;

          const results = [];
          for (const token of tokens) {
            const actor = token.actor;
            if (!actor) continue;

            const state = builderAPI.buildCustomState({
              label, tag, duration, permanent, dotPerTick, fatiguePerTick, mods,
              isAura, auraMin, auraMax
            });

            if (isAura) {
              // Source d'aura : ajoutée directement sur la cible (pas de résistance,
              // elle ÉMET l'effet, elle ne le subit pas), puis on rafraîchit
              const list = foundry.utils.deepClone(actor.system?.etatsActifs ?? []);
              list.push(state);
              await actor.update({ "system.etatsActifs": list });
              results.push({ name: actor.name, applied: true, aura: true });
            } else {
              const res = await resAPI.addStateWithResistance(actor, state);
              results.push({ name: actor.name, applied: res.applied, resisted: res.resisted, aura: false });
            }
          }

          if (isAura && game.rpg?.auras) await game.rpg.auras.refreshAuras();

          const lines = results.map(r => {
            if (r.aura) return `<li>${htmlEscape(r.name)} : émet désormais <b>${htmlEscape(label)}</b> (aura)</li>`;
            if (r.resisted) return `<li>🛡️ ${htmlEscape(r.name)} a résisté à <b>${htmlEscape(label)}</b></li>`;
            return `<li>${htmlEscape(r.name)} : <b>${htmlEscape(label)}</b> appliqué</li>`;
          }).join("");

          await ChatMessage.create({
            content: `<div style="font-size:13px">🛠️ <b>État personnalisé</b> — ${htmlEscape(label)}<ul>${lines}</ul></div>`
          });
          ui.notifications.info("État appliqué.");
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "apply",
    render: (html) => {
      const root = html?.[0] ?? html;

      const dotCheck = root.querySelector("#sb-has-dot");
      const dotInput = root.querySelector("#sb-dot");
      dotCheck.addEventListener("change", () => { dotInput.disabled = !dotCheck.checked; });

      const fatCheck = root.querySelector("#sb-has-fatigue");
      const fatInput = root.querySelector("#sb-fatigue");
      fatCheck.addEventListener("change", () => { fatInput.disabled = !fatCheck.checked; });

      const modsCheck = root.querySelector("#sb-has-mods");
      const modsList = root.querySelector("#sb-mods-list");
      const addModBtn = root.querySelector("#sb-add-mod");

      const refreshModsVisibility = () => {
        const show = modsCheck.checked;
        modsList.style.display = show ? "block" : "none";
        addModBtn.style.display = show ? "inline-block" : "none";
        if (show && !modsList.children.length) {
          modsList.insertAdjacentHTML("beforeend", buildModRow());
        }
      };
      modsCheck.addEventListener("change", refreshModsVisibility);

      addModBtn.addEventListener("click", () => {
        modsList.insertAdjacentHTML("beforeend", buildModRow());
      });
      modsList.addEventListener("click", (ev) => {
        if (ev.target.classList.contains("sb-mod-remove")) {
          ev.target.closest(".sb-mod-row")?.remove();
        }
      });

      const auraCheck = root.querySelector("#sb-is-aura");
      const auraFields = root.querySelector("#sb-aura-fields");
      auraCheck.addEventListener("change", () => {
        auraFields.style.display = auraCheck.checked ? "flex" : "none";
        auraFields.style.flexDirection = "column";
      });
    }
  }, { width: 440, height: 700 }).render(true);
})();
