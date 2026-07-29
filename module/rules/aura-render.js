// module/rules/aura-render.js
//
// Rendu visuel des auras sur le canevas — en MÈTRES (portée min/max), avec
// une couleur pleine sur toute la zone liée au type/élément de l'état
// (feu, air, lumière, ténèbres…, cf. aura-colors.js).
//
// Deux sources d'anneaux sont dessinées, fusionnées par token :
//   1. Auto  — les vraies auras de gameplay (system.etatsActifs[].isAura,
//      posées par un sort), toujours en phase avec RPG_AURAS.refreshAuras().
//   2. Manuel — des auras ad-hoc posées par le MJ via la macro (flag
//      token `rpg.aurasManual`), pour une zone qui n'est pas un sort.
//
// Si un token porte plusieurs auras à la fois, chacune dessine son propre
// anneau (du plus grand au plus petit) en mode additif (PIXI BLEND_MODES.ADD) :
// les couleurs se mélangent au lieu de s'écraser, et une étiquette par aura
// s'empile au-dessus du token pour lever toute ambiguïté.

import { auraColorForTag, hexToColorNumber, DEFAULT_AURA_COLOR } from "./aura-colors.js";

const SCOPE = "rpg";
const MANUAL_FLAG = "aurasManual";
const CONTAINER_NAME = "RPG_AURA_RENDER_CONTAINER";

const _gfxByToken = new Map(); // tokenId -> PIXI.Graphics
let _container = null;
let _inited = false;

function metersToPixels(m) {
  const gs = canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100;
  const gd = canvas?.scene?.grid?.distance ?? 1;
  return (Number(m) || 0) / (gd || 1) * gs;
}

const fmtM = (m) => (m % 1 === 0 ? `${m}` : m.toFixed(1)) + " m";

function ensureContainer() {
  if (!canvas?.tokens) return null;
  if (!_container) {
    _container = new PIXI.Container();
    _container.name = CONTAINER_NAME;
    _container.eventMode = "none";
    _container.interactiveChildren = false;
    canvas.tokens.addChildAt(_container, 0);
  }
  return _container;
}

function getGraphics(tokenId) {
  let gfx = _gfxByToken.get(tokenId);
  if (!gfx) {
    gfx = new PIXI.Graphics();
    gfx.name = `RPG_AURA_${tokenId}`;
    gfx.eventMode = "none";
    ensureContainer()?.addChild(gfx);
    _gfxByToken.set(tokenId, gfx);
  }
  return gfx;
}

function removeGraphics(tokenId) {
  const gfx = _gfxByToken.get(tokenId);
  if (!gfx) return;
  gfx.destroy({ children: true });
  _gfxByToken.delete(tokenId);
}

/** Anneau min→max plein, teinté par élément ; le rayon min reste marqué d'un trait fin. */
function drawRing(g, cx, cy, { min = 0, max = 0, color = DEFAULT_AURA_COLOR }) {
  const rMax = metersToPixels(max);
  const rMin = metersToPixels(min);
  if (!(rMax > 0)) return;

  g.lineStyle(2.5, color, 0.85);
  g.beginFill(color, 0.14);
  g.drawCircle(cx, cy, rMax);
  g.endFill();

  if (rMin > 0) {
    g.lineStyle(1.5, color, 0.55);
    g.drawCircle(cx, cy, rMin);
  }
}

/** Empile une étiquette par aura active au-dessus du token (couleur = celle de l'anneau). */
function drawLabels(g, cx, cy, rings) {
  let dy = 0;
  for (const r of rings) {
    if (!r.label) continue;
    try {
      const rMax = metersToPixels(r.max);
      const style = new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif", fontSize: 13, fontWeight: "700",
        fill: r.color, stroke: "#000000", strokeThickness: 3
      });
      const t = new PIXI.Text(r.label, style);
      t.anchor.set(0.5, 1);
      t.position.set(cx, cy - rMax - 6 - dy);
      g.addChild(t);
      dy += 16;
    } catch { /* étiquette optionnelle */ }
  }
}

/** Auras "réelles" (sorts) portées par ce token — isAura sur ses etatsActifs. */
function autoAurasOnToken(token) {
  const actor = token?.actor;
  const states = Array.isArray(actor?.system?.etatsActifs) ? actor.system.etatsActifs : [];
  const out = [];

  for (const st of states) {
    if (!st?.isAura) continue;

    const max = Number(st?.aura?.max ?? 0) || 0;
    if (max <= 0) continue;

    const rem = Number(st?.remaining ?? st?.duration ?? 1) || 0;
    if (rem <= 0) continue;

    const min = Number(st?.aura?.min ?? 0) || 0;
    const tag = st?.tag ?? null;

    out.push({
      min, max,
      color: auraColorForTag(tag),
      label: `${st.label ?? "Aura"} ${fmtM(min)}–${fmtM(max)}`
    });
  }

  return out;
}

/** Auras manuelles posées par le MJ (flag token, indépendantes d'un sort). */
function manualAurasOnToken(token) {
  const flags = token?.document?.getFlag?.(SCOPE, MANUAL_FLAG) ?? {};
  const out = [];

  for (const [key, cfg] of Object.entries(flags)) {
    if (!cfg?.enabled) continue;

    const max = Number(cfg?.max ?? 0) || 0;
    if (max <= 0) continue;

    const min = Number(cfg?.min ?? 0) || 0;
    const tag = cfg?.tag || null;
    const color = cfg?.color ? (hexToColorNumber(cfg.color) ?? auraColorForTag(tag)) : auraColorForTag(tag);

    out.push({ min, max, color, label: `${cfg?.label || key} ${fmtM(min)}–${fmtM(max)}` });
  }

  return out;
}

function drawToken(token) {
  if (!token?.document) return;
  const tokenId = token.document.id;

  const rings = [...autoAurasOnToken(token), ...manualAurasOnToken(token)];
  if (!rings.length) { removeGraphics(tokenId); return; }

  const gfx = getGraphics(tokenId);
  gfx.clear();
  for (const child of [...gfx.children]) child.destroy();

  const cx = token.center.x, cy = token.center.y;
  // Du plus grand au plus petit, pour que les anneaux serrés restent visibles.
  const sorted = [...rings].sort((a, b) => b.max - a.max);
  for (const r of sorted) drawRing(gfx, cx, cy, r);
  drawLabels(gfx, cx, cy, sorted);

  // Fusion additive : plusieurs auras superposées se mélangent en teinte
  // au lieu de se masquer l'une l'autre.
  gfx.blendMode = PIXI.BLEND_MODES.ADD;
}

function redrawAll() {
  for (const t of canvas.tokens?.placeables ?? []) drawToken(t);
}

export const RPG_AURA_RENDER = {
  /** Redessine toutes les auras (auto + manuelles) de la scène courante. */
  refresh: redrawAll,

  /** Redessine uniquement l'aura d'un token (après une modif locale du flag manuel). */
  refreshToken(token) {
    if (token) drawToken(token);
  },

  init() {
    if (_inited) return;
    _inited = true;

    const onCanvasReady = () => { _container = null; _gfxByToken.clear(); redrawAll(); };

    const onUpdateToken = (doc, change) => {
      const moved = ("x" in change) || ("y" in change) || ("width" in change) || ("height" in change);
      const flagChanged = !!change?.flags?.[SCOPE]?.[MANUAL_FLAG];
      if (!moved && !flagChanged) return;
      const t = canvas.tokens?.placeables?.find(x => x.id === doc.id);
      if (t) drawToken(t);
    };

    const onRefreshToken = (token) => drawToken(token);
    const onDeleteToken = (doc) => removeGraphics(doc.id);

    // Une aura de sort apparaît/disparaît via system.etatsActifs sur l'ACTEUR
    // (pas forcément un déplacement de token) : sans ce hook, l'anneau ne
    // se mettrait à jour qu'au prochain mouvement.
    const onUpdateActor = (actor, changed) => {
      if (changed?.system?.etatsActifs === undefined) return;
      for (const t of actor?.getActiveTokens?.() ?? []) drawToken(t);
    };

    Hooks.on("canvasReady", onCanvasReady);
    Hooks.on("updateToken", onUpdateToken);
    Hooks.on("refreshToken", onRefreshToken);
    Hooks.on("deleteToken", onDeleteToken);
    Hooks.on("updateActor", onUpdateActor);

    redrawAll();
  }
};
