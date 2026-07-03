/**
 * Macro "JDR — Retirer un État (jet)"
 *
 * Un joueur peut tenter de se défaire d'un état actif en faisant un jet
 * d'Endurance + niveau Volonté contre le TN de difficulté de retrait
 * défini sur l'état. Si aucune difficulté n'est définie, l'état ne peut
 * pas être retiré par un jet (permanent ou géré manuellement par le MJ).
 * Réussite = état retiré. Le MJ valide toujours.
 */
(async () => {
  const token = canvas?.tokens?.controlled?.[0] ?? null;
  const actor = token?.actor
    ?? game.actors.find(a => a.type === "character" && a.isOwner)
    ?? null;

  if (!actor) { ui.notifications.warn("Contrôle un token ou possède un personnage."); return; }

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const DIFF_TN = {
    trivial: 6, facile: 9, moyen: 11, difficile: 14, tresDifficile: 17, quasiImpossible: 19
  };

  const DIFF_LABEL = {
    trivial: "Trivial", facile: "Facile", moyen: "Moyen",
    difficile: "Difficile", tresDifficile: "Très difficile", quasiImpossible: "Quasi impossible"
  };

  const states = (actor.system?.etatsActifs ?? [])
    .filter(s => !s.permanent && s.removeDifficulty && DIFF_TN[s.removeDifficulty]);

  if (!states.length) {
    ui.notifications.warn(`${actor.name} n'a aucun état qui peut être retiré par un jet.`);
    return;
  }

  const options = states.map(s =>
    `<option value="${htmlEscape(s.id)}">
      ${htmlEscape(s.label)} — ${DIFF_LABEL[s.removeDifficulty] ?? s.removeDifficulty} (TN ${DIFF_TN[s.removeDifficulty]}+)
    </option>`
  ).join("");

  new Dialog({
    title: `Retirer un État — ${actor.name}`,
    content: `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">État à tenter de retirer</label>
          <select id="rs-state" style="width:100%">${options}</select>
        </div>
        <div style="font-size:11px;color:var(--color-text-secondary)">
          Jet : 1d20 + Endurance/10 + niveau Volonté.<br/>
          Le MJ valide la réussite ou l'échec.
        </div>
      </div>`,
    buttons: {
      roll: {
        label: "🎲 Lancer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const stateId = root.querySelector("#rs-state").value;
          const state   = states.find(s => s.id === stateId);
          if (!state) return;

          const tn = DIFF_TN[state.removeDifficulty];
          const endurance = n(actor.system?.derived?.effective?.principales?.endurance, 0);
          const volonte   = n(actor.system?.skills?.survie?.level, 0);
          const bonus = Math.floor(endurance / 10) + volonte;

          const roll = await (new Roll(`1d20 + ${bonus}`)).evaluate();
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `🌀 <b>${actor.name}</b> tente de se défaire de <b>${htmlEscape(state.label)}</b> ` +
              `(+${Math.floor(endurance/10)} Endurance, +${volonte} Volonté — TN ${tn}+)`
          });

          const content = `
            <div style="font-size:13px">
              <b>${htmlEscape(actor.name)}</b> résiste à <b>${htmlEscape(state.label)}</b><br/>
              Jet : <b>${roll.total}</b> contre TN <b>${tn}+</b>
              <div class="rpg-remove-state-gm" style="display:flex;gap:8px;margin-top:8px">
                <button type="button" class="rpg-remove-resolve" data-result="fail"
                  style="flex:1;padding:4px;cursor:pointer">Échec — l'état persiste</button>
                <button type="button" class="rpg-remove-resolve" data-result="success"
                  style="flex:1;padding:4px;cursor:pointer">Réussite — retire l'état</button>
              </div>
            </div>`;

          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            flags: { rpg: { type: "removeStateDeclaration", actorId: actor.id, stateId } }
          });
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "roll"
  }, { width: 380 }).render(true);
})();
