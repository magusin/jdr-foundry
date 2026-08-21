// systems/rpg/module/rules/status-effects.js

import { talentStates, passifStates, dropPassifOnStateLabel } from "./loadout.js";

/**
 * Ce que ce module fait encore, et lui seul :
 *
 *  - `writeStateOn` / `findStateSlot` : la règle d'écriture d'un état dans
 *    `actor.system.etatsActifs` (emplacement par id puis par libellé,
 *    écrasement entier, dépose du passif homonyme). Tout le système passe
 *    par là.
 *  - `sumActiveEffectMods` : la somme des bonus/malus de stats de tous les
 *    états qui agissent — ceux posés, le Talent et le Passif portés.
 *
 * Il portait aussi une SECONDE représentation des effets, héritée
 * (`applyEffect`, `normalizeEffectInstance`, `upsertEffect`,
 * `tickActorEffectsAtTurnStart`, leurs seaux `modsFlat`/`modsPct` figés à
 * six stats) : plus rien ne l'appelait depuis que les zones et le catalogue
 * MJ sont passés à `writeStateOn`, et elle ne connaissait pas la moitié des
 * champs d'un état — elle est supprimée plutôt que laissée comme un second
 * chemin qui ignore silencieusement ce qu'on lui donne.
 */
function uid() {
  return foundry.utils.randomID();
}

function n(x) {
  return Number(x) || 0;
}

function deepClone(o) {
  return foundry.utils.deepClone(o ?? {});
}

function normalizeStateV2(st) {
  if (!st) return null;

  // Si c’est déjà ton format V2 (sheet)
  if (st.label && (st.mods || st.dot || st.type || st.isAura != null)) {
    const out = foundry.utils.deepClone(st);
    out.id = String(out.id ?? foundry.utils.randomID());
    out.label = String(out.label ?? "État").trim() || "État";
    out.type = String(out.type ?? "custom");
    out.isAura = !!out.isAura;

    out.duration = Math.max(1, Number(out.duration ?? out.remaining ?? 1) || 1);
    out.remaining = Math.max(0, Number(out.remaining ?? out.duration) || 0);
    out.cleanseDC = Math.max(0, Number(out.cleanseDC ?? 0) || 0);

    out.dot = out.dot ?? {};
    out.dot.flat = Number(out.dot.flat ?? 0) || 0;
    out.dot.formula = String(out.dot.formula ?? "").trim();
    out.dot.perTick = Number(out.dot.perTick ?? out.dot.flat) || 0;

    out.mods = out.mods ?? {};
    out.aura = out.aura ?? null;
    if (out.isAura) {
      out.aura = out.aura ?? {};
      out.aura.min = Number(out.aura.min ?? 0) || 0;
      out.aura.max = Number(out.aura.max ?? 0) || 0;
      out.aura.target = String(out.aura.target ?? "allies");
      out.aura.key = String(out.aura.key ?? out.label ?? "aura");
    }
    return out;
  }

  // Si c’est l’ancien format V1 (modsFlat/modsPct + dot.perTick ou dot.base/per/perStep)
  if (st.key && st.label && (st.modsFlat || st.modsPct || st.dot)) {
    const out = {
      id: String(st.id ?? foundry.utils.randomID()),
      label: String(st.label ?? "État").trim() || "État",
      type: String(st.key ?? "custom"),
      isAura: false,
      duration: Math.max(1, Number(st.remaining ?? 1) || 1),
      remaining: Math.max(0, Number(st.remaining ?? 0) || 0),
      cleanseDC: Math.max(0, Number(st.cleanseDC ?? 0) || 0),
      dot: { flat: 0, formula: "", perTick: 0 },
      mods: {}
    };

    // DOT : si perTick existe
    if (st.dot?.perTick != null) {
      out.dot.flat = Number(st.dot.perTick) || 0;
      out.dot.perTick = out.dot.flat;
    }

    // DOT : si “scalé” base/per/perStep (legacyToNew)
    if (st.dot?.base != null || st.dot?.perStep != null) {
      const snap = Number(st.source?.snap ?? 0) || 0;
      const perTick = scaleValue(st.dot, snap); // réutilise TA fonction scaleValue déjà dans ce fichier
      out.dot.flat = Number(perTick) || 0;
      out.dot.perTick = out.dot.flat;
    }

    // Convertit modsFlat/modsPct -> mods[key]={flat,pct}
    const groups = ["principales", "defenses", "ressources", "regen", "move", "initiative"];
    const mapBack = {
      principales: { force: "force", dexterite: "dexterite", intelligence: "intelligence", acuite: "acuite", endurance: "endurance" },
      defenses: { armureFixe: "armureFixe", resistanceFixe: "resistanceFixe", scoreArmure: "scoreArmure", scoreResistance: "scoreResistance" },
      ressources: { pvMax: "pvMax", manaMax: "manaMax" },
      regen: { pv: "regenPv", mana: "regenMana" },
      move: { vitesse: "vitesse" },
      initiative: { mod: "initiativeMod" }
    };

    for (const g of groups) {
      const f = st.modsFlat?.[g] ?? {};
      const p = st.modsPct?.[g] ?? {};
      for (const [k, v2Key] of Object.entries(mapBack[g] ?? {})) {
        const flat = Number(f?.[k] ?? 0) || 0;
        const pct = Number(p?.[k] ?? 0) || 0;
        if (flat !== 0 || pct !== 0) out.mods[v2Key] = { flat, pct };
      }
    }

    return out;
  }

  // Si c’est très vieux format (name/duration/dotFlat/debuff)
  if (st.name || st.duration || st.debuff || st.dotFlat != null) {
    const v1 = legacyToNew(st, null);   // tu as déjà legacyToNew dans ce fichier
    return normalizeStateV2(v1);        // convertit ensuite en V2
  }

  return null;
}

/**
 * Sommes des debuffs à appliquer en "temps réel" dans prepareDerivedData()
 * Retour: { flat, pct }
 */
function add(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  while (parts.length > 1) {
    const k = parts.shift();
    cur[k] = cur[k] ?? {};
    cur = cur[k];
  }
  const last = parts[0];
  cur[last] = (Number(cur[last]) || 0) + (Number(value) || 0);
}

const KEY_TO_BUCKET = {
  // principales
  force: ["principales", "force"],
  intelligence: ["principales", "intelligence"],
  dexterite: ["principales", "dexterite"],
  acuite: ["principales", "acuite"],
  endurance: ["principales", "endurance"],

  // defenses
  armureFixe: ["defenses", "armureFixe"],
  resistanceFixe: ["defenses", "resistanceFixe"],
  scoreArmure: ["defenses", "scoreArmure"],
  scoreResistance: ["defenses", "scoreResistance"],

  // ressources max
  pvMax: ["ressources", "pvMax"],
  manaMax: ["ressources", "manaMax"],

  // regen
  regenPv: ["regen", "pv"],
  regenMana: ["regen", "mana"],

  // move
  vitesse: ["move", "vitesse"],

  // initiative
  initiativeMod: ["initiative", "mod"],

  // combat — bonus direct à la chance de toucher (réduit le TN nécessaire)
  toucherPhysique: ["combat", "toucherPhysique"],
  toucherMagique: ["combat", "toucherMagique"],

  // ressources — fatigue max (équipement/buffs)
  fatigueMax: ["ressources", "fatigueMax"],

  // charge — capacité de transport (le sheet l'offrait déjà sans qu'il soit câblé)
  podsMax: ["charge", "podsMax"]
};

/**
 * Emplacement qu'un état ENTRANT doit occuper dans `system.etatsActifs`.
 *
 * L'id d'abord — deux poses de la même source se rafraîchissent —, puis le
 * LIBELLÉ, à la casse près. Deux « Légèreté » venus de deux sorts différents
 * portaient jusqu'ici deux id distincts : la cible se retrouvait avec deux
 * lignes homonymes, deux décomptes indépendants et leurs bonus additionnés,
 * sans que rien à l'écran ne le laisse deviner. Le dernier posé gagne,
 * meilleur ou non — c'est la règle de table, et c'est au joueur de regarder
 * avant de lancer.
 *
 * @returns {number} index à écraser, ou -1 pour ajouter à la suite.
 */
export function findStateSlot(list, id, label, incoming = null) {
  const arr = Array.isArray(list) ? list : [];
  const byId = arr.findIndex(st => String(st?.id ?? "") === String(id ?? ""));
  if (byId >= 0) return byId;

  const key = String(label ?? "").trim().toLowerCase();
  if (!key) return -1;

  // Une BLESSURE et un état ne s'apparient jamais, même sous le même nom.
  // « Saignement » existe des deux côtés : dans WOUND_LIBRARY (permanent,
  // seul un soin du MJ l'enlève) et dans EFFECT_LIBRARY (physique,
  // temporaire). Sans cette séparation, un coup de dague posant un
  // saignement de 3 tours écrasait la blessure permanente, qui disparaissait
  // à l'expiration — une guérison gratuite — et l'inverse effaçait le
  // saignement en cours.
  const wound = isWoundState(incoming ?? { label });
  return arr.findIndex(st =>
    String(st?.label ?? "").trim().toLowerCase() === key && isWoundState(st) === wound);
}

/** Une blessure localisée (wound-library.js), par opposition à un état. */
function isWoundState(st) {
  return String(st?.type ?? "") === "wound";
}

/**
 * Écrit un état sur un acteur en appliquant la règle d'insertion du système.
 *
 * Un seul endroit pour les trois gestes qui vont toujours ensemble : trouver
 * l'emplacement (id, sinon libellé — findStateSlot), écraser l'entrée EN
 * ENTIER, puis déposer un passif qui accorderait le même libellé (il ne vit
 * pas dans `etatsActifs`, donc rien ne l'aurait remplacé et ses mods se
 * seraient ajoutés à ceux du nouvel état, invisibles).
 *
 * Les chemins qui écrivent plusieurs états d'un coup (attack-resolve.js) ou
 * qui reconstruisent la liste entière (auras.js) gardent leur propre boucle
 * et appellent les deux briques directement — c'est la même règle, appliquée
 * au bon grain.
 *
 * @returns {Promise<{replaced: string|null, droppedPassif: string|null}>}
 */
export async function writeStateOn(actor, state, { recompute = true } = {}) {
  if (!actor || !state) return { replaced: null, droppedPassif: null };

  const list = Array.isArray(actor.system?.etatsActifs)
    ? deepClone(actor.system.etatsActifs) : [];

  const entry = { ...state, id: String(state.id || uid()) };
  const idx = findStateSlot(list, entry.id, entry.label, entry);
  const replaced = idx >= 0 ? String(list[idx]?.label ?? "") : null;
  // L'entrée entrante gagne ENTIÈREMENT, son id compris : c'est sous cet id
  // que l'appelant la retrouvera (l'annulation d'une action retire les états
  // qu'elle a posés par {actorId, stateId} — action-budget.js), et garder
  // l'ancien id l'aurait rendue introuvable.
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  await actor.update({ "system.etatsActifs": list });

  const droppedPassif = await dropPassifOnStateLabel(actor, entry.label);

  if (recompute && game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);

  return { replaced, droppedPassif };
}

export function sumActiveEffectMods(actor) {
  const states = [
    ...(Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : []),
    ...passifStates(actor),
    // Le Talent porté (loadout.js) passe par le même chemin que les sorts
    // passifs, et pour la même raison : ses mods sont recalculés ici à
    // chaque prepareDerivedData, donc ils suivent l'équipement sans qu'aucun
    // état n'ait à être posé puis retiré.
    ...talentStates(actor)
  ];

  const out = {
    flat: {
      principales: {}, defenses: {}, ressources: {}, regen: {}, move: {}, initiative: {}
    },
    pct: {
      principales: {}, defenses: {}, ressources: {}, regen: {}, move: {}, initiative: {}
    },
    dot: {
      flatTotal: 0,
      formulas: []
    }
  };

  for (const stRaw of states) {
    // ── Normalise vers format V2 si besoin ──────────────────────
    let st = stRaw;
    if (!st?.mods && (st?.debuff || st?.modsFlat || st?.modsPct)) {
      st = normalizeStateV2(stRaw) ?? stRaw;
    }

    const mods = st?.mods ?? {};

    // DOT
    const dotFlat = Number(st?.dot?.flat ?? st?.dot?.perTick ?? 0) || 0;
    if (dotFlat) out.dot.flatTotal += dotFlat;

    const dotFormula = String(st?.dot?.formula ?? "").trim();
    if (dotFormula) out.dot.formulas.push(dotFormula);

    // MODS flat / pct
    for (const [key, mod] of Object.entries(mods)) {
      const map = KEY_TO_BUCKET[key];
      if (!map) continue;

      const flat = Number(mod?.flat ?? 0) || 0;
      const pct  = Number(mod?.pct  ?? 0) || 0;

      const pathBase = map[0] + "." + map[1];
      if (flat) add(out.flat, pathBase, flat);
      if (pct)  add(out.pct,  pathBase, pct);
    }
  }

  return out;
}

