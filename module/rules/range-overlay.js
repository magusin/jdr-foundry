// module/rules/range-overlay.js
//
// Affichage des portées sur le canevas — pour le joueur comme pour le MJ.
//
// Trois usages :
//   1. Survol d'un token  → allonge de mêlée + portée de l'arme équipée
//   2. Survol d'un sort   → portée de ce sort autour du lanceur
//      (liste des sorts de la fiche et menu de combat)
//   3. Épinglage (touche) → garde l'affichage du token sélectionné à l'écran
//
// Tout est en MÈTRES, avec la même échelle que le reste du système
// (rayon en pixels = mètres ÷ distance-par-case × taille-de-case).

import { getMeleeReach, areOpposedDisp } from "./movement-tracker.js";

let _gfx = null;         // calque de l'affichage éphémère (survol)
let _pinnedTokenId = null;

const COLORS = {
  melee:  0xe0524a,   // rouge — zone de menace au corps à corps
  weapon: 0xd1a144,   // laiton — portée de tir/jet de l'arme
  spell:  0x9b6ede,   // violet — portée du sort
  dead:   0x7a7a86    // gris — zone morte (sous la portée mini)
};

function _clear() {
  try { _gfx?.destroy({ children: true }); } catch { /* ignore */ }
  _gfx = null;
}

function metersToPixels(m) {
  const gs = canvas?.scene?.grid?.size ?? 100;
  const gd = canvas?.scene?.grid?.distance ?? 1;
  return (Number(m) || 0) / (gd || 1) * gs;
}

const fmtM = (m) => (m % 1 === 0 ? `${m}` : m.toFixed(1)) + " m";

/**
 * Portée de l'arme équipée d'un acteur, en mètres.
 * Renvoie null si l'acteur n'a pas d'arme de jet/tir pertinente.
 */
export function getWeaponRange(actor) {
  const w = actor?.items?.find?.(i => i.type === "weapon" && i.system?.equipe);
  if (!w) return null;
  const min = Math.max(0, Number(w.system?.range?.min ?? 0) || 0);
  const max = Math.max(0, Number(w.system?.range?.max ?? w.system?.portee ?? 0) || 0);
  if (!(max > 0)) return null;
  return { min, max, name: w.name };
}

/**
 * Dessine un anneau de portée (min → max) autour d'un point.
 * La zone sous la portée minimale est hachurée en gris : on y voit d'un coup
 * d'œil qu'on est trop près pour tirer.
 */
function drawRing(g, cx, cy, { min = 0, max = 0, color = 0xffffff, label = null, alpha = 0.9 }) {
  const rMax = metersToPixels(max);
  const rMin = metersToPixels(min);
  if (!(rMax > 0)) return;

  g.lineStyle(3, color, alpha);
  g.beginFill(color, 0.06);
  g.drawCircle(cx, cy, rMax);
  g.endFill();

  if (rMin > 0) {
    g.lineStyle(2, COLORS.dead, 0.75);
    g.beginFill(COLORS.dead, 0.14);
    g.drawCircle(cx, cy, rMin);
    g.endFill();
  }

  if (label) {
    try {
      const style = new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif", fontSize: 16, fontWeight: "700",
        fill: "#ffffff", stroke: "#000000", strokeThickness: 4
      });
      const t = new PIXI.Text(label, style);
      t.anchor.set(0.5, 1);
      t.position.set(cx, cy - rMax - 4);
      g.addChild(t);
    } catch { /* étiquette optionnelle */ }
  }
}

/**
 * Dessine une ou plusieurs portées autour d'un token.
 * @param {Token} token
 * @param {Array<{min,max,color,label}>} layers
 * @param {boolean} [highlightEnemies=false] - entoure les ennemis à portée
 */
export function drawRanges(token, layers, highlightEnemies = false) {
  _clear();
  if (!token || !canvas?.ready) return;
  const usable = (layers ?? []).filter(l => (Number(l?.max) || 0) > 0);
  if (!usable.length) return;

  const cx = token.center.x, cy = token.center.y;
  const g = new PIXI.Graphics();

  // Du plus grand au plus petit, pour que les petits restent lisibles
  for (const l of [...usable].sort((a, b) => (b.max ?? 0) - (a.max ?? 0))) drawRing(g, cx, cy, l);

  if (highlightEnemies) {
    const reach = Math.max(...usable.map(l => Number(l.max) || 0));
    const rPx = metersToPixels(reach);
    try {
      for (const other of canvas.tokens?.placeables ?? []) {
        if (other === token || !other.actor) continue;
        if (!areOpposedDisp(token.document?.disposition, other.document?.disposition)) continue;
        const dx = other.center.x - cx, dy = other.center.y - cy;
        if (Math.hypot(dx, dy) <= rPx + 1) {
          const marker = new PIXI.Graphics();
          marker.lineStyle(3, 0xffd700, 0.95);
          marker.drawCircle(other.center.x, other.center.y, Math.max(other.w, other.h) * 0.6);
          g.addChild(marker);
        }
      }
    } catch { /* surlignage optionnel */ }
  }

  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
  _gfx = g;
}

/** Portées « par défaut » d'un token : mêlée + arme équipée. */
function defaultLayersFor(token) {
  const actor = token?.actor;
  if (!actor) return [];
  const layers = [];

  const reach = getMeleeReach(actor);
  if (reach > 0) {
    layers.push({ min: 0, max: reach, color: COLORS.melee, label: `⚔ ${fmtM(reach)}` });
  }

  const wr = getWeaponRange(actor);
  // Inutile de doubler le cercle si l'arme ne fait que du corps à corps
  if (wr && wr.max > reach) {
    const lbl = wr.min > 0
      ? `🏹 ${wr.name} ${fmtM(wr.min)}–${fmtM(wr.max)}`
      : `🏹 ${wr.name} ${fmtM(wr.max)}`;
    layers.push({ min: wr.min, max: wr.max, color: COLORS.weapon, label: lbl });
  }

  return layers;
}

/** Affiche les portées par défaut d'un token (mêlée + arme). */
export function showTokenRanges(token) {
  drawRanges(token, defaultLayersFor(token), true);
}

/**
 * Affiche la portée d'un sort autour de son lanceur.
 * @param {Actor} actor - le lanceur
 * @param {Item}  spell - le sort survolé
 */
export function showSpellRangeOverlay(actor, spell) {
  if (!actor || !spell) return;
  const token = actor.getActiveTokens?.()?.[0]
             ?? canvas?.tokens?.controlled?.[0]
             ?? null;
  if (!token) return;

  const sys = spell.system ?? {};
  const min = Math.max(0, Number(sys.range?.min ?? 0) || 0);
  const max = Math.max(0, Number(sys.range?.max ?? 0) || 0);

  const layers = [];
  if (max > 0) {
    const lbl = min > 0
      ? `✨ ${spell.name} ${fmtM(min)}–${fmtM(max)}`
      : `✨ ${spell.name} ${fmtM(max)}`;
    layers.push({ min, max, color: COLORS.spell, label: lbl });
  }

  // Aura éventuelle du sort, en pointillé conceptuel (couleur distincte)
  const auraMax = Math.max(0, Number(sys.aura?.range?.max ?? 0) || 0);
  if (sys.aura?.active && auraMax > 0) {
    layers.push({
      min: Math.max(0, Number(sys.aura?.range?.min ?? 0) || 0),
      max: auraMax, color: 0x6ec4a8, label: `🌀 Aura ${fmtM(auraMax)}`
    });
  }

  drawRanges(token, layers, true);
}

/** Efface l'affichage éphémère (sauf si une portée est épinglée). */
export function clearRanges({ force = false } = {}) {
  if (_pinnedTokenId && !force) {
    const t = canvas?.tokens?.get?.(_pinnedTokenId);
    if (t) { showTokenRanges(t); return; }
    _pinnedTokenId = null;
  }
  _clear();
}

/**
 * Épingle/désépingle les portées du token contrôlé : l'affichage reste à
 * l'écran même sans survol, pratique pour planifier un déplacement.
 */
export function togglePinnedRanges() {
  const token = canvas?.tokens?.controlled?.[0] ?? null;
  if (_pinnedTokenId) {
    _pinnedTokenId = null;
    _clear();
    ui.notifications?.info?.("Portées masquées.");
    return false;
  }
  if (!token) {
    ui.notifications?.warn?.("Sélectionne un token pour afficher ses portées.");
    return false;
  }
  _pinnedTokenId = token.id;
  showTokenRanges(token);
  ui.notifications?.info?.(`Portées de ${token.name} affichées — même touche pour masquer.`);
  return true;
}

/** Redessine l'affichage épinglé (après un déplacement, un équipement…). */
export function refreshPinned() {
  if (!_pinnedTokenId) return;
  const t = canvas?.tokens?.get?.(_pinnedTokenId);
  if (t) showTokenRanges(t);
  else { _pinnedTokenId = null; _clear(); }
}

/** Enregistre les hooks (idempotent). */
export function installRangeOverlay() {
  if (globalThis.__rpgRangeOverlay) return;
  globalThis.__rpgRangeOverlay = true;

  Hooks.on("hoverToken", (token, hovered) => {
    try {
      if (hovered) showTokenRanges(token);
      else clearRanges();
    } catch (e) { console.warn("[RPG] affichage des portées :", e); }
  });

  // Suit le token épinglé quand il bouge / change d'équipement
  Hooks.on("updateToken", (doc) => {
    if (_pinnedTokenId === doc.id) setTimeout(() => refreshPinned(), 60);
  });
  Hooks.on("updateActor", () => refreshPinned());
  Hooks.on("deleteToken", (doc) => {
    if (_pinnedTokenId === doc.id) { _pinnedTokenId = null; _clear(); }
  });
  Hooks.on("canvasTearDown", () => { _pinnedTokenId = null; _clear(); });
}
