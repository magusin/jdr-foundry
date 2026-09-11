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
        // Ré-échantillonnage propre — voir l'en-tête de section plus bas.
        // Seulement quand on impose une taille : sans elle on ne sait pas à
        // quelle dimension viser, et la case de Foundry reste la sienne.
        if (size) upgradeThumb(img, size);
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
        restoreThumb(img);
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

/* ────────────────────────────────────────────────────────────────────────
 * Ré-échantillonnage : pourquoi on refait l'image nous-mêmes
 *
 * Chrome réduit une image en UNE passe : il décode le fichier à 701 px et
 * tire directement vers 96 px avec un filtre bilinéaire qui ne moyenne que
 * quelques pixels voisins. Sur un rapport de 7:1 et une texture fine
 * (écorce, fourrure, feuillage), ça ne donne pas un flou doux mais du
 * CRÉNELAGE — contours en escalier, grain qui saute. C'est ce qui a été
 * rapporté, et c'est ce qui explique qu'un fichier de 1402 px n'ait pas
 * meilleure mine qu'un de 701 : les deux subissent la même passe unique.
 *
 * La parade standard est de ne pas lui demander cette réduction : on
 * recadre, on descend par MOITIÉS successives (701 → 350 → 175 → 96) — ce
 * qui moyenne réellement tous les pixels, comme un mipmap — et on lui donne
 * le résultat déjà à la bonne taille.
 *
 * Trois choses tenues volontairement :
 *  - **Le fichier d'origine n'est jamais touché** ; on ne remplace que le
 *    `src` de la vignette, et l'original reste dans `dataset.rpgThumbSrc`
 *    pour pouvoir revenir en arrière et pour ne pas ré-échantillonner notre
 *    propre sortie au rendu suivant.
 *  - **Tout est en try/catch et asynchrone** : si quoi que ce soit échoue
 *    (canvas indisponible, image illisible), la vignette reste exactement
 *    celle d'aujourd'hui. On ne casse jamais une liste pour une question
 *    de netteté.
 *  - **Le résultat est mis en cache** par (source, taille, cadrage). Un
 *    répertoire se re-rend à chaque création ou renommage : sans cache on
 *    referait le travail des dizaines de fois par session.
 * ──────────────────────────────────────────────────────────────────────── */

/** Cache des vignettes calculées : clé → Promise<dataURL>. */
const thumbCache = new Map();

/**
 * Rectangle SOURCE d'un recadrage `object-fit: cover` vers un carré, avec
 * `object-position: 50% <posY>%`. On reproduit ici ce que le navigateur
 * ferait, puisque c'est nous qui découpons désormais.
 */
export function coverSourceRect(natW, natH, posYPct = 50) {
  const side = Math.min(natW, natH);
  const y = Math.max(0, Math.min(100, Number(posYPct) || 0));
  return {
    sx: Math.round((natW - side) / 2),
    sy: Math.round((natH - side) * (y / 100)),
    side
  };
}

/**
 * Suite des tailles intermédiaires, du côté source jusqu'à la cible, en
 * divisant par deux tant que c'est possible. `[]` quand la réduction est
 * déjà inférieure à 2:1 — le navigateur s'en sort très bien dans ce cas,
 * et une passe de plus ne ferait qu'adoucir pour rien.
 */
export function halvingSteps(from, to) {
  const steps = [];
  let cur = Math.max(1, Math.round(from));
  const target = Math.max(1, Math.round(to));
  while (Math.floor(cur / 2) > target) {
    cur = Math.floor(cur / 2);
    steps.push(cur);
  }
  return steps;
}

/** Y (%) du cadrage courant, lu sur le réglage. 50 = centre. */
function posYPercent() {
  const m = /(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(wantedPosition());
  return m ? Number(m[1]) : 50;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`image illisible : ${src}`));
    im.src = src;
  });
}

/** Calcule (et met en cache) la vignette ré-échantillonnée d'une source. */
function thumbFor(src, px, posY) {
  const key = `${src}|${px}|${posY}`;
  if (thumbCache.has(key)) return thumbCache.get(key);

  const job = (async () => {
    const im = await loadImage(src);
    const natW = im.naturalWidth || im.width;
    const natH = im.naturalHeight || im.height;
    if (!natW || !natH) throw new Error("dimensions inconnues");

    const { sx, sy, side } = coverSourceRect(natW, natH, posY);
    // Réduction inférieure à 2:1 : le navigateur fait déjà du bon travail,
    // on lui laisse la main plutôt que d'ajouter une passe pour rien.
    if (side / px < 2) return null;

    const make = (size) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return { c, ctx };
    };

    // 1) On isole le carré à garder, à sa taille d'origine.
    let { c: cur, ctx } = make(side);
    ctx.drawImage(im, sx, sy, side, side, 0, 0, side, side);

    // 2) Descente par moitiés, puis passe finale vers la taille exacte.
    for (const step of halvingSteps(side, px)) {
      const next = make(step);
      next.ctx.drawImage(cur, 0, 0, step, step);
      cur = next.c;
    }
    const final = make(px);
    final.ctx.drawImage(cur, 0, 0, px, px);

    const url = final.c.toDataURL("image/webp", 0.92);
    // Un navigateur qui ne sait pas encoder en WebP renvoie du PNG sans le
    // dire : on accepte les deux, mais pas une chaîne vide.
    return url && url.startsWith("data:image/") ? url : null;
  })().catch(err => {
    console.debug("[RPG] vignette non ré-échantillonnée :", src, err?.message ?? err);
    return null;
  });

  thumbCache.set(key, job);
  return job;
}

/**
 * Échange le `src` d'une vignette contre sa version ré-échantillonnée.
 *
 * La taille visée est celle RÉELLEMENT occupée à l'écran : la densité de
 * l'écran et une éventuelle mise à l'échelle de l'interface (Foundry pose un
 * `transform` sur `#ui-right`) multiplient les pixels physiques, et viser la
 * taille CSS produirait une vignette deux fois trop petite, donc réétirée.
 */
function upgradeThumb(img, cssSize) {
  const original = img.dataset.rpgThumbSrc || img.getAttribute("src") || "";
  if (!original || original.startsWith("data:")) return;
  // Le vectoriel se redimensionne parfaitement tout seul : rien à gagner, et
  // le rasteriser lui ferait perdre sa netteté (l'icône « mystery-man » des
  // PJ est dans ce cas).
  if (/\.svg(\?|$)/i.test(original)) return;

  img.dataset.rpgThumbSrc = original;

  const rect = img.getBoundingClientRect?.();
  const scale = (rect?.width && img.clientWidth) ? rect.width / img.clientWidth : 1;
  const dpr = Number(window.devicePixelRatio) || 1;
  const px = Math.round(Math.max(24, Math.min(512, cssSize * Math.min(4, Math.max(1, scale * dpr)))));

  thumbFor(original, px, posYPercent()).then(url => {
    // L'image a pu être retirée du DOM ou le réglage changer entre-temps :
    // on ne réécrit que si elle désigne toujours la même source.
    if (url && img.isConnected && img.dataset.rpgThumbSrc === original) img.src = url;
  });
}

/** Rend à une vignette son fichier d'origine (retour à « Taille de Foundry »). */
function restoreThumb(img) {
  const original = img.dataset.rpgThumbSrc;
  if (!original) return;
  if (img.getAttribute("src") !== original) img.src = original;
  delete img.dataset.rpgThumbSrc;
}
