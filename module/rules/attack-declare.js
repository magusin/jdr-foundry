// module/rules/attack-declare.js
//
// Déclaration d'attaque physique — point d'entrée UNIQUE.
//
// Lance le d20 de touché puis publie le message « attackDeclaration » avec les
// boutons de validation MJ (Échec critique / Échec / Touché / Critique).
// Les dégâts ne sont lancés qu'après la décision du MJ, dans attack-resolve.js.
//
// Ce module existe parce que plusieurs fiches (personnage, monstre) et le menu
// de combat construisaient chacune leur propre message : certaines n'affichaient
// qu'un aperçu sans jet ni validation.

import { gmOnly } from "./chat-visibility.js";

const htmlEsc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

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

  const Combat = game.rpg?.combat;
  const tn = Combat?.computeTN?.(attacker, targetActor, item)
    ?? { tnFinal: 11, tnBase: 11, diff: 0, livraison: item.system?.livraison ?? "physique" };

  // Jet de touché, visible de tous
  const roll = await (new Roll("1d20")).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    flavor: `⚔️ <b>${htmlEsc(attacker.name)}</b> attaque <b>${htmlEsc(targetActor.name)}</b> `
          + `avec <b>${htmlEsc(item.name)}</b> — il faut faire <b>${tn.tnFinal}+</b>`
  });

  const d20 = roll.total;
  const isCrit  = d20 === 20;
  const isAutoF = d20 <= 5;
  const isAutoS = d20 >= 16;
  const verdict = isAutoF ? "Échec automatique (≤5)"
                : isCrit  ? "CRITIQUE !"
                : isAutoS ? "Succès automatique (≥16)"
                : (d20 >= tn.tnFinal ? "réussite" : "échec");

  // Aperçu des dégâts : total déjà calculé, sans détail interne
  const dmgPrev = Combat?.damagePreview?.(attacker, item) ?? null;

  const title = opts.title ?? `Attaque : <b>${htmlEsc(item.name)}</b> → <b>${htmlEsc(targetActor.name)}</b>`;
  const diffTxt = tn.diff ? ` ; difficulté +${tn.diff}` : "";
  const content = `
    <div class="rpg-attack-declare" style="font-size:13px;line-height:1.6">
      <div>${title}</div>
      <div style="opacity:.85;margin-top:2px">
        Seuil de touché : <b>${tn.tnFinal}+</b> <span style="opacity:.75">(base ${tn.tnBase}+${diffTxt})</span><br>
        🎲 d20 = <b>${d20}</b>${gmOnly(` — ${verdict}`)}
        ${dmgPrev?.text ? `<br>💥 Dégâts si touché : <b>${dmgPrev.text}</b>` : ""}
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
      </div>
    </div>`;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content,
    flags: {
      rpg: {
        type: "attackDeclaration",
        actionId: opts.actionId ?? foundry.utils.randomID(),
        attackDeclaration: {
          actorId: attacker.id,
          weaponId: item.id,
          targetId: targetActor.id,
          d20,
          tnFinal: tn.tnFinal,
          livraison: tn.livraison
        }
      }
    }
  });
}
