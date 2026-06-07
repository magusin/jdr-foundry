// module/rules/attack-resolve.js
//
// Gestion côté MJ des boutons Échec / Touché / Critique dans les messages
// de déclaration d'attaque physique (type "attackDeclaration").

/**
 * Appelée dans renderChatMessageHTML.
 * Affiche les boutons uniquement pour le MJ, les désactive si déjà résolue.
 */
export function bindAttackChatButtons(html, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "attackDeclaration") return;

  // Masque les boutons pour les non-MJ
  const btns = html.querySelectorAll?.(".rpg-attack-resolve")
    ?? html.find?.(".rpg-attack-resolve").toArray()
    ?? [];

  if (!game.user.isGM) {
    for (const b of btns) b.style.display = "none";
    return;
  }

  // Déjà résolue ?
  if (flags.resolved) {
    for (const b of btns) { b.disabled = true; b.style.opacity = "0.4"; }
    return;
  }

  for (const b of btns) {
    b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!game.user.isGM) return;

      const result = b.dataset.result; // "fail" | "hit" | "crit"
      await resolveAttack(message, result);
    });
  }
}

/**
 * Résout l'attaque : applique ou non les dégâts, poste un message de résolution.
 */
async function resolveAttack(message, result) {
  if (!game.user.isGM) return;

  const f = message?.flags?.rpg ?? {};
  const attacker = game.actors.get(f.actorId);
  const target   = game.actors.get(f.targetId);
  const weapon   = attacker?.items.get(f.weaponId);

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  let content = "";
  let pvLine  = "";

  if (result === "fail") {
    content = `<b>Échec</b> — ${attacker?.name ?? "?"} rate son attaque contre ${target?.name ?? "?"}.`;

  } else {
    // Sur crit, on recalcule les dégâts avec isCrit=true si le MJ clique Critique
    // (le joueur avait peut-être fait 15, le MJ peut valider un crit contextuel)
    const isCrit = result === "crit";
    let dmgFinal = n(f.dmgFinal, 0);

    if (isCrit && weapon && attacker && target) {
      try {
        const r = await weapon.rollDamage({
          attackerActor: attacker,
          targetActor:   target,
          isCrit:        true,
          type:          String(f.livraison ?? "physique")
        });
        dmgFinal = r.final;
      } catch (e) {
        console.warn("[RPG][AttackResolve] rollDamage crit failed:", e);
      }
    }

    // Applique les dégâts
    if (target) {
      const pvCur = n(target.system?.ressources?.pv?.valeur, 0);
      const pvMax = n(target.system?.ressources?.pv?.max, 0);
      const pvNew = Math.max(0, pvCur - dmgFinal);
      await target.update({ "system.ressources.pv.valeur": pvNew });
      pvLine = `<br>${target.name} : ${pvCur} → <b>${pvNew}</b> / ${pvMax} PV`;
    }

    const label = isCrit ? "✦ CRITIQUE !" : "✔ TOUCHÉ";
    const col   = isCrit ? "gold" : "#27ae60";
    content =
      `<b style="color:${col}">${label}</b> — ` +
      `${attacker?.name ?? "?"} inflige <b>${dmgFinal}</b> dégâts à ${target?.name ?? "?"}` +
      (isCrit ? ` (critique)` : "") +
      pvLine;
  }

  // Marque le message comme résolu pour désactiver les boutons
  await message.update({ "flags.rpg.resolved": true, "flags.rpg.resolvedResult": result });

  await ChatMessage.create({
    speaker: { alias: "MJ" },
    content
  });
}
