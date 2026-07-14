// module/rules/level-up.js
//
// Gestion de la progression de niveau des PJ.
// Appelé après chaque gain d'XP (combat, jet de compétence, etc.)

const XP_PER_LEVEL = 100; // XP nécessaire pour passer un niveau

/**
 * Vérifie si le PJ doit monter de niveau et le fait automatiquement.
 * Affiche un popup immersif si le niveau augmente.
 */
export async function checkLevelUp(actor) {
  if (!actor || actor.type !== "character") return;
  if (!game.user.isGM && !actor.isOwner) return;

  const sys    = actor.system ?? {};
  const xpVal  = Number(sys.xp?.valeur ?? 0) || 0;
  const xpMax  = Number(sys.xp?.max ?? XP_PER_LEVEL) || XP_PER_LEVEL;
  const niveau = Number(sys.niveau ?? 1) || 1;

  if (xpVal < xpMax) return; // pas encore niveau supérieur

  const newNiveau = niveau + Math.floor(xpVal / xpMax);
  const remaining = xpVal % xpMax;

  // Mise à jour niveau + XP restants
  await actor.update({
    "system.niveau":     newNiveau,
    "system.xp.valeur":  remaining,
    "system.xp.max":     XP_PER_LEVEL  // toujours 100 par niveau
  });

  // Popup immersif (visible pour le joueur propriétaire et le MJ)
  const gains = _getLevelGains(newNiveau);
  await ChatMessage.create({
    content: `
      <div style="text-align:center;padding:10px;background:linear-gradient(135deg,rgba(155,89,182,0.15),rgba(41,128,185,0.15));border-radius:12px;border:1px solid rgba(155,89,182,0.4)">
        <div style="font-size:22px;font-weight:900;color:#9b59b6;letter-spacing:2px">✨ NIVEAU ${newNiveau} ✨</div>
        <div style="font-size:15px;margin:6px 0;font-weight:700">${actor.name}</div>
        <div style="font-size:12px;opacity:.8;margin-top:8px">${gains}</div>
        <div style="font-size:11px;opacity:.6;margin-top:4px">XP restants : ${remaining} / ${XP_PER_LEVEL}</div>
      </div>`,
    whisper: game.users.filter(u =>
      u.isGM || actor.testUserPermission(u, "OWNER")
    ).map(u => u.id)
  });

  // Notification
  ui.notifications?.info?.(`⬆️ ${actor.name} passe niveau ${newNiveau} !`);
}

function _getLevelGains(newLevel) {
  const lines = [
    `+1 à chaque stat principale (maintenant +${newLevel} par stat)`,
    `Capacité de compétences : ${10 + 2 * newLevel} niveaux maximum`
  ];
  return lines.map(l => `<div>• ${l}</div>`).join("");
}
