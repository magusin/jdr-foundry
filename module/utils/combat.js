/**
 * Calcule les dégâts finaux appliqués à une cible, en respectant :
 * - réduction fixe d'abord
 * - réduction % ensuite
 * - arrondi au supérieur
 * - minimum 1 si l'attaque touche
 *
 * @param {object} params
 * @param {"physique"|"magique"} params.type
 * @param {number} params.dmgBrut
 * @param {Actor} params.targetActor
 * @param {boolean} [params.minOneOnHit=true]
 * @returns {number} dégâts finaux (entier)
 */
export function computeFinalDamage({ type, dmgBrut, targetActor, minOneOnHit = true }) {
    const dmg = Number(dmgBrut) || 0;
    const sys = targetActor?.system ?? {};
    const def = sys.defenses ?? {};
    const red = sys.derived?.reductions ?? {};
  
    const fixe =
      type === "magique"
        ? (Number(def.resistanceFixe) || 0)
        : (Number(def.armureFixe) || 0);
  
    const pct =
      type === "magique"
        ? (Number(red.magiquePct) || 0)
        : (Number(red.physiquePct) || 0);
  
    // Étape 1 : fixe
    const afterFixe = Math.max(0, dmg - fixe);
  
    // Étape 2 : %
    const mult = 1 - (Math.max(0, Math.min(100, pct)) / 100);
    const afterPct = afterFixe * mult;
  
    // Arrondi supérieur
    const rounded = Math.ceil(afterPct);
  
    // Minimum 1 (si touche)
    if (minOneOnHit) return Math.max(1, rounded);
    return Math.max(0, rounded);
  }
  