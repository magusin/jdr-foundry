// module/rules/forge-resolve.js
//
// Validation MJ d'une tentative de forge. Le joueur déclare (ingrédients
// vérifiés, jet de chance déjà lancé), le MJ valide Réussite/Échec —
// il peut suivre la suggestion du jet ou la corriger librement.
// Rien n'est consommé ni créé avant cette validation.

import { resolveCraft } from "./forge.js";

export function bindForgeChatButtons(htmlEl, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "forgeDeclaration") return;

  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;

  if (!game.user.isGM) {
    root.querySelector(".rpg-forge-gm")?.remove();
    return;
  }

  if (root.dataset.rpgForgeBound === "1") return;
  root.dataset.rpgForgeBound = "1";

  if (flags.resolved) {
    root.querySelectorAll(".rpg-forge-resolve").forEach(b => { b.disabled = true; b.style.opacity = "0.4"; });
    return;
  }

  const buttons = root.querySelectorAll(".rpg-forge-resolve");
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!game.user.isGM) return;

      const result = btn.dataset.result; // "success" | "fail"
      for (const b of buttons) b.disabled = true;

      try {
        const actor  = game.actors.get(flags.actorId);
        const recipe = actor?.items.get(flags.recipeId);
        if (!actor || !recipe) {
          ui.notifications?.error?.("Acteur ou recette introuvable.");
          for (const b of buttons) b.disabled = false;
          return;
        }

        const { content } = await resolveCraft(actor, recipe, {
          success: result === "success",
          roll: flags.roll ?? null,
          chance: flags.chance ?? null
        });

        await message.delete();
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
      } catch (e) {
        console.error("[RPG][ForgeResolve]", e);
        ui.notifications?.error?.(`Erreur résolution forge : ${e?.message ?? e}`);
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}
