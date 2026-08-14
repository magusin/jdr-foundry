// module/rules/hotbar.js
//
// Barre d'actions : glisser un sort (ou une arme) depuis la fiche d'un
// personnage vers la barre du bas crée une macro qui le déclenche.
//
// Trois usages :
//   1. Glisser-déposer  → la macro est créée automatiquement dans le bon slot
//   2. Clic             → déclare le sort / l'attaque, comme depuis la fiche
//   3. Survol           → affiche la portée du sort sur le canevas
//
// La macro stocke l'UUID de l'objet dans un flag : on retrouve donc toujours
// l'objet réel, même si son nom change.

const FLAG_SCOPE = "rpg";
const FLAG_ITEM  = "hotbarItemUuid";

// Un clic sur l'icône de la barre d'actions ne désactive rien visuellement
// (contrairement au bouton « Déclarer » de la fiche, qui se désactive le
// temps du traitement) : un joueur impatient qui reclique pendant que la
// première déclaration est encore en cours crée deux jets/messages pour une
// seule intention. On verrouille donc par UUID d'objet le temps du traitement.
const IN_FLIGHT = new Set();

/**
 * Déclenche un objet depuis la barre d'actions.
 * Sort → workflow de sort ; arme → déclaration d'attaque.
 * @param {string} uuid - UUID de l'objet
 */
export async function useItemFromHotbar(uuid) {
  if (IN_FLIGHT.has(uuid)) return;
  IN_FLIGHT.add(uuid);
  try {
    return await useItemFromHotbarImpl(uuid);
  } finally {
    IN_FLIGHT.delete(uuid);
  }
}

async function useItemFromHotbarImpl(uuid) {
  const item = await fromUuid(uuid).catch(() => null);
  if (!item) {
    return ui.notifications?.warn?.("Objet introuvable — il a peut-être été supprimé.");
  }

  const actor = item.parent;
  if (!actor) {
    return ui.notifications?.warn?.(`${item.name} n'appartient à aucun personnage.`);
  }
  if (!actor.isOwner) {
    return ui.notifications?.warn?.(`Tu ne contrôles pas ${actor.name}.`);
  }

  const casterToken = actor.getActiveTokens?.()?.[0]
                   ?? canvas?.tokens?.controlled?.[0] ?? null;
  const targetToken = Array.from(game.user.targets ?? [])[0] ?? null;

  if (item.type === "spell") {
    // Actions de base (Attaquer, Changer d'arme) : logique dédiée, pas le
    // workflow de sort.
    const { runDefaultAction } = await import("./default-actions.js");
    const special = await runDefaultAction(actor, item, { targetToken });
    if (special.handled) {
      // `cancelled` = le joueur a fermé la fenêtre de choix : ni action, ni
      // avertissement (voir pickAttackWeapon).
      if (!special.ok && !special.cancelled) {
        ui.notifications?.warn?.(special.reason ?? "Action impossible.");
      }
      return special;
    }

    // Les mêmes verrous que depuis la fiche : un raccourci ne doit jamais
    // permettre de contourner la recharge ou le coût en mana.
    const cd = Number(item.system?.cooldown?.restant ?? item.system?.recharge?.restant ?? 0) || 0;
    if (cd > 0) {
      return ui.notifications?.warn?.(`${item.name} est en recharge : ${cd} tour(s) restant(s).`);
    }
    const manaCost = Number(item.system?.coutMana ?? 0) || 0;
    const manaCur  = Number(actor.system?.ressources?.mana?.valeur ?? 0) || 0;
    if (manaCost > 0 && manaCur < manaCost) {
      return ui.notifications?.warn?.(`Mana insuffisant : ${manaCur}/${manaCost} requis.`);
    }

    // targetToken volontairement omis : declareSpell lit alors LUI-MÊME
    // toutes les cibles visées (game.user.targets). En lui passant
    // `targetToken` — le PREMIER ciblé — un sort multi-cible lancé depuis la
    // barre d'actions ne touchait qu'un seul token, et un sort exigeant 2
    // cibles minimum se faisait refuser « 1 sélectionnée » alors que le
    // joueur en avait bien visé deux.
    const { declareSpell } = await import("./spells.js");
    const res = await declareSpell(actor, item, { casterToken });
    if (!res?.ok) ui.notifications?.warn?.(res?.reason ?? "Impossible de lancer ce sort.");
    return res;
  }

  if (item.type === "weapon") {
    if (!targetToken?.actor) {
      return ui.notifications?.warn?.("Cible un ennemi (touche T) avant d'attaquer.");
    }
    const { declareAttack } = await import("./attack-declare.js");
    return declareAttack(actor, item, targetToken.actor, { attackerToken: casterToken, targetToken });
  }

  // Autres types : on ouvre simplement la fiche
  item.sheet?.render(true);
}

/**
 * Crée (ou réutilise) la macro d'un objet et la place dans la barre.
 * Appelé par le hook « hotbarDrop ».
 */
export async function createItemMacro(item, slot) {
  if (!item?.uuid) return null;

  const command = `game.rpg.useItemFromHotbar("${item.uuid}");`;
  const name = item.name ?? "Objet";

  // Réutilise une macro identique déjà créée pour ce même objet
  let macro = game.macros.find(m =>
    m.getFlag(FLAG_SCOPE, FLAG_ITEM) === item.uuid && m.command === command);

  if (!macro) {
    // Créer une macro de script demande la permission « Créer des macros de
    // script », que le rôle Joueur n'a pas par défaut dans Foundry. Sans elle
    // l'appel échoue : on l'explique au lieu de laisser une erreur brute.
    if (!game.user.can("MACRO_SCRIPT")) {
      ui.notifications?.error?.(
        "Tu n'as pas le droit de créer des macros. Le MJ doit activer "
      + "« Créer des macros de script » dans Configuration → Permissions des utilisateurs."
      );
      return null;
    }
    macro = await Macro.create({
      name,
      type: "script",
      img: item.img,
      command,
      flags: { [FLAG_SCOPE]: { [FLAG_ITEM]: item.uuid } }
    }, { renderSheet: false });
  }

  await game.user.assignHotbarMacro(macro, slot);
  return macro;
}

/**
 * Survol d'un emplacement de la barre : si la macro pointe vers un sort,
 * on dessine sa portée sur le canevas — le joueur voit d'où il peut viser
 * sans ouvrir sa fiche.
 */
function bindHotbarHover() {
  const bar = document.getElementById("hotbar") ?? document.querySelector("#hotbar, .hotbar");
  if (!bar || bar.dataset.rpgHover) return;
  bar.dataset.rpgHover = "1";

  /** L'emplacement de barre sous le curseur, quel que soit l'enfant visé. */
  const slotOf = (el) => el?.closest?.("[data-slot], .macro, .slot") ?? null;

  const uuidOfSlot = (slotEl) => {
    if (!slotEl) return null;
    const slot = Number(slotEl.dataset?.slot);
    // `data-macro-id` n'existe pas sur toutes les versions de la barre : le
    // repli par numéro d'emplacement (game.user.hotbar) marche partout.
    const macroId = slotEl.dataset?.macroId
                 ?? (Number.isFinite(slot) ? game.user.hotbar?.[slot] : null);
    const macro = macroId ? game.macros.get(macroId) : null;
    return macro?.getFlag?.(FLAG_SCOPE, FLAG_ITEM) ?? null;
  };

  // ⚠️ `mouseover`/`mouseout` se redéclenchent à CHAQUE enfant traversé
  // (l'image, le numéro d'emplacement…), pas seulement en entrant et en
  // sortant de la case. Avec un dessin asynchrone (fromUuid), le nettoyage
  // déclenché par la sortie de l'image pouvait donc arriver APRÈS le dessin
  // demandé par l'entrée dans la case : plus rien ne s'affichait, ou par
  // à-coups. On ne réagit donc qu'aux vrais changements de case, et un
  // dessin devenu obsolète pendant son await est abandonné.
  let current = null;   // élément d'emplacement actuellement survolé
  let seq = 0;          // n° du dernier survol demandé

  const leave = () => {
    current = null;
    seq++;
    try { game.rpg?.ranges?.clearRanges?.(); } catch { /* ignore */ }
  };

  bar.addEventListener("mouseover", async (ev) => {
    const slotEl = slotOf(ev.target);
    if (slotEl === current) return;        // simple déplacement interne
    if (!slotEl) return leave();
    current = slotEl;
    const mine = ++seq;

    try {
      const uuid = uuidOfSlot(slotEl);
      // Trace lisible en console (F12) si un survol « ne fait rien » : le
      // balisage de la barre d'actions varie d'une version de Foundry à
      // l'autre, et c'est le seul maillon qu'on ne peut pas vérifier hors
      // d'une vraie session.
      console.debug("[RPG] survol barre d'actions :", {
        slot: slotEl.dataset?.slot, macroId: slotEl.dataset?.macroId, uuid
      });
      if (!uuid) return;
      const item = await fromUuid(uuid).catch(() => null);
      const actor = item?.parent;
      if (!item || !actor) return;
      if (mine !== seq) return;            // le curseur est déjà reparti

      const api = game.rpg?.ranges;
      if (!api) return;
      // Un sort porte sa propre portée ; « Attaquer » n'en a pas et retombe
      // sur l'arme équipée (géré dans showSpellRangeOverlay).
      if (item.type === "spell") api.showSpellRange?.(actor, item);
      else if (item.type === "weapon") {
        const token = actor.getActiveTokens?.()?.[0] ?? canvas?.tokens?.controlled?.[0];
        if (token) api.showTokenRanges?.(token);
      }
    } catch (e) { console.warn("[RPG] aperçu de portée (barre d'actions) :", e); }
  });

  // On ne nettoie qu'en quittant réellement la case (ou la barre) : passer de
  // l'image au <li> parent n'est pas une sortie.
  bar.addEventListener("mouseout", (ev) => {
    const to = ev.relatedTarget;
    if (to && bar.contains(to) && slotOf(to) === current) return;
    leave();
  });
}

/** Installe le hook de dépôt et le survol de la barre (idempotent). */
export function installHotbarSupport() {
  if (globalThis.__rpgHotbar) return;
  globalThis.__rpgHotbar = true;

  Hooks.on("hotbarDrop", (hotbar, data, slot) => {
    if (data?.type !== "Item") return;          // laisse passer le reste
    // Résolution asynchrone : on rend la main tout de suite en signalant
    // qu'on prend le dépôt en charge (sinon Foundry crée sa propre macro).
    (async () => {
      try {
        const item = await fromUuid(data.uuid);
        if (!item) return;
        await createItemMacro(item, slot);
      } catch (e) {
        console.error("[RPG] création de la macro d'objet :", e);
        ui.notifications?.error?.("Impossible de créer la macro pour cet objet.");
      }
    })();
    return false;   // on a géré le dépôt
  });

  Hooks.on("renderHotbar", () => bindHotbarHover());
  bindHotbarHover();
}
