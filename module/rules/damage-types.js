// module/rules/damage-types.js
//
// Résistances élémentaires — la SEULE définition de « de quel type sont ces
// dégâts » et « combien la cible en encaisse en moins ».
//
// À ne pas confondre avec resistances.js, qui traite les résistances aux
// ÉTATS (durée d'une brûlure, dégâts par tour d'un poison…). Ici il s'agit
// des dégâts directs : un coup d'épée, une boule de feu, un piège.
//
// Les deux partagent volontairement le même espace de clés (feu, eau,
// eclair… — cf. EFFECT_TAGS dans effect-library.js) pour qu'un même mot
// veuille dire la même chose partout : le MJ qui tague un sort « feu »
// n'a pas à savoir lequel des deux systèmes lira l'étiquette.
//
// `physique` et `magique` en font partie à part entière : ce sont les deux
// types d'une arme ou d'un sort sans élément particulier, et une créature
// peut parfaitement être « résistante au physique » sans l'être au feu. Ils
// s'ajoutent à l'armure/résistance classique (defenses.*), qui reste le
// premier étage de mitigation — voir computeFinalDamage() dans combat.js.

/** Libellés des types de dégâts, dans l'ordre d'affichage des grilles. */
export const DAMAGE_TYPES = {
  physique:  "⚔️ Physique",
  magique:   "✨ Magique",
  feu:       "🔥 Feu",
  eau:       "💧 Eau",
  eclair:    "⚡ Éclair",
  glace:     "❄️ Glace",
  air:       "🌬️ Air",
  terre:     "🌿 Terre",
  lumiere:   "🌟 Lumière",
  obscurite: "🌑 Obscurité"
};

/** Clés des types de dégâts, dans l'ordre d'affichage. */
export const DAMAGE_TYPE_KEYS = Object.keys(DAMAGE_TYPES);

/**
 * Bornes d'une résistance, en %.
 * 100 = immunité totale (le MJ peut le vouloir : un élémentaire de feu),
 * −100 = vulnérabilité maximale (dégâts doublés).
 */
export const RESIST_MIN = -100;
export const RESIST_MAX = 100;

const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const clampPct = (v) => Math.max(RESIST_MIN, Math.min(RESIST_MAX, Math.round(num(v, 0))));

/** Libellé lisible d'un type ; renvoie la clé telle quelle si inconnue. */
export function damageTypeLabel(key) {
  const k = String(key ?? "").trim().toLowerCase();
  return DAMAGE_TYPES[k] ?? key ?? "";
}

/** Une clé est-elle un type de dégâts connu ? */
export function isDamageType(key) {
  return Object.hasOwn(DAMAGE_TYPES, String(key ?? "").trim().toLowerCase());
}

/** Carte de résistances vide (toutes les clés à 0). */
export function emptyResistMap() {
  const out = {};
  for (const k of DAMAGE_TYPE_KEYS) out[k] = 0;
  return out;
}

/**
 * Normalise une carte de résistances lue depuis un document : garde
 * uniquement les clés connues, force des nombres, borne les valeurs.
 */
export function normalizeResistMap(raw) {
  const out = emptyResistMap();
  if (!raw || typeof raw !== "object") return out;
  for (const k of DAMAGE_TYPE_KEYS) out[k] = clampPct(raw[k]);
  return out;
}

/** Somme de plusieurs cartes (bornée une seule fois, à la fin). */
export function sumResistMaps(...maps) {
  const out = emptyResistMap();
  for (const m of maps) {
    if (!m || typeof m !== "object") continue;
    for (const k of DAMAGE_TYPE_KEYS) out[k] += num(m[k], 0);
  }
  for (const k of DAMAGE_TYPE_KEYS) out[k] = clampPct(out[k]);
  return out;
}

/**
 * Lignes {key, label, value, isWeak, text} — format attendu par les grilles
 * des fiches. `text` est prêt à afficher : une valeur NÉGATIVE est une
 * vulnérabilité, elle se lit « Feu +25% » (dégâts augmentés) et non
 * « Feu −(−25)% ». Le calcul est fait ici, et pas dans les templates, faute
 * de helper Handlebars `abs` côté Foundry.
 */
export function resistRows(map) {
  const m = normalizeResistMap(map);
  return DAMAGE_TYPE_KEYS.map(key => {
    const value = m[key];
    return {
      key,
      label: DAMAGE_TYPES[key],
      value,
      isWeak: value < 0,
      text: `${DAMAGE_TYPES[key]} ${value > 0 ? "−" : "+"}${Math.abs(value)}%`
    };
  });
}

/** Idem, mais seulement les valeurs non nulles (résumé joueur). */
export function nonZeroResistRows(map) {
  return resistRows(map).filter(r => r.value !== 0);
}

/**
 * De quel TYPE sont ces dégâts ?
 *
 * L'élément explicite (`tag` d'un sort, d'une zone…) gagne quand il en est
 * un ; sinon on retombe sur la livraison — c'est ce qui donne tout son sens
 * à « physique » dans la liste : une arme ne porte pas d'élément, elle est
 * physique, et une créature résistante au physique doit l'encaisser moins.
 * `neutre` (ou vide) n'est PAS un type : c'est l'absence d'élément, elle
 * laisse donc la livraison décider.
 *
 * @returns {string|null} clé de DAMAGE_TYPES, ou null si rien d'exploitable
 */
export function resolveDamageType({ tag = null, livraison = null } = {}) {
  const t = String(tag ?? "").trim().toLowerCase();
  if (t && t !== "neutre" && isDamageType(t)) return t;
  const l = String(livraison ?? "").trim().toLowerCase();
  if (isDamageType(l)) return l;
  return null;
}

/**
 * Résistance (en %) d'un acteur à un type de dégâts donné.
 * Lit les données dérivées (base + équipement + états actifs, calculées dans
 * actor.js) et retombe sur la valeur de base si elles manquent — un acteur
 * dont prepareDerivedData n'a pas encore tourné ne doit pas faire crasher un
 * calcul de dégâts.
 */
export function getResistPct(actor, type) {
  const key = String(type ?? "").trim().toLowerCase();
  if (!key || !isDamageType(key)) return 0;
  const sys = actor?.system ?? {};
  const map = sys.derived?.resistancesElem ?? sys.resistancesElem ?? null;
  return clampPct(map?.[key]);
}

/**
 * Applique une résistance à un montant de dégâts déjà mitigé par l'armure.
 * Arrondi au supérieur (comme le reste du système), jamais négatif — une
 * vulnérabilité augmente les dégâts, elle ne les inverse pas.
 */
export function applyResistPct(amount, pct) {
  const a = num(amount, 0);
  const p = clampPct(pct);
  if (!p) return Math.max(0, Math.ceil(a));
  return Math.max(0, Math.ceil(a * (1 - p / 100)));
}

/**
 * Résistance d'un acteur aux dégâts décrits par {tag, livraison}, prête à
 * afficher : {type, label, pct}. `type` vaut null si les dégâts n'ont aucun
 * type exploitable (aucune résistance ne s'applique alors).
 */
export function resistanceFor(actor, { tag = null, livraison = null } = {}) {
  const type = resolveDamageType({ tag, livraison });
  if (!type) return { type: null, label: "", pct: 0 };
  return { type, label: DAMAGE_TYPES[type], pct: getResistPct(actor, type) };
}
