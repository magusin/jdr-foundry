// systems/rpg/module/rules/combat-end.js
//
// Géré via le hook "deleteCombat" dans init.js.
// Distribue XP + loot entre les PJ qui participaient au combat.

import { appendToCampaignJournal } from "./campaign-journal.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Calcule le partage d'XP entre les PJ ayant participé au combat.
 * XP total = somme des system.recompenses.xp de tous les monstres combattants.
 * On divise équitablement et on arrondit au supérieur pour le premier.
 *
 * @param {Combat} combat
 */
export async function resolveEndOfCombat(combat) {
  if (!game.user.isGM) return;      // seul le GM exécute

  // ── 1. Sépare PJ et monstres ───────────────────────────────────────────
  const pjCombatants      = [];
  const monsterCombatants = [];

  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor) continue;
    if (actor.type === "character") pjCombatants.push(actor);
    if (actor.type === "monster")   monsterCombatants.push(actor);
  }

  if (!pjCombatants.length)  return; // pas de PJ → rien à distribuer
  if (!monsterCombatants.length) return; // pas de monstres → combat PvP, on skip

  // Déduplique les PJ (si un PJ avait plusieurs tokens)
  const pjMap = new Map();
  for (const a of pjCombatants) pjMap.set(a.id, a);
  const pjs = [...pjMap.values()];

  // ── 2. XP total ────────────────────────────────────────────────────────
  let totalXP = 0;
  for (const monster of monsterCombatants) {
    totalXP += n(monster.system?.recompenses?.xp, 0);
  }

  // ── 3. Part par PJ ─────────────────────────────────────────────────────
  const share      = totalXP / pjs.length;
  const shareFloor = Math.floor(share);
  const shareRem   = Math.round(totalXP - shareFloor * pjs.length); // arrondi resto

  // ── 4. Applique XP + construit message ─────────────────────────────────
  const updates = [];
  const lines   = [];

  for (let i = 0; i < pjs.length; i++) {
    const pj      = pjs[i];
    const gained  = i === 0 ? shareFloor + shareRem : shareFloor;
    const curXP   = n(pj.system?.xp?.valeur, 0);
    const newXP   = curXP + gained;
    updates.push({ actor: pj, newXP, gained });
    lines.push(`<li><b>${pj.name}</b> : +${gained} XP (total ${newXP})</li>`);
  }

  // Écrit en base
  for (const { actor, newXP } of updates) {
    await actor.update({ "system.xp.valeur": newXP });
  }

  // ── 5. Butin — OPTIONNEL : on ne tire rien automatiquement, on propose
  // un bouton (les joueurs/le MJ choisissent de looter ou non) ───────────
  const lootableMonsters = monsterCombatants.filter(m => String(m.system?.butin?.tableUuid ?? "").trim());

  // ── 6. Message récap ───────────────────────────────────────────────────
  const monsterNames = monsterCombatants.map((m) => m.name).join(", ");

  let content =
    `<h3>⚔️ Fin de combat</h3>` +
    `<p><b>Adversaires :</b> ${monsterNames}</p>` +
    `<p><b>XP total :</b> ${totalXP} répartis entre ${pjs.length} PJ(s)</p>` +
    `<ul>${lines.join("")}</ul>`;

  if (lootableMonsters.length) {
    const monsterIds = lootableMonsters.map(m => m.id).join(",");
    content += `
      <hr>
      <div style="text-align:center">
        <button type="button" data-action="lootNow" data-monster-ids="${monsterIds}"
          style="padding:6px 14px;cursor:pointer;border-radius:6px;border:none;background:#7a5a16;color:#fff;font-weight:600">
          🎲 Looter les dépouilles (${lootableMonsters.length})
        </button>
      </div>`;
  }

  await ChatMessage.create({ content, type: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0 });

  const pjNames = pjs.map(p => p.name).join(", ");
  appendToCampaignJournal(
    `Combat contre <b>${monsterNames}</b> remporté par <b>${pjNames}</b>. XP distribué : ${totalXP}.`
  ).catch(() => {});
}

/**
 * Tire le butin des monstres sélectionnés (appelé au clic sur "Looter les
 * dépouilles" — jamais automatiquement, c'est un choix des joueurs/du MJ).
 */
export async function lootMonsters(monsterIds) {
  if (!game.user.isGM) return;

  const lootLines = [];
  for (const id of monsterIds) {
    const monster = game.actors.get(id);
    if (!monster) continue;

    const tableUuid = String(monster.system?.butin?.tableUuid ?? "").trim();
    if (!tableUuid) continue;

    try {
      const table = await fromUuid(tableUuid);
      if (!table) { lootLines.push(`<li>${monster.name} : table introuvable (${tableUuid})</li>`); continue; }

      const { results } = await table.roll();
      const names = results.map((r) => r.text ?? r.name ?? "?").join(", ") || "rien d'intéressant";
      lootLines.push(`<li><b>${monster.name}</b> : ${names}</li>`);
    } catch (e) {
      console.error(`[RPG][CombatEnd] Erreur loot ${monster.name} :`, e);
      lootLines.push(`<li>${monster.name} : erreur de loot (voir console)</li>`);
    }
  }

  if (!lootLines.length) return;

  await ChatMessage.create({
    content: `<h3>🎁 Butin</h3><ul>${lootLines.join("")}</ul>`
  });

  if (game.rpg?.journal) {
    game.rpg.journal.appendToCampaignJournal("Butin récupéré sur les dépouilles.").catch(() => {});
  }
}
