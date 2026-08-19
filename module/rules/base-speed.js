// module/rules/base-speed.js
//
// Vitesse de base d'un personnage — une seule valeur, un seul endroit.
//
// La vitesse de départ était écrite en dur à cinq endroits qui ne disaient
// pas tous la même chose : 6 dans template.json, 6 en repli dans actor.js /
// movement-tracker.js / movement-ruler.js, 3 dans les valeurs de création
// (preCreateActor) et 3 dans les références de la pesée. Selon l'ordre de
// fusion des données à la création, un personnage naissait donc à 3 ou à 6.
// Tout passe désormais par BASE_VITESSE.
//
// L'unité est le MÈTRE par tour, jamais la case (voir movement-tracker.js).

/** Vitesse de base d'un personnage, en mètres par tour. */
export const BASE_VITESSE = 8;

/**
 * Anciennes valeurs par défaut, reconnues par la migration.
 *
 * Une vitesse égale à l'une d'elles est presque sûrement un défaut jamais
 * touché ; toute autre valeur est un choix du MJ (une créature lente, un
 * personnage bridé) et n'est pas écrasée.
 */
const OLD_DEFAULTS = new Set([3, 6]);

/** Numéro de la migration déjà appliquée au monde (réglage `baseSpeedVersion`). */
export const SPEED_MIGRATION_VERSION = 1;

/**
 * Passe les personnages existants à la nouvelle vitesse de base.
 *
 * Ni template.json ni preCreateActor ne touchent un acteur déjà créé : sans
 * cette passe, seuls les personnages créés APRÈS la mise à jour marcheraient
 * à 8 m, et une table entière resterait à 3 sans que rien ne l'explique.
 *
 * Deux champs sont concernés et il faut lire les valeurs STOCKÉES (`_source`),
 * pas les valeurs préparées : `system.base.vitesse` est écrit par la fiche et
 * par la génération de monstres, mais il est aussi RECALCULÉ à chaque
 * préparation depuis `system.deplacement.vitesse` quand il n'a jamais été
 * écrit (voir prepareDerivedData) — le lire préparé donnerait toujours une
 * valeur, et on ne saurait plus distinguer « le MJ a saisi 3 » de « personne
 * n'y a jamais touché ».
 *
 * Les monstres sont exclus : leur vitesse vient de leurs bandes de génération
 * (monster-gen.js), qui restent la main du MJ.
 *
 * @returns {Promise<number>} nombre de personnages mis à jour
 */
export async function migrateBaseSpeed() {
  if (!game.user.isGM || game.user !== game.users.activeGM) return 0;

  let done = 0;
  try {
    const applied = Number(game.settings.get("rpg", "baseSpeedVersion") ?? 0);
    if (applied >= SPEED_MIGRATION_VERSION) return 0;
  } catch (e) {
    console.warn("[RPG] version de vitesse de base illisible :", e);
    return 0;
  }

  for (const actor of game.actors.filter(a => a.type === "character")) {
    try {
      const src = actor._source?.system ?? {};
      const stored = src.base?.vitesse;
      const legacy = src.deplacement?.vitesse;

      // Ce qui fait réellement foi aujourd'hui pour cet acteur : sa base si
      // elle a été écrite, sinon l'ancien champ dont elle serait déduite.
      const current = stored === undefined ? legacy : stored;
      if (current !== undefined && !OLD_DEFAULTS.has(Number(current))) continue;

      await actor.update({
        "system.base.vitesse": BASE_VITESSE,
        "system.deplacement.vitesse": BASE_VITESSE
      });
      done++;
    } catch (e) {
      console.warn(`[RPG] vitesse de base sur ${actor.name} :`, e);
    }
  }

  try { await game.settings.set("rpg", "baseSpeedVersion", SPEED_MIGRATION_VERSION); }
  catch (e) { console.warn("[RPG] version de vitesse de base non enregistrée :", e); }

  if (done) {
    console.log(`[RPG] Vitesse de base portée à ${BASE_VITESSE} m sur ${done} personnage(s).`);
    ui.notifications?.info?.(
      `Vitesse de base portée à ${BASE_VITESSE} m sur ${done} personnage(s). ` +
      `Les vitesses saisies à la main n'ont pas été touchées.`
    );
  }
  return done;
}
