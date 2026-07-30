// module/rules/chat-visibility.js
//
// Visibilité sélective à l'intérieur d'un message de chat.
//
// Un message de chat est un document unique : son HTML est identique pour
// tout le monde. Impossible donc de « masquer une ligne » à la création —
// il faut la retirer au rendu, côté client, en fonction de qui regarde.
//
// Deux marqueurs :
//   • <span class="rpg-gm-only">…</span>
//       → visible du MJ seul. Sert aux verdicts (« Touché ! ») qui ne doivent
//         pas devancer la validation du MJ.
//   • <span class="rpg-hp-secret" data-actor-uuid="…">…</span>
//       → visible du MJ et des propriétaires de l'acteur concerné. Sert aux
//         PV restants : un joueur ne doit pas lire la barre de vie d'un
//         monstre, mais garde le détail pour son propre personnage.
//
// Les blocs sont retirés du DOM (pas seulement cachés en CSS) : un joueur
// curieux qui inspecte la page ne doit rien pouvoir lire.

/** Enveloppe un fragment HTML réservé au MJ. */
export function gmOnly(html) {
  if (html === null || html === undefined || html === "") return "";
  return `<span class="rpg-gm-only">${html}</span>`;
}

/**
 * Enveloppe un fragment HTML contenant les PV d'un acteur.
 * @param {Actor|null} actor - acteur concerné (pour le test de propriété)
 * @param {string} html      - fragment à protéger
 */
export function hpSecret(actor, html) {
  if (html === null || html === undefined || html === "") return "";
  const uuid = actor?.uuid ?? "";
  return `<span class="rpg-hp-secret" data-actor-uuid="${uuid}">${html}</span>`;
}

/** Le spectateur courant a-t-il le droit de voir les PV de cet acteur ? */
function canSeeHp(uuid) {
  if (game.user?.isGM) return true;
  if (!uuid) return false;
  try {
    const doc = fromUuidSync(uuid);
    const actor = doc?.actor ?? doc;   // TokenDocument → Actor synthétique
    if (actor?.isOwner) return true;
    // Monstre : le MJ peut choisir de révéler les PV exacts sur la fiche
    // (system.pvReveal). "pct" ne donne droit qu'à un pourcentage arrondi
    // affiché sur la fiche — le chat, lui, n'affiche que des valeurs
    // exactes, donc seul le mode "exact" débloque ces messages.
    if (actor?.type === "monster" && String(actor?.system?.pvReveal ?? "none") === "exact") {
      return true;
    }
    return false;
  } catch {
    return false;   // uuid non résolvable côté joueur → on masque
  }
}

/**
 * Applique les règles de visibilité sur un message rendu.
 * Appelé depuis le hook « renderChatMessageHTML ».
 * @param {HTMLElement|jQuery} html
 */
export function applyChatVisibility(html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  if (!game.user?.isGM) {
    root.querySelectorAll(".rpg-gm-only").forEach(el => el.remove());
  }

  root.querySelectorAll(".rpg-hp-secret").forEach(el => {
    if (!canSeeHp(el.dataset.actorUuid)) el.remove();
  });
}
