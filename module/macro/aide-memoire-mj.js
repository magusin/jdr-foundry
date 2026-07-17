/**
 * Macro "Aide-mémoire MJ"
 * Affiche un panneau flottant avec toutes les formules essentielles.
 * Conçu pour être gardé ouvert pendant la session.
 */
(async () => {
  const sections = [
    {
      title: "⚔️ Toucher",
      color: "#e05a00",
      rows: [
        "TN = f(ATK/DEF ratio) + difficulté − bonus toucher",
        "Phys : ATK = Dextérité attaquant, DEF = Dextérité défenseur",
        "Mag : ATK = Acuité attaquant, DEF = Acuité défenseur",
        "5 ou moins → Échec auto | 16 ou plus → Succès auto",
        "TN borné entre 6 et 16"
      ]
    },
    {
      title: "💥 Dégâts",
      color: "#c0392b",
      rows: [
        "Bruts = Dés + Plat + floor(Stat/par)×parPas",
        "1. Soustraire Armure fixe",
        "2. Appliquer réduction % (cap 70%)",
        "3. Minimum 1 dégât",
        "Score → % : score/(score+160)×100 [cap 70%]",
        "Score 40=20% | 80=33% | 160=50%"
      ]
    },
    {
      title: "📊 Stats (total)",
      color: "#9b59b6",
      rows: [
        "Total = Base + Niveau + Compétences + Équip/Effets",
        "+1 par stat par niveau (automatique)",
        "PV = base(30) + floor(End/5) + bonus",
        "Mana = base(5) + floor(Int/20) + bonus",
        "FatigueMax = base(10) + floor(End/10) + bonus"
      ]
    },
    {
      title: "🔧 Forge",
      color: "#f39c12",
      rows: [
        "Chance = clamp(50 + nvForge×5 − difficulté, 5%, 95%)",
        "Niv0 diff0=50% | Niv5 diff0=75% | Niv10 diff20=80%",
        "1d100 ≤ chance = réussite"
      ]
    },
    {
      title: "🎓 Compétences",
      color: "#2980b9",
      rows: [
        "XP niv N→N+1 = 100 + 50×N",
        "TN jet = difficulté(MJ) − niveau compétence",
        "Plafond total = 10 + 2×niveau perso",
        "XP gain : +10 réussite / +3 échec"
      ]
    },
    {
      title: "⬆️ Niveau perso",
      color: "#1d9e75",
      rows: [
        "100 XP = niveau suivant (auto)",
        "XP combat = XP monstres ÷ nb PJ",
        "XP surplus conservé au level up"
      ]
    },
    {
      title: "🏃 Déplacement (1m/case)",
      color: "#16a085",
      rows: [
        "Vitesse base : 6m/tour",
        "Terrain difficile/boue : ×0.5 → 3m effectifs",
        "Eau peu profonde : ×0.67 → 4m effectifs",
        "Eau profonde : ×0.33 → 2m effectifs",
        "🦅 Volant : ignore TOUT terrain"
      ]
    },
    {
      title: "😰 Moral / Retrait état",
      color: "#8e44ad",
      rows: [
        "Moral : 1d20 + floor(End/10) + niv.Volonté ≥ 11",
        "Déclenché si PV ≤ 25% en début de tour",
        "Retrait état : 1d20 + bonus ≥ TN état"
      ]
    }
  ];

  const html = sections.map(s => `
    <div style="margin-bottom:10px;padding:8px;background:${s.color}11;border-left:3px solid ${s.color};border-radius:0 6px 6px 0">
      <div style="font-weight:700;color:${s.color};font-size:12px;margin-bottom:4px">${s.title}</div>
      ${s.rows.map(r => `<div style="font-size:11px;line-height:1.6;opacity:.9">${r}</div>`).join("")}
    </div>`).join("");

  // Ouvre dans une fenêtre flottante Foundry
  new Dialog({
    title: "📋 Aide-mémoire MJ",
    content: `
      <div style="column-count:2;column-gap:12px;padding:4px;max-height:70vh;overflow-y:auto">
        ${html}
      </div>
      <hr style="margin:8px 0">
      <div style="font-size:10px;opacity:.5;text-align:center">
        Guide complet : Compendium → Documentation → Aide-mémoire MJ
      </div>`,
    buttons: {
      close: { label: "Fermer" }
    },
    default: "close",
    options: { width: 700, height: 600, resizable: true }
  }).render(true);
})();
