// module/rules/agonie-resolve.js
//
// Jet de Volonté obligatoire quand un combattant tombe à l'agonie (≤15%
// PV) au début de son tour. Une seule fois par combat (pas par tour) —
// suivi via un flag sur le Combat, clé actorId. Cette action prévaut sur
// toutes les autres tant qu'elle n'a pas été résolue.

import { skillLevel } from "./skills.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

export function hasRolledAgonieCheck(combat, actorId) {
  if (!combat || !actorId) return false;
  const rolled = combat.getFlag("rpg", "agonieRolled") ?? {};
  return !!rolled[actorId];
}

async function markAgonieRolled(combat, actorId) {
  const rolled = foundry.utils.deepClone(combat.getFlag("rpg", "agonieRolled") ?? {});
  rolled[actorId] = true;
  await combat.setFlag("rpg", "agonieRolled", rolled);
}

/**
 * Lance le jet de Volonté (1d20 + niveau de Volonté, TN 11) et poste le
 * message pending pour validation MJ (Réussite/Échec — comme tout le reste).
 */
export async function declareAgonieCheck(actor) {
  const combat = game.combat;
  if (!combat) return;

  // Lu par RÔLE, jamais par clé brute : la clé exacte dépend du monde
  // (voir SKILL_ALIASES). Avant ça le code lisait `survie` en dur, et un
  // monde dont la compétence s'appelle `volonte` voyait ce terme valoir 0
  // en silence — le message annonçait pourtant un bonus.
  const volonteLevel = skillLevel(actor, "volonte");

  const roll = await (new Roll(`1d20 + ${volonteLevel}`)).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `🩸 <b>${actor.name}</b> est à l'agonie — jet de Volonté (TN 11+${volonteLevel ? ` +${volonteLevel} Volonté` : ""})`
  });

  const content = `
    <div style="font-size:13px">
      <b>${actor.name}</b> doit tenir face à l'agonie (jet : <b>${roll.total}</b>, TN 11+).
      <div class="rpg-morale-gm" style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="rpg-morale-resolve" data-result="fail" style="flex:1;padding:4px;cursor:pointer">Échec — fuit</button>
        <button type="button" class="rpg-morale-resolve" data-result="success" style="flex:1;padding:4px;cursor:pointer">Réussite — tient bon</button>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { rpg: { type: "agonieDeclaration", actorId: actor.id, rollTotal: roll.total } }
  });
}

export function bindAgonieChatButtons(htmlEl, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "agonieDeclaration") return;

  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;

  if (!game.user.isGM) {
    root.querySelector(".rpg-morale-gm")?.remove();
    return;
  }
  if (root.dataset.rpgAgonieBound === "1") return;
  root.dataset.rpgAgonieBound = "1";

  const buttons = root.querySelectorAll(".rpg-morale-resolve");
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      for (const b of buttons) b.disabled = true;

      try {
        const actor = game.actors.get(flags.actorId);
        const result = btn.dataset.result;
        const combat = game.combat;

        if (combat) await markAgonieRolled(combat, flags.actorId);

        await message.delete();

        if (result === "success") {
          await ChatMessage.create({
            content: `🛡️ <b>${actor.name}</b> tient bon malgré l'agonie — agit normalement ce tour.`
          });
        } else {
          const { markFled } = await import("./combat-state.js");
          const combatant = combat?.combatants.find(c => c.actorId === actor.id);
          if (combat && combatant) {
            await markFled(combat, combatant.id, "volonté brisée par l'agonie");
          } else {
            await ChatMessage.create({ content: `🏃 <b>${actor.name}</b> craque et fuit le combat !` });
          }
        }
      } catch (e) {
        console.error("[RPG][Agonie]", e);
        ui.notifications?.error?.(`Erreur résolution jet de Volonté : ${e?.message ?? e}`);
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}
