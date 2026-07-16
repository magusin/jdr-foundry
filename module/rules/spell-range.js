// module/rules/spell-range.js
//
// Affiche la portée d'un sort sur la carte Foundry en dessinant un gabarit
// circulaire temporaire (MeasuredTemplate) qui disparaît après quelques secondes.
// Le cercle est centré sur le token du lanceur.

const RANGE_TEMPLATE_FLAG = "rpg.rangePreview";
const TEMPLATE_DURATION_MS = 8000; // visible 8 secondes

// Map tokenId → templateId pour les prévisualisations actives
const _activeRangeTemplates = new Map();

/**
 * Affiche un cercle de portée autour d'un token.
 * @param {Token}  token     Token du lanceur
 * @param {number} rangeM    Portée en mètres
 * @param {string} spellName Nom du sort (pour le label)
 */
export async function showSpellRange(token, rangeM, spellName = "") {
  if (!canvas?.scene || !token || rangeM <= 0) return;

  // Supprime l'éventuel cercle précédent de ce token
  await clearSpellRange(token.id);

  const gs = canvas.scene.grid.size ?? 100;
  const unitDist = canvas.scene.grid.distance ?? 1; // mètres par case
  const radiusPx = (rangeM / unitDist) * gs;        // convertir en pixels

  // Centre sur le token (centre du token)
  const cx = token.document.x + (token.document.width  * gs) / 2;
  const cy = token.document.y + (token.document.height * gs) / 2;

  try {
    const templateData = {
      type: "circle",
      x: cx,
      y: cy,
      distance: rangeM,          // distance en unités de scène (mètres)
      angle: 360,
      direction: 0,
      fillColor: "#9b59b6",
      fillAlpha: 0.04,
      strokeColor: "#9b59b6",
      strokeAlpha: 0.6,
      strokeWidth: 2,
      flags: { [RANGE_TEMPLATE_FLAG]: { tokenId: token.id, spellName } }
    };

    const [template] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);

    if (template) {
      _activeRangeTemplates.set(token.id, template.id);
      // Auto-suppression après TEMPLATE_DURATION_MS
      setTimeout(async () => {
        await clearSpellRange(token.id);
      }, TEMPLATE_DURATION_MS);
    }
  } catch(e) {
    console.warn("[RPG] Impossible de créer le gabarit de portée :", e);
  }
}

/**
 * Supprime le cercle de portée actif pour un token.
 */
export async function clearSpellRange(tokenId) {
  const templateId = _activeRangeTemplates.get(tokenId);
  if (!templateId) return;
  _activeRangeTemplates.delete(tokenId);
  try {
    const template = canvas.scene?.templates?.get(templateId);
    if (template) await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [templateId]);
  } catch { /* déjà supprimé */ }
}

/**
 * Affiche la portée d'un sort depuis un item sort.
 * Appelé depuis le menu combat ou la macro sort.
 */
export async function showSpellRangeFromItem(token, spellItem) {
  if (!token || !spellItem) return;

  const sys = spellItem.system ?? {};
  // Portée max en mètres
  const rangeM = Number(sys.range?.max ?? sys.portee ?? 0) || 0;
  if (rangeM <= 0) return;

  await showSpellRange(token, rangeM, spellItem.name);
}

/**
 * Affiche toutes les portées des sorts d'un acteur en mode "overview"
 * (utile pour le MJ pour voir d'un coup d'œil les zones de contrôle).
 */
export async function showAllSpellRanges(actor, token) {
  if (!actor || !token) return;
  const spells = actor.items.filter(i => i.type === "spell" && i.system?.range?.max > 0);
  if (!spells.length) return;

  // Affiche le plus grand rayon (pour avoir une vue globale)
  const maxRange = Math.max(...spells.map(s => Number(s.system?.range?.max ?? 0) || 0));
  await showSpellRange(token, maxRange, "Portée max sorts");
}
