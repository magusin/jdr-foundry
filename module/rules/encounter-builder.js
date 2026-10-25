// module/rules/encounter-builder.js
//
// « Il me faut un combat pour un groupe de niveau 4, ce soir, dans la crypte. »
//
// GUIDE_PROGRESSION.md §3 donne la règle — une rencontre normale vaut
// 1 point de menace (piétaille 0,15, soldat 0,33, rôdeur/mage 0,4, brute 0,5,
// élite 1, boss 2,5) — mais la laisse à l'arithmétique du MJ. Ce module la
// fait : il lit le bestiaire du MONDE (les acteurs `monster` qui ont des
// plages de génération), donne à chacun son poids, et compose une rencontre
// qui tombe sur le budget demandé.
//
// D'où vient le poids d'une créature, dans l'ordre :
//   1. `flags.rpg.archetype` (posé par le bouton ⚡ de la fiche et par
//      l'installateur de contenu) → `fight` de l'archétype : c'est la valeur
//      même que le guide publie ;
//   2. sinon, le PALIER de la pesée au niveau voulu (computeMonsterBandValues),
//      converti par TIER_WEIGHT. C'est l'estimation qu'un MJ ferait lui-même
//      en lisant la fiche, et elle tient pour les monstres écrits à la main.
//
// Le budget est proportionnel à la taille du groupe (×taille/3) : les poids
// du guide sont calibrés pour trois PJ, et une créature fait autant de dégâts
// à un groupe de cinq — elle les répartit simplement sur plus de monde.
//
// Les jetons sont posés avec `flags.rpg.forceLevel`, que lit le hook
// preCreateToken d'init.js : sans lui, chaque exemplaire tirerait un niveau au
// hasard dans ses plages, et la rencontre calibrée au niveau 4 sortirait avec
// un loup de niveau 8.

import { getArchetype } from "./monster-archetypes.js";
import { computeMonsterBandValues } from "./item-value.js";
import { closestConfiguredLevel } from "../monster-gen.js";

const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const DIFFICULTIES = {
  facile:    { label: "Facile (échauffement)",           budget: 0.6 },
  standard:  { label: "Standard (une rencontre normale)", budget: 1.0 },
  difficile: { label: "Difficile (fin de session)",       budget: 1.5 },
  mortel:    { label: "Mortel (risque de mort réel)",     budget: 2.2 },
  boss:      { label: "Boss (combat de fin d'arc)",       budget: 2.6 }
};

/** Poids de rencontre par palier de pesée, quand l'archétype n'est pas connu. */
export const TIER_WEIGHT = { trivial: 0.15, mineur: 0.33, serieux: 0.45, elite: 1, boss: 2.5 };

/**
 * Correction de poids par niveau d'écart : ×1,3 par niveau AU-DESSUS du
 * groupe, ÷1,3 par niveau en dessous. Mesurée sur la pesée (menace × survie
 * d'une bande de niveau L contre un groupe de niveau L ± 1, ± 2) pour cinq
 * créatures du bestiaire de trois archétypes : +1 → ×1,10 à ×1,38, +2 →
 * ×1,45 à ×2,1, −1 → ×0,72 à ×0,83, −2 → ×0,58 à ×0,67. Sans elle, un
 * loup de niveau 3 comptait pour 0,33 contre un groupe de niveau 1, alors
 * qu'il en vaut 0,56.
 */
export const LEVEL_GAP_FACTOR = 1.3;

/** Plafond d'exemplaires : au-delà, un tour de table dure une heure. */
const MAX_CREATURES = 8;

/**
 * Le bestiaire utilisable au niveau voulu : chaque monstre du monde qui a des
 * plages de génération, avec le niveau auquel il sera posé (le plus proche de
 * celui demandé) et son poids de rencontre.
 *
 * Un monstre dont aucun niveau configuré n'est à moins de 2 du niveau voulu
 * est écarté : ses plages décrivent une autre créature que celle qu'on
 * cherche (un loup « 1,2 » n'a rien à faire contre un groupe de niveau 8,
 * même si c'est son niveau le plus proche).
 */
export function listBestiary({ level = 1, actors = null, maxGap = 2 } = {}) {
  const pool = actors ?? Array.from(globalThis.game?.actors ?? []);
  const out = [];
  for (const a of pool) {
    if (a?.type !== "monster") continue;
    const bands = a.system?.gen?.bands ?? {};
    if (!Object.keys(bands).length) continue;
    const lvl = closestConfiguredLevel(a, level);
    if (!lvl || Math.abs(lvl - level) > maxGap) continue;

    const archKey = a.flags?.rpg?.archetype ?? a.getFlag?.("rpg", "archetype") ?? null;
    let weight = null, tierKey = null, xp = null;
    if (archKey) weight = getArchetype(archKey).fight;
    try {
      const v = computeMonsterBandValues(a).find(x => x.lvl === lvl);
      tierKey = v?.value?.tier?.key ?? null;
      if (weight == null && tierKey) weight = TIER_WEIGHT[tierKey] ?? null;
    } catch (e) { console.warn("[RPG] encounter: pesée impossible pour", a.name, e); }
    const xr = bands[String(lvl)]?.xpReward;
    if (Array.isArray(xr)) xp = Math.round((n(xr[0]) + n(xr[1])) / 2);
    if (weight == null) continue;
    const baseWeight = weight;
    weight = Math.round(baseWeight * Math.pow(LEVEL_GAP_FACTOR, lvl - level) * 100) / 100;

    out.push({
      actor: a, id: a.id, name: a.name, level: lvl, weight, baseWeight, gap: lvl - level,
      archetype: archKey, tier: tierKey,
      theme: a.flags?.rpg?.theme ?? a.getFlag?.("rpg", "theme") ?? "aucun",
      folder: a.folder?.id ?? null, xp: xp ?? 0
    });
  }
  return out;
}

/**
 * Compose une rencontre.
 *
 * Glouton aléatoire : une créature « de tête » (la plus lourde qui tient dans
 * le budget, tirée parmi celles-là), puis des créatures qui remplissent le
 * reste, en préférant à 75 % le même thème ou le même dossier que la tête —
 * une meute de loups avec son chef, pas un loup, un squelette et un mage de
 * feu. On s'arrête dans la fenêtre [budget − 0,12 ; budget + 0,12].
 *
 * Deux règles du guide sont appliquées plutôt que conseillées : pas de boss
 * avant le niveau 3 (au niveau 1-2 il est au seuil du massacre), et pas
 * d'autre créature sérieuse à côté d'un boss — seulement de la piétaille.
 */
export function buildEncounter({ level = 1, size = 3, difficulty = "standard", theme = "", pool = null, rng = Math.random } = {}) {
  const diff = DIFFICULTIES[difficulty] ?? DIFFICULTIES.standard;
  const budget = Math.round(diff.budget * Math.max(1, n(size, 3)) / 3 * 100) / 100;
  let cands = (pool ?? listBestiary({ level })).filter(c => c.weight > 0);
  if (theme) cands = cands.filter(c => c.theme === theme);
  if (level < 3) cands = cands.filter(c => c.weight < 2.5);
  if (!cands.length) return { budget, total: 0, entries: [], xp: 0, warning: "Aucun monstre utilisable à ce niveau (plages de génération manquantes, ou thème trop restrictif)." };

  const pick = (list) => list[Math.floor(rng() * list.length)];
  const fits = (c, room) => c.weight <= room + 0.12;

  const chosen = [];
  let total = 0;
  // Tête : une créature qui porte au moins un tiers du budget (sinon on
  // n'aurait qu'une nuée de figurants), de préférence au niveau exact du
  // groupe — un écart de niveau est déjà compté dans le poids, mais une
  // créature à son propre niveau est celle que le calibrage décrit le mieux.
  const fitting = cands.filter(c => fits(c, budget));
  const exact = fitting.filter(c => c.gap === 0 && c.weight >= budget / 3);
  const heavy = fitting.filter(c => c.weight >= budget / 3);
  const heads = exact.length && rng() < 0.7 ? exact : (heavy.length ? heavy : fitting);
  if (!heads.length) {
    const lightest = cands.slice().sort((a, b) => a.weight - b.weight)[0];
    chosen.push(lightest); total = lightest.weight;
  } else {
    const head = pick(heads);
    chosen.push(head); total = head.weight;
  }
  const head = chosen[0];
  const bossLed = head.weight >= 2.5;

  let guard = 40;
  while (total < budget - 0.12 && chosen.length < MAX_CREATURES && guard-- > 0) {
    const room = budget - total;
    let opts = cands.filter(c => fits(c, room));
    if (bossLed) opts = opts.filter(c => c.weight <= 0.15);
    if (!opts.length) break;
    const kin = opts.filter(c => c.id !== head.id || c.weight <= 0.5)
      .filter(c => (head.theme !== "aucun" && c.theme === head.theme) || (head.folder && c.folder === head.folder));
    const c = (kin.length && rng() < 0.75) ? pick(kin) : pick(opts);
    chosen.push(c); total += c.weight;
  }

  // Regroupe les exemplaires identiques.
  const byId = new Map();
  for (const c of chosen) {
    const e = byId.get(c.id) ?? { ...c, count: 0 };
    e.count += 1; byId.set(c.id, e);
  }
  const entries = Array.from(byId.values()).sort((a, b) => b.weight - a.weight);
  const xp = entries.reduce((s, e) => s + e.xp * e.count, 0);
  return { budget, total: Math.round(total * 100) / 100, entries, xp, difficulty, level, size };
}

/**
 * Pose la rencontre sur la scène active, en grappe autour de `center`
 * (coordonnées canevas), jetons cachés par défaut — le MJ les révèle quand
 * les joueurs les voient. Chaque jeton porte `flags.rpg.forceLevel`.
 */
export async function placeEncounter(encounter, { center = null, hidden = true } = {}) {
  const scene = globalThis.canvas?.scene;
  if (!scene || !globalThis.game?.user?.isGM) return [];
  const grid = n(scene.grid?.size, 100);
  const c = center ?? { x: n(canvas.stage?.pivot?.x, 0), y: n(canvas.stage?.pivot?.y, 0) };
  const data = [];
  let i = 0;
  const cols = 4;
  for (const e of encounter.entries ?? []) {
    for (let k = 0; k < e.count; k++, i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = Math.round(c.x + (col - (cols - 1) / 2) * grid * 1.5 - grid / 2);
      const y = Math.round(c.y + row * grid * 1.5 - grid / 2);
      const td = await e.actor.getTokenDocument({ x, y, hidden });
      const obj = td.toObject();
      obj.actorLink = false;
      foundry.utils.setProperty(obj, "flags.rpg.forceLevel", e.level);
      data.push(obj);
    }
  }
  if (!data.length) return [];
  return scene.createEmbeddedDocuments("Token", data);
}

/** Carte de chat (MJ) résumant une rencontre. */
export function encounterSummaryHTML(enc) {
  const rows = (enc.entries ?? []).map(e => `<tr>
      <td>${e.count} ×</td><td><b>${e.name}</b></td>
      <td style="text-align:center">niv. ${e.level}${e.gap ? ` <span style="opacity:.6">(${e.gap > 0 ? "+" : ""}${e.gap})</span>` : ""}</td>
      <td style="text-align:center">${(e.weight * e.count).toFixed(2)}</td>
    </tr>`).join("");
  const d = DIFFICULTIES[enc.difficulty]?.label ?? enc.difficulty;
  return `<div class="rpg-encounter">
    <h3 style="margin:0 0 4px">⚔️ Rencontre — ${d}</h3>
    <div style="font-size:11px;opacity:.8">Groupe niveau ${enc.level}, ${enc.size} PJ ·
      menace <b>${enc.total}</b> / budget ${enc.budget} · ≈ <b>${enc.xp} XP</b> au total</div>
    <table style="width:100%;font-size:12px;margin-top:4px">${rows}</table>
    ${enc.warning ? `<p style="color:var(--ember,#c44)">${enc.warning}</p>` : ""}
  </div>`;
}
