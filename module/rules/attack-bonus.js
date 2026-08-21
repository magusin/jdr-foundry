// module/rules/attack-bonus.js
//
// Bonus de dégâts accordés par un état actif — « Lames aiguisées »,
// « Arme enflammée », « Poignards équilibrés ».
//
// Un effet de sort peut ajouter des dégâts aux attaques de son porteur. Trois
// formes, cumulables sur le même effet : une part FIXE, des DÉS
// supplémentaires, et un POURCENTAGE des dégâts bruts. Trois choses décident
// à quelles attaques il s'applique :
//
//   • la portée      — attaques d'arme, sorts, ou les deux ;
//   • la catégorie   — mêlée, jet, tir (armes seulement ; vide = toutes) ;
//   • le type ajouté — vide : les dégâts ajoutés sont de la même nature que
//                      l'attaque ; sinon ils forment leur PROPRE ligne, avec
//                      sa livraison et son élément.
//
// Ce dernier point est le seul qui ne soit pas cosmétique. « +1d6 de feu sur
// tes coups d'épée » n'est pas « +1d6 dégâts » : la part de feu est encaissée
// par la résistance au FEU de la cible et non par son armure, ce qui la rend
// terrible contre un golem de pierre et inutile contre un élémentaire de feu.
// Une ligne à part est donc mitigée à part — exactement comme une ligne de
// dégâts d'un sort (voir computeFinalDamage dans combat.js).
//
// Rien ici ne s'applique tout seul : les points d'application sont
// `RPGItem#rollDamage` (armes), `RPGItem#_rollSpellDamage` (compétences de
// monstre) et la résolution d'un sort (spells.js). Un nouveau chemin de
// dégâts doit appeler `collectAttackBonuses` ou il n'aura simplement pas les
// bonus — même règle que pour les résistances élémentaires.

import { DAMAGE_TYPES, damageTypeLabel } from "./damage-types.js";
import { effectiveStates } from "./loadout.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Catégories d'arme.
 *
 * Elles existent pour que « +2 aux couteaux de jet » ne s'applique pas à
 * l'épée. Deviner la catégorie d'après la portée (allonge vs range.max) était
 * la solution sans champ : elle se trompe sur la première arme de mêlée à
 * longue allonge, et personne ne comprend pourquoi. Le MJ le dit, une fois.
 */
export const WEAPON_CATEGORIES = {
  melee: "Mêlée",
  jet:   "Jet",
  tir:   "Tir"
};

/** Catégorie d'une arme (défaut : mêlée — la grande majorité de l'arsenal). */
export function weaponCategory(weapon) {
  const c = String(weapon?.system?.categorie ?? "").trim();
  return WEAPON_CATEGORIES[c] ? c : "melee";
}

/** Portées d'un bonus. */
export const BONUS_SCOPES = {
  arme:   "Attaques d'arme",
  sort:   "Sorts",
  toutes: "Armes et sorts"
};

/**
 * Déclencheurs d'un état accordé à l'attaque. Mêmes clés et même sens que le
 * `when` des effets d'une arme (`weapon.system.effects[]`, voir
 * applyWeaponEffects dans attack-resolve.js) — les deux sources aboutissent
 * au même poseur d'état, elles ne peuvent pas parler deux langues.
 */
export const BONUS_FX_WHEN = {
  hit:     "⚡ Touche + crit",
  hitonly: "⚡ Touche normale",
  crit:    "✦ Critique seulement"
};

/**
 * État posé sur la CIBLE quand l'attaque porte — « ta lame empoisonne ».
 *
 * C'est le seul champ du bonus qui ne parle pas de dégâts. Il existe parce
 * qu'un bonus d'attaque ne pouvait transporter QUE des dégâts : « +1d4 de
 * terre » se lisait comme du poison sans jamais en poser un, et la seule
 * façon d'empoisonner était d'écrire l'effet sur l'arme elle-même
 * (`weapon.system.effects[]`) — donc impossible à accorder par un sort.
 *
 * Le DOT reprend exactement la forme d'un effet d'arme, scaling compris
 * (`base + stat ÷ per`), parce que c'est la seule structure du système qui
 * sache déjà faire monter un état avec une caractéristique du porteur : les
 * `mods` d'un effet de sort, eux, sont plats ou en pourcentage et n'ont
 * aucun scaling.
 */
function normalizeBonusEffect(raw) {
  if (!raw || typeof raw !== "object") return null;
  const label = String(raw.label ?? "").trim();
  // Sans nom, l'état serait illisible sur la fiche de la cible — et un état
  // qu'on ne sait pas nommer est un état qu'on ne saura pas retirer.
  if (!label) return null;

  const whenRaw = String(raw.when ?? "hit").toLowerCase();
  const modeRaw = String(raw.dot?.mode ?? "none").toLowerCase();

  return {
    label,
    when: BONUS_FX_WHEN[whenRaw] ? whenRaw : "hit",
    duration: Math.max(1, n(raw.duration, 1)),
    // 0 = l'état n'est retirable par aucun jet. C'est volontairement le
    // défaut côté buff « indéboulonnable », mais c'est aussi le piège côté
    // malus : removableStates() (remove-state.js) ne propose que les états
    // portant un TN, donc un poison à 0 ne se soigne jamais.
    removeBaseTN: Math.max(0, n(raw.removeBaseTN, 0)),
    tag: DAMAGE_TYPES[String(raw.tag ?? "")] ? String(raw.tag) : "",
    dot: {
      mode: ["damage", "heal", "none"].includes(modeRaw) ? modeRaw : "none",
      base: Math.max(0, n(raw.dot?.base, 0)),
      stat: String(raw.dot?.stat ?? "").trim(),
      per:  Math.max(1, n(raw.dot?.per, 10) || 10)
    }
  };
}

/** Normalise une entrée de bonus, quelle que soit sa provenance. */
export function normalizeAttackBonus(raw) {
  if (!raw || typeof raw !== "object") return null;
  const scope = BONUS_SCOPES[String(raw.scope ?? "")] ? String(raw.scope) : "arme";
  const cats = (Array.isArray(raw.categories) ? raw.categories : [])
    .map(c => String(c))
    .filter(c => WEAPON_CATEGORIES[c]);
  const out = {
    scope,
    categories: cats,
    flat: n(raw.flat, 0),
    pct:  n(raw.pct, 0),
    dice: String(raw.dice ?? "").trim(),
    // "" = les dégâts ajoutés suivent la nature de l'attaque.
    livraison: (raw.livraison === "physique" || raw.livraison === "magique") ? raw.livraison : "",
    tag: DAMAGE_TYPES[String(raw.tag ?? "")] ? String(raw.tag) : "",
    // État posé sur la cible touchée. null = ce bonus n'ajoute que des dégâts.
    effect: normalizeBonusEffect(raw.effect)
  };
  // Un bonus qui n'ajoute rien n'est pas un bonus : le laisser passer
  // remplirait le chat d'une ligne « +0 ». Un bonus qui ne pose QU'UN ÉTAT
  // est en revanche parfaitement valide — c'est même le cas d'usage type
  // (« tes coups empoisonnent », sans un point de dégât supplémentaire).
  if (!out.flat && !out.pct && !out.dice && !out.effect) return null;
  return out;
}

/** Ce bonus s'applique-t-il à CETTE attaque ? */
function matches(bonus, { kind, weapon }) {
  if (!bonus) return false;
  const wantsWeapon = bonus.scope === "arme" || bonus.scope === "toutes";
  const wantsSpell  = bonus.scope === "sort" || bonus.scope === "toutes";
  if (kind === "arme" && !wantsWeapon) return false;
  if (kind === "sort" && !wantsSpell) return false;
  // La catégorie ne filtre que les armes : un sort n'en a pas, et lui
  // appliquer le filtre ferait taire tout bonus « toutes » restreint aux
  // couteaux de jet alors qu'il vise justement aussi les sorts.
  if (kind === "arme" && bonus.categories.length) {
    if (!bonus.categories.includes(weaponCategory(weapon))) return false;
  }
  return true;
}

/**
 * Tous les bonus d'un acteur applicables à une attaque donnée.
 *
 * @param {Actor} actor
 * @param {{kind: "arme"|"sort", weapon?: Item}} ctx
 * @returns {{entries: Array, flatSame: number, pct: number, own: Array}}
 *   - `entries` : tout ce qui s'applique, pour l'affichage ;
 *   - `flatSame`: part fixe qui rejoint les dégâts de l'attaque elle-même ;
 *   - `pct`     : pourcentage cumulé, appliqué au brut de l'attaque ;
 *   - `own`     : lignes à mitiger séparément (elles ont leur propre type).
 */
export function collectAttackBonuses(actor, { kind = "arme", weapon = null } = {}) {
  const out = { entries: [], flatSame: 0, pct: 0, own: [], sameDice: [] };
  // effectiveStates : les états posés PLUS ceux du passif porté, qui ne sont
  // écrits nulle part (loadout.js). Sans eux, un passif « tes coups
  // enflamment » se saisissait sur la fiche et n'ajoutait rien du tout.
  for (const st of effectiveStates(actor)) {
    const bonus = normalizeAttackBonus(st?.attackBonus);
    if (!bonus || !matches(bonus, { kind, weapon })) continue;
    const label = String(st?.label ?? "Bonus");
    const entry = { ...bonus, label };
    out.entries.push(entry);

    // Un type propre (livraison et/ou élément) ⇒ ligne séparée. Sinon la part
    // fixe et les dés rejoignent le coup lui-même.
    if (bonus.livraison || bonus.tag) {
      out.own.push(entry);
    } else {
      out.flatSame += bonus.flat;
      if (bonus.dice) out.sameDice.push({ dice: bonus.dice, label });
    }
    // Le pourcentage porte toujours sur le brut de l'attaque : le rattacher à
    // une ligne séparée n'aurait aucun sens (il n'a pas de dés à lui).
    out.pct += bonus.pct;
  }
  return out;
}

/** Y a-t-il quoi que ce soit à appliquer ? */
export function hasAttackBonus(b) {
  return !!(b && (b.flatSame || b.pct || b.own.length || b.sameDice.length));
}

/**
 * États que les bonus actifs posent sur la cible de CETTE attaque.
 *
 * Volontairement séparé de `collectAttackBonuses` : les dégâts sont lus à
 * plusieurs endroits et à des moments différents (le jet du joueur, la
 * résolution d'un sort, la fiche qui affiche un aperçu), alors qu'un état ne
 * se pose qu'une fois, sur une touche que le MJ a validée. Les mélanger
 * aurait fait poser l'état à chaque endroit qui voulait simplement connaître
 * les dégâts.
 *
 * Le filtre de déclenchement est le même que celui des effets d'arme : un
 * critique déclenche aussi ce qui est réglé sur « touche », mais pas ce qui
 * est réservé à la touche normale.
 *
 * @returns {Array<{effect: object, label: string, stateId: string}>}
 */
export function collectAttackBonusEffects(actor, { kind = "arme", weapon = null, isCrit = false } = {}) {
  const allowed = isCrit ? ["hit", "crit"] : ["hit", "hitonly"];
  const out = [];
  for (const st of effectiveStates(actor)) {
    const bonus = normalizeAttackBonus(st?.attackBonus);
    if (!bonus?.effect) continue;
    if (!matches(bonus, { kind, weapon })) continue;
    if (!allowed.includes(bonus.effect.when)) continue;
    out.push({
      effect: bonus.effect,
      label: String(st?.label ?? "Bonus"),
      // Identifie l'état SOURCE (le buff du porteur), pas l'état posé : c'est
      // lui qui doit rendre le poison rafraîchissable plutôt qu'empilable
      // quand la même lame frappe deux fois la même cible.
      stateId: String(st?.id ?? bonus.effect.label)
    });
  }
  return out;
}

/**
 * Texte d'une entrée de bonus, unique formateur.
 *
 * Toutes les surfaces passent par lui — fiche de sort, résumé d'état sur la
 * fiche de personnage, chat — pour qu'un bonus se lise pareil partout.
 */
export function attackBonusText(bonus) {
  const b = normalizeAttackBonus(bonus);
  if (!b) return "";
  const parts = [];
  if (b.dice) parts.push(`+${b.dice}`);
  if (b.flat) parts.push(`${b.flat > 0 ? "+" : "−"}${Math.abs(b.flat)}`);
  if (b.pct)  parts.push(`${b.pct > 0 ? "+" : "−"}${Math.abs(b.pct)} %`);

  const type = [];
  if (b.livraison) type.push(b.livraison === "physique" ? "physique" : "magique");
  if (b.tag) type.push(damageTypeLabel(b.tag));
  const typeTxt = type.length ? ` de ${type.join(" ")}` : "";

  const cible = b.scope === "sort" ? "aux sorts"
    : b.categories.length
      ? `aux armes de ${b.categories.map(c => WEAPON_CATEGORIES[c].toLowerCase()).join(" / ")}`
      : (b.scope === "toutes" ? "aux armes et aux sorts" : "aux attaques d'arme");

  const dmgTxt = parts.length ? `${parts.join(" ")}${typeTxt} ` : "";

  // L'état accordé fait partie de ce qu'un joueur doit lire sur son buff :
  // sans lui, « ⚔️ aux attaques d'arme » ne dit rien d'un bonus qui n'ajoute
  // aucun dégât et ne fait qu'empoisonner.
  const fx = b.effect;
  const fxTxt = fx
    ? ` · pose « ${fx.label} » ${fx.duration} tour(s)`
      + (fx.dot.mode === "damage" ? ` (${fx.dot.base}${fx.dot.stat ? `+${fx.dot.stat}÷${fx.dot.per}` : ""}/tour)`
       : fx.dot.mode === "heal"   ? ` (${fx.dot.base}${fx.dot.stat ? `+${fx.dot.stat}÷${fx.dot.per}` : ""} soin/tour)` : "")
      + (fx.when === "crit" ? " — crit seulement" : fx.when === "hitonly" ? " — touche normale" : "")
    : "";

  return `⚔️ ${dmgTxt}${cible}${fxTxt}`;
}

/**
 * Lance les dés d'un bonus et rend ce qu'il ajoute.
 *
 * Les dés sont lancés VISIBLEMENT, un message par dé, comme tous les autres
 * jets du système : un bonus qui s'ajoute en silence est indiscernable d'un
 * bug de calcul.
 *
 * @returns {Promise<{same: number, blocks: Array}>} `same` rejoint le brut de
 *   l'attaque ; chaque bloc de `blocks` porte son propre type et doit être
 *   mitigé à part par l'appelant.
 */
export async function rollAttackBonuses(actor, { kind = "arme", weapon = null, rawBase = 0, speaker = null } = {}) {
  const col = collectAttackBonuses(actor, { kind, weapon });
  if (!hasAttackBonus(col)) return { same: 0, blocks: [], entries: [] };

  const spk = speaker ?? ChatMessage.getSpeaker({ actor });
  let same = col.flatSame;

  for (const d of col.sameDice) {
    const roll = await (new Roll(d.dice)).evaluate();
    await roll.toMessage({ speaker: spk, flavor: `✨ ${d.label} — dégâts bonus (${d.dice})` });
    same += roll.total;
  }

  // Pourcentage : sur le brut de l'attaque, arrondi à l'entier inférieur —
  // même arrondi que partout ailleurs pour un bonus.
  if (col.pct) same += Math.floor(n(rawBase, 0) * col.pct / 100);

  const blocks = [];
  for (const e of col.own) {
    let amount = e.flat;
    if (e.dice) {
      const roll = await (new Roll(e.dice)).evaluate();
      await roll.toMessage({
        speaker: spk,
        flavor: `✨ ${e.label} — dégâts bonus ${e.tag ? damageTypeLabel(e.tag) : (e.livraison || "")} (${e.dice})`
      });
      amount += roll.total;
    }
    if (!amount) continue;
    blocks.push({ label: e.label, amount, livraison: e.livraison || null, tag: e.tag || null });
  }

  return { same, blocks, entries: col.entries };
}
