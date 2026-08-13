// module/rules/attack-declare.js
//
// Déclaration d'attaque physique — point d'entrée UNIQUE.
//
// Flow (aligné sur les sorts) : déclaration (pas de jet) -> le MJ Valide ou
// Annule -> une fois validé, le joueur clique pour lancer son d20 -> le MJ
// tranche Échec critique / Échec / Touché / Critique. Les dégâts ne sont
// lancés qu'après cette dernière décision, dans attack-resolve.js.
//
// Ce module existe parce que plusieurs fiches (personnage, monstre) et le menu
// de combat construisaient chacune leur propre message : certaines n'affichaient
// qu'un aperçu sans jet ni validation, et une (menu.js) lançait même le d20
// avant toute validation MJ.

import { gmOnly } from "./chat-visibility.js";
import { checkRange, fmtMeters } from "../utils/grid.js";

/**
 * Portée utile d'une arme, en mètres : son allonge de corps à corps OU sa
 * portée de tir, la plus grande des deux.
 *
 * Les deux champs cohabitent et ne servent pas à la même chose (`allonge`
 * dessine la zone de menace et déclenche les attaques d'opportunité,
 * `range.max` est la portée de tir/jet), mais du point de vue « puis-je
 * frapper cette cible ? » l'un ou l'autre suffit : une lance d'allonge 2 m
 * atteint à 2 m, un arc de portée 20 m atteint à 20 m. C'est exactement ce
 * que dessine défaultLayersFor() sur le canevas — les deux anneaux — donc le
 * contrôle et l'affichage disent la même chose.
 */
function weaponReach(item) {
  const sys = item?.system ?? {};
  return {
    min: Math.max(0, Number(sys.range?.min ?? 0) || 0),
    max: Math.max(
      Math.max(0, Number(sys.range?.max ?? sys.portee ?? 0) || 0),
      Math.max(0, Number(sys.allonge ?? 0) || 0)
    )
  };
}

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function wrapAttack(bodyHtml) {
  return `<div class="rpg-attack-declare" style="font-size:13px;line-height:1.6">${bodyHtml}</div>`;
}

/**
 * Construit le corps du message selon la phase :
 * - "pending"   : en attente de validation MJ, boutons Valider/Annuler
 * - "confirmed" : validé, bouton "Lancer le d20" (visible de tous)
 * - "rolled"    : d20 lancé, boutons Échec critique/Échec/Touché/Critique (MJ)
 */
function renderAttackBody(d, phase) {
  const diffTxt = d.diffTxt ?? "";
  const dmgLine = d.dmgPrevText ? `<br>💥 Dégâts si touché : <b>${d.dmgPrevText}</b>` : "";
  const offhandLine = d.offhandName
    ? `<br>🗡️ Seconde arme : <b>${htmlEsc(d.offhandName)}</b> — `
      + `dé seul (<b>${htmlEsc(d.offhandDice ?? "—")}</b>), sans part fixe ni bonus de stat`
    : "";

  const header = `
    <div>${d.title}</div>
    <div style="opacity:.85;margin-top:2px">
      Seuil de touché : <b>${d.tnFinal}+</b> <span style="opacity:.75">(base ${d.tnBase}+${diffTxt})</span>
      ${dmgLine}${offhandLine}`;

  if (phase === "pending") {
    return `${header}
        <div style="font-size:11px;opacity:.7;margin-top:2px">En attente de la validation du MJ.</div>
      </div>
      <div class="rpg-attack-gm-confirm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="rpg-attack-confirm" data-ok="1"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-weight:600">✅ Valider</button>
        <button type="button" class="rpg-attack-confirm" data-ok="0"
          style="flex:1;padding:4px 8px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">❌ Annuler</button>
      </div>`;
  }

  if (phase === "confirmed") {
    return `${header}
        <div style="font-size:11px;opacity:.7;margin-top:2px">Validé par le MJ — lance ton jet de touché.</div>
      </div>
      <div class="rpg-attack-roll" style="margin-top:8px">
        <button type="button" class="rpg-roll-d20-attack"
          style="width:100%;padding:6px 8px;cursor:pointer;border-radius:6px;font-weight:600">🎲 Lancer le d20</button>
      </div>`;
  }

  // phase === "rolled"
  return `${header}
      <br>🎲 d20 = <b>${d.d20}</b>${gmOnly(` — ${d.verdict}`)}
      <div style="font-size:11px;opacity:.7;margin-top:2px">En attente de la validation du MJ.</div>
    </div>
    <div class="rpg-attack-gm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button type="button" class="rpg-attack-resolve" data-result="critfail"
        style="flex:1;padding:4px 8px;cursor:pointer;color:#8b1a12;font-weight:700">Échec Critique</button>
      <button type="button" class="rpg-attack-resolve" data-result="fail"
        style="flex:1;padding:4px 8px;cursor:pointer">Échec</button>
      <button type="button" class="rpg-attack-resolve" data-result="hit"
        style="flex:1;padding:4px 8px;cursor:pointer">Touché</button>
      <button type="button" class="rpg-attack-resolve" data-result="crit"
        style="flex:1;padding:4px 8px;cursor:pointer;font-weight:700;color:gold">Critique !</button>
    </div>`;
}

/**
 * @param {Actor}  attacker      - celui qui attaque
 * @param {Item}   item          - arme ou sort utilisé comme attaque
 * @param {Actor}  targetActor   - la cible
 * @param {object} [opts]
 * @param {string} [opts.actionId]  - id de slot de budget, si l'action en consomme un
 * @param {string} [opts.title]     - intitulé personnalisé (ex: attaque d'opportunité)
 * @returns {Promise<ChatMessage|null>}
 */
export async function declareAttack(attacker, item, targetActor, opts = {}) {
  if (!attacker || !item || !targetActor) return null;

  // ── Portée ────────────────────────────────────────────────────────────
  // Ce contrôle n'existait NULLE PART sur le chemin d'attaque : seul le menu
  // de combat grisait son bouton, et lui seul. Déclarer depuis la barre
  // d'actions ou une fiche permettait donc de frapper une cible à l'autre
  // bout de la carte. Même règle que les sorts (checkRange), pour que la
  // mêlée se comporte comme le reste.
  const attackerTok = opts.attackerToken ?? attacker.getActiveTokens?.()?.[0] ?? null;
  const targetTok   = opts.targetToken   ?? targetActor.getActiveTokens?.()?.[0] ?? null;
  if (attackerTok && targetTok) {
    const { min, max } = weaponReach(item);
    if (max > 0) {
      const r = checkRange(attackerTok, targetTok, min, max);
      if (!r.ok) {
        const why = r.tooClose ? "trop près" : "hors de portée";
        ui.notifications?.warn?.(
          `${targetActor.name} est ${why} (${fmtMeters(r.dist)}, ${min}–${max} m).`);
        return null;
      }
    }
  }

  const Combat = game.rpg?.combat;
  const offhand = opts.offhand ?? null;

  // Difficulté forcée (attaque à deux armes : la plus haute des deux + 1).
  // On la fait passer PAR computeTN au lieu de l'ajouter au seuil obtenu :
  // computeTN traite la difficulté différemment selon que la cible est amie
  // ou adverse, et borne le seuil final. L'ajouter après coup court-circuitait
  // ces règles et annonçait un seuil que le moteur n'applique pas.
  const tnItem = (opts.difficulte === undefined || opts.difficulte === null)
    ? item
    : { type: item.type, system: { ...item.system, difficulte: opts.difficulte } };

  const tn = Combat?.computeTN?.(attacker, targetActor, tnItem)
    ?? { tnFinal: 11, tnBase: 11, diff: 0, livraison: item.system?.livraison ?? "physique" };

  // Aperçu des dégâts : total déjà calculé, sans détail interne
  const dmgPrev = Combat?.damagePreview?.(attacker, item) ?? null;

  const title = opts.title ?? `Attaque : <b>${htmlEsc(item.name)}</b> → <b>${htmlEsc(targetActor.name)}</b>`;
  const diffTxt = tn.diff ? ` ; difficulté +${tn.diff}` : "";

  const d = {
    title,
    tnFinal: tn.tnFinal,
    tnBase: tn.tnBase,
    diffTxt,
    dmgPrevText: dmgPrev?.text ?? null,
    offhandName: offhand?.name ?? null,
    offhandDice: offhand?.system?.damage?.dice ?? null,
    actorId: attacker.id,
    weaponId: item.id,
    offhandId: offhand?.id ?? null,
    targetId: targetActor.id,
    livraison: tn.livraison,
    d20: null,
    verdict: null
  };

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: wrapAttack(renderAttackBody(d, "pending")),
    flags: {
      rpg: {
        type: "attackDeclaration",
        phase: "pending",
        actionId: opts.actionId ?? foundry.utils.randomID(),
        attackDeclaration: d
      }
    }
  });
}

/**
 * Le MJ valide ou annule la déclaration d'attaque (avant tout jet).
 * Sur annulation, libère le slot de budget réservé le cas échéant.
 */
export async function confirmAttackDeclaration(message, approve) {
  if (!game.user.isGM) return;

  const flags = message?.flags?.rpg ?? {};
  const d = flags.attackDeclaration ?? {};
  const actionId = flags.actionId ?? null;

  if (!approve) {
    if (actionId && game.combat) {
      try {
        const { findLogEntry, getBudget, saveBudget, releaseSlot, updateLogEntry } = await import("./action-budget.js");
        const found = findLogEntry(game.combat, actionId);
        if (found) {
          const budget = getBudget(game.combat, found.combatantId);
          await saveBudget(game.combat, found.combatantId, releaseSlot(budget, found.entry.slot ?? "attaque", false));
          await updateLogEntry(game.combat, actionId, { status: "rejected" });
        }
      } catch (e) { /* ignore si pas de budget actif */ }
    }

    await message.update({
      content: wrapAttack(`
        <div>${d.title ?? "Attaque"}</div>
        <div style="opacity:.75;margin-top:4px">❌ Attaque refusée par le MJ.</div>`),
      "flags.rpg.phase": "rejected"
    });
    return;
  }

  await message.update({
    content: wrapAttack(renderAttackBody(d, "confirmed")),
    "flags.rpg.phase": "confirmed"
  });
}

/**
 * Le joueur lance son jet de touché, une fois la déclaration validée par le MJ.
 * N'importe qui peut cliquer (même permissivité que le bouton équivalent des
 * sorts) : le jet reste public, seul le verdict textuel est réservé au MJ.
 */
export async function rollAttackDie(message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.phase !== "confirmed") return;

  const d = flags.attackDeclaration ?? {};
  const attacker = game.actors.get(d.actorId);

  const roll = await (new Roll("1d20")).evaluate();
  const d20 = roll.total;
  const tnFinal = Number(d.tnFinal) || 11;
  const isCrit  = d20 === 20;
  const isAutoF = d20 <= 5;
  const isAutoS = d20 >= 16;
  const verdict = isAutoF ? "Échec automatique (≤5)"
                : isCrit  ? "CRITIQUE !"
                : isAutoS ? "Succès automatique (≥16)"
                : (d20 >= tnFinal ? "réussite" : "échec");

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    flavor: `⚔️ <b>${htmlEsc(attacker?.name ?? "?")}</b> — jet de touché : <b>${d20}</b> `
          + `(seuil ${tnFinal}+)${gmOnly(` → ${verdict}`)}`
  });

  const newD = { ...d, d20, verdict };
  await message.update({
    content: wrapAttack(renderAttackBody(newD, "rolled")),
    "flags.rpg.phase": "rolled",
    "flags.rpg.attackDeclaration": newD
  });
}
