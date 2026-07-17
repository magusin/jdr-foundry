/**
 * Macro "Tableau de bord MJ"
 * Centralise les actions MJ les plus fréquentes en un seul endroit.
 * Réduit le besoin de chercher la bonne macro dans la liste.
 */
(async () => {
  if (!game.user.isGM) { ui.notifications.warn("Réservé au MJ."); return; }

  const htmlEscape = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  // PJ actifs
  const pjs = game.actors.filter(a => a.type === "character").map(a => ({
    id: a.id,
    name: a.name,
    pv: a.system?.ressources?.pv?.valeur ?? 0,
    pvMax: a.system?.ressources?.pv?.max ?? 0,
    mana: a.system?.ressources?.mana?.valeur ?? 0,
    manaMax: a.system?.ressources?.mana?.max ?? 0,
    fatigue: a.system?.ressources?.fatigue?.valeur ?? 0,
    fatigueMax: a.system?.ressources?.fatigue?.max ?? 10,
    niveau: a.system?.niveau ?? 1,
    xp: a.system?.xp?.valeur ?? 0,
    blessures: (a.system?.blessures ?? []).length
  }));

  const pjRows = pjs.map(p => {
    const pvPct = p.pvMax > 0 ? Math.round(p.pv / p.pvMax * 100) : 0;
    const pvColor = pvPct > 50 ? "#1d9e75" : pvPct > 25 ? "#e0a020" : "#c0392b";
    const blessuresBadge = p.blessures ? `<span style="color:#c0392b;font-size:10px">🩸×${p.blessures}</span>` : "";
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
      <td style="padding:4px 6px;font-weight:600">${htmlEscape(p.name)} ${blessuresBadge}</td>
      <td style="padding:4px 6px;text-align:center">
        <span style="color:${pvColor};font-weight:600">${p.pv}/${p.pvMax}</span>
      </td>
      <td style="padding:4px 6px;text-align:center;color:#2980b9">${p.mana}/${p.manaMax}</td>
      <td style="padding:4px 6px;text-align:center;color:#e0a020">${p.fatigue}/${p.fatigueMax}</td>
      <td style="padding:4px 6px;text-align:center">Niv.${p.niveau} (${p.xp}/100 XP)</td>
    </tr>`;
  }).join("");

  const macrosGM = [
    { name: "Jet de Compétence", icon: "🎲", title: "Demander un jet de compétence à un joueur" },
    { name: "Appliquer un Effet (MJ)", icon: "✨", title: "Appliquer un état/effet sur une cible" },
    { name: "Compétences (MJ)", icon: "📚", title: "Gérer l'XP des compétences" },
    { name: "Gérer l'Or (MJ)", icon: "💰", title: "Ajouter/retirer de la monnaie" },
    { name: "Distribuer un Objet (MJ)", icon: "🎁", title: "Donner un objet à un joueur" },
    { name: "Distribuer une Recette (MJ)", icon: "📜", title: "Donner une recette de craft" },
    { name: "Survie : Repos / Blessures (MJ)", icon: "🏕️", title: "Repos, blessures, récupération" },
    { name: "Météo (MJ)", icon: "🌤️", title: "Changer la météo actuelle" },
    { name: "Position Tactique (MJ)", icon: "🛡️", title: "Couverture, flanc, angle mort" },
    { name: "Marché (MJ)", icon: "🏪", title: "Gérer les transactions marchandes" },
  ];

  const macroButtons = macrosGM.map(m => {
    const macro = game.macros.find(x => x.name === m.name);
    if (!macro) return "";
    return `<button type="button" class="rpg-dashboard-macro" data-macro-id="${macro.id}"
      title="${m.title}"
      style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;cursor:pointer;
             background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
             text-align:left;font-size:12px;width:100%">
      <span style="font-size:16px">${m.icon}</span>
      <span style="flex:1">${htmlEscape(m.name)}</span>
    </button>`;
  }).join("");

  // Météo actuelle
  const meteo = game.settings.get("rpg", "currentWeather") ?? "clair";
  const meteoLabels = { clair:"☀️ Clair", pluie:"🌧️ Pluie", canicule:"🌡️ Canicule",
    vent:"💨 Vent", gel:"🌨️ Gel", orage:"⛈️ Orage", sable:"🏜️ Tempête sable" };

  new Dialog({
    title: "🎮 Tableau de bord MJ",
    content: `
      <div style="display:grid;grid-template-columns:1fr 220px;gap:12px;padding:4px">

        <!-- Colonne gauche : état des PJ -->
        <div>
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#9b59b6">
            👥 État des personnages
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="opacity:.6;font-size:10px;border-bottom:1px solid rgba(255,255,255,0.1)">
                <th style="padding:3px 6px;text-align:left">Perso</th>
                <th style="padding:3px 6px">PV</th>
                <th style="padding:3px 6px">Mana</th>
                <th style="padding:3px 6px">Fatigue</th>
                <th style="padding:3px 6px">Niveau</th>
              </tr>
            </thead>
            <tbody>${pjRows || '<tr><td colspan="5" style="padding:8px;opacity:.5;text-align:center">Aucun personnage</td></tr>'}</tbody>
          </table>

          <!-- Météo -->
          <div style="margin-top:10px;padding:6px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:12px">
            <span style="opacity:.6">Météo actuelle :</span>
            <b style="margin-left:6px">${meteoLabels[meteo] ?? meteo}</b>
          </div>

          <!-- XP rapide -->
          <div style="margin-top:8px">
            <div style="font-weight:700;font-size:11px;opacity:.7;margin-bottom:4px">⚡ XP rapide</div>
            <div style="display:flex;gap:6px;align-items:center">
              <select id="db-xp-actor" style="flex:1;font-size:11px">
                ${pjs.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
              </select>
              <input id="db-xp-amount" type="number" value="10" min="1" max="500" style="width:60px;font-size:11px">
              <button id="db-xp-give" style="padding:3px 8px;cursor:pointer;font-size:11px;border-radius:4px">+XP</button>
            </div>
          </div>
        </div>

        <!-- Colonne droite : raccourcis macros -->
        <div>
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#9b59b6">
            ⚙️ Actions rapides
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${macroButtons || '<div style="opacity:.5;font-size:11px">Macros système non trouvées.</div>'}
          </div>
        </div>

      </div>`,
    buttons: {
      close: { label: "Fermer" },
      memo: {
        label: "📋 Formules",
        callback: () => {
          const m = game.macros.find(x => x.name === "Aide-mémoire MJ");
          if (m) m.execute(); else ui.notifications.warn("Macro 'Aide-mémoire MJ' introuvable.");
        }
      }
    },
    default: "close",
    options: { width: 740, height: 500, resizable: true },
    render: (html) => {
      // Clic sur une macro
      html[0].querySelectorAll(".rpg-dashboard-macro").forEach(btn => {
        btn.addEventListener("click", () => {
          const m = game.macros.get(btn.dataset.macroId);
          if (m) { m.execute(); }
        });
      });
      // Bouton +XP
      html[0].querySelector("#db-xp-give")?.addEventListener("click", async () => {
        const actorId = html[0].querySelector("#db-xp-actor").value;
        const amount  = Number(html[0].querySelector("#db-xp-amount").value) || 0;
        const actor   = game.actors.get(actorId);
        if (!actor || amount <= 0) return;
        const cur = Number(actor.system?.xp?.valeur ?? 0) || 0;
        await actor.update({ "system.xp.valeur": cur + amount });
        const { checkLevelUp } = await import("/systems/rpg/module/rules/level-up.js");
        await checkLevelUp(actor);
        ui.notifications.info(`+${amount} XP pour ${actor.name}`);
      });
    }
  }).render(true);
})();
