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

/**
 * Nom français d'un type d'objet, pour affichage.
 *
 * `item.type` est une CLÉ technique anglaise (`loot`, `weapon`, `consumable`…) :
 * l'écrire telle quelle dans une fiche affiche « loot » à un joueur
 * francophone. Les traductions vivent déjà dans `lang/fr.json`
 * (`TYPES.Item.loot` → « Objet »), c'est la seule source à consulter — jamais
 * une table de correspondance recopiée dans une fiche, qui se désynchroniserait
 * du jour où un type est ajouté.
 */
export function itemTypeLabel(type) {
  const key = String(type ?? "").trim();
  if (!key) return "";
  const label = game.i18n?.localize?.(`TYPES.Item.${key}`);
  // localize() renvoie la clé elle-même quand la traduction manque : dans ce
  // cas on préfère encore la clé nue à « TYPES.Item.xxx ».
  return !label || label === `TYPES.Item.${key}` ? key : label;
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
 * Ouvre une image en grand, en lecture seule. DialogV2 est thématisée
 * automatiquement par le hook renderDialogV2 global (voir init.js) — pas
 * besoin d'appeler applyUiTheme() ici.
 */
export function openImageLightbox(src, title) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2 || !src) return;
  DialogV2.wait({
    window: { title: title || "Illustration" },
    content: `<img src="${src}" alt="" style="display:block;width:100%;max-width:min(80vw,900px);max-height:80vh;object-fit:contain;border-radius:8px;" />`,
    buttons: [{ action: "close", label: "Fermer", default: true }],
    rejectClose: false
  }).catch(() => {});
}

/**
 * Branche le FilePicker V13 sur toutes les images .rpg-img-edit de la fiche
 * (réservé aux MJ). Pour les joueurs, clic = aperçu en grand en lecture
 * seule, plutôt qu'aucune interaction du tout.
 */
export function bindImageEditors(root, document) {
  if (!game.user.isGM) {
    root.querySelectorAll(".rpg-img-edit").forEach(img => {
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => openImageLightbox(img.src, document?.name));
    });
    return;
  }
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

/* ── Taille du token ──────────────────────────────────────────────────────
 *
 * La taille se règle sur l'ACTEUR (son « prototype token »), pas sur chaque
 * token déposé : Foundry copie le prototype à chaque création de token, donc
 * un dragon réglé une fois à 3×3 arrive déjà à la bonne taille sur toutes les
 * scènes, sans redimensionnement manuel. C'est aussi ce que lit
 * `tokenHalfExtentMeters()` (utils/grid.js) pour mesurer les portées de bord
 * à bord — une taille juste n'est donc pas qu'un confort visuel, elle change
 * l'allonge réelle : un token plus large atteint plus loin depuis son centre,
 * et se fait atteindre de plus loin.
 *
 * ⚠️ Ne touche QUE les futurs tokens. Les tokens déjà posés sur une scène sont
 * des copies indépendantes du prototype (comportement Foundry, pas une
 * particularité de ce système) — cf. `applyTokenSizeToPlaced()`.
 */
export const TOKEN_SIZE_PRESETS = [
  { value: 0.5, label: "Minuscule — 0,5 × 0,5" },
  { value: 1,   label: "Normale — 1 × 1" },
  { value: 2,   label: "Grande — 2 × 2" },
  { value: 3,   label: "Énorme — 3 × 3" },
  { value: 4,   label: "Colossale — 4 × 4" }
];

/** Contexte d'affichage du sélecteur de taille pour un acteur. */
export function tokenSizeContext(actor) {
  const pt = actor?.prototypeToken ?? {};
  const width  = Number(pt.width  ?? 1) || 1;
  const height = Number(pt.height ?? 1) || 1;
  const preset = TOKEN_SIZE_PRESETS.find(p => p.value === width && p.value === height) ?? null;
  const gd = Number(canvas?.scene?.grid?.distance ?? 1) || 1;
  const fmt = (n) => String(n).replace(".", ",");
  return {
    width, height,
    isCustom: !preset,
    presets: TOKEN_SIZE_PRESETS.map(p => ({ ...p, selected: p === preset })),
    // Encombrement réel, utile parce que c'est lui qui décide de l'allonge.
    meters: `${fmt(Math.round(width * gd * 100) / 100)} × ${fmt(Math.round(height * gd * 100) / 100)} m`
  };
}

/**
 * Branche le sélecteur de taille de token d'une fiche d'acteur.
 *
 * Le préréglage écrit largeur ET hauteur d'un coup (le cas courant : une
 * créature est carrée). « Personnalisé » révèle les deux champs pour les
 * formes non carrées (serpent, chariot).
 *
 * Les deux champs sont branchés ici plutôt que nommés `prototypeToken.width`
 * dans le formulaire : la fiche de personnage soumet TOUT le formulaire à
 * chaque changement (`submitOnChange`), donc un champ nommé encore masqué
 * réécrirait sa valeur d'avant au prochain changement d'un autre champ, en
 * écrasant le préréglage qui vient d'être choisi.
 */
export function bindTokenSize(root, document) {
  const box = root?.querySelector?.(".rpg-token-size");
  if (!box || box.dataset.rpgBound) return;
  box.dataset.rpgBound = "1";

  const sel    = box.querySelector(".rpg-token-size-preset");
  const custom = box.querySelector(".rpg-token-size-custom");
  if (!sel) return;

  // Un joueur ne redimensionne pas son propre token : c'est un réglage de
  // scène qui change l'allonge et l'encombrement sur la carte.
  if (!game.user.isGM) {
    box.querySelectorAll("select, input, button").forEach(el => { el.disabled = true; });
    return;
  }

  sel.addEventListener("change", async (ev) => {
    ev.stopPropagation();
    const v = sel.value;
    if (v === "custom") {
      if (custom) custom.style.display = "";
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    if (custom) custom.style.display = "none";
    await document.update({ "prototypeToken.width": n, "prototypeToken.height": n });
  });

  for (const dim of ["width", "height"]) {
    const input = box.querySelector(`.rpg-token-size-dim[data-dim="${dim}"]`);
    if (!input) continue;
    input.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const n = Number(input.value);
      if (!Number.isFinite(n) || n <= 0) return;
      await document.update({ [`prototypeToken.${dim}`]: n });
    });
  }
}

/**
 * Recopie la taille du prototype sur les tokens DÉJÀ posés de cet acteur,
 * toutes scènes confondues. Foundry ne le fait jamais tout seul : un token
 * placé est une copie indépendante, figée à la taille qu'avait le prototype
 * au moment du dépôt.
 *
 * @returns {Promise<number>} nombre de tokens effectivement redimensionnés
 */
export async function applyTokenSizeToPlaced(actor) {
  if (!game.user.isGM || !actor) return 0;
  const w = Number(actor.prototypeToken?.width  ?? 1) || 1;
  const h = Number(actor.prototypeToken?.height ?? 1) || 1;

  let total = 0;
  for (const scene of game.scenes ?? []) {
    const updates = [];
    for (const td of scene.tokens ?? []) {
      // `actorId` couvre aussi les tokens non liés : ils partagent l'acteur
      // source même quand leurs données sont désynchronisées par ailleurs.
      if (td.actorId !== actor.id) continue;
      if (Number(td.width) === w && Number(td.height) === h) continue;
      updates.push({ _id: td.id, width: w, height: h });
    }
    if (updates.length) {
      await scene.updateEmbeddedDocuments("Token", updates);
      total += updates.length;
    }
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Un id de fenêtre unique par document                                       */
/* -------------------------------------------------------------------------- */

/**
 * Rend unique, PAR DOCUMENT, l'id de fenêtre d'une fiche.
 *
 * ApplicationV2 fige son id À LA CONSTRUCTION, dans un champ privé, à partir
 * de `options.id` — et c'est CE champ qui sert d'attribut id à l'élément de
 * fenêtre et de clé dans foundry.applications.instances. Surcharger le getter
 * `get id()` de la classe ne change donc rien à l'élément inséré : c'est
 * l'erreur de la première tentative de correctif. Il faut corriger l'OPTION,
 * avant que le constructeur ne la lise.
 *
 * Avec l'id statique de DEFAULT_OPTIONS (partagé par tous les objets du même
 * type), `_insertElement()` remplaçait dans le DOM la fenêtre déjà ouverte qui
 * portait ce même id. L'instance de la première fiche restait en cache
 * (`document.sheet`) en se croyant affichée : la rouvrir ne faisait plus que
 * redessiner un élément détaché du document — rien à l'écran, rien en console.
 *
 * @param {object} appOptions  options déjà fusionnées (retour de super)
 * @param {object} rawOptions  options brutes reçues par le constructeur
 * @param {string} baseId      préfixe lisible, propre à la classe de fiche
 */
export function uniqueSheetOptions(appOptions, rawOptions, baseId) {
  const opts = appOptions ?? {};
  const doc = rawOptions?.document ?? opts.document ?? null;
  // L'UUID et non l'id : deux tokens non liés du même monstre partagent l'id
  // de leur acteur, et la copie d'un objet sur un token partage l'id de
  // l'objet du prototype. Les points ne sont pas valides dans un id HTML.
  const key = String(doc?.uuid ?? doc?.id ?? "").replace(/\./g, "-")
           || (foundry.utils?.randomID?.() ?? String(Date.now()));
  opts.uniqueId = key;
  opts.id = `${baseId}-${key}`;
  return opts;
}

/* -------------------------------------------------------------------------- */
/* Conservation du défilement entre deux rendus                               */
/* -------------------------------------------------------------------------- */

/**
 * Conteneurs susceptibles de défiler dans une fiche. On les liste plutôt que
 * de deviner : selon la fiche et le thème, c'est tantôt `.window-content`
 * (Foundry lui pose `overflow: hidden auto` par défaut, avec une spécificité
 * que nos propres règles ne battent pas), tantôt le `.sheet-body` interne.
 * Aucun risque à surveiller les deux : seuls les éléments ayant RÉELLEMENT
 * défilé (donc émis un événement `scroll`) sont mémorisés.
 *
 * `.quest-page-content` est volontairement absent : la fiche de quête gère
 * elle-même son défilement, parce qu'elle doit justement NE PAS le restaurer
 * quand une action change de page (« + Étape » saute sur la nouvelle étape).
 */
const SCROLL_SELECTORS = [".window-content", ".sheet-body"];

/**
 * Mémoire de défilement, indexée par l'élément de fenêtre (`app.element`).
 *
 * Volontairement attachée au DOM et non à l'instance d'Application : Foundry
 * garde l'instance en vie après une fermeture (`document.sheet` est mis en
 * cache) mais détruit puis recrée son élément. Une fiche rouverte repart donc
 * naturellement du haut, alors qu'un simple re-rendu — qui conserve la
 * fenêtre — retrouve sa position.
 */
const SCROLL_MEMORY = new WeakMap();

/**
 * Empêche une fiche de « remonter tout en haut » à chaque re-rendu.
 *
 * Presque toute action sur une fiche (équiper un objet, cocher une case,
 * saisir un champ en auto-save…) déclenche un rendu complet : le contenu est
 * remplacé, le navigateur écrête la position de défilement à 0 et le joueur se
 * retrouve en haut de la fenêtre alors qu'il travaillait au milieu de son
 * inventaire (rapporté sur l'onglet Équipement, mais valable partout).
 *
 * À appeler dans le `_onRender()` de CHAQUE fiche, juste après
 * `super._onRender()` : la position mémorisée est réappliquée, puis on branche
 * (une seule fois par élément) l'écouteur qui la tient à jour.
 *
 * @param {HTMLElement} root  L'élément de la fiche (`this.element`).
 */
export function restoreScrollPositions(root) {
  if (!root?.querySelector) return;

  let mem = SCROLL_MEMORY.get(root);
  if (!mem) SCROLL_MEMORY.set(root, mem = { tops: new Map(), restoring: new Set() });

  for (const selector of SCROLL_SELECTORS) {
    const el = root.querySelector(selector);
    if (!el) continue;

    const saved = mem.tops.get(selector) ?? 0;
    if (saved > 0) {
      // ⚠️ Écrire scrollTop émet un événement `scroll` — sans cette garde,
      // l'écouteur ci-dessous mémoriserait la valeur ÉCRÊTÉE par le navigateur
      // (le contenu tout juste remplacé est momentanément trop court pour
      // porter l'ancienne position) et écraserait la position à restaurer
      // avant même la seconde passe.
      mem.restoring.add(selector);
      el.scrollTop = saved;
      // Le contenu n'a pas toujours sa hauteur définitive au moment du rendu
      // (images, polices, textarea redimensionnées après coup) : seconde passe
      // à la frame suivante, une fois la mise en page stabilisée.
      requestAnimationFrame(() => {
        el.scrollTop = saved;
        requestAnimationFrame(() => mem.restoring.delete(selector));
      });
    }

    // `.window-content` survit aux rendus (c'est le cadre de la fenêtre) —
    // sans ce garde-fou on empilerait un écouteur par rendu.
    if (el.dataset.rpgScrollBound) continue;
    el.dataset.rpgScrollBound = "1";
    el.addEventListener("scroll", () => {
      if (mem.restoring.has(selector)) return;
      // Un retour à 0 sur un conteneur qui n'a PLUS rien à faire défiler n'est
      // pas un geste du joueur : c'est le navigateur qui écrête la position
      // parce que le contenu vient d'être remplacé (donc momentanément trop
      // court). Le mémoriser effacerait justement la position à restaurer.
      if (el.scrollTop === 0 && (el.scrollHeight - el.clientHeight) <= 0) return;
      mem.tops.set(selector, el.scrollTop);
    }, { passive: true });
  }
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
 * true si le joueur a choisi le thème "natif" (échappatoire de diagnostic —
 * voir le choix "natif" sur le réglage rpg.uiTheme dans init.js). N'affecte
 * QUE les fenêtres natives qu'on habille EN PLUS (journaux, tables
 * aléatoires, macros, répertoires détachés, nos propres compendiums) via
 * themeWindow()/applyGlobalTheme() — jamais nos propres fiches .rpg-sheet
 * (applyUiTheme), qui dépendent structurellement des variables posées par
 * un thème pour s'afficher correctement, pas juste pour leur couleur.
 */
export function isNativeThemingDisabled() {
  return String(game.settings?.get?.("rpg", "uiTheme") ?? "sombre") === "natif";
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
  if (isNativeThemingDisabled()) return;
  body.classList.add(`rpg-theme-${currentUiTheme()}`);
}

/**
 * Marque une fenêtre comme étant la nôtre et lui applique le thème.
 * Utilisé pour les dialogues de macro (Dialog/DialogV2) qui ne passent pas
 * par applyUiTheme.
 */
export function themeWindow(root) {
  if (!root?.classList) return;
  if (isNativeThemingDisabled()) {
    // Retire ce qu'un rendu précédent (thème changé en direct) aurait pu
    // poser, pour repasser 100% natif sans recharger.
    root.classList.remove("rpg-window", ...THEME_CLASSES);
    return;
  }
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
