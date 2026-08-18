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
// (pixels = mètres ÷ distance-par-case × taille-de-case).
//
// Les zones tracées ne sont pas des cercles mais le CARRÉ du token dilaté de
// la portée (coins arrondis) : c'est la forme exacte de la règle de mesure
// (utils/grid.js), qui part du carré du token et non de son centre. Voir
// strokeReach() plus bas.

import { getMeleeReach, areOpposedDisp } from "./movement-tracker.js";
import { RPG_AURA_RENDER } from "./aura-render.js";
import { checkRange } from "../utils/grid.js";
import { BASE_VITESSE } from "./base-speed.js";

let _gfx = null;         // calque de l'affichage éphémère (survol)
let _pinnedTokenId = null;

const COLORS = {
  melee:  0xe0524a,   // rouge — zone de menace au corps à corps (celle des AUTRES)
  mine:   0x5ec8ff,   // bleu  — MA propre allonge pendant un déplacement
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

// La MESURE vit dans utils/grid.js (checkRange / rangeDistanceMeters) : le
// tracé fait ici, la portée autorisée à la déclaration et le bouton
// « Attaquer » (weapon-range.js, qui délègue à la même fonction) doivent partir
// du MÊME bord, sinon le tracé ment sur ce qui est réellement atteignable.

// Virgule décimale : ces étiquettes sont lues sur la carte, dans un système
// entièrement francophone — « 0.5 m » y détonne (et fmtMeters, utils/grid.js,
// écrit déjà « 0,5 m » dans les messages de chat).
const fmtM = (m) => (m % 1 === 0 ? `${m}` : m.toFixed(1).replace(".", ",")) + " m";

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
 * Contour de la zone atteignable à `meters` du bord d'un token : son CARRÉ
 * dilaté d'autant, coins arrondis.
 *
 * C'est la forme exacte de la règle (rangeDistanceMeters, utils/grid.js) : tout
 * point du tracé est à exactement `meters` du carré du token, sur les côtés
 * comme dans les coins. Un cercle, lui, ne pouvait pas l'être — il débordait le
 * carré de la portée entière sur les axes et d'à peine la moitié dans les
 * coins, si bien qu'une cible en diagonale se retrouvait hors du cercle tout en
 * étant à portée. Le carré rouge que Foundry dessine autour du token sert donc
 * bien de limite de départ, visiblement, dans toutes les directions.
 */
function strokeReach(g, token, meters) {
  const r = metersToPixels(meters);
  if (!(r > 0)) return null;
  const hw = (Number(token?.w) || 0) / 2;
  const hh = (Number(token?.h) || 0) / 2;
  const cx = token.center.x, cy = token.center.y;
  g.drawRoundedRect(cx - hw - r, cy - hh - r, 2 * (hw + r), 2 * (hh + r), r);
  return { top: cy - hh - r, bottom: cy + hh + r };
}

/**
 * Entoure en or les ennemis réellement à portée d'au moins une des couches.
 *
 * ⚠️ Fonction UNIQUE, appelée par le survol (drawRanges) comme par le cercle
 * du combattant actif (showMovementLimit). Les deux avaient leur propre copie
 * de ce calcul, et elles ont divergé : celle du combattant actif refaisait sa
 * distance à la main, sans même vérifier la portée minimale, et disait donc
 * autre chose que ce que la déclaration allait réellement autoriser.
 *
 * On teste sur les portées BRUTES de la fiche, pas sur les rayons dessinés :
 * checkRange mesure déjà bord à bord, et c'est lui qui fait foi au moment de
 * déclarer.
 */
function highlightEnemiesInRange(g, token, layers) {
  try {
    for (const other of canvas.tokens?.placeables ?? []) {
      // Comparaison d'id en plus de l'identité : pendant un déplacement, le
      // « token » passé ici est un objet minimal reconstruit à la position
      // suivie par la souris (drag-limit.js), jamais le placeable lui-même —
      // sans ce test, un token se surlignerait comme sa propre cible.
      if (other === token || other.id === token.id || !other.actor) continue;
      if (!areOpposedDisp(token.document?.disposition, other.document?.disposition)) continue;
      if (!layers.some(l => checkRange(token, other, l.min ?? 0, l.max ?? 0).ok)) continue;
      // Surligne le CARRÉ de la cible, pas un cercle autour d'elle : c'est ce
      // carré que la zone de portée doit toucher pour qu'elle soit atteignable.
      // Un cercle laissait croire que c'était le centre de la cible qui devait
      // entrer dans la zone, ce qui n'a jamais été la règle.
      const marker = new PIXI.Graphics();
      const pad = 3;
      marker.lineStyle(3, 0xffd700, 0.95);
      marker.drawRoundedRect(
        other.center.x - other.w / 2 - pad, other.center.y - other.h / 2 - pad,
        other.w + 2 * pad, other.h + 2 * pad, 6
      );
      g.addChild(marker);
    }
  } catch { /* surlignage optionnel */ }
}

/**
 * Dessine une zone de portée (min → max) autour d'un token.
 *
 * Les distances sont celles de la FICHE, brutes : elles partent du carré du
 * token, jamais de son centre (strokeReach s'en charge). La zone sous la portée
 * minimale est grisée : on y voit d'un coup d'œil qu'on est trop près pour tirer.
 *
 * `labelBelow` place l'étiquette sous la zone : pendant un déplacement, deux
 * zones se superposent autour du même token (la mienne et l'avertissement de
 * menace), et deux étiquettes empilées au-dessus deviennent illisibles.
 */
function drawRing(g, token, {
  min = 0, max = 0, color = 0xffffff, label = null, alpha = 0.9,
  labelColor = "#ffffff", labelBelow = false
}) {
  if (!token?.center || !((Number(max) || 0) > 0)) return;

  g.lineStyle(3, color, alpha);
  g.beginFill(color, 0.06);
  const box = strokeReach(g, token, max);
  g.endFill();
  if (!box) return;

  if ((Number(min) || 0) > 0) {
    g.lineStyle(2, COLORS.dead, 0.75);
    g.beginFill(COLORS.dead, 0.14);
    strokeReach(g, token, min);
    g.endFill();
  }

  if (label) {
    try {
      const style = new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif", fontSize: 16, fontWeight: "700",
        fill: labelColor, stroke: "#000000", strokeThickness: 4
      });
      const t = new PIXI.Text(label, style);
      t.anchor.set(0.5, labelBelow ? 0 : 1);
      t.position.set(token.center.x, labelBelow ? box.bottom + 4 : box.top - 4);
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
  const raw = (layers ?? []).filter(l => (Number(l?.max) || 0) > 0);
  if (!raw.length) return;

  const g = new PIXI.Graphics();

  // Du plus grand au plus petit, pour que les petits restent lisibles
  for (const l of [...raw].sort((a, b) => (b.max ?? 0) - (a.max ?? 0))) drawRing(g, token, l);

  if (highlightEnemies) highlightEnemiesInRange(g, token, raw);

  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
  _gfx = g;
}

/** Portées « par défaut » d'un token : mêlée + arme équipée. */
function defaultLayersFor(token) {
  const actor = token?.actor;
  if (!actor) return [];
  const layers = [];

  // Le cercle dessiné part du bord du token (drawRanges) ; le LIBELLÉ, lui,
  // affiche toujours la valeur brute de la fiche — un joueur qui compare au
  // chiffre de sa fiche d'arme doit y retrouver le même nombre.

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

  // « Attaquer » est une action de base : un vrai objet de type sort, mais dont
  // la portée est 0/0 parce qu'elle n'est pas la sienne — c'est celle de l'arme
  // équipée au moment de frapper (voir default-actions.js). Sans ce repli,
  // survoler son icône ne dessinait donc rien du tout : aucune couche de portée
  // positive, drawRanges() sortait immédiatement, ni cercle ni ennemi surligné.
  // On affiche les mêmes couches que le survol du token (allonge + arme).
  if (max <= 0 && spell.getFlag?.("rpg", "defaultActionKey") === "attaquer") {
    drawRanges(token, defaultLayersFor(token), true);
    return;
  }

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

/* ══════════════════════════════════════════════════════════════════════════
   Tour actif — le « mur » visible + l'allonge de mêlée
   Pendant le tour d'un combattant, on trace autour de LUI (pas du token que
   CHACUN contrôle — le MJ, en particulier, ne contrôle presque jamais le
   token du joueur dont c'est le tour) sa réserve de déplacement restante et
   son allonge de mêlée, avec les cibles à portée surlignées. Affiché pour
   tout le monde, sans sélection ni survol requis, pour que joueurs et MJ
   puissent tous deux planifier un déplacement qui évite les attaques
   d'opportunité. Calque distinct de l'aperçu de portée (survol/épinglage) :
   il suit le combattant actif, pas la sélection locale.
   ══════════════════════════════════════════════════════════════════════════ */

let _moveGfx = null;
// showMovementLimit est async (import dynamique + await) mais appelée à
// CHAQUE frame de refreshToken pendant un glisser : plusieurs appels se
// chevauchent donc dans le temps. Sans ce compteur, un appel plus ANCIEN qui
// termine après un appel plus RÉCENT écrase _moveGfx avec son propre graphique
// périmé — celui du plus récent (déjà posé sur la scène) devient orphelin et
// n'est plus jamais détruit, puisque seul ce que pointe _moveGfx à l'instant T
// est nettoyé. Sur un glisser de plusieurs dizaines de frames, ça empile des
// dizaines de cercles/étiquettes qui ne s'effacent jamais. Chaque appel se
// voit attribuer un numéro de génération ; s'il n'est plus le dernier en date
// à la reprise après l'await, il détruit son propre graphique au lieu de
// l'ajouter à la scène.
let _moveGen = 0;

function _clearMoveLimit() {
  try { _moveGfx?.destroy({ children: true }); } catch { /* ignore */ }
  _moveGfx = null;
}

/** Token canvas du combattant dont c'est le tour, ou null. */
function activeCombatantToken() {
  const combat = game.combat;
  if (!combat?.active || !combat.started) return null;
  const combatant = combat.combatant;
  return combatant?.token?.object
      ?? (combatant?.tokenId ? canvas?.tokens?.get(combatant.tokenId) : null);
}

/**
 * Trace, autour du token donné, sa réserve de déplacement restante ET son
 * allonge de mêlée — mais seulement si CE token est bien le combattant actif
 * (sinon la réserve de déplacement n'a pas de sens : on ne peut se déplacer
 * que pendant son propre tour).
 */
export async function showMovementLimit(token) {
  _clearMoveLimit();
  const gen = ++_moveGen;
  if (!token?.actor || !canvas?.ready) return;

  const combat = game.combat;
  if (!combat?.active || !combat.started) return;

  const cbt = combat.combatants.find(c => c.tokenId === token.id);
  if (!cbt) return;
  if (combat.combatant?.id !== cbt.id) return;   // seulement pendant son tour

  const cx = token.center.x, cy = token.center.y;
  const g = new PIXI.Graphics();
  let drewSomething = false;

  // ── Allonge de mêlée du combattant actif, ennemis à portée surlignés ────
  // Le tracé part du carré du socle (pas de son centre) : sinon un monstre
  // de grande taille menace en réalité bien plus loin que ce que le tracé
  // ne laisse paraître, et un joueur ne peut pas dire à l'œil quand son
  // propre token entre dans la zone.
  const reach = getMeleeReach(token.actor);
  if (reach > 0) {
    // Le tracé part du carré du token (bord à bord) et le libellé affiche
    // l'allonge brute de l'arme — celle de la fiche : les deux disent la même
    // chose, « autant de mètres au-delà de mon carré ».
    drawRing(g, token, { min: 0, max: reach, color: COLORS.melee, label: `⚔ ${fmtM(reach)}` });
    drewSomething = true;
    highlightEnemiesInRange(g, token, [{ min: 0, max: reach }]);
  }

  // ── Réserve de déplacement restante ─────────────────────────────────────
  // Réservé au MJ (qui voit tout) et au(x) joueur(s) propriétaire(s) du
  // token actif : un joueur ne doit pas voir combien de déplacement il
  // reste à un autre joueur ou à un monstre — seulement le sien. L'allonge
  // de mêlée ci-dessus, elle, reste visible de tous : c'est un avertissement
  // de menace (attaque d'opportunité), pas une info privée du combattant actif.
  if (game.user.isGM || token.actor.isOwner) {
    let remaining = 0;
    try {
      const { getBudget, movementRemaining } = await import("./action-budget.js");
      const vitesse = Number(token.actor.system?.deplacement?.vitesse ?? BASE_VITESSE) || BASE_VITESSE;
      remaining = movementRemaining(getBudget(combat, cbt.id), vitesse);
    } catch (e) {
      console.warn("[RPG] réserve de déplacement :", e);
    }
    if (remaining > 0) {
      const r = metersToPixels(remaining);
      g.lineStyle(2, 0x4ec48a, 0.85);
      g.beginFill(0x4ec48a, 0.05);
      g.drawCircle(cx, cy, r);
      g.endFill();
      drewSomething = true;

      try {
        const style = new PIXI.TextStyle({
          fontFamily: "Signika, sans-serif", fontSize: 15, fontWeight: "700",
          fill: "#9ff0c4", stroke: "#000000", strokeThickness: 4
        });
        const t = new PIXI.Text(`🏃 ${fmtM(remaining)} restants`, style);
        t.anchor.set(0.5, 0);
        t.position.set(cx, cy + r + 4);
        g.addChild(t);
      } catch { /* étiquette optionnelle */ }
    }
  }

  if (!drewSomething || gen !== _moveGen) {
    try { g.destroy({ children: true }); } catch { /* ignore */ }
    return;
  }

  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
  _moveGfx = g;
}

/** Rafraîchit l'affichage pour le combattant dont c'est le tour. */
export function refreshMovementLimit() {
  const token = activeCombatantToken();
  if (token) showMovementLimit(token);
  else _clearMoveLimit();
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

/* ══════════════════════════════════════════════════════════════════════════
   Indicateur de danger pendant le glisser
   Pendant qu'un joueur fait glisser son token, il ne voit sinon aucun signal
   au moment précis où il entre dans l'allonge d'un ennemi, ni de celui où sa
   propre allonge atteint enfin sa cible — seul un survol (immobile) déclenchait
   l'affichage des portées. Calque séparé de celui du survol/épinglage : on ne
   veut pas effacer une portée épinglée pendant le drag, ni la faire réapparaître
   décalée après.
   ══════════════════════════════════════════════════════════════════════════ */

let _dragGfx = null;

function _clearDragThreat() {
  try { _dragGfx?.destroy({ children: true }); } catch { /* ignore */ }
  _dragGfx = null;
}

/**
 * Redessine, à la position courante d'un token en train d'être déplacé, les
 * DEUX allonges qui décident de ce qui va se passer en arrivant :
 *
 *   - celle des ennemis proches (rouge), qui vire au rouge vif avec un
 *     avertissement dès que le corps du token entre dedans — c'est l'attaque
 *     d'opportunité qui se déclenchera ;
 *   - la SIENNE (bleu), avec les ennemis qu'elle atteint entourés d'or —
 *     c'est ce qu'il pourra frapper une fois posé.
 *
 * Les deux se lisent en même temps : « j'entre dans sa portée » et « il entre
 * dans la mienne » ne se produisent pas au même moment quand les allonges
 * diffèrent, et c'est précisément l'arbitrage que le joueur doit faire pendant
 * qu'il déplace son token — pas après l'avoir posé.
 *
 * @param {Token} draggedToken - l'aperçu suivi par la souris (position live)
 * @returns {boolean} vrai si le token est actuellement engagé par au moins un ennemi
 */
export function updateDragThreatIndicator(draggedToken) {
  _clearDragThreat();
  if (!draggedToken?.actor || !canvas?.ready) return false;

  const cx = draggedToken.center.x, cy = draggedToken.center.y;
  const g = new PIXI.Graphics();
  let inDanger = false;

  // ── Ma propre allonge : ce que j'atteindrai en me posant ici ─────────────
  // Dessinée en premier pour rester SOUS les zones ennemies : c'est
  // l'avertissement rouge qui doit rester lisible en cas de superposition.
  const myReach = getMeleeReach(draggedToken.actor);
  if (myReach > 0) {
    const reachable = [];
    try {
      for (const other of canvas.tokens?.placeables ?? []) {
        if (other === draggedToken || other.id === draggedToken.id || !other.actor) continue;
        if (!areOpposedDisp(draggedToken.document?.disposition, other.document?.disposition)) continue;
        if (checkRange(draggedToken, other, 0, myReach).ok) reachable.push(other);
      }
    } catch { /* portée personnelle optionnelle */ }

    drawRing(g, draggedToken, {
      min: 0, max: myReach,
      color: COLORS.mine,
      alpha: reachable.length ? 1 : 0.5,
      labelBelow: true,
      labelColor: reachable.length ? "#9fe4ff" : "#ffffff",
      label: reachable.length
        ? `⚔ Mon allonge ${fmtM(myReach)} — ${reachable.length > 1
            ? `${reachable.length} cibles atteintes` : "cible atteinte"}`
        : `⚔ Mon allonge ${fmtM(myReach)}`
    });

    // Le carré des cibles atteintes, même repère visuel qu'au survol : c'est
    // ce carré que ma zone doit toucher, pas leur centre qui doit y entrer.
    highlightEnemiesInRange(g, draggedToken, [{ min: 0, max: myReach }]);
  }

  for (const other of canvas.tokens?.placeables ?? []) {
    if (other === draggedToken || !other.actor) continue;
    if (other.id === draggedToken.id) continue;
    if (!areOpposedDisp(draggedToken.document?.disposition, other.document?.disposition)) continue;
    const reach = getMeleeReach(other.actor);
    if (!(reach > 0)) continue;

    // Même prédicat que le désengagement et la déclaration d'attaque : c'est
    // le seul moyen que l'avertissement « DANGER » corresponde à l'attaque
    // d'opportunité qui va réellement se déclencher.
    const engaged = checkRange(draggedToken, other, 0, reach).ok;
    if (engaged) inDanger = true;

    drawRing(g, other, {
      min: 0, max: reach,
      color: engaged ? 0xff2b2b : COLORS.melee,
      alpha: engaged ? 1 : 0.55,
      // Libellé = allonge brute de la fiche, jamais le rayon dessiné.
      label: `⚔ ${fmtM(reach)}${engaged ? " — DANGER" : ""}`
    });
  }

  if (inDanger) {
    const r = Math.max(draggedToken.w, draggedToken.h) * 0.55;
    g.lineStyle(4, 0xff2b2b, 1);
    g.drawCircle(cx, cy, r);
    try {
      const style = new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif", fontSize: 16, fontWeight: "700",
        fill: "#ff5c52", stroke: "#000000", strokeThickness: 4
      });
      const t = new PIXI.Text("⚠️ Allonge ennemie !", style);
      t.anchor.set(0.5, 1);
      t.position.set(cx, cy - r - 6);
      g.addChild(t);
    } catch { /* étiquette optionnelle */ }
  }

  // ── Auras : entrée dans le rayon d'une aura, alliée OU ennemie ───────────
  // Contrairement à l'allonge ci-dessus, une aura affecte quiconque entre
  // dans son rayon indépendamment du camp (soin de zone allié comme brûlure
  // ennemie) — pas de filtre de disposition ici. Cercle + étiquette sous le
  // token, dans la couleur propre de l'aura (jamais le rouge "danger" de
  // l'allonge, réservé aux ennemis).
  const enteredAuras = [];
  try {
    for (const other of canvas.tokens?.placeables ?? []) {
      if (other === draggedToken || !other.actor) continue;
      for (const aura of RPG_AURA_RENDER.aurasOnToken(other)) {
        const maxPx = metersToPixels(aura.max);
        if (!(maxPx > 0)) continue;
        const dist = Math.hypot(cx - other.center.x, cy - other.center.y);
        if (dist <= maxPx + 1 && !enteredAuras.some(a => a.label === aura.label)) {
          enteredAuras.push(aura);
        }
      }
    }
  } catch { /* indicateur optionnel */ }

  if (enteredAuras.length) {
    const r = Math.max(draggedToken.w, draggedToken.h) * 0.55 + (inDanger ? 10 : 0);
    for (const aura of enteredAuras) {
      g.lineStyle(3, aura.color ?? 0x6ec4a8, 0.9);
      g.drawCircle(cx, cy, r);
    }
    try {
      const style = new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif", fontSize: 14, fontWeight: "700",
        fill: "#9ff0e0", stroke: "#000000", strokeThickness: 4
      });
      const names = enteredAuras.map(a => (a.label ?? "Aura").split(" ")[0]).join(" · ");
      const t = new PIXI.Text(`🌀 Entre dans une aura : ${names}`, style);
      t.anchor.set(0.5, 0);
      t.position.set(cx, cy + r + 6);
      g.addChild(t);
    } catch { /* étiquette optionnelle */ }
  }

  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
  _dragGfx = g;
  return inDanger;
}

/** Efface l'indicateur de danger de glisser (fin de drag, dépôt ou annulation). */
export function clearDragThreatIndicator() {
  _clearDragThreat();
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

  // ── Tour actif : mur de déplacement + allonge de mêlée ───────────────────
  // Suit le COMBATTANT ACTIF, pas la sélection locale — sinon le MJ (qui ne
  // contrôle presque jamais le token du joueur dont c'est le tour) ne voit
  // jamais rien. Affiché pour tout le monde dès que le tour change, et remis
  // à jour après chaque déplacement pour que le cercle suive ce qu'il reste.
  Hooks.on("updateToken", () => setTimeout(() => refreshMovementLimit(), 80));
  Hooks.on("updateCombat", () => setTimeout(() => refreshMovementLimit(), 80));
  Hooks.on("deleteCombat", () => _clearMoveLimit());
  Hooks.on("canvasReady", () => setTimeout(() => refreshMovementLimit(), 150));

  // "updateToken" ne se déclenche qu'à la VALIDATION d'un déplacement (dépôt
  // du glisser) : pendant le glisser lui-même, ce cercle restait donc figé à
  // la position de départ du tour, contrairement à l'aura (aura-render.js)
  // qui, elle, suit déjà "refreshToken" — le hook de rendu PIXI qui se
  // redéclenche à CHAQUE frame où le token bouge visuellement, glisser
  // compris. On ne redessine que si le token rafraîchi est bien le
  // combattant actif (sinon showMovementLimit() se no-op de toute façon,
  // mais autant éviter l'appel async pour chaque token survolé/animé).
  Hooks.on("refreshToken", (token) => {
    if (token?.id === activeCombatantToken()?.id) showMovementLimit(token);
  });

  // Suppression du token du combattant actif (ou du combattant lui-même,
  // retiré du tracker sans supprimer le token) : rien ne redessinait/effaçait
  // le cercle de déplacement dans ce cas — activeCombatantToken() ne renvoie
  // plus rien après coup, mais encore fallait-il appeler refreshMovementLimit()
  // pour que ça se traduise par un _clearMoveLimit(). Le cercle restait donc
  // affiché indéfiniment sur la carte après suppression du token.
  Hooks.on("deleteToken", () => setTimeout(() => refreshMovementLimit(), 80));
  Hooks.on("deleteCombatant", () => setTimeout(() => refreshMovementLimit(), 80));

  // Suit le token épinglé quand il bouge / change d'équipement
  Hooks.on("updateToken", (doc) => {
    if (_pinnedTokenId === doc.id) setTimeout(() => refreshPinned(), 60);
  });
  Hooks.on("updateActor", () => refreshPinned());
  Hooks.on("deleteToken", (doc) => {
    if (_pinnedTokenId === doc.id) { _pinnedTokenId = null; _clear(); }
  });
  Hooks.on("canvasTearDown", () => { _pinnedTokenId = null; _clear(); _clearMoveLimit(); });
}
