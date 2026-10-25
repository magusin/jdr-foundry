/**
 * Macro « 📚 Installer la campagne (MJ) »
 *
 * Installe dans le monde le cadre « Les Marches de Cendrebrume » : bestiaire
 * calibré (25 créatures, plages de génération et capacités calculées par le
 * système), 7 PNJ avec leurs notes MJ, 9 quêtes (trame principale en cinq
 * actes + secondaires), objets de butin et de récompense, et un journal
 * « Guide du MJ ». Toute la logique vit dans rules/campaign-content.js
 * (game.rpg.content).
 *
 * Idempotent : relancer ne recrée que ce qui manque. Rien de ce que le MJ a
 * modifié n'est écrasé.
 */
(async () => {
  if (!game.user.isGM) return ui.notifications.warn("Réservé au MJ.");
  const C = game.rpg?.content;
  if (!C) return ui.notifications.error("Contenu indisponible (game.rpg.content) — recharge le monde.");
  const DialogV2 = foundry.applications.api.DialogV2;

  const parts = [
    ["monsters", `Bestiaire (${C.BESTIARY.length} créatures)`],
    ["npcs", `PNJ (${C.NPCS.length})`],
    ["quests", `Quêtes (${C.QUESTS.length})`],
    ["loot", `Matériaux de butin (${C.LOOT.length})`],
    ["rewards", `Objets de récompense (${C.REWARDS.length})`],
    ["journal", "Journal « Guide du MJ »"]
  ];
  const res = await DialogV2.wait({
    window: { title: `📚 ${C.SETTING_NAME}` },
    position: { width: 460 },
    content: `<p>Installe le cadre de campagne <b>${C.SETTING_NAME}</b> dans ce monde, dans des dossiers à son nom.</p>
      ${parts.map(([k, l]) => `<label style="display:block"><input type="checkbox" name="${k}" checked/> ${l}</label>`).join("")}
      <p style="font-size:11px;opacity:.75;margin-top:8px">Les monstres sont calibrés au moment de l'installation contre
        les réglages de pesée du monde (taille du groupe, dégâts par attaque) : règle-les d'abord si ta table
        n'est pas un groupe de 3. Relancer l'installation ne recrée que ce qui manque.</p>`,
    buttons: [
      { action: "ok", label: "Installer", default: true, callback: (ev, btn, dlg) =>
          Object.fromEntries(parts.map(([k]) => [k, !!dlg.element.querySelector(`[name=${k}]`)?.checked])) },
      { action: "cancel", label: "Annuler" }
    ],
    rejectClose: false
  }).catch(() => null);
  if (!res || res === "cancel") return;

  ui.notifications.info("Installation en cours…");
  try {
    const report = await C.installCampaignContent(res);
    const list = report.created.length
      ? `<ul style="font-size:11px">${report.created.map(x => `<li>${x}</li>`).join("")}</ul>` : "<p>Rien de nouveau.</p>";
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
      speaker: { alias: C.SETTING_NAME },
      content: `<h3>📚 ${C.SETTING_NAME}</h3><p><b>${report.created.length}</b> document(s) créé(s), ${report.skipped} déjà présent(s).</p>${list}
        <p>Commence par le journal « ${C.SETTING_NAME} — Guide du MJ », puis la quête « I · La Brume qui monte ».</p>`
    });
    ui.notifications.info(`${report.created.length} document(s) créé(s).`);
  } catch (e) {
    console.error("[RPG] installCampaignContent:", e);
    ui.notifications.error(`Échec de l'installation : ${e?.message ?? e}`);
  }
})();
