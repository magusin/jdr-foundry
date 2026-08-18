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
import { BASE_VITESSE } from "./base-speed.js";

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
        const elevation = this.token?.document?.elevation ?? 0;
        const { cost } = calculateMovementCost(pts, actor, elevation);
        let text = fmtM(cost);

        // Restant du tour si en combat pour cet acteur
        const combat = game.combat;
        if (combat?.started && actor) {
          // Priorité au tokenId : plusieurs tokens non liés peuvent partager
          // le même acteur, seul le tokenId identifie le bon combattant.
          const tokenId = this.token?.id ?? this.token?.document?.id ?? null;
          const combatant = combat.combatants.find(c => tokenId && c.tokenId === tokenId)
                         ?? combat.combatants.find(c => c.actorId === actor.id);
          if (combatant) {
            const budget    = getBudget(combat, combatant.id);
            const vitesse   = Number(actor.system?.deplacement?.vitesse ?? BASE_VITESSE) || BASE_VITESSE;
            const remaining = movementRemaining(budget, vitesse);
            const after     = Math.max(0, remaining - cost);

            if (cost > remaining + 0.1) {
              // Au-delà de la réserve : on annonce le point d'arrêt
              text += ` · ⛔ arrêt à ${fmtM(remaining)}`;
            } else {
              text += ` · reste ${fmtM(after)}`;
            }
          }
        }

        // Une seule fois : publie la forme du contexte, pour pouvoir cibler le
        // bon champ si Foundry change son gabarit d'étiquette.
        if (!globalThis.__rpgRulerCtxLogged) {
          globalThis.__rpgRulerCtxLogged = true;
          console.log("[RPG] Réglette — champs disponibles :", Object.keys(context),
                      JSON.parse(JSON.stringify(context)));
        }

        // Injecte notre texte dans tous les champs plausibles du gabarit :
        // selon la version, l'étiquette lit cost, distance ou action.
        // `text` porte déjà son unité (« 2 m · reste 1 m ») : si le champ visé
        // fait partie d'un objet {total/text/label, units} et que Foundry
        // affiche `${total} ${units}` dans son gabarit, l'unité se retrouve
        // dupliquée en fin de ligne (« 1 m m ») — on vide `units` en même
        // temps pour ne jamais la laisser se réafficher en double.
        const setField = (key) => {
          const v = context[key];
          if (typeof v === "string") { context[key] = text; return true; }
          if (v && typeof v === "object") {
            if (typeof v.total === "string") {
              v.total = text;
              if (typeof v.units === "string") v.units = "";
              return true;
            }
            if (typeof v.text === "string") {
              v.text = text;
              if (typeof v.units === "string") v.units = "";
              return true;
            }
            if (typeof v.label === "string") {
              v.label = text;
              if (typeof v.units === "string") v.units = "";
              return true;
            }
          }
          return false;
        };
        const injected = ["cost", "distance", "action", "label"].map(setField).some(Boolean);
        if (!injected && typeof context.units === "string") context.units = text;
        context.rpgLabel = text;
      } catch (e) {
        console.warn("[RPG] Réglette de déplacement custom :", e);
      }
      return context;
    }
  }

  CONFIG.Token.rulerClass = RPGTokenRuler;
}
