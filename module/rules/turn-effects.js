// systems/rpg/module/rules/turn-effects.js

import { hpSecret } from "./chat-visibility.js";
import { passifStates } from "./loadout.js";
import { auraAffectsBearer } from "./aura-target.js";
import { resistanceFor, applyResistPct } from "./damage-types.js";

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Décrémente les cooldowns des items (spells) qui ont system.cooldown.restant.
 * Appelée UNE SEULE FOIS par tour (depuis onTurnStartForActor).
 */
async function decCooldowns(actor) {
  const updates = [];

  for (const it of actor.items) {
    const rest = n(it.system?.cooldown?.restant, 0);
    if (rest > 0) {
      const next = Math.max(0, rest - 1);
      // Met à jour les deux champs pour compat avec l'ancien modèle
      updates.push({ _id: it.id, "system.cooldown.restant": next, "system.recharge.restant": next });
    }
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * Tick des états (etatsActifs) :
 * - décrémente remaining de 1
 * - supprime si remaining arrive à 0
 * - ne touche pas aux auraApplied (gérés par refreshAuras)
 * - collecte les DOT pour application
 */
function tickStates(actor) {
  const cur = Array.isArray(actor.system?.etatsActifs)
    ? foundry.utils.deepClone(actor.system.etatsActifs)
    : [];

  if (!cur.length) return { changed: false, next: cur, removedAuraSource: false, totalFatigueDot: 0, dotEntries: [] };

  let removedAuraSource = false;
  let totalFatigueDot = 0;
  // Part en DÉS du dégât par tour (`dot.formula`, « 1d4 de saignement »).
  // Elle était écrite par l'éditeur d'état, affichée par les deux fiches
  // d'acteur (« Dégâts par tour : 0 + 1d4 ») et lancée par PERSONNE : seul
  // `dot.perTick`, la part fixe, était appliqué. Un saignement écrit
  // uniquement en dés ne faisait donc rien du tout, en promettant le
  // contraire à l'écran. Les formules sont collectées ici et lancées par
  // l'appelant, qui est asynchrone (un jet de dés l'est).
  // Un DOT n'est plus un simple nombre : chaque état apporte sa part fixe, ses
  // dés, et le TYPE de dégât qui décide de la résistance élémentaire opposée.
  // Le total ne peut donc plus être fait ici — deux états de types différents
  // ne sont pas mitigés pareil sur la même cible.
  const dotEntries = [];
  const pushEntry = (st, flat) => {
    // Une aura qui ne vise que les ENNEMIS est une émission, pas un effet
    // porté : son dégât par tour tombe sur les copies (auraApplied) posées
    // alentour, jamais sur celui qui la génère. Sans cette coupure, un
    // « 1 + Int÷10 dégâts/tour · ennemis » blessait son propre lanceur à
    // chaque tour — l'émetteur ne recevant jamais de copie de sa propre aura
    // (refreshAuras saute son token), son état SOURCE était la seule chose
    // qui le frappait. Une aura « alliés »/« tous » continue de le payer,
    // et c'est ce qui fait qu'une aura de soin soigne aussi son porteur.
    if (!auraAffectsBearer(st)) return;
    const formula = dotFormula(st);
    if (!flat && !formula) return;
    dotEntries.push({
      label: String(st?.label ?? "Effet"),
      flat: n(flat, 0),
      formula,
      tag: st?.tag ?? null,
      livraison: String(st?.dot?.livraison ?? "").trim() || null
    });
  };
  const next = [];

  for (const st of cur) {
    // auraApplied : ne décrémente jamais (suivi par refreshAuras)
    if (String(st?.type) === "auraApplied") {
      // Les DOT des auras s'appliquent quand même (soin négatif inclus)
      const dot = n(st?.dot?.perTick ?? st?.dot?.flat, 0);
      if (auraAffectsBearer(st)) totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);
      pushEntry(st, dot);
      next.push(st);
      continue;
    }

    // ✅ Blessures/effets permanents : ne s'estompent jamais seuls,
    // seul un soin explicite (macro MJ) les retire. Le DOT (ex: saignement)
    // continue de s'appliquer chaque tour tant que la blessure est active.
    if (st?.permanent) {
      const dot = n(st?.dot?.perTick ?? st?.dot?.flat, 0);
      if (auraAffectsBearer(st)) totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);
      pushEntry(st, dot);
      next.push(st);
      continue;
    }

    const remaining    = n(st?.remaining, n(st?.duration, 0));
    const newRemaining = Math.max(0, remaining - 1);

    // Collecte DOT avant suppression (soin négatif inclus)
    const dot = n(st?.dot?.perTick ?? st?.dot?.flat, 0);
    if (remaining > 0) {
      if (auraAffectsBearer(st)) totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);
      pushEntry(st, dot);
    }

    if (st?.isAura && newRemaining <= 0) removedAuraSource = true;

    if (newRemaining > 0) next.push({ ...st, remaining: newRemaining });
  }

  const changed = JSON.stringify(cur) !== JSON.stringify(next);
  return { changed, next, removedAuraSource, totalFatigueDot, dotEntries };
}

/**
 * Formule de dés d'un état, ou "" s'il n'en porte pas.
 *
 * « 0 » est le défaut écrit par la fiche de sort pour un effet sans dés
 * (normDamage), et une chaîne vide celui de l'éditeur d'état : ni l'un ni
 * l'autre ne doit produire un jet. On exige donc un dé explicite.
 */
function dotFormula(st) {
  const f = String(st?.dot?.formula ?? "").trim();
  return /\dd\d/i.test(f) || /^d\d/i.test(f) ? f : "";
}

/**
 * Guard anti-double-tick par tour.
 * Stocke une clé dans un flag du Combat.
 */
async function ensureTurnGuard(combat) {
  const key  = `${combat.id}:${combat.round}:${combat.turn}`;
  let last = null;
  try { last = await combat.getFlag("rpg", "lastTurnEffectsKey"); } catch { last = null; }
  if (last === key) return { ok: false };
  try { await combat.setFlag("rpg", "lastTurnEffectsKey", key); } catch { /* pas critique */ }
  return { ok: true };
}

/**
 * Appelée au début du tour du combattant actif (depuis init.js > updateCombat).
 *
 * Pipeline :
 *   1. Anti-double-tick
 *   2. Cooldowns -1
 *   3. États -1, supprime ceux à 0
 *   4. Recompute (reset actor pour que prepareDerivedData se réexécute)
 *   5. Refresh auras si une source expire
 */
export async function onTurnStartForActor(actor, { combat = null } = {}) {
  if (!actor) return;

  // Anti double tick
  if (combat) {
    const g = await ensureTurnGuard(combat);
    if (!g.ok) return;
  }

  // 1) Cooldowns
  await decCooldowns(actor);

  // 2) États + collecte DOT
  const { changed, next, removedAuraSource, totalFatigueDot: fatFromStates, dotEntries } = tickStates(actor);
  let totalFatigueDot = fatFromStates;
  const entries = Array.isArray(dotEntries) ? [...dotEntries] : [];

  // Le passif porté n'écrit aucun état (loadout.js) : son « par tour » doit
  // donc être ajouté ici, sinon un passif qui régénère ou qui brûle son
  // porteur se saisissait sur la fiche et ne se produisait jamais. Rien à
  // décompter ni à réécrire — il vaut tant que le passif est porté.
  for (const st of passifStates(actor)) {
    // Même règle que ci-dessus : un passif porté peut lui aussi être une
    // aura, et une aura « ennemis » ne se paie pas sur son porteur.
    if (!auraAffectsBearer(st)) continue;
    totalFatigueDot += n(st?.dot?.fatiguePerTick, 0);
    const flat = n(st?.dot?.perTick, 0);
    const formula = dotFormula(st);
    if (flat || formula) {
      entries.push({
        label: String(st?.label ?? "Passif"), flat, formula,
        tag: st?.tag ?? null,
        livraison: String(st?.dot?.livraison ?? "").trim() || null
      });
    }
  }

  // ── Résolution des DOT, état par état ────────────────────────────────
  //
  // Deux choses se jouent ici et aucune ne peut se faire sur un total :
  //   • les DÉS (`dot.formula`) se lancent, un jet par état, visiblement ;
  //   • la RÉSISTANCE ÉLÉMENTAIRE du porteur s'applique à chacun selon SON
  //     type — une brûlure et un poison sur la même cible ne sont pas
  //     encaissés pareil.
  //
  // Le type vient de l'élément de l'état, sinon de la livraison de son effet
  // par tour (`dot.livraison`, physique/magique) — exactement la règle de
  // resolveDamageType(). Un état qui ne nomme ni l'un ni l'autre n'a aucun
  // type et n'est donc pas mitigé : c'est l'état de tout ce qui a été écrit
  // avant, et rien ne change pour lui.
  //
  // C'est la SECONDE couche de mitigation seulement (damage-types.js), jamais
  // l'armure : un poison qui traverse une cotte de mailles est la règle de
  // cette table, et faire encaisser un DOT par l'armure fixe écraserait à 1
  // tous les petits DOT du bestiaire. Un soin (montant négatif) n'est jamais
  // rogné, comme partout ailleurs.
  let totalDot = 0;
  const dotRollLines = [];
  for (const e of entries) {
    let amount = n(e.flat, 0);
    if (e.formula) {
      try {
        const roll = await (new Roll(e.formula)).evaluate();
        amount += Number(roll.total) || 0;
        dotRollLines.push(`${e.label} : ${e.formula} → <b>${roll.total}</b>`);
      } catch (err) {
        console.warn(`[RPG] DOT en dés « ${e.formula} » illisible :`, err);
      }
    }
    if (amount > 0) {
      const res = resistanceFor(actor, { tag: e.tag, livraison: e.livraison });
      if (res.pct) {
        const before = amount;
        amount = applyResistPct(amount, res.pct);
        dotRollLines.push(
          `${e.label} : ${res.label} ${res.pct > 0 ? "−" : "+"}${Math.abs(res.pct)} % (${before} → <b>${amount}</b>)`
        );
      }
    }
    totalDot += amount;
  }

  // 3) Applique DOT avant la mise à jour des états
  const updates = {};
  if (changed) updates["system.etatsActifs"] = next;

  const lines = [];

  if (totalDot !== 0) {
    const pvCur  = Number(actor.system?.ressources?.pv?.valeur ?? 0) || 0;
    const pvMax  = Number(actor.system?.ressources?.pv?.max    ?? 0) || 0;
    // totalDot positif = dégâts, négatif = soin (clampé au max dans les deux sens)
    const newPv  = Math.min(pvMax, Math.max(0, pvCur - totalDot));
    updates["system.ressources.pv.valeur"] = newPv;

    lines.push((totalDot > 0
      ? `subit <b>${totalDot}</b> dégâts (DOT)${dotRollLines.length ? ` <span style="opacity:.8">[${dotRollLines.join(" · ")}]</span>` : ""}`
      : `récupère <b>${Math.abs(totalDot)}</b> PV (soin/tour)${dotRollLines.length ? ` <span style="opacity:.8">[${dotRollLines.join(" · ")}]</span>` : ""}`)
      + `. PV: ${newPv}/${pvMax}`);
  }
  else if (dotRollLines.length) {
    // Un DOT ramené à zéro par une immunité ne doit pas simplement ne rien
    // faire en silence : sans cette ligne, le MJ ne peut pas distinguer
    // « immunisé » de « l'effet ne s'est pas déclenché ».
    lines.push(`encaisse sans dommage son effet par tour <span style="opacity:.8">[${dotRollLines.join(" · ")}]</span>`);
  }

  if (totalFatigueDot !== 0) {
    const fatCur = Number(actor.system?.ressources?.fatigue?.valeur ?? 0) || 0;
    const fatMax = Number(actor.system?.ressources?.fatigue?.max    ?? 10) || 10;
    // Pas de plafond haut : le max est le seuil d'épuisement (voir actor.js)
    const newFat = Math.max(0, fatCur + totalFatigueDot);
    updates["system.ressources.fatigue.valeur"] = newFat;

    lines.push(totalFatigueDot > 0
      ? `s'épuise de <b>${totalFatigueDot}</b> (effet). Fatigue: ${newFat}/${fatMax}`
      : `récupère <b>${Math.abs(totalFatigueDot)}</b> fatigue (effet). Fatigue: ${newFat}/${fatMax}`);
  }

  if (lines.length) {
    await actor.update(updates);
    await ChatMessage.create({
      speaker:  ChatMessage.getSpeaker({ actor }),
      content:  hpSecret(actor, `<b>${actor.name}</b> ${lines.join(" — ")}`)
    });
  } else if (changed) {
    await actor.update(updates);
  }

  // 4) Recompute (force prepareDerivedData via reset)
  actor.reset();
  actor.sheet?.render(false);

  // 5) Refresh auras si une source a expiré
  if (removedAuraSource && globalThis.RPG_AURAS?.refreshAuras) {
    await globalThis.RPG_AURAS.refreshAuras();
  }
}
