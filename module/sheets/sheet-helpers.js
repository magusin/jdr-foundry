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
  const themeClasses = ["rpg-theme-sombre", "rpg-theme-clair", "rpg-theme-contraste"];

  // ⚠️ Il existe DEUX éléments porteurs de « .rpg-sheet » :
  //   1. la fenêtre externe (via DEFAULT_OPTIONS.classes) — c'est `root`
  //   2. le <div>/<form> interne du template, dans .window-content
  // Les variables de thème (.rpg-sheet.rpg-theme-clair) doivent être posées sur
  // les DEUX. Sinon le div interne re-matche le bloc de base « .rpg-sheet » et
  // redéfinit --ink/--ink-text en sombre, écrasant l'héritage clair de la fenêtre
  // → seul le cadre change de couleur, jamais le contenu.
  const targets = new Set();
  if (root.classList) targets.add(root);
  root.querySelectorAll?.(".rpg-sheet").forEach(el => targets.add(el));

  for (const el of targets) {
    el.classList.remove(...themeClasses);
    el.classList.add(`rpg-theme-${theme}`);
  }
}
