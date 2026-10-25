// module/rules/consumables.js
//
// « Je bois ma potion. » — jusqu'ici, rien dans le système ne CONSOMMAIT
// quoi que ce soit : un consommable portait un champ `effet` en texte libre,
// la pile `system.qte` ne descendait jamais, et le MJ ajustait les PV à la
// main en lisant la ligne. Ce module donne à un consommable un usage
// structuré et le fait passer par le même circuit que tout le reste :
// le joueur déclare, le MJ valide, la résolution applique.
//
// L'usage vit dans `system.use` (fiche générique, MJ) :
//   pv / mana    formule (« 2d6+2 ») ou nombre — rendus, plafonnés au max ;
//   fatigue      formule — fatigue RETIRÉE (jamais sous 0) ;
//   cure         libellés d'états retirés, séparés par des virgules
//                (« Empoisonnement, Saignement ») — comparés sans casse au
//                libellé de l'état, comme partout ailleurs (findStateSlot) ;
//   target       "self" (défaut) ou "ally" : à portée de contact (1,5 m),
//                on peut faire boire un allié ou panser son voisin.
//
// Trois règles :
//
// - **Une blessure (`type: "wound"`) n'est jamais guérie par un objet.** Elle
//   est permanente et soignée uniquement par la macro du MJ ; « Saignement »
//   existe des deux côtés (blessure ET état ordinaire), et un bandage qui
//   effacerait la blessure la soignerait gratuitement — le piège même que
//   `findStateSlot` évite déjà en ne mélangeant pas les deux familles.
// - **La pile est décrémentée à la résolution, pas à la déclaration** — un MJ
//   qui refuse ne doit rien avoir coûté (même règle que les munitions,
//   ammo.js). À 0, l'objet est supprimé : rien ne le référence par id après
//   la résolution, contrairement à une arme de jet (cf. ammo.js) qui doit
//   survivre à son propre jet de dégâts.
// - **En combat, l'usage coûte le slot « Récupération »** (action-budget.js).
//   Le joueur ne peut pas écrire le budget (drapeaux du Combat, MJ seul) :
//   la disponibilité est LUE à la déclaration, et le slot est confirmé par le
//   client du MJ à la validation — même découpage que macro/menu.js.

import { gmOnly, hpSecret } from "./chat-visibility.js";
import { getBudget, saveBudget, canUseSlot, confirmSlot, SLOT_DEFS } from "./action-budget.js";
import { checkRange } from "../utils/grid.js";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const SLOT = "recuperation";
const CONTACT_M = 1.5;

/** Usage normalisé d'un consommable, ou null s'il n'en a aucun. */
export function consumableUse(item) {
  if (item?.type !== "consumable") return null;
  const u = item.system?.use ?? {};
  const use = {
    pv: String(u.pv ?? "").trim(),
    mana: String(u.mana ?? "").trim(),
    fatigue: String(u.fatigue ?? "").trim(),
    cure: String(u.cure ?? "").split(",").map(s => s.trim()).filter(Boolean),
    target: u.target === "ally" ? "ally" : "self"
  };
  const any = [use.pv, use.mana, use.fatigue].some(f => f && f !== "0") || use.cure.length;
  return any ? use : null;
}

/** Résumé lisible (« +2d6+2 PV · −1d4 fatigue · guérit Empoisonnement »). */
export function useSummary(use) {
  if (!use) return "";
  const p = [];
  if (use.pv && use.pv !== "0") p.push(`+${use.pv} PV`);
  if (use.mana && use.mana !== "0") p.push(`+${use.mana} mana`);
  if (use.fatigue && use.fatigue !== "0") p.push(`−${use.fatigue} fatigue`);
  if (use.cure.length) p.push(`guérit ${use.cure.join(", ")}`);
  if (use.target === "ally") p.push("sur soi ou un allié au contact");
  return p.join(" · ");
}

function combatEngaged() {
  const c = game.combat;
  return !!(c?.active && Number(c.round) > 0);
}

function combatantOf(actor) {
  const c = game.combat;
  if (!c) return null;
  return c.combatants.find(x => x.actor?.uuid === actor.uuid)
      ?? c.combatants.find(x => x.actorId === actor.id) ?? null;
}

/**
 * Déclare l'usage d'un consommable (client du joueur ou du MJ).
 * Renvoie { ok, reason? }.
 */
export async function declareConsumableUse(actor, item, { targetToken = null } = {}) {
  const use = consumableUse(item);
  if (!use) return { ok: false, reason: `${item?.name ?? "Cet objet"} n'a pas d'usage défini (fiche de l'objet, partie « Usage »).` };
  if (n(item.system?.qte, 1) < 1) return { ok: false, reason: `Plus de ${item.name}.` };

  // Cible : soi, ou un allié désigné au contact si l'objet le permet.
  const selfToken = actor.getActiveTokens?.()?.[0] ?? null;
  let target = actor;
  const picked = targetToken ?? Array.from(game.user.targets ?? [])[0] ?? null;
  if (use.target === "ally" && picked?.actor && picked.actor.uuid !== actor.uuid) {
    if (selfToken) {
      const r = checkRange(selfToken, picked, 0, CONTACT_M);
      if (!r.ok) return { ok: false, reason: `${picked.actor.name} est trop loin (${Math.round(r.dist * 10) / 10} m — contact : ${CONTACT_M} m).` };
    }
    target = picked.actor;
  }

  // Budget : lu seulement (un joueur ne peut pas écrire les drapeaux du Combat).
  if (combatEngaged()) {
    const cb = combatantOf(actor);
    if (cb && !canUseSlot(getBudget(game.combat, cb.id), SLOT)) {
      return { ok: false, reason: `Plus d'action « ${SLOT_DEFS[SLOT].label} » disponible ce tour.` };
    }
  }

  const onWhom = target === actor ? "" : ` sur <b>${target.name}</b>`;
  const content = `
    <div class="rpg-consumable-use" style="font-size:13px">
      🧪 <b>${actor.name}</b> utilise <b>${item.name}</b>${onWhom}
      <div style="opacity:.8;font-size:11px;margin-top:2px">${useSummary(use)}${combatEngaged() ? ` · ${SLOT_DEFS[SLOT].icon} ${SLOT_DEFS[SLOT].label}` : ""}</div>
      <div class="rpg-consumable-gm" style="display:flex;gap:6px;margin-top:8px">
        <button type="button" class="rpg-consumable-resolve" data-result="ok" style="flex:1">✅ Valider</button>
        <button type="button" class="rpg-consumable-resolve" data-result="no" style="flex:1">❌ Refuser</button>
      </div>
    </div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { rpg: {
      type: "consumableUse",
      actorUuid: actor.uuid, actorId: actor.id,
      targetUuid: target.uuid, itemId: item.id, itemName: item.name
    } }
  });
  return { ok: true };
}

async function rollFormula(f) {
  if (!f || f === "0") return null;
  if (/^-?\d+$/.test(f)) return { total: Number(f), formula: f, roll: null };
  const roll = await new Roll(f).evaluate();
  return { total: Math.max(0, Math.round(roll.total)), formula: f, roll };
}

/** Applique l'usage (client du MJ uniquement). Renvoie le HTML de résultat. */
export async function resolveConsumableUse(flags) {
  const actor = flags.actorUuid ? await fromUuid(flags.actorUuid) : game.actors.get(flags.actorId);
  const target = flags.targetUuid ? (await fromUuid(flags.targetUuid)) ?? actor : actor;
  if (!actor || !target) throw new Error("Acteur introuvable.");
  const item = actor.items.get(flags.itemId);
  if (!item) throw new Error(`${flags.itemName ?? "L'objet"} n'est plus dans le sac de ${actor.name}.`);
  const qte = n(item.system?.qte, 1);
  if (qte < 1) throw new Error(`${actor.name} n'a plus de ${item.name}.`);
  const use = consumableUse(item);
  if (!use) throw new Error(`${item.name} n'a plus d'usage défini.`);

  const sys = target.system ?? {};
  const upd = {};
  const lines = [];
  const rolls = [];

  const pvR = await rollFormula(use.pv);
  if (pvR) {
    const cur = n(sys.ressources?.pv?.valeur), max = n(sys.ressources?.pv?.max, cur);
    const next = Math.min(max, cur + pvR.total);
    upd["system.ressources.pv.valeur"] = next;
    if (pvR.roll) rolls.push(pvR.roll);
    lines.push(`❤️ +${next - cur} PV ${hpSecret(target, `(${cur} → ${next})`)}${pvR.roll ? ` <span style="opacity:.6">[${pvR.formula} → ${pvR.total}]</span>` : ""}`);
  }
  const mR = await rollFormula(use.mana);
  if (mR) {
    const cur = n(sys.ressources?.mana?.valeur), max = n(sys.ressources?.mana?.max, cur);
    const next = Math.min(max, cur + mR.total);
    upd["system.ressources.mana.valeur"] = next;
    if (mR.roll) rolls.push(mR.roll);
    lines.push(`🔷 +${next - cur} mana ${hpSecret(target, `(${cur} → ${next})`)}`);
  }
  const fR = await rollFormula(use.fatigue);
  if (fR) {
    const cur = n(sys.ressources?.fatigue?.valeur);
    const next = Math.max(0, cur - fR.total);
    upd["system.ressources.fatigue.valeur"] = next;
    if (fR.roll) rolls.push(fR.roll);
    lines.push(`😮‍💨 −${cur - next} fatigue (${cur} → ${next})`);
  }

  let auraTouched = false;
  if (use.cure.length) {
    const want = new Set(use.cure.map(s => s.toLowerCase()));
    const list = Array.isArray(sys.etatsActifs) ? sys.etatsActifs : Object.values(sys.etatsActifs ?? {});
    const removed = [];
    const keep = list.filter(st => {
      const hit = st?.type !== "wound" && st?.type !== "auraApplied" && want.has(String(st?.label ?? "").toLowerCase());
      if (hit) { removed.push(st.label); if (st.isAura) auraTouched = true; }
      return !hit;
    });
    if (removed.length) {
      upd["system.etatsActifs"] = keep;
      lines.push(`✨ Guérit : ${removed.join(", ")}`);
    } else {
      lines.push(`<span style="opacity:.7">Aucun état « ${use.cure.join(", ")} » à guérir.</span>`);
    }
  }

  if (Object.keys(upd).length) await target.update(upd);
  if (auraTouched) await game.rpg?.auras?.refreshAuras?.();

  // La pile, puis l'action du tour.
  if (qte - 1 <= 0) await item.delete();
  else await item.update({ "system.qte": qte - 1 });

  if (combatEngaged()) {
    const cb = combatantOf(actor);
    if (cb) {
      const budget = getBudget(game.combat, cb.id);
      if (canUseSlot(budget, SLOT)) await saveBudget(game.combat, cb.id, confirmSlot(budget, SLOT));
      else lines.push(gmOnly(`⚠️ Plus de slot « ${SLOT_DEFS[SLOT].label} » ce tour — validé quand même.`));
    }
  }

  const left = Math.max(0, qte - 1);
  return {
    rolls,
    html: `<div style="font-size:13px">🧪 <b>${actor.name}</b> — <b>${item.name}</b>${target !== actor ? ` → <b>${target.name}</b>` : ""}
      <div style="margin-top:4px">${lines.join("<br>") || "—"}</div>
      <div style="opacity:.6;font-size:11px;margin-top:4px">${left} restant(s)</div></div>`
  };
}

/** Branché dans renderChatMessageHTML. */
export function bindConsumableChatButtons(htmlEl, message) {
  const flags = message?.flags?.rpg ?? {};
  if (flags.type !== "consumableUse") return;
  const root = htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
  if (!root) return;
  if (!game.user.isGM) { root.querySelector(".rpg-consumable-gm")?.remove(); return; }
  if (root.dataset.rpgConsumableBound === "1") return;
  root.dataset.rpgConsumableBound = "1";

  const buttons = root.querySelectorAll(".rpg-consumable-resolve");
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      for (const b of buttons) b.disabled = true;
      try {
        if (btn.dataset.result !== "ok") {
          await message.update({ content: `<div style="font-size:13px;opacity:.8">❌ Usage de <b>${flags.itemName}</b> refusé.</div>`, "flags.rpg.type": "consumableUseDone" });
          return;
        }
        const res = await resolveConsumableUse(flags);
        await message.delete();
        await ChatMessage.create({ content: res.html, rolls: res.rolls, speaker: message.speaker });
      } catch (e) {
        console.error("[RPG][Consumable]", e);
        ui.notifications?.error?.(`Usage impossible : ${e?.message ?? e}`);
        for (const b of buttons) b.disabled = false;
      }
    });
  }
}
