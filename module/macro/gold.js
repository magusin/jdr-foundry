/**
 * Macro "Gérer l'Or" (MJ uniquement)
 * - Ajouter / retirer cuivre, argent, or à un ou plusieurs PJ
 * - Conversion automatique (100 cuivres → 1 argent, 100 argents → 1 or)
 * - Historique dans le chat
 */
(async () => {
  if (!game.user.isGM) return ui.notifications.warn("Réservé au MJ.");

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  // PJ disponibles (acteurs de type character avec un owner)
  const pjs = game.actors.filter(a => a.type === "character");
  if (!pjs.length) return ui.notifications.warn("Aucun personnage dans le monde.");

  const opts = pjs.map(a =>
    `<option value="${a.id}">${a.name}</option>`
  ).join("");

  const content = `
    <style>
      .gold-form { display:flex; flex-direction:column; gap:10px; padding:4px 0; }
      .gold-row  { display:flex; align-items:center; gap:8px; }
      .gold-row label { width:70px; font-weight:600; }
      .gold-row input { flex:1; }
      .gold-row select { flex:1; }
      .gold-hint { font-size:11px; color:#888; }
    </style>
    <div class="gold-form">
      <div class="gold-row">
        <label>Joueur(s)</label>
        <select id="g-target" multiple size="4" style="flex:1">${opts}</select>
      </div>
      <div class="gold-hint" style="margin-left:78px">Ctrl+clic pour sélectionner plusieurs</div>
      <div class="gold-row">
        <label>Action</label>
        <select id="g-action">
          <option value="add">Ajouter</option>
          <option value="remove">Retirer</option>
          <option value="set">Définir</option>
        </select>
      </div>
      <div class="gold-row">
        <label>Or 🥇</label>
        <input id="g-or"     type="number" min="0" value="0" />
      </div>
      <div class="gold-row">
        <label>Argent 🥈</label>
        <input id="g-argent" type="number" min="0" value="0" />
      </div>
      <div class="gold-row">
        <label>Cuivre 🥉</label>
        <input id="g-cuivre" type="number" min="0" value="0" />
      </div>
      <div class="gold-row">
        <label style="width:auto">
          <input type="checkbox" id="g-convert" checked />
          Conversion auto (100 cuivres = 1 argent, 100 argents = 1 or)
        </label>
      </div>
    </div>
  `;

  new Dialog({
    title: "Gérer l'Or — MJ",
    content,
    buttons: {
      ok: {
        label: "Appliquer",
        callback: async (html) => {
          const sel     = [...html.find("#g-target")[0].selectedOptions].map(o => o.value);
          const action  = html.find("#g-action").val();
          const orVal   = Math.max(0, n(html.find("#g-or").val()));
          const argVal  = Math.max(0, n(html.find("#g-argent").val()));
          const cuiVal  = Math.max(0, n(html.find("#g-cuivre").val()));
          const convert = html.find("#g-convert")[0].checked;

          if (!sel.length) return ui.notifications.warn("Sélectionne au moins un joueur.");
          if (!orVal && !argVal && !cuiVal) return ui.notifications.warn("Montant nul — rien à faire.");

          const lines = [];

          for (const id of sel) {
            const actor = game.actors.get(id);
            if (!actor) continue;

            const cur = actor.system?.monnaie ?? { or: 0, argent: 0, cuivre: 0 };
            let or     = n(cur.or,     0);
            let argent = n(cur.argent, 0);
            let cuivre = n(cur.cuivre, 0);

            if (action === "set") {
              or = orVal; argent = argVal; cuivre = cuiVal;
            } else if (action === "add") {
              or += orVal; argent += argVal; cuivre += cuiVal;
            } else {
              or     = Math.max(0, or     - orVal);
              argent = Math.max(0, argent - argVal);
              cuivre = Math.max(0, cuivre - cuiVal);
            }

            // Conversion automatique
            if (convert && action !== "set") {
              if (cuivre >= 100) { argent += Math.floor(cuivre / 100); cuivre = cuivre % 100; }
              if (argent >= 100) { or     += Math.floor(argent / 100); argent = argent % 100; }
            }

            await actor.update({
              "system.monnaie.or":     or,
              "system.monnaie.argent": argent,
              "system.monnaie.cuivre": cuivre
            });

            lines.push(`<li><b>${actor.name}</b> : 🥇${or} 🥈${argent} 🥉${cuivre}</li>`);
          }

          const verb = action === "add" ? "reçoit" : action === "remove" ? "perd" : "a maintenant";
          await ChatMessage.create({
            content: `<b>MJ — Monnaie</b> (${verb})<ul>${lines.join("")}</ul>`
          });
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "ok"
  }, { width: 360 }).render(true);
})();
