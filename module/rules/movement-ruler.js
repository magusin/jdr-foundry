// module/rules/movement-ruler.js
//
// Réglette de déplacement personnalisée (Foundry V13).
// Affiche, pendant qu'on glisse un token, le coût RP RÉEL — diagonales
// pondérées (rpg.diagonalRule) + terrain difficile — et le déplacement
// RESTANT du tour en combat. Utilise EXACTEMENT la même source de calcul
// que le message de chat (calculateMovementCost), pour une cohérence totale
// entre la prédiction et le résultat.
//
// Implémentation défensive : tout l'enrichissement est protégé par try/catch
// et retombe sur le label par défaut de Foundry si l'API diffère.

import { calculateMovementCost } from "./region-behaviors.js";
import { getBudget, movementRemaining } from "./action-budget.js";

function fmtM(m) {
  const v = Math.round((Number(m) || 0) * 10) / 10;
  return (v % 1 === 0) ? `${v} m` : `${v.toFixed(1)} m`;
}

/**
 * Installe la réglette custom via CONFIG.Token.rulerClass.
 * Idempotent (ne ré-emballe pas si déjà fait).
 */
export function installRPGTokenRuler() {
  const Base = CONFIG?.Token?.rulerClass;
  if (!Base || Base.rpgPatched) return;

  class RPGTokenRuler extends Base {
    static rpgPatched = true;

    _getWaypointLabelContext(waypoint, state) {
      const context = super._getWaypointLabelContext(waypoint, state);
      try {
        if (!context || !waypoint) return context;
        const actor = this.token?.actor;

        // Reconstruit le trajet (origine → ce waypoint) en coordonnées pixel
        const pts = [];
        let w = waypoint, guard = 0;
        while (w && guard++ < 500) {
          const c = w.center ?? w.point ?? null;
          if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) pts.unshift({ x: c.x, y: c.y });
          w = w.previous;
        }
        if (pts.length < 2) return context;

        // Coût RP (diagonales + terrain) — même calcul que le chat
        const { cost } = calculateMovementCost(pts, actor);
        let text = fmtM(cost);

        // Restant du tour si en combat pour cet acteur
        const combat = game.combat;
        if (combat?.started && actor) {
          const combatant = combat.combatants.find(c => c.actorId === actor.id);
          if (combatant) {
            const budget  = getBudget(combat, combatant.id);
            const vitesse = Number(actor.system?.deplacement?.vitesse ?? 6) || 6;
            const after   = Math.max(0, movementRemaining(budget, vitesse) - cost);
            text += ` · reste ${fmtM(after)}`;
          }
        }

        // Injecte notre texte dans les champs les plus courants du template
        if (typeof context.cost === "string") context.cost = text;
        else if (context.cost && typeof context.cost === "object") context.cost.total = text;
        if (typeof context.distance === "string") context.distance = fmtM(cost);
        context.rpgLabel = text;
      } catch (e) {
        console.warn("[RPG] Réglette de déplacement custom :", e);
      }
      return context;
    }
  }

  CONFIG.Token.rulerClass = RPGTokenRuler;
}
