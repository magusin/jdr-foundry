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
    tag: DAMAGE_TYPES[String(raw.tag ?? "")] ? String(raw.tag) : ""
  };
  // Un bonus qui n'ajoute rien n'est pas un bonus : le laisser passer
  // remplirait le chat d'une ligne « +0 ».
  if (!out.flat && !out.pct && !out.dice) return null;
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
  for (const st of (Array.isArray(actor?.system?.etatsActifs) ? actor.system.etatsActifs : [])) {
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

  return `⚔️ ${parts.join(" ")}${typeTxt} ${cible}`;
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
