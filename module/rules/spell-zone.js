// module/rules/spell-zone.js
//
// Viser un POINT, et laisser le sort trouver ses cibles.
//
// Jusqu'ici, lancer une zone demandait au joueur de désigner chaque token à la
// main (outil Ciblage ✛, Maj+clic) ou de dessiner un gabarit puis de lancer la
// macro « Cibler la Zone ». Deux gestes pour ce qui, à la table, en est un
// seul : « je la pose là ». Et rien ne garantissait que ce qu'il cochait
// correspondait au rayon annoncé — c'est `zoneRadius` (rules/spells.js) qui a
// rendu ce contrôle possible, ce module le rend automatique.
//
// La sélection est faite sur le CLIENT DU JOUEUR, au moment de la déclaration,
// puis elle passe par le chemin habituel : `game.user.targets` → declareSpell →
// un seuil par cible → le MJ coche qui est touché. Rien n'est court-circuité,
// le MJ garde le dernier mot cible par cible.

import {
  pointDistanceMeters, tokenHalfExtentMeters, gridSizePx, gridDistanceMeters
} from "../utils/grid.js";
import { areOpposedDisp } from "./movement-tracker.js";
import { drawSpellCircle } from "./spell-range.js";

const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Modes de ciblage d'une zone — la clé stockée dans `system.zoneTargets`. */
export const ZONE_TARGETS = {
  tous:    "Tout le monde",
  allies:  "Alliés seulement",
  ennemis: "Ennemis seulement"
};

export function zoneTargetsLabel(key) {
  return ZONE_TARGETS[String(key ?? "tous")] ?? ZONE_TARGETS.tous;
}

/**
 * Ce token est-il une cible légitime pour ce mode ?
 *
 * Le critère est la DISPOSITION du token, comme partout ailleurs dans le
 * système (zone-effects.js filtre ses pièges de la même façon) — jamais le
 * type d'acteur : un PNJ hostile est un `character` exactement comme un
 * joueur, et lire le nom d'un dossier « PJ »/« PNJ » reclasserait tout le
 * monde le jour où le MJ le renomme.
 *
 * « Ennemis » réutilise `areOpposedDisp` (movement-tracker.js), la définition
 * qui décide déjà des attaques d'opportunité : seul le couple Amical ↔ Hostile
 * est une opposition. Un token NEUTRE n'est donc ni un allié ni un ennemi et
 * reste hors des deux filtres — il faut « Tout le monde » pour l'attraper.
 * C'est volontaire : un neutre pris dans une boule de feu doit être une
 * décision du joueur, pas un effet de bord du filtre.
 */
export function matchesZoneTargets(casterToken, token, mode = "tous") {
  const m = String(mode ?? "tous");
  if (m !== "allies" && m !== "ennemis") return true;
  const a = casterToken?.document?.disposition ?? null;
  const b = token?.document?.disposition ?? null;
  if (a === null || b === null) return false;
  return m === "allies" ? a === b : areOpposedDisp(a, b);
}

/**
 * Tokens couverts par un cercle posé sur `center`.
 *
 * La distance est mesurée du point au BORD du token (centre moins sa
 * demi-extension), pas à son centre : une grosse créature dont le corps entre
 * dans la zone est dans la zone, ce qui est aussi la règle appliquée par
 * `rangeDistanceMeters` partout ailleurs.
 */
export function tokensInZone(center, radiusM, { casterToken = null, mode = "tous", excludeCaster = true } = {}) {
  const r = Math.max(0, n(radiusM, 0));
  const list = canvas?.tokens?.placeables ?? [];
  if (!center || r <= 0 || !list.length) return [];

  const out = [];
  for (const tok of list) {
    if (!tok?.actor) continue;
    if (excludeCaster && casterToken && tok.id === casterToken.id) continue;
    if (!matchesZoneTargets(casterToken, tok, mode)) continue;
    const d = pointDistanceMeters(center, tok.center) - tokenHalfExtentMeters(tok);
    if (d <= r) out.push({ token: tok, dist: Math.max(0, d) });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}


// ── Aperçu vivant sous le curseur ─────────────────────────────────────────
//
// Le joueur devait cliquer À L'AVEUGLE : le cercle n'était dessiné qu'APRÈS,
// pour lui montrer ce qu'il venait d'attraper. Un rayon se vise, et viser
// suppose de voir — d'autant que la couverture dépend du BORD des tokens
// (tokensInZone), pas de leur centre, donc l'œil seul se trompe sur les
// grosses créatures et sur les cibles pile à la limite.
//
// Tout est dessiné en PIXI, jamais en MeasuredTemplate : un gabarit est un
// document de la scène, et en créer un à chaque mouvement de souris écrirait
// dans la base des dizaines de fois par seconde.

let _previewGfx = null;

/** Efface l'aperçu de zone, s'il y en a un. */
export function clearZonePreview() {
  try { _previewGfx?.destroy?.({ children: true }); } catch { /* déjà retiré */ }
  _previewGfx = null;
}

/**
 * Dessine le cercle et surligne ce qu'il couvre.
 *
 * Le surlignage reprend exactement `tokensInZone` — même mesure bord à bord,
 * même filtre de disposition, même plafond de cibles — pour que ce qui
 * s'allume soit ce qui sera réellement désigné au clic. Les cibles écartées
 * par `targetCount.max` sont dessinées en gris plutôt qu'omises : « la
 * zone les couvre mais le sort n'en prend pas autant » est une information,
 * l'absence de tout retour n'en est pas une.
 *
 * @returns {Array<Token>} les tokens qui seraient effectivement désignés
 */
export function drawZonePreview(center, radiusM, {
  casterToken = null, mode = "tous", max = 0, label = ""
} = {}) {
  clearZonePreview();
  if (!center || !(radiusM > 0) || !canvas?.ready) return [];

  const found = tokensInZone(center, radiusM, { casterToken, mode });
  const kept  = (max > 0 && found.length > max) ? found.slice(0, max) : found;
  const keptIds = new Set(kept.map(k => k.token.id));

  try {
    const g = new PIXI.Graphics();
    const perM = gridSizePx() / (gridDistanceMeters() || 1);
    const rPx  = radiusM * perM;

    g.lineStyle(3, 0xe67e22, 0.95);
    g.beginFill(0xe67e22, 0.12);
    g.drawCircle(center.x, center.y, rPx);
    g.endFill();

    // Croix au centre : sur une grande zone, le bord seul ne dit pas où le
    // point visé se trouve exactement.
    g.lineStyle(2, 0xe67e22, 0.9);
    g.moveTo(center.x - 8, center.y); g.lineTo(center.x + 8, center.y);
    g.moveTo(center.x, center.y - 8); g.lineTo(center.x, center.y + 8);

    for (const { token } of found) {
      const inside = keptIds.has(token.id);
      const marker = new PIXI.Graphics();
      const pad = 3;
      marker.lineStyle(3, inside ? 0xffd700 : 0x888888, inside ? 0.95 : 0.6);
      if (inside) marker.beginFill(0xffd700, 0.10);
      marker.drawRoundedRect(
        token.center.x - token.w / 2 - pad, token.center.y - token.h / 2 - pad,
        token.w + 2 * pad, token.h + 2 * pad, 6
      );
      if (inside) marker.endFill();
      g.addChild(marker);
    }

    try {
      const dropped = found.length - kept.length;
      const txt = `${label ? `${label} — ` : ""}${kept.length} cible${kept.length > 1 ? "s" : ""}`
                + (dropped > 0 ? ` (+${dropped} hors plafond)` : "");
      const t = new PIXI.Text(txt, new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif", fontSize: 16, fontWeight: "700",
        fill: kept.length ? "#ffd700" : "#dddddd", stroke: "#000000", strokeThickness: 4
      }));
      t.anchor.set(0.5, 1);
      t.position.set(center.x, center.y - rPx - 6);
      g.addChild(t);
    } catch { /* étiquette optionnelle */ }

    (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
    _previewGfx = g;
  } catch (e) {
    console.warn("[RPG] aperçu de zone :", e);
  }

  return kept.map(k => k.token);
}

/**
 * Attend UN clic du joueur sur le canevas et rend le point visé, en
 * coordonnées de scène.
 *
 * Les écouteurs sont posés en phase de CAPTURE sur l'élément du canevas, et
 * l'événement est stoppé : sans ça, le clic servirait aussi à Foundry
 * (désélectionner le token, démarrer un rectangle de sélection) pendant qu'on
 * l'utilise pour viser. Clic droit ou Échap annulent — et une annulation doit
 * remonter jusqu'à l'appelant, qui abandonne la déclaration : viser au centre
 * de la carte parce que le joueur a changé d'avis serait pire que ne rien
 * faire.
 */
export function pickCanvasPoint({ hint = "", onMove = null } = {}) {
  return new Promise((resolve) => {
    const view = canvas?.app?.view ?? null;
    if (!view) return resolve(null);

    let done = false;
    const finish = (pt) => {
      if (done) return;
      done = true;
      view.removeEventListener("mousedown", onDown, true);
      view.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("keydown", onKey, true);
      resolve(pt);
    };

    const worldPoint = (ev) => {
      // `canvas.mousePosition` est déjà en coordonnées de scène et suivi par
      // Foundry : c'est la source la plus fiable. Le repli reconstruit le
      // point depuis la position du clic dans l'élément canvas, au cas où il
      // n'aurait pas encore été mis à jour.
      const mp = canvas?.mousePosition;
      if (mp && Number.isFinite(mp.x) && Number.isFinite(mp.y)) return { x: mp.x, y: mp.y };
      try {
        const rect = view.getBoundingClientRect();
        const p = canvas.stage.worldTransform.applyInverse({
          x: ev.clientX - rect.left, y: ev.clientY - rect.top
        });
        return { x: p.x, y: p.y };
      } catch (e) { return null; }
    };

    const onDown = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      finish(ev.button === 0 ? worldPoint(ev) : null);   // clic droit = annuler
    };
    // L'aperçu suit la souris. On NE stoppe PAS l'événement ici (contrairement
    // au clic) : Foundry a besoin des mousemove pour tenir `canvas.mousePosition`
    // à jour — c'est la source que `worldPoint` lit en priorité, et la couper
    // ferait viser à côté. Le dessin est calé sur le rafraîchissement de
    // l'écran : une souris émet bien plus de mousemove que le canevas n'affiche
    // d'images, et redessiner à chaque événement surligne pour rien.
    let raf = 0;
    const onMouseMove = (ev) => {
      if (!onMove || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (done) return;
        const pt = worldPoint(ev);
        if (pt) { try { onMove(pt); } catch (e) { console.warn("[RPG] aperçu de visée :", e); } }
      });
    };

    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(null);
    };

    view.addEventListener("mousedown", onDown, true);
    view.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("keydown", onKey, true);
    if (hint) ui.notifications?.info?.(hint);
  });
}

/**
 * Fait viser un point au joueur, puis désigne comme cibles tout ce que le
 * rayon couvre.
 *
 * @returns {Promise<{ok:boolean, cancelled?:boolean, center?:object,
 *                     tokens?:Array<Token>, dropped?:number, reason?:string}>}
 */
export async function pickZoneTargets(casterToken, item, opts = {}) {
  const sys = item?.system ?? {};
  const radius = Math.max(0, n(sys.zoneRadius, 0));
  if (radius <= 0) return { ok: false, reason: "Ce sort n'a pas de rayon de zone" };

  const mode = String(sys.zoneTargets ?? "tous");
  const label = zoneTargetsLabel(mode).toLowerCase();

  // Le plafond de cibles du sort s'applique aussi à une sélection automatique,
  // sinon un rayon généreux contournerait `targetCount.max` sans un mot. On
  // garde les plus PROCHES du centre — c'est ce qu'un joueur qui pose sa zone
  // à cet endroit-là a voulu toucher. Il est lu ICI parce que l'aperçu doit
  // appliquer exactement la même règle que le clic : montrer quatre cibles
  // allumées puis n'en désigner que deux serait pire que ne rien montrer.
  const tcMax = Math.max(0, n(sys.targetCount?.max, 0));

  // Premier dessin AVANT le moindre mouvement : sans lui, un joueur dont le
  // curseur est déjà au bon endroit ne voit rien tant qu'il ne bouge pas.
  try {
    const mp = canvas?.mousePosition;
    if (mp) drawZonePreview(mp, radius, { casterToken, mode, max: tcMax, label: item.name });
  } catch { /* pas de canevas */ }

  let center = null;
  try {
    center = await pickCanvasPoint({
      hint: `${item.name} — clique le centre de la zone (rayon ${radius} m, ${label}). Échap ou clic droit pour annuler.`,
      onMove: (pt) => drawZonePreview(pt, radius, {
        casterToken, mode, max: tcMax, label: item.name
      })
    });
  } finally {
    // L'aperçu meurt avec la visée, y compris sur annulation ou sur erreur :
    // un cercle orange oublié sur la carte se lit comme une zone active.
    clearZonePreview();
  }
  if (!center) return { ok: false, cancelled: true };

  const found = tokensInZone(center, radius, { casterToken, mode });
  const kept = (tcMax > 0 && found.length > tcMax) ? found.slice(0, tcMax) : found;
  const dropped = found.length - kept.length;

  // Le cercle reste affiché quelques secondes : le joueur doit VOIR ce qu'il
  // vient d'attraper, surtout quand le plafond en a écarté.
  try {
    if (casterToken) {
      await drawSpellCircle(casterToken, radius, {
        center, color: "#e67e22", spellName: `${item.name} — zone`
      });
    }
  } catch (e) { /* pas de canevas, ou gabarit refusé : le ciblage reste valable */ }

  try {
    for (const t of Array.from(game.user.targets)) t.setTarget(false, { releaseOthers: false });
    for (const { token } of kept) token.setTarget(true, { releaseOthers: false });
  } catch (e) {
    return { ok: false, reason: `Impossible de désigner les cibles : ${e?.message ?? e}` };
  }

  return { ok: true, center, tokens: kept.map(k => k.token), dropped };
}
