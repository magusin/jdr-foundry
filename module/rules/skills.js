// module/rules/skills.js
//
// Source unique de vérité pour l'XP/niveau des compétences — utilisée par
// la fiche PJ, la macro Compétences (MJ), et le jet de compétence générique.
// (Avant cette extraction, ces formules étaient dupliquées dans plusieurs
// fichiers — risque réel de désynchronisation si l'une change sans l'autre.)

export function skillXpToNext(currentLevel) {
  return 100 + 50 * Math.max(0, Number(currentLevel) || 0);
}

export function skillsTotalLevels(skills) {
  if (!skills) return 0;
  return Object.values(skills).reduce((a, s) => a + (Number(s?.level) || 0), 0);
}

export function skillsLevelCap(actor) {
  const lvl = Number(actor.system?.niveau || 1);
  return 10 + 2 * lvl;
}

export async function addXpToSkill(actor, skillKey, amount) {
  const skills = foundry.utils.deepClone(actor.system?.skills ?? {});
  const s = skills[skillKey];
  if (!s) return ui.notifications.warn("Compétence introuvable.");

  const add = Number(amount) || 0;
  if (!add) return;

  s.xp = Math.max(0, (Number(s.xp) || 0) + add);

  const cap = skillsLevelCap(actor);

  while (true) {
    const total = skillsTotalLevels(skills);
    if (total >= cap) break;

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
