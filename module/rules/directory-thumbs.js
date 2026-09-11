// module/rules/directory-thumbs.js
//
// Taille des vignettes dans les répertoires de la barre latérale (Acteurs,
// Objets…), et pourquoi ce module existe.
//
// Foundry ne génère de vraie miniature que pour les SCÈNES (`scene.thumb`).
// Pour un Acteur ou un Objet, la ligne du répertoire affiche le fichier
// d'origine dans un `<img>` d'environ 48 px, recadré au centre : une
// illustration de 700 px y est réduite d'un facteur ~14 en une seule passe, et
// la case finale ne contient que ~2 000 pixels. Le résultat est une bouillie —
// rapporté tel quel, avec des images pourtant propres (701 × 561, WebP 95 Ko).
//
// Il n'existe aucun filtre magique pour récupérer du détail qui n'a plus de
// place : le seul levier réel est d'agrandir la case. À 80 px elle porte 2,7
// fois plus de pixels, et une créature en pied redevient reconnaissable.
//
// Deux choix volontaires :
//
//  - **Par défaut, on ne touche à rien** (`0` = taille native de Foundry). La
//    barre latérale ancrée est explicitement hors du périmètre du thème de ce
//    système (voir `themeIfOurs` dans init.js) ; la redimensionner est un
//    geste distinct, opt-in, que l'utilisateur demande lui-même.
//  - **On écrit des styles en ligne sur les `img` trouvées**, plutôt qu'une
//    règle CSS visant des classes de Foundry. Les noms de classe du répertoire
//    ont déjà changé entre versions ; une feuille de style qui ne matche plus
//    ne fait rien, sans le dire. Une passe DOM qui ne trouve aucune image ne
//    fait rien non plus, mais elle peut au moins se compter (console.debug).

const SETTING = "vignetteTaille";
const SETTING_POS = "vignetteCadrage";

/** Taille demandée, en pixels. 0 = ne rien changer. */
function wantedSize() {
  try {
    const v = Number(game.settings.get("rpg", SETTING));
    return Number.isFinite(v) && v > 0 ? Math.min(160, Math.max(24, v)) : 0;
  } catch { return 0; }
}

/**
 * Point de l'image gardé par le recadrage carré. "" = celui de Foundry (le
 * centre).
 *
 * C'est le réglage qui évite de produire une seconde image : une illustration
 * de créature en pied a sa tête dans le tiers HAUT, et le recadrage centré la
 * coupe pour ne garder que le flanc — d'où des vignettes qui se ressemblent
 * toutes. Déplacer le point de fuite ne coûte rien et ne touche à aucun
 * fichier.
 */
function wantedPosition() {
  try {
    const v = String(game.settings.get("rpg", SETTING_POS) ?? "").trim();
    return /^[\w%\s.]{0,20}$/.test(v) ? v : "";
  } catch { return ""; }
}

/**
 * Applique (ou retire) la taille sur les vignettes d'un élément de répertoire.
 *
 * Les lignes sont reconnues par leur attribut de document — `data-entry-id`
 * (V13/V14) ou `data-document-id` — et non par une classe : c'est le même
 * repère que `codex.js` utilise déjà pour filtrer les compendiums, et il a
 * survécu aux deux versions.
 */
function applyTo(root) {
  if (!root?.querySelectorAll) return 0;
  const size = wantedSize();
  const pos = wantedPosition();
  const rows = root.querySelectorAll("[data-entry-id], [data-document-id], .directory-item");
  // Un dossier EST une ligne de répertoire et contient les lignes qu'il porte :
  // sans ce Set, chaque image imbriquée serait visitée une fois par ancêtre et
  // le compte annoncé mentirait (5 pour 3 images, constaté en test).
  const seen = new Set();
  let n = 0;
  for (const row of rows) {
    for (const img of row.querySelectorAll("img")) {
      if (seen.has(img)) continue;
      seen.add(img);
      if (size || pos) {
        if (size) {
          img.style.width = `${size}px`;
          img.style.height = `${size}px`;
          img.style.flex = `0 0 ${size}px`;
          // `cover` est déjà ce que fait Foundry ; on le réaffirme parce qu'on
          // impose une case carrée et qu'une image 4:3 étirée serait pire que
          // recadrée.
          img.style.objectFit = "cover";
        }
        // Le cadrage vaut même à la taille native : c'est un choix de ce qu'on
        // montre, pas de la place qu'on prend.
        if (pos) {
          img.style.objectFit = "cover";
          img.style.objectPosition = pos;
        } else {
          // Repasser de « Haut » à « Centre » doit VRAIMENT revenir au centre :
          // sans cette ligne, la valeur précédente restait écrite sur l'image
          // et le réglage n'avait plus de retour en arrière (constaté en test).
          img.style.removeProperty("object-position");
        }
      } else {
        // Retour à la taille native : on efface CE qu'on a écrit, jamais plus.
        // Les trois longhands de `flex` sont retirés un par un — effacer le
        // raccourci laisse `flex-grow/shrink/basis` en place (vérifié), et la
        // vignette resterait figée à son ancienne largeur de base.
        for (const prop of ["width", "height", "flex", "flex-grow", "flex-shrink",
                            "flex-basis", "object-fit", "object-position"]) {
          img.style.removeProperty(prop);
        }
      }
      n++;
    }
  }
  return n;
}

/** Repasse sur tous les répertoires déjà ouverts (changement de réglage). */
export function refreshDirectoryThumbs() {
  let n = 0;
  n += applyTo(document.getElementById("sidebar"));
  // Les répertoires détachés de la barre sont des fenêtres à part entière :
  // sans elles, le réglage ne vaudrait que pour la barre ancrée.
  for (const el of document.querySelectorAll(".application.directory, .app.directory")) n += applyTo(el);
  console.debug(`[RPG] vignettes de répertoire : ${n} image(s) ajustée(s)`);
  return n;
}

/**
 * Pose les hooks. Appelé depuis `ready` — un répertoire se re-rend à chaque
 * création, renommage ou déplacement d'un document, donc il faut repasser à
 * chaque rendu et pas seulement au chargement.
 */
export function installDirectoryThumbs() {
  const onRender = (_app, html) => {
    if (!wantedSize() && !wantedPosition()) return;
    // `html` est un HTMLElement en V13+, un jQuery dans les versions plus
    // anciennes : on accepte les deux plutôt que de parier.
    const root = html?.[0] ?? html ?? null;
    applyTo(root instanceof HTMLElement ? root : document.getElementById("sidebar"));
  };

  // Les deux familles de hooks : le nom a changé au fil des versions, et en
  // poser un de trop ne coûte rien (la passe est idempotente).
  Hooks.on("renderSidebarTab", onRender);
  Hooks.on("renderDocumentDirectory", onRender);
  Hooks.on("renderApplicationV2", onRender);

  refreshDirectoryThumbs();
}
