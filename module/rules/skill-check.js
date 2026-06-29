// module/rules/skill-check.js
//
// Jet de compétence générique : Crochetage, Discrétion, Perception... —
// jusqu'ici elles ne donnaient qu'un bonus de stat passif, aucune n'avait
// de vrai jet. Comble ce manque, sur le même modèle que le reste du
// système (le joueur lance, le MJ valide Réussite/Échec).

import { addXpToSkill } from "./skills.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

export const DIFFICULTY_TIERS = {
  trivial:        { label: "Trivial",         tn: 6  },
  facile:         { label: "Facile",           tn: 9  },
  moyen:          { label: "Moyen",            tn: 11 },
  difficile:      { label: "Difficile",        tn: 14 },
  tresDifficile:  { label: "Très difficile",   tn: 17 },
  quasiImpossible:{ label: "Quasi impossible", tn: 19 }
};

// Stat dont dépend chaque compétence pour le bonus au jet (cohérent avec
// son "grants" déjà défini sur l'acteur — réutilise la même logique).
function statForSkill(actor, skillKey) {
  const skill = actor.system?.skills?.[skillKey];
  const grants = skill?.grants ?? {};
  const firstStat = Object.keys(grants)[0];
  return firstStat ?? "dexterite";
}

/**
 * Déclare un jet de compétence : lance 1d20 + bonus de stat + niveau de
 * compétence, affiche le TN visé, poste un message MJ Réussite/Échec.
 */
export async function declareSkillCheck(actor, skillKey, difficultyKey = "moyen") {
  const skill = actor.system?.skills?.[skillKey];
  if (!skill) {
    ui.notifications?.warn?.("Compétence introuvable sur cet acteur.");
    return;
  }

  const diff = DIFFICULTY_TIERS[difficultyKey] ?? DIFFICULTY_TIERS.moyen;
  const statKey = statForSkill(actor, skillKey);
  const statVal = n(actor.system?.derived?.effective?.principales?.[statKey], 0);
  const statBonus = Math.floor(statVal / 10);
  const skillLevel = n(skill.level, 0);
  const totalBonus = statBonus + skillLevel;

  const roll = await (new Roll(`1d20 + ${totalBonus}`)).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `🎲 <b>${actor.name}</b> — Jet de <b>${skill.label ?? skillKey}</b> ` +
      `(+${statBonus} ${statKey}, +${skillLevel} niveau) — ${diff.label} (TN ${diff.tn}+)`
  });

  const content = `
    <div style="font-size:13px">
      <b>${actor.name}</b> tente : <b>${skill.label ?? skillKey}</b> — ${diff.label}<br>
      Jet : <b>${roll.total}</b> (TN ${diff.tn}+)
      <div class="rpg-skillcheck-gm" style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="rpg-skillcheck-resolve" data-result="fail" style="flex:1;padding:4px;cursor:pointer">Échec</button>
        <button type="button" class="rpg-skillcheck-resolve" data-result="success" style="flex:1;padding:4px;cursor:pointer">Réussite</button>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { rpg: { type: "skillCheckDeclaration", actorId: actor.id, skillKey, rollTotal: roll.total, tn: diff.tn } }
  });
}

export function bindSkillCheckChatButtons(htmlEl, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "skillCheckDeclaration") return;

  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;

  if (!game.user.isGM) {
    root.querySelector(".rpg-skillcheck-gm")?.remove();
    return;
  }
  if (root.dataset.rpgSkillcheckBound === "1") return;
  root.dataset.rpgSkillcheckBound = "1";

  const buttons = root.querySelectorAll(".rpg-skillcheck-resolve");
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      for (const b of buttons) b.disabled = true;

      try {
        const actor = game.actors.get(flags.actorId);
        const success = btn.dataset.result === "success";

        // ✅ Petit gain d'XP à chaque tentative — encourage la pratique
        // organique, même montant d'esprit que la Forge (réussite > échec)
        if (actor) await addXpToSkill(actor, flags.skillKey, success ? 10 : 3);

        await message.delete();
        await ChatMessage.create({
          content: `<b style="color:${success ? "#1d9e75" : "#c0392b"}">${success ? "✅ RÉUSSITE" : "❌ ÉCHEC"}</b> — ${actor?.name ?? "?"}`
        });
      } catch (e) {
        console.error("[RPG][SkillCheck]", e);
        ui.notifications?.error?.(`Erreur résolution jet : ${e?.message ?? e}`);
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}
