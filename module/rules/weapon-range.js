// module/rules/weapon-range.js
//
// Portée d'attaque : UNE seule définition, partagée par le menu de combat,
// l'action de base « Attaquer » et les cercles dessinés sur le canevas.
//
// Deux champs décrivent la portée d'une arme, et ils ne veulent pas dire la
// même chose :
//   - system.allonge   : allonge de MÊLÉE (défaut 1 m). C'est elle qui définit
//                        la zone de menace, les attaques d'opportunité
//                        (movement-tracker.js) et l'anneau ⚔ affiché autour du
//                        combattant actif (range-overlay.js).
//   - system.range.max : portée de JET/TIR ("laisse la même valeur que
//                        l'allonge pour une arme de mêlée pure", dit la fiche
//                        d'arme elle-même).
//
// Le menu de combat ne regardait QUE `range.max`. Une épée dont ce champ était
// resté à 0,5 m — voire à 0, ce qu'aucune fiche n'interdit — devenait
// inutilisable : « Hors portée (1.0m, portée max 0.5m) » sur une cible pourtant
// collée au personnage, alors que l'anneau de menace dessiné sur la carte,
// lui, se base sur l'allonge et affichait bien la cible comme atteignable. La
// portée d'attaque effective est donc le MAXIMUM des deux : une arme de mêlée
// mal renseignée retombe sur son allonge, un arc garde sa portée de tir.

// ⚠️ La MESURE elle-même ne vit pas ici : elle est dans utils/grid.js, seule
// référence du système (sorts, allonge, désengagement, cercles du canevas).
// Ce module ne fait que traduire les DEUX champs de portée d'une arme en un
// intervalle de mètres, puis déléguer la comparaison. Il a un temps porté sa
// propre copie du calcul, avec une empreinte de token différente — c'est
// exactement ainsi que le cercle affiché et le bouton « Attaquer » avaient
// fini par se contredire.

import {
  checkRange, rangeDistanceMeters, pointDistanceMeters,
  tokenHalfExtentMeters, fmtMeters
} from "../utils/grid.js";

// Une arme dont NI l'allonge NI la portée de jet ne sont renseignées reste
// utilisable au contact : c'est une fiche mal remplie, pas une arme inerte.
// 1 m est la valeur du gabarit d'arme (template.json).
const FALLBACK_REACH = 1;

const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/** @deprecated Utiliser tokenHalfExtentMeters (utils/grid.js). Réexport de compat. */
export const tokenFootprintMeters = tokenHalfExtentMeters;

/** Distance en MÈTRES entre deux points en pixels du canevas. */
export const metersBetweenPoints = pointDistanceMeters;

/** Distance BORD À BORD entre deux tokens, en mètres. */
export const tokenDistanceMeters = rangeDistanceMeters;

/**
 * Portée effective d'une arme, en mètres.
 *
 * Les deux champs ne veulent pas dire la même chose (voir l'en-tête), mais du
 * point de vue « puis-je frapper cette cible ? » l'un ou l'autre suffit : on
 * prend le maximum. Une épée dont `range.max` serait resté à 0 retombe ainsi
 * sur son allonge au lieu de devenir inutilisable.
 *
 * @returns {{min:number, max:number, allonge:number, jet:number}}
 */
export function weaponRangeMeters(weapon) {
  const sys = weapon?.system ?? {};
  const allonge = Math.max(0, num(sys.allonge, 0));
  const jet     = Math.max(0, num(sys.range?.max ?? sys.portee, 0));
  const max     = Math.max(allonge, jet);
  return {
    min: Math.max(0, num(sys.range?.min, 0)),
    max: max > 0 ? max : FALLBACK_REACH,
    allonge,
    jet
  };
}

/**
 * L'arme peut-elle atteindre cette cible depuis ce token ?
 *
 * @returns {{ok:boolean, dist:number|null, min:number, max:number,
 *            tooClose:boolean, reason:string|null}}
 *          `dist === null` (pas de token, pas de canevas) vaut « on ne sait
 *          pas » et laisse passer : mieux vaut une attaque à valider par le MJ
 *          qu'un bouton bloqué sans explication.
 */
export function checkWeaponRange(fromToken, toToken, weapon) {
  const { min, max, allonge, jet } = weaponRangeMeters(weapon);
  if (!fromToken || !toToken) {
    return { ok: true, dist: null, min, max, tooClose: false, reason: null };
  }

  const r = checkRange(fromToken, toToken, min, max);

  // Quand les deux champs de la fiche divergent, on nomme celui qui a servi :
  // c'est la seule façon pour le MJ de savoir lequel corriger.
  const source = (max === allonge && allonge !== jet) ? " (allonge)"
               : (max === jet && allonge !== jet) ? " (jet)" : "";

  return {
    ok: r.ok, dist: r.dist, min, max, tooClose: r.tooClose,
    reason: r.tooClose ? `Trop près (${fmtMeters(r.dist)}, portée mini ${fmtMeters(min)})`
          : !r.ok      ? `Hors portée (${fmtMeters(r.dist)}, portée max ${fmtMeters(max)}${source})`
          : null
  };
}

/**
 * Difficulté SUPPLÉMENTAIRE due à la distance, pour une arme de tir.
 *
 * Deux champs sur la fiche d'arme, tous deux sous `system.range` :
 *   - `efficace` : portée efficace, en mètres. En deçà, aucun malus. À 0 (le
 *                  défaut, et la valeur de toute arme écrite avant ce champ)
 *                  la règle est DÉSACTIVÉE — c'est ce qui garde le
 *                  comportement historique pour l'arsenal existant.
 *   - `tranche`  : chaque tranche entamée au-delà de la portée efficace ajoute
 *                  +1 de difficulté. 5 m par défaut.
 *
 * `efficace` à 0 ne peut pas vouloir dire « malus dès le premier mètre » : ce
 * serait imposer rétroactivement un malus à toutes les armes du monde, dont
 * aucune n'a jamais rempli ce champ. Une arme réellement inutilisable au-delà
 * du contact se décrit avec sa portée max, pas avec ce malus.
 *
 * La distance est celle du reste du système : BORD À BORD, en mètres
 * (utils/grid.js). Sans token ni canevas, on ne sait pas mesurer : on rend 0
 * plutôt que d'inventer un malus — même parti pris que checkWeaponRange, qui
 * laisse passer quand il ne peut pas mesurer.
 *
 * @param {Item}   weapon
 * @param {Token}  [fromToken]
 * @param {Token}  [toToken]
 * @param {number} [distOverride] distance déjà mesurée, en mètres
 * @returns {{diff:number, dist:number|null, efficace:number, tranche:number}}
 */
export function rangeDifficulty(weapon, fromToken, toToken, distOverride) {
  const rng      = weapon?.system?.range ?? {};
  const efficace = Math.max(0, num(rng.efficace, 0));
  const tranche  = Math.max(0.1, num(rng.tranche, 5));

  const none = { diff: 0, dist: null, efficace, tranche };
  if (efficace <= 0) return none;               // règle désactivée

  const dist = Number.isFinite(distOverride)
    ? Number(distOverride)
    : (fromToken && toToken ? rangeDistanceMeters(fromToken, toToken) : null);

  if (dist === null || !Number.isFinite(dist)) return none;

  const over = dist - efficace;
  // Pile sur la portée efficace = encore dans la zone sans malus. La marge
  // absorbe les arrondis du calcul de distance (0,999999 m).
  if (over <= 0.001) return { diff: 0, dist, efficace, tranche };

  return { diff: Math.ceil(over / tranche), dist, efficace, tranche };
}

/** Même test, à partir des acteurs : prend leur token actif sur la scène. */
export function checkWeaponRangeForActors(attacker, target, weapon) {
  const from = attacker?.getActiveTokens?.()?.[0] ?? null;
  const to   = target?.getActiveTokens?.()?.[0] ?? null;
  if (!from || !to) return { ok: true, dist: null, min: 0, max: 0, tooClose: false, reason: null };
  return checkWeaponRange(from, to, weapon);
}
