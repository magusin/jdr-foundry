// module/rules/critfail-dialog.js
//
// Dialog MJ pour choisir la conséquence d'un Échec Critique (attaque ou sort).
// Le MJ choisit toujours lui-même la conséquence — jamais de randomisation
// pour ce résultat spécifique (contrairement à l'échec simple qui pioche
// un message au hasard).

const ATTACK_OPTIONS = [
  "L'arme glisse des mains et tombe au sol !",
  "Trébuche et perd l'équilibre !",
  "Le coup part dans le vide, complètement déséquilibré !",
  "Manque cruellement sa cible — la honte !",
  "Touche un allié proche (à l'appréciation du MJ) !",
  "Personnalisé…"
];

const SPELL_OPTIONS = [
  "Le sort se retourne contre le lanceur !",
  "La magie devient incontrôlable et se dissipe violemment !",
  "Perd le fil de l'incantation, mana gaspillé pour rien !",
  "Effet inattendu et imprévisible (à l'appréciation du MJ) !",
  "L'élément se déchaîne sur une zone proche, au hasard !",
  "Personnalisé…"
];

/**
 * Ouvre un Dialog pour que le MJ choisisse la conséquence d'un échec critique.
 * Retourne une Promise résolue avec { label, selfDamage } ou null si annulé.
 */
export function promptCritFailConsequence({ kind = "attack", actorName = "" } = {}) {
  return new Promise((resolve) => {
    const options = kind === "spell" ? SPELL_OPTIONS : ATTACK_OPTIONS;
    const lastIdx = options.length - 1;
    const optionsHtml = options.map((o, i) => `<option value="${i}">${o}</option>`).join("");

    const content = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:12px;color:var(--color-text-secondary)">
          ☠ Échec critique de <b>${actorName}</b> — choisis la conséquence
        </div>
        <select id="cf-option" style="width:100%">${optionsHtml}</select>
        <div id="cf-custom-wrap" style="display:none">
          <label style="font-size:11px;display:block;margin-bottom:2px">Message personnalisé</label>
          <input id="cf-custom" type="text" style="width:100%" placeholder="Décris la conséquence…" />
        </div>
        <div>
          <label style="font-size:11px;display:block;margin-bottom:2px">Dégâts auto-infligés (optionnel)</label>
          <input id="cf-selfdmg" type="number" min="0" value="0" style="width:100%" />
        </div>
      </div>`;

    const dlg = new Dialog({
      title: "Échec Critique — Conséquence (MJ)",
      content,
      render: (html) => {
        const root = html?.[0] ?? html;
        const sel = root.querySelector("#cf-option");
        const customWrap = root.querySelector("#cf-custom-wrap");
        const toggle = () => {
          customWrap.style.display = (Number(sel.value) === lastIdx) ? "block" : "none";
        };
        sel?.addEventListener("change", toggle);
        toggle();
      },
      buttons: {
        apply: {
          label: "✅ Appliquer",
          callback: (html) => {
            const root = html?.[0] ?? html;
            const idx = Number(root.querySelector("#cf-option")?.value ?? 0);
            const isCustom = idx === lastIdx;
            const customText = String(root.querySelector("#cf-custom")?.value ?? "").trim();
            const label = (isCustom && customText) ? customText : options[idx];
            const selfDamage = Math.max(0, Number(root.querySelector("#cf-selfdmg")?.value) || 0);
            resolve({ label, selfDamage });
          }
        },
        cancel: {
          label: "Annuler",
          callback: () => resolve(null)
        }
      },
      default: "apply",
      close: () => resolve(null)
    }, { width: 400 });

    dlg.render(true);
  });
}
