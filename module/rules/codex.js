// module/rules/codex.js
//
// Codex du joueur — ce qu'il a le droit de lire dans les compendiums.
//
// Les compendiums d'objets sont la bibliothèque du monde : les ouvrir en
// entier revient à donner le catalogue complet des armes, armures et sorts
// avant même de les avoir croisés. Un joueur ne doit y voir que ce qu'il a,
// ou a eu, entre les mains.
//
// Fonctionnement : chaque acteur tient la liste de ce qui est passé par son
// inventaire (`flags.rpg.codex`). L'entrée n'est jamais retirée — « a eu en
// sa possession » compte autant que « possède ». Au rendu d'un compendium
// d'objets, les lignes absentes de cette liste sont retirées du DOM.
//
// Le MJ voit toujours tout. Les compendiums qui ne contiennent pas d'objets
// (règles, tables de butin…) ne sont jamais filtrés.

const FLAG_SCOPE = "rpg";
const FLAG_CODEX = "codex";

/** Empreinte d'un objet : sa source de compendium si connue, sinon son nom. */
function fingerprints(item) {
  const out = [];
  const src = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "";
  if (src) {
    out.push(String(src));
    // …et l'identifiant seul : le même objet réimporté depuis un autre pack
    // garde son id, ce qui évite de le redemander au joueur.
    const id = String(src).split(".").pop();
    if (id) out.push(`id:${id}`);
  }
  const name = String(item?.name ?? "").trim().toLowerCase();
  if (name) out.push(`name:${name}`);
  return out;
}

/** Types d'objets concernés par le codex (le reste n'est pas catalogué). */
const CODEX_TYPES = new Set(["weapon", "armor", "spell", "consumable", "loot", "recipe"]);

/**
 * Enregistre des objets dans le codex de leur porteur.
 * Silencieux et sans effet si l'acteur n'appartient à aucun joueur.
 */
export async function recordInCodex(actor, items) {
  if (!actor || !game.user.isGM) return;
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return;

  const known = new Set(actor.getFlag(FLAG_SCOPE, FLAG_CODEX) ?? []);
  const before = known.size;
  for (const it of list) {
    if (!CODEX_TYPES.has(it?.type)) continue;
    for (const fp of fingerprints(it)) known.add(fp);
  }
  if (known.size === before) return;
  await actor.setFlag(FLAG_SCOPE, FLAG_CODEX, Array.from(known));
}

/** Union des codex de tous les personnages que l'utilisateur courant possède. */
export function codexForCurrentUser() {
  const known = new Set();
  for (const actor of game.actors) {
    if (!actor.isOwner) continue;
    if (actor.type !== "character") continue;
    for (const fp of (actor.getFlag(FLAG_SCOPE, FLAG_CODEX) ?? [])) known.add(fp);
    // Ce qu'il porte à l'instant compte évidemment, même si le codex n'a pas
    // encore été alimenté (monde antérieur à ce module).
    for (const it of actor.items) {
      if (!CODEX_TYPES.has(it.type)) continue;
      for (const fp of fingerprints(it.toObject())) known.add(fp);
    }
  }
  return known;
}

/** Cette entrée de compendium est-elle connue du joueur ? */
function isKnown(known, { uuid, id, name }) {
  if (uuid && known.has(uuid)) return true;
  if (id && known.has(`id:${id}`)) return true;
  if (name && known.has(`name:${String(name).trim().toLowerCase()}`)) return true;
  return false;
}

/**
 * Filtre l'affichage d'un compendium ouvert.
 * Appelé depuis le hook « renderCompendium ».
 */
export function filterCompendium(app, html) {
  if (game.user.isGM) return;
  const pack = app?.collection ?? null;
  if (!pack || pack.documentName !== "Item") return;   // règles, tables… intactes

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const known = codexForCurrentUser();
  const packId = pack.collection ?? pack.metadata?.id ?? "";
  let hidden = 0;

  root.querySelectorAll("[data-entry-id], [data-document-id]").forEach(li => {
    const id = li.dataset.entryId ?? li.dataset.documentId;
    if (!id) return;
    const name = li.querySelector(".entry-name, .document-name, h4")?.textContent ?? "";
    const uuid = `Compendium.${packId}.Item.${id}`;
    if (!isKnown(known, { uuid, id, name })) { li.remove(); hidden++; }
  });

  if (hidden) {
    const note = document.createElement("p");
    note.style.cssText = "opacity:.6;font-size:11px;padding:6px 8px;margin:0";
    note.textContent = "Seul ce que ton personnage a eu entre les mains apparaît ici.";
    (root.querySelector(".directory-list") ?? root).prepend(note);
  }
}

/** Branche le suivi du codex et le filtrage des compendiums. */
export function installCodex() {
  // Alimentation : tout objet créé sur un acteur entre au codex.
  Hooks.on("createItem", async (item) => {
    try {
      const actor = item?.parent;
      if (actor?.documentName !== "Actor") return;
      await recordInCodex(actor, item.toObject());
    } catch (e) { console.warn("[RPG] codex :", e); }
  });

  Hooks.on("renderCompendium", (app, html) => {
    try { filterCompendium(app, html); } catch (e) { console.warn("[RPG] filtrage compendium :", e); }
  });
}
