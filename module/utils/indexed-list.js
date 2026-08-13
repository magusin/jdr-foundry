// module/utils/indexed-list.js
//
// Écrire dans UNE case d'un tableau stocké dans un document, sans détruire le
// reste du tableau.
//
// Le piège, et il est silencieux : `document.update({ "system.butin.entries.0.pct": 50 })`
// ne modifie pas la case 0 du tableau — il le REMPLACE par un objet.
// Foundry développe le chemin pointé en `{system:{butin:{entries:{"0":{pct:50}}}}}`
// (des clés "0", "1"… jamais un vrai tableau), puis fusionne. Or la fusion ne
// descend récursivement que si la cible ET la source sont des objets simples :
// un tableau côté cible n'est pas un objet simple, donc il est écrasé tel quel.
// Le document se retrouve avec `entries = {"0": {pct: 50}}` — un objet, portant
// uniquement le champ qui vient d'être édité. Tout le reste (l'uuid de l'objet,
// les autres lignes) a disparu, et tout code qui teste `Array.isArray()` avant
// de lire voit désormais une liste vide.
//
// C'est exactement ce qui a été rapporté sur le butin d'un monstre : changer le
// « % de chance » d'une ligne vidait toute la table, et le bouton ✕ de
// suppression cessait de répondre (il appelle `.splice()`, qui n'existe pas sur
// un objet — l'exception partait dans le vide, le gestionnaire étant async).
//
// Deux besoins, donc, et ce module couvre les deux :
//   - ÉCRIRE sans casser        → listSafeUpdate()
//   - LIRE une donnée déjà cassée → asList(), pour que les mondes existants
//     retrouvent leur butin au lieu de le voir disparaître.

/**
 * Est-ce la forme « tableau aplati en objet » décrite ci-dessus ?
 * Uniquement des clés d'entiers consécutifs à partir de 0 : un dictionnaire
 * légitimement indexé par des nombres (les paliers de niveau de `system.gen.bands`,
 * par exemple, qui commencent à 1 et sautent des valeurs) n'en fait pas partie.
 */
export function isIndexedObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = Object.keys(raw);
  if (!keys.length) return false;
  return keys.every((k, i) => k === String(i));
}

/**
 * Une liste, quelle que soit la forme sous laquelle elle a été stockée.
 * À utiliser partout où l'on LIT une liste d'un document, en remplacement du
 * `Array.isArray(x) ? x : []` habituel — celui-ci rend une liste vide sur une
 * donnée aplatie, ce qui fait passer une corruption pour une absence.
 */
export function asList(raw) {
  if (Array.isArray(raw)) return raw;
  if (isIndexedObject(raw)) {
    return Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => raw[k]);
  }
  return [];
}

/**
 * Charge utile d'`update()` pour un champ désigné par son chemin pointé,
 * en réécrivant le TABLEAU ENTIER dès que le chemin traverse un index.
 *
 * @param {Document} doc   - le document visé (lu, jamais modifié)
 * @param {string} path    - chemin pointé du champ, tel que porté par le
 *                           `name` de l'input (« system.butin.entries.0.pct »)
 * @param {*} value        - la nouvelle valeur du champ
 * @param {string[]} [knownLists] - chemins dont on SAIT qu'ils portent une
 *                           liste, même si la donnée en place a été aplatie en
 *                           objet par le bug ci-dessus. Sans cette liste on ne
 *                           peut que constater un vrai tableau ; avec elle, la
 *                           donnée cassée se répare d'elle-même à la première
 *                           modification. On ne devine JAMAIS : un objet dont
 *                           les clés sont des nombres reste un objet tant qu'il
 *                           n'est pas déclaré ici.
 * @returns {object} l'objet à passer tel quel à `document.update()`
 */
export function listSafeUpdate(doc, path, value, knownLists = []) {
  const parts = String(path ?? "").split(".");

  for (let i = 1; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) continue;

    const listPath = parts.slice(0, i).join(".");
    const current = foundry.utils.getProperty(doc, listPath);
    const declared = knownLists.includes(listPath);
    if (!Array.isArray(current) && !(declared && isIndexedObject(current))) continue;

    const list = foundry.utils.deepClone(asList(current));
    const idx = Number(parts[i]);
    const rest = parts.slice(i + 1).join(".");

    // Une case manquante ne doit pas faire échouer l'écriture : on comble,
    // plutôt que d'écrire à un index qui laisserait des trous (`undefined`)
    // dans le tableau enregistré.
    while (list.length <= idx) list.push({});

    if (rest) {
      if (list[idx] === null || typeof list[idx] !== "object") list[idx] = {};
      foundry.utils.setProperty(list[idx], rest, value);
    } else {
      list[idx] = value;
    }

    return { [listPath]: list };
  }

  return { [path]: value };
}
