// module/rules/loadout.js
//
// Les deux EMPLACEMENTS d'un personnage : un Talent, un Passif.
//
// Ce sont deux systèmes distincts qui partagent exactement une règle —
// « un seul à la fois, ou aucun » — et rien d'autre :
//
//   TALENT  Item de type `talent`. Gratuit. Ne fait QUE des mods de stats
//           (les 18 de KEY_TO_BUCKET, initiative comprise, en flat ou en %).
//           Actif en permanence, en combat comme hors combat. En changer
//           pendant un combat coûte une action normale.
//
//   PASSIF  Item de type `spell` dont la Vitesse vaut « Passif ». Actif en
//           permanence lui aussi, mais son `coutMana` est prélevé UNE FOIS,
//           au premier tour de son porteur dans un combat — et de nouveau
//           s'il en change en cours de route (action rapide). Hors combat il
//           tourne gratuitement : le mana est une ressource de combat.
//
// L'emplacement VIDE est un état légitime des deux côtés : ne rien porter
// est un choix (aucun malus subi pour un Talent, aucun mana dépensé pour un
// Passif), pas un oubli à corriger.
//
// ─────────────────────────────────────────────────────────────────────────
// Pourquoi `system.equipe` et pas un nouveau champ
//
// `system.equipe` est déjà dans la liste blanche des écritures joueur
// (`isBookkeeping`/`allowed` dans init.js), donc un joueur peut équiper son
// propre Talent sans qu'on ouvre quoi que ce soit de plus — et rien ne lit
// ce champ sur un `spell` ou un `talent` ailleurs dans le code
// (`sumBonuses`, `estEquip` et `allEquipItems` filtrent tous sur
// weapon/armor/relic). Le champ était donc libre des deux côtés.
//
// L'exclusivité est appliquée par une VRAIE écriture (on déséquipe les
// autres), jamais par une règle d'affichage : deux clients qui équipent en
// même temps doivent converger vers un seul porté, et une liste qui se
// contente de masquer laisserait deux `equipe: true` en base — donc deux
// jeux de bonus cumulés dans prepareDerivedData, silencieusement.

import { normalizeAttackBonus } from "./attack-bonus.js";
import { tickPerTick } from "./effect-tick.js";

const FLAG_SCOPE = "rpg";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/* ------------------------------------------------------------------ */
/* Reconnaissance                                                      */
/* ------------------------------------------------------------------ */

/** Un Talent : item du type dédié. */
export function isTalent(item) {
  return item?.type === "talent";
}

/**
 * Un Passif : sort dont la Vitesse vaut « passif ».
 *
 * `declareSpell` refuse déjà ces items (« toujours actif, pas de
 * déclaration ») — c'est ce qui fait d'eux un emplacement plutôt qu'une
 * action.
 */
export function isPassif(item) {
  return item?.type === "spell" && String(item?.system?.speed ?? "") === "passif";
}

/** Les Talents que l'acteur possède. */
export function talentsOf(actor) {
  return (actor?.items ?? []).filter(isTalent);
}

/** Les Passifs que l'acteur possède. */
export function passifsOf(actor) {
  return (actor?.items ?? []).filter(isPassif);
}

/** Le Talent porté, ou null si l'emplacement est vide. */
export function equippedTalent(actor) {
  return talentsOf(actor).find(it => !!it.system?.equipe) ?? null;
}

/** Le Passif porté, ou null si l'emplacement est vide. */
export function equippedPassif(actor) {
  return passifsOf(actor).find(it => !!it.system?.equipe) ?? null;
}

/* ------------------------------------------------------------------ */
/* Mods d'un talent                                                    */
/* ------------------------------------------------------------------ */

/**
 * Mods normalisés d'un Talent, au format `{stat: {flat, pct}}`.
 *
 * C'est EXACTEMENT la forme que `sumActiveEffectMods` attend d'un état, ce
 * qui est tout l'intérêt du choix de structure : un Talent se branche sur la
 * mécanique de mods déjà en place au lieu d'en réclamer une deuxième, et il
 * hérite donc des 18 stats de KEY_TO_BUCKET (l'initiative en fait partie,
 * contrairement à la grille `equipBonus` d'une armure) et du mode
 * pourcentage.
 */
export function talentMods(item) {
  const out = {};
  for (const m of (Array.isArray(item?.system?.mods) ? item.system.mods : [])) {
    const stat = String(m?.stat ?? "").trim();
    if (!stat) continue;
    const mode = m?.mode === "pct" ? "pct" : "flat";
    const v = n(m?.value, 0);
    if (!v) continue;
    out[stat] = out[stat] ?? { flat: 0, pct: 0 };
    out[stat][mode] += v;
  }
  return out;
}

/**
 * États permanents produits par le Talent PORTÉ, pour sumActiveEffectMods.
 *
 * Rien n'est écrit en base : ces mods sont recalculés à chaque
 * prepareDerivedData, donc ils apparaissent et disparaissent avec
 * l'équipement, sans état à synchroniser ni à nettoyer. Même approche que
 * `passiveSpellStates` pour les sorts passifs, juste à côté.
 */
export function talentStates(actor) {
  const it = equippedTalent(actor);
  if (!it) return [];
  const mods = talentMods(it);
  return Object.keys(mods).length ? [{ mods }] : [];
}

/* ------------------------------------------------------------------ */
/* Équiper / déséquiper                                                */
/* ------------------------------------------------------------------ */

/**
 * Équipe un Talent (ou vide l'emplacement avec `itemId = null`).
 *
 * Écrit tous les changements en UN SEUL updateEmbeddedDocuments : deux
 * updates séparés feraient passer l'acteur par un état intermédiaire à zéro
 * ou à deux talents portés, et `prepareDerivedData` recalcule entre les
 * deux — donc un clignotement des stats, visible sur la fiche.
 */
export async function setEquippedTalent(actor, itemId = null) {
  if (!actor) return null;
  const updates = [];
  let chosen = null;

  for (const it of talentsOf(actor)) {
    const want = !!itemId && it.id === itemId;
    if (want) chosen = it;
    if (!!it.system?.equipe !== want) updates.push({ _id: it.id, "system.equipe": want });
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return chosen;
}

/**
 * Équipe un Passif (ou vide l'emplacement avec `itemId = null`).
 *
 * N'effectue AUCUN prélèvement de mana : le coût dépend du contexte (début
 * de combat, changement en cours de combat, hors combat où c'est gratuit) et
 * appartient donc à l'appelant, pas à l'écriture elle-même. Voir
 * `chargePassif` et `chargePassifOnFirstTurn`.
 */
export async function setEquippedPassif(actor, itemId = null, { force = false } = {}) {
  if (!actor) return null;

  // Un passif encore en recharge ne se reprend pas — c'est tout l'objet de
  // la recharge (voir startPassifCooldown). Le refus ne vaut QU'EN COMBAT,
  // par cohérence avec le mana : hors combat un passif tourne gratuitement,
  // et bloquer un remaniement d'avant-fight sur un décompte qui ne descend
  // qu'aux tours de son porteur l'aurait gelé indéfiniment.
  if (itemId && !force && game.combat?.active) {
    const wanted = actor.items?.get?.(itemId);
    const left = passifCooldownLeft(wanted);
    if (left > 0) {
      ui.notifications?.warn?.(
        `${wanted?.name ?? "Ce passif"} est encore en recharge — ${left} tour(s) à attendre.`);
      return null;
    }
  }

  const updates = [];
  let chosen = null;

  for (const it of passifsOf(actor)) {
    const want = !!itemId && it.id === itemId;
    if (want) chosen = it;
    // `system.aura.active` a longtemps servi de bascule à ces sorts sans
    // qu'aucun calcul ne le lise (le bouton du menu de combat l'écrivait,
    // sumBonuses et passiveSpellStates l'ignoraient : « désactiver » un
    // passif ne retirait donc rien). Il est aligné sur `equipe` pour que les
    // données déjà en base cessent de dire deux choses différentes.
    if (!!it.system?.equipe !== want || it.system?.aura?.active !== want) {
      updates.push({ _id: it.id, "system.equipe": want, "system.aura.active": want });
    }
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return chosen;
}

/**
 * Dépose le Passif porté si l'un de ses effets porte le libellé d'un état
 * qu'on vient de poser sur cet acteur.
 *
 * Un passif n'est PAS un état : `passiveSpellStates` (status-effects.js) en
 * relit les mods à chaque recalcul, sans jamais rien écrire dans
 * `etatsActifs`. Un « Légèreté » posé par le sort d'un autre ne peut donc
 * pas l'écraser comme il écrase un état homonyme — les deux se
 * cumuleraient, l'un visible et l'autre non. La règle de table est que le
 * dernier posé gagne : le passif est donc réellement retiré, et
 * l'emplacement repasse à « Aucun passif » sur la fiche, là où le porteur
 * peut le voir et le reprendre.
 *
 * `force: true` : le retrait ne doit jamais être refusé pour cause de
 * recharge — c'est une dépose, pas une prise.
 *
 * @returns {Promise<string|null>} nom du passif déposé, ou null.
 */
export async function dropPassifOnStateLabel(actor, label) {
  const key = String(label ?? "").trim().toLowerCase();
  if (!actor || !key) return null;

  const worn = equippedPassif(actor);
  if (!worn) return null;

  const fxList = Array.isArray(worn.system?.effectsUI) ? worn.system.effectsUI : [];
  const matching = fxList.filter(fx => String(fx?.label ?? "").trim().toLowerCase() === key);
  if (!matching.length) return null;

  // Un passif qui ÉMET une aura de ce nom n'est pas déposé : son porteur en
  // est la source, pas le bénéficiaire, et l'éteindre priverait aussi tous
  // ses alliés à portée. Deux porteurs de la même aura côte à côte se
  // seraient mutuellement désarmés.
  if (matching.every(fx => !!fx?.isAura)) return null;

  await setEquippedPassif(actor, null, { force: true });
  return worn.name;
}

/* ------------------------------------------------------------------ */
/* Les effets du passif porté, vus comme des états                     */
/* ------------------------------------------------------------------ */

/**
 * États VIRTUELS produits par le passif porté — un par effet secondaire.
 *
 * Rien n'est écrit sur l'acteur : la liste est reconstruite à chaque lecture,
 * donc elle apparaît et disparaît avec l'emplacement, sans état à
 * synchroniser ni à nettoyer. C'est le seul point où l'on décide de ce qu'un
 * passif porté fait réellement.
 *
 * Historiquement, seuls les `mods` en sortaient — et comme les cinq autres
 * champs d'un effet ne sont lus que sur `system.etatsActifs`, tout le reste
 * de l'éditeur d'effets était MUET sur un passif : les dégâts/soin par tour,
 * l'aura, les deux résistances accordées et le bonus de dégâts aux attaques
 * y étaient saisissables et n'allaient nulle part. La forme rendue ici est
 * celle d'un vrai état (spells.js), à ceci près qu'elle n'existe qu'en
 * mémoire ; les lecteurs passent tous par `effectiveStates()`.
 *
 * L'id est déterministe (`passif_<item>_<effet>`) : il sert de clé aux copies
 * d'aura et aux états posés par un bonus d'attaque, qui doivent se
 * rafraîchir plutôt que s'empiler.
 */
/**
 * Le repli « aucun passif marqué porté ⇒ tous comptent » s'applique-t-il ?
 *
 * Il existait pour ne pas priver de leurs bonus les données antérieures à
 * l'emplacement. Le problème est qu'il ne s'éteint jamais : choisir
 * « — Aucun passif — » revenait à les rallumer TOUS, et déposer son unique
 * passif à le garder actif indéfiniment. L'onglet Talents affiche pourtant
 * « — Aucun passif — porté », donc l'écran disait exactement le contraire de
 * ce que la fiche calculait.
 *
 * Le repli ne vaut donc plus que là où aucune interface ne permet de choisir :
 * un MONSTRE n'a pas d'onglet Talents, ses capacités passives seraient
 * devenues impossibles à activer. Un personnage, lui, a l'emplacement sous
 * les yeux — au prix d'un clic pour rééquiper ce qu'il portait.
 */
export function passifFallbackAllowed(actor) {
  return actor?.type !== "character";
}

export function passifStates(actor) {
  const out = [];
  if (!actor) return out;

  // Un seul passif porté à la fois, ou aucun — voir passifFallbackAllowed
  // pour le seul cas où « aucun » veut encore dire « tous ».
  const worn = equippedPassif(actor);
  const fallback = !worn && passifFallbackAllowed(actor);
  const effP = actor.system?.derived?.effective?.principales
            ?? actor.system?.principales ?? {};

  for (const it of (actor.items ?? [])) {
    if (!isPassif(it)) continue;
    if (!worn && !fallback) continue;
    if (worn && it.id !== worn.id) continue;

    const fxList = Array.isArray(it.system?.effectsUI) ? it.system.effectsUI : [];
    fxList.forEach((fx, i) => {
      const mods = {};
      for (const m of (Array.isArray(fx?.mods) ? fx.mods : [])) {
        const stat = String(m?.stat ?? "").trim();
        if (!stat) continue;
        const mode = m?.mode === "pct" ? "pct" : "flat";
        mods[stat] = mods[stat] ?? { flat: 0, pct: 0 };
        mods[stat][mode] += Number(m?.value) || 0;
      }
      if (fx?.movementTypeGrant) mods.movementTypeGrant = fx.movementTypeGrant;

      const perTick = tickPerTick(fx, effP);
      const isAura = !!fx?.isAura;

      const st = {
        id: `passif_${it.id}_${fx?.id ?? i}`,
        label: String(fx?.label ?? it.name ?? "Passif"),
        type: "passifEffect",
        sourceLabel: it.name ?? "",
        tag: String(fx?.tag ?? "").trim() || null,
        effectKey: String(fx?.effectKey ?? "").trim() || null,
        isAura,
        permanent: true,
        duration: 0,
        remaining: 0,
        dot: {
          flat: perTick, perTick,
          formula: String(fx?.damage?.dice ?? "").trim(),
          fatiguePerTick: Number(fx?.fatigueDot) || 0
        },
        mods,
        resistance: {
          tag: String(fx?.resistTag ?? "").trim() || null,
          durationReduction: Number(fx?.resistDurationReduction) || 0,
          dotReductionPct: Number(fx?.resistDotPct) || 0,
          immune: !!fx?.resistImmune
        },
        resistanceDamage: {
          tag: String(fx?.resistDamageTag ?? "").trim() || null,
          pct: Number(fx?.resistDamagePct) || 0
        },
        attackBonus: normalizeAttackBonus({
          scope: fx?.atkScope, categories: fx?.atkCategories,
          flat: fx?.atkFlat, pct: fx?.atkPct, dice: fx?.atkDice,
          livraison: fx?.atkLivraison, tag: fx?.atkTag,
          effect: {
            label: fx?.atkFxLabel, when: fx?.atkFxWhen,
            duration: fx?.atkFxDuration, removeBaseTN: fx?.atkFxRemoveTN,
            tag: fx?.atkFxTag,
            dot: {
              mode: fx?.atkFxDotMode, base: fx?.atkFxDotBase,
              stat: fx?.atkFxDotStat, per: fx?.atkFxDotPer
            }
          }
        })
      };

      if (isAura) {
        st.aura = {
          min: Number(fx?.auraMin) || 0,
          max: Number(fx?.auraMax) || 0,
          key: st.label,
          target: String(fx?.auraTarget ?? "allies")
        };
      }

      out.push(st);
    });
  }

  return out;
}

/**
 * Tous les états qui agissent sur cet acteur : ceux réellement posés, plus
 * ceux du passif porté.
 *
 * À utiliser partout où l'on LIT les états pour en déduire un effet. Les
 * écritures, elles, ne visent que `system.etatsActifs` : un état virtuel n'a
 * pas d'existence à modifier — on dépose le passif à la place.
 */
export function effectiveStates(actor) {
  const real = Array.isArray(actor?.system?.etatsActifs) ? actor.system.etatsActifs : [];
  return [...real, ...passifStates(actor)];
}

/* ------------------------------------------------------------------ */
/* Recharge d'un passif                                                */
/* ------------------------------------------------------------------ */

/**
 * Recharge restante d'un passif, en tours. 0 = disponible.
 *
 * C'est le MÊME champ que celui de n'importe quel sort ou arme
 * (`system.cooldown.restant`), ce qui rend le décompte gratuit :
 * `decCooldowns` (turn-effects.js) parcourt déjà tout item qui le porte, au
 * début du tour de son porteur — y compris un passif déposé, ce qui est
 * exactement ce qu'il faut ici, puisque c'est pendant qu'on ne le porte plus
 * que l'attente doit s'écouler.
 */
export function passifCooldownLeft(item) {
  return Math.max(0, n(item?.system?.cooldown?.restant, 0));
}

/** Un passif encore en recharge ne peut pas être (re)pris. */
export function isPassifOnCooldown(item) {
  return isPassif(item) && passifCooldownLeft(item) > 0;
}

/**
 * Arme la recharge d'un passif, au moment où il est réellement LANCÉ —
 * c'est-à-dire au premier tour de combat de son porteur, en même temps que
 * le prélèvement de mana, ou immédiatement s'il est pris en cours de combat
 * alors que ce prélèvement a déjà eu lieu.
 *
 * Pourquoi à ce moment-là et pas au dépôt : un passif n'est pas une action
 * qu'on déclenche, il est « entretenu ». Le compteur part donc quand
 * l'entretien commence. La conséquence voulue est la seule qui compte à la
 * table : reposer un passif pour en essayer un autre coûte l'attente
 * complète avant de pouvoir revenir au premier, ce qui décourage de le
 * changer à chaque tour selon l'adversaire en face.
 *
 * `system.cooldown.restant` est dans la liste blanche d'écriture joueur
 * (init.js), donc le porteur peut l'armer depuis son propre client.
 *
 * @returns {boolean} vrai si une écriture a eu lieu.
 */
export async function startPassifCooldown(actor, item) {
  const max = Math.max(0, n(item?.system?.cooldown?.max, 0));
  if (!actor || !item || max <= 0) return false;
  if (passifCooldownLeft(item) === max) return false;      // déjà armée
  await actor.updateEmbeddedDocuments("Item", [
    { _id: item.id, "system.cooldown.restant": max }
  ]);
  return true;
}

/* ------------------------------------------------------------------ */
/* Coût en mana d'un passif                                            */
/* ------------------------------------------------------------------ */

/** Coût d'entrée d'un passif, en mana. 0 = gratuit. */
export function passifManaCost(item) {
  return Math.max(0, n(item?.system?.coutMana, 0));
}

/**
 * Prélève le coût d'un passif sur le mana de l'acteur.
 *
 * Le mana ne descend jamais sous 0 et le passif n'est JAMAIS désactivé faute
 * de paiement : le désactiver dynamiquement obligerait `talentStates` /
 * `passiveSpellStates` à consulter la bourse à chaque recalcul de stats —
 * fragile, et pour un cas qui n'arrive presque jamais (5 mana de départ pour
 * un coût de 1 à 3). Un porteur à sec paie ce qu'il peut, et le message le
 * dit.
 *
 * @returns {{paid: number, asked: number, short: boolean}}
 */
export async function chargePassif(actor, item, { announce = true } = {}) {
  const asked = passifManaCost(item);
  const res = { paid: 0, asked, short: false };
  if (!actor || !item || asked <= 0) return res;

  const cur = n(actor.system?.ressources?.mana?.valeur, 0);
  const paid = Math.max(0, Math.min(asked, cur));
  res.paid = paid;
  res.short = paid < asked;

  if (paid > 0) await actor.update({ "system.ressources.mana.valeur": cur - paid });

  if (announce) {
    const manque = res.short
      ? ` <span style="opacity:.7">(coût ${asked}, réserve insuffisante)</span>`
      : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `🔮 <b>${actor.name}</b> maintient <b>${item.name}</b> — `
             + `<b>−${paid}</b> mana${manque}`
    });
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Prélèvement au premier tour du combat                               */
/* ------------------------------------------------------------------ */

/**
 * Marque, sur le document Combat, les acteurs ayant déjà payé leur passif.
 *
 * Le flag vit sur le Combat et disparaît donc avec lui : un nouveau combat
 * refait payer, ce qui est la règle voulue. Le stocker sur l'acteur aurait
 * demandé un nettoyage à la fin de chaque rencontre — une remise à zéro
 * oubliée quelque part et le passif devenait gratuit à vie.
 */
function paidSet(combat) {
  const raw = combat?.getFlag?.(FLAG_SCOPE, "passifPaid");
  return Array.isArray(raw) ? raw.map(String) : [];
}

/**
 * Cet acteur a-t-il déjà payé un passif dans ce combat ?
 *
 * Sert au changement en cours de combat, et c'est ce qui évite de faire
 * payer deux fois : tant que l'acteur n'a pas joué son premier tour, aucun
 * prélèvement n'a eu lieu et le changement est donc gratuit sur le moment —
 * `chargePassifOnFirstTurn` prélèvera le coût du NOUVEAU passif le moment
 * venu. Après son premier tour, en revanche, l'ancien a été payé et le
 * nouveau doit l'être aussi.
 *
 * Lecture seule : un client joueur peut lire un flag de Combat, il ne peut
 * pas en écrire un. C'est précisément pour ça que le décompte vit ici et non
 * dans une écriture faite au moment du changement.
 */
export function hasPaidThisCombat(actor, combat) {
  if (!actor || !combat) return false;
  const key = String(actor.uuid ?? actor.id ?? "");
  return !!key && paidSet(combat).includes(key);
}

/**
 * Prélève le coût du passif porté au PREMIER tour de cet acteur dans ce
 * combat. Sans passif porté, il n'y a rien à payer — l'emplacement vide est
 * un choix, pas une anomalie.
 *
 * À appeler APRÈS la régénération de début de tour : le porteur doit
 * encaisser sa régen avant de payer, sinon il paie sur une réserve qui n'a
 * pas encore été rendue et le premier tour est deux fois plus cher que les
 * autres.
 *
 * GM uniquement — écrire un flag de Combat depuis un client joueur est
 * refusé par Foundry (voir la note sur budgetWrite dans macro/menu.js).
 */
export async function chargePassifOnFirstTurn(actor, combat) {
  if (!game.user.isGM) return null;
  if (!actor || !combat) return null;

  const key = String(actor.uuid ?? actor.id ?? "");
  if (!key) return null;

  const paid = paidSet(combat);
  if (paid.includes(key)) return null;          // déjà payé ce combat

  // Le marquage précède le prélèvement : l'acteur est réputé « passé par
  // ici » même s'il ne porte rien, sinon on rejouerait ce test à chacun de
  // ses tours pour rien.
  await combat.setFlag(FLAG_SCOPE, "passifPaid", [...paid, key]);

  const item = equippedPassif(actor);
  if (!item) return null;

  // Le passif est lancé maintenant : sa recharge part en même temps que son
  // coût. Les deux disent la même chose — « il vient d'être engagé » — et
  // les séparer aurait laissé un passif payé mais reprenable au tour suivant.
  await startPassifCooldown(actor, item);

  return chargePassif(actor, item);
}
