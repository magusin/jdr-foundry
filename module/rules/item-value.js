// module/rules/item-value.js
//
// Pesée d'un objet — outil de théoriecraft RÉSERVÉ AU MJ.
//
// Donne une valeur chiffrée à une arme / armure / relique pour répondre à une
// seule question : « celui que je viens d'écrire est-il abusé ? ». Rien de
// tout ça n'entre dans les règles : aucune valeur calculée ici n'est stockée,
// lue par un jet, ni montrée à un joueur. C'est une loupe, pas une mécanique.
//
// ── Pourquoi des poids, et pas une simple somme ──────────────────────────
//
// Additionner les bonus d'un objet ne dit rien, parce que les champs n'ont
// pas du tout la même courbe derrière eux :
//
//   - `scoreArmure` passe par S/(S+160) : sa 50ᵉ unité vaut le quart de la
//     première. On peut en distribuer beaucoup sans rien casser.
//   - `armureFixe` est soustrait AVANT le pourcentage, à chaque coup reçu.
//     Sur des dégâts de l'ordre de 6, +1 retire ~16 % de tout ce qu'on
//     encaisse — soit, en réduction équivalente, environ 36 points de score
//     d'armure. C'est le rapport que ce module rend visible.
//   - `toucherPhysique` déplace le TN, borné [6,16], sur une bande utile de
//     10 valeurs seulement : chaque point vaut 5 points de % de touche fermes.
//
// Les poids ci-dessous sont donc des estimations de l'IMPACT RÉEL d'une unité,
// calibrées sur un personnage de référence de début de partie (30 PV, 3 m de
// vitesse, 10 de fatigue, ~50 % de chance de toucher, coups reçus d'environ 6).
// Ils ne prétendent pas à l'exactitude : ils prétendent à la bonne échelle,
// ce qui suffit pour repérer une ligne qui pèse dix fois ses voisines.
//
// STAT_WEIGHTS est exporté et destiné à être RÉGLÉ. Si l'échelle du jeu bouge
// (PV qui montent enfin avec le niveau, constantes de TN revues…), les poids
// doivent suivre — ils décrivent un équilibre, pas une vérité. Le plus
// discutable est `vitesse` : sa valeur tactique est réelle mais ne se convertit
// pas en dégâts ni en survie, donc son poids relève d'un choix de table.
//
// Un total NÉGATIF n'est pas une anomalie : il signifie que les malus de
// l'objet pèsent plus que ses bonus. Une armure lourde à -1 vitesse a besoin
// de beaucoup de score d'armure pour repasser au-dessus de zéro, et c'est
// précisément le genre d'arbitrage que cet outil doit rendre visible.
//
// ── Le cumul sur 9 emplacements est le vrai piège ────────────────────────
//
// Un joueur porte jusqu'à 9 objets et `sumBonuses` en fait une somme plate.
// Une valeur anodine sur une pièce devient neuf fois elle-même sur un set
// complet, et les champs LINÉAIRES (armure fixe, vitesse, fatigue, toucher,
// résistances élémentaires) n'ont aucun frein mathématique pour l'absorber.
// D'où la projection « ×9 » renvoyée à côté du total : elle répond à
// « et si tout son équipement portait ça ? », qui est la seule question qui
// compte pour ces champs-là.

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * Poids d'une unité de chaque champ, en « points de puissance ».
 *
 * Repère : `armureFixe: 10`. Tout se lit par rapport à cette ligne — un champ
 * à 1 vaut le dixième d'un point d'armure fixe, un champ à 0,3 en vaut le
 * trentième.
 */
export const STAT_WEIGHTS = {
  // ── Réduction plate : linéaire, s'applique à CHAQUE coup, et le plancher
  // de dégâts à 1 la rend écrasante contre les adversaires qui frappent
  // souvent pour peu. Le champ le plus cher du jeu à l'échelle actuelle.
  armureFixe: 10,
  resistanceFixe: 7,       // idem, mais les dégâts magiques sont plus rares

  // ── Chance de toucher : la bande utile du d20 ne fait que 10 valeurs
  // (1-5 échec auto, 16+ succès auto), donc +1 = +5 points de % fermes,
  // soit ~10 % de dégâts infligés en plus.
  toucherPhysique: 10,
  toucherMagique: 8,

  // ── Mobilité : sur une base de 3 m, +1 m est un tiers de déplacement en
  // plus. Décide qui engage, qui décroche, qui atteint le mage.
  vitesse: 12,

  // ── Ressources : linéaires mais sans effet de seuil.
  pvMax: 2,
  manaMax: 1,
  fatigueMax: 3,           // sur une base de 10 : +1 = +10 % d'actions

  // ── Principales : deux rôles chacune (dégâts/pods, TN/initiative,
  // défenses/PV), mais des barèmes à pas large — leur valeur unitaire est
  // faible tôt et grandit avec la campagne.
  force: 3, intelligence: 3, dexterite: 3, acuite: 3, endurance: 3,

  // ── Scores de défense : S/(S+160). Mesuré autour d'un score de 20
  // (milieu de campagne), +1 rend environ un demi-point de pourcentage.
  scoreArmure: 0.3,
  scoreResistance: 0.3,

  // ── Régénération, en % des max, par tour.
  regenPvPct: 1.5,
  regenManaPct: 0.8
};

/** Résistances élémentaires : par point de %. */
export const RESIST_WEIGHTS = {
  // physique/magique couvrent la quasi-totalité des dégâts reçus…
  physique: 1, magique: 0.9,
  // …un élément n'en couvre qu'une fraction.
  feu: 0.4, eau: 0.4, eclair: 0.4, glace: 0.4,
  air: 0.4, terre: 0.4, lumiere: 0.4, obscurite: 0.4
};

/** Résistances aux ÉTATS (system.resistances[]). */
const STATE_RESIST_WEIGHTS = { immune: 8, durationReduction: 1, dotReductionPct: 0.3 };

/** Un point de dégât moyen, sur une attaque type d'environ 7. */
const DAMAGE_POINT = 8;

/** Stat de référence pour évaluer un scaling d'arme hors de tout porteur. */
const SCALING_REF_STAT = 4;

/** Paliers, par catégorie. Une arme part de plus haut : ses dés comptent. */
const TIERS = {
  gear: [
    { max: 5,   key: "village",    label: "Village" },
    { max: 15,  key: "commun",     label: "Commun" },
    { max: 30,  key: "rare",       label: "Rare" },
    { max: 55,  key: "epique",     label: "Épique" },
    { max: Infinity, key: "legendaire", label: "Légendaire" }
  ],
  weapon: [
    { max: 35,  key: "village",    label: "Village" },
    { max: 60,  key: "commun",     label: "Commun" },
    { max: 95,  key: "rare",       label: "Rare" },
    { max: 140, key: "epique",     label: "Épique" },
    { max: Infinity, key: "legendaire", label: "Légendaire" }
  ]
};

/**
 * Champs sans frein mathématique : leur 9ᵉ exemplaire vaut autant que le
 * premier. Ce sont ceux dont la projection ×9 mérite d'être lue, et les
 * seuls pour lesquels une valeur « raisonnable » par pièce peut produire un
 * total déraisonnable sans que rien ne le signale.
 */
const LINEAR_FIELDS = new Set([
  "armureFixe", "resistanceFixe", "toucherPhysique", "toucherMagique",
  "vitesse", "fatigueMax", "regenPvPct", "regenManaPct"
]);

/** Plafond conseillé pour le CUMUL des 9 emplacements. Au-delà : alerte. */
const STACK_CAPS = {
  armureFixe: 8, resistanceFixe: 8,
  toucherPhysique: 2, toucherMagique: 2,
  vitesse: 2, fatigueMax: 3,
  regenPvPct: 30, regenManaPct: 30
};

const LABELS = {
  armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
  toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique",
  vitesse: "Vitesse", pvMax: "PV max", manaMax: "Mana max",
  fatigueMax: "Fatigue max", force: "Force", intelligence: "Intelligence",
  dexterite: "Dextérité", acuite: "Acuité", endurance: "Endurance",
  scoreArmure: "Score Armure", scoreResistance: "Score Résistance",
  regenPvPct: "Régén PV %", regenManaPct: "Régén Mana %"
};

/**
 * Moyenne d'une formule de dés simple (« 2d6+3 », « 1d8 », « 4 »).
 * Volontairement naïve : les formules d'arme de ce système sont de cette
 * forme. Une expression non reconnue rend 0 plutôt que d'inventer un chiffre.
 */
export function diceAverage(formula) {
  const s = String(formula ?? "").replace(/\s+/g, "").toLowerCase();
  if (!s) return 0;
  let total = 0;
  const re = /([+-]?)(\d*)d(\d+)|([+-]?\d+)(?![d\d])/g;
  let m, matched = false;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    if (m[3]) {
      const sign = m[1] === "-" ? -1 : 1;
      const count = m[2] === "" ? 1 : Number(m[2]);
      const faces = Number(m[3]);
      total += sign * count * (faces + 1) / 2;
    } else if (m[4]) {
      total += Number(m[4]);
    }
  }
  return matched ? Math.round(total * 100) / 100 : 0;
}

const round1 = (v) => Math.round(v * 10) / 10;

function pushRow(rows, label, value, points, opts = {}) {
  if (!points && !value) return;
  rows.push({
    label,
    value: opts.text ?? (value > 0 ? `+${round1(value)}` : String(round1(value))),
    points: round1(points),
    key: opts.key ?? null,
    warn: !!opts.warn
  });
}

/**
 * Pèse un objet. Ne lit que des données d'objet : aucun porteur n'est requis,
 * et le résultat est donc stable, comparable d'une fiche à l'autre.
 *
 * @param {Item|object} item  Item document ou données brutes.
 * @returns {{total:number, rows:Array, tier:object, warnings:Array, category:string}}
 */
export function computeItemValue(item) {
  const type = String(item?.type ?? "");
  const sys = item?.system ?? {};
  const rows = [];
  const warnings = [];
  let total = 0;

  const add = (label, value, weight, opts = {}) => {
    const pts = value * weight;
    total += pts;
    pushRow(rows, label, value, pts, opts);
  };

  // ── Bonus de stats ────────────────────────────────────────────────────
  const bonus = sys.bonus ?? {};
  for (const [key, weight] of Object.entries(STAT_WEIGHTS)) {
    const v = n(bonus[key], 0);
    if (!v) continue;

    // Projection ×9 : ce que donnerait un équipement complet portant cette
    // même valeur. Seuls les champs linéaires en ont besoin — pour les
    // autres, la courbe absorbe le cumul d'elle-même.
    let warn = false;
    if (LINEAR_FIELDS.has(key)) {
      const cap = STACK_CAPS[key];
      const stacked = v * 9;
      if (cap !== undefined && stacked > cap) {
        warn = true;
        warnings.push(
          `${LABELS[key] ?? key} : ${round1(v)} par pièce → ${round1(stacked)} sur 9 emplacements, ` +
          `au-dessus du cumul conseillé de ${cap}.`
        );
      }
    }
    add(LABELS[key] ?? key, v, weight, { key, warn });
  }

  // ── Résistances élémentaires ──────────────────────────────────────────
  const re = sys.resistancesElem ?? {};
  for (const [key, weight] of Object.entries(RESIST_WEIGHTS)) {
    const v = n(re[key], 0);
    if (!v) continue;
    const stacked = v * 9;
    // 100 = immunité : neuf pièces à 12 % suffisent à rendre un type inoffensif.
    const warn = Math.abs(stacked) >= 100;
    if (warn) {
      warnings.push(
        `Résistance ${key} : ${round1(v)} % par pièce → ${round1(stacked)} % sur 9 emplacements, ` +
        `soit ${stacked >= 100 ? "l'immunité totale" : "la vulnérabilité maximale"}.`
      );
    }
    add(`Résist. ${key}`, v, weight, { text: `${v > 0 ? "+" : ""}${round1(v)} %`, warn });
  }

  // ── Résistances aux états ─────────────────────────────────────────────
  for (const r of (Array.isArray(sys.resistances) ? sys.resistances : [])) {
    const tag = r?.tag || r?.effectKey || "état";
    if (r?.immune) add(`Immunité ${tag}`, 1, STATE_RESIST_WEIGHTS.immune, { text: "immunisé" });
    const dur = n(r?.durationReduction, 0);
    if (dur) add(`Durée ${tag}`, dur, STATE_RESIST_WEIGHTS.durationReduction, { text: `-${round1(dur)} tour(s)` });
    const dot = n(r?.dotReductionPct, 0);
    if (dot) add(`DOT ${tag}`, dot, STATE_RESIST_WEIGHTS.dotReductionPct, { text: `-${round1(dot)} %` });
  }

  // ── Spécifique aux armes ──────────────────────────────────────────────
  const isWeapon = type === "weapon";
  if (isWeapon) {
    const dmg = sys.damage ?? {};
    const avg = diceAverage(dmg.dice) + n(dmg.flat, 0);
    if (avg) add("Dégâts (moyenne)", avg, DAMAGE_POINT, { text: `${round1(avg)}` });

    // Scaling : évalué sur une caractéristique de référence, faute de porteur.
    const sc = dmg.scaling ?? {};
    const per = Math.max(1, n(sc.per, 10));
    const perStep = n(sc.perStep, 0);
    const scaled = Math.floor(SCALING_REF_STAT / per) * perStep;
    if (scaled) add(`Scaling (${sc.stat ?? "?"} réf. ${SCALING_REF_STAT})`, scaled, DAMAGE_POINT, { text: `+${round1(scaled)}` });

    // Critique : ne se déclenche que sur un 20 naturel, soit 5 % des jets.
    const critAvg = diceAverage(sys.crit?.damage?.dice) + n(sys.crit?.damage?.flat, 0);
    if (critAvg) add("Critique (5 % des jets)", critAvg, DAMAGE_POINT * 0.05, { text: `${round1(critAvg)}` });

    // Allonge au-delà du corps à corps standard : décide qui peut frapper
    // sans être à portée de riposte.
    const allonge = n(sys.allonge, 1);
    if (allonge > 1) add("Allonge", allonge - 1, 6, { text: `${round1(allonge)} m` });

    // Portée de jet/tir : au-delà de l'allonge, chaque mètre vaut moins,
    // mais frapper de loin reste frapper sans être frappé.
    const portee = Math.max(0, n(sys.range?.max, 0) - allonge);
    if (portee > 0) add("Portée", portee, 0.5, { text: `${round1(n(sys.range?.max, 0))} m` });

    // Coût en fatigue au-dessus de la norme : un vrai malus, et il double
    // quand l'arme est maniée avec une seconde (les deux coûts s'additionnent).
    const fc = n(sys.fatigueCost, 1);
    if (fc !== 1) add("Coût fatigue", -(fc - 1), 4, { text: `${round1(fc)}` });

    if (sys.twoHands) {
      warnings.push(
        "Arme à deux mains : elle occupe deux emplacements pour un seul jeu de bonus. " +
        "À comparer au total de DEUX armes à une main, pas d'une seule."
      );
    }
  }

  total = round1(total);
  const table = TIERS[isWeapon ? "weapon" : "gear"];
  const tier = table.find(t => total <= t.max) ?? table[table.length - 1];

  rows.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return { total, rows, tier, warnings, category: isWeapon ? "weapon" : "gear" };
}

/** Types d'objets que la pesée sait traiter. */
export function isWeighable(type) {
  return ["weapon", "armor", "relic"].includes(String(type ?? ""));
}
