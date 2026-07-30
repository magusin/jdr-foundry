// systems/rpg/module/rules/combat-end.js
//
// Géré via le hook "deleteCombat" dans init.js.
// Distribue XP + loot entre les PJ qui participaient au combat.

import { appendToCampaignJournal } from "./campaign-journal.js";
import { checkLevelUp } from "./level-up.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Demande au MJ, dans un Dialog, s'il veut distribuer l'XP de ce combat et à
 * qui. Rien n'est jamais attribué automatiquement — le MJ garde la main sur
 * le "si" et le "à qui" avant toute écriture en base.
 *
 * @returns {Promise<{proceed:boolean, selectedIds:string[]}>}
 */
function promptEndOfCombatChoice({ pjs, totalXP, monsterNames }) {
  return new Promise((resolve) => {
    const rows = pjs.map((pj) => `
      <label style="display:flex;align-items:center;gap:6px;padding:2px 0">
        <input type="checkbox" data-pj-id="${pj.id}" checked />
        ${pj.name}
      </label>`).join("");

    const content = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:12px;color:var(--color-text-secondary)">
          ⚔️ Combat contre <b>${monsterNames}</b> terminé — <b>${totalXP} XP</b> à répartir.
          Sélectionne les PJ qui reçoivent leur part, ou ignore pour ne rien attribuer.
        </div>
        <div>${rows}</div>
      </div>`;

    const DialogClass = foundry?.applications?.api?.DialogV2 ?? globalThis.Dialog;
    const isV2 = DialogClass === foundry?.applications?.api?.DialogV2;

    const readSelection = (root) =>
      Array.from(root.querySelectorAll("input[data-pj-id]"))
        .filter((el) => el.checked)
        .map((el) => el.dataset.pjId);

    if (isV2) {
      const dlg = new DialogClass({
        window: { title: "Fin de combat — Attribution d'XP" },
        content,
        buttons: [
          {
            action: "grant",
            label: "✅ Attribuer",
            default: true,
            callback: (_event, _button, dialog) => {
              const root = dialog.element ?? dialog?.form ?? dialog;
              resolve({ proceed: true, selectedIds: readSelection(root) });
            }
          },
          { action: "skip", label: "Ignorer", callback: () => resolve({ proceed: false, selectedIds: [] }) }
        ],
        close: () => resolve({ proceed: false, selectedIds: [] })
      });
      dlg.render(true);
      return;
    }

    new Dialog({
      title: "Fin de combat — Attribution d'XP",
      content,
      buttons: {
        grant: {
          label: "✅ Attribuer",
          callback: (html) => resolve({ proceed: true, selectedIds: readSelection(html?.[0] ?? html) })
        },
        skip: { label: "Ignorer", callback: () => resolve({ proceed: false, selectedIds: [] }) }
      },
      default: "grant",
      close: () => resolve({ proceed: false, selectedIds: [] })
    }, { width: 380 }).render(true);
  });
}

/**
 * Calcule le partage d'XP entre les PJ sélectionnés par le MJ, l'applique,
 * et propose le butin (looté seulement au clic — jamais automatique).
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
  const allPjs = [...pjMap.values()];

  // ── 2. XP total ────────────────────────────────────────────────────────
  let totalXP = 0;
  for (const monster of monsterCombatants) {
    totalXP += n(monster.system?.recompenses?.xp, 0);
  }

  const monsterNamesForPrompt = monsterCombatants.map((m) => m.name).join(", ");

  // ── 3. Le MJ choisit s'il distribue l'XP, et à qui ──────────────────────
  const { proceed, selectedIds } = await promptEndOfCombatChoice({
    pjs: allPjs, totalXP, monsterNames: monsterNamesForPrompt
  });
  if (!proceed) return; // le MJ a choisi de ne rien attribuer

  const pjs = allPjs.filter((p) => selectedIds.includes(p.id));
  if (!pjs.length) return; // personne sélectionné → rien à faire

  // ── 4. Part par PJ ─────────────────────────────────────────────────────
  const share      = totalXP / pjs.length;
  const shareFloor = Math.floor(share);
  const shareRem   = Math.round(totalXP - shareFloor * pjs.length); // arrondi resto

  // ── 5. Applique XP + construit message ─────────────────────────────────
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
    await checkLevelUp(actor);
  }

  // ── 6. Boutons de loot — un par monstre + un global ──────────────────
  const lootableMonsters = monsterCombatants.filter(m => {
    const entries = Array.isArray(m.system?.butin?.entries) ? m.system.butin.entries : [];
    const tableUuid = String(m.system?.butin?.tableUuid ?? "").trim();
    return entries.length > 0 || tableUuid;
  });

  // ── 7. Message récap ───────────────────────────────────────────────────
  const monsterNames = monsterCombatants.map((m) => m.name).join(", ");

  let content =
    `<h3>⚔️ Fin de combat</h3>` +
    `<p><b>Adversaires :</b> ${monsterNames}</p>` +
    `<p><b>XP total :</b> ${totalXP} répartis entre ${pjs.length} PJ(s)</p>` +
    `<ul>${lines.join("")}</ul>`;

  if (lootableMonsters.length) {
    const allIds = lootableMonsters.map(m => m.id).join(",");
    content += `<hr><div style="font-size:13px;font-weight:600;margin-bottom:6px">🎁 Dépouilles</div>`;
    content += `<div style="display:flex;flex-direction:column;gap:4px">`;

    for (const m of lootableMonsters) {
      const entries = Array.isArray(m.system?.butin?.entries) ? m.system.butin.entries : [];
      const preview = entries.slice(0, 3).map(e =>
        `${e.name}${e.tries > 1 ? ` (×${e.tries} essais)` : ""} — ${e.pct}%`
      ).join(", ") + (entries.length > 3 ? `… +${entries.length - 3}` : "");
      content += `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <span style="flex:1;font-size:12px"><b>${m.name}</b>${preview ? `<br><small style="opacity:.6">${preview}</small>` : ""}</span>
          <button type="button" data-action="lootNow" data-monster-ids="${m.id}"
            style="padding:3px 10px;cursor:pointer;border-radius:5px;font-size:11px;white-space:nowrap">
            🎲 Looter
          </button>
        </div>`;
    }

    if (lootableMonsters.length > 1) {
      content += `<div style="margin-top:6px;text-align:center">
        <button type="button" data-action="lootNow" data-monster-ids="${allIds}"
          style="padding:5px 14px;cursor:pointer;border-radius:6px;font-weight:600;width:100%">
          🎁 Tout looter (${lootableMonsters.length} monstres)
        </button>
      </div>`;
    }
    content += `</div>`;
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
/**
 * Résout le loot d'un ou plusieurs monstres.
 * Nouvelle logique : chaque entry a pct (% de chance par essai) + qty (quantité obtenue) + tries (nombre d'essais).
 * Exemple : Dent, 90%, qty=1, tries=5 → 5 jets de 90% → 0 à 5 dents
 */
export async function lootMonsters(monsterIds) {
  if (!game.user.isGM) return;

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

  const lootLines = [];

  for (const id of monsterIds) {
    // Cherche d'abord dans les acteurs du monde, puis dans les tokens de la scène
    const monster = game.actors.get(id)
      ?? canvas?.tokens?.placeables?.find(t => t.id === id || t.actor?.id === id)?.actor;
    if (!monster) continue;

    const tableUuid = String(monster.system?.butin?.tableUuid ?? "").trim();
    const entries   = Array.isArray(monster.system?.butin?.entries) ? monster.system.butin.entries : [];

    try {
      const drops = [];

      // ── Nouveau système : entries[] avec qty + tries ───────────────
      for (const entry of entries) {
        const pct   = Math.min(100, Math.max(0, n(entry.pct, 100)));
        const qty   = Math.max(1, n(entry.qty,  1));
        const tries = Math.max(1, n(entry.tries, 1));
        const itemName = entry.name || "Item inconnu";

        let total = 0;
        for (let t = 0; t < tries; t++) {
          if (Math.random() * 100 < pct) total += qty;
        }

        if (total > 0) drops.push(`${itemName} ×${total}`);
      }

      if (drops.length) {
        lootLines.push(`<li><b>${monster.name}</b> : ${drops.join(", ")}</li>`);
      } else if (entries.length) {
        lootLines.push(`<li><b>${monster.name}</b> : rien cette fois.</li>`);
      }

      // ── Fallback : RollTable Foundry ──────────────────────────────
      if (!entries.length && tableUuid) {
        const table = await fromUuid(tableUuid);
        if (!table) { lootLines.push(`<li>${monster.name} : table introuvable</li>`); continue; }
        const { results } = await table.roll();
        const names = results.map(r => r.text ?? r.name ?? "?").join(", ") || "rien d'intéressant";
        lootLines.push(`<li><b>${monster.name}</b> : ${names}</li>`);
      }
    } catch (e) {
      console.error(`[RPG][Loot] Erreur ${monster.name} :`, e);
      lootLines.push(`<li>${monster.name} : erreur (voir console)</li>`);
    }
  }

  if (!lootLines.length) {
    ui.notifications?.info?.("Aucun butin configuré sur ces monstres.");
    return;
  }

  await ChatMessage.create({
    content: `<h3>🎁 Butin</h3><ul>${lootLines.join("")}</ul>`
  });

  if (game.rpg?.journal) {
    game.rpg.journal.appendToCampaignJournal("Butin récupéré sur les dépouilles.").catch(() => {});
  }
}
