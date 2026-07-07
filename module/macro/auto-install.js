// module/macro/auto-install.js
//
// Importation automatique des macros système au premier lancement
// et mise à jour si la version du compendium est plus récente.
//
// Appelé depuis init.js > hook "ready" (GM uniquement).

const PACK_NAME    = "rpg.macros-rpg";
const FOLDER_NAME  = "JDR — Macros système";
const FLAG_SCOPE   = "rpg";
const FLAG_VERSION = "macroVersion";

export async function autoInstallMacros() {
  if (!game.user.isGM) return;

  // ── 1. Ouvre le compendium ─────────────────────────────────────────────
  const pack = game.packs.get(PACK_NAME);
  if (!pack) {
    const available = game.packs.map(p => p.collection).join(", ");
    console.warn(`[RPG] Compendium "${PACK_NAME}" introuvable.`);
    console.warn(`[RPG] Packs disponibles : ${available || "(aucun)"}`);
    ui.notifications?.warn?.(`[RPG] Compendium de macros introuvable — redémarre le serveur Foundry (pas juste F5).`);
    return;
  }

  // ✅ getDocuments() charge tout en mémoire ET retourne le tableau directement
  // Ne pas rappeler getDocument() après — le cache V13 n'est pas fiable par _id
  let packDocs;
  try {
    packDocs = await pack.getDocuments();
  } catch (e) {
    console.error("[RPG] Impossible de charger le compendium de macros :", e);
    return;
  }

  if (!packDocs?.length) {
    console.warn("[RPG] Compendium de macros vide ou non lisible.");
    return;
  }

  // ── 2. Crée le dossier si besoin ───────────────────────────────────────
  let folder = game.folders.find(
    (f) => f.type === "Macro" && f.name === FOLDER_NAME
  );
  if (!folder) {
    folder = await Folder.create({ name: FOLDER_NAME, type: "Macro", color: "#4a3f6b" });
  }

  // ── 3. Pour chaque macro du compendium ────────────────────────────────
  for (const packDoc of packDocs) {
    if (!packDoc) continue;

    const packVer = String(packDoc.flags?.rpg?.version ?? "1.0.0");

    // Dédoublonnage
    const allMatching = game.macros.filter((m) => m.name === packDoc.name);
    if (allMatching.length > 1) {
      const [, ...extras] = allMatching;
      await Promise.all(extras.map((m) => m.delete().catch(() => {})));
      console.log(`[RPG] ${extras.length} doublon(s) supprimé(s) pour "${packDoc.name}"`);
    }

    const existing = allMatching[0] ?? null;

    if (!existing) {
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
      const worldVer = String(existing.flags?.[FLAG_SCOPE]?.[FLAG_VERSION] ?? "0.0.0");
      if (isNewer(packVer, worldVer)) {
        await existing.update({
          name:    packDoc.name,
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
