// module/rules/forge.js
// Logique de craft : vérification ingrédients, jet de chance, consommation, création résultat

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Quantité totale possédée d'un ingrédient (somme sur tous les stacks loot/consumable
 * dont le nom correspond, insensible à la casse).
 */
export function getInventoryQty(actor, ingredientName) {
  const target = String(ingredientName ?? "").trim().toLowerCase();
  if (!target) return 0;

  let total = 0;
  for (const it of actor.items) {
    if (it.type !== "loot" && it.type !== "consumable") continue;
    if (String(it.name ?? "").trim().toLowerCase() !== target) continue;
    total += Math.max(0, n(it.system?.qte, 1));
  }
  return total;
}

/**
 * Vérifie si tous les ingrédients d'une recette sont disponibles en quantité suffisante.
 */
export function checkIngredients(actor, recipe) {
  const ingredients = Array.isArray(recipe.system?.ingredients) ? recipe.system.ingredients : [];
  const results = ingredients.map(ing => {
    const have = getInventoryQty(actor, ing.name);
    const need = Math.max(1, n(ing.qty, 1));
    return { name: ing.name, need, have, ok: have >= need };
  });
  return { results, allOk: results.every(r => r.ok) };
}

/**
 * Consomme les ingrédients de l'inventaire (décrémente qte, supprime si 0).
 */
async function consumeIngredients(actor, recipe) {
  const ingredients = Array.isArray(recipe.system?.ingredients) ? recipe.system.ingredients : [];

  for (const ing of ingredients) {
    let remaining = Math.max(1, n(ing.qty, 1));
    const target = String(ing.name ?? "").trim().toLowerCase();

    const matching = actor.items.filter(it =>
      (it.type === "loot" || it.type === "consumable") &&
      String(it.name ?? "").trim().toLowerCase() === target
    );

    const updates = [];
    const deletions = [];

    for (const it of matching) {
      if (remaining <= 0) break;
      const stackQty = Math.max(0, n(it.system?.qte, 1));
      const take = Math.min(stackQty, remaining);
      const newQty = stackQty - take;
      remaining -= take;

      if (newQty <= 0) deletions.push(it.id);
      else updates.push({ _id: it.id, "system.qte": newQty });
    }

    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    if (deletions.length) await actor.deleteEmbeddedDocuments("Item", deletions);
  }
}

/**
 * Calcule la chance de réussite (skill Forge influence uniquement la chance, pas le bonus).
 * chance = clamp(50 + niveauForge*5 - difficulte, 5, 95)
 */
export function computeForgeChance(actor, recipe) {
  const forgeLevel = n(actor.system?.skills?.forge?.level, 0);
  const difficulte  = n(recipe.system?.difficulte, 0);
  const chance = Math.min(95, Math.max(5, 50 + forgeLevel * 5 - difficulte));
  return chance;
}

/**
 * Ajoute de l'XP au skill Forge et recalcule son niveau (courbe simple : level = floor(xp/100)).
 */
async function grantForgeXp(actor, amount) {
  const cur = actor.system?.skills?.forge ?? { level: 0, xp: 0 };
  const newXp = Math.max(0, n(cur.xp, 0) + amount);
  const newLevel = Math.min(20, Math.floor(newXp / 100));
  await actor.update({
    "system.skills.forge.xp":    newXp,
    "system.skills.forge.level": newLevel
  });
  return { newXp, newLevel, leveledUp: newLevel > n(cur.level, 0) };
}

/**
 * Résout l'item résultat depuis son UUID et le crée dans l'inventaire de l'actor.
 */
async function createResultItem(actor, recipe) {
  const uuid = String(recipe.system?.result?.uuid ?? "").trim();
  if (!uuid) return { ok: false, reason: "Aucun UUID de résultat configuré sur cette recette." };

  let sourceItem;
  try {
    sourceItem = await fromUuid(uuid);
  } catch (e) {
    return { ok: false, reason: `UUID invalide : ${uuid}` };
  }
  if (!sourceItem) return { ok: false, reason: `Objet introuvable pour l'UUID : ${uuid}` };

  const itemData = sourceItem.toObject();
  delete itemData._id;
  if (itemData.system) itemData.system.qte = 1;

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
  return { ok: true, item: created };
}

/**
 * Pipeline complet de craft.
 * Retourne { ok, success, content } — content = HTML à poster dans le chat.
 */
export async function craftRecipe(actor, recipe) {
  const check = checkIngredients(actor, recipe);
  if (!check.allOk) {
    const missing = check.results.filter(r => !r.ok)
      .map(r => `${r.name} (${r.have}/${r.need})`).join(", ");
    return { ok: false, reason: `Ingrédients manquants : ${missing}` };
  }

  const chance = computeForgeChance(actor, recipe);
  const roll = await (new Roll("1d100")).evaluate();
  const success = roll.total <= chance;

  // Consomme toujours les ingrédients (risque de l'échec)
  await consumeIngredients(actor, recipe);

  // XP Forge : plus généreux en cas de succès
  const xpGain = success ? 15 : 5;
  const xpResult = await grantForgeXp(actor, xpGain);

  let resultLine = "";
  if (success) {
    const res = await createResultItem(actor, recipe);
    if (res.ok) {
      resultLine = `<br>🛠️ <b>${res.item.name}</b> ajouté à l'inventaire.`;
    } else {
      resultLine = `<br>⚠️ Craft réussi mais impossible de créer l'objet : ${res.reason}`;
    }
  }

  const levelUpLine = xpResult.leveledUp
    ? `<br>📈 Compétence <b>Forge</b> niveau <b>${xpResult.newLevel}</b> !`
    : "";

  const content = `
    <div style="font-size:13px;line-height:1.6">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="background:${success ? "#1d9e75" : "#c0392b"};color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">
          ${success ? "✅ RÉUSSI" : "❌ ÉCHEC"}
        </span>
        <span>🔨 Forge — <b>${recipe.name}</b></span>
      </div>
      <b>${actor.name}</b> tente de forger <b>${recipe.name}</b><br>
      🎲 Jet : <b>${roll.total}</b> / chance ${chance}%
      ${resultLine}${levelUpLine}
      <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">+${xpGain} XP Forge</div>
    </div>`;

  return { ok: true, success, content, chance, roll: roll.total };
}
