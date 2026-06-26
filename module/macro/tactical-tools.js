/**
 * Macro "JDR — Position Tactique (MJ)"
 *
 * Le MJ juge la situation sur la carte (mur, obstacle, encerclement,
 * angle mort) et applique la position tactique correspondante au token
 * ciblé/sélectionné — couverture (plus dur à toucher) ou flanc/angle mort
 * (plus facile à toucher). Permanent jusqu'à retrait manuel.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const tacticalAPI = game.rpg?.tactical;
  if (!tacticalAPI) {
    ui.notifications.error("API tactical introuvable (game.rpg.tactical).");
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

  const positions = tacticalAPI.listTactical();
  const options = positions.map(p => `<option value="${p.key}">${htmlEscape(p.label)}</option>`).join("");

  const buildActiveHTML = () => {
    return tokens.map(t => {
      const actor = t.actor;
      if (!actor) return "";
      const active = (actor.system?.etatsActifs ?? []).filter(s => s.type === "tactical");
      const rows = active.length
        ? active.map(s => `
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;padding:1px 0">
              <input type="checkbox" class="tac-remove-check" data-actor-id="${actor.id}" value="${s.id}" />
              ${htmlEscape(s.label)}
            </label>`).join("")
        : `<div style="font-size:11px;color:var(--color-text-secondary)">Aucune</div>`;
      return `<div style="margin-bottom:6px"><b style="font-size:12px">${htmlEscape(actor.name)}</b>${rows}</div>`;
    }).join("");
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Cible(s) : ${tokens.map(t => htmlEscape(t.actor?.name ?? t.name)).join(", ")}
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Appliquer une position</label>
        <div style="display:flex;gap:8px">
          <select id="tac-select" style="flex:1">${options}</select>
          <button type="button" id="tac-apply-btn" style="padding:5px 10px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px">Appliquer</button>
        </div>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Positions actives</label>
        <div id="tac-active">${buildActiveHTML()}</div>
        <button type="button" id="tac-remove-btn" style="width:100%;padding:5px;cursor:pointer;margin-top:6px">Retirer les positions cochées</button>
      </div>
    </div>`;

  const dlg = new Dialog({
    title: "Position Tactique (MJ)",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;

      root.querySelector("#tac-apply-btn").addEventListener("click", async () => {
        const key = root.querySelector("#tac-select").value;
        const def = positions.find(p => p.key === key);
        if (!def) return;

        for (const t of tokens) {
          const actor = t.actor;
          if (!actor) continue;
          const state = tacticalAPI.buildTacticalState(key, { sourceLabel: "MJ" });
          const list = foundry.utils.deepClone(actor.system?.etatsActifs ?? []);
          list.push(state);
          await actor.update({ "system.etatsActifs": list });
        }

        await ChatMessage.create({
          content: `🎯 <b>${htmlEscape(def.label)}</b> appliqué à : ${tokens.map(t => htmlEscape(t.actor?.name ?? t.name)).join(", ")}`
        });

        root.querySelector("#tac-active").innerHTML = buildActiveHTML();
        ui.notifications.info(`${def.label} appliqué.`);
      });

      root.querySelector("#tac-remove-btn").addEventListener("click", async () => {
        const checks = Array.from(root.querySelectorAll(".tac-remove-check:checked"));
        if (!checks.length) { ui.notifications.warn("Coche au moins une position à retirer."); return; }

        const byActor = new Map();
        for (const c of checks) {
          if (!byActor.has(c.dataset.actorId)) byActor.set(c.dataset.actorId, []);
          byActor.get(c.dataset.actorId).push(c.value);
        }

        for (const [actorId, stateIds] of byActor.entries()) {
          const actor = game.actors.get(actorId);
          if (!actor) continue;
          const list = (actor.system?.etatsActifs ?? []).filter(s => !stateIds.includes(s.id));
          await actor.update({ "system.etatsActifs": list });
        }

        root.querySelector("#tac-active").innerHTML = buildActiveHTML();
        ui.notifications.info("Position(s) retirée(s).");
      });
    }
  }, { width: 420, height: 480 });

  dlg.render(true);
})();
