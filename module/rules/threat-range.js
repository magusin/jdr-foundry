// module/rules/threat-range.js
//
// Indicateur visuel d'ALLONGE (zone de menace de corps à corps) au survol d'un
// token. Dessine un cercle centré sur le token, de rayon = son allonge (arme de
// mêlée équipée pour un PJ, system.allonge pour un monstre/PNJ), et surligne les
// tokens ennemis actuellement DANS cette zone (engagés → attaque d'opportunité
// s'ils la quittent). Marche pour tout le monde (le joueur voit l'allonge d'un
// monstre visible en le survolant ; le MJ voit qui est engagé).

import { getMeleeReach } from "./movement-tracker.js";

let _gfx = null;

function _clear() {
  try { _gfx?.destroy({ children: true }); } catch { /* ignore */ }
  _gfx = null;
}

function _colorFor(disp) {
  const D = CONST.TOKEN_DISPOSITIONS ?? {};
  if (disp === D.FRIENDLY) return 0x4a9e68;  // vert
  if (disp === D.HOSTILE)  return 0xe0524a;  // rouge
  return 0xd1a144;                            // laiton (neutre)
}

function _draw(token) {
  _clear();
  const actor = token?.actor;
  if (!actor) return;

  const reach = getMeleeReach(actor);
  if (!(reach > 0)) return;

  const gs = canvas?.scene?.grid?.size ?? 100;
  const gd = canvas?.scene?.grid?.distance ?? 1;
  const radius = (reach / (gd || 1)) * gs;   // mètres → pixels (même échelle que le calcul de menace)
  const cx = token.center.x, cy = token.center.y;
  const color = _colorFor(token.document?.disposition);

  const g = new PIXI.Graphics();

  // Cercle de menace
  g.lineStyle(3, color, 0.85);
  g.beginFill(color, 0.07);
  g.drawCircle(cx, cy, radius);
  g.endFill();

  // Étiquette « ⚔ X m »
  try {
    const style = new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif", fontSize: 18, fontWeight: "700",
      fill: "#ffffff", stroke: "#000000", strokeThickness: 4
    });
    const label = new PIXI.Text(`⚔ ${reach % 1 === 0 ? reach : reach.toFixed(1)} m`, style);
    label.anchor.set(0.5, 1);
    label.position.set(cx, cy - radius - 4);
    g.addChild(label);
  } catch { /* texte optionnel */ }

  // Surligne les autres tokens DANS la zone de menace (engagés)
  try {
    for (const other of canvas.tokens?.placeables ?? []) {
      if (other === token || !other.actor) continue;
      const dx = other.center.x - cx, dy = other.center.y - cy;
      if (Math.hypot(dx, dy) <= radius + 1) {
        const oc = _colorFor(other.document?.disposition);
        const marker = new PIXI.Graphics();
        marker.lineStyle(3, oc, 0.95);
        marker.drawCircle(other.center.x, other.center.y, Math.max(other.w, other.h) * 0.6);
        g.addChild(marker);
      }
    }
  } catch { /* surlignage optionnel */ }

  const layer = canvas.interface ?? canvas.controls ?? canvas.stage;
  layer.addChild(g);
  _gfx = g;
}

/** Enregistre le hook de survol (idempotent). */
export function installThreatRangeIndicator() {
  if (globalThis.__rpgThreatHook) return;
  globalThis.__rpgThreatHook = true;
  Hooks.on("hoverToken", (token, hovered) => {
    try {
      if (hovered) _draw(token);
      else _clear();
    } catch (e) { console.warn("[RPG] indicateur d'allonge :", e); }
  });
  // Nettoyage si le token survolé bouge / est supprimé / changement de scène
  Hooks.on("deleteToken",  () => _clear());
  Hooks.on("canvasTearDown", () => _clear());
}
