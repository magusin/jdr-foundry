// module/rules/item-value.js
//
// Pesée d'un objet — outil de théoriecraft RÉSERVÉ AU MJ.
//
// Ce fichier pèse TROIS choses avec la même monnaie (« points de puissance ») :
// un objet (computeItemValue), un SORT (computeSpellValue) et un monstre
// (computeMonsterValue). Elles partagent volontairement le même barème —
// STAT_WEIGHTS, RESIST_WEIGHTS, DAMAGE_POINT, partyRefFor — parce que la seule
// question qui vaille est comparative : « ce sort pèse-t-il plus lourd que
// l'épée que porte le groupe ? ». Trois barèmes séparés rendraient la réponse
// impossible à lire.
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
// calibrées sur un personnage de référence de début de partie (30 PV, 8 m de
// vitesse, 10 de fatigue, ~50 % de chance de toucher, coups reçus d'environ 6).
// La vitesse de base vient de base-speed.js : la changer change ce barème,
// puisque ce que vaut « +1 m » dépend entièrement de ce à quoi on l'ajoute.
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

// Le seuil de touché n'est PAS recopié ici : `tnFromRatio` et `applyDifficulty`
// sont importés de combat.js, qui reste la définition unique de la formule
// (voir computeTN). La pesée ne peut pas appeler computeTN elle-même — elle
// n'a pas de vrais documents attaquant/cible sous la main, seulement un groupe
// de référence chiffré — mais elle doit au moins partager le calcul.
import { tnFromRatio, applyDifficulty, clamp, AUTO_FAIL_MAX, AUTO_SUCC_MIN } from "./combat.js";
import { BASE_VITESSE } from "./base-speed.js";
import { normalizeAttackBonus } from "./attack-bonus.js";

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

  // ── Mobilité : sur une base de 8 m (BASE_VITESSE), +1 m est un huitième de
  // déplacement en plus. Décide qui engage, qui décroche, qui atteint le mage.
  // Le poids suivait la base de 3 m d'avant (12) : le garder aurait payé un
  // mètre au même prix alors qu'il vaut désormais deux fois et demie moins.
  vitesse: 4.5,

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
  // Le poids d'un point de Force/Intelligence dépend ENTIÈREMENT du `per` des
  // armes et des sorts de la table, puisque c'est lui qui convertit la stat en
  // dégâts (`damage.scaling`, item.js / spells.js) — la pesée d'une armure ne
  // peut pas savoir quelle arme sera portée avec, elle prend donc le `per` de
  // BASE. Recalculé depuis les formules de ce fichier, un point de stat vaut :
  //
  //     per 10 (base)  0,45   per 8  0,55   per 6  0,72   per 5  0,85
  //
  // 0,55 correspond à un arsenal majoritairement en `per` 8-10, avec quelques
  // armes à deux mains descendues à 5. Si tu généralises les `per` bas, monte
  // ce poids d'autant, sinon la pesée sous-évaluera toutes les pièces qui
  // donnent de la Force.
  //
  // Il valait 0,85 — la valeur d'un `per` de 5 — alors que le `per` de base
  // est 10 : toute pièce donnant de la Force ou de l'Intelligence était donc
  // comptée pour près du double de ce qu'elle rend réellement.
  force: 0.55,
  intelligence: 0.55,
  // Dextérité / Acuité : un TN chacune, et une moitié de point d'initiative.
  // ⚠️ Cette moitié de point ne pèse presque RIEN : l'initiative se joue sur
  // `1d100 + @init` (init.js), où +1 fait passer la chance d'agir en premier
  // de 50 % à 50,5 %. Le poids de 1,4 tient donc sur le seuil de touché seul —
  // il ne faudra le remonter que si l'initiative repasse un jour sur un dé
  // plus petit.
  dexterite: 1.4,
  acuite: 1.4,
  endurance: 0.6,

  // ── Scores de défense : S/(S+160). Mesuré autour d'un score de 20
  // (milieu de campagne), +1 rend environ un demi-point de pourcentage.
  scoreArmure: 0.3,
  scoreResistance: 0.3,

  // ── Régénération : des POINTS PAR TOUR, ajoutés à la base (ce fut un
  // pourcentage, inutilisable : sur une base de 1 PV/tour, tout ce qui était
  // sous +100 % disparaissait dans l'arrondi). Un point de régén rendu à
  // chaque tour vaut, sur le combat de référence, REF_TURNS points de vie —
  // d'où un poids proche de REF_TURNS × pvMax, légèrement en dessous parce
  // qu'un combat court le paie moins. Le mana suit le rapport que lui donne
  // déjà manaMax face à pvMax.
  regenPv: 8,
  regenMana: 6,

  // ── Initiative : le seul champ de `equipBonus.bonus` que cette table
  // n'avait jamais listé. `computeItemValue` itère sur STAT_WEIGHTS, donc une
  // clé absente d'ici est purement INVISIBLE : une relique « +10 initiative »
  // affichait 0 point et restait classée « Village ».
  //
  // Le poids est petit, et c'est le dé qui le veut : `CONFIG.Combat.initiative`
  // vaut « 1d100 + @init ». Contre un adversaire de même bonus, +1 donne
  // 50,5 % de passer avant lui, +5 donne 54,4 %, +10 donne 59,1 %. Un point
  // d'initiative vaut donc environ le quinzième d'un point de toucher.
  initiativeMod: 0.3
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

/**
 * Stat de référence pour évaluer un scaling hors de tout porteur.
 *
 * Elle DOIT suivre le niveau, exactement comme `partyRefFor` : une
 * caractéristique principale gagne +1 par niveau automatiquement
 * (`prepareDerivedData`), et l'équipement en ajoute à peu près autant, d'où
 * la pente de +2 par niveau — la même que celle retenue pour la Dextérité et
 * l'Acuité du groupe de référence.
 *
 *   niveau 1 → 4      niveau 5 → 12      niveau 10 → 22
 *
 * La constante valait 4 pour tout le monde, et c'était le trou le plus cher
 * de ce fichier dès qu'on règle les `per` arme par arme : un marteau en
 * `per 3` était pesé « +1 de scaling » (⌊4/3⌋) alors qu'un porteur de
 * niveau 5 en tire +4 (⌊13/3⌋). Soit 12 points de pesée manquants sur une
 * échelle où « Rare » commence à 55.
 *
 * Le niveau 1 rend toujours 4 : rien ne change pour une table qui débute.
 */
export function scalingRefStat(level = 1) {
  return 4 + 2 * (Math.max(1, n(level, 1)) - 1);
}

/**
 * Niveau du groupe de référence, réglable en monde (comme sa taille et ses
 * dégâts par attaque). `computeItemValue` pesait TOUT contre un groupe de
 * niveau 1, pour toujours : une arme était jugée sur la mitigation d'un
 * débutant (5 %) alors que le groupe qui la ramasse en est à 17 % ou 32 %.
 */
export function peseeLevel() {
  try {
    return Math.max(1, n(game.settings.get("rpg", "peseeNiveauGroupe"), 1));
  } catch (e) { return 1; }   // hors Foundry, ou réglage pas encore enregistré
}

/**
 * Paliers, par catégorie. Une arme part de plus haut : ses dés comptent.
 *
 * Le barème des armes a été divisé par ~1,8 le jour où leurs dés ont cessé
 * d'être pesés en brut pour l'être en ENCAISSÉ × chance de toucher, comme
 * ceux d'un sort (voir le bloc « Spécifique aux armes »). Rien n'a changé
 * dans le classement relatif des armes — toutes ont été multipliées par le
 * même facteur — mais les seuils devaient suivre, sinon tout l'arsenal
 * existant se serait mis à afficher « en dessous d'une arme de départ ».
 * Repères actuels : 1d6 nu = 16, 1d8+1 = 24, 1d10+2 = 32, 2d6+2 = 36.
 */
const TIERS = {
  gear: [
    { max: 5,   key: "village",    label: "Village" },
    { max: 15,  key: "commun",     label: "Commun" },
    { max: 30,  key: "rare",       label: "Rare" },
    { max: 55,  key: "epique",     label: "Épique" },
    { max: Infinity, key: "legendaire", label: "Légendaire" }
  ],
  weapon: [
    { max: 20,  key: "village",    label: "Village" },
    { max: 35,  key: "commun",     label: "Commun" },
    { max: 55,  key: "rare",       label: "Rare" },
    { max: 80,  key: "epique",     label: "Épique" },
    { max: Infinity, key: "legendaire", label: "Légendaire" }
  ]
};

/**
 * Champs sans frein mathématique : leur 9ᵉ exemplaire vaut autant que le
 * premier. Ce sont ceux dont la projection ×9 mérite d'être lue, et les
 * seuls pour lesquels une valeur « raisonnable » par pièce peut produire un
 * total déraisonnable sans que rien ne le signale.
 */
/**
 * Nombre d'emplacements d'équipement d'un personnage : tête, torse, taille,
 * bras, mains, jambes, pieds, main droite, main gauche, relique
 * (SLOT_DEFS dans character-sheet-v2.js).
 *
 * La projection était écrite « ×9 » en dur, d'avant l'existence du type
 * `relic` : elle sous-estimait donc d'un dixième le cumul d'un set complet.
 */
export const EQUIP_SLOTS = 10;

/**
 * Une arme à DEUX MAINS occupe les deux emplacements de main : son porteur
 * renonce à un bouclier ou à une seconde arme. Elle doit donc être comparée à
 * une PAIRE, pas à une arme seule, et ses paliers sont relevés d'autant.
 *
 * 1,5 vient de la pesée des mains gauches réelles rapportée au palier de leur
 * arme : un bouclier de bois pèse 11,5 pour un palier Village à 20 (×0,57), un
 * écu d'acier 14,8 pour un palier Commun à 35 (×0,42), un pavois runique 40,8
 * pour un palier Rare à 55 (×0,74), une dague en seconde main ~12 (×0,6). La
 * seconde main vaut donc, en gros, la moitié de la première.
 *
 * C'est un chiffre de table, à retoucher si tes boucliers pèsent
 * systématiquement plus ou moins que ça.
 */
export const TWO_HAND_TIER_FACTOR = 1.5;

/** Emplacements réellement consommés par un objet. */
export function slotsUsedBy(item) {
  return (String(item?.type ?? "") === "weapon" && item?.system?.twoHands) ? 2 : 1;
}

const LINEAR_FIELDS = new Set([
  "armureFixe", "resistanceFixe", "toucherPhysique", "toucherMagique",
  "vitesse", "fatigueMax", "regenPv", "regenMana"
]);

/** Plafond conseillé pour le CUMUL des 9 emplacements. Au-delà : alerte. */
const STACK_CAPS = {
  armureFixe: 8, resistanceFixe: 8,
  toucherPhysique: 2, toucherMagique: 2,
  // Cumul de tout un équipement : au plus la moitié d'un déplacement de base
  // en cadeau. Le plafond était de 2 m quand la base valait 3 — la même
  // proportion sur une base de 8 en donne 4.
  vitesse: 4, fatigueMax: 3,
  // Régén : en points par tour désormais. Un équipement complet qui rend
  // 2 PV/tour de plus double déjà la régénération d'un personnage de départ.
  regenPv: 2, regenMana: 3
};

const LABELS = {
  armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
  toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique",
  vitesse: "Vitesse", initiativeMod: "Initiative", pvMax: "PV max", manaMax: "Mana max",
  fatigueMax: "Fatigue max", podsMax: "Pods max", retraitMod: "Mod. retrait d'état",
  force: "Force", intelligence: "Intelligence",
  dexterite: "Dextérité", acuite: "Acuité", endurance: "Endurance",
  scoreArmure: "Score Armure", scoreResistance: "Score Résistance",
  regenPv: "Régén PV", regenMana: "Régén Mana"
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
 * @returns {{total:number, rows:Array, tier:object, warnings:Array, slots:number,
 *            category:string}}
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

  // Emplacements consommés (2 pour une arme à deux mains) et nombre de pièces
  // qu'un porteur peut réellement cumuler en portant celle-ci : une arme à
  // deux mains mange l'emplacement de la main gauche, donc une pièce de moins.
  const slots = slotsUsedBy(item);
  const stackPieces = EQUIP_SLOTS - (slots - 1);

  // ── Bonus de stats ────────────────────────────────────────────────────
  const bonus = sys.bonus ?? {};
  for (const [key, weight] of Object.entries(STAT_WEIGHTS)) {
    const v = n(bonus[key], 0);
    if (!v) continue;

    // Projection sur un équipement COMPLET portant cette même valeur. Seuls
    // les champs linéaires en ont besoin — pour les autres, la courbe absorbe
    // le cumul d'elle-même.
    let warn = false;
    if (LINEAR_FIELDS.has(key)) {
      const cap = STACK_CAPS[key];
      const stacked = v * stackPieces;
      if (cap !== undefined && stacked > cap) {
        warn = true;
        warnings.push(
          `${LABELS[key] ?? key} : ${round1(v)} par pièce → ${round1(stacked)} sur ${stackPieces} emplacements, ` +
          `au-dessus du cumul conseillé de ${cap}.`
        );
      }
    }
    // (L'alerte « ce pourcentage de régén ne rend rien » n'a plus lieu d'être :
    // la régén se saisit en points par tour, et le premier point compte.)

    add(LABELS[key] ?? key, v, weight, { key, warn });
  }

  // ── Résistances élémentaires ──────────────────────────────────────────
  const re = sys.resistancesElem ?? {};
  for (const [key, weight] of Object.entries(RESIST_WEIGHTS)) {
    const v = n(re[key], 0);
    if (!v) continue;
    const stacked = v * stackPieces;
    // 100 = immunité : neuf pièces à 12 % suffisent à rendre un type inoffensif.
    const warn = Math.abs(stacked) >= 100;
    if (warn) {
      warnings.push(
        `Résistance ${key} : ${round1(v)} % par pièce → ${round1(stacked)} % sur ${stackPieces} emplacements, ` +
        `soit ${stacked >= 100 ? "l'immunité totale" : "la vulnérabilité maximale"}.`
      );
    }
    add(`Résist. ${key}`, v, weight, { text: `${v > 0 ? "+" : ""}${round1(v)} %`, warn });
  }

  // ── Résistances aux états ─────────────────────────────────────────────
  for (const r of (Array.isArray(sys.resistances) ? sys.resistances : [])) {
    const tag = r?.tag || r?.effectKey || "état";
    if (r?.immune) add(`Immunité ${tag}`, 1, STATE_RESIST_WEIGHTS.immune, { text: "immunisé" });
    // Une valeur NÉGATIVE est une vulnérabilité : l'effet dure plus longtemps
    // ou fait plus mal. Le signe affiché est donc inversé par rapport au champ
    // (« réduction de −2 » = « +2 tours subis »), comme dans resistTextParts,
    // et les points partent naturellement en négatif.
    const signed = (v, unit = "") => `${v > 0 ? "−" : "+"}${Math.abs(round1(v))}${unit}`;
    const dur = n(r?.durationReduction, 0);
    if (dur) add(`Durée ${tag}`, dur, STATE_RESIST_WEIGHTS.durationReduction, { text: `${signed(dur)} tour(s)` });
    const dot = n(r?.dotReductionPct, 0);
    if (dot) add(`DOT ${tag}`, dot, STATE_RESIST_WEIGHTS.dotReductionPct, { text: signed(dot, " %") });
  }

  // ── Spécifique aux armes ──────────────────────────────────────────────
  const isWeapon = type === "weapon";
  if (isWeapon) {
    // Les dés d'une arme sont pesés EXACTEMENT comme ceux d'un sort : pas le
    // brut écrit sur la fiche, mais ce qui arrive vraiment dans la figure du
    // groupe de référence — mitigation appliquée (landedAgainstParty) puis
    // multiplié par la chance de toucher.
    //
    // Ce n'était pas le cas, et l'écart n'était pas lisible : une attaque
    // d'arme et un sort offensif passent par le MÊME computeTN (Dex/Dex ou
    // Acuité/Acuité selon la livraison), donc ils touchent aussi souvent l'un
    // que l'autre — mais l'arme était comptée en brut et le sort en encaissé
    // × chance de touche. Un 1d6 d'épée pesait 28 quand un 1d6 de sort pesait
    // 17,6, et le bloc « Force du sort » invite explicitement à comparer les
    // deux (« une attaque à l'arme ordinaire en pèse 28 → ce sort vaut
    // ×0.32 ») : le MJ concluait, à raison, que le système punissait les
    // sorts. Les deux écrans sont maintenant dans la même monnaie.
    //
    // La chance de toucher vient du PORTEUR, pas de l'arme : elle est donc la
    // même pour toutes (celle du groupe de référence) et ne change RIEN au
    // classement des armes entre elles — seul le barème (TIERS.weapon) a été
    // divisé d'autant. Ce qui appartient vraiment à l'arme, son toucher*, est
    // pesé à part dans la grille de bonus, comme avant.
    const LEVEL = peseeLevel();
    const REF_STAT = scalingRefStat(LEVEL);
    const PARTY = partyRefFor(LEVEL);
    const W = DAMAGE_POINT * PARTY.hitChance;   // un point ENCAISSÉ, pondéré par la touche
    const hitPct = Math.round(PARTY.hitChance * 100);

    const dmg = sys.damage ?? {};
    const avg = diceAverage(dmg.dice) + n(dmg.flat, 0);
    const landedAvg = landedAgainstParty(avg, PARTY);
    if (avg) add("Dégâts (moyenne)", landedAvg, W, {
      text: `${round1(avg)} brut → ${round1(landedAvg)} encaissé · ${hitPct} % de touche`
    });

    // Scaling : évalué sur une caractéristique de référence, faute de porteur.
    const sc = dmg.scaling ?? {};
    const per = Math.max(1, n(sc.per, 10));
    const perStep = n(sc.perStep, 0);
    const scaled = Math.floor(REF_STAT / per) * perStep;
    // Chaque ligne suivante est pesée comme un INCRÉMENT du même coup, jamais
    // comme un coup séparé : l'armure fixe et le plancher à 1 de
    // landedAgainstParty s'appliquent une fois par coup reçu, et les repayer
    // ligne par ligne gonflerait un +1 de scaling autant qu'un dé entier.
    const landedScaled = landedAgainstParty(avg + scaled, PARTY) - landedAvg;
    if (scaled) add(`Scaling (${sc.stat ?? "?"} réf. ${REF_STAT})`, landedScaled, W, { text: `+${round1(scaled)}` });

    // Critique : ne se déclenche que sur un 20 naturel, soit 5 % des jets.
    // Il n'est PAS multiplié par la chance de toucher — un 20 naturel touche
    // toujours — et il s'AJOUTE au coup au lieu de le remplacer, contrairement
    // au critique d'un sort (cf. rollAttackDamage : le dé de crit est un dé de
    // plus, posé à côté du dé principal). D'où une ligne distincte ici, quand
    // computeSpellValue fond la sienne dans la moyenne pondérée.
    const critAvg = diceAverage(sys.crit?.damage?.dice) + n(sys.crit?.damage?.flat, 0);
    const landedCrit = landedAgainstParty(avg + scaled + critAvg, PARTY) - landedAgainstParty(avg + scaled, PARTY);
    if (critAvg) add("Critique (5 % des jets)", landedCrit, DAMAGE_POINT * 0.05, { text: `${round1(critAvg)}` });

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

    // Recharge : une arbalète qui tire un tour sur deux ne vaut pas une épée
    // qui frappe à chaque tour. On retire la part de dégâts que la recharge
    // fait perdre, plutôt que de diviser le total — les bonus d'équipement,
    // eux, sont portés en permanence et ne se rechargent pas.
    const cdMax = Math.max(0, n(sys.cooldown?.max, 0));
    if (cdMax > 0) {
      const damagePoints = rows
        .filter(r => /Dégâts|Scaling|Critique/.test(r.label))
        .reduce((sum, r) => sum + n(r.points, 0), 0);
      const perdu = damagePoints * (1 - 1 / (1 + cdMax));
      if (perdu > 0) {
        add("Recharge", -perdu, 1, { text: `${cdMax} tour(s) → 1 tir sur ${cdMax + 1}` });
      }
    }

  }

  total = round1(total);

  // ── Emplacements occupés ──────────────────────────────────────────────
  // Une arme à deux mains prive son porteur de sa main gauche : elle doit
  // donc peser autant qu'une arme à une main PLUS ce qu'aurait rendu un
  // bouclier ou une seconde arme. Les paliers sont relevés de
  // TWO_HAND_TIER_FACTOR au lieu de diviser le total par deux — diviser
  // rendait toutes les armes à deux mains « Village » d'un coup, puisque le
  // barème TIERS.weapon est calibré sur des armes entières.
  //
  // C'était auparavant une simple phrase d'avertissement : le MJ lisait
  // « Rare » sur une épée à deux mains qui, à emplacement égal, valait un
  // Commun, et rien dans le chiffre ne le disait.
  const table = TIERS[isWeapon ? "weapon" : "gear"];
  const tierFactor = slots > 1 ? TWO_HAND_TIER_FACTOR : 1;
  const tier = table.find(t => total <= t.max * tierFactor) ?? table[table.length - 1];

  if (slots > 1) {
    const perSlot = round1(total / slots);
    rows.push({
      label: "Emplacements occupés",
      value: `${slots} (deux mains)`,
      points: 0,
      key: "slots",
      warn: false
    });
    warnings.push(
      `Arme à deux mains : elle occupe ${slots} emplacements, soit ${perSlot} point(s) par ` +
      `emplacement. Son palier est jugé sur des seuils relevés de ×${TWO_HAND_TIER_FACTOR} ` +
      `(${round1(table[0].max * tierFactor)} / ${round1(table[1].max * tierFactor)} / ` +
      `${round1(table[2].max * tierFactor)} / ${round1(table[3].max * tierFactor)}), ` +
      `parce qu'elle remplace une arme ET une main gauche.`
    );
  }

  rows.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return { total, rows, tier, warnings, slots, category: isWeapon ? "weapon" : "gear" };
}

/** Types d'objets que la pesée sait traiter. */
export function isWeighable(type) {
  return ["weapon", "armor", "relic"].includes(String(type ?? ""));
}

// ─────────────────────────────────────────────────────────────────────────
// SOCLE COMMUN AUX SORTS ET AUX MONSTRES
// ─────────────────────────────────────────────────────────────────────────

/**
 * Durée du combat de référence, en tours.
 *
 * Sert à deux endroits, et pour la même raison. STAT_WEIGHTS chiffre un bonus
 * PERMANENT (une pièce d'équipement portée tout le combat) ; un buff de 3 tours
 * n'en vaut donc qu'une fraction, et cette fraction est `durée / REF_TURNS`.
 * C'est aussi la longueur sur laquelle on étale la valeur d'un effet
 * « permanent », qui sinon vaudrait l'infini.
 *
 * 5 tours : un combat de table qui se passe bien. Monter ce chiffre revalorise
 * mécaniquement tous les buffs longs face aux dégâts immédiats.
 */
const REF_TURNS = 5;

/**
 * Nombre de créatures qu'une aura est censée toucher, faute de savoir qui sera
 * réellement à portée. Volontairement bas : une aura de 3 m attrape rarement
 * plus de deux personnes dans une escarmouche ordinaire.
 */
const AURA_REF_TARGETS = 2;

/**
 * Ce que vaut UN point rendu, relativement à un point de dégât (DAMAGE_POINT).
 *
 *  - PV : 0,8. Soigner vaut un peu moins que blesser — un soin peut déborder
 *    au-dessus du max, et il ne retire aucune action à l'adversaire.
 *  - Mana : 0,6, le même rapport que manaMax (1,5) à pvMax (2) dans STAT_WEIGHTS.
 *  - Fatigue : 1,5, même rapport que fatigueMax (3) à pvMax (2). Un point de
 *    fatigue rendu, c'est une action de plus avant l'épuisement.
 */
const RESTORE_WEIGHTS = { pv: 0.8, mana: 0.6, fatigue: 1.5 };

/**
 * Ordre de grandeur habituel de chaque stat, pour convertir un modificateur
 * en POURCENTAGE (mode "pct") en son équivalent plat. « +20 % de Force » ne
 * veut rien dire tant qu'on ne sait pas sur quelle Force. Ces valeurs sont
 * celles d'un personnage de milieu de campagne ; elles n'ont pas besoin d'être
 * justes, seulement d'être du bon ordre.
 */
const PCT_REF = {
  force: 10, intelligence: 10, dexterite: 10, acuite: 10, endurance: 10,
  armureFixe: 2, resistanceFixe: 2, scoreArmure: 20, scoreResistance: 20,
  toucherPhysique: 1, toucherMagique: 1, initiativeMod: 5,
  vitesse: BASE_VITESSE, pvMax: 30, manaMax: 5, regenPv: 1, regenMana: 1,
  fatigueMax: 10, podsMax: 50
};

/**
 * Chance de toucher pour un seuil donné, d20 : 5- échec automatique,
 * 16+ succès automatique (combat.js). Le seuil est borné avant lecture, donc
 * le résultat vit toujours entre 25 % et 75 % — c'est la bande réelle du jeu,
 * et c'est pour ça qu'un point de toucher vaut si cher dans STAT_WEIGHTS.
 */
export function hitChanceForTN(tn) {
  const t = clamp(n(tn, 11), AUTO_FAIL_MAX + 1, AUTO_SUCC_MIN);
  return (21 - t) / 20;
}

/** Part des jets qui sont des critiques (20 naturel). */
const CRIT_SHARE = 0.05;

/**
 * Seuil de touché d'un sort contre le groupe de référence.
 *
 * Reproduit computeTN (combat.js) avec un adversaire chiffré au lieu d'un
 * document : même `tnFromRatio`, même `applyDifficulty`, même bornage, même
 * branche « cible amie » — là, la difficulté EST le seuil et 0 vaut réussite
 * automatique. Le malus de distance n'y figure pas : il dépend de la position
 * des tokens, qui n'existe pas au moment où l'on pèse une fiche.
 */
function spellTNAgainst(sys, { stats, toucherPhysique = 0, toucherMagique = 0, party, friendly = false }) {
  const livraison = String(sys?.livraison ?? "magique");
  const isPhys = livraison === "physique";
  const diff = Math.max(0, n(sys?.difficulte, 0));
  const toucher = isPhys ? n(toucherPhysique, 0) : n(toucherMagique, 0);

  if (friendly) {
    const autoSuccess = diff <= 0;
    return {
      livraison, friendly: true, autoSuccess, diff,
      tn: autoSuccess ? 0 : clamp(diff - toucher, 6, 16),
      chance: autoSuccess ? 1 : hitChanceForTN(diff - toucher)
    };
  }

  const atk = isPhys ? n(stats?.dexterite, 0) : n(stats?.acuite, 0);
  const def = isPhys ? n(party?.dexterite, 0) : n(party?.acuite, 0);
  const tnBase = tnFromRatio((100 + atk) / (100 + def));
  const tn = clamp(applyDifficulty(tnBase, diff) - toucher, 6, 16);
  return { livraison, friendly: false, autoSuccess: false, diff, tnBase, tn, chance: hitChanceForTN(tn) };
}

/** Lignes de dégâts d'un sort : `damages[]`, l'ancien bloc unique en repli. */
function spellDamageLines(sys) {
  const lines = Array.isArray(sys?.damages) ? sys.damages.filter(Boolean) : [];
  if (lines.length) return lines;
  const legacy = sys?.damage ?? {};
  if (legacy.enabled === false) return [];
  const sc = legacy.scaling ?? {};
  return [{
    dice: legacy.dice, flat: legacy.flat,
    stat: sc.stat ?? "intelligence", per: sc.per, perStep: sc.perStep,
    livraison: sys?.livraison ?? "magique",
    critDice: sys?.damageCrit?.enabled ? sys.damageCrit.dice : "",
    critFlat: sys?.damageCrit?.enabled ? sys.damageCrit.flat : legacy.flat
  }];
}

/**
 * Le sort vise-t-il un ADVERSAIRE ?
 *
 * La question n'est pas cosmétique : computeTN traite une cible amie
 * entièrement à part (aucune comparaison de stats, la difficulté EST le seuil,
 * 0 = réussite automatique). Se tromper de branche fait passer un sort de
 * 50 % de touche à 100 %, ou l'inverse.
 *
 * À la table, c'est la DISPOSITION du token qui tranche — une information qui
 * n'existe pas quand on pèse une fiche. On lit donc l'intention du sort :
 * des dégâts, un effet par tour qui blesse la cible, ou un malus posé sur elle
 * suffisent à en faire une attaque. Un sort qui ne fait que rendre des PV ou
 * poser un bonus est considéré comme du soutien.
 */
function spellIsHostile(sys) {
  if (spellDamageLines(sys).some(d => diceAverage(d?.dice) + n(d?.flat, 0) + n(d?.perStep, 0) > 0)) return true;
  for (const fx of (Array.isArray(sys?.effectsUI) ? sys.effectsUI : [])) {
    if (!fx || String(fx.target ?? "target") !== "target") continue;
    if (String(fx.tick?.mode ?? "none") === "damage") return true;
    if ((Array.isArray(fx.mods) ? fx.mods : []).some(m => (m?.sens === "malus") || n(m?.value, 0) < 0)) return true;
    if (n(fx.resistDamagePct, 0) < 0) return true;   // vulnérabilité imposée
  }
  return false;
}

/** Bonus de dégâts d'une ligne, depuis la stat du lanceur (stat/per × perStep). */
function statScale(stats, stat, per, perStep) {
  const key = String(stat ?? "");
  if (!key || !n(perStep, 0)) return 0;
  return Math.floor(n(stats?.[key], 0) / Math.max(1, n(per, 10))) * n(perStep, 0);
}

/** Mitigation d'un coup par le groupe de référence (armure fixe puis %). */
function landedAgainstParty(raw, party) {
  const r = n(raw, 0);
  if (r <= 0) return 0;
  return Math.max(1, Math.ceil((r - n(party.armureFixe, 0)) * (1 - n(party.reductionPct, 0) / 100)));
}

// ─────────────────────────────────────────────────────────────────────────
// PESÉE D'UN SORT
// ─────────────────────────────────────────────────────────────────────────
//
// Même intention que pour un objet : dire au MJ si ce qu'il vient d'écrire est
// abusé. Mais un sort a beaucoup plus de leviers qu'une épée, et ils ne se
// lisent pas les uns sans les autres : 2d6 sur trois cibles toutes les deux
// rondes, ce n'est pas « 2d6 ». Tous les facteurs de la fiche entrent donc
// dans le calcul :
//
//   dés + plat + scaling de stat · critique (5 % des jets) · vol de vie ·
//   nombre de cibles · récupérations (PV/mana/fatigue, sur soi et/ou la cible) ·
//   effets (dégâts ou soin par tour, modificateurs de stats, aura, résistances
//   accordées, durée, permanence) · déplacement du lanceur · portée ·
//   difficulté (via le seuil de touché réel) · vitesse (rapide/normal/passif) ·
//   recharge · coût en mana et en fatigue.
//
// Deux chiffres sortent de là, et le second est celui qui compte :
//
//   PAR UTILISATION  ce que le sort délivre quand il part
//   PAR TOUR         le même, ramené à ce qu'il peut réellement sortir chaque
//                    tour (recharge, sort rapide joué deux fois, passif étalé
//                    sur le combat de référence)
//
// C'est « par tour » qui se compare à une arme, à un autre sort, et au barème.

/**
 * Paliers d'un sort, lus sur la puissance PAR TOUR.
 *
 * Calibrés sur UN repère, et il est concret : une attaque à l'arme ordinaire
 * — celle que n'importe quel personnage porte à chaque tour, gratuitement —
 * pèse environ 28 points par tour au niveau 1 (7 de dégâts bruts, ~50 % de
 * touche). C'est la valeur renvoyée dans `weaponRef`, recalculée à chaque
 * pesée d'après les réglages du monde : un sort qui pèse moins que ça ne
 * mérite pas d'occuper une place d'action, un sort qui pèse le double doit
 * se payer quelque part (mana, recharge, difficulté).
 */
export const SPELL_TIERS = [
  { max: 12,  key: "village",    label: "Mineur",     hint: "moins qu'une attaque à l'arme : utilitaire ou appoint" },
  { max: 30,  key: "commun",     label: "Standard",   hint: "l'équivalent d'une attaque à l'arme" },
  { max: 60,  key: "rare",       label: "Fort",       hint: "un sort de spécialiste, à faire payer" },
  { max: 110, key: "epique",     label: "Très fort",  hint: "doit coûter cher ou recharger longtemps" },
  { max: Infinity, key: "legendaire", label: "Démesuré", hint: "⚠️ vérifie recharge, coût et nombre de cibles" }
];

const SPEED_LABELS = { normal: "Normal", rapide: "Rapide", passif: "Passif" };

/**
 * Pèse un sort.
 *
 * @param {Item|object} item   Item de type `spell` (document ou données brutes).
 * @param {object}      opts
 * @param {Actor}       opts.actor   Porteur, pour le scaling de stat. À défaut,
 *                                   `item.parent`, puis une stat de référence.
 * @param {object}      opts.stats   Principales à utiliser (pesée d'un band de
 *                                   génération, où aucun acteur n'existe encore).
 * @param {number}      opts.level   Niveau du groupe de référence.
 * @returns {{perUse:number, perTurn:number, total:number, rows:Array, tier:object,
 *            warnings:Array, hit:object, damagePerUse:number, focusPerUse:number,
 *            healSelfPerUse:number, manaCost:number, fatigueCost:number,
 *            cooldown:number, usesPerTurn:number, targets:number, partyRef:object}}
 */
export function computeSpellValue(item, opts = {}) {
  const sys = item?.system ?? {};
  const actor = opts.actor ?? item?.parent ?? null;
  // Sans porteur (fiche de sort ouverte au compendium), le niveau de
  // référence est celui réglé en monde — le même que pour un objet, sinon un
  // sort et une arme de la même table se pèsent contre deux groupes
  // différents.
  const level = n(opts.level, n(actor?.system?.niveau, peseeLevel()));
  const PARTY = opts.party ?? partyRefFor(level);
  const rows = [];
  const warnings = [];

  // Stats du lanceur : les effectives (états compris) si on a un acteur, celles
  // qu'on nous passe (band de génération) sinon, et à défaut une valeur de
  // référence — la même que pour le scaling d'une arme sans porteur.
  const stats = opts.stats
    ?? actor?.system?.derived?.effective?.principales
    ?? actor?.system?.principales
    ?? (() => {
      const r = scalingRefStat(level);
      return { force: r, intelligence: r, dexterite: r, acuite: r, endurance: r };
    })();
  const hasCaster = !!(opts.stats || actor);
  // Valeur de repli quand un scaling porte sur une stat absente de `stats`
  // (et libellé des avertissements) : la même référence, au même niveau, que
  // celle d'une arme sans porteur.
  const REF_STAT = scalingRefStat(level);
  const statOf = (key) => n(stats?.[String(key ?? "")], REF_STAT);

  const speed = String(sys.speed ?? "normal");
  const isPassif = speed === "passif";
  // Un passif ne vise personne : il s'applique à son porteur, un point.
  // Un `targetCount.max` resté à 3 d'une version antérieure du sort aurait
  // sinon triplé le poids de chacun de ses effets, sans que rien ne le montre
  // — la fiche ne propose même plus le champ en passif.
  const targets = isPassif ? 1 : Math.max(1, n(sys.targetCount?.max, 1));
  const cdMax = Math.max(0, n(sys.cooldown?.max, 0));

  // ── Dégâts ────────────────────────────────────────────────────────────
  const lines = spellDamageLines(sys);
  let rawNormal = 0, rawCrit = 0, siphonPct = 0;
  for (const d of lines) {
    const scale = statScale(stats, d.stat, d.per, d.perStep);
    const base = diceAverage(d.dice) + n(d.flat, 0) + scale;
    // Sur critique, critDice REMPLACE les dés (s'il est renseigné) et critFlat
    // remplace le plat — c'est exactement ce que fait la résolution (spells.js).
    const critDice = String(d.critDice ?? "").trim();
    const crit = diceAverage(critDice || d.dice) + n(d.critFlat, 0) + scale;
    rawNormal += base;
    rawCrit += crit;
    // Le vol de vie porte sur les dégâts de SA ligne ; on garde le maximum,
    // faute de pouvoir répartir sans alourdir tout le reste.
    siphonPct = Math.max(siphonPct, Math.max(0, Math.min(100, n(d.siphon, 0))));
  }

  // ── Seuil de touché ───────────────────────────────────────────────────
  // Un sort de soutien vise un allié : la branche « cible amie » de computeTN
  // s'applique, la difficulté saisie EST le seuil, et 0 vaut réussite
  // automatique. Un sort hostile, lui, compare les stats.
  const isSupport = !spellIsHostile(sys);
  const hit = isPassif
    ? { friendly: false, autoSuccess: true, tn: 0, chance: 1, livraison: String(sys.livraison ?? "magique"), diff: 0 }
    : spellTNAgainst(sys, {
        stats, party: PARTY, friendly: isSupport,
        // Toucher inné du lanceur : celui d'un monstre est tiré par la
        // génération (base.toucher*), donc il peut être fourni directement
        // quand on pèse un band, sans acteur derrière.
        toucherPhysique: n(opts.toucherPhysique, n(actor?.system?.derived?.toucherPhysique, 0)),
        toucherMagique: n(opts.toucherMagique, n(actor?.system?.derived?.toucherMagique, 0))
      });
  const chance = hit.chance;
  // Un passif ne lance AUCUN dé : il est actif en permanence, sans jet, donc
  // sans réussite ni critique. Lui laisser la part de critique le faisait
  // peser comme si 5 % de ses ticks sortaient en 20 naturel, et la fiche
  // annonçait « dont critique » sur un sort que declareSpell refuse de
  // déclarer. La chance vaut déjà 1 plus haut ; la part de crit doit valoir 0.
  const critShare = isPassif ? 0 : Math.min(chance, CRIT_SHARE);

  const landedNormal = landedAgainstParty(rawNormal, PARTY);
  const landedCrit = landedAgainstParty(rawCrit, PARTY);
  // Ce que reçoit UNE cible en moyenne (crit compris), puis le total du groupe.
  const focusDamage = (chance - critShare) * landedNormal + critShare * landedCrit;
  const damagePerUse = focusDamage * targets;

  let points = 0;
  const add = (label, value, pts, opts2 = {}) => {
    points += pts;
    rows.push({ label, value: String(value), points: round1(pts), warn: !!opts2.warn });
  };

  if (rawNormal > 0) {
    add(`Dégâts moyens (par cible${targets > 1 ? `, ×${targets}` : ""})`,
        `${round1(rawNormal)} brut → ${round1(landedNormal)} encaissé`,
        damagePerUse * DAMAGE_POINT);
    // Idem : pas de ligne « dont critique » sur un passif, qui n'en a pas.
    if (!isPassif && rawCrit !== rawNormal) {
      rows.push({ label: "Dont critique (5 % des jets)", value: `${round1(rawCrit)} brut`, points: null });
    }
  }

  // ── Vol de vie ────────────────────────────────────────────────────────
  let healSelf = 0;
  if (siphonPct > 0 && damagePerUse > 0) {
    const stolen = damagePerUse * siphonPct / 100;
    healSelf += stolen;
    add("Vol de vie", `${round1(siphonPct)} % → ${round1(stolen)} PV`,
        stolen * DAMAGE_POINT * RESTORE_WEIGHTS.pv);
  }

  // ── Récupérations (PV / mana / fatigue rendus) ────────────────────────
  for (const r of (Array.isArray(sys.restores) ? sys.restores : [])) {
    if (!r) continue;
    const avg = diceAverage(r.dice) + n(r.flat, 0) + statScale(stats, r.stat, r.per, r.perStep);
    if (avg <= 0) continue;
    const resource = ["pv", "mana", "fatigue"].includes(String(r.resource)) ? String(r.resource) : "pv";
    const cible = String(r.cible ?? "self");
    // « both » = soi + chaque cible ; « target » = chaque cible.
    const heads = cible === "both" ? 1 + targets : (cible === "target" ? targets : 1);
    const total = avg * heads * chance;
    if (resource === "pv" && cible !== "target") healSelf += avg * chance;
    add(`Rend ${resource} (${cible === "both" ? "soi + cible" : cible === "target" ? "cible" : "soi"})`,
        `${round1(avg)} × ${heads}`,
        total * DAMAGE_POINT * RESTORE_WEIGHTS[resource]);
  }

  // ── Effets ────────────────────────────────────────────────────────────
  let tickDamagePerUse = 0;
  for (const fx of (Array.isArray(sys.effectsUI) ? sys.effectsUI : [])) {
    if (!fx) continue;
    const label = String(fx.label ?? "Effet");
    const permanent = !!fx.permanent;
    // Un effet permanent ne vaut pas l'infini : on l'étale sur le combat de
    // référence, et on le signale — c'est un choix de design, pas un détail.
    const rawDur = permanent ? REF_TURNS : Math.max(1, n(fx.duration, 1));
    const dur = Math.min(rawDur, REF_TURNS);
    const durFactor = dur / REF_TURNS;

    const ben = ["self", "both", "target"].includes(String(fx.target)) ? String(fx.target) : "target";
    // Combien de créatures le subissent, et est-ce à leur avantage ?
    // « self » et « both » touchent le lanceur, donc un bonus y est un gain ;
    // « target » ne l'est que si le sort est de soutien (la cible est alors un
    // allié). Sur une cible adverse, c'est le MALUS qui vaut positif.
    const onAlly = (ben !== "target") || isSupport;
    const heads = ben === "self" ? 1 : (ben === "both" ? 1 + targets : targets);
    const auraMult = fx.isAura ? AURA_REF_TARGETS : 1;
    const affected = heads * auraMult;

    // ── Quand l'effet part-il réellement ? ──────────────────────────────
    // effectsForResult() (spells.js) ne pose un effet que sur le résultat
    // qu'il déclare : "crit" n'arrive que sur un 20 naturel, "hitonly" est au
    // contraire exclu du critique. Peser tous les effets à la chance de touche
    // gonflait un sort dont la brûlure ne part qu'un jet sur vingt — elle
    // comptait alors comme si elle partait à chaque touche.
    // Un passif ne fait aucun jet : son effet est toujours là.
    const when = String(fx.when ?? "hit").toLowerCase();
    const fxChance = isPassif ? chance
      : when === "crit"    ? critShare
      : when === "hitonly" ? Math.max(0, chance - critShare)
      : chance;
    // Le déclencheur se lit sur chaque ligne de l'effet, sinon un total divisé
    // par vingt ressemble à un bug.
    const whenTag = isPassif ? ""
      : when === "crit"    ? ` · crit seul (${Math.round(critShare * 100)} % des jets)`
      : when === "hitonly" ? ` · touche normale (${Math.round(fxChance * 100)} %)`
      : "";
    const fxLabel = `${label}${whenTag}`;

    // Effet par tour : dégâts ou soin, pendant toute sa durée.
    const tick = fx.tick ?? {};
    const tickMode = String(tick.mode ?? "none");
    if (tickMode === "damage" || tickMode === "heal") {
      const per = Math.abs(n(tick.flat, 0)) + statScale(stats, tick.stat, tick.per, tick.perStep);
      if (per > 0) {
        const perTick = tickMode === "damage" ? landedAgainstParty(per, PARTY) : per;
        const total = perTick * dur * affected * fxChance;
        if (tickMode === "damage") tickDamagePerUse += perTick * dur * affected * fxChance;
        if (tickMode === "heal" && ben !== "target") healSelf += per * dur * fxChance;
        add(`${fxLabel} · ${tickMode === "damage" ? "dégâts" : "soin"} par tour`,
            `${round1(per)} × ${dur} tour(s)${affected > 1 ? ` × ${affected}` : ""}`,
            total * DAMAGE_POINT * (tickMode === "damage" ? 1 : RESTORE_WEIGHTS.pv));
      }
    }

    // Modificateurs de stats : le barème de l'équipement, au prorata de la
    // durée — STAT_WEIGHTS chiffre un bonus porté tout le combat.
    for (const m of (Array.isArray(fx.mods) ? fx.mods : [])) {
      const stat = String(m?.stat ?? "");
      const weight = STAT_WEIGHTS[stat];
      if (!stat || weight === undefined) continue;
      const signed = n(m?.value, 0);
      const isBonus = (m?.sens === "malus") ? false : (m?.sens === "bonus" ? true : signed >= 0);
      // Part fixe + part qui grandit avec une stat du lanceur, chiffrée sur
      // la même référence que le scaling des dégâts (scalingRefStat) : sans
      // elle, « +1 par 10 d'Intelligence » pesait zéro.
      const scaleStat = String(m?.scaleStat ?? "").trim();
      const scaleStep = n(m?.scaleStep, 0);
      const scalePer = Math.max(1, n(m?.scalePer, 10) || 10);
      const scaled = (scaleStat && scaleStep)
        ? Math.floor(statOf(scaleStat) / scalePer) * Math.abs(scaleStep) : 0;
      const qty = Math.abs(signed) + scaled;
      if (!qty) continue;
      // Un "%" n'a de sens que rapporté à une valeur : PCT_REF donne l'ordre
      // de grandeur habituel de la stat visée.
      const flatEq = String(m?.mode) === "pct" ? (qty / 100) * n(PCT_REF[stat], 10) : qty;
      // Ce qui compte pour le lanceur : un bonus sur un allié et un malus sur
      // un adversaire valent tous deux POSITIF ; les deux croisements sont des
      // maluses pour lui, et pèsent donc négativement.
      const sign = (onAlly === isBonus) ? 1 : -1;
      // × fxChance : un effet n'est posé QUE sur le résultat qu'il déclare, et
      // seulement si le MJ valide la touche (voir effectsForResult dans
      // spells.js). Un sort dur à placer — ou un effet réservé au critique —
      // accorde donc son bonus moins souvent, et cela doit se voir.
      const pts = sign * flatEq * weight * durFactor * affected * fxChance;
      add(`${fxLabel} · ${LABELS[stat] ?? stat}`,
          `${isBonus ? "+" : "−"}${round1(qty)}${String(m?.mode) === "pct" ? " %" : ""} · ${dur} tour(s)`,
          pts);
    }

    // Bonus de dégâts accordé aux attaques du porteur (attack-bonus.js).
    // Il vaut ce qu'il ajoute à CHAQUE attaque, pendant toute sa durée : on
    // compte une attaque par tour (le budget en autorise deux, mais la
    // seconde place part le plus souvent en déplacement). Un bonus en % est
    // ramené en points via l'attaque de référence du groupe — c'est justement
    // ce qui le rend difficile à équilibrer : il monte avec l'arme.
    const atk = normalizeAttackBonus({
      scope: fx.atkScope, categories: fx.atkCategories,
      flat: fx.atkFlat, pct: fx.atkPct, dice: fx.atkDice,
      livraison: fx.atkLivraison, tag: fx.atkTag,
      effect: {
        label: fx.atkFxLabel, when: fx.atkFxWhen,
        duration: fx.atkFxDuration, removeBaseTN: fx.atkFxRemoveTN,
        tag: fx.atkFxTag,
        dot: {
          mode: fx.atkFxDotMode, base: fx.atkFxDotBase,
          stat: fx.atkFxDotStat, per: fx.atkFxDotPer
        }
      }
    });

    // État posé sur la cible par les attaques du porteur (« tes lames
    // empoisonnent »). Pesé comme un DOT MAINTENU, pas cumulé : frapper de
    // nouveau rafraîchit la durée au lieu d'empiler un second poison (l'id
    // de l'état est déterministe, voir upsertHitState dans
    // attack-resolve.js), donc la cible encaisse `tick` par tour tant que le
    // buff dure, et non `tick × durée de l'état` à chaque coup. Le compter de
    // la seconde façon triplait n'importe quel poison de 3 tours.
    const atkFx = atk?.effect ?? null;
    if (atkFx && atkFx.dot.mode !== "none") {
      const tick = n(atkFx.dot.base, 0)
                 + (atkFx.dot.stat ? Math.floor(statOf(atkFx.dot.stat) / Math.max(1, n(atkFx.dot.per, 10))) : 0);
      if (tick) {
        // × la chance de toucher : l'état n'est posé que sur une touche.
        const soin = atkFx.dot.mode === "heal";
        add(`${fxLabel} · état posé`,
            `${round1(tick)}${soin ? " soin" : " dég"}/tour · ${dur} tour(s)`,
            (onAlly === soin ? 1 : -1) * tick * dur * affected * DAMAGE_POINT * fxChance * chance);
      }
    }

    if (atk) {
      const parAttaque = diceAverage(atk.dice) + n(atk.flat, 0)
                       + (n(atk.pct, 0) / 100) * n(PARTY.damagePerHit, 7);
      if (parAttaque) {
        // Une portée restreinte à une ou deux catégories d'arme ne vaut pas
        // une portée générale : le porteur doit tenir la bonne arme.
        const couverture = atk.scope === "toutes" ? 1
          : (atk.categories.length ? 0.6 + 0.1 * atk.categories.length : 0.9);
        add(`${fxLabel} · bonus de dégâts`,
            `${round1(parAttaque)} par attaque × ${dur} tour(s)`,
            (onAlly ? 1 : -1) * parAttaque * dur * couverture * affected * DAMAGE_POINT * fxChance);
      }
    }

    // Résistance aux DÉGÂTS accordée (ou vulnérabilité imposée).
    const rdTag = String(fx.resistDamageTag ?? "");
    const rdPct = n(fx.resistDamagePct, 0);
    if (rdTag && rdPct) {
      const w = n(RESIST_WEIGHTS[rdTag], 0.4);
      const sign = (onAlly === (rdPct > 0)) ? 1 : -1;
      add(`${fxLabel} · résist. ${rdTag}`, `${rdPct > 0 ? "+" : ""}${round1(rdPct)} % · ${dur} tour(s)`,
          sign * Math.abs(rdPct) * w * durFactor * affected * fxChance);
    }

    // Résistance aux ÉTATS accordée — le même barème que sur une pièce d'équipement.
    const rtag = String(fx.resistTag ?? "") || String(fx.effectKey ?? "");
    if (rtag) {
      if (fx.resistImmune) {
        add(`${fxLabel} · immunité ${rtag}`, `${dur} tour(s)`,
            (onAlly ? 1 : -1) * STATE_RESIST_WEIGHTS.immune * durFactor * affected * fxChance);
      }
      const rd = n(fx.resistDurationReduction, 0);
      if (rd) {
        add(`${fxLabel} · durée ${rtag}`, `${rd > 0 ? "−" : "+"}${Math.abs(round1(rd))} tour(s)`,
            (onAlly === (rd > 0) ? 1 : -1) * Math.abs(rd) * STATE_RESIST_WEIGHTS.durationReduction * durFactor * affected * fxChance);
      }
      const rp = n(fx.resistDotPct, 0);
      if (rp) {
        add(`${fxLabel} · DOT ${rtag}`, `${rp > 0 ? "−" : "+"}${Math.abs(round1(rp))} %`,
            (onAlly === (rp > 0) ? 1 : -1) * Math.abs(rp) * STATE_RESIST_WEIGHTS.dotReductionPct * durFactor * affected * fxChance);
      }
    }

    if (fx.movementTypeGrant) {
      add(`${fxLabel} · déplacement accordé`, String(fx.movementTypeGrant),
          (onAlly ? 1 : -1) * 3 * durFactor * affected * fxChance);
    }

    if (permanent) {
      warnings.push(
        `« ${label} » est PERMANENT : il ne s'enlève jamais tout seul. Pesé ici sur ${REF_TURNS} tours ` +
        `(le combat de référence), sa vraie valeur est celle d'un bonus d'équipement gratuit — à comparer ` +
        `à la pesée d'une armure, pas à celle d'un sort.`
      );
    }
    if (rawDur > REF_TURNS && !permanent) {
      warnings.push(
        `« ${label} » dure ${rawDur} tours, au-delà du combat de référence (${REF_TURNS}) : ` +
        `pesé sur ${REF_TURNS}, il vaut en réalité davantage dans un combat qui s'éternise.`
      );
    }
  }

  // ── Déplacement du lanceur (charge) ───────────────────────────────────
  // Gratuit : il ne consomme ni le compteur de mouvement ni la place d'action
  // (spell-move.js). Un mètre offert vaut donc plus qu'un mètre de vitesse
  // permanente rapporté au tour, mais beaucoup moins qu'un point de vitesse.
  const moveSelf = Math.max(0, n(sys.moveSelf, 0));
  if (moveSelf > 0) add("Charge (déplacement offert)", `${round1(moveSelf)} m`, moveSelf * 1.5);

  // ── Portée ────────────────────────────────────────────────────────────
  // Idem pour la portée : un passif ne porte nulle part, il est sur soi.
  const portee = isPassif ? 0 : Math.max(0, n(sys.range?.max, 0) - 1.5);
  if (portee > 0) add("Portée", `${round1(n(sys.range?.max, 0))} m`, portee * 0.3);

  // ── Coûts ─────────────────────────────────────────────────────────────
  const manaCost = Math.max(0, n(sys.coutMana, 0));
  const fatigueCost = Math.max(0, n(sys.fatigueCost, 1));
  if (isPassif) {
    // Un passif ne coûte AUCUNE fatigue — il n'est jamais déclaré, donc aucune
    // action n'est consommée. Son mana, lui, est bien prélevé : une fois par
    // combat, au premier tour de son porteur, après la régénération
    // (chargePassifOnFirstTurn, loadout.js). Le compter zéro fois, comme
    // avant, pesait un passif à 3 mana exactement comme un passif gratuit.
    //
    // Il entre donc UNE seule fois dans le total, lequel est ensuite étalé sur
    // REF_TURNS (voir « Disponibilité » plus bas) : le coût se répartit sur le
    // combat exactement comme le bénéfice qu'il paie, ce qui est le bon
    // rapport puisque les deux valent « pour tout le combat ».
    if (manaCost) {
      add("Coût en mana (une fois par combat)", `−${round1(manaCost)}`,
          -manaCost * STAT_WEIGHTS.manaMax);
    }
  } else {
    if (manaCost) add("Coût en mana", `−${round1(manaCost)}`, -manaCost * STAT_WEIGHTS.manaMax);
    if (fatigueCost) add("Coût en fatigue", `−${round1(fatigueCost)}`, -fatigueCost * STAT_WEIGHTS.fatigueMax);
  }

  const perUse = round1(points);

  // ── Disponibilité : ce qu'il rend RÉELLEMENT chaque tour ──────────────
  // Un sort rapide sans recharge occupe deux places du budget (SLOT_DEFS :
  // sortRapide max 2) ; avec une recharge, sa deuxième utilisation serait
  // justement bloquée par elle. Un passif ne prend aucune place et vaut sur
  // toute la durée du combat, d'où l'étalement.
  const usesPerTurn = (speed === "rapide" && cdMax === 0) ? 2 : 1;
  const perTurn = isPassif
    ? points / REF_TURNS
    : (cdMax > 0 ? points / (1 + cdMax) : points * usesPerTurn);

  rows.push({ label: "Vitesse", value: SPEED_LABELS[speed] ?? speed, points: null });
  if (!isPassif) {
    rows.push({
      label: "Seuil de touché (groupe de référence)",
      value: hit.autoSuccess ? "réussite automatique"
           : `${hit.tn}+ · ${Math.round(chance * 100)} % de touche${hit.friendly ? " (cible amie)" : ""}`,
      points: null
    });
  }
  if (cdMax > 0) rows.push({ label: "Recharge", value: `${cdMax} tour(s) → 1 lancement sur ${cdMax + 1}`, points: null });
  if (usesPerTurn > 1) rows.push({ label: "Rapide sans recharge", value: "2 lancements par tour", points: null });

  // Ce qu'un PJ prend réellement dans la figure, en part de ses PV : c'est la
  // ligne que le MJ lit en premier pour savoir s'il vient d'écrire un
  // one-shot.
  if (focusDamage > 0) {
    const pctPv = Math.round((focusDamage / Math.max(1, PARTY.pv)) * 100);
    rows.push({
      label: `Part des PV d'un PJ (${PARTY.pv} PV, niv. ${PARTY.level})`,
      value: `${pctPv} % par utilisation`,
      points: null, warn: pctPv >= 50
    });
    if (pctPv >= 50) {
      warnings.push(
        `Une seule utilisation retire ${pctPv} % des PV d'un personnage de niveau ${PARTY.level}. ` +
        `Deux lancements l'abattent : c'est un sort qui décide du combat à lui seul.`
      );
    }
  }

  if (!lines.length && !(sys.restores ?? []).length && !(sys.effectsUI ?? []).length) {
    warnings.push("Ce sort ne fait rien de mesurable : ni dégâts, ni récupération, ni effet. Vérifie qu'une ligne de dégâts est bien renseignée.");
  }
  if (targets > 1 && rawNormal > 0 && cdMax === 0) {
    warnings.push(
      `${targets} cibles sans aucune recharge : la puissance est multipliée par ${targets} à chaque tour. ` +
      `Un sort de zone se paie normalement par une recharge ou un coût en mana élevé.`
    );
  }
  if (isPassif) {
    warnings.push("Sort PASSIF : il ne consomme aucune place du budget d'action. Sa valeur est comptée comme une capacité permanente, étalée sur le combat de référence.");
  }
  if (!hasCaster && lines.some(d => n(d.perStep, 0))) {
    warnings.push(`Scaling de stat pesé sur une caractéristique de référence (${REF_STAT}, niveau ${level}), faute de porteur : sur un lanceur réel, le sort vaut davantage.`);
  }

  const total = round1(perTurn);
  const tier = SPELL_TIERS.find(t => total <= t.max) ?? SPELL_TIERS[SPELL_TIERS.length - 1];

  // Le repère : ce que pèse une attaque à l'arme ordinaire, par tour. C'est
  // lui qui rend le total lisible — « 40 » ne veut rien dire, « une fois et
  // demie une attaque à l'arme » veut tout dire.
  const weaponRef = round1(landedAgainstParty(PARTY.damagePerHit, PARTY) * PARTY.hitChance * DAMAGE_POINT);

  rows.sort((a, b) => Math.abs(n(b.points, 0)) - Math.abs(n(a.points, 0)));

  return {
    perUse, perTurn: total, total, rows, tier, warnings, hit, weaponRef,
    vsWeapon: weaponRef > 0 ? Math.round((total / weaponRef) * 100) / 100 : null,
    damagePerUse: round1(damagePerUse),
    focusPerUse: round1(focusDamage),
    tickDamagePerUse: round1(tickDamagePerUse),
    healSelfPerUse: round1(healSelf),
    manaCost, fatigueCost, cooldown: cdMax, usesPerTurn, targets,
    speed, isSupport, partyRef: PARTY
  };
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
    reductionPct: Math.min(45, 5 + step * 3),
    // Dextérité / Acuité du groupe : ce contre quoi se calcule le seuil de
    // touché d'un monstre (computeTN compare les principales, r = (100+atk)/
    // (100+def)). Sans elles, la pesée supposait 50 % de touche pour TOUT
    // monstre — une créature bâtie sur l'Acuité et une créature bâtie sur les
    // PV frappaient donc aussi souvent l'une que l'autre, et son toucher inné
    // (base.toucherPhysique / toucherMagique, tiré par la génération) ne
    // servait à rien. Rien dans les règles ne fait monter les principales
    // automatiquement : cette progression est une hypothèse de table, comme
    // le reste de cette référence.
    dexterite: 5 + step * 2,
    acuite: 5 + step * 2,
    // Vitesse du groupe : la vitesse de base d'un personnage (base-speed.js).
    // Rien ne la fait monter avec le niveau — un mètre de plus se gagne par
    // l'équipement, pas par l'expérience. Elle sert à dire si un monstre peut
    // rattraper le groupe, ce qui n'a de sens que comparé à sa vraie valeur :
    // le seuil était écrit en dur (« plus rapide qu'un PJ de départ (3 m) »)
    // et serait devenu faux le jour où la base bouge — c'est arrivé.
    vitesse: BASE_VITESSE
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

/**
 * Nombre de capacités qu'un monstre peut sortir dans un tour.
 *
 * Défaut 2, qui n'est pas un chiffre arbitraire : c'est `slotsTotal.max` du
 * budget d'action (rules/action-budget.js). Réglable en monde pour les
 * créatures épiques jouées seules contre tout le groupe.
 *
 * ⚠️ Ce réglage ne change QUE la pesée — c'est une hypothèse de calcul, pas
 * une règle. Le budget réel reste à 2 slots pour tout le monde en jeu.
 */
function monsterActionSlots() {
  try {
    return Math.max(1, Math.min(6, n(game.settings.get("rpg", "peseeActionsMonstre"), 2)));
  } catch (e) {
    return 2;   // hors Foundry, ou réglage pas encore enregistré
  }
}


/**
 * Profil chiffré d'un monstre — la SEULE forme que lit la pesée.
 *
 * Elle existe parce que les stats d'un monstre vivent à deux endroits
 * différents, et que celui qu'on lit d'ordinaire est le mauvais :
 *
 *   - Sur un TOKEN posé (acteur synthétique), les stats sont les vraies :
 *     tirées par la génération au moment où le token a été créé.
 *   - Sur la FICHE D'ORIGINE, elles ne le sont pas. Un monstre dont tout le
 *     dossier est écrit dans `system.gen.bands` garde sur sa fiche les
 *     valeurs d'avant la génération — souvent zéro partout. Peser cette
 *     fiche-là revient à peser une créature qui n'existera jamais.
 *
 * D'où `monsterProfileFromBand()` : sur la fiche d'origine, la pesée doit se
 * faire sur les PLAGES de génération, niveau par niveau (voir
 * computeMonsterBandValues).
 *
 * Les valeurs DÉRIVÉES priment quand elles existent (`derived.effective.*`,
 * `derived.resistancesElem`, `derived.toucher*`) : ce sont elles que subit
 * réellement un attaquant, états actifs compris.
 */
export function monsterProfileFromActor(actor) {
  const sys = actor?.system ?? {};
  const eff = sys.derived?.effective ?? {};
  const P = eff.principales ?? sys.principales ?? {};
  const D = eff.defenses ?? sys.defenses ?? {};
  return {
    label: actor?.name ?? "Monstre",
    niveau: Math.max(1, n(sys.niveau, 1)),
    pv: Math.max(1, n(sys.ressources?.pv?.max, n(sys.base?.pvMax, 1))),
    regenPv: n(sys.regeneration?.pv, 0),
    vitesse: n(sys.deplacement?.vitesse, 0),
    fatigueMax: Math.max(1, n(sys.ressources?.fatigue?.max, n(sys.base?.fatigueMax, 10))),
    manaMax: n(sys.ressources?.mana?.max, 0),
    allonge: n(sys.allonge, 1),
    principales: {
      force: n(P.force, 0), intelligence: n(P.intelligence, 0),
      dexterite: n(P.dexterite, 0), acuite: n(P.acuite, 0), endurance: n(P.endurance, 0)
    },
    defenses: {
      armureFixe: n(D.armureFixe, 0), resistanceFixe: n(D.resistanceFixe, 0),
      // `derived.effective.defenses` contient DÉJÀ le score rendu par
      // l'Endurance (actor.js, SCORE_PER_END_STEP). Ne pas le rajouter ici :
      // c'est le drapeau `endInScores` qui dit lequel des deux cas on lit.
      scoreArmure: n(D.scoreArmure, 0), scoreResistance: n(D.scoreResistance, 0)
    },
    endInScores: !!eff.defenses,
    toucherPhysique: n(sys.derived?.toucherPhysique, n(sys.base?.toucherPhysique, 0)),
    toucherMagique: n(sys.derived?.toucherMagique, n(sys.base?.toucherMagique, 0)),
    resistancesElem: sys.derived?.resistancesElem ?? sys.resistancesElem ?? {}
  };
}

/** Milieu d'une plage `[min, max]` de la génération. */
function bandMid(range, fallback = 0) {
  if (!Array.isArray(range) || !range.length) return fallback;
  const a = n(range[0], fallback), b = n(range[1], a);
  return (a + b) / 2;
}
/** Extrémité d'une plage : "min", "max" ou "mid". */
function bandPick(range, which, fallback = 0) {
  if (!Array.isArray(range) || !range.length) return fallback;
  const a = n(range[0], fallback), b = n(range[1], a);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return which === "min" ? lo : which === "max" ? hi : (lo + hi) / 2;
}

/**
 * Profil tiré d'un band de génération (`system.gen.bands[<niveau>]`), sans
 * qu'aucun tirage n'ait eu lieu. `which` choisit le bas, le haut ou le milieu
 * de chaque plage : le milieu donne la créature typique, les deux extrêmes
 * donnent la fourchette dans laquelle tomberont les tokens réellement posés.
 */
export function monsterProfileFromBand(band, lvl, which = "mid", label = "Monstre") {
  const s = band?.stats ?? {};
  const d = band?.defenses ?? {};
  const pick = (r, fb = 0) => bandPick(r, which, fb);
  const endurance = Math.max(0, pick(s.endurance));
  const pvBase = Math.max(1, pick(band?.pv, 30));
  return {
    label,
    niveau: Math.max(1, n(lvl, 1)),
    // Miroir de monster-gen.js : les PV posés valent la plage + 1 PV par
    // tranche de 5 d'Endurance.
    pv: Math.max(1, Math.round(pvBase + Math.floor(endurance / 5))),
    regenPv: Math.max(0, pick(band?.regenPv)),
    vitesse: Math.max(0, pick(band?.vitesse, 3)),
    fatigueMax: Math.max(1, pick(band?.fatigueMax, 10)),
    manaMax: 0,
    // L'allonge n'est pas tirée par la génération : elle reste celle de la
    // fiche, et c'est l'appelant qui la fournit.
    allonge: n(band?.allonge, 1),
    principales: {
      force: Math.max(0, pick(s.force)), intelligence: Math.max(0, pick(s.intelligence)),
      dexterite: Math.max(0, pick(s.dexterite)), acuite: Math.max(0, pick(s.acuite)),
      endurance
    },
    defenses: {
      armureFixe: Math.max(0, pick(d.armureFixe)), resistanceFixe: Math.max(0, pick(d.resistanceFixe)),
      scoreArmure: Math.max(0, pick(d.scoreArmure)), scoreResistance: Math.max(0, pick(d.scoreResistance))
    },
    // Un band écrit les scores AVANT l'apport de l'Endurance : il faut donc
    // l'ajouter, contrairement à un profil lu sur `derived.effective`.
    endInScores: false,
    toucherPhysique: pick(band?.toucherPhysique),
    toucherMagique: pick(band?.toucherMagique),
    resistancesElem: Object.fromEntries(
      Object.entries(band?.resistancesElem ?? {}).map(([k, r]) => [k, bandMid(r, 0)])
    ),
    xpReward: Math.max(0, pick(band?.xpReward))
  };
}

/** Réduction en % rendue par un score de défense (miroir de actor.js). */
function scorePct(score) {
  const S = Math.max(0, n(score, 0));
  return Math.min(70, (S / (S + 160)) * 100);
}

/**
 * Ce qu'une capacité de monstre vaut, par utilisation.
 *
 * Tout passe par computeSpellValue : c'est la MÊME pesée que celle affichée
 * sur la fiche du sort, avec les stats du monstre comme lanceur. Un monstre
 * n'a pas d'armes dans ce système — ses attaques SONT ses items `spell` — et
 * une capacité qui soigne, qui pose une brûlure ou qui affaiblit le groupe
 * pèse autant qu'une qui frappe. L'ancienne version ne lisait que les lignes
 * de dégâts directs : une créature bâtie sur les DOT ou sur ses propres soins
 * était comptée pour zéro et sortait « Trivial ».
 */
function evaluateMonsterAbility(sp, profile, PARTY) {
  const s = sp?.system ?? {};
  // Le seuil de touché d'un monstre dépend de SES stats ET de son toucher
  // inné — les deux tirés par la génération. Les passer ici, plutôt que de
  // laisser computeSpellValue lire un acteur qui n'existe pas quand on pèse
  // un band, est ce qui remplace le 50 % forfaitaire d'avant.
  const value = computeSpellValue(sp, {
    stats: profile.principales,
    level: profile.niveau,
    party: PARTY,
    toucherPhysique: profile.toucherPhysique,
    toucherMagique: profile.toucherMagique
  });
  const cdMax = Math.max(0, n(s.cooldown?.max, 0));
  const targets = Math.max(1, n(s.targetCount?.max, 1));

  return {
    name: sp?.name ?? "Capacité",
    speed: String(s.speed ?? "normal"),
    cdMax, targets,
    // Un sort rapide sans recharge occupe deux places (SLOT_DEFS).
    uses: (String(s.speed ?? "normal") === "rapide" && cdMax === 0) ? 2 : 1,
    manaCost: value.manaCost,
    fatigueCost: value.fatigueCost,
    hit: value.hit,
    // Dégâts réellement encaissés par le groupe : directs + effets par tour.
    damage: value.damagePerUse + value.tickDamagePerUse,
    focus: value.focusPerUse + value.tickDamagePerUse / targets,
    healSelf: value.healSelfPerUse,
    points: value.perUse,
    value,
    readyAt: 0, turnsUsed: 0, totalUses: 0
  };
}

/**
 * Pèse un monstre : menace, durée de vie, et poids de rencontre.
 *
 * @param {Actor|object} actor
 * @param {object} opts
 * @param {object} opts.profile  Profil chiffré à peser à la place des stats de
 *                               la fiche (voir monsterProfileFromBand).
 * @param {Array}  opts.spells   Capacités à peser (défaut : les items `spell`).
 * @returns {{threat:number, survival:number|null, encounter:number|null, tier:object,
 *            rows:Array, warnings:Array, partyRef:object, profile:object}}
 */
export function computeMonsterValue(actor, opts = {}) {
  const profile = opts.profile ?? monsterProfileFromActor(actor);
  const rows = [];
  const warnings = [];
  const PARTY = partyRefFor(profile.niveau);

  // ── Durée de vie : PV effectifs face aux dégâts du groupe ──────────────
  const pv = Math.max(1, n(profile.pv, 1));
  // L'Endurance rend du score de défense (actor.js, 3 END = +1). Sur un profil
  // lu depuis `derived.effective`, c'est déjà compris : l'ajouter deux fois
  // gonflerait la survie de tout monstre endurant.
  const endBonus = profile.endInScores ? 0 : Math.floor(n(profile.principales.endurance, 0) / 3);

  // Un groupe frappe des DEUX livraisons : les armes en physique, les sorts en
  // magique. Ne tester que l'armure surestimait la survie d'un monstre bien
  // blindé mais peu résistant à la magie — et l'inverse pour un élémentaire.
  // On moyenne donc les deux étages de mitigation, l'un et l'autre complets
  // (fixe + score + résistance élémentaire de la livraison).
  const mitigate = (fixe, score, elemPct) => {
    const afterFixe = Math.max(1, Math.ceil((PARTY.damagePerHit - n(fixe, 0)) * (1 - scorePct(score) / 100)));
    return Math.max(1, afterFixe * (1 - Math.min(99, n(elemPct, 0)) / 100));
  };
  const hitPhys = mitigate(profile.defenses.armureFixe, n(profile.defenses.scoreArmure, 0) + endBonus,
                           profile.resistancesElem?.physique);
  const hitMag  = mitigate(profile.defenses.resistanceFixe, n(profile.defenses.scoreResistance, 0) + endBonus,
                           profile.resistancesElem?.magique);
  const perHit = (hitPhys + hitMag) / 2;

  const partyDps = PARTY.size * PARTY.hitChance * perHit;
  const regen = n(profile.regenPv, 0);

  // ── Menace : ce qu'il peut réellement sortir en UN tour ────────────────
  // Un monstre n'utilise pas son meilleur sort, il utilise les N meilleurs
  // qu'il peut caser dans son budget d'action — et un bestiaire à vingt
  // capacités ne frappe pas dix fois plus fort qu'un autre à deux. N vient du
  // budget réel (action-budget.js : slotsTotal.max = 2), réglable en monde
  // pour les créatures épiques jouées seules face au groupe.
  const spells = opts.spells ?? (actor?.items ? Array.from(actor.items).filter(i => i.type === "spell") : []);
  const slots = monsterActionSlots();

  const abilities = [];
  const passives = [];
  for (const sp of spells) {
    const s = sp?.system ?? {};
    const ev = evaluateMonsterAbility(sp, profile, PARTY);
    // Un passif n'est pas une action : il ne prend aucune place dans le tour,
    // mais il n'est pas gratuit pour autant — il est compté à part.
    if (String(s.speed ?? "normal") === "passif") { passives.push(ev); continue; }
    // Une capacité qui ne fait rien de mesurable n'occupe pas de place : elle
    // serait sinon jouée à la place d'une vraie attaque.
    if (ev.points <= 0 && ev.damage <= 0 && ev.healSelf <= 0) continue;
    abilities.push(ev);
  }

  // Simulation sur SIM_TURNS tours : à chaque tour la créature remplit ses
  // places avec les meilleures capacités DISPONIBLES, puis met les recharges
  // à jour. La moyenne sur le cycle est sa menace par tour.
  //
  // C'est ce qui distingue ce modèle de « la somme des N meilleures valeurs
  // déjà divisées par leur recharge » : cette somme-là laisse une place VIDE
  // les tours où la grosse capacité recharge, alors qu'en vrai la créature
  // enchaîne avec la suivante. Mesuré sur le même bestiaire, l'écart était de
  // ~25 % — systématiquement à la baisse, donc un monstre sous-évalué.
  //
  // 12 tours parce que c'est divisible par 1, 2, 3, 4 et 6 : les cycles de
  // recharge courants retombent juste, sans reste qui fausserait la moyenne.
  const SIM_TURNS = 12;
  let total = 0;
  // Ce que reçoit UNE cible, pour « tours pour abattre un PJ » : les dégâts
  // d'une capacité de zone se répartissent, ils ne s'empilent pas sur le même
  // personnage.
  let focusTotal = 0;
  let healTotal = 0;
  let manaTotal = 0;
  let fatigueTotal = 0;
  for (let t = 0; t < SIM_TURNS; t++) {
    // Le tri se fait sur la VALEUR de la capacité (dégâts, effets, soins),
    // pas sur ses seuls dégâts : un monstre qui se soigne à mi-combat joue
    // bien son soin, et cette place-là n'est plus disponible pour frapper.
    const avail = abilities
      .filter(a => a.readyAt <= t)
      .sort((a, b) => b.points - a.points);

    let slotsLeft = slots;
    for (const a of avail) {
      if (slotsLeft <= 0) break;
      const times = Math.min(a.uses, slotsLeft);
      total += a.damage * times;
      focusTotal += a.focus * times;
      healTotal += a.healSelf * times;
      manaTotal += a.manaCost * times;
      fatigueTotal += a.fatigueCost * times;
      slotsLeft -= times;
      a.turnsUsed += 1;
      a.totalUses += times;
      if (a.cdMax > 0) a.readyAt = t + 1 + a.cdMax;
    }
  }
  // Les passifs sont toujours actifs : leurs dégâts (aura brûlante, riposte…)
  // s'ajoutent sans occuper de place. Ils s'ajoutent APRÈS la moyenne du
  // cycle, pas dedans : ce sont déjà des valeurs étalées sur le combat de
  // référence, les diviser une seconde fois par les 12 tours de simulation
  // les réduirait à rien.
  let passiveDamage = 0, passiveFocus = 0, passiveHeal = 0;
  for (const p of passives) {
    passiveDamage += p.damage / REF_TURNS;
    passiveFocus += p.focus / REF_TURNS;
    passiveHeal += p.healSelf / REF_TURNS;
  }
  const threat = Math.round((total / SIM_TURNS + passiveDamage) * 10) / 10;
  const healPerTurn = healTotal / SIM_TURNS + passiveHeal;
  const manaPerTurn = manaTotal / SIM_TURNS;
  const fatiguePerTurn = fatigueTotal / SIM_TURNS;

  // ── Durée de vie, soins compris ───────────────────────────────────────
  // Un monstre qui se soigne se bat plus longtemps, exactement comme un
  // monstre qui régénère. Les deux étaient traités différemment : la régén
  // comptait, le sort de soin ne comptait pas du tout.
  const sustain = regen + healPerTurn;

  // Régén ≥ dégâts du groupe : il ne meurt pas, point. On ne prolonge SURTOUT
  // pas la division avec un plancher arbitraire — elle produirait un « 1100
  // tours » d'apparence chiffrée qui masquerait l'unique information qui
  // compte : le combat n'a pas de fin.
  const invincible = sustain >= partyDps;
  const survival = invincible ? Infinity : Math.round((pv / (partyDps - sustain)) * 10) / 10;

  rows.push({ label: "PV", value: String(Math.round(pv)), points: null });
  rows.push({ label: "Dégâts encaissés par coup", value: `${Math.round(perHit * 10) / 10}`, points: null });
  if (regen) rows.push({ label: "Régén PV / tour", value: `+${round1(regen)}`, points: null });
  if (healPerTurn > 0) rows.push({ label: "Soins qu'il se rend / tour", value: `+${round1(healPerTurn)}`, points: null });
  rows.push({
    label: `Tours de survie (groupe de ${PARTY.size}, niv. ${PARTY.level})`,
    value: invincible ? "∞" : `${survival}`,
    points: null
  });

  if (invincible) {
    warnings.push(
      `Il se remet ${round1(sustain)} PV/tour (régén${healPerTurn > 0 ? " + ses propres soins" : ""}) contre ` +
      `${Math.round(partyDps * 10) / 10} infligés par le groupe : il se soigne au moins aussi vite qu'il ` +
      `encaisse. Le combat est ININGAGNABLE au corps à corps — il lui faut une parade explicite (dégâts ` +
      `élémentaires auxquels il est vulnérable, effet qui suspend la régénération…), ou moins de soins.`
    );
  }

  // ── Détail des capacités ──────────────────────────────────────────────
  for (const a of abilities.slice().sort((x, y) => y.totalUses - x.totalUses || y.points - x.points)) {
    const parts = [`${Math.round(a.hit.chance * 100)} % de touche`];
    if (a.damage > 0) parts.push(`${round1(a.damage)} dégâts`);
    if (a.healSelf > 0) parts.push(`${round1(a.healSelf)} soin`);
    if (a.cdMax > 0) parts.push(`recharge ${a.cdMax}`);
    if (a.targets > 1) parts.push(`${a.targets} cibles`);
    if (a.uses > 1) parts.push("rapide ×2");
    parts.push(a.turnsUsed ? `joué ${a.turnsUsed}/${SIM_TURNS} tours` : "jamais joué : trop faible");
    rows.push({
      label: `${a.turnsUsed ? "⚔" : "▫"} ${a.name}`,
      value: parts.join(" · "),
      // Colonne « dégâts/tour » : vide pour une capacité qui n'en fait pas
      // (un soin, un buff), plutôt qu'un « 0 » qu'on lirait comme une erreur.
      points: (a.totalUses && a.damage > 0) ? round1(a.damage * a.totalUses / SIM_TURNS) : null
    });
  }
  for (const p of passives) {
    rows.push({
      label: `♾️ ${p.name} (passif)`,
      value: `aucune place d'action${p.damage > 0 ? ` · ${round1(p.damage / REF_TURNS)} dégâts/tour` : ""}`,
      points: p.damage > 0 ? round1(p.damage / REF_TURNS) : null
    });
  }

  if (!spells.length) {
    warnings.push("Aucun sort sur ce monstre : il n'a aucune attaque. Dans ce système, les attaques d'un monstre SONT ses items `spell`.");
  } else if (threat <= 0 && healPerTurn <= 0) {
    warnings.push("Aucune de ses capacités n'inflige de dégâts — vérifie que la ligne de dégâts (dés) est bien renseignée.");
  }

  const jamais = abilities.filter(a => !a.turnsUsed).length;
  if (jamais > 0) {
    warnings.push(
      `${jamais} capacité(s) ne sortent jamais : ses ${slots} places par tour sont toujours prises par de ` +
      `meilleures. Elles n'ajoutent aucune puissance — c'est de la variété, pas de la menace. Empiler des ` +
      `sorts sur un monstre ne le renforce qu'à partir du moment où ils battent ceux déjà retenus.`
    );
  }

  // ── Ce qui limite le monstre en dehors des PV ─────────────────────────
  // Fatigue : chaque capacité en coûte, et au-delà du maximum la créature est
  // ÉPUISÉE (−1 toucher, −1 vitesse — actor.js). Un monstre à 10 de fatigue
  // qui dépense 2 par tour ne tient que 5 tours à plein régime, ce qui ne se
  // voyait nulle part.
  if (fatiguePerTurn > 0) {
    const turnsBeforeExhaustion = profile.fatigueMax / fatiguePerTurn;
    rows.push({
      label: "Fatigue dépensée / tour",
      value: `${round1(fatiguePerTurn)} sur ${round1(profile.fatigueMax)} → épuisé au tour ${Math.floor(turnsBeforeExhaustion)}`,
      points: null,
      warn: Number.isFinite(survival) && turnsBeforeExhaustion < survival
    });
    if (Number.isFinite(survival) && turnsBeforeExhaustion < survival) {
      warnings.push(
        `Il s'épuise au bout de ${Math.floor(turnsBeforeExhaustion)} tours (fatigue max ${round1(profile.fatigueMax)}, ` +
        `${round1(fatiguePerTurn)} dépensés par tour) alors qu'il lui en faut ${survival} pour tomber : ` +
        `la fin du combat se jouera avec un monstre épuisé (−1 toucher, −1 vitesse). Monte sa fatigue max ` +
        `ou baisse le coût de ses capacités.`
      );
    }
  }
  // Mana : une capacité qui coûte du mana à un monstre qui n'en a pas ne
  // partira jamais. Rien ne le signalait.
  if (manaPerTurn > 0 && profile.manaMax <= 0) {
    warnings.push(
      `Ses capacités coûtent du mana (${round1(manaPerTurn)}/tour) mais il n'a aucun mana maximum : ` +
      `à la table, elles seront refusées ou joueront à découvert.`
    );
  }

  // ── Stats qui ne pèsent pas dans le score mais changent le combat ─────
  const vitesse = n(profile.vitesse, 0);
  const vitesseGroupe = n(PARTY.vitesse, BASE_VITESSE);
  const tropRapide = vitesse > vitesseGroupe;
  rows.push({ label: "Vitesse", value: `${round1(vitesse)} m`, points: null, warn: tropRapide });
  if (tropRapide) {
    warnings.push(`Vitesse ${round1(vitesse)} m : plus rapide qu'un PJ (${round1(vitesseGroupe)} m). Le groupe ne pourra ni décrocher ni le distancer.`);
  }
  rows.push({
    label: "Toucher inné (physique / magique)",
    value: `${profile.toucherPhysique > 0 ? "+" : ""}${round1(profile.toucherPhysique)} / ${profile.toucherMagique > 0 ? "+" : ""}${round1(profile.toucherMagique)}`,
    points: null
  });
  rows.push({
    label: "Dex / Acuité (seuil de touché)",
    value: `${round1(profile.principales.dexterite)} / ${round1(profile.principales.acuite)} contre ${PARTY.dexterite} / ${PARTY.acuite} au groupe`,
    points: null
  });
  // L'allonge décide de sa zone de menace : à 0, il ne déclenche aucune
  // attaque d'opportunité et le groupe se désengage librement.
  const allonge = n(profile.allonge, 1);
  rows.push({ label: "Allonge (zone de menace)", value: `${round1(allonge)} m`, points: null, warn: allonge <= 0 });
  if (allonge <= 0) {
    warnings.push("Allonge à 0 : il ne menace personne. Le groupe pourra le contourner et se désengager sans jamais subir d'attaque d'opportunité.");
  }

  // Résistances élémentaires notables : elles ne changent pas la survie
  // calculée (le groupe frappe en physique/magique) mais décident si un
  // lanceur de sorts sert à quelque chose dans ce combat.
  const notable = Object.entries(profile.resistancesElem ?? {})
    .filter(([k, v]) => n(v, 0) !== 0 && k !== "physique" && k !== "magique")
    .map(([k, v]) => `${k} ${n(v, 0) > 0 ? "+" : ""}${round1(n(v, 0))} %`);
  if (notable.length) {
    rows.push({ label: "Résistances élémentaires", value: notable.join(" · "), points: null });
  }
  for (const [k, v] of Object.entries(profile.resistancesElem ?? {})) {
    if (n(v, 0) >= 100) {
      warnings.push(`Immunité totale à « ${k} » (100 %) : tout dégât de ce type est annulé, sans plancher. Vérifie que le groupe a autre chose sous la main.`);
    }
  }

  // Tours qu'il faut à ce monstre pour abattre UN personnage — calculé sur
  // les dégâts que reçoit UNE cible, pas sur le total encaissé par le groupe.
  // Les deux se confondaient jusqu'ici, et l'écart n'est pas anecdotique :
  // une capacité à 3 cibles compte trois fois dans la menace (c'est correct,
  // le groupe prend bien tout ça) mais chaque PJ n'en reçoit qu'un tiers. Un
  // monstre à dégâts de zone paraissait donc capable d'abattre un PJ trois
  // fois plus vite qu'il ne le peut réellement.
  const focus = focusTotal / SIM_TURNS + passiveFocus;
  const toKill = focus > 0 ? Math.round((PARTY.pv / focus) * 10) / 10 : Infinity;
  rows.push({ label: "Menace (dégâts / tour, groupe entier)", value: `${threat}`, points: null });
  rows.push({
    label: "Tours pour abattre un PJ (s'il concentre)",
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

  if (Number.isFinite(survival) && survival > 12) {
    warnings.push(`${survival} tours pour le tuer : c'est très long. Au-delà d'une dizaine de tours, un combat lasse avant d'être dangereux.`);
  }

  return {
    threat,
    survival: Number.isFinite(survival) ? survival : null,
    survivalText: Number.isFinite(survival) ? String(survival) : "∞",
    encounter: Number.isFinite(encounter) ? encounter : null,
    encounterText: Number.isFinite(encounter) ? String(encounter) : "∞",
    tier, rows, warnings, partyRef: PARTY, profile,
    healPerTurn: round1(healPerTurn),
    focusPerTurn: round1(focus)
  };
}

/**
 * Pèse un monstre NIVEAU PAR NIVEAU, sur ses plages de génération.
 *
 * C'est la pesée qui compte sur la fiche d'origine. Les stats affichées là ne
 * sont pas celles que la table affrontera : `randomizeMonster` les tire dans
 * `system.gen.bands[<niveau>]` au moment où le token est posé, et la fiche
 * garde ses valeurs d'avant (souvent des zéros). Peser cette fiche revenait
 * donc à peser une créature qui n'existe pas — « Trivial » pour un monstre
 * dont les plages annoncent un boss.
 *
 * Pour chaque niveau configuré on rend la créature MOYENNE (milieu de chaque
 * plage) et la fourchette de poids de rencontre entre le plus faible et le
 * plus fort tirage possible. Les capacités, elles, sont les mêmes à tous les
 * niveaux : ce sont les items du monstre.
 *
 * @returns {Array<{lvl:number, value:object, min:string, max:string}>}
 */
export function computeMonsterBandValues(actor) {
  const bands = actor?.system?.gen?.bands ?? {};
  const spells = actor?.items ? Array.from(actor.items).filter(i => i.type === "spell") : [];
  const levels = Object.keys(bands)
    .map(k => parseInt(k, 10))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const out = [];
  for (const lvl of levels) {
    const band = bands[String(lvl)];
    if (!band) continue;
    const mk = (which) => computeMonsterValue(actor, {
      profile: {
        ...monsterProfileFromBand(band, lvl, which, actor?.name),
        // L'allonge et le mana ne sont pas tirés par la génération : ils
        // restent ceux de la fiche, quel que soit le niveau.
        allonge: n(actor?.system?.allonge, 1),
        manaMax: n(actor?.system?.ressources?.mana?.max, 0)
      },
      spells
    });
    const value = mk("mid");
    const lo = mk("min");
    const hi = mk("max");
    out.push({
      lvl,
      value,
      minText: lo.encounterText,
      maxText: hi.encounterText,
      spread: lo.encounterText !== hi.encounterText
    });
  }
  return out;
}
