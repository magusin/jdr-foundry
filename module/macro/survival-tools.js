/**
 * Macro "JDR — Survie : Repos / Blessures (MJ)"
 *
 * Outil MJ unique pour gérer la fatigue et les blessures localisées :
 * - Repos : réduit la fatigue d'un ou plusieurs PJ/monstres (court ou long)
 * - Appliquer une blessure : depuis le catalogue (bras/jambe/torse/tête/saignement)
 * - Soigner une blessure : retire une blessure active d'un acteur
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const woundAPI = game.rpg?.wounds;
  if (!woundAPI) {
    ui.notifications.error("API wounds introuvable (game.rpg.wounds).");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const actors = game.actors
    .filter(a => a.type === "character" || a.type === "monster")
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "character" ? -1 : 1;
      return (a.name ?? "").localeCompare(b.name ?? "", "fr");
    });

  if (!actors.length) {
    ui.notifications.warn("Aucun personnage ou monstre dans le monde.");
    return;
  }

  const actorOptions = actors.map(a =>
    `<option value="${a.id}">${htmlEscape(a.name)} (${a.type === "character" ? "PJ" : "Monstre"})</option>`
  ).join("");

  const wounds = woundAPI.listWounds();
  const woundOptions = wounds.map(w => `<option value="${w.key}">${htmlEscape(w.label)}</option>`).join("");

  const buildActiveWoundsHTML = (actorId) => {
    const actor = game.actors.get(actorId);
    if (!actor) return `<div style="font-size:11px;color:var(--color-text-secondary)">—</div>`;
    const active = (actor.system?.etatsActifs ?? []).filter(s => s.type === "wound");
    if (!active.length) return `<div style="font-size:11px;color:var(--color-text-secondary)">Aucune blessure active</div>`;
    return active.map(s => `
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0">
        <input type="checkbox" class="st-heal-check" value="${s.id}" />
        ${htmlEscape(s.label)}
      </label>`).join("");
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:14px">

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Cible</label>
        <select id="st-actor" style="width:100%">${actorOptions}</select>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">😴 Repos — réduire la fatigue</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="st-fatigue-amount" type="number" min="0" value="2" style="width:80px" />
          <button type="button" id="st-rest-btn" style="flex:1;padding:5px;cursor:pointer">Appliquer le repos</button>
          <button type="button" id="st-rest-full-btn" style="padding:5px;cursor:pointer">Repos complet</button>
        </div>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">🩸 Appliquer une blessure</label>
        <div style="display:flex;gap:8px">
          <select id="st-wound-select" style="flex:1">${woundOptions}</select>
          <button type="button" id="st-wound-apply-btn" style="padding:5px 10px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">Appliquer</button>
        </div>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">💊 Soigner une blessure</label>
        <div id="st-active-wounds" style="margin-bottom:6px">${buildActiveWoundsHTML(actors[0]?.id)}</div>
        <button type="button" id="st-heal-btn" style="width:100%;padding:5px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px">Soigner les blessures cochées</button>
      </div>

    </div>`;

  const dlg = new Dialog({
    title: "Survie — Repos / Blessures (MJ)",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      const actorSel = root.querySelector("#st-actor");

      const refreshWounds = () => {
        root.querySelector("#st-active-wounds").innerHTML = buildActiveWoundsHTML(actorSel.value);
      };
      actorSel.addEventListener("change", refreshWounds);

      root.querySelector("#st-rest-btn").addEventListener("click", async () => {
        const actor = game.actors.get(actorSel.value);
        const amount = Math.max(0, Number(root.querySelector("#st-fatigue-amount").value) || 0);
        if (!actor) return;
        const cur = Number(actor.system?.ressources?.fatigue?.valeur ?? 0) || 0;
        const next = Math.max(0, cur - amount);
        await actor.update({ "system.ressources.fatigue.valeur": next });
        await ChatMessage.create({ content: `😴 <b>${actor.name}</b> se repose : fatigue ${cur} → <b>${next}</b>.` });
        game.rpg?.journal?.appendToCampaignJournal(`<b>${actor.name}</b> se repose (fatigue ${cur} → ${next}).`).catch(() => {});
        ui.notifications.info(`Fatigue de ${actor.name} réduite.`);
      });

      root.querySelector("#st-rest-full-btn").addEventListener("click", async () => {
        const actor = game.actors.get(actorSel.value);
        if (!actor) return;
        const cur = Number(actor.system?.ressources?.fatigue?.valeur ?? 0) || 0;
        await actor.update({ "system.ressources.fatigue.valeur": 0 });
        await ChatMessage.create({ content: `😴 <b>${actor.name}</b> prend un repos complet : fatigue ${cur} → <b>0</b>.` });
        game.rpg?.journal?.appendToCampaignJournal(`<b>${actor.name}</b> prend un repos complet.`).catch(() => {});
        ui.notifications.info(`${actor.name} entièrement reposé.`);
      });

      root.querySelector("#st-wound-apply-btn").addEventListener("click", async () => {
        const actor = game.actors.get(actorSel.value);
        const woundKey = root.querySelector("#st-wound-select").value;
        if (!actor) return;

        const state = woundAPI.buildWoundState(woundKey, { sourceLabel: "MJ" });
        if (!state) return;

        const list = foundry.utils.deepClone(actor.system?.etatsActifs ?? []);
        list.push(state);
        await actor.update({ "system.etatsActifs": list });

        await ChatMessage.create({ content: `🩸 <b>${actor.name}</b> subit : <b>${state.label}</b> (permanent, jusqu'à soin).` });
        game.rpg?.journal?.appendToCampaignJournal(`<b>${actor.name}</b> subit une blessure : ${state.label}.`).catch(() => {});
        ui.notifications.info(`Blessure appliquée à ${actor.name}.`);
        refreshWounds();
      });

      root.querySelector("#st-heal-btn").addEventListener("click", async () => {
        const actor = game.actors.get(actorSel.value);
        if (!actor) return;

        const checks = Array.from(root.querySelectorAll(".st-heal-check:checked")).map(c => c.value);
        if (!checks.length) { ui.notifications.warn("Coche au moins une blessure à soigner."); return; }

        const list = (actor.system?.etatsActifs ?? []).filter(s => !checks.includes(s.id));
        await actor.update({ "system.etatsActifs": list });

        await ChatMessage.create({ content: `💊 <b>${actor.name}</b> est soigné de ${checks.length} blessure(s).` });
        game.rpg?.journal?.appendToCampaignJournal(`<b>${actor.name}</b> est soigné de ${checks.length} blessure(s).`).catch(() => {});
        ui.notifications.info(`${actor.name} soigné.`);
        refreshWounds();
      });
    }
  }, { width: 440, height: 560 });

  dlg.render(true);
})();
