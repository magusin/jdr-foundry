// module/rules/effect-library.js
//
// Catalogue des noms d'effets connus du système — UNIQUEMENT des noms et
// des types. Le MJ renseigne lui-même durée, dégâts, bonus/malus, aura
// etc. au moment d'appliquer l'effet. Aucune valeur n'est pré-configurée.

// `neutre` a remplacé `magique` : les effets qu'il regroupe (Dissipation,
// Silence, Renforcement, Drain) ne sont pas d'un élément, ils sont SANS
// élément — et « Magique » prêtait à confusion avec la livraison magique
// d'une attaque, qui est une tout autre notion. Voir normalizeEffectTag()
// pour la compatibilité des données déjà saisies.
export const EFFECT_TAGS = {
  neutre:  "⚪ Neutre",
  physique:"⚔️ Physique",
  feu:     "🔥 Feu",
  air:     "🌬️ Air",
  eau:     "💧 Eau",
  glace:   "❄️ Glace",
  eclair:  "⚡ Éclair",
  terre:   "🌿 Terre",
  lumiere: "✨ Lumière",
  obscurite:"🌑 Obscurité"
};

/**
 * Tag d'effet normalisé, pour lire une donnée saisie avant le renommage.
 *
 * Un objet ou un état enregistré du temps où le tag s'appelait « magique »
 * porte encore cette valeur ; sans normalisation, sa résistance cesserait
 * simplement de correspondre — silencieusement, comme toujours avec une
 * comparaison de chaînes. À passer des DEUX côtés de toute comparaison.
 */
export function normalizeEffectTag(tag) {
  const t = String(tag ?? "").trim();
  return t === "magique" ? "neutre" : t;
}

export const EFFECT_LIBRARY = {
  // ── FEU ──────────────────────────────────────────────────────────────
  ardeur:         { key: "ardeur",         label: "Ardeur",          tag: "feu"     },
  combustion:     { key: "combustion",     label: "Combustion",      tag: "feu"     },
  brulure:        { key: "brulure",        label: "Brûlure",         tag: "feu"     },
  surchauffe:     { key: "surchauffe",     label: "Surchauffe",      tag: "feu"     },
  braises:        { key: "braises",        label: "Braises",         tag: "feu"     }, // DOT faible, longue durée
  fournaise:      { key: "fournaise",      label: "Fournaise",       tag: "feu"     }, // aura de chaleur autour du porteur
  cendres:        { key: "cendres",        label: "Cendres",         tag: "feu"     }, // malus d'acuité / de toucher
  incandescence:  { key: "incandescence",  label: "Incandescence",   tag: "feu"     }, // bonus de dégâts de feu

  // ── AIR ──────────────────────────────────────────────────────────────
  asphyxie:       { key: "asphyxie",       label: "Asphyxie",        tag: "air"     },
  levitation:     { key: "levitation",     label: "Lévitation",      tag: "air"     },
  acceleration:   { key: "acceleration",   label: "Accélération",    tag: "air"     },
  legerete:       { key: "legerete",       label: "Légèreté",        tag: "air"     },
  bourrasque:     { key: "bourrasque",     label: "Bourrasque",      tag: "air"     }, // déséquilibre, pousse
  vent_contraire: { key: "vent_contraire", label: "Vent contraire",  tag: "air"     }, // malus au toucher à distance
  second_souffle: { key: "second_souffle", label: "Second Souffle",  tag: "air"     }, // récupère de la fatigue par tour
  insaisissable:  { key: "insaisissable",  label: "Insaisissable",   tag: "air"     }, // bonus de défense / d'esquive

  // ── EAU ──────────────────────────────────────────────────────────────
  purification:   { key: "purification",   label: "Purification",    tag: "eau"     },
  dissolution:    { key: "dissolution",    label: "Dissolution",     tag: "eau"     },
  regeneration:   { key: "regeneration",   label: "Régénération",    tag: "eau"     },
  benediction_eau:{ key: "benediction_eau",label: "Bénédiction",     tag: "eau"     },
  noyade:         { key: "noyade",         label: "Noyade",          tag: "eau"     }, // DOT + fatigue
  fluidite:       { key: "fluidite",       label: "Fluidité",        tag: "eau"     }, // bonus de dextérité / vitesse
  flux_mystique:  { key: "flux_mystique",  label: "Flux Mystique",   tag: "eau"     }, // régénération de mana
  courant:        { key: "courant",        label: "Courant",         tag: "eau"     }, // entraîné, déplacé chaque tour

  // ── GLACE ────────────────────────────────────────────────────────────
  engourdissement:{ key: "engourdissement",label: "Engourdissement", tag: "glace"   },
  gel:            { key: "gel",            label: "Gel",             tag: "glace"   },
  engelure:       { key: "engelure",       label: "Engelure",        tag: "glace"   },
  armure_glace:   { key: "armure_glace",   label: "Armure de Glace", tag: "glace"   },
  givre:          { key: "givre",          label: "Givre",           tag: "glace"   }, // malus de vitesse
  frisson:        { key: "frisson",        label: "Frisson",         tag: "glace"   }, // malus de régénération / fatigue
  cristallisation:{ key: "cristallisation",label: "Cristallisation", tag: "glace"   }, // immobilisé, mais protégé
  hypothermie:    { key: "hypothermie",    label: "Hypothermie",     tag: "glace"   }, // DOT qui s'aggrave

  // ── ÉCLAIR ───────────────────────────────────────────────────────────
  conduction:     { key: "conduction",     label: "Conduction",      tag: "eclair"  },
  choc:           { key: "choc",           label: "Choc",            tag: "eclair"  },
  surtension:     { key: "surtension",     label: "Surtension",      tag: "eclair"  },
  paralysie:      { key: "paralysie",      label: "Paralysie",       tag: "eclair"  },
  statique:       { key: "statique",       label: "Statique",        tag: "eclair"  }, // décharge sur qui approche (aura)
  celerite:       { key: "celerite",       label: "Célérité",        tag: "eclair"  }, // bonus d'initiative / de vitesse
  court_circuit:  { key: "court_circuit",  label: "Court-circuit",   tag: "eclair"  }, // malus de mana / de régénération
  arc_electrique: { key: "arc_electrique", label: "Arc Électrique",  tag: "eclair"  }, // dégâts ajoutés aux attaques

  // ── TERRE ────────────────────────────────────────────────────────────
  empoisonnement: { key: "empoisonnement", label: "Empoisonnement",  tag: "terre"   },
  carapace:       { key: "carapace",       label: "Carapace",        tag: "terre"   },
  enlisement:     { key: "enlisement",     label: "Enlisement",      tag: "terre"   },
  endurance_tellurique:{ key: "endurance_tellurique", label: "Endurance Tellurique", tag: "terre" },
  ancrage:        { key: "ancrage",        label: "Ancrage",         tag: "terre"   }, // ne peut être ni poussé ni déplacé de force
  racines:        { key: "racines",        label: "Racines",         tag: "terre"   }, // immobilisé sur place
  petrification:  { key: "petrification",  label: "Pétrification",   tag: "terre"   }, // immobilisé mais très résistant
  poussiere:      { key: "poussiere",      label: "Poussière",       tag: "terre"   }, // malus d'acuité

  // ── NEUTRE (sans élément) ──────────────────────────────────────────────────────────
  dissipation:    { key: "dissipation",    label: "Dissipation",     tag: "neutre"  },
  silence:        { key: "silence",        label: "Silence",         tag: "neutre"  },
  renforcement:   { key: "renforcement",   label: "Renforcement",    tag: "neutre"  },
  drain:          { key: "drain",          label: "Drain",           tag: "neutre"  },
  amelioration:   { key: "amelioration",   label: "Amélioration",    tag: "neutre"  }, // bonus générique, tous usages
  affaiblissement:{ key: "affaiblissement",label: "Affaiblissement", tag: "neutre"  }, // malus générique, tous usages
  malediction:    { key: "malediction",    label: "Malédiction",     tag: "neutre"  }, // malus durable, difficile à retirer
  marque:         { key: "marque",         label: "Marque",          tag: "neutre"  }, // cible désignée : vulnérabilité
  barriere:       { key: "barriere",       label: "Barrière",        tag: "neutre"  }, // absorption / armure fixe

  // ── PHYSIQUE ─────────────────────────────────────────────────────────
  hemorragie:     { key: "hemorragie",     label: "Hémorragie",      tag: "physique"},
  adrenaline:     { key: "adrenaline",     label: "Adrénaline",      tag: "physique"},
  saignement:     { key: "saignement",     label: "Saignement",      tag: "physique"},
  etourdissement: { key: "etourdissement", label: "Étourdissement",  tag: "physique"},
  rage:           { key: "rage",           label: "Rage",            tag: "physique"},
  contusion:      { key: "contusion",      label: "Contusion",       tag: "physique"},
  desarmement:    { key: "desarmement",    label: "Désarmement",     tag: "physique"},
  fracture:       { key: "fracture",       label: "Fracture",        tag: "physique"},
  entrave:        { key: "entrave",        label: "Entrave",         tag: "physique"}, // immobilisé, ne peut plus se déplacer
  renversement:   { key: "renversement",   label: "Renversement",    tag: "physique"}, // à terre : défense et toucher réduits
  garde:          { key: "garde",          label: "Garde",           tag: "physique"}, // bonus de défense, mobilité réduite
  provocation:    { key: "provocation",    label: "Provocation",     tag: "physique"}, // attire les coups

  // ── LUMIÈRE ──────────────────────────────────────────────────────────
  serenite:       { key: "serenite",       label: "Sérénité",        tag: "lumiere" },
  rayonnement:    { key: "rayonnement",    label: "Rayonnement",     tag: "lumiere" },
  eblouissement:  { key: "eblouissement",  label: "Éblouissement",   tag: "lumiere" },
  nyctalope:      { key: "nyctalope",      label: "Nyctalope",       tag: "lumiere" },
  sanctuaire:     { key: "sanctuaire",     label: "Sanctuaire",      tag: "lumiere" }, // aura protectrice
  guerison:       { key: "guerison",       label: "Guérison",        tag: "lumiere" }, // HOT
  jugement:       { key: "jugement",       label: "Jugement",        tag: "lumiere" }, // vulnérabilité imposée
  revelation:     { key: "revelation",     label: "Révélation",      tag: "lumiere" }, // révèle et empêche de se cacher

  // ── OBSCURITÉ ────────────────────────────────────────────────────────
  cecite:         { key: "cecite",         label: "Cécité",          tag: "obscurite" },
  terreur:        { key: "terreur",        label: "Terreur",         tag: "obscurite" },
  corruption:     { key: "corruption",     label: "Corruption",      tag: "obscurite" },
  tenebre:        { key: "tenebre",        label: "Ténèbre",         tag: "obscurite" },
  necrose:        { key: "necrose",        label: "Nécrose",         tag: "obscurite" }, // DOT qui bloque les soins
  ombre:          { key: "ombre",          label: "Ombre",           tag: "obscurite" }, // discrétion, défense
  desespoir:      { key: "desespoir",      label: "Désespoir",       tag: "obscurite" }, // malus de dégâts
  cauchemar:      { key: "cauchemar",      label: "Cauchemar",       tag: "obscurite" }, // DOT + malus de régénération
};

export function getEffectDef(key) {
  return EFFECT_LIBRARY[key] ?? null;
}

export function listEffects() {
  return Object.values(EFFECT_LIBRARY);
}

/**
 * Catalogue groupé par type, prêt pour un `<optgroup>` par famille.
 *
 * Sert à remplacer une saisie libre du nom d'effet par un choix dans la
 * liste réellement définie : un « Brulure » tapé sans accent ne
 * correspondait à rien et échouait en silence, puisque la comparaison est
 * une simple égalité de chaînes.
 *
 * @param {object} [opts]
 * @param {"key"|"label"} [opts.value="key"] Ce que porte l'option.
 *   Les résistances et amplifications stockent un LIBELLÉ dans `effectKey`
 *   (computeResistanceFor le compare au `label` de l'état, en minuscules),
 *   là où la fiche de sort stocke la clé technique. Le même catalogue sert
 *   les deux, il suffit de dire lequel on veut.
 * @returns {Object<string, Array<{value:string, key:string, label:string, tag:string}>>}
 */
export function effectCatalogByTag({ value = "key" } = {}) {
  const out = {};
  for (const def of Object.values(EFFECT_LIBRARY)) {
    const tag = normalizeEffectTag(def.tag);
    const groupLabel = EFFECT_TAGS[tag] ?? tag;
    (out[groupLabel] ??= []).push({
      value: value === "label" ? def.label : def.key,
      key: def.key,
      label: def.label,
      tag
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  return out;
}

/**
 * Construit un état minimal (sans valeurs) depuis un nom du catalogue.
 * Les valeurs réelles (dégâts, mods, durée…) sont injectées après par
 * le MJ via apply-effect.js ou l'éditeur de sort.
 */
export function buildStateFromLibrary(key, { duration = 1, sourceLabel = "", removeDifficulty = null,
  dot = 0, fatiguePerTick = 0, mods = {}, permanent = false, isAura = false, aura = null } = {}) {
  const def = getEffectDef(key);
  if (!def) return null;

  const dur = permanent ? 0 : Math.max(1, Number(duration) || 1);

  const state = {
    id: `lib_${key}_${foundry.utils.randomID(6)}`,
    label: def.label,
    type: "libraryEffect",
    tag: def.tag,
    isAura: !!isAura,
    permanent: !!permanent,
    duration: dur,
    remaining: dur,
    removeDifficulty: removeDifficulty ?? null,
    dot: { flat: Number(dot) || 0, perTick: Number(dot) || 0 },
    mods: foundry.utils.deepClone(mods ?? {}),
    sourceLabel
  };

  if (fatiguePerTick) state.dot.fatiguePerTick = Number(fatiguePerTick) || 0;
  if (isAura && aura) state.aura = aura;

  return state;
}
