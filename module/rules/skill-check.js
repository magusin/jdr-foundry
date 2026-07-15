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
export async function declareSkillCheck(actor, skillKey, difficulty = 11, opts = {}) {
  const secret     = !!opts.secret;
  const skill      = actor.system?.skills?.[skillKey];
  const skillLabel = skill?.label ?? skillKey;
  const skillLevel = n(skill?.level, 0);

  // TN = difficulté - niveau compétence (le niveau soulage la difficulté)
  const tn = Math.max(1, difficulty - skillLevel);
  const speaker = ChatMessage.getSpeaker({ actor });

  // Message avec bouton "Lancer" pour le joueur
  const rollContent = `
    <div style="font-size:13px">
      🎲 <b>${actor.name}</b> — <b>${skillLabel}</b>
      ${secret
        ? `<div style="opacity:.6;font-size:11px;margin-top:2px">🔒 Test secret — fais de ton mieux.</div>`
        : `<div style="opacity:.85;font-size:12px;margin-top:2px">Objectif : <b>${tn}+</b> sur 1d20${skillLevel ? ` (difficulté ${difficulty} − niv.${skillLevel})` : ``}</div>`
      }
      <button type="button" class="rpg-skillcheck-roll-btn"
        data-actor-id="${actor.id}" data-skill-key="${skillKey}"
        data-skill-label="${skillLabel}" data-tn="${tn}" data-secret="${secret}"
        style="width:100%;margin-top:8px;padding:5px;cursor:pointer;border-radius:6px;font-weight:600">
        🎲 Lancer le dé
      </button>
    </div>`;

  // Whisper MJ avec le vrai TN même si secret
  const gmContent = `
    <div style="font-size:11px;color:#c8960a;padding:5px;border:1px solid rgba(200,150,0,0.3);border-radius:6px">
      ⚙️ MJ — ${actor.name} → <b>${skillLabel}</b><br>
      Difficulté : ${difficulty} | Niveau compétence : ${skillLevel} | <b>TN réel : ${tn}+</b>
      ${secret ? " | 🔒 SECRET" : ""}
    </div>`;

  await ChatMessage.create({ speaker, content: rollContent });
  await ChatMessage.create({ speaker, content: gmContent, whisper: game.users.filter(u => u.isGM).map(u => u.id) });
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

        // XP compétence uniquement (monte les niveaux de compétence)
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
