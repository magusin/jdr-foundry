/**
 * Macro "Retirer un État (jet)"
 *
 * Tente de retirer un état actif. Le TN de base est défini sur l'état
 * (removeDifficulty ou removeBaseTN). Des modificateurs peuvent venir :
 * - De l'état lui-même (retraitMod)
 * - Des équipements équipés (system.bonus.retraitMod)
 * - Des sorts actifs (effets avec mods.retraitMod)
 *
 * Jet : 1d20 + Endurance/10 + niveau Volonté + modificateurs VS TN
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

  // TN de base selon difficulté texte
  const DIFF_TN = {
    trivial: 6, facile: 9, moyen: 11, difficile: 14, tresDifficile: 17, quasiImpossible: 19
  };
  const DIFF_LABEL = {
    trivial: "Trivial (6+)", facile: "Facile (9+)", moyen: "Moyen (11+)",
    difficile: "Difficile (14+)", tresDifficile: "Très difficile (17+)", quasiImpossible: "Quasi impossible (19+)"
  };

  // États retirables (ont un removeDifficulty ou un removeBaseTN)
  const states = (actor.system?.etatsActifs ?? []).filter(s =>
    !s.permanent && (s.removeDifficulty || s.removeBaseTN)
  );

  if (!states.length) {
    ui.notifications.warn(`${actor.name} n'a aucun état qui peut être retiré par un jet.`);
    return;
  }

  // Calcul des modificateurs globaux depuis les équipements
  let equipMod = 0;
  for (const item of actor.items) {
    if (item.system?.equipe) {
      equipMod += n(item.system?.bonus?.retraitMod, 0);
    }
  }

  // Modificateurs depuis les états actifs (buffs/debuffs qui influent sur le retrait)
  let effectMod = 0;
  for (const s of (actor.system?.etatsActifs ?? [])) {
    effectMod += n(s.mods?.retraitMod?.flat, 0);
  }

  const options = states.map(s => {
    const baseTN = n(s.removeBaseTN, 0) || DIFF_TN[s.removeDifficulty] || 11;
    const stMod  = n(s.retraitMod, 0);
    const totalMod = equipMod + effectMod + stMod;
    const finalTN = baseTN + totalMod;
    const modStr = totalMod !== 0 ? ` (base ${baseTN} ${totalMod > 0 ? "+" : ""}${totalMod})` : "";
    return `<option value="${htmlEscape(s.id)}" data-tn="${finalTN}">
      ${htmlEscape(s.label)} — TN ${finalTN}+${modStr}
    </option>`;
  }).join("");

  const endurance = n(actor.system?.derived?.effective?.principales?.endurance, 0);
  const volonte   = n(actor.system?.skills?.survie?.level, 0);
  const bonus = Math.floor(endurance / 10) + volonte;
  const modStr = equipMod + effectMod !== 0
    ? `<div style="font-size:11px;color:#c8960a;margin-top:4px">
        Modificateurs : ${equipMod + effectMod > 0 ? "+" : ""}${equipMod + effectMod} au TN
        ${equipMod ? `(équipements: ${equipMod > 0 ? "+" : ""}${equipMod})` : ""}
        ${effectMod ? `(états: ${effectMod > 0 ? "+" : ""}${effectMod})` : ""}
      </div>`
    : "";

  new Dialog({
    title: `Retirer un État — ${actor.name}`,
    content: `
      <div style="display:flex;flex-direction:column;gap:10px;padding:4px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">État à tenter de retirer</label>
          <select id="rs-state" style="width:100%">${options}</select>
        </div>
        <div style="font-size:11px;opacity:.8;background:rgba(255,255,255,0.05);padding:6px;border-radius:6px">
          Jet : 1d20 + ${Math.floor(endurance/10)} (End/10) + ${volonte} (Volonté) = 1d20 + ${bonus}
          ${modStr}
        </div>
      </div>`,
    buttons: {
      roll: {
        label: "🎲 Lancer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const sel    = root.querySelector("#rs-state");
          const stateId = sel.value;
          const tn      = Number(sel.selectedOptions[0]?.dataset?.tn) || 11;
          const state   = states.find(s => s.id === stateId);
          if (!state) return;

          const roll = await (new Roll(`1d20 + ${bonus}`)).evaluate();
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `🌀 <b>${actor.name}</b> résiste à <b>${htmlEscape(state.label)}</b> (1d20+${bonus} vs TN ${tn}+)`
          });

          // Message MJ avec boutons Échec/Réussite
          const touched = roll.total >= tn;
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
              <div style="font-size:13px">
                <b>${htmlEscape(actor.name)}</b> résiste à <b>${htmlEscape(state.label)}</b><br>
                Jet : <b>${roll.total}</b> vs TN <b>${tn}+</b>
                ${touched ? " — <span style=\"color:#1d9e75\">Passe le TN !</span>" : " — <span style=\"color:#c0392b\">Sous le TN.</span>"}
                <div class="rpg-remove-state-gm" style="display:flex;gap:8px;margin-top:8px">
                  <button type="button" class="rpg-remove-resolve" data-result="fail"
                    style="flex:1;padding:4px;cursor:pointer;border-radius:5px">❌ Persiste</button>
                  <button type="button" class="rpg-remove-resolve" data-result="success"
                    style="flex:1;padding:4px;cursor:pointer;border-radius:5px;${touched ? "background:rgba(29,158,117,0.2)" : ""}">✅ Retiré</button>
                </div>
              </div>`,
            whisper: game.users.filter(u => u.isGM).map(u => u.id),
            flags: { rpg: { type: "removeStateDeclaration", actorId: actor.id, stateId } }
          });
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "roll"
  }).render(true);
})();
