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
  // ── PHYSIQUE ET MAGIQUE PÈSENT PAREIL, PARTOUT ────────────────────────
  //
  // Une version antérieure dévaluait le versant magique (résistance fixe,
  // toucher magique, résistance élémentaire magique) au motif que « la
  // quasi-totalité des monstres frappe au physique ». C'est faux dans ce
  // système, et les données le disent : les attaques d'un monstre SONT ses
  // items `spell`, dont le champ `livraison` vaut « magique » PAR DÉFAUT
  // (template.json). Un bestiaire mêle donc les deux, quand il ne penche pas
  // franchement du côté magique.
  //
  // Toute asymétrie physique/magique de cette table a été retirée. S'il faut
  // un jour en réintroduire une, elle devra s'appuyer sur le bestiaire réel
  // de la table, pas sur une intuition de genre.

  // Réduction plate : linéaire, s'applique à CHAQUE coup, et le plancher de
  // dégâts à 1 la rend écrasante contre les adversaires qui frappent souvent
  // pour peu. Le champ le plus cher du jeu à l'échelle actuelle.
  armureFixe: 10,
  resistanceFixe: 10,

  // Chance de toucher : la bande utile du d20 ne fait que 10 valeurs
  // (1-5 échec auto, 16+ succès auto), donc +1 = +5 points de % fermes,
  // soit ~10 % de dégâts infligés en plus.
  toucherPhysique: 10,
  toucherMagique: 10,

  // ── Mobilité : sur une base de 3 m, +1 m est un tiers de déplacement en
  // plus. Décide qui engage, qui décroche, qui atteint le mage.
  vitesse: 12,

  // ── Ressources : linéaires mais sans effet de seuil.
  pvMax: 2,
  manaMax: 1.5,            // base 5 : +1 pèse lourd tôt, beaucoup moins tard
  fatigueMax: 3,           // sur une base de 10 : +1 = +10 % d'actions
  podsMax: 0.15,           // sur une base de 50 : du confort, pas de la puissance

  // Modificateur au seuil de retrait d'un état : NÉGATIF = plus facile à se
  // débarrasser d'un état, donc bénéfique. Le poids est négatif pour que le
  // total monte quand la valeur descend. Vaut moins qu'un point de toucher :
  // on tente un retrait de temps en temps, on attaque à chaque tour.
  retraitMod: -3,

  // ── Principales : PAS de valeur commune, parce qu'elles n'ont ni le même
  // nombre de rôles ni les mêmes barèmes.
  //
  //   force        dégâts physiques (/10) + pods max (/3)
  //   intelligence dégâts magiques  (/10) + mana max (/20)
  //   dexterite    TN physique + initiative — floor((dex+acu)/2)
  //   acuite       TN magique  + initiative — floor((dex+acu)/2)
  //   endurance    score armure (/3) + score résistance (/3) + PV (/5)
  //
  // Deux PAIRES parfaitement symétriques, vérifiées dans actor.js :
  //
  //   - force / intelligence : même moitié « dégâts » au même diviseur (/10).
  //     Leur seconde moitié diffère de nom mais pas de valeur — la Force rend
  //     un pod tous les 3 points, l'Intelligence un mana tous les 20, et comme
  //     un mana vaut bien plus qu'un pod, les deux se rejoignent à la virgule
  //     près. Les séparer serait du bruit.
  //   - dexterite / acuite : même contribution à l'initiative (elles y entrent
  //     à égalité, floor((dex+acu)/2)), et un TN chacune. Le TN physique n'est
  //     pas plus fréquent que le magique — les attaques d'un monstre sont des
  //     `spell`, dont la livraison est « magique » par défaut.
  //
  // Restent les DIVISEURS pour départager, et leur verdict inverse
  // l'intuition : l'Endurance a TROIS rôles et le poids le plus faible, parce
  // que ses trois barèmes (/3, /3, /5) sont les plus grossiers, tandis que
  // Dextérité et Acuité touchent leur demi-point d'initiative immédiatement.
  //
  // ⚠️ Ces valeurs sont des MOYENNES d'un gain en escalier : la Force ne rend
  // rien neuf fois, puis un point de dégât entier au passage de la dizaine.
  // Un +2 de Force ne fait donc littéralement rien tant qu'il ne fait pas
  // franchir un seuil — la pesée le lisse, la table le subit en une fois.
  force: 0.85,
  intelligence: 0.85,
  dexterite: 1.4,
  acuite: 1.4,
  endurance: 0.6,

  // ── Scores de défense : S/(S+160). Mesuré autour d'un score de 20
  // (milieu de campagne), +1 rend environ un demi-point de pourcentage.
  scoreArmure: 0.3,
  scoreResistance: 0.3,

  // ── Régénération : un POURCENTAGE DE LA RÉGÉN DE BASE, pas des PV max.
  // La régén de base vaut 1 PV/tour et le calcul est
  // `floor(base × (1 + pct/100))` — il faut donc +100 % pour gagner un seul
  // PV par tour, et tout ce qui est en dessous est mangé par l'arrondi.
  // D'où un poids minuscule, et l'alerte levée plus bas pour un bonus qui
  // n'atteint pas le seuil : il coûte une ligne sur la fiche et ne fait rien.
  regenPvPct: 0.1,
  regenManaPct: 0.05
};

/**
 * Résistances élémentaires : par point de %.
 *
 * `physique` et `magique` valent PAREIL : ce sont les deux livraisons, et un
 * bestiaire les mêle (cf. la note sur la symétrie dans STAT_WEIGHTS). Chacune
 * couvre à peu près la moitié des dégâts reçus, un élément nommé beaucoup
 * moins — d'où l'écart, qui lui est bien réel.
 */
export const RESIST_WEIGHTS = {
  physique: 1, magique: 1,
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
  fatigueMax: "Fatigue max", podsMax: "Pods max", retraitMod: "Mod. retrait d'état",
  force: "Force", intelligence: "Intelligence",
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
    // Régén : le calcul est `floor(base × (1 + pct/100))` sur une base de 1
    // PV/tour. En dessous de +100 %, l'arrondi avale tout le bonus — la ligne
    // s'affiche sur la fiche de l'objet et ne produit rien du tout.
    if ((key === "regenPvPct" || key === "regenManaPct") && v > 0 && v < 100) {
      warn = true;
      warnings.push(
        `${LABELS[key] ?? key} : +${round1(v)} % est absorbé par l'arrondi. ` +
        `La régén de base vaut 1/tour et le calcul l'arrondit à l'entier inférieur : ` +
        `il faut +100 % pour gagner le premier point.`
      );
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

// ─────────────────────────────────────────────────────────────────────────
// PESÉE D'UN MONSTRE
// ─────────────────────────────────────────────────────────────────────────
//
// Même intention que pour un objet, mais la question change : « combien de
// tours ce monstre va-t-il tenir, et combien va-t-il faire mal pendant ce
// temps ? ». Un monstre ne se compare pas à un plafond de bonus, il se
// compare à un GROUPE. On l'exprime donc en deux quantités concrètes, puis
// on les croise :
//
//   MENACE     = dégâts moyens par tour qu'il inflige réellement
//   RÉSISTANCE = tours qu'il met à tomber sous le feu d'un groupe type
//
// Le produit des deux est le « poids de rencontre » : c'est lui qui dit si
// deux de ces bestioles font un combat de trois tours ou de douze.

/**
 * Groupe de référence, à un niveau donné.
 *
 * La référence DOIT suivre le niveau du monstre, sinon toute créature de
 * milieu de campagne est classée « boss » par le seul fait d'être comparée à
 * des débutants — et le palier, qui est justement ce qu'on veut lire pour un
 * gros monstre, devient inutilisable là où il sert le plus.
 *
 * La progression retenue est celle recommandée à la table : les PJ gagnent
 * ~4 PV par niveau (leur `base.pvMax`, puisque l'Endurance seule ne leur en
 * donne quasiment aucun), leurs armes montent d'environ un point de dégâts
 * moyen par niveau, et leur équipement gagne du score d'armure. La chance de
 * toucher, elle, ne bouge pas : la bande du d20 est plate à cette échelle.
 */
export function partyRefFor(level = 1) {
  const lvl = Math.max(1, n(level, 1));
  const step = lvl - 1;

  // La taille du groupe et ses dégâts par attaque sont RÉGLABLES en monde :
  // deux tables n'ont ni le même effectif ni le même armement, et une survie
  // calculée sur « deux épées courtes à trois » ne veut rien dire pour un
  // groupe de cinq qui manie des haches. Les réglages sont lus ici, à chaque
  // pesée, pour qu'un changement se voie sans recharger quoi que ce soit.
  // Le try/catch couvre l'import du module hors de Foundry (harnais de test) :
  // `game` n'existe pas, on retombe sur les valeurs de départ.
  let size = 3;
  let dmg = 7;      // deux armes 1d6 : dé principal + dé de seconde main
  try {
    size = n(game.settings.get("rpg", "peseeGroupeTaille"), 3);
    dmg = n(game.settings.get("rpg", "peseeDegatsAttaque"), 7);
  } catch (e) { /* hors Foundry, ou réglages pas encore enregistrés */ }

  return {
    level: lvl,
    size: Math.max(1, size),
    hitChance: 0.5,                                // ~50 %, la bande du d20 est plate
    damagePerHit: Math.max(1, dmg + step),         // +1 de dégât moyen par niveau
    pv: 30 + step * 4,
    armureFixe: 0,
    reductionPct: Math.min(45, 5 + step * 3)
  };
}

/** Référence de début de partie, conservée pour les appels sans niveau. */
export const PARTY_REF = partyRefFor(1);

/**
 * Paliers de rencontre, en « poids » (menace × durée de vie), pour UN
 * exemplaire du monstre. Calibrés sur le fait qu'un monstre de base est censé
 * se jouer en nombre : un loup seul tombe en un tour et demi face à trois PJ,
 * ce qui est normal — c'est la meute qui fait le combat.
 */
const MONSTER_TIERS = [
  { max: 3,   key: "trivial",  label: "Trivial",   hint: "figurant — un PJ seul s'en occupe" },
  { max: 12,  key: "mineur",   label: "Mineur",    hint: "à jouer par 2-3 pour faire un combat" },
  { max: 35,  key: "serieux",  label: "Sérieux",   hint: "un vrai combat seul ou à deux" },
  { max: 90,  key: "elite",    label: "Élite",     hint: "mini-boss, un seul suffit" },
  { max: Infinity, key: "boss", label: "Boss",     hint: "⚠️ vérifie que le groupe peut le blesser" }
];

/** Réduction en % rendue par un score de défense (miroir de actor.js). */
function scorePct(score) {
  const S = Math.max(0, n(score, 0));
  return Math.min(70, (S / (S + 160)) * 100);
}

/**
 * Pèse un monstre : menace, durée de vie, et poids de rencontre.
 *
 * Lit les items `spell` du monstre pour ses attaques — un monstre n'a pas
 * d'armes dans ce système, ses attaques SONT ses sorts. On retient la
 * meilleure attaque disponible chaque tour, en tenant compte de la recharge :
 * une capacité à recharge 3 ne sort qu'un tour sur trois, et la compter à
 * plein régime surestimerait très largement des créatures dont tout le
 * dossier tient dans un coup spécial.
 *
 * @param {Actor|object} actor
 * @returns {{threat:number, survival:number, encounter:number, tier:object, rows:Array, warnings:Array}}
 */
export function computeMonsterValue(actor) {
  const sys = actor?.system ?? {};
  const rows = [];
  const warnings = [];
  const PARTY = partyRefFor(sys.niveau);

  // ── Durée de vie : PV effectifs face aux dégâts du groupe ──────────────
  const pv = Math.max(1, n(sys.ressources?.pv?.max, n(sys.base?.pvMax, 1)));
  const endBonus = Math.floor(n(sys.principales?.endurance, 0) / 3);

  // Un groupe frappe des DEUX livraisons : les armes en physique, les sorts en
  // magique. Ne tester que l'armure surestimait la survie d'un monstre bien
  // blindé mais peu résistant à la magie — et l'inverse pour un élémentaire.
  // On moyenne donc les deux étages de mitigation, l'un et l'autre complets
  // (fixe + score + résistance élémentaire de la livraison).
  const mitigate = (fixe, score, elemPct) => {
    const afterFixe = Math.max(1, Math.ceil((PARTY.damagePerHit - n(fixe, 0)) * (1 - scorePct(score) / 100)));
    return Math.max(1, afterFixe * (1 - Math.min(99, n(elemPct, 0)) / 100));
  };
  const hitPhys = mitigate(sys.defenses?.armureFixe, n(sys.defenses?.scoreArmure, 0) + endBonus,
                           sys.resistancesElem?.physique);
  const hitMag  = mitigate(sys.defenses?.resistanceFixe, n(sys.defenses?.scoreResistance, 0) + endBonus,
                           sys.resistancesElem?.magique);
  const perHit = (hitPhys + hitMag) / 2;

  const partyDps = PARTY.size * PARTY.hitChance * perHit;
  const regen = n(sys.regeneration?.pv, 0);

  // Régén ≥ dégâts du groupe : il ne meurt pas, point. On ne prolonge SURTOUT
  // pas la division avec un plancher arbitraire — elle produirait un « 1100
  // tours » d'apparence chiffrée qui masquerait l'unique information qui
  // compte : le combat n'a pas de fin.
  const invincible = regen >= partyDps;
  const survival = invincible ? Infinity : Math.round((pv / (partyDps - regen)) * 10) / 10;

  rows.push({ label: "PV", value: String(pv), points: null });
  rows.push({ label: "Dégâts encaissés par coup", value: `${Math.round(perHit * 10) / 10}`, points: null });
  if (regen) rows.push({ label: "Régén PV / tour", value: `+${regen}`, points: null });
  rows.push({
    label: `Tours de survie (groupe de ${PARTY.size}, niv. ${PARTY.level})`,
    value: invincible ? "∞" : `${survival}`,
    points: null
  });

  if (invincible) {
    warnings.push(
      `Régénération de ${regen} PV/tour contre ${Math.round(partyDps * 10) / 10} infligés par le groupe : ` +
      `il se soigne au moins aussi vite qu'il encaisse. Le combat est ININGAGNABLE au corps à corps ` +
      `— il lui faut une parade explicite (dégâts élémentaires auxquels il est vulnérable, effet qui ` +
      `suspend la régénération…), ou une régén plus basse.`
    );
  }

  // ── Menace : la meilleure attaque disponible, recharge comprise ────────
  const spells = (actor?.items ?? []).filter(i => i.type === "spell");
  let best = 0;
  for (const sp of spells) {
    const s = sp.system ?? {};
    const dmg = s.damage ?? {};
    if (dmg.enabled === false && !diceAverage(dmg.dice)) continue;

    const sc = dmg.scaling ?? {};
    const per = Math.max(1, n(sc.per, 10));
    const statVal = n(sys.principales?.[String(sc.stat ?? "force")], 0);
    const scaled = Math.floor(statVal / per) * n(sc.perStep, 0);

    const raw = diceAverage(dmg.dice) + n(dmg.flat, 0) + scaled;
    if (raw <= 0) continue;

    // Mitigation côté PJ, puis dilution par la recharge.
    const landed = Math.max(1, Math.ceil((raw - PARTY.armureFixe) * (1 - PARTY.reductionPct / 100)));
    const cd = Math.max(1, n(s.cooldown?.max, 0) + 1);
    const perTurn = (landed * PARTY.hitChance) / cd;
    const targets = Math.max(1, n(s.targetCount?.max, 1));

    rows.push({
      label: `⚔ ${sp.name}`,
      value: `${Math.round(raw * 10) / 10} brut${cd > 1 ? ` · recharge ${cd - 1}` : ""}${targets > 1 ? ` · ${targets} cibles` : ""}`,
      points: Math.round(perTurn * targets * 10) / 10
    });
    best = Math.max(best, perTurn * targets);
  }

  if (!spells.length) {
    warnings.push("Aucun sort sur ce monstre : il n'a aucune attaque. Dans ce système, les attaques d'un monstre SONT ses items `spell`.");
  } else if (best <= 0) {
    warnings.push("Aucune de ses capacités n'inflige de dégâts — vérifie que `damage.dice` est bien renseigné.");
  }

  const threat = Math.round(best * 10) / 10;

  // Tours qu'il faut à ce monstre pour abattre UN personnage.
  const toKill = threat > 0 ? Math.round((PARTY.pv / threat) * 10) / 10 : Infinity;
  rows.push({ label: "Menace (dégâts / tour)", value: `${threat}`, points: null });
  rows.push({
    label: "Tours pour abattre un PJ",
    value: Number.isFinite(toKill) ? `${toKill}` : "—",
    points: null
  });

  // Un monstre qui ne meurt pas n'a pas de score : le classer « boss » avec un
  // nombre astronomique donnerait l'illusion qu'il est simplement très fort,
  // alors que le problème est ailleurs (voir l'alerte).
  const encounter = invincible ? Infinity : Math.round(threat * survival * 10) / 10;
  const tier = invincible
    ? MONSTER_TIERS[MONSTER_TIERS.length - 1]
    : (MONSTER_TIERS.find(t => encounter <= t.max) ?? MONSTER_TIERS[MONSTER_TIERS.length - 1]);

  // Un monstre plus rapide que le groupe ne peut pas être fui : c'est une
  // décision de design, pas un accident, mais elle doit être consciente.
  const vitesse = n(sys.deplacement?.vitesse, 0);
  if (vitesse > 4) {
    warnings.push(`Vitesse ${vitesse} m : plus rapide qu'un PJ de départ (3 m). Le groupe ne pourra ni décrocher ni le distancer.`);
  }

  if (Number.isFinite(survival) && survival > 12) {
    warnings.push(`${survival} tours pour le tuer : c'est très long. Au-delà d'une dizaine de tours, un combat lasse avant d'être dangereux.`);
  }

  return {
    threat,
    survival: Number.isFinite(survival) ? survival : null,
    survivalText: Number.isFinite(survival) ? String(survival) : "∞",
    encounter: Number.isFinite(encounter) ? encounter : null,
    encounterText: Number.isFinite(encounter) ? String(encounter) : "∞",
    tier, rows, warnings, partyRef: PARTY
  };
}
