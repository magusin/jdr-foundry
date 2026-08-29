// module/rules/ammo.js
//
// Munitions d'une arme de tir / de jet — flèches, carreaux, billes, javelots.
//
// Trois régimes, choisis sur la fiche d'arme (`weapon.system.ammo.mode`) :
//
//   • `none` — l'arme ne consomme rien. C'est tout l'arsenal existant, et le
//     défaut : rien ne change tant que le MJ n'a pas dit le contraire.
//   • `item` — l'arme puise dans le SAC du porteur (un arc et ses flèches).
//   • `self` — l'arme EST le projectile (couteau de jet, javelot) : c'est sa
//     propre quantité qui baisse. Il n'y a rien à désigner, et demander au MJ
//     de créer un objet « javelot » à côté de l'arme « javelot » n'aurait
//     décrit qu'une seule chose en double.
//
// Ce qu'une arme en mode `item` accepte comme munition, c'est une FAMILLE
// (`ammo.kind`, « flèche ») confrontée au champ `system.ammoKind` des objets
// du sac, plus l'objet précis éventuellement déposé sur la fiche. Les deux
// existent pour deux besoins distincts : la famille laisse le JOUEUR choisir
// entre sa flèche ordinaire et sa flèche de feu au moment du tir, la référence
// déposée sert d'unique munition quand le MJ veut fermer le choix. Une arme
// qui ne déclare que l'une des deux fonctionne.
//
// Deux décisions structurent le reste :
//
//   • La munition est reconnue par la MÊME empreinte que le reste du système
//     (`ingredientMatchesItem`, forge.js) : même source de compendium OU même
//     nom. Une variante locale aurait produit le bug classique — une munition
//     comptée comme disponible puis jamais retirée du sac.
//
//   • Le décompte a lieu à la RÉSOLUTION, jamais à la déclaration. Toute
//     dépense du système (fatigue, slot d'action, recharge) est confirmée
//     quand le MJ tranche : un MJ qui refuse la déclaration ne doit pas avoir
//     consommé la flèche. Le contrôle « en ai-je encore ? » et le CHOIX du
//     joueur, eux, vivent à la déclaration — il ne sert à rien d'annoncer un
//     tir qu'on ne peut pas payer, ni de demander au MJ de deviner quelle
//     flèche a été tirée.
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
const norm = (s) => String(s ?? "").trim().toLowerCase();

/** Régimes de munition, tels que la fiche d'arme les propose. */
export const AMMO_MODES = {
  none: "Aucune",
  item: "Un objet du sac (arc, arbalète, fronde)",
  self: "L'arme elle-même (arme de jet)"
};

/**
 * Configuration de munition d'une arme, normalisée.
 *
 * Compatibilité : les premières armes configurées portaient un booléen
 * `enabled` et pas de `mode`. Un `enabled` vrai vaut donc `mode: "item"` —
 * sans quoi elles auraient silencieusement cessé de consommer quoi que ce
 * soit à la première ouverture de leur fiche.
 */
export function ammoRef(weapon) {
  const raw = weapon?.system?.ammo ?? {};
  let mode = String(raw.mode ?? "").trim();
  if (!AMMO_MODES[mode]) mode = raw.enabled ? "item" : "none";

  const ref = {
    mode,
    kind:   String(raw.kind ?? "").trim(),
    name:   String(raw.name ?? "").trim(),
    uuid:   String(raw.uuid ?? "").trim(),
    source: String(raw.source ?? "").trim(),
    img:    String(raw.img ?? "").trim(),
    // Le type mémorisé au dépôt élargit la recherche au-delà de
    // « objet / consommable » : un MJ qui désigne une arme (javelot) aurait
    // sinon une munition introuvable pour toujours, en silence.
    type:   String(raw.type ?? "").trim(),
    perShot: Math.max(1, n(raw.perShot, 1))
  };
  ref.hasRef = !!(ref.name || ref.uuid || ref.source);
  // Un mode `item` sans la moindre désignation (ni famille, ni objet déposé)
  // est INERTE : cocher la case rendrait sinon l'arme définitivement
  // inutilisable, sans rien indiquer de ce qu'il faut mettre dans le sac.
  ref.configured = mode === "self" || (mode === "item" && (ref.hasRef || !!ref.kind));
  return ref;
}

/** L'arme consomme-t-elle une munition ? */
export function usesAmmo(weapon) {
  return ammoRef(weapon).configured;
}

/** Quantité d'une pile (une arme sans quantité écrite vaut 1 exemplaire). */
function stackQty(item, dflt = 1) {
  return Math.max(0, n(item?.system?.qte, dflt));
}

/**
 * Objets du sac utilisables comme munition par cette arme, quantité comprise.
 *
 * L'objet désigné sur la fiche arrive en tête : c'est la munition « par
 * défaut » de l'arme, celle que le joueur tirera sans avoir rien à choisir
 * quand il n'a que celle-là.
 *
 * @returns {Array<{item: Item, qty: number, designated: boolean}>}
 */
export function ammoCandidates(actor, weapon) {
  const ref = ammoRef(weapon);
  if (!ref.configured) return [];

  // Mode `self` : l'arme est sa propre munition, il n'y a rien à chercher.
  if (ref.mode === "self") {
    return weapon ? [{ item: weapon, qty: stackQty(weapon, 1), designated: true }] : [];
  }
  if (!actor?.items) return [];

  const kind = norm(ref.kind);
  const out = [];
  for (const it of actor.items) {
    if (it === weapon) continue;
    const designated = ref.hasRef && ingredientMatchesItem(it, ref);
    const sameKind = !!kind && norm(it.system?.ammoKind) === kind;
    if (!designated && !sameKind) continue;
    const qty = stackQty(it, 1);
    if (qty <= 0) continue;
    out.push({ item: it, qty, designated });
  }
  // Désignée d'abord, puis par nom : l'ordre du sac n'a aucun sens pour un
  // joueur qui choisit dans une liste.
  out.sort((a, b) => (b.designated - a.designated) || String(a.item.name).localeCompare(String(b.item.name)));
  return out;
}

/** Réserve totale, toutes munitions compatibles confondues. */
export function ammoStock(actor, weapon) {
  return ammoCandidates(actor, weapon).reduce((sum, c) => sum + c.qty, 0);
}

/**
 * L'attaque peut-elle être payée ? Synchrone : le menu de combat construit
 * ses lignes sans `await`.
 *
 * `uses: false` = l'arme ne consomme rien ; `ok` vaut alors true, pour que
 * l'appelant écrive `if (!check.ok)` sans se soucier du cas courant.
 */
export function checkAmmo(actor, weapon) {
  const ref = ammoRef(weapon);
  const label = ref.mode === "self" ? String(weapon?.name ?? "Arme")
    : (ref.name || ref.kind || "Munition");
  if (!ref.configured) {
    return { uses: false, ok: true, have: 0, need: 0, label, mode: ref.mode, choices: 0, reason: null };
  }

  const cands = ammoCandidates(actor, weapon);
  const have = cands.reduce((s, c) => s + c.qty, 0);
  const need = ref.perShot;
  const ok = have >= need;
  const what = label.toLowerCase();
  return {
    uses: true, ok, have, need, label, mode: ref.mode, choices: cands.length,
    reason: ok ? null
      : (have <= 0
          ? (ref.mode === "self" ? `Il n'en reste plus à lancer.` : `Plus de ${what} en réserve.`)
          : `Pas assez de ${what} — ${have}/${need}.`)
  };
}

/**
 * Choix de la munition, à la déclaration, sur le client du JOUEUR.
 *
 * Une seule munition compatible (le cas courant) ⇒ aucune fenêtre : demander
 * de confirmer un choix qui n'en est pas un est du bruit. Plusieurs ⇒ le
 * joueur tranche, parce que c'est lui qui sait s'il veut brûler sa flèche de
 * feu sur ce gobelin — et le MJ voit ensuite le choix dans la déclaration.
 *
 * Fermer la fenêtre ANNULE l'attaque (`cancelled`), comme le choix d'arme de
 * `pickAttackWeapon` : retomber sur la première munition déclarerait un tir
 * que le joueur venait de refuser.
 *
 * @returns {Promise<{ok: boolean, uses: boolean, cancelled?: boolean,
 *                     reason?: string, itemId?: string, name?: string}>}
 */
export async function pickAmmo(actor, weapon) {
  const check = checkAmmo(actor, weapon);
  if (!check.uses) return { ok: true, uses: false };
  if (!check.ok) return { ok: false, uses: true, reason: check.reason };

  const cands = ammoCandidates(actor, weapon);
  if (cands.length === 1) {
    return { ok: true, uses: true, itemId: cands[0].item.id, name: cands[0].item.name };
  }

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    // Pas de dialogue disponible : la munition désignée (ou la première)
    // plutôt que rien du tout.
    return { ok: true, uses: true, itemId: cands[0].item.id, name: cands[0].item.name };
  }

  let chosen = null;
  try {
    chosen = await DialogV2.wait({
      window: { title: `Quelle munition pour ${weapon?.name ?? "cette arme"} ?` },
      content: `<p style="margin:0 0 6px">${cands.length} munitions compatibles dans ton sac.</p>`
             + `<p style="margin:0;opacity:.75;font-size:12px">Elle sera retirée du sac à la résolution du tir, pas maintenant.</p>`,
      buttons: cands.map(c => ({
        action: c.item.id,
        label: `${c.item.name} (${c.qty})${c.designated ? " ★" : ""}`
      })),
      rejectClose: false
    });
  } catch (e) {
    console.warn("[RPG] choix de la munition :", e);
    return { ok: false, uses: true, cancelled: true };
  }
  if (!chosen) return { ok: false, uses: true, cancelled: true };

  const pick = cands.find(c => c.item.id === chosen) ?? cands[0];
  return { ok: true, uses: true, itemId: pick.item.id, name: pick.item.name };
}

/**
 * Retire les munitions. Appelée à la résolution, quel que soit le verdict :
 * un carreau parti est parti, qu'il touche ou non.
 *
 * Ne refuse rien — le refus est le travail de `checkAmmo` à la déclaration. Si
 * la réserve a fondu entre les deux (un autre tir est passé, le joueur a jeté
 * ses flèches), on prend ce qui reste et on le dit : annuler une attaque que
 * le MJ vient de valider serait pire.
 *
 * @param {object} [opts.itemId] la munition choisie à la déclaration. Absente
 *   ou disparue, on retombe sur les autres munitions compatibles.
 * @returns {Promise<null|{label, spent, remaining, short}>} null quand l'arme
 *   ne consomme rien — l'appelant n'a alors rien à afficher.
 */
export async function consumeAmmo(actor, weapon, { itemId = null } = {}) {
  const ref = ammoRef(weapon);
  if (!ref.configured || !actor) return null;

  const cands = ammoCandidates(actor, weapon);
  if (!cands.length) {
    return { label: checkAmmo(actor, weapon).label, spent: 0, remaining: 0, short: true };
  }

  // La munition choisie d'abord, le reste ensuite : ce que le joueur a
  // annoncé doit partir en premier, mais un tir validé par le MJ ne doit pas
  // échouer parce que cette pile-là a disparu entre-temps.
  const ordered = [
    ...cands.filter(c => itemId && c.item.id === itemId),
    ...cands.filter(c => !itemId || c.item.id !== itemId)
  ];
  const label = ordered[0].item.name;

  let remaining = ref.perShot;
  const updates = [];
  const deletions = [];

  for (const c of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(c.qty, remaining);
    if (take <= 0) continue;
    remaining -= take;
    const left = c.qty - take;
    // Une ARME lancée n'est jamais supprimée, même à 0 : le jet de dégâts a
    // lieu APRÈS la résolution et retrouve l'arme par son id (rollAttackDamage)
    // — la détruire ici ferait échouer le jet du coup qu'on vient de valider.
    // Elle reste au sac, quantité 0, et la prochaine déclaration est refusée.
    if (left <= 0 && c.item !== weapon) deletions.push(c.item.id);
    else updates.push({ _id: c.item.id, "system.qte": left });
  }

  const spent = ref.perShot - remaining;
  try {
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    if (deletions.length) await actor.deleteEmbeddedDocuments("Item", deletions);
  } catch (e) {
    console.warn("[RPG] munitions non décomptées :", e);
    return null;
  }

  return { label, spent, remaining: ammoStock(actor, weapon), short: remaining > 0 };
}

/** Ligne de chat annonçant la dépense, ou "" si l'arme ne consomme rien. */
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
