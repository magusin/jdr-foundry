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

import { pointDistanceMeters, tokenHalfExtentMeters } from "../utils/grid.js";
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
export function pickCanvasPoint({ hint = "" } = {}) {
  return new Promise((resolve) => {
    const view = canvas?.app?.view ?? null;
    if (!view) return resolve(null);

    let done = false;
    const finish = (pt) => {
      if (done) return;
      done = true;
      view.removeEventListener("mousedown", onDown, true);
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
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(null);
    };

    view.addEventListener("mousedown", onDown, true);
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
  const center = await pickCanvasPoint({
    hint: `${item.name} — clique le centre de la zone (rayon ${radius} m, ${label}). Échap ou clic droit pour annuler.`
  });
  if (!center) return { ok: false, cancelled: true };

  const found = tokensInZone(center, radius, { casterToken, mode });

  // Le plafond de cibles du sort s'applique aussi à une sélection automatique,
  // sinon un rayon généreux contournerait `targetCount.max` sans un mot. On
  // garde les plus PROCHES du centre — c'est ce qu'un joueur qui pose sa zone
  // à cet endroit-là a voulu toucher.
  const tcMax = Math.max(0, n(sys.targetCount?.max, 0));
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
