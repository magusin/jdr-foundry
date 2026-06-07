// module/macro/auto-install.js
//
// Importation automatique des macros système au premier lancement
// et mise à jour si la version du compendium est plus récente.
//
// Appelé depuis init.js > hook "ready" (GM uniquement).

const PACK_NAME    = "rpg.macros-rpg";
const FOLDER_NAME  = "RPG — Macros système";
const FLAG_SCOPE   = "rpg";
const FLAG_VERSION = "macroVersion";

export async function autoInstallMacros() {
  if (!game.user.isGM) return;

  // ── 1. Ouvre le compendium ─────────────────────────────────────────────
  const pack = game.packs.get(PACK_NAME);
  if (!pack) {
    console.warn(`[RPG] Compendium "${PACK_NAME}" introuvable.`);
    return;
  }

  const packIndex = await pack.getIndex();

  // ── 2. Crée le dossier si besoin ───────────────────────────────────────
  let folder = game.folders.find(
    (f) => f.type === "Macro" && f.name === FOLDER_NAME
  );
  if (!folder) {
    folder = await Folder.create({ name: FOLDER_NAME, type: "Macro", color: "#4a3f6b" });
  }

  // ── 3. Pour chaque macro du compendium ────────────────────────────────
  for (const entry of packIndex) {
    const packDoc  = await pack.getDocument(entry._id);
    const packVer  = String(packDoc.flags?.rpg?.version ?? "1.0.0");

    // Cherche si une macro du même nom existe déjà dans le monde
    const existing = game.macros.find((m) => m.name === packDoc.name);

    if (!existing) {
      // Crée la macro
      await Macro.create({
        name:    packDoc.name,
        type:    packDoc.type,
        command: packDoc.command,
        img:     packDoc.img,
        folder:  folder.id,
        flags:   { [FLAG_SCOPE]: { [FLAG_VERSION]: packVer, systemMacro: true } }
      });
      console.log(`[RPG] Macro créée : ${packDoc.name} (v${packVer})`);
    } else {
      // Compare les versions
      const worldVer = String(existing.flags?.[FLAG_SCOPE]?.[FLAG_VERSION] ?? "0.0.0");
      if (isNewer(packVer, worldVer)) {
        await existing.update({
          command: packDoc.command,
          img:     packDoc.img,
          flags:   { [FLAG_SCOPE]: { [FLAG_VERSION]: packVer, systemMacro: true } }
        });
        console.log(`[RPG] Macro mise à jour : ${packDoc.name} ${worldVer} → ${packVer}`);
      }
    }
  }
}

/** Compare deux versions semver simples "X.Y.Z" → true si a > b */
function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}
