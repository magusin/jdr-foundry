/**
 * Macro "Jet de Compétence"
 * 
 * Le MJ choisit :
 * - Le personnage ciblé
 * - La compétence (parmi toutes les compétences du jeu, pas juste celles du PJ)
 * - La difficulté (valeur numérique libre, ex: 14)
 * - Si c'est un test secret (le joueur ne voit pas le TN)
 * 
 * Formule : TN = difficulté - niveau de la compétence du joueur
 * (un niveau élevé dans la compétence réduit le jet minimum requis)
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Seul le MJ peut initier un jet de compétence.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  // Liste de TOUS les personnages
  const characters = game.actors.filter(a => a.type === "character");
  if (!characters.length) {
    ui.notifications.warn("Aucun personnage trouvé.");
    return;
  }

  // Récupère la liste complète des compétences depuis le 1er PJ (ou la config système)
  const allSkills = [
    { key: "force",       label: "Athlétisme / Force brute" },
    { key: "discretion",  label: "Discrétion" },
    { key: "crochetage",  label: "Crochetage" },
    { key: "perception",  label: "Perception" },
    { key: "survie",      label: "Survie" },
    { key: "forge",       label: "Forge / Artisanat" },
    { key: "arcane",      label: "Arcane / Connaissances magiques" },
    { key: "medecine",    label: "Médecine" },
    { key: "eloquence",   label: "Éloquence / Persuasion" },
    { key: "escalade",    label: "Escalade / Acrobaties" },
  ];

  // Récupère dynamiquement les compétences du 1er PJ si disponibles
  const firstPJ = characters[0];
  const pjSkills = firstPJ?.system?.skills ?? {};
  const skillList = Object.keys(pjSkills).length
    ? Object.entries(pjSkills).map(([key, s]) => ({ key, label: s.label ?? key }))
    : allSkills;

  const actorOptions = characters
    .map(a => `<option value="${a.id}">${htmlEscape(a.name)}</option>`)
    .join("");

  const skillOptions = skillList
    .map(s => `<option value="${s.key}">${htmlEscape(s.label)}</option>`)
    .join("");

  new Dialog({
    title: "Jet de Compétence (MJ)",
    content: `
      <div style="display:flex;flex-direction:column;gap:12px;padding:4px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Personnage</label>
          <select id="sc-actor" style="width:100%">${actorOptions}</select>
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Compétence testée</label>
          <select id="sc-skill" style="width:100%">${skillOptions}</select>
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">
            Difficulté de l'action
            <span style="font-weight:400;opacity:.7;font-size:11px"> — TN final = difficulté − niveau compétence</span>
          </label>
          <input id="sc-diff" type="number" value="11" min="1" max="30" style="width:100%;font-size:15px;font-weight:700;text-align:center" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(200,100,0,0.1);border-radius:6px;border:1px solid rgba(200,100,0,0.3)">
          <input type="checkbox" id="sc-secret" style="width:16px;height:16px" />
          <label for="sc-secret" style="cursor:pointer;font-size:13px">
            🔒 <b>Test secret</b> — le joueur ne voit pas le TN minimum
          </label>
        </div>
      </div>`,
    buttons: {
      ok: {
        label: "✅ Envoyer le jet",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const actorId  = root.querySelector("#sc-actor").value;
          const skillKey = root.querySelector("#sc-skill").value;
          const diff     = Number(root.querySelector("#sc-diff").value) || 11;
          const secret   = root.querySelector("#sc-secret").checked;

          const actor = game.actors.get(actorId);
          if (!actor) return;

          const { declareSkillCheck } = game.rpg?.skillCheck ?? {};
          if (!declareSkillCheck) {
            ui.notifications.error("API skillCheck introuvable.");
            return;
          }

          await declareSkillCheck(actor, skillKey, diff, { secret });
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "ok",
    options: { width: 400 }
  }).render(true);
})();
