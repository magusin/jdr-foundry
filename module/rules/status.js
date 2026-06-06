// systems/rpg/module/rules/status.js
//
// ⚠️  Ce module est un STUB de compatibilité.
//
// Le vrai calcul des stats effectives est fait dans documents/actor.js
// (RPGActor.prepareDerivedData) qui est appelé automatiquement par Foundry
// à chaque update d'acteur.
//
// game.rpg.status.recompute(actor) force un re-render de l'acteur pour
// que prepareDerivedData se ré-exécute, sans réécrire les stats à la main.

export async function recompute(actor) {
  if (!actor) return;
  // Force Foundry à recalculer prepareDerivedData + re-render des sheets ouvertes.
  // On évite d'écrire directement dans system pour ne pas écraser les données.
  actor.reset();
  actor.sheet?.render(false);
}

export const status = { recompute };

// Assigne l'API globale (appelé depuis init.js > ready)
if (typeof game !== "undefined") {
  if (!game.rpg) game.rpg = {};
  game.rpg.status = status;
}
