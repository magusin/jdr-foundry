// module/sheets/sheet-helpers.js
//
// Utilitaires partagés par toutes les fiches (acteurs et objets).

/**
 * Contenu de la fiche, à l'EXCLUSION de la barre de titre de la fenêtre.
 *
 * `this.element` d'une ApplicationV2 englobe l'en-tête de fenêtre, dont les
 * boutons Fermer / Épingler sont eux aussi des `button[data-action]`. Verrouiller
 * la fiche depuis la racine les neutralisait : les joueurs ne pouvaient plus
 * fermer leur fiche avec la croix. On ne touche donc jamais qu'au contenu.
 */
export function sheetContent(root) {
  return root?.querySelector?.(".window-content") ?? root;
}

/** Boutons d'action de la fiche, jamais ceux de la barre de titre. */
export function sheetActionButtons(root, extraSelector = "") {
  const scope = sheetContent(root);
  if (!scope) return [];
  return Array.from(scope.querySelectorAll(`button[data-action]${extraSelector}`))
    .filter(el => !el.closest(".window-header") && !el.classList.contains("header-control"));
}

/**
 * Applique la vue MJ ou joueur sur un élément racine de fiche.
 * - MJ : peut tout voir et tout éditer
 * - Joueur : voit les valeurs remplies, ne peut rien modifier
 */
export function applySheetViewMode(root, { isGM = false } = {}) {
  if (!root) return;

  if (!isGM) {
    root.classList.add("joueur-view");
    const scope = sheetContent(root);
    scope.querySelectorAll("select[readonly]").forEach(el => {
      el.disabled = true;
      el.style.cssText = "background:transparent;border-color:transparent;pointer-events:none;color:inherit";
    });
    sheetActionButtons(root).forEach(el => { el.style.display = "none"; });
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
const THEME_CLASSES = ["rpg-theme-sombre", "rpg-theme-clair", "rpg-theme-contraste"];

/** Thème actuellement choisi par ce joueur. */
export function currentUiTheme() {
  const t = String(game.settings?.get?.("rpg", "uiTheme") ?? "sombre");
  return THEME_CLASSES.includes(`rpg-theme-${t}`) ? t : "sombre";
}

/**
 * Pose le thème sur <body>, ce qui rend les variables disponibles pour TOUTES
 * les fenêtres — y compris les boîtes de dialogue créées à la volée par les
 * macros, qui n'ont aucune classe à nous.
 */
export function applyGlobalTheme() {
  const body = document?.body;
  if (!body) return;
  body.classList.remove(...THEME_CLASSES);
  body.classList.add(`rpg-theme-${currentUiTheme()}`);
}

/**
 * Marque une fenêtre comme étant la nôtre et lui applique le thème.
 * Utilisé pour les dialogues de macro (Dialog/DialogV2) qui ne passent pas
 * par applyUiTheme.
 */
export function themeWindow(root) {
  if (!root?.classList) return;
  root.classList.add("rpg-window");
  root.classList.remove(...THEME_CLASSES);
  root.classList.add(`rpg-theme-${currentUiTheme()}`);
}

export function applyUiTheme(root) {
  if (!root) return;
  const theme = currentUiTheme();
  const themeClasses = THEME_CLASSES;

  // ⚠️ Il existe DEUX éléments porteurs de « .rpg-sheet » :
  //   1. la fenêtre externe (via DEFAULT_OPTIONS.classes) — c'est `root`
  //   2. le <div>/<form> interne du template, dans .window-content
  // Les variables de thème (.rpg-sheet.rpg-theme-clair) doivent être posées sur
  // les DEUX. Sinon le div interne re-matche le bloc de base « .rpg-sheet » et
  // redéfinit --ink/--ink-text en sombre, écrasant l'héritage clair de la fenêtre
  // → seul le cadre change de couleur, jamais le contenu.
  const targets = new Set();
  if (root.classList) targets.add(root);
  root.querySelectorAll?.(".rpg-sheet, .rpg-spell-menu").forEach(el => targets.add(el));

  for (const el of targets) {
    el.classList.remove(...themeClasses);
    el.classList.add(`rpg-theme-${theme}`);
  }
}
