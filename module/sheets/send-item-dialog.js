// module/sheets/send-item-dialog.js
//
// Bouton "Envoyer" présent sur chaque fiche d'objet (MJ uniquement) : copie
// l'objet directement vers un ou plusieurs PJ choisis dans une popup, sans
// passer par le glisser-déposer (qui reste possible en parallèle — les deux
// chemins créent le même type de copie embarquée indépendante).

import { splitCharacters } from "../rules/actor-roles.js";

// Réexport historique : plusieurs fiches importent partyCharacters d'ici.
// La définition (et surtout le tri PJ / PNJ) vit dans rules/actor-roles.js.
export { partyCharacters, npcCharacters } from "../rules/actor-roles.js";

/**
 * Ouvre une popup de sélection de destinataires (cases à cocher + "Tous"),
 * puis crée une copie indépendante de l'objet sur chaque PJ choisi.
 * Si une quête est envoyée à plusieurs PJ à la fois, les copies reçoivent un
 * questGroupId commun (comme une quête "partagée") pour que leur progression
 * reste synchronisée sans action supplémentaire du MJ.
 */
export async function promptSendItemToActors(item) {
  if (!game.user.isGM || !item) return;

  // PJ et PNJ séparés : un PNJ n'est pas un destinataire ordinaire, et
  // noyé au milieu des PJ il faisait rater la case voisine (les deux sont
  // des acteurs `character`, seul rules/actor-roles.js les distingue).
  // Les PNJ restent accessibles dans une section repliée plutôt que
  // supprimés — un PJ sans compte joueur attribué est rangé avec eux, il
  // ne doit pas devenir impossible à servir depuis cette fenêtre.
  const { pjs, npcs } = splitCharacters();
  if (!pjs.length && !npcs.length) {
    ui.notifications?.warn?.("Aucun personnage dans le monde.");
    return;
  }

  const row = (a) => `
    <label style="display:flex;align-items:center;gap:6px;padding:2px 0">
      <input type="checkbox" data-actor-id="${a.id}" />
      ${a.name}
    </label>`;

  const pjBlock = pjs.length ? `
    <div>
      <label style="display:flex;align-items:center;gap:6px;font-weight:600">
        <input type="checkbox" id="send-all" /> Tous les PJ (${pjs.length})
      </label>
      <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;padding-top:6px">
        ${pjs.map(row).join("")}
      </div>
    </div>` : `
    <div style="font-size:12px;opacity:.6">Aucun personnage joueur — voir les PNJ ci-dessous.</div>`;

  const npcBlock = npcs.length ? `
    <details style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px">
      <summary style="cursor:pointer;font-size:12px;opacity:.75">
        🎭 PNJ (${npcs.length})
      </summary>
      <label style="display:flex;align-items:center;gap:6px;font-weight:600;margin-top:6px">
        <input type="checkbox" id="send-all-npc" /> Tous les PNJ
      </label>
      <div style="margin-top:4px">${npcs.map(row).join("")}</div>
      <div style="font-size:11px;opacity:.55;margin-top:4px">
        Un personnage est classé ici tant qu'aucun joueur ne le possède.
        Pour le remettre parmi les PJ : onglet 🎭 PNJ / RP de sa fiche →
        « Toujours la fiche complète (PJ) ».
      </div>
    </details>` : "";

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:12px;color:var(--color-text-secondary)">
        Envoyer <b>${item.name}</b> à :
      </div>
      ${pjBlock}
      ${npcBlock}
    </div>`;

  const readSelection = (root) => {
    const ids = new Set(
      Array.from(root?.querySelectorAll("input[data-actor-id]") ?? [])
        .filter(el => el.checked && !el.disabled)
        .map(el => el.dataset.actorId)
    );
    // Les cases « Tous » désactivent les cases individuelles de LEUR
    // groupe : sans ces deux lignes, cocher « Tous les PJ » n'enverrait
    // qu'aux PNJ éventuellement cochés à la main.
    if (root?.querySelector("#send-all")?.checked) pjs.forEach(a => ids.add(a.id));
    if (root?.querySelector("#send-all-npc")?.checked) npcs.forEach(a => ids.add(a.id));
    return Array.from(ids);
  };

  const bindAllToggle = (root) => {
    const bind = (toggleId, group) => {
      const toggle = root?.querySelector(`#${toggleId}`);
      if (!toggle) return;
      const ids = new Set(group.map(a => a.id));
      toggle.addEventListener("change", (ev) => {
        root.querySelectorAll("input[data-actor-id]").forEach(el => {
          if (ids.has(el.dataset.actorId)) el.disabled = ev.target.checked;
        });
      });
    };
    bind("send-all", pjs);
    bind("send-all-npc", npcs);
  };

  const selectedIds = await new Promise((resolve) => {
    const DialogClass = foundry?.applications?.api?.DialogV2 ?? globalThis.Dialog;
    const isV2 = DialogClass === foundry?.applications?.api?.DialogV2;

    if (isV2) {
      const dlg = new DialogClass({
        window: { title: `Envoyer « ${item.name} »` },
        content,
        buttons: [
          {
            action: "send",
            label: "📤 Envoyer",
            default: true,
            callback: (_event, _button, dialog) => {
              const root = dialog.element ?? dialog?.form ?? dialog;
              resolve(readSelection(root));
            }
          },
          { action: "cancel", label: "Annuler", callback: () => resolve([]) }
        ],
        close: () => resolve([])
      });
      dlg.render(true).then(() => bindAllToggle(dlg.element));
      return;
    }

    new Dialog({
      title: `Envoyer « ${item.name} »`,
      content,
      render: (html) => bindAllToggle(html?.[0] ?? html),
      buttons: {
        send: { label: "📤 Envoyer", callback: (html) => resolve(readSelection(html?.[0] ?? html)) },
        cancel: { label: "Annuler", callback: () => resolve([]) }
      },
      default: "send",
      close: () => resolve([])
    }, { width: 380 }).render(true);
  });

  if (!selectedIds.length) return;
  const targets = selectedIds.map(id => game.actors.get(id)).filter(Boolean);
  if (!targets.length) return;

  // Pas d'étape de synchro à faire ici : item-link.js assortit les objets
  // par empreinte (type + source de compendium/nom) à chaque modification,
  // pas au moment de l'envoi — la copie créée plus bas sera trouvée toute
  // seule dès la prochaine édition de la source, sans rien faire de plus.

  const baseData = item.toObject();
  delete baseData._id;

  if (item.type === "quest") {
    // Traçabilité "qui a cette quête" — posée dans tous les cas (même un
    // envoi à un seul PJ), indépendamment de "partagee" : c'est elle que la
    // fiche de la quête source relit pour afficher la liste des
    // destinataires. Persistée sur l'ITEM SOURCE (pas seulement la copie)
    // pour qu'un second envoi ultérieur retrouve le même identifiant.
    const { ensureDistribGroupId, ensureQuestGroupId } = await import("../rules/quest-group.js");
    const distribId = await ensureDistribGroupId(item);
    baseData.system = baseData.system ?? {};
    if (distribId) baseData.system.distribGroupId = distribId;

    if (targets.length > 1) {
      // ensureQuestGroupId persiste questGroupId sur L'ITEM SOURCE (pas
      // seulement baseData, la copie en cours de préparation) — même
      // raison que distribGroupId ci-dessus : sans ça, un envoi ultérieur
      // à un seul PJ (ou une case cochée dans la liste des destinataires)
      // relirait un questGroupId encore vide sur la source et créerait une
      // copie hors du groupe de synchro déjà utilisé par ce premier envoi.
      if (!item.system?.partagee) await item.update({ "system.partagee": true });
      const gid = await ensureQuestGroupId(item);
      baseData.system.partagee = true;
      if (gid) baseData.system.questGroupId = gid;
    }
  }

  // Empilement des Objets (type loot) : un PJ qui possède déjà celui-ci
  // voit sa quantité augmenter au lieu de recevoir une seconde ligne —
  // voir rules/inventory.js.
  const { addItemToActor } = await import("../rules/inventory.js");

  const sentTo = [];
  for (const actor of targets) {
    try {
      const res = await addItemToActor(actor, foundry.utils.deepClone(baseData));
      if (res.refused) ui.notifications?.warn?.(res.reason);
      else if (res.item) sentTo.push(res.stacked ? `${actor.name} (×${res.total})` : actor.name);
    } catch (e) {
      console.error(`[RPG] Envoi de "${item.name}" à ${actor.name} :`, e);
      ui.notifications?.error?.(`Échec de l'envoi à ${actor.name} — voir la console.`);
    }
  }

  if (sentTo.length) {
    ui.notifications?.info?.(`« ${item.name} » envoyé à ${sentTo.join(", ")}.`);
  }
}

/**
 * Branche le bouton [data-action="sendToActors"] d'une fiche d'objet
 * (idempotent). `options.beforeSend`, si fourni, est attendu AVANT
 * promptSendItemToActors — utilisé par la fiche Quête pour forcer la
 * sauvegarde de ses champs <prose-mirror> (récit/notes MJ/description)
 * avant que la copie envoyée au PJ (un item.toObject() de l'instant T) ne
 * soit prise, sans quoi un texte tapé mais jamais committé serait absent
 * de cette copie-là aussi.
 */
export function bindSendToActorsButton(root, item, options = {}) {
  const btn = root?.querySelector('[data-action="sendToActors"]');
  if (!btn || btn.dataset.rpgSendBound) return;
  btn.dataset.rpgSendBound = "1";
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (!game.user.isGM) return;
    try {
      await options.beforeSend?.();
      await promptSendItemToActors(item);
    }
    catch (e) { console.error("[RPG] Envoyer à un PJ :", e); ui.notifications?.error?.("Erreur — voir la console."); }
  });
}

/**
 * Branche la case [data-action="toggleLinkSync"] d'une fiche d'objet (MJ
 * uniquement) — voir item-link.js. La synchro est active PAR DÉFAUT pour
 * tout exemplaire du même type+empreinte (pas besoin de cocher quoi que
 * ce soit) ; cette case ne sert donc qu'à SORTIR cet exemplaire précis du
 * groupe (le décocher), ou à annuler un désistement antérieur (le
 * recocher). Volontairement PAS un <input name="..."> soumis par le
 * formulaire normal de la fiche, pour rester un geste explicite et
 * immédiat plutôt qu'un champ parmi d'autres.
 */
export function bindLinkSyncCheckbox(root, item) {
  const input = root?.querySelector('[data-action="toggleLinkSync"]');
  if (!input || input.dataset.rpgLinkSyncBound) return;
  input.dataset.rpgLinkSyncBound = "1";
  input.addEventListener("change", async (ev) => {
    ev.preventDefault();
    // ⚠️ Ces fiches (arme/armure/générique/recette) tournent en
    // submitOnChange:true : SANS stopPropagation, ce même évènement
    // "change" continue de remonter jusqu'au listener délégué de
    // DocumentSheetV2 sur le <form>, qui déclenche EN PARALLÈLE sa propre
    // resoumission complète + this.render({force:true}) — deux cycles
    // update+render concurrents sur le même document, l'un écrasant l'état
    // DOM de l'autre en plein rendu. Symptôme rapporté : cocher la case
    // rendait la fiche définitivement impossible à rouvrir. Le champ n'a
    // de toute façon pas de "name" (volontairement, voir plus haut) donc
    // rien ne serait perdu côté formulaire à stopper la propagation ici.
    ev.stopPropagation();
    if (!game.user.isGM) return;
    const checked = !!input.checked;
    try {
      const { setItemSyncOptOut } = await import("../rules/item-link.js");
      const others = await setItemSyncOptOut(item, !checked);
      if (checked) {
        ui.notifications?.info?.(others.length
          ? `Synchronisé avec ${others.length} copie(s) du même objet.`
          : "Synchronisé (aucune autre copie détectée pour l'instant).");
      } else {
        ui.notifications?.info?.("Cet exemplaire ne suit plus les autres copies (et elles ne le suivent plus).");
      }
    } catch (e) {
      console.error("[RPG] Bascule synchro objet lié :", e);
      ui.notifications?.error?.("Erreur — voir la console.");
      input.checked = !checked;
    }
  });
}
