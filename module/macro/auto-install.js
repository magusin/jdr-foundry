// module/macro/auto-install.js
//
// Installe/met à jour les macros système directement depuis les fichiers JS
// du système (fetch HTTP), sans passer par le compendium. Cette approche
// est plus fiable car elle ne dépend pas du chargement du compendium.

const FOLDER_NAME  = "Macros système";
const FLAG_SCOPE   = "rpg";
const FLAG_VERSION = "version";

// Liste des macros avec leur chemin fichier et leur version
const MACRO_LIST = [
  { name: "Menu Combat",                       file: "menu.js",              version: "1.8.2", img: "icons/svg/sword.svg" },
  { name: "Auras Grille",                      file: "aura.js",              version: "1.0.2", img: "icons/svg/aura.svg" },
  { name: "Gérer l'Or (MJ)",                   file: "gold.js",              version: "1.0.5", img: "systems/rpg/assets/icons/coins.svg" },
  { name: "Forge",                              file: "forge.js",             version: "1.1.2", img: "systems/rpg/assets/icons/anvil.svg" },
  { name: "Forcer Effets de Tour (MJ)",         file: "force-turn.js",        version: "1.0.2", img: "icons/svg/regen.svg" },
  { name: "Distribuer une Recette (MJ)",        file: "recipe-distribute.js", version: "1.0.2", img: "systems/rpg/assets/icons/anvil.svg" },
  { name: "Distribuer un Objet (MJ)",           file: "item-distribute.js",   version: "1.2.2", img: "icons/svg/item-bag.svg" },
  { name: "Appliquer un Effet (MJ)",            file: "apply-effect.js",      version: "2.1.2", img: "icons/svg/lightning.svg" },
  { name: "Survie : Repos / Blessures (MJ)",    file: "survival-tools.js",    version: "1.1.2", img: "icons/svg/blood.svg" },
  { name: "Météo (MJ)",                         file: "weather-control.js",   version: "1.0.2", img: "icons/svg/wave.svg" },
  { name: "Marché (MJ)",                        file: "market.js",            version: "2.1.2", img: "systems/rpg/assets/icons/coins.svg" },
  { name: "Réputation & Marché Régional (MJ)",  file: "reputation-tools.js",  version: "1.1.2", img: "icons/svg/eye.svg" },
  { name: "Position Tactique (MJ)",             file: "tactical-tools.js",    version: "1.0.2", img: "icons/svg/shield.svg" },
  { name: "Cibler la Zone",                     file: "target-zone.js",       version: "1.0.2", img: "icons/svg/target.svg" },
  { name: "Compétences (MJ)",                   file: "skills-tools.js",      version: "1.1.2", img: "icons/svg/book.svg" },
  { name: "Jet de Compétence",                  file: "skill-check-macro.js", version: "1.0.2", img: "systems/rpg/assets/icons/dice.svg" },
  { name: "Créer un État (MJ)",                 file: "state-builder-macro.js",version:"1.0.2", img: "icons/svg/aura.svg" },
  { name: "Retirer un État (jet)",              file: "remove-state-macro.js",version: "1.0.2", img: "icons/svg/cancel.svg" },
  { name: "Déverrouiller les Compendiums (MJ)", file: "unlock-compendiums.js",version: "1.0.2", img: "icons/svg/book.svg" },
  { name: "Lancer un Sort",                     file: "cast-spell.js",        version: "1.0.2", img: "icons/svg/lightning.svg" },
];

function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

export async function autoInstallMacros() {
  if (!game.user.isGM) return;

  // Crée le dossier si besoin
  let folder = game.folders.find(f => f.type === "Macro" && f.name === FOLDER_NAME);
  if (!folder) {
    folder = await Folder.create({ name: FOLDER_NAME, type: "Macro", color: "#4a3f6b" });
  }

  let created = 0, updated = 0, skipped = 0;

  for (const entry of MACRO_LIST) {
    const packVer = entry.version;
    const macroName = entry.name;

    // Cherche les macros existantes par nom (gérant les anciens préfixes)
    const allMatching = game.macros.filter(m =>
      m.name === macroName ||
      m.name === `RPG — ${macroName}` ||
      m.name === `JDR — ${macroName}`
    );

    // Supprime les doublons
    if (allMatching.length > 1) {
      const [, ...extras] = allMatching;
      for (const dup of extras) await dup.delete().catch(() => {});
      console.log(`[RPG] Doublon supprimé : ${macroName}`);
    }

    const existing = allMatching[0] ?? null;

    // ✅ Force la mise à jour : on met à jour si la macro existe (nom RPG—/JDR— trouvé)
    // OU si c'est une macro système connue. Pas de vérification de version.
    const needsUpdate = true; // toujours mettre à jour les macros système

    if (!needsUpdate) { skipped++; continue; }

    // Charge le code source via fetch
    const url = `systems/rpg/module/macro/${entry.file}`;
    let command;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      command = await resp.text();
    } catch(e) {
      console.warn(`[RPG] Impossible de charger ${url} :`, e);
      continue;
    }

    if (existing) {
      await existing.update({
        name:    macroName,
        command,
        img:     entry.img,
        folder:  folder.id,
        flags:   { [FLAG_SCOPE]: { [FLAG_VERSION]: packVer, systemMacro: true } }
      });
      console.log(`[RPG] Macro mise à jour : ${macroName}`);
      updated++;
    } else {
      await Macro.create({
        name:    macroName,
        type:    "script",
        command,
        img:     entry.img,
        folder:  folder.id,
        flags:   { [FLAG_SCOPE]: { [FLAG_VERSION]: packVer, systemMacro: true } }
      });
      console.log(`[RPG] Macro créée : ${macroName} (v${packVer})`);
      created++;
    }
  }

  if (created || updated) {
    console.log(`[RPG] Macros : ${created} créée(s), ${updated} mise(s) à jour, ${skipped} déjà à jour.`);
    if (created || updated) ui.notifications?.info?.(`Macros système : ${created} créée(s), ${updated} mise(s) à jour.`);
  }
}
