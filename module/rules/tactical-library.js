// module/rules/tactical-library.js
//
// Positions tactiques (couverture, angle mort, flanc) : le MJ juge la
// situation sur la carte (mur, obstacle, encerclement) et applique un
// statut correspondant — pas de détection géométrique automatique
// (cohérent avec le reste du système : le MJ décide, l'outil applique).
//
// ⚠️ Ces états portent sur la CIBLE, et c'est pourquoi ils passent par
// l'esquive et plus par le toucher. La première version écrivait un malus de
// `toucherPhysique`/`toucherMagique` sur le personnage abrité — c'est-à-dire
// rendait SES propres coups plus durs, sans rien changer à ceux qu'il
// reçoit : computeTN ne lit le toucher que chez l'attaquant. Le module était
// en outre exposé (game.rpg.tactical) sans qu'aucune macro ni fiche ne s'en
// serve. `esquive` (combat.js, actor.js) est le pendant défensif du toucher :
// +N au seuil de toute attaque adverse visant le porteur, −N quand il est
// exposé.
//
// `group` : un porteur n'a qu'UNE position par groupe. Les libellés diffèrent
// (« Couverture légère » / « moyenne »), donc le remplacement par libellé de
// writeStateOn ne les départagerait pas : `applyTactical` retire d'abord la
// position précédente du même groupe.

export const TACTICAL_LIBRARY = {
  couverture_legere: {
    key: "couverture_legere", label: "Couverture légère", icon: "icons/svg/shield.svg", group: "couverture",
    hint: "muret, tonneau, broussailles : +1 au seuil des attaques reçues",
    mods: { esquive: { flat: 1, pct: 0 } }
  },
  couverture_moyenne: {
    key: "couverture_moyenne", label: "Couverture moyenne", icon: "icons/svg/shield.svg", group: "couverture",
    hint: "pilier, angle de mur, meurtrière large : +2",
    mods: { esquive: { flat: 2, pct: 0 } }
  },
  couverture_totale: {
    key: "couverture_totale", label: "Couverture totale", icon: "icons/svg/shield.svg", group: "couverture",
    hint: "meurtrière, créneau : +4 (on ne voit presque plus la cible)",
    mods: { esquive: { flat: 4, pct: 0 } }
  },
  flanc: {
    key: "flanc", label: "Pris en flanc", icon: "icons/svg/sword.svg", group: "exposition",
    hint: "encerclé par deux adversaires de part et d'autre : −2",
    mods: { esquive: { flat: -2, pct: 0 } }
  },
  angle_mort: {
    key: "angle_mort", label: "Dans l'angle mort", icon: "icons/svg/blind.svg", group: "exposition",
    hint: "attaqué par derrière ou sans le voir venir : −3",
    mods: { esquive: { flat: -3, pct: 0 } }
  },
  surplomb: {
    key: "surplomb", label: "En contrebas", icon: "icons/svg/falling.svg", group: "exposition",
    hint: "l'adversaire domine depuis une hauteur : −1",
    mods: { esquive: { flat: -1, pct: 0 } }
  }
};

export function listTactical() {
  return Object.values(TACTICAL_LIBRARY);
}

export function getTacticalDef(key) {
  return TACTICAL_LIBRARY[key] ?? null;
}

/**
 * Construit un état "position tactique" permanent (jusqu'à retrait MJ) —
 * porté par la CIBLE : son esquive monte (couverture) ou baisse (exposée).
 */
export function buildTacticalState(key, { sourceLabel = "" } = {}) {
  const def = getTacticalDef(key);
  if (!def) return null;

  return {
    id: `tactical_${key}_${foundry.utils.randomID(6)}`,
    label: def.label,
    type: "tactical",
    tacticalKey: key,
    tacticalGroup: def.group,
    tag: null,
    isAura: false,
    permanent: true,
    duration: 0,
    remaining: 0,
    dot: { flat: 0, perTick: 0 },
    mods: foundry.utils.deepClone(def.mods ?? {}),
    sourceLabel
  };
}

const groupOf = (st) => st?.tacticalGroup ?? getTacticalDef(st?.tacticalKey)?.group
  ?? Object.values(TACTICAL_LIBRARY).find(d => d.label === st?.label)?.group ?? null;

/**
 * Retire les positions tactiques d'un acteur — toutes, ou celles d'un groupe.
 * Client du MJ uniquement (écrit sur un acteur qui n'est pas forcément le sien).
 */
export async function clearTactical(actor, group = null) {
  const list = Array.isArray(actor?.system?.etatsActifs) ? actor.system.etatsActifs : [];
  const keep = list.filter(st => st?.type !== "tactical" || (group && groupOf(st) !== group));
  if (keep.length === list.length) return 0;
  await actor.update({ "system.etatsActifs": keep });
  return list.length - keep.length;
}

/** Pose une position, en remplaçant celle du même groupe. Client du MJ uniquement. */
export async function applyTactical(actor, key) {
  const def = getTacticalDef(key);
  if (!actor || !def) return null;
  await clearTactical(actor, def.group);
  const state = buildTacticalState(key, { sourceLabel: "Position (MJ)" });
  const { writeStateOn } = await import("./status-effects.js");
  await writeStateOn(actor, state);
  return state;
}
