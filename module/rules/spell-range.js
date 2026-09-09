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
  await drawSpellCircle(token, rangeM, { spellName });
}

/**
 * Trace UN cercle et le mémorise pour ce token.
 *
 * Extrait de showSpellRange parce qu'un sort de zone en demande DEUX (la
 * portée de visée et le rayon couvert), et que l'ancienne version effaçait le
 * précédent à chaque appel : le second cercle mangeait le premier. C'est aussi
 * pour ça que `_activeRangeTemplates` retient désormais une LISTE d'ids par
 * token plutôt qu'un seul.
 *
 * @param {Token}  token     Token de référence (centre par défaut)
 * @param {number} radiusM   Rayon, en mètres
 * @param {object} opts
 * @param {{x:number,y:number}} [opts.center]  Centre explicite, en pixels
 * @param {string} [opts.color]                Couleur de remplissage/bordure
 * @param {string} [opts.spellName]            Étiquette, pour le flag
 */
export async function drawSpellCircle(token, radiusM, { center = null, color = "#9b59b6", spellName = "" } = {}) {
  if (!canvas?.scene || !token || !(radiusM > 0)) return null;

  const gs = canvas.scene.grid.size ?? 100;

  // Centre sur le token (centre du token) sauf centre explicite
  const cx = center?.x ?? (token.document.x + (token.document.width  * gs) / 2);
  const cy = center?.y ?? (token.document.y + (token.document.height * gs) / 2);

  try {
    const templateData = {
      // `t` est le champ réel du document depuis la V12 ; `type` est conservé
      // pour ne rien casser des mondes qui tournaient déjà avec.
      t: "circle",
      type: "circle",
      x: cx,
      y: cy,
      distance: radiusM,         // distance en unités de scène (mètres)
      angle: 360,
      direction: 0,
      borderColor: color,
      fillColor: color,
      fillAlpha: 0.04,
      strokeColor: color,
      strokeAlpha: 0.6,
      strokeWidth: 2,
      flags: { [RANGE_TEMPLATE_FLAG]: { tokenId: token.id, spellName } }
    };

    const [template] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);

    if (template) {
      const ids = _activeRangeTemplates.get(token.id) ?? [];
      ids.push(template.id);
      _activeRangeTemplates.set(token.id, ids);
      // Auto-suppression après TEMPLATE_DURATION_MS
      setTimeout(async () => {
        await clearSpellRange(token.id);
      }, TEMPLATE_DURATION_MS);
    }
    return template ?? null;
  } catch(e) {
    console.warn("[RPG] Impossible de créer le gabarit de portée :", e);
    return null;
  }
}

/**
 * Supprime le cercle de portée actif pour un token.
 */
export async function clearSpellRange(tokenId) {
  const ids = _activeRangeTemplates.get(tokenId);
  if (!ids || !ids.length) return;
  _activeRangeTemplates.delete(tokenId);
  try {
    const alive = ids.filter(id => canvas.scene?.templates?.get(id));
    if (alive.length) await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", alive);
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
  const zoneM  = Math.max(0, Number(sys.zoneRadius ?? 0) || 0);
  if (rangeM <= 0 && zoneM <= 0) return;

  await clearSpellRange(token.id);
  if (rangeM > 0) await drawSpellCircle(token, rangeM, { spellName: spellItem.name });

  // Le rayon de zone est un SECOND cercle, et il n'est pas centré au même
  // endroit : la portée part du lanceur, la zone se pose sur ce qu'il vise.
  // Centré sur la première cible désignée quand il y en a une, sinon sur le
  // lanceur — où il ne vaut alors que comme étalon de taille. Sans ça, un
  // sort « rayon 5 m, portée 30 m » n'affichait QUE le cercle de 30 m, soit
  // exactement le rayon que le joueur ne doit pas croire toucher.
  if (zoneM > 0) {
    const tgt = Array.from(game.user?.targets ?? [])[0] ?? null;
    const center = tgt ? { x: tgt.center.x, y: tgt.center.y } : null;
    await drawSpellCircle(token, zoneM, {
      center, color: "#e67e22", spellName: `${spellItem.name} — zone`
    });
  }
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
