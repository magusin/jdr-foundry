/**
 * Macro "JDR — Jet de Compétence"
 *
 * Pour qu'un "jet de Discrétion", "jet de Crochetage", etc. existe
 * vraiment et pas seulement comme un bonus de stat silencieux. Utilisable
 * par n'importe quel joueur pour son propre PJ — le MJ valide toujours
 * Réussite/Échec ensuite.
 */
(async () => {
  const checkAPI = game.rpg?.skillCheck;
  if (!checkAPI) {
    ui.notifications.error("API skillCheck introuvable.");
    return;
  }

  // Acteur : token contrôlé, sinon le 1er PJ possédé par cet utilisateur
  const token = canvas?.tokens?.controlled?.[0] ?? null;
  const actor = token?.actor
    ?? game.actors.find(a => a.type === "character" && a.isOwner)
    ?? null;

  if (!actor) {
    ui.notifications.warn("Contrôle un token ou possède un personnage.");
    return;
  }

  const skills = actor.system?.skills ?? {};
  const skillEntries = Object.entries(skills);
  if (!skillEntries.length) {
    ui.notifications.warn(`${actor.name} n'a aucune compétence.`);
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const skillOptions = skillEntries
    .map(([key, s]) => `<option value="${key}">${htmlEscape(s.label ?? key)} (niv ${s.level ?? 0})</option>`)
    .join("");

  const diffOptions = Object.entries(checkAPI.DIFFICULTY_TIERS)
    .map(([key, d]) => `<option value="${key}" ${key === "moyen" ? "selected" : ""}>${htmlEscape(d.label)} (TN ${d.tn}+)</option>`)
    .join("");

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Compétence</label>
        <select id="sc-skill" style="width:100%">${skillOptions}</select>
      </div>
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Difficulté (estimée avec le MJ)</label>
        <select id="sc-diff" style="width:100%">${diffOptions}</select>
      </div>
    </div>`;

  new Dialog({
    title: `Jet de Compétence — ${actor.name}`,
    content,
    buttons: {
      roll: {
        label: "🎲 Lancer",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const skillKey = root.querySelector("#sc-skill").value;
          const diffKey = root.querySelector("#sc-diff").value;
          await checkAPI.declareSkillCheck(actor, skillKey, diffKey);
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "roll"
  }, { width: 360 }).render(true);
})();
