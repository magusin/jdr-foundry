/**
 * Macro "JDR — Lancer un Sort"
 *
 * Lance directement un sort depuis une liste déroulante sans avoir à
 * ouvrir la fiche du personnage. Montre le TN à atteindre si une cible
 * est sélectionnée, le coût en mana, et le cooldown actuel.
 */
(async () => {
  const token = canvas?.tokens?.controlled?.[0] ?? null;
  const actor = token?.actor
    ?? game.actors.find(a => a.type === "character" && a.isOwner)
    ?? null;

  if (!actor) { ui.notifications.warn("Contrôle un token ou possède un personnage."); return; }

  const spellsAPI = game.rpg?.spells;
  if (!spellsAPI) { ui.notifications.error("API sorts introuvable (game.rpg.spells)."); return; }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  const spells = actor.items.filter(i => i.type === "spell");
  if (!spells.length) { ui.notifications.warn(`${actor.name} n'a aucun sort.`); return; }

  // Cible sélectionnée (pour afficher le TN)
  const targetToken = [...(game.user.targets ?? [])][0] ?? null;
  const targetActor = targetToken?.actor ?? null;

  const combatAPI = game.rpg?.combat;

  // Construit les options avec infos résumées
  const spellOptions = spells.map(s => {
    const sys = s.system ?? {};
    const cd = n(sys.cooldown?.restant, 0);
    const mana = n(sys.coutMana, 0);
    const curMana = n(actor.system?.ressources?.mana?.valeur, 0);
    const onCd = cd > 0;
    const noMana = mana > curMana;

    let tn = "?";
    if (targetActor && combatAPI?.computeTN) {
      try { tn = combatAPI.computeTN(actor, targetActor, s).tnFinal; } catch(e) {}
    }

    const warn = onCd ? ` ⚠️ CD ${cd}t` : noMana ? ` ⚠️ Mana insuffisant` : "";
    const info = `Mana:${mana} ${targetActor ? `TN:${tn}+` : ""}${warn}`;

    return `<option value="${s.id}" ${onCd || noMana ? "style='color:#c0392b'" : ""}>
      ${htmlEscape(s.name)} — ${htmlEscape(info)}
    </option>`;
  }).join("");

  const manaActuel = n(actor.system?.ressources?.mana?.valeur, 0);
  const manaMax = n(actor.system?.ressources?.mana?.max, 0);

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:12px;opacity:.7">
        <b>${htmlEscape(actor.name)}</b> — Mana : <b>${manaActuel} / ${manaMax}</b>
        ${targetActor ? ` • Cible : <b>${htmlEscape(targetActor.name)}</b>` : " • <i>Aucune cible sélectionnée (T + clic)</i>"}
      </div>
      <div>
        <label style="font-weight:700;display:block;margin-bottom:4px">Sort à lancer</label>
        <select id="cs-spell" style="width:100%">${spellOptions}</select>
      </div>
    </div>`;

  new Dialog({
    title: `Lancer un sort — ${actor.name}`,
    content,
    buttons: {
      cast: {
        label: "🎯 Déclarer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const spellId = root.querySelector("#cs-spell").value;
          const spell = actor.items.get(spellId);
          if (!spell) return;
          await spellsAPI.declareSpell(actor, spell);
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "cast"
  }, { width: 400 }).render(true);
})();
