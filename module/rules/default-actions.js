// module/rules/default-actions.js
//
// Actions de base possédées par TOUS les personnages et monstres.
//
// Certaines actions ne s'achètent pas et ne s'apprennent pas : n'importe qui
// peut souffler pour récupérer son souffle. Elles sont créées comme de vrais
// objets « spell » sur l'acteur, ce qui leur donne gratuitement tout le reste
// du système : déclaration en chat, validation MJ, budget d'action, barre de
// raccourcis, filtres de l'onglet Sorts.
//
// Attribution :
//   • à la création d'un acteur (hook createActor)
//   • en rattrapage au chargement du monde, pour les acteurs déjà existants
//
// Chaque acteur porte un drapeau `flags.rpg.defaultActions` avec la version
// déjà appliquée : un MJ qui supprime volontairement « Repos » ne le voit pas
// revenir au prochain rechargement.

const FLAG_SCOPE = "rpg";
const FLAG_KEY   = "defaultActions";
// Incrémenté à chaque nouvelle action de base : le rattrapage au chargement
// complète alors les acteurs déjà traités par une version antérieure.
const VERSION    = 3;

/** Drapeau posé sur le combattant : échange d'arme autorisé pour ce round. */
export const SWAP_OPEN_FLAG = "swapOpenRound";

/**
 * Malus au seuil de touché quand on frappe des deux armes à la fois.
 * Sans lui, frapper des deux serait toujours meilleur que d'une seule : le
 * dé supplémentaire serait gratuit et le choix n'en serait pas un.
 *
 * À +1, frapper des deux reste légèrement avantageux (environ +15% de dégâts
 * espérés face à une cible de seuil moyen) — c'est le prix de l'absence de
 * bouclier. Réglable dans les options du monde pour ajuster à la table.
 */
export function dualWieldDifficulty() {
  try {
    const v = Number(game.settings.get("rpg", "dualWieldDifficulty"));
    return Number.isFinite(v) ? Math.max(0, v) : 1;
  } catch {
    return 1;   // réglage pas encore enregistré
  }
}

/** Clé stable posée sur l'objet, indépendante du nom affiché. */
export const ACTION_KEY_FLAG = "defaultActionKey";

/**
 * Repos — récupère de la fatigue.
 * Formule : 1d10 + 5 + Endurance/10, sur soi, sans cible ni jet de touché.
 */
function restActionData() {
  return {
    name: "Repos",
    type: "spell",
    img: "icons/magic/life/heart-cross-green.webp",
    system: {
      speed: "normal",
      livraison: "physique",
      tag: "neutre",
      coutMana: 0,
      fatigueCost: 0,          // se reposer ne coûte pas de fatigue
      difficulte: 0,
      range: { min: 0, max: 0 },
      targetCount: { min: 0, max: 0 },   // aucune cible requise
      cooldown: { max: 0, restant: 0 },
      damages: [],
      restores: [{
        id: "repos-fatigue",
        resource: "fatigue",
        cible: "self",
        dice: "1d10",
        flat: 5,
        stat: "endurance",
        per: 10,
        perStep: 1,
        critDice: "",
        critFlat: 0
      }],
      effectsUI: [],
      description: "<p>Le personnage souffle et récupère <b>1d10 + 5 + Endurance/10</b> "
                 + "points de fatigue. Coûte une action.</p>"
    },
    flags: { [FLAG_SCOPE]: { [ACTION_KEY_FLAG]: "repos" } }
  };
}

/**
 * Attaquer — frappe avec l'arme équipée, ou à mains nues.
 * L'objet ne porte aucune donnée de dégâts : tout vient de l'arme au moment
 * de la déclaration (voir runDefaultAction).
 */
function attackActionData() {
  return {
    name: "Attaquer",
    type: "spell",
    img: "icons/skills/melee/blade-tip-orange.webp",
    system: {
      speed: "normal",
      livraison: "physique",
      tag: "neutre",
      coutMana: 0,
      fatigueCost: 0,          // le coût vient de l'arme employée
      difficulte: 0,
      range: { min: 0, max: 0 },
      targetCount: { min: 1, max: 1 },
      cooldown: { max: 0, restant: 0 },
      damages: [], restores: [], effectsUI: [],
      description: "<p>Attaque avec l'arme équipée — ou à mains nues si le "
                 + "personnage n'en porte aucune. Cible un ennemi (touche T) "
                 + "avant de déclarer.</p>"
    },
    flags: { [FLAG_SCOPE]: { [ACTION_KEY_FLAG]: "attaquer" } }
  };
}

/**
 * Changer d'arme — déclare l'intention ; le MJ valide, ce qui débloque
 * l'échange pour le tour en cours.
 */
function swapActionData() {
  return {
    name: "Changer d'arme",
    type: "spell",
    img: "icons/skills/trades/smithing-anvil-silver-red.webp",
    system: {
      speed: "normal",
      livraison: "physique",
      tag: "neutre",
      coutMana: 0,
      fatigueCost: 0,
      difficulte: 0,
      range: { min: 0, max: 0 },
      targetCount: { min: 0, max: 0 },
      cooldown: { max: 0, restant: 0 },
      damages: [], restores: [], effectsUI: [],
      description: "<p>Dégainer, rengainer, prendre un bouclier. Hors combat "
                 + "c'est libre et immédiat. En combat il faut déclarer cette "
                 + "action : elle consomme une des 2 actions du tour, et le MJ "
                 + "la valide avant que l'équipement puisse changer.</p>"
    },
    flags: { [FLAG_SCOPE]: { [ACTION_KEY_FLAG]: "changerArme" } }
  };
}

/** Toutes les actions de base, indexées par clé. */
const DEFAULT_ACTIONS = {
  repos: restActionData,
  attaquer: attackActionData,
  changerArme: swapActionData
};

/** Types d'acteurs concernés. */
const TARGET_TYPES = new Set(["character", "monster"]);

/**
 * Ajoute à un acteur les actions de base qui lui manquent.
 * Idempotent : ne recrée jamais un objet déjà présent.
 * @returns {Promise<string[]>} clés effectivement ajoutées
 */
export async function grantDefaultActions(actor) {
  if (!actor || !TARGET_TYPES.has(actor.type)) return [];

  const missing = [];
  for (const [key, build] of Object.entries(DEFAULT_ACTIONS)) {
    const already = actor.items.some(i =>
      i.getFlag?.(FLAG_SCOPE, ACTION_KEY_FLAG) === key || i.name === build().name);
    if (!already) missing.push(build());
  }

  if (missing.length) await actor.createEmbeddedDocuments("Item", missing);
  try { await openMonsterToPlayers(actor); }
  catch (e) { console.warn(`[RPG] ouverture de la fiche de ${actor.name} :`, e); }
  await actor.setFlag(FLAG_SCOPE, FLAG_KEY, VERSION);
  return missing.map(m => m.name);
}

/**
 * Rattrapage sur les acteurs déjà créés avant l'arrivée de cette fonction.
 * Ne touche qu'aux acteurs jamais traités (drapeau absent ou plus ancien).
 * @returns {Promise<number>} nombre d'acteurs mis à jour
 */
export async function backfillDefaultActions() {
  if (!game.user.isGM) return 0;

  const todo = game.actors.filter(a =>
    TARGET_TYPES.has(a.type) && Number(a.getFlag(FLAG_SCOPE, FLAG_KEY) ?? 0) < VERSION);

  let done = 0;
  for (const actor of todo) {
    try {
      const added = await grantDefaultActions(actor);
      if (added.length) done++;
    } catch (e) {
      console.warn(`[RPG] actions de base sur ${actor.name} :`, e);
    }
  }
  if (done) console.log(`[RPG] Actions de base ajoutées à ${done} acteur(s).`);
  return done;
}

/**
 * Ouvre la fiche d'un monstre à la consultation des joueurs.
 *
 * Sans au moins le niveau « Limité », Foundry refuse purement et simplement
 * d'ouvrir la fiche : le joueur ne verrait même pas l'illustration. La fiche
 * elle-même ne montre que l'illustration et la description tant que le MJ
 * n'a pas décidé d'en révéler plus (system.pvReveal).
 *
 * On ne touche qu'aux monstres restés sur « Aucun » : un réglage posé
 * volontairement par le MJ n'est jamais écrasé.
 */
export async function openMonsterToPlayers(actor) {
  if (!actor || actor.type !== "monster") return false;
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const current = Number(actor.ownership?.default ?? LEVELS.NONE);
  if (current !== LEVELS.NONE) return false;
  await actor.update({ "ownership.default": LEVELS.LIMITED });
  return true;
}

/** Clé d'action de base portée par un objet, ou null. */
export function defaultActionKey(item) {
  return item?.getFlag?.(FLAG_SCOPE, ACTION_KEY_FLAG) ?? null;
}

/** Le combattant correspondant à cet acteur dans le combat en cours. */
function combatantFor(actor, combat = game.combat) {
  if (!combat || !actor) return null;
  const token = actor.getActiveTokens?.()?.[0] ?? null;
  return combat.combatants.find(c =>
    c.actorId === actor.id || (token && c.tokenId === token.id)) ?? null;
}

/**
 * L'échange d'arme a-t-il déjà été payé et validé pour le tour en cours ?
 * Hors combat, ou pour un acteur absent du combat, l'échange est libre.
 */
export function swapAllowed(actor) {
  const combat = game.combat;
  if (!combat?.active) return { ok: true };
  const cbt = combatantFor(actor, combat);
  if (!cbt) return { ok: true };
  const open = Number(cbt.getFlag(FLAG_SCOPE, SWAP_OPEN_FLAG) ?? -1);
  if (open === Number(combat.round)) return { ok: true };
  return {
    ok: false,
    reason: "En combat, déclare d'abord l'action « Changer d'arme » "
          + "(onglet Sorts) et attends la validation du MJ."
  };
}

/**
 * Choisit l'arme d'attaque. Avec deux armes équipées (une par main) on
 * demande laquelle ; sans arme du tout on frappe à mains nues.
 */
async function pickAttackWeapon(actor) {
  const { buildUnarmedWeapon } = await import("./unarmed.js");
  const equipped = actor.items.filter(i => i.type === "weapon" && i.system?.equipe);
  if (!equipped.length) return { weapon: buildUnarmedWeapon(actor), hand: null, offhand: null };
  if (equipped.length === 1) {
    return { weapon: equipped[0], hand: handLabel(equipped[0]), offhand: null };
  }

  // Deux armes équipées. L'attaque reste UNE action : le personnage frappe
  // soit d'une seule arme, soit des deux. Dans ce dernier cas la seconde
  // n'apporte que son dé — ni part fixe, ni bonus de stat — et le coup est
  // plus dur à placer.
  const DialogV2 = foundry.applications.api.DialogV2;
  const describe = (w) => {
    const dice = String(w.system?.damage?.dice ?? "").trim();
    return `${w.name} — ${handLabel(w)}${dice ? ` (${dice})` : ""}`;
  };
  const ask = (title, content, buttons) => DialogV2.wait({
    window: { title }, content, buttons, rejectClose: false
  });

  // Difficulté annoncée : la plus haute des deux armes + le malus. Bornée à 4
  // comme partout ailleurs, pour ne pas promettre un seuil que le moteur
  // n'appliquera pas.
  const diffOf = (w) => Number(w?.system?.difficulte ?? 0) || 0;
  const diffSolo = Math.max(...equipped.map(diffOf));
  const diffDuo  = Math.min(4, diffSolo + dualWieldDifficulty());

  try {
    const mode = await ask(
      "Comment frappes-tu ?",
      `<p style="margin:0 0 6px">${actor.name} tient une arme dans chaque main.</p>
       <p style="opacity:.75;font-size:12px;margin:0">Frapper des deux ajoute le dé de
       la seconde arme, mais retient la difficulté de la plus délicate à manier,
       majorée de ${dualWieldDifficulty()} — soit une difficulté de
       <b>${diffDuo}</b>.</p>`,
      [{ action: "one", label: "⚔️ Une seule arme" },
       { action: "two", label: "⚔️⚔️ Les deux armes" }]
    );
    if (!mode) return { weapon: equipped[0], hand: handLabel(equipped[0]), offhand: null };

    const chosen = await ask(
      mode === "two" ? "Quelle arme porte le coup principal ?" : "Attaquer avec quelle arme ?",
      mode === "two"
        ? `<p style="margin:0;opacity:.75;font-size:12px">Elle inflige ses dégâts complets.
           L'autre n'ajoutera que son dé.</p>`
        : "",
      equipped.map(w => ({ action: w.id, label: describe(w) }))
    );

    const weapon = actor.items.get(chosen) ?? equipped[0];
    const offhand = mode === "two"
      ? (equipped.find(w => w.id !== weapon.id) ?? null)
      : null;
    return { weapon, hand: handLabel(weapon), offhand };
  } catch (e) {
    console.warn("[RPG] choix de l'arme d'attaque :", e);
    return { weapon: equipped[0], hand: handLabel(equipped[0]), offhand: null };
  }
}

/** « main gauche » / « main droite » selon l'emplacement de l'arme. */
function handLabel(weapon) {
  const slot = weapon?.system?.emplacement;
  if (slot === "mainGauche") return "main gauche";
  if (slot === "mainDroite") return "main droite";
  return null;
}

/**
 * Exécute une action de base si l'objet en est une.
 * @returns {Promise<{handled: boolean, ok?: boolean, reason?: string}>}
 */
export async function runDefaultAction(actor, item, { targetToken = null } = {}) {
  const key = defaultActionKey(item);
  if (key !== "attaquer" && key !== "changerArme") return { handled: false };

  // ── Attaquer ───────────────────────────────────────────────────────────
  if (key === "attaquer") {
    const target = targetToken ?? Array.from(game.user.targets ?? [])[0] ?? null;
    if (!target?.actor) {
      return { handled: true, ok: false, reason: "Cible un ennemi (touche T) avant d'attaquer." };
    }
    const { weapon, hand, offhand } = await pickAttackWeapon(actor);
    if (!weapon) return { handled: true, ok: false, reason: "Aucune arme utilisable." };

    // On précise la main : avec deux armes du même nom, le MJ doit pouvoir
    // dire laquelle a servi.
    const esc = (s) => String(s ?? "").replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const title = `Attaque : <b>${esc(weapon.name)}</b>`
                + (hand ? ` <span style="opacity:.7">(${hand})</span>` : "")
                + (offhand ? ` <b>+ ${esc(offhand.name)}</b>` : "")
                + ` → <b>${esc(target.actor.name)}</b>`;

    // Frapper des deux : on retient la difficulté la plus haute des deux armes
    // — manier la plus délicate conditionne tout le coup — et on y ajoute le
    // malus de double armement.
    const diffOf = (w) => Number(w?.system?.difficulte ?? 0) || 0;
    const difficulte = offhand
      ? Math.max(diffOf(weapon), diffOf(offhand)) + dualWieldDifficulty()
      : undefined;

    const { declareAttack } = await import("./attack-declare.js");
    await declareAttack(actor, weapon, target.actor, { title, offhand, difficulte });
    return { handled: true, ok: true };
  }

  // ── Changer d'arme ─────────────────────────────────────────────────────
  const combat = game.combat;
  if (!combat?.active) {
    return { handled: true, ok: false,
             reason: "Hors combat, équipe-toi librement depuis l'onglet Équipement." };
  }
  const cbt = combatantFor(actor, combat);
  if (!cbt) {
    return { handled: true, ok: false,
             reason: "Tu n'es pas dans ce combat — équipe-toi librement." };
  }
  if (combat.combatant?.id !== cbt.id) {
    return { handled: true, ok: false, reason: "Ce n'est pas ton tour." };
  }
  if (Number(cbt.getFlag(FLAG_SCOPE, SWAP_OPEN_FLAG) ?? -1) === Number(combat.round)) {
    return { handled: true, ok: false, reason: "Tu as déjà changé d'arme ce tour." };
  }

  // Le joueur ne peut pas écrire sur le document Combat : il déclare, le MJ
  // valide. C'est la validation qui consomme l'action et ouvre l'échange.
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div style="font-size:13px">
        🔄 <b>${actor.name}</b> veut <b>changer d'arme</b>.
        <div style="opacity:.75;font-size:11px;margin-top:2px">
          Coûte 1 action. En attente de la validation du MJ.
        </div>
        <div class="rpg-swap-gm" style="margin-top:8px;display:flex;gap:8px">
          <button type="button" class="rpg-swap-btn" data-ok="1" data-combatant-id="${cbt.id}"
            style="flex:1;padding:4px;cursor:pointer;background:#1d9e75;color:#fff;border:none;border-radius:5px;font-weight:600">
            ✅ Autoriser
          </button>
          <button type="button" class="rpg-swap-btn" data-ok="0" data-combatant-id="${cbt.id}"
            style="flex:1;padding:4px;cursor:pointer;background:#c0392b;color:#fff;border:none;border-radius:5px">
            ❌ Refuser
          </button>
        </div>
      </div>`,
    flags: { rpg: { swapRequest: { combatantId: cbt.id, combatId: combat.id, actorId: actor.id } } }
  });
  return { handled: true, ok: true };
}

/**
 * Boutons MJ du message « changer d'arme ».
 * Branché depuis le hook renderChatMessageHTML.
 */
export function bindSwapChatButtons(html, message) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const req = message?.getFlag?.("rpg", "swapRequest")
           ?? message?.flags?.rpg?.swapRequest ?? null;
  root?.querySelectorAll(".rpg-swap-btn:not([data-bound])").forEach(btn => {
    btn.dataset.bound = "1";
    if (!game.user.isGM) { btn.style.display = "none"; return; }
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const all = btn.closest(".rpg-swap-gm")?.querySelectorAll("button");
      all?.forEach(b => b.disabled = true);
      try {
        const combat = (req?.combatId ? game.combats.get(req.combatId) : null) ?? game.combat;
        const cbt = combat?.combatants?.get(btn.dataset.combatantId);
        if (!cbt) { ui.notifications?.warn?.("Combattant introuvable."); return; }

        if (btn.dataset.ok === "1") {
          const { getBudget, saveBudget, canUseSlot, reserveSlot, confirmSlot } =
            await import("./action-budget.js");
          const budget = getBudget(combat, cbt.id);
          if (!canUseSlot(budget, "echangeArme")) {
            ui.notifications?.warn?.("Plus d'action disponible ce tour.");
            await ChatMessage.create({ content: `❌ <b>${cbt.actor?.name ?? cbt.name}</b> n'a plus d'action pour changer d'arme.` });
            return;
          }
          await saveBudget(combat, cbt.id,
            confirmSlot(reserveSlot(budget, "echangeArme"), "echangeArme"));
          await cbt.setFlag(FLAG_SCOPE, SWAP_OPEN_FLAG, Number(combat.round));
          await ChatMessage.create({
            content: `✅ <b>${cbt.actor?.name ?? cbt.name}</b> peut changer d'équipement ce tour <i>(1 action)</i>.`
          });
        } else {
          await ChatMessage.create({ content: `❌ Changement d'arme refusé par le MJ.` });
        }
        btn.closest(".message-content")?.querySelectorAll("button").forEach(b => b.style.display = "none");
      } catch (e) {
        console.error("[RPG] validation du changement d'arme :", e);
        all?.forEach(b => b.disabled = false);
      }
    });
  });
}

/** Branche l'attribution automatique à la création d'un acteur. */
export function installDefaultActions() {
  Hooks.on("createActor", async (actor, options, userId) => {
    if (userId !== game.userId) return;
    if (!game.user.isGM) return;
    if (!TARGET_TYPES.has(actor.type)) return;
    try {
      await grantDefaultActions(actor);
    } catch (e) {
      console.warn("[RPG] actions de base à la création :", e);
    }
  });
}
