// module/rules/ammo.js
//
// Munitions d'une arme de tir / de jet — flèches, carreaux, billes, javelots.
//
// Une arme peut désigner UN objet du sac comme sa munition
// (`weapon.system.ammo`) : tant que la réserve est vide, l'arme ne peut plus
// être déclarée, et chaque tir résolu retire `perShot` unité(s) de la pile.
//
// Deux décisions structurent tout ce fichier :
//
//   • La munition est une RÉFÉRENCE glissée-déposée, pas un nom tapé. Même
//     forme et même empreinte qu'un ingrédient de recette
//     ({name, uuid, source, img, type}) — c'est la même question posée au sac
//     (« cet objet est-il celui que la fiche désigne ? ») et elle doit
//     recevoir la même réponse, sinon une flèche reconnue par le compte
//     affiché serait introuvable au moment de la consommer. On réutilise donc
//     `ingredientMatchesItem` plutôt que d'en écrire une variante.
//
//   • Le décompte a lieu à la RÉSOLUTION, jamais à la déclaration. Toute
//     dépense du système (fatigue, slot d'action, recharge de l'arme) est
//     confirmée quand le MJ tranche, pas quand le joueur annonce : un MJ qui
//     refuse la déclaration ne doit pas avoir consommé la flèche. Le contrôle
//     « en ai-je encore ? », lui, vit à la déclaration — il ne sert à rien
//     d'annoncer un tir qu'on ne peut pas payer.
//
// Le refus est posé dans `declareAttack` (attack-declare.js), point de passage
// obligé des quatre chemins d'attaque (menu de combat, fiche, barre d'actions,
// attaque d'opportunité) — exactement comme la recharge. Le menu de combat et
// l'action de base « Attaquer » le redisent AVANT de réserver le slot, pour
// qu'un refus ne mange pas l'action.
//
// Les macros ne sont pas des modules ES : l'API est exposée sur
// `game.rpg.ammo` (voir init.js).

import { ingredientMatchesItem } from "./forge.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Référence de munition portée par une arme, normalisée.
 *
 * `enabled` seul ne suffit pas : une arme dont la case est cochée mais dont
 * aucun objet n'a été déposé ne consomme rien et ne bloque rien — sans quoi
 * cocher la case rendrait l'arme définitivement inutilisable, sans indiquer
 * quoi mettre dans le sac.
 */
export function ammoRef(weapon) {
  const raw = weapon?.system?.ammo ?? {};
  const ref = {
    enabled: !!raw.enabled,
    name:   String(raw.name ?? "").trim(),
    uuid:   String(raw.uuid ?? "").trim(),
    source: String(raw.source ?? "").trim(),
    img:    String(raw.img ?? "").trim(),
    // Le type mémorisé au dépôt élargit la recherche au-delà de
    // « objet / consommable » : un MJ qui désigne une arme (javelot lancé)
    // aurait sinon une munition introuvable pour toujours, en silence.
    type:   String(raw.type ?? "").trim(),
    perShot: Math.max(1, n(raw.perShot, 1))
  };
  ref.configured = ref.enabled && !!(ref.name || ref.uuid || ref.source);
  return ref;
}

/** L'arme consomme-t-elle une munition ? */
export function usesAmmo(weapon) {
  return ammoRef(weapon).configured;
}

/** Toutes les piles du sac qui satisfont la munition de cette arme. */
function matchingStacks(actor, ref) {
  if (!actor?.items) return [];
  return actor.items.filter(it => ingredientMatchesItem(it, ref));
}

/** Quantité totale en réserve (somme des piles). */
export function ammoStock(actor, weapon) {
  const ref = ammoRef(weapon);
  if (!ref.configured) return 0;
  let total = 0;
  for (const it of matchingStacks(actor, ref)) total += Math.max(0, n(it.system?.qte, 1));
  return total;
}

/**
 * L'attaque peut-elle être payée ?
 *
 * @returns {{uses: boolean, ok: boolean, have: number, need: number,
 *            label: string, reason: string|null}}
 *   `uses: false` = l'arme n'a pas de munition configurée ; `ok` vaut alors
 *   true, pour que l'appelant puisse écrire `if (!check.ok)` sans se soucier
 *   du cas courant (la quasi-totalité de l'arsenal).
 */
export function checkAmmo(actor, weapon) {
  const ref = ammoRef(weapon);
  const label = ref.name || "Munition";
  if (!ref.configured) return { uses: false, ok: true, have: 0, need: 0, label, reason: null };

  const have = ammoStock(actor, weapon);
  const need = ref.perShot;
  const ok = have >= need;
  return {
    uses: true, ok, have, need, label,
    reason: ok ? null
      : (have <= 0 ? `Plus de ${label.toLowerCase()} en réserve.`
                   : `Pas assez de ${label.toLowerCase()} — ${have}/${need}.`)
  };
}

/**
 * Retire les munitions du sac. Appelée à la résolution, quel que soit le
 * verdict : un carreau parti est parti, qu'il touche ou non.
 *
 * Ne refuse rien — le refus est le travail de `checkAmmo` au moment de la
 * déclaration. Si la réserve a fondu entre les deux (le joueur a jeté ses
 * flèches, un autre tir est passé avant), on prend ce qui reste et on le dit :
 * annuler une attaque que le MJ vient de valider serait pire.
 *
 * @returns {Promise<null|{label: string, spent: number, remaining: number, short: boolean}>}
 *   null quand l'arme n'a pas de munition — l'appelant n'a rien à afficher.
 */
export async function consumeAmmo(actor, weapon) {
  const ref = ammoRef(weapon);
  if (!ref.configured || !actor) return null;

  let remaining = ref.perShot;
  const updates = [];
  const deletions = [];

  for (const it of matchingStacks(actor, ref)) {
    if (remaining <= 0) break;
    const stack = Math.max(0, n(it.system?.qte, 1));
    const take = Math.min(stack, remaining);
    if (take <= 0) continue;
    remaining -= take;
    const left = stack - take;
    if (left <= 0) deletions.push(it.id);
    else updates.push({ _id: it.id, "system.qte": left });
  }

  const spent = ref.perShot - remaining;
  try {
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    if (deletions.length) await actor.deleteEmbeddedDocuments("Item", deletions);
  } catch (e) {
    console.warn("[RPG] munitions non décomptées :", e);
    return null;
  }

  return {
    label: ref.name || "Munition",
    spent,
    remaining: ammoStock(actor, weapon),
    short: remaining > 0
  };
}

/** Ligne de chat annonçant la dépense, ou "" si l'arme n'en consomme pas. */
export function ammoSpentLine(info) {
  if (!info) return "";
  // Rien retiré ET réserve à sec : la déclaration était payable, plus la
  // résolution. Le taire ferait passer un tir gratuit pour un tir normal.
  if (!info.spent) {
    return info.short
      ? `<div style="font-size:11px;color:#c0392b;margin-top:2px">🏹 ${info.label} : réserve vide au moment du tir.</div>`
      : "";
  }
  return `<div style="font-size:11px;opacity:.75;margin-top:2px">🏹 ${info.label} : −${info.spent}`
       + ` (${info.remaining} en réserve)${info.short ? " — réserve épuisée" : ""}</div>`;
}
