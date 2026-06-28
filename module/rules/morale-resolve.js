// module/rules/morale-resolve.js
//
// Jet de moral/survie obligatoire quand un combattant est sous le seuil
// critique (≤25% PV) au début de son tour. Réussite = tour normal (2
// actions), échec = fuite automatique. Une seule fois par tour (suivi
// via un flag sur le Combat, clé round-tour).

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

function turnKey(combat) {
  return `${combat.round}-${combat.turn}`;
}

export function hasRolledMoraleThisTurn(combat) {
  if (!combat) return false;
  const rolled = combat.getFlag("rpg", "moraleRolled") ?? {};
  return !!rolled[turnKey(combat)];
}

async function markMoraleRolled(combat) {
  const rolled = foundry.utils.deepClone(combat.getFlag("rpg", "moraleRolled") ?? {});
  rolled[turnKey(combat)] = true;
  await combat.setFlag("rpg", "moraleRolled", rolled);
}

/**
 * Lance le jet de moral (1d20 + Endurance/10, TN 11) et poste le message
 * pending pour validation MJ (Réussite/Échec — comme tout le reste).
 */
export async function declareMoraleCheck(actor) {
  const combat = game.combat;
  if (!combat) return;

  const endurance = n(actor.system?.derived?.effective?.principales?.endurance, 0);
  const bonus = Math.floor(endurance / 10);

  const roll = await (new Roll(`1d20 + ${bonus}`)).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `😰 <b>${actor.name}</b> est en danger critique — jet de moral (TN 11+, +${bonus} Endurance)`
  });

  const content = `
    <div style="font-size:13px">
      <b>${actor.name}</b> doit tenir face au danger (jet : <b>${roll.total}</b>, TN 11+).
      <div class="rpg-morale-gm" style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="rpg-morale-resolve" data-result="fail" style="flex:1;padding:4px;cursor:pointer">Échec — fuit</button>
        <button type="button" class="rpg-morale-resolve" data-result="success" style="flex:1;padding:4px;cursor:pointer">Réussite — tient bon</button>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { rpg: { type: "moraleDeclaration", actorId: actor.id, rollTotal: roll.total } }
  });
}

export function bindMoraleChatButtons(htmlEl, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "moraleDeclaration") return;

  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;

  if (!game.user.isGM) {
    root.querySelector(".rpg-morale-gm")?.remove();
    return;
  }
  if (root.dataset.rpgMoraleBound === "1") return;
  root.dataset.rpgMoraleBound = "1";

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

        if (combat) await markMoraleRolled(combat);

        await message.delete();

        if (result === "success") {
          await ChatMessage.create({
            content: `🛡️ <b>${actor.name}</b> tient bon malgré le danger — agit normalement ce tour.`
          });
        } else {
          const { markFled } = await import("./combat-state.js");
          const combatant = combat?.combatants.find(c => c.actorId === actor.id);
          if (combat && combatant) {
            await markFled(combat, combatant.id, "moral brisé");
          } else {
            await ChatMessage.create({ content: `🏃 <b>${actor.name}</b> craque et fuit le combat !` });
          }
        }
      } catch (e) {
        console.error("[RPG][Morale]", e);
        ui.notifications?.error?.(`Erreur résolution moral : ${e?.message ?? e}`);
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}
