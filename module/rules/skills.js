// module/rules/skills.js
//
// Source unique de vérité pour l'XP/niveau des compétences — utilisée par
// la fiche PJ, la macro Compétences (MJ), et le jet de compétence générique.
// (Avant cette extraction, ces formules étaient dupliquées dans plusieurs
// fichiers — risque réel de désynchronisation si l'une change sans l'autre.)

// ── Compétences du système ────────────────────────────────────────────────
//
// Il n'y avait AUCUNE liste de référence : init.js n'écrit qu'un
// `skills: {}` vide, la fiche affiche ce qu'elle trouve, et la macro de jet
// se rabattait sur une liste écrite en dur qui ne correspondait à rien.
// Les compétences étaient donc créées à la main, monde par monde, pendant
// que le moteur, lui, lisait quatre clés FIXES — d'où la panne trouvée sur
// la Volonté : la clé lue était `survie`, la compétence du monde s'appelait
// `volonte`, et le terme valait 0 en silence dans le jet d'agonie.
//
// Le nombre de compétences n'est pas le sujet : elles n'accordent aucune
// caractéristique, donc en avoir beaucoup ne rend personne plus fort. Ce qui
// posait problème, c'est qu'une compétence pouvait ne servir À RIEN sans
// que rien ne le dise — monter Détection ne faisait rien détecter, parce
// que le moteur lisait `perception` et elle seule. C'est ce que les FAMILLES
// ci-dessous corrigent : plusieurs compétences peuvent répondre à la même
// question mécanique, et c'est la meilleure des deux qui est lue.

/** Les compétences de référence, dans l'ordre d'affichage. */
export const SKILL_DEFS = [
  { key: "volonte",      label: "Volonté",      hint: "Tenir bon : agonie, terreur, emprise mentale." },
  { key: "perception",   label: "Perception",   hint: "Remarquer : pièges, embuscades, détails, mensonges." },
  { key: "discretion",   label: "Discrétion",   hint: "Se déplacer sans être vu ni entendu." },
  { key: "larcin",       label: "Larcin",       hint: "Les mains : crocheter, désamorcer, dérober." },
  { key: "athletisme",   label: "Athlétisme",   hint: "Le corps : grimper, nager, sauter, forcer." },
  { key: "forge",        label: "Forge",        hint: "Fabriquer et réparer — augmente la chance de craft." },
  { key: "connaissance", label: "Connaissance", hint: "Savoir : arcanes, langues, histoire, créatures." }
];

/**
 * FAMILLES : les anciennes clés que chaque compétence de référence absorbe.
 *
 * Deux usages, et rien d'autre : lire le bon niveau chez un personnage écrit
 * avant cette liste, et permettre à un MJ de renommer une compétence sans que
 * le moteur retombe silencieusement à 0.
 *
 * Détection et Intuition rejoignent Perception, Crochetage rejoint Larcin :
 * dans les deux cas le moteur ne lisait de toute façon qu'UNE des clés, si
 * bien que monter l'autre ne servait à rien. Rien n'est jamais renommé ni
 * supprimé sur une fiche — voir missingSkillsFor().
 */
export const SKILL_ALIASES = {
  volonte:      ["volonte", "survie"],
  perception:   ["perception", "detection", "intuition"],
  discretion:   ["discretion"],
  larcin:       ["larcin", "crochetage"],
  athletisme:   ["athletisme", "force", "escalade"],
  forge:        ["forge", "artisanat"],
  connaissance: ["connaissance", "arcane", "medecine", "eloquence"]
};

/**
 * Niveau d'un personnage dans une compétence, désigné par son RÔLE.
 *
 * C'est le seul point d'entrée que le moteur doit utiliser : jamais
 * `actor.system.skills.<clé>.level` en dur, sinon on réintroduit exactement
 * la panne décrite en tête de fichier.
 *
 * Quand plusieurs membres d'une famille coexistent sur la même fiche
 * (Perception 2 et Détection 4), on prend le MEILLEUR plutôt que la somme :
 * la famille ne doit pas récompenser le fait d'avoir plusieurs lignes, ni
 * punir celui qui n'en a qu'une.
 */
export function skillLevel(actor, role) {
  const skills = actor?.system?.skills ?? {};
  const keys = SKILL_ALIASES[role] ?? [role];
  let best = 0;
  for (const k of keys) {
    const lvl = Number(skills[k]?.level);
    if (Number.isFinite(lvl) && lvl > best) best = lvl;
  }
  return best;
}

/**
 * Les compétences telles qu'elles doivent exister sur une fiche neuve.
 * Le `label` est écrit une fois puis appartient au MJ, qui peut le changer.
 */
export function defaultSkills() {
  const out = {};
  for (const d of SKILL_DEFS) out[d.key] = { label: d.label, level: 0, xp: 0 };
  return out;
}

/**
 * Liste à proposer dans une interface pour CE personnage : ses propres
 * compétences, complétées par celles de référence qui manqueraient.
 *
 * Utilisée par la macro de jet de compétence, qui affichait auparavant les
 * compétences du PREMIER personnage du monde quel que soit celui choisi
 * dans sa propre liste déroulante.
 */
export function skillListFor(actor) {
  const own = actor?.system?.skills ?? {};
  const seen = new Set();
  const out = [];
  for (const [key, s] of Object.entries(own)) {
    if (!s || typeof s !== "object") continue;
    seen.add(key);
    out.push({ key, label: s.label ?? key, level: Number(s.level) || 0 });
  }
  for (const d of SKILL_DEFS) {
    if (seen.has(d.key)) continue;
    // Une compétence de référence absente de la fiche reste proposable : le
    // jet vaut alors niveau 0, ce qui est la bonne réponse, plutôt que de
    // rendre l'action impossible à tenter.
    out.push({ key: d.key, label: d.label, level: 0 });
  }
  return out;
}

/**
 * Complète un personnage avec les compétences de référence qui lui manquent.
 *
 * N'AJOUTE que : aucune compétence n'est renommée, déplacée ni supprimée, et
 * aucun niveau ni XP acquis n'est touché. Une compétence maison du MJ est
 * donc conservée telle quelle à côté des autres.
 *
 * @returns {object|null} le nouvel objet skills, ou null s'il n'y a rien à faire
 */
export function missingSkillsFor(actor) {
  const own = foundry.utils.deepClone(actor?.system?.skills ?? {});
  let added = 0;
  for (const d of SKILL_DEFS) {
    // Un ALIAS déjà présent suffit : un personnage qui a Crochetage 4 ne doit
    // pas se retrouver avec un Larcin 0 juste à côté — ce serait précisément
    // le doublon que la liste cherche à supprimer, et skillLevel() sait déjà
    // lire son niveau par la famille.
    const aliases = SKILL_ALIASES[d.key] ?? [d.key];
    if (aliases.some(k => own[k] && typeof own[k] === "object")) continue;
    own[d.key] = { label: d.label, level: 0, xp: 0 };
    added++;
  }
  return added ? own : null;
}

export function skillXpToNext(currentLevel) {
  return 100 + 50 * Math.max(0, Number(currentLevel) || 0);
}

export function skillsTotalLevels(skills) {
  if (!skills) return 0;
  return Object.values(skills).reduce((a, s) => a + (Number(s?.level) || 0), 0);
}

/**
 * Plafond du total des niveaux de compétence — SUPPRIMÉ.
 *
 * Il valait 10 + 2 × niveau, et addXpToSkill cessait de faire monter les
 * niveaux dès que le total l'atteignait : l'XP continuait de s'accumuler
 * dans le vide, sans que rien ne le dise au joueur. Il n'avait plus de
 * raison d'être depuis que les compétences n'accordent AUCUNE
 * caractéristique — s'étendre ne rend pas plus fort, ça ne fait qu'ouvrir
 * des actions, et chaque niveau se paie déjà en XP.
 *
 * Conservée en repli pour les gabarits/macros qui l'appelleraient encore.
 * @returns {number} Infinity — aucune limite.
 */
export function skillsLevelCap() {
  return Infinity;
}

export async function addXpToSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  const add = Number(amount) || 0;
  if (!add) return;

  s.xp = Math.max(0, (Number(s.xp) || 0) + add);

  while (true) {
    const lvl = Number(s.level) || 0;
    const need = skillXpToNext(lvl);
    if (s.xp < need) break;

    s.xp -= need;
    s.level = lvl + 1;
  }

  skills[skillKey] = s;
  await actor.update({ "system.skills": skills });
}

export async function removeXpFromSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  let sub = Math.abs(Number(amount) || 0);
  if (!sub) return;

  while (sub > 0) {
    const curXp = Number(s.xp) || 0;

    if (curXp >= sub) {
      s.xp = curXp - sub;
      sub = 0;
      break;
    }

    sub -= curXp;
    s.xp = 0;

    const lvl = Number(s.level) || 0;
    if (lvl <= 0) {
      sub = 0;
      break;
    }

    s.level = lvl - 1;
    s.xp = skillXpToNext(s.level) - 1;
  }

  skills[skillKey] = s;
  await actor.update({ "system.skills": skills });
}
