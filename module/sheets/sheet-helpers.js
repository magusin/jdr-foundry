// module/sheets/sheet-helpers.js
//
// Utilitaires partagés par toutes les fiches (acteurs et objets).

/**
 * Applique la vue MJ ou joueur sur un élément racine de fiche.
 * - MJ : peut tout voir et tout éditer
 * - Joueur : voit les valeurs remplies, ne peut rien modifier
 */
export function applySheetViewMode(root, { isGM = false } = {}) {
  if (!root) return;

  if (!isGM) {
    root.classList.add("joueur-view");
    root.querySelectorAll("select[readonly]").forEach(el => {
      el.disabled = true;
      el.style.cssText = "background:transparent;border-color:transparent;pointer-events:none;color:inherit";
    });
    root.querySelectorAll("button[data-action]").forEach(el => el.style.display = "none");
  }
}

/**
 * Branche le FilePicker V13 sur toutes les images .rpg-img-edit de la fiche.
 * Réservé aux MJ.
 */
export function bindImageEditors(root, document) {
  if (!game.user.isGM) return;
  root.querySelectorAll(".rpg-img-edit").forEach(img => {
    img.style.cursor = "pointer";
    img.addEventListener("click", async () => {
      const field = img.dataset.field;
      if (!field) return;
      const current = foundry.utils.getProperty(document, field) ?? "";
      const fp = new foundry.applications.apps.FilePicker({
        type: "image", current,
        callback: async (path) => document.update({ [field]: path })
      });
      fp.render(true);
    });
  });
}

/**
 * Applique la classe de thème visuel choisie par le joueur (réglage client)
 * sur l'élément racine de la fiche. À appeler dans chaque _onRender().
 */
export function applyUiTheme(root) {
  if (!root) return;
  const theme = game.settings?.get?.("rpg", "uiTheme") ?? "sombre";
  root.classList.remove("rpg-theme-sombre", "rpg-theme-clair", "rpg-theme-contraste");
  root.classList.add(`rpg-theme-${theme}`);
}
