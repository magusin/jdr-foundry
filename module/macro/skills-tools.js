/**
 * Macro "JDR — Compétences (MJ)"
 *
 * Ajoute ou retire de l'XP à n'importe quelle compétence d'un PJ sans
 * avoir à ouvrir sa fiche. Le niveau monte/descend automatiquement
 * (et le bonus de stat associé avec, via grants), exactement comme les
 * boutons +XP/-XP déjà présents sur la fiche.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  const skillsAPI = game.rpg?.skills;
  if (!skillsAPI) {
    ui.notifications.error("API skills introuvable (game.rpg.skills).");
    return;
  }
  const { skillXpToNext, addXpToSkill: addXp, removeXpFromSkill: removeXp } = skillsAPI;

  const pjs = game.actors
    .filter(a => a.type === "character")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!pjs.length) { ui.notifications.warn("Aucun personnage dans le monde."); return; }

  const pjOptions = pjs.map(p => `<option value="${p.id}">${htmlEscape(p.name)}</option>`).join("");

  const buildSkillRows = (pjId) => {
    const pj = game.actors.get(pjId);
    if (!pj) return "";
    const skills = pj.system?.skills ?? {};
    return Object.entries(skills).map(([key, s]) => {
      const need = skillXpToNext(n(s.level, 0));
      const grantsTxt = Object.entries(s.grants ?? {}).map(([stat, v]) => `+${v} ${stat}/niv`).join(", ");
      return `
        <div class="sk-row" data-skill-key="${key}" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--color-border-tertiary)">
          <div style="flex:1">
            <b>${htmlEscape(s.label ?? key)}</b>
            <div style="font-size:11px;color:var(--color-text-secondary)">
              Niv <b>${n(s.level,0)}</b> — ${n(s.xp,0)}/${need} XP ${grantsTxt ? `— ${grantsTxt}` : ""}
            </div>
          </div>
          <input type="number" class="sk-amount" value="25" min="0" style="width:60px" />
          <button type="button" class="sk-add" data-key="${key}" style="padding:3px 8px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:4px">+XP</button>
          <button type="button" class="sk-remove" data-key="${key}" style="padding:3px 8px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:4px">-XP</button>
        </div>`;
    }).join("");
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Personnage</label>
        <select id="sk-pj" style="width:100%">${pjOptions}</select>
      </div>
      <div id="sk-list" style="max-height:420px;overflow-y:auto">${buildSkillRows(pjs[0]?.id)}</div>
    </div>`;

  new Dialog({
    title: "Compétences (MJ)",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      const pjSel = root.querySelector("#sk-pj");
      const list = root.querySelector("#sk-list");

      const refresh = () => { list.innerHTML = buildSkillRows(pjSel.value); };

      pjSel.addEventListener("change", refresh);

      list.addEventListener("click", async (ev) => {
        const btn = ev.target.closest(".sk-add, .sk-remove");
        if (!btn) return;
        const pj = game.actors.get(pjSel.value);
        if (!pj) return;
        const row = btn.closest(".sk-row");
        const amount = Number(row.querySelector(".sk-amount").value) || 0;
        const key = btn.dataset.key;

        if (btn.classList.contains("sk-add")) await addXp(pj, key, amount);
        else await removeXp(pj, key, amount);

        refresh();
      });
    }
  }, { width: 420, height: 560 }).render(true);
})();
