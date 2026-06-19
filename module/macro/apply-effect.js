/**
 * Macro "JDR — Appliquer un Effet (MJ)"
 *
 * Applique un effet du catalogue (Brûlure, Poison, Gel, etc.) ou un effet
 * personnalisé sur un ou plusieurs tokens ciblés/sélectionnés.
 * Passe automatiquement par le calcul de résistance (équipement + buffs).
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const lib = game.rpg?.effectLibrary;
  const resAPI = game.rpg?.resistances;
  if (!lib || !resAPI) {
    ui.notifications.error("API effectLibrary/resistances introuvable.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // Cibles : tokens ciblés (priorité) sinon tokens contrôlés
  const targets = Array.from(game.user.targets ?? []);
  const tokens = targets.length ? targets : (canvas?.tokens?.controlled ?? []);

  if (!tokens.length) {
    ui.notifications.warn("Cible ou contrôle au moins un token.");
    return;
  }

  const effects = lib.listEffects();
  const options = effects.map(e =>
    `<option value="${e.key}">${htmlEscape(e.label)} (${e.tag}, ${e.defaultDuration} tours)</option>`
  ).join("");

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Effet</label>
        <select id="ae-effect" style="width:100%">${options}</select>
      </div>
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Durée (tours)</label>
        <input id="ae-duration" type="number" min="1" style="width:100%" />
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Cible(s) : ${tokens.map(t => htmlEscape(t.actor?.name ?? t.name)).join(", ")}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary)">
        Les résistances (équipement + buffs) sont calculées automatiquement.
      </div>
    </div>`;

  const setDefaultDuration = (root) => {
    const sel = root.querySelector("#ae-effect");
    const dur = root.querySelector("#ae-duration");
    const def = effects.find(e => e.key === sel.value);
    if (def && dur) dur.value = def.defaultDuration;
  };

  new Dialog({
    title: "Appliquer un Effet",
    content,
    render: (html) => {
      const root = html?.[0] ?? html;
      setDefaultDuration(root);
      root.querySelector("#ae-effect")?.addEventListener("change", () => setDefaultDuration(root));
    },
    buttons: {
      apply: {
        label: "✅ Appliquer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const effectKey = root.querySelector("#ae-effect")?.value;
          const duration  = Number(root.querySelector("#ae-duration")?.value) || undefined;

          const def = effects.find(e => e.key === effectKey);
          if (!def) return;

          const results = [];
          for (const token of tokens) {
            const actor = token.actor;
            if (!actor) continue;

            const state = lib.buildStateFromLibrary(effectKey, { duration, sourceLabel: "MJ" });
            const res = await resAPI.addStateWithResistance(actor, state);

            results.push({
              name: actor.name,
              resisted: res.resisted,
              duration: res.state?.duration ?? duration ?? def.defaultDuration
            });
          }

          const lines = results.map(r =>
            r.resisted
              ? `<li>🛡️ <b>${htmlEscape(r.name)}</b> a résisté à l'effet</li>`
              : `<li>${htmlEscape(r.name)} : <b>${htmlEscape(def.label)}</b> (${r.duration} tours)</li>`
          ).join("");

          await ChatMessage.create({
            content: `
              <div style="font-size:13px">
                🎯 <b>MJ</b> applique <b>${htmlEscape(def.label)}</b> :
                <ul>${lines}</ul>
              </div>`
          });
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "apply"
  }, { width: 380 }).render(true);
})();
