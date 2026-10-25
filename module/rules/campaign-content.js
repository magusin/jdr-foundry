// module/rules/campaign-content.js
//
// « Les Marches de Cendrebrume » — un cadre de campagne prêt à jouer :
// bestiaire, PNJ, quêtes (une trame principale en cinq actes + des quêtes
// secondaires), objets de récompense, matériaux de butin et un journal MJ.
//
// Rien ici n'est un compendium, et c'est voulu : les packs compilés de ce
// système ont déjà servi des entrées fantômes sur la machine du MJ (voir
// CLAUDE.md, « Repo layout notes ») et ont fini vidés. L'installateur crée des
// documents du MONDE, dans des dossiers à eux, comme l'installateur de macros
// d'init.js — et il est idempotent : chaque document porte
// `flags.rpg.contentKey`, et une seconde installation ne recrée que ce qui
// manque (un document renommé ou modifié par le MJ n'est jamais écrasé).
//
// LES CHIFFRES DES MONSTRES NE SONT PAS ÉCRITS ICI. Chaque entrée du
// bestiaire ne nomme que son archétype (le rôle : soldat, brute, élite…), son
// thème (ce qu'elle est : mort-vivant, feu…) et ses niveaux ; les plages de
// génération et les capacités sont calculées à l'installation par
// monster-archetypes.js + monster-themes.js, exactement comme le bouton ⚡ de
// la fiche. C'est ce qui garantit la cohérence demandée : un « Loup des
// brumes » et un « Brigand » de même archétype et de même niveau tiennent le
// même nombre de tours et frappent aussi fort, et tout le bestiaire suit les
// réglages de pesée du monde (taille du groupe, dégâts par attaque).
//
// Les plages de niveaux sont volontairement ÉTROITES (trois niveaux au plus).
// Les dégâts d'une capacité suivent le niveau tiré par l'exemplaire à travers
// son scaling de stat (`themedAbilitiesForLevels`), mais ses PV et ses dés de
// base décrivent une créature : sur trois niveaux, c'est la même ; sur huit,
// ce n'en est plus une. Une créature qui doit exister sur toute la campagne a
// deux entrées (« Squelette veilleur » / « Squelette de la crypte »).

import { buildBand, getArchetype } from "./monster-archetypes.js";
import { applyThemeToBand, themedAbilitiesForLevels, themedAbilityItemData, getTheme } from "./monster-themes.js";

export const CONTENT_VERSION = 1;
export const SETTING_NAME = "Les Marches de Cendrebrume";
export const MAIN_ARC = "La Couronne de Cendre";
export const SIDE_ARC = "Chroniques de Halte-Grise";

const ICON = {
  rat: "icons/svg/mystery-man.svg", beast: "icons/svg/blood.svg", human: "icons/svg/sword.svg",
  undead: "icons/svg/skull.svg", ghost: "icons/svg/terror.svg", fire: "icons/svg/fire.svg",
  ice: "icons/svg/frozen.svg", storm: "icons/svg/lightning.svg", stone: "icons/svg/statue.svg",
  venom: "icons/svg/poison.svg", shadow: "icons/svg/eye.svg", water: "icons/svg/acid.svg",
  wing: "icons/svg/wing.svg", cowl: "icons/svg/cowled.svg", npc: "icons/svg/mystery-man.svg",
  bag: "icons/svg/item-bag.svg", quest: "icons/svg/book.svg", aura: "icons/svg/aura.svg"
};

// ═══════════════════════════════════════════════════════════════════════════
// Matériaux de butin (loot) — prix en cuivre, empilables
// ═══════════════════════════════════════════════════════════════════════════
export const LOOT = [
  { key: "croc",        name: "Croc de loup",          img: ICON.beast, prix: { cuivre: 8 },  poids: 0.1, desc: "Recherché par les tanneurs et les faiseurs d'amulettes." },
  { key: "peau",        name: "Peau de loup gris",     img: ICON.beast, prix: { argent: 1 },  poids: 1,   desc: "Épaisse, imprégnée d'une humidité qui ne sèche jamais tout à fait." },
  { key: "queue-rat",   name: "Queue de rat",          img: ICON.rat,   prix: { cuivre: 1 },  poids: 0.05, desc: "La mairie de Halte-Grise en rachète cinq pour un cuivre." },
  { key: "pieces",      name: "Pièces rognées",        img: ICON.bag,   prix: { cuivre: 5 },  poids: 0.05, desc: "Monnaie de brigand, limée sur les bords. Les marchands la prennent à moitié prix." },
  { key: "os",          name: "Os blanchi",            img: ICON.undead,prix: { cuivre: 3 },  poids: 0.3, desc: "Gravé d'un œil fermé : le sigle des Veilleurs Gris." },
  { key: "brume",       name: "Essence de brume",      img: ICON.aura,  prix: { argent: 2 },  poids: 0.1, desc: "Une fiole de brouillard qui refuse de se dissiper. Froide au toucher." },
  { key: "venin",       name: "Glande à venin",        img: ICON.venom, prix: { argent: 1, cuivre: 5 }, poids: 0.1, desc: "Base de poisons — et de leurs antidotes." },
  { key: "roc",         name: "Éclat de roc animé",    img: ICON.stone, prix: { argent: 3 },  poids: 1,   desc: "Il vibre encore faiblement. Les forgerons de Rochefer s'en servent pour tremper l'acier." },
  { key: "braise",      name: "Braise vivante",        img: ICON.fire,  prix: { argent: 4 },  poids: 0.2, desc: "Brûle sans combustible pendant des semaines dans un pot de terre cuite." },
  { key: "ecto",        name: "Ectoplasme",            img: ICON.ghost, prix: { argent: 3 },  poids: 0.1, desc: "Substance laissée par un esprit dissipé. Les prêtres la paient bien, pour la détruire." },
  { key: "plume",       name: "Plume d'orage",         img: ICON.wing,  prix: { argent: 2 },  poids: 0.05, desc: "Crépite quand on la frotte. Empenne des flèches qui ne dévient pas au vent." },
  { key: "givre",       name: "Cœur de givre",         img: ICON.ice,   prix: { argent: 6 },  poids: 0.5, desc: "Un cristal qui ne fond pas, même jeté au feu." },
  { key: "fragment-eau",    name: "Fragment du Sceau d'Eau",    img: ICON.water,  prix: {}, poids: 0.5, desc: "Un tiers de la Couronne de Cendre. Toujours humide, toujours froid." },
  { key: "fragment-pierre", name: "Fragment du Sceau de Pierre", img: ICON.stone,  prix: {}, poids: 0.5, desc: "Un tiers de la Couronne de Cendre. Plus lourd qu'il ne devrait." },
  { key: "fragment-ombre",  name: "Fragment du Sceau d'Ombre",   img: ICON.shadow, prix: {}, poids: 0.5, desc: "Un tiers de la Couronne de Cendre. On ne le voit bien que du coin de l'œil." }
];

// ═══════════════════════════════════════════════════════════════════════════
// Objets de récompense — pesés (rules/item-value.js) au palier annoncé
// ═══════════════════════════════════════════════════════════════════════════
const ZERO_BONUS = {
  force: 0, intelligence: 0, dexterite: 0, acuite: 0, endurance: 0, pvMax: 0, manaMax: 0,
  fatigueMax: 0, vitesse: 0, initiativeMod: 0, podsMax: 0, armureFixe: 0, resistanceFixe: 0,
  scoreArmure: 0, scoreResistance: 0, regenPv: 0, regenMana: 0, retraitMod: 0,
  toucherPhysique: 0, toucherMagique: 0
};
const bonus = (b = {}) => ({ ...ZERO_BONUS, ...b });

export const REWARDS = [
  {
    key: "potion-soin", name: "Potion de soin", type: "consumable", img: "icons/svg/regen.svg",
    system: { poids: 0.2, prix: { argent: 5 }, effet: "Rend 2d6 + 2 PV (une action de récupération).",
      description: "Une fiole rouge au goût de rouille, préparée par Frère Anselme." },
    tierNote: "consommable"
  },
  {
    key: "epee-sergent", name: "Épée de la Garde grise", type: "weapon", img: ICON.human,
    system: { emplacement: "mainDroite", categorie: "melee", poids: 1.5, prix: { argent: 30 },
      allonge: 1, range: { min: 0, max: 1, efficace: 0, tranche: 5 },
      damage: { dice: "1d8", flat: 1, scaling: { stat: "force", per: 10, perStep: 1 } },
      description: "<p>L'épée réglementaire de la garde de Halte-Grise. Sobre, bien équilibrée.</p>" },
    tierNote: "Commun (arme)"
  },
  {
    key: "pioche-rochefer", name: "Pioche-marteau de Rochefer", type: "weapon", img: ICON.stone,
    system: { emplacement: "mainDroite", categorie: "melee", twoHands: true, poids: 4, prix: { argent: 60 },
      allonge: 1.5, range: { min: 0, max: 1.5, efficace: 0, tranche: 5 },
      damage: { dice: "2d6", flat: 2, scaling: { stat: "force", per: 5, perStep: 1 } },
      resistancesElem: { physique: 0, magique: 0, feu: 0, eau: 0, eclair: 0, glace: 0, air: 0, terre: 10, lumiere: 0, obscurite: 0 },
      description: "<p>Outil de mineur nain devenu arme. Récompense Force : <b>+1 dégât par tranche de 5</b>.</p>" },
    tierNote: "Commun (arme à deux mains)"
  },
  {
    key: "lanterne-brume", name: "Lanterne de brume", type: "relic", img: ICON.aura,
    system: { emplacement: "artefact", poids: 0.5, prix: { argent: 40 },
      bonus: bonus({ acuite: 2, initiativeMod: 2 }),
      resistancesElem: { physique: 0, magique: 0, feu: 0, eau: 0, eclair: 0, glace: 0, air: 0, terre: 0, lumiere: 0, obscurite: 10 },
      description: "<p>Sa flamme bleue perce le brouillard des Marches. +2 Acuité, +2 initiative, 10 % de résistance à l'obscurité.</p>" },
    tierNote: "Commun (relique)"
  },
  {
    key: "cape-veilleur", name: "Cape du Veilleur Gris", type: "armor", img: ICON.cowl,
    system: { emplacement: "torse", poids: 1, prix: { argent: 45 },
      bonus: bonus({ scoreArmure: 8, scoreResistance: 10 }),
      resistancesElem: { physique: 0, magique: 0, feu: 0, eau: 0, eclair: 0, glace: 0, air: 0, terre: 0, lumiere: -10, obscurite: 15 },
      description: "<p>Prise sur un cultiste. Elle protège des ténèbres… et craint la lumière.</p>" },
    tierNote: "Commun (armure)"
  },
  {
    key: "amulette-noyee", name: "Larme de la Dame Noyée", type: "relic", img: ICON.water,
    system: { emplacement: "artefact", poids: 0.2, prix: { or: 1 },
      bonus: bonus({ pvMax: 6, regenPv: 1 }),
      resistancesElem: { physique: 0, magique: 0, feu: 0, eau: 25, eclair: -10, glace: 0, air: 0, terre: 0, lumiere: 0, obscurite: 0 },
      description: "<p>Une perle d'eau figée, arrachée au cœur de la prêtresse. +6 PV max, +1 PV par tour, 25 % de résistance à l'eau, mais −10 % à l'éclair.</p>" },
    tierNote: "Rare (relique)"
  },
  {
    key: "couronne-cendre", name: "Couronne de Cendre", type: "relic", img: ICON.fire,
    system: { emplacement: "artefact", poids: 1, prix: {},
      bonus: bonus({ intelligence: 4, endurance: 4, pvMax: 8, toucherMagique: 1 }),
      resistancesElem: { physique: 0, magique: 0, feu: 40, eau: 0, eclair: 0, glace: -15, air: 0, terre: 0, lumiere: 0, obscurite: 0 },
      description: "<p>Les trois sceaux reforgés en un seul anneau de métal noir. Celui qui la porte commande au feu qu'elle enferme — ou lui sert de prochaine prison.</p>" },
    tierNote: "Épique (relique, fin d'arc)"
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// Bestiaire — archétype + thème + niveaux ; les chiffres sont calculés
// ═══════════════════════════════════════════════════════════════════════════
//
// `where` : le lieu où on la croise (le journal MJ en tire sa table de
// rencontres). `loot` : clés de LOOT/REWARDS, avec % de chance par essai.
export const BESTIARY = [
  // ── Halte-Grise et ses environs (niveaux 1-3) ─────────────────────────
  { key: "rat", name: "Rat des égouts", archetype: "pietaille", theme: "bete", levels: "1,2", img: ICON.rat, where: "Halte-Grise",
    desc: "Gros comme un chat, effronté comme un percepteur. Ils sortent par dizaines depuis que la brume noie les caves.",
    loot: [{ key: "queue-rat", pct: 80, qtyMin: 1, qtyMax: 2 }] },
  { key: "loup", name: "Loup des brumes", archetype: "soldat", theme: "bete", levels: "1,2,3", img: ICON.beast, where: "Forêt des Pendus",
    desc: "Pelage gris perle, yeux laiteux. Il chasse dans le brouillard et n'aboie jamais.",
    loot: [{ key: "croc", pct: 60, qtyMin: 1, qtyMax: 2 }, { key: "peau", pct: 35 }] },
  { key: "louve", name: "Grand-Mère Louve", archetype: "elite", theme: "bete", levels: "2,3,4", img: ICON.beast, where: "Forêt des Pendus",
    desc: "L'alpha de la meute, vieille et énorme, une oreille arrachée. Elle fuit la brume vers les villages — et emmène la meute avec elle.",
    loot: [{ key: "peau", pct: 100, qtyMin: 2, qtyMax: 3 }, { key: "croc", pct: 100, qtyMin: 2, qtyMax: 4 }] },
  { key: "brigand", name: "Brigand de la Route Grise", archetype: "soldat", theme: "humain", levels: "1,2,3", img: ICON.human, where: "Route Grise",
    desc: "Déserteur, paysan ruiné ou simple crapule : tous portent le foulard noir de Vesse-Corbeau.",
    loot: [{ key: "pieces", pct: 70, qtyMin: 2, qtyMax: 6 }, { key: "potion-soin", pct: 10 }] },
  { key: "arbaletrier", name: "Arbalétrier de la Route Grise", archetype: "rodeur", theme: "humain", levels: "2,3,4", img: ICON.human, where: "Route Grise",
    desc: "Posté en hauteur, il tire puis disparaît dans les fourrés. Vise toujours le plus bruyant d'abord.",
    loot: [{ key: "pieces", pct: 60, qtyMin: 2, qtyMax: 5 }] },
  { key: "vesse-corbeau", name: "Capitaine Vesse-Corbeau", archetype: "elite", theme: "humain", levels: "3,4,5", img: ICON.human, where: "Route Grise",
    desc: "Ancien sergent de la garde, chassé pour avoir refusé de pendre des voleurs de grain. Il rançonne les caravanes et nourrit les réfugiés du marais avec.",
    loot: [{ key: "pieces", pct: 100, qtyMin: 10, qtyMax: 20 }, { key: "epee-sergent", pct: 100 }] },

  // ── Marais de Vasebrune (niveaux 2-5) ──────────────────────────────────
  { key: "noye", name: "Noyé de Vasebrune", archetype: "soldat", theme: "abysse", levels: "2,3,4", img: ICON.water, where: "Marais de Vasebrune",
    desc: "Les disparus de Moulin-Bas, revenus. Ils n'attaquent pas pour tuer : ils traînent leur proie sous l'eau.",
    loot: [{ key: "brume", pct: 30 }] },
  { key: "follet", name: "Feu-follet du Gué", archetype: "mage", theme: "spectre", levels: "2,3,4", img: ICON.ghost, where: "Marais de Vasebrune",
    desc: "Une lueur dansante qui égare les voyageurs. Certains disent qu'elle cherche quelqu'un.",
    loot: [{ key: "ecto", pct: 50 }, { key: "brume", pct: 40 }] },
  { key: "goule", name: "Goule des tourbières", archetype: "brute", theme: "mortvivant", levels: "3,4,5", img: ICON.undead, where: "Marais de Vasebrune",
    desc: "Gonflée d'eau noire, elle déterre ce que le marais a englouti. Sa griffe sape les forces.",
    loot: [{ key: "os", pct: 70, qtyMin: 1, qtyMax: 3 }] },
  { key: "dame-noyee", name: "La Dame Noyée", archetype: "boss", theme: "abysse", levels: "4,5", img: ICON.water, where: "Sanctuaire englouti",
    desc: "Prêtresse gardienne du Sceau d'Eau, morte à son poste il y a trois siècles et jamais relevée de sa garde. Les Veilleurs ont fêlé son sceau : elle ne distingue plus ses ennemis de ceux qu'elle protège.",
    loot: [{ key: "fragment-eau", pct: 100 }, { key: "amulette-noyee", pct: 100 }, { key: "brume", pct: 100, qtyMin: 2, qtyMax: 3 }] },

  // ── Mines de Rochefer (niveaux 3-6) ────────────────────────────────────
  { key: "araignee", name: "Araignée cendrée", archetype: "rodeur", theme: "venin", levels: "3,4,5", img: ICON.venom, where: "Mines de Rochefer",
    desc: "Grande comme un bouclier, couleur de suie. Elle tisse dans les puits abandonnés et crache son venin de loin.",
    loot: [{ key: "venin", pct: 60 }] },
  { key: "golem", name: "Golem de Rochefer", archetype: "brute", theme: "pierre", levels: "4,5,6", img: ICON.stone, where: "Mines de Rochefer",
    desc: "Les gardiens du Sceau de Pierre, taillés par les nains d'avant. Ils se sont réveillés le jour où le premier sceau s'est fêlé.",
    loot: [{ key: "roc", pct: 70, qtyMin: 1, qtyMax: 2 }] },
  { key: "harpie", name: "Harpie de l'orage", archetype: "rodeur", theme: "tempete", levels: "4,5,6", img: ICON.wing, where: "Crêtes de Rochefer",
    desc: "Elles nichent sur les crêtes au-dessus des mines et plongent avec la foudre.",
    loot: [{ key: "plume", pct: 70, qtyMin: 1, qtyMax: 3 }] },
  { key: "gardien-pierre", name: "Gardien du Sceau de Pierre", archetype: "elite", theme: "pierre", levels: "5,6,7", img: ICON.stone, where: "Cœur de Rochefer",
    desc: "Un colosse de basalte gravé de runes naines. Il ne bougera pas tant qu'on ne touche pas au sceau.",
    loot: [{ key: "fragment-pierre", pct: 100 }, { key: "roc", pct: 100, qtyMin: 2, qtyMax: 4 }, { key: "pioche-rochefer", pct: 100 }] },

  // ── Crypte de Halte-Grise et Veilleurs Gris (niveaux 2-8) ──────────────
  { key: "acolyte", name: "Acolyte des Veilleurs Gris", archetype: "mage", theme: "ombre", levels: "2,3,4", img: ICON.cowl, where: "Partout (cachés)",
    desc: "Commis, lavandières, gardes : les Veilleurs recrutent parmi ceux que la brume ruine. Ils maudissent avant de fuir.",
    loot: [{ key: "os", pct: 40 }, { key: "pieces", pct: 50, qtyMin: 1, qtyMax: 4 }] },
  { key: "squelette", name: "Squelette veilleur", archetype: "pietaille", theme: "mortvivant", levels: "2,3,4", img: ICON.undead, where: "Crypte de Halte-Grise",
    desc: "Relevé par les rites des Veilleurs. Fragile, mais jamais seul.",
    loot: [{ key: "os", pct: 50 }] },
  { key: "squelette-crypte", name: "Squelette de la crypte", archetype: "soldat", theme: "mortvivant", levels: "5,6,7", img: ICON.undead, where: "Crypte de Halte-Grise",
    desc: "Les anciens gardiens de la crypte, en armure rouillée. Ils obéissent à qui tient le Sceau d'Ombre.",
    loot: [{ key: "os", pct: 70, qtyMin: 1, qtyMax: 2 }] },
  { key: "ombre", name: "Ombre rampante", archetype: "soldat", theme: "ombre", levels: "5,6,7", img: ICON.shadow, where: "Crypte de Halte-Grise",
    desc: "Une tache qui glisse au plafond et tombe sur sa proie. La lumière la fait reculer.",
    loot: [{ key: "ecto", pct: 40 }] },
  { key: "chevalier", name: "Chevalier spectral", archetype: "elite", theme: "spectre", levels: "6,7,8", img: ICON.ghost, where: "Crypte de Halte-Grise",
    desc: "Le dernier commandeur de la garde, lié au Sceau d'Ombre. Il se bat avec honneur, et ne peut pas s'arrêter.",
    loot: [{ key: "ecto", pct: 100, qtyMin: 2, qtyMax: 3 }, { key: "fragment-ombre", pct: 100 }] },
  { key: "sansombre", name: "Orvel Sansombre, le Veilleur", archetype: "boss", theme: "ombre", levels: "6,7,8", img: ICON.cowl, where: "Crypte de Halte-Grise",
    desc: "L'archiviste de Halte-Grise, démasqué. Il a lu tout ce que la ville a oublié, et en a tiré la mauvaise conclusion.",
    loot: [{ key: "cape-veilleur", pct: 100 }, { key: "lanterne-brume", pct: 100 }] },

  // ── Val-Cendre (niveaux 7-10) ──────────────────────────────────────────
  { key: "salamandre", name: "Salamandre de Val-Cendre", archetype: "soldat", theme: "feu", levels: "7,8,9", img: ICON.fire, where: "Val-Cendre",
    desc: "Elles nagent dans les coulées comme des truites dans un ruisseau.",
    loot: [{ key: "braise", pct: 50 }] },
  { key: "elementaire", name: "Élémentaire de braise", archetype: "brute", theme: "feu", levels: "7,8,9", img: ICON.fire, where: "Val-Cendre",
    desc: "Un fragment de la colère d'Ignar, détaché de lui. Il se consume en avançant.",
    loot: [{ key: "braise", pct: 100, qtyMin: 1, qtyMax: 3 }] },
  { key: "pretre-cendre", name: "Prêtre de cendre", archetype: "mage", theme: "feu", levels: "7,8,9", img: ICON.cowl, where: "Val-Cendre",
    desc: "Les Veilleurs qui ont vu Ignar et l'ont aimé. Leur peau est fendillée comme une terre cuite.",
    loot: [{ key: "braise", pct: 60 }, { key: "pieces", pct: 80, qtyMin: 5, qtyMax: 12 }] },
  { key: "gardien-givre", name: "Gardien de givre", archetype: "elite", theme: "glace", levels: "7,8,9", img: ICON.ice, where: "Val-Cendre (cols)",
    desc: "Placé là par les anciens pour refroidir la vallée. Il ne fait aucune différence entre les Veilleurs et ceux qui les chassent.",
    loot: [{ key: "givre", pct: 100 }] },
  { key: "ignar", name: "Ignar, Seigneur des Cendres", archetype: "boss", theme: "feu", levels: "8,9,10", img: ICON.fire, where: "Cœur de Val-Cendre",
    desc: "Ce que les sceaux retenaient. Un roi de flammes qui se souvient d'avoir été un homme, et qui a eu trois siècles pour décider qu'il ne voulait plus l'être.",
    loot: [{ key: "braise", pct: 100, qtyMin: 3, qtyMax: 5 }] }
];

// ═══════════════════════════════════════════════════════════════════════════
// PNJ
// ═══════════════════════════════════════════════════════════════════════════
//
// `disposition` : 1 amical, 0 neutre, −1 hostile (jeton). `weapon` : clé de
// REWARDS donnée à un PNJ qui se bat (un `character` attaque avec ses armes).
export const NPCS = [
  { key: "mairesse", name: "Aldegonde Ferrand, mairesse", niveau: 2, classe: "Mairesse de Halte-Grise", disposition: 0, img: ICON.npc,
    desc: "<p>Cinquante ans, cheveux gris tirés, un registre toujours sous le bras. Elle tient la ville à bout de bras depuis que la brume a ruiné deux récoltes.</p>",
    caractere: "Pragmatique, fatiguée, honnête jusqu'à un certain point. Paie ce qu'elle promet — en retard.",
    dialogues: "« Je n'ai pas besoin de héros. J'ai besoin que les caravanes passent et que les gens arrêtent de disparaître. »\n« La garde ? Douze hommes, dont trois sont trop vieux et deux trop jeunes. »",
    secrets: "Le grenier communal est presque vide : la ville a de quoi tenir six semaines. Elle le cache pour éviter l'émeute. Elle a déjà soupçonné Orvel, sans preuve — c'est son ami d'enfance." },
  { key: "orvel", name: "Orvel Sansombre, archiviste", niveau: 6, classe: "Archiviste", disposition: 1, img: ICON.cowl,
    desc: "<p>Un homme mince et voûté, des doigts tachés d'encre, des lunettes rafistolées. Il connaît l'histoire de chaque pierre de Halte-Grise et la raconte volontiers.</p>",
    caractere: "Chaleureux, érudit, sincèrement attaché à la ville. Il croit faire le bien. C'est ce qui le rend dangereux.",
    dialogues: "« Les Sceaux ? Une légende de nourrice. Mais si vous trouvez quoi que ce soit dans le marais, apportez-le-moi, je vous en prie. »\n« La brume nous tue lentement. Un feu, au moins, tue vite. » (s'il est démasqué)",
    secrets: "Chef des Veilleurs Gris. Il a compris que la brume vient des sceaux et veut les briser pour qu'Ignar « brûle le brouillard ». Il ignore — ou refuse de croire — qu'Ignar brûlera aussi la ville. Il se bat avec le profil « Orvel Sansombre, le Veilleur » du bestiaire." },
  { key: "ysolde", name: "Ysolde des Ronces, druidesse", niveau: 4, classe: "Druidesse", disposition: 1, img: ICON.npc,
    desc: "<p>Une femme sans âge vêtue de lierre, qui vit seule dans la Forêt des Pendus. Les loups ne l'attaquent pas.</p>",
    caractere: "Directe, impatiente avec les citadins, protectrice de la forêt. Ne ment jamais, mais ne dit pas tout.",
    dialogues: "« Vous chassez la Grand-Mère ? Elle fuit la même chose que vous. Tuez-la, et la meute se dispersera dans vos champs. »\n« La brume n'est pas une malédiction. C'est un couvercle. »",
    secrets: "Elle sait que la brume est le souffle du Sceau d'Eau qui maintient Ignar endormi. Elle préfère la brume au feu, et laisserait mourir les récoltes pour garder le couvercle fermé. Elle ignore comment détruire Ignar : c'est Anselme qui détient la clé (la Couronne)." },
  { key: "brunhilde", name: "Brunhilde Martelgris, contremaîtresse", niveau: 5, classe: "Mineuse naine", disposition: 1, img: ICON.npc, weapon: "pioche-rochefer",
    desc: "<p>Naine trapue aux bras couverts de cicatrices, barbe tressée de fil de cuivre. Elle dirige ce qui reste des mines de Rochefer.</p>",
    caractere: "Bourrue, loyale, superstitieuse. Paie en minerai. Ne descend plus au cœur de la mine depuis que les golems se sont réveillés.",
    dialogues: "« Mes ancêtres ont taillé ces gardiens. Ils ne se réveillent que si quelqu'un touche au cœur. Alors QUI a touché au cœur ? »\n« Ramenez-moi mes gars vivants et je vous forge ce que vous voulez. »",
    secrets: "Elle a vendu à un « érudit de la ville » (Orvel) les plans des galeries profondes, il y a un an, pour sauver la mine de la faillite. Elle se sent responsable." },
  { key: "tobias", name: "Tobias « Trois-Doigts », tavernier", niveau: 2, classe: "Tavernier du Chaudron Fêlé", disposition: 0, img: ICON.npc,
    desc: "<p>Gros, jovial, il lui manque deux doigts à la main gauche. Sa taverne, le Chaudron Fêlé, est le seul endroit chauffé de toute la ville.</p>",
    caractere: "Bavard, curieux, sait tout sur tout le monde. Vend une information contre une autre.",
    dialogues: "« Une chambre, c'est deux cuivres. Une rumeur, c'est une autre rumeur. »\n« Les rats ? Ils viennent d'en bas. D'un endroit où il ne devrait pas y avoir d'en bas. »",
    secrets: "Receleur des brigands de Vesse-Corbeau : un tunnel relie sa cave aux anciens égouts et à la Route Grise. Il n'a rien à voir avec les Veilleurs, et il le prouvera volontiers si on le couvre." },
  { key: "garance", name: "Sergente Garance Lhermitte", niveau: 3, classe: "Garde de Halte-Grise", disposition: 1, img: ICON.human, weapon: "epee-sergent",
    desc: "<p>Grande, rousse, une cicatrice sur la mâchoire. Elle commande la garde de Halte-Grise — ce qu'il en reste.</p>",
    caractere: "Courageuse, à cheval sur les règles, épuisée. Peut accompagner le groupe sur une mission (PNJ combattant).",
    dialogues: "« Vesse-Corbeau était mon sergent. Le meilleur que j'aie connu. Si vous le croisez… essayez de le ramener vivant. »\n« La loi, c'est tout ce qui nous sépare du marais. »",
    secrets: "Elle a signé l'ordre d'expulsion de Vesse-Corbeau sous la pression du conseil, et le regrette. Elle accepterait de le gracier si le groupe ramène la preuve qu'il nourrit les réfugiés." },
  { key: "anselme", name: "Frère Anselme, prêtre de la Lumière", niveau: 4, classe: "Prêtre", disposition: 1, img: ICON.npc,
    desc: "<p>Un vieil homme au crâne rasé, mains calleuses de jardinier. Il soigne gratuitement à la chapelle, en échange de quelques heures au potager.</p>",
    caractere: "Doux, lent, d'une patience infinie. Mal à l'aise dès qu'on parle des Veilleurs.",
    dialogues: "« Je soigne les corps. Pour le reste, il faudra vous adresser à plus haut que moi. »\n« La Couronne… je n'aurais jamais cru entendre ce mot à nouveau. »",
    secrets: "Ancien Veilleur Gris : il a quitté le culte il y a vingt ans, quand il a compris ce qu'était Ignar. Il connaît le rite de la Couronne — reforger les trois fragments pour lier ou détruire Ignar — et en a peur. Soigne 2d6 + 2 PV par jour à chaque PJ, contre un service." }
];

// ═══════════════════════════════════════════════════════════════════════════
// Quêtes
// ═══════════════════════════════════════════════════════════════════════════
//
// XP : la récompense de quête est versée à CHAQUE PJ (quest-resolve.js). Le
// rythme du système est 100 XP par niveau, dont ~75 % viennent des combats
// (4 rencontres à 25 XP) : une quête principale rapporte donc l'équivalent
// d'une à deux rencontres (25 à 50 XP), une secondaire une demi-rencontre.
const step = (label, description, objectifs = [], notesMJ = "") => ({
  label, description, notesMJ, objectifs: objectifs.map(text => ({ text, fait: false }))
});

export const QUESTS = [
  // ── Trame principale ──────────────────────────────────────────────────
  { key: "q1", name: "I · La Brume qui monte", arc: MAIN_ARC, niveaux: "1-2", xp: 30,
    rewards: [{ key: "potion-soin", qty: 2 }],
    desc: "<p>Trois habitants du hameau de Moulin-Bas ont disparu en une semaine, tous par nuit de brume. La mairesse Ferrand paie quiconque ramènera une explication — ou les disparus.</p>",
    lore: "<p>Les disparus ont été entraînés dans le marais par les Noyés : le Sceau d'Eau fêlé « appelle » les vivants pour reconstituer sa garde. Les Veilleurs Gris ont fêlé le sceau ; un acolyte surveille le hameau pour compter les victimes.</p><p><b>Indices</b> : traces de pieds mouillés qui sortent de la rivière et y retournent ; un os gravé d'un œil fermé sous le moulin ; des loups qui fuient VERS le village.</p>",
    etapes: [
      step("Moulin-Bas", "<p>Le hameau est à une heure de marche de Halte-Grise, au bord de la rivière Grise. Les habitants se barricadent dès que la brume tombe.</p>",
        ["Interroger le meunier et la veuve Grelot", "Examiner la berge où ont disparu les victimes"],
        "Jet de Perception (difficulté 2) : traces de pas mouillés. Intuition (2) : la veuve ment — elle a vu une silhouette encapuchonnée, et a peur."),
      step("Les loups dans la brume", "<p>Une meute de loups gris rôde à la lisière. Ils ne chassent pas le bétail : ils semblent fuir quelque chose.</p>",
        ["Survivre à la meute", "Remarquer dans quelle direction fuient les loups"],
        "Rencontre : 3 × Loup des brumes (standard). Ysolde peut apparaître après le combat si un loup a été épargné (lien vers « La Louve Grand-Mère »)."),
      step("L'acolyte", "<p>Une silhouette encapuchonnée observe le hameau depuis le vieux moulin.</p>",
        ["Capturer ou suivre l'acolyte", "Découvrir le sigle de l'œil fermé"],
        "1 × Acolyte des Veilleurs Gris + 3 × Rat des égouts. Capturé, il ne parle que sous la menace : « Le Veilleur dit que la brume est le mal. Nous ouvrons la fenêtre. » Il ne connaît pas le nom du Veilleur."),
      step("La lisière du marais", "<p>Les traces mènent aux roseaux de Vasebrune. Dans la brume, des silhouettes se tiennent immobiles, de l'eau jusqu'à la taille.</p>",
        ["Affronter les Noyés", "Reconnaître l'un des disparus parmi eux"],
        "2 × Noyé de Vasebrune + 1 × Feu-follet du Gué. Le meunier reconnaît son fils parmi les Noyés : moment dur, à jouer. Retour à Halte-Grise : Orvel propose spontanément d'aider à « comprendre le sigle »."),
    ] },
  { key: "q2", name: "II · Ce que garde la Dame Noyée", arc: MAIN_ARC, niveaux: "3-4", xp: 50,
    rewards: [{ key: "lanterne-brume", qty: 1 }],
    desc: "<p>Orvel l'archiviste a retrouvé une carte du marais où figure un « sanctuaire englouti ». Si la brume a une source, elle est là.</p>",
    lore: "<p>Le sanctuaire abrite le Sceau d'Eau, gardé par la Dame Noyée. Orvel envoie le groupe chercher le fragment qu'il ne peut pas prendre lui-même — la Dame le reconnaîtrait. <b>Il est le commanditaire et le futur receleur du fragment.</b></p><p>Si le groupe rapporte le fragment à Orvel, il le garde « pour l'étudier » : c'est une erreur rattrapable à l'acte IV. Si le groupe le confie à Anselme ou le garde, Orvel enverra des acolytes le reprendre.</p>",
    etapes: [
      step("Traverser Vasebrune", "<p>Trois jours de marais. La brume y est si épaisse qu'on ne voit pas ses pieds.</p>",
        ["Trouver le chemin (Survie)", "Résister à la Goule des tourbières"],
        "Jet d'Athlétisme ou de Survie (2) par jour ; un échec = 1 niveau de fatigue. 1 × Goule des tourbières + 3 × Rat des égouts sur un îlot."),
      step("Le feu-follet", "<p>Une lueur danse devant vous, s'arrête, revient, comme si elle voulait être suivie.</p>",
        ["Suivre — ou chasser — le feu-follet"],
        "Si on le suit : il mène au campement des réfugiés de Vesse-Corbeau (lien « La Route Grise »), puis au sanctuaire par un chemin sûr (pas de jet de fatigue). Si on le chasse : combat, et chemin long."),
      step("Le sanctuaire englouti", "<p>Un temple à moitié sous l'eau, colonnes couvertes de coquillages. Au centre, une femme en robe de prêtresse, les pieds dans l'eau, vous tourne le dos.</p>",
        ["Parler à la Dame Noyée", "Vaincre ou apaiser la Dame Noyée"],
        "Boss (niveau 4). Contre un groupe de niveau 3, prévois une sortie : elle est à la limite de ce qu'il peut encaisser. Un PJ qui lui parle avec Intuition (3) peut la faire hésiter : elle n'attaque pas le premier tour. Si on lui rend un Noyé (le fils du meunier), elle se dissout d'elle-même à la moitié de ses PV."),
      step("Le Fragment d'Eau", "<p>Dans les eaux qui se retirent, un éclat de métal noir, froid comme la glace.</p>",
        ["Récupérer le Fragment du Sceau d'Eau", "Décider à qui le confier"],
        "La brume s'épaissit dès que le fragment quitte le sanctuaire : c'est le premier indice que la brume vient des sceaux. Ysolde le confirme si on la consulte."),
    ] },
  { key: "q3", name: "III · Les Échos de Rochefer", arc: MAIN_ARC, niveaux: "4-6", xp: 50,
    rewards: [{ key: "pioche-rochefer", qty: 1 }],
    desc: "<p>Les mines de Rochefer ont fermé : les gardiens de pierre des anciens nains se sont réveillés et tuent les mineurs. Brunhilde Martelgris cherche des gens assez fous pour descendre.</p>",
    lore: "<p>Des Veilleurs, guidés par les plans qu'Orvel a achetés à Brunhilde, ont percé une galerie vers le Sceau de Pierre. Ils n'ont pas réussi à le prendre : le Gardien du Sceau les a écrasés. Les lettres trouvées sur leurs corps sont signées « O. S. ».</p>",
    etapes: [
      step("La descente", "<p>Les galeries supérieures sont couvertes de toiles grises.</p>",
        ["Nettoyer les galeries supérieures"],
        "2 × Araignée cendrée + 1 × Golem de Rochefer. Harpies possibles si le groupe passe par les crêtes (raccourci)."),
      step("La galerie neuve", "<p>Un tunnel récent, mal étayé, qui ne figure sur aucun plan de Brunhilde.</p>",
        ["Trouver les corps des cultistes", "Lire les lettres signées « O. S. »"],
        "Les lettres parlent du « deuxième sceau » et de « notre ami du marais » (les PJ !). Si Brunhilde les voit, elle avoue avoir vendu les plans."),
      step("Le cœur de Rochefer", "<p>Une salle ronde, un pilier de basalte. Le Gardien ouvre les yeux.</p>",
        ["Vaincre le Gardien du Sceau de Pierre", "Récupérer le Fragment de Pierre"],
        "Élite seule = rencontre complète. Un nain (Brunhilde) peut prononcer la formule ancestrale et faire perdre son premier tour au Gardien."),
    ] },
  { key: "q4", name: "IV · Le Veilleur derrière le voile", arc: MAIN_ARC, niveaux: "6-7", xp: 60,
    rewards: [{ key: "cape-veilleur", qty: 1 }],
    desc: "<p>Les initiales « O. S. » ne laissent pas beaucoup de choix. Et Orvel a disparu de ses archives depuis trois jours.</p>",
    lore: "<p>Orvel est descendu dans la crypte sous la chapelle pour briser le troisième sceau. S'il a déjà le Fragment d'Eau (acte II), il est à deux doigts de réussir. Frère Anselme connaît l'entrée secrète, et finit par avouer son passé de Veilleur.</p><p><b>Fin de l'acte</b> : vaincu, Orvel ne demande pas grâce ; il demande qu'on regarde la brume en face. Le laisser vivre est un choix (il peut revenir à l'acte V comme allié contre Ignar).</p>",
    etapes: [
      step("Les archives vides", "<p>Le bureau d'Orvel est en ordre. Trop en ordre. Un seul livre manque sur l'étagère des sceaux.</p>",
        ["Fouiller les archives", "Faire parler Frère Anselme"],
        "Connaissance (3) : le livre manquant décrit la Couronne. Anselme avoue à la seconde question pressante."),
      step("La crypte", "<p>Sous la chapelle, des escaliers que personne n'a descendus depuis un siècle. Des os bougent dans l'obscurité.</p>",
        ["Traverser la crypte"],
        "Rencontres : 3 × Squelette de la crypte ; puis 2 × Ombre rampante + 1 × Acolyte. Utilise le générateur de rencontres (thème Mort-vivant / Ombre)."),
      step("Le Chevalier spectral", "<p>Devant la dernière porte, un chevalier translucide lève son épée.</p>",
        ["Vaincre le Chevalier spectral", "Récupérer le Fragment d'Ombre"],
        "Si un PJ s'agenouille et prête le serment de la garde (Garance peut le leur apprendre), le chevalier rend son épée et le fragment sans combat."),
      step("Orvel", "<p>L'archiviste se tient devant le sceau, une lanterne bleue à la main.</p>",
        ["Démasquer et vaincre Orvel Sansombre"],
        "Boss (niveau 7). Il fuit à 25 % de ses PV si le groupe a les trois fragments — il sait qu'Ignar se réveillera de toute façon, sceaux brisés ou non."),
    ] },
  { key: "q5", name: "V · Le Siège de Val-Cendre", arc: MAIN_ARC, niveaux: "8-10", xp: 100,
    rewards: [{ key: "couronne-cendre", qty: 1 }],
    desc: "<p>La brume se lève. Pour la première fois depuis des années, le soleil brille sur les Marches — et au sud, le ciel de Val-Cendre est rouge.</p>",
    lore: "<p>Deux sceaux sur trois ont quitté leur place : Ignar s'éveille. Deux fins possibles, à laisser choisir aux joueurs :</p><ul><li><b>Restaurer les sceaux</b> (Ysolde) : remettre les trois fragments en place. Ignar se rendort, la brume revient — pour toujours. Les récoltes resteront maigres.</li><li><b>Reforger la Couronne</b> (Anselme) : fondre les trois fragments en une couronne et la poser sur la tête d'Ignar vaincu. Il est détruit, la brume disparaît. Mais la Couronne doit être portée ensuite par quelqu'un, et elle « chuchote ».</li></ul><p>Orvel, s'il est vivant, peut se sacrifier pour retenir Ignar un tour.</p>",
    etapes: [
      step("La vallée en feu", "<p>Les coulées de lave descendent vers la rivière Grise. Halte-Grise sera atteinte en quatre jours.</p>",
        ["Traverser Val-Cendre", "Franchir le col du Gardien de givre"],
        "Rencontres : 3 × Salamandre ; 1 × Élémentaire de braise + 1 × Prêtre de cendre ; Gardien de givre (élite) au col. Le Gardien peut être évité si le groupe montre qu'il vient refermer — pas ouvrir."),
      step("Le choix", "<p>Au bord du cratère, les trois fragments vibrent dans vos sacs.</p>",
        ["Choisir : restaurer les sceaux ou reforger la Couronne"],
        "Laisse les joueurs débattre. Ysolde et Anselme peuvent être présents et défendre chacun leur option."),
      step("Ignar", "<p>Le cratère s'ouvre. Un roi de flammes se lève, et vous regarde avec des yeux qui ont été humains.</p>",
        ["Vaincre Ignar, Seigneur des Cendres"],
        "Boss final (niveau 9-10). Avec la Couronne reforgée : la poser sur lui à 0 PV le détruit. Sans : à 0 PV il se rendort, et les sceaux doivent être replacés dans le tour."),
    ] },

  // ── Quêtes secondaires ────────────────────────────────────────────────
  { key: "s1", name: "Des rats dans la réserve", arc: SIDE_ARC, niveaux: "1", xp: 15,
    rewards: [{ key: "potion-soin", qty: 1 }],
    desc: "<p>Tobias, le tavernier du Chaudron Fêlé, offre le gîte d'une semaine à qui débarrasse sa cave des rats.</p>",
    lore: "<p>Les rats viennent d'un tunnel de contrebande qui relie la cave aux anciens égouts, puis à la Route Grise. Tobias le sait : c'est par là qu'il reçoit les marchandises de Vesse-Corbeau. Il espère que le groupe ne le trouvera pas.</p>",
    etapes: [
      step("La cave", "<p>Ça grouille, ça mord, ça pue.</p>", ["Tuer les rats"], "6 × Rat des égouts (standard, niveau 1)."),
      step("Le mur qui sonne creux", "<p>Derrière les tonneaux, un passage frais et une odeur de forêt.</p>",
        ["Trouver le tunnel", "Confronter Tobias — ou se taire"],
        "Perception (1). Tobias propose un marché : le silence contre la position du camp de Vesse-Corbeau (lien « La Route Grise »)."),
    ] },
  { key: "s2", name: "La Route Grise", arc: SIDE_ARC, niveaux: "2-4", xp: 35,
    rewards: [{ key: "epee-sergent", qty: 1 }],
    desc: "<p>Les caravanes ne passent plus : des brigands au foulard noir rançonnent la Route Grise. La mairesse offre une prime pour la tête de leur chef, le capitaine Vesse-Corbeau.</p>",
    lore: "<p>Vesse-Corbeau est l'ancien sergent de Garance, chassé pour avoir refusé de pendre des voleurs de grain. Il rançonne les caravanes et nourrit avec le butin une soixantaine de réfugiés de Moulin-Bas cachés dans le marais.</p><p><b>Fins</b> : le tuer (prime, mais les réfugiés affluent affamés en ville) ; le ramener vivant (Garance le gracie si le groupe prouve l'existence du camp) — il devient alors un allié pour l'acte V.</p>",
    etapes: [
      step("L'embuscade", "<p>Une caravane démolie, des caisses vides, des traces dans la boue.</p>",
        ["Repousser les brigands"], "3 × Brigand + 1 × Arbalétrier (niveau 2-3)."),
      step("Le camp des réfugiés", "<p>Au bord du marais, des huttes de roseaux, des enfants maigres, et des caisses aux armes de la caravane.</p>",
        ["Découvrir le camp", "Comprendre ce que fait Vesse-Corbeau"], "Le feu-follet (acte II) peut y mener le groupe."),
      step("Le capitaine", "<p>Il vous attend debout, l'épée au clair, devant les huttes.</p>",
        ["Vaincre, convaincre ou ramener Vesse-Corbeau"],
        "Élite + 2 × Brigand. Persuasion (Intuition 3) avec une lettre de Garance : il se rend."),
    ] },
  { key: "s3", name: "La Louve Grand-Mère", arc: SIDE_ARC, niveaux: "2-3", xp: 30,
    rewards: [{ key: "potion-soin", qty: 2 }],
    desc: "<p>Une louve énorme a tué des moutons aux portes de Halte-Grise. Les éleveurs se cotisent pour sa peau.</p>",
    lore: "<p>La Grand-Mère fuit la brume (elle « sent » le sceau fêlé) et mène la meute vers les villages. Ysolde demande qu'on l'épargne : la tuer disperse la meute dans les fermes. Repousser la brume (acte II) la ramène d'elle-même dans la forêt.</p>",
    etapes: [
      step("La piste", "<p>Des traces énormes, une oreille arrachée laissée sur un barbelé.</p>", ["Pister la louve (Survie)"], "Ysolde intercepte le groupe en forêt."),
      step("La tanière", "<p>Une grotte sous les racines d'un chêne pendu.</p>",
        ["Tuer, chasser ou apaiser la Grand-Mère Louve"],
        "Élite (niveau 3). Ysolde peut la calmer si le groupe tient 3 tours sans la blesser gravement."),
    ] },
  { key: "s4", name: "La lueur du Gué", arc: SIDE_ARC, niveaux: "3", xp: 25,
    rewards: [{ key: "potion-soin", qty: 1 }],
    desc: "<p>Au gué de Vasebrune, une lumière attire les voyageurs vers les eaux profondes. Deux charretiers se sont noyés.</p>",
    lore: "<p>Le feu-follet est l'esprit de Mira, une fillette de Moulin-Bas noyée par les Noyés. Elle essaie de montrer où se cachent les acolytes qui ont fêlé le sceau. L'apaiser (lui montrer qu'on a compris) révèle une cache de Veilleurs : 2 × Acolyte, des notes sur le sanctuaire.</p>",
    etapes: [
      step("Le gué la nuit", "<p>Une petite lumière danse au-dessus de l'eau noire.</p>", ["Observer le feu-follet sans le suivre dans l'eau"], "Intuition (2) : la lumière tourne toujours vers la même rive."),
      step("La cache", "<p>Sous un saule, une trappe couverte de mousse.</p>", ["Vaincre les acolytes", "Rendre son nom à Mira"],
        "2 × Acolyte des Veilleurs Gris. Si on dit son nom (trouvé à Moulin-Bas), le feu-follet s'éteint en paix."),
    ] }
];

// ═══════════════════════════════════════════════════════════════════════════
// Journal MJ
// ═══════════════════════════════════════════════════════════════════════════
function journalPages() {
  const byPlace = new Map();
  for (const m of BESTIARY) {
    const l = byPlace.get(m.where) ?? [];
    l.push(m); byPlace.set(m.where, l);
  }
  const bestiaryRows = Array.from(byPlace.entries()).map(([where, list]) =>
    `<h3>${where}</h3><ul>${list.map(m => {
      const a = getArchetype(m.archetype), t = getTheme(m.theme);
      return `<li><b>${m.name}</b> — ${a.icon} ${a.label}, ${t.icon} ${t.label}, niveaux ${m.levels}</li>`;
    }).join("")}</ul>`).join("");

  return [
    { name: "Présentation", content: `
<h1>${SETTING_NAME}</h1>
<p><b>Ton</b> : fantasy de frontière, grise et humide, où le danger vient autant de la faim que des monstres. Les PJ ne sauvent pas le monde : ils sauvent une ville, et doivent décider à quel prix.</p>
<p><b>La situation</b> : depuis trois ans, une brume monte du marais de Vasebrune et ne se lève plus. Les récoltes pourrissent, les gens disparaissent, les loups descendent des bois. À Halte-Grise, la petite ville marchande au carrefour de la Route Grise, on parle de malédiction.</p>
<p><b>La vérité (MJ)</b> : la brume est le souffle du Sceau d'Eau, l'un des trois sceaux qui tiennent endormi <b>Ignar, Seigneur des Cendres</b>, sous la vallée volcanique de Val-Cendre. Un culte, les <b>Veilleurs Gris</b>, mené en secret par l'archiviste Orvel Sansombre, veut briser les sceaux pour que le feu « brûle la brume ». Ils ont raison sur la cause, et tort sur le remède.</p>
<p><b>Le choix final</b> : restaurer les sceaux (la brume reste, la ville survit pauvre) ou reforger la Couronne de Cendre pour détruire Ignar (la brume part, mais quelqu'un doit porter la Couronne).</p>` },
    { name: "Lieux", content: `
<h2>Halte-Grise</h2><p>Ville murée de huit cents âmes. <b>Le Chaudron Fêlé</b> (taverne de Tobias), <b>la chapelle de la Lumière</b> (Frère Anselme, crypte scellée dessous), <b>les archives</b> (Orvel), <b>la mairie</b> (Aldegonde Ferrand), <b>la caserne</b> (Garance Lhermitte, douze gardes).</p>
<h2>Moulin-Bas</h2><p>Hameau de meuniers au bord de la rivière Grise, à une heure de la ville. Le premier touché par les disparitions.</p>
<h2>Forêt des Pendus</h2><p>Chênes tordus dont les branches basses ressemblent à des cordes. Domaine d'Ysolde et de la meute de la Grand-Mère.</p>
<h2>Route Grise</h2><p>La route marchande vers le nord. Territoire des brigands de Vesse-Corbeau.</p>
<h2>Marais de Vasebrune</h2><p>Trois jours de roseaux et d'eau noire. Le sanctuaire englouti du Sceau d'Eau est en son centre. Un camp de réfugiés caché sur la rive ouest.</p>
<h2>Mines de Rochefer</h2><p>Mines naines à l'est, sur les crêtes. Le Sceau de Pierre au cœur, sous la garde d'un colosse de basalte.</p>
<h2>Val-Cendre</h2><p>Vallée volcanique au sud, morte depuis trois siècles. Un col gardé par un gardien de givre, posé là pour refroidir la vallée.</p>` },
    { name: "Factions", content: `
<h2>Les Veilleurs Gris</h2><p>Culte d'une trentaine de membres, recrutés parmi les ruinés de la brume. Sigle : un œil fermé. Chef : Orvel Sansombre. Croyance : « la brume est le mal, le feu purifie ». Méthodes : fêler les sceaux, relever les morts de la crypte, maudire leurs ennemis.</p>
<h2>La garde de Halte-Grise</h2><p>Douze hommes sous la sergente Garance. Loyaux, débordés, mal payés.</p>
<h2>Les brigands du foulard noir</h2><p>Une vingtaine de déserteurs et de paysans sous le capitaine Vesse-Corbeau. Rançonnent pour nourrir les réfugiés.</p>
<h2>Les nains de Rochefer</h2><p>Une cinquantaine de mineurs sans travail. Brunhilde Martelgris parle pour eux.</p>
<h2>Le Cercle des Ronces</h2><p>Ysolde, seule, et la forêt. Gardienne du « couvercle ».</p>` },
    { name: "Bestiaire et rencontres", content: `
<p>Tous les monstres ci-dessous ont été <b>calibrés par le système</b> (archétype × thème, bouton ⚡ de la fiche) contre le groupe de référence des réglages du monde. Pour composer une rencontre au niveau du groupe, utilise la macro <b>« Générateur de Rencontres (MJ) »</b> : elle tire dans ce bestiaire, compte la menace (1 point = une rencontre normale) et pose les jetons au bon niveau.</p>
<p>Repère : piétaille 0,15 · soldat 0,33 · rôdeur/mage 0,4 · brute 0,5 · élite 1 · boss 2,5.</p>
${bestiaryRows}` },
    { name: "Rythme de campagne", content: `
<table><tr><th>Niveau</th><th>Trame</th><th>Secondaires</th></tr>
<tr><td>1-2</td><td>I · La Brume qui monte</td><td>Des rats dans la réserve · La Route Grise (début)</td></tr>
<tr><td>2-4</td><td>II · Ce que garde la Dame Noyée</td><td>La Louve Grand-Mère · La lueur du Gué · La Route Grise</td></tr>
<tr><td>4-6</td><td>III · Les Échos de Rochefer</td><td>—</td></tr>
<tr><td>6-7</td><td>IV · Le Veilleur derrière le voile</td><td>—</td></tr>
<tr><td>8-10</td><td>V · Le Siège de Val-Cendre</td><td>—</td></tr></table>
<p>100 XP par niveau : ~4 rencontres + 1 quête. Monte le réglage <b>« Pesée — niveau du groupe »</b> à chaque montée de niveau, et passe <b>« Niveau des monstres posés »</b> sur « Au niveau du groupe » pour que les monstres déposés à la main suivent aussi.</p>` }
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Construction des données (pures, testables hors Foundry)
// ═══════════════════════════════════════════════════════════════════════════
const parseLevels = (csv) => String(csv ?? "").split(/[,\s;]+/).map(Number).filter(v => v > 0);

/** Données de création d'un monstre du bestiaire, plages et capacités comprises. */
export function monsterData(entry) {
  const levels = parseLevels(entry.levels);
  const a = getArchetype(entry.archetype);
  const t = getTheme(entry.theme);
  const bands = {};
  for (const lvl of levels) bands[String(lvl)] = applyThemeToBand(buildBand(lvl, a.key), t.key, lvl, a.key);
  const mid = levels[Math.floor(levels.length / 2)] ?? 1;
  const items = themedAbilitiesForLevels(levels, a.key, t.key).map(s => themedAbilityItemData(s, { img: entry.img }));
  const melee = a.portee <= 2;
  return {
    name: entry.name, type: "monster", img: entry.img,
    system: {
      niveau: mid,
      description: `<p>${entry.desc}</p><p><i>${a.icon} ${a.label} · ${t.icon} ${t.label} · ${entry.where}</i></p>`,
      allonge: melee ? a.portee : 1,
      pvReveal: "none",
      deplacement: { vitesse: a.vitesse, type: t.move ?? "terrestre", typesExtra: [] },
      gen: { levelsCsv: levels.join(","), bands, generated: false }
    },
    items,
    prototypeToken: { name: entry.name, actorLink: false, disposition: -1, texture: { src: entry.img } },
    flags: { rpg: { contentKey: `monster:${entry.key}`, archetype: a.key, theme: t.key, contentVersion: CONTENT_VERSION } }
  };
}

/** Principales d'un PNJ : la référence du groupe au même niveau, moins le bonus de niveau que le moteur ajoute. */
function npcStats(niveau) {
  const ref = 5 + 2 * (Math.max(1, niveau) - 1);
  const base = Math.max(1, ref - niveau);
  return { force: base, intelligence: base, dexterite: base, acuite: base, endurance: base };
}

export function npcData(entry) {
  const lvl = Math.max(1, Number(entry.niveau) || 1);
  const pv = 30 + 4 * (lvl - 1);
  return {
    name: entry.name, type: "character", img: entry.img,
    system: {
      niveau: lvl, classe: entry.classe, description: entry.desc, pnjView: "always",
      principales: npcStats(lvl),
      ressources: { pv: { valeur: pv, max: pv }, mana: { valeur: 5, max: 5 }, fatigue: { valeur: 0, max: 10 } },
      mj: { caractere: entry.caractere ?? "", dialogues: entry.dialogues ?? "", secrets: entry.secrets ?? "" }
    },
    prototypeToken: { name: entry.name.split(",")[0], actorLink: true, disposition: entry.disposition ?? 0, texture: { src: entry.img } },
    flags: { rpg: { contentKey: `npc:${entry.key}`, contentVersion: CONTENT_VERSION } }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Installation dans le monde
// ═══════════════════════════════════════════════════════════════════════════
/** Région (sous-dossier du bestiaire) d'un lieu de rencontre. */
export function regionOf(where) {
  const w = String(where ?? "");
  if (w.includes("Rochefer")) return "Mines de Rochefer";
  if (w.includes("Val-Cendre")) return "Val-Cendre";
  if (w.includes("Marais") || w.includes("Sanctuaire")) return "Marais de Vasebrune";
  if (w.includes("Forêt") || w.includes("Route")) return "Forêt des Pendus & Route Grise";
  return "Halte-Grise & sa crypte";
}

async function folderFor(type, name, parent = null) {
  let f = game.folders.find(x => x.type === type && x.name === name && (x.folder?.id ?? null) === (parent?.id ?? null));
  if (!f) f = await Folder.create({ name, type, color: "#5b4a2f", folder: parent?.id ?? null });
  return f;
}

function findByKey(collection, key) {
  return collection.find(d => d.flags?.rpg?.contentKey === key) ?? null;
}

/**
 * Installe le contenu dans le monde. `parts` : sous-ensemble de
 * {loot, rewards, monsters, npcs, quests, journal} — tout par défaut.
 * Renvoie le compte de ce qui a été créé et ignoré.
 */
export async function installCampaignContent(parts = {}) {
  if (!game.user?.isGM) throw new Error("Réservé au MJ.");
  const want = (k) => parts[k] !== false;
  const report = { created: [], skipped: 0 };
  const itemUuid = {};

  // ── Objets (butin + récompenses) : d'abord, les monstres et quêtes y renvoient
  const itemRoot = await folderFor("Item", SETTING_NAME);
  const lootFolder = await folderFor("Item", "Butin", itemRoot);
  const rewardFolder = await folderFor("Item", "Récompenses", itemRoot);
  const questFolder = await folderFor("Item", "Quêtes", itemRoot);

  for (const l of LOOT) {
    const key = `loot:${l.key}`;
    let it = findByKey(game.items, key);
    if (!it && want("loot")) {
      it = await Item.create({ name: l.name, type: "loot", img: l.img, folder: lootFolder.id,
        // `description` n'est pas dans le schéma de `loot`, mais la fiche
        // générique l'affiche et l'écrit (texte brut) pour tous les types.
        system: { poids: l.poids ?? 0.1, prix: { cuivre: 0, argent: 0, or: 0, ...l.prix }, description: l.desc },
        flags: { rpg: { contentKey: key, contentVersion: CONTENT_VERSION } } });
      report.created.push(`Objet : ${l.name}`);
    } else if (it) report.skipped++;
    if (it) itemUuid[l.key] = it.uuid;
  }
  for (const r of REWARDS) {
    const key = `reward:${r.key}`;
    let it = findByKey(game.items, key);
    if (!it && want("rewards")) {
      it = await Item.create({ name: r.name, type: r.type, img: r.img, folder: rewardFolder.id,
        system: foundry.utils.deepClone(r.system),
        flags: { rpg: { contentKey: key, contentVersion: CONTENT_VERSION } } });
      report.created.push(`Récompense : ${r.name}`);
    } else if (it) report.skipped++;
    if (it) itemUuid[r.key] = it.uuid;
  }

  // ── Bestiaire
  if (want("monsters")) {
    const root = await folderFor("Actor", `${SETTING_NAME} — Bestiaire`);
    const sub = new Map();
    for (const m of BESTIARY) {
      const key = `monster:${m.key}`;
      if (findByKey(game.actors, key)) { report.skipped++; continue; }
      const region = regionOf(m.where);
      if (!sub.has(region)) sub.set(region, await folderFor("Actor", region, root));
      const data = monsterData(m);
      data.folder = sub.get(region).id;
      data.system.butin = {
        tableUuid: "",
        entries: (m.loot ?? []).filter(x => itemUuid[x.key]).map(x => ({
          uuid: itemUuid[x.key], pct: x.pct ?? 100, qtyMin: x.qtyMin ?? 1, qtyMax: x.qtyMax ?? x.qtyMin ?? 1, tries: 1
        }))
      };
      await Actor.create(data);
      report.created.push(`Monstre : ${m.name}`);
    }
  }

  // ── PNJ
  if (want("npcs")) {
    const folder = await folderFor("Actor", `${SETTING_NAME} — PNJ`);
    for (const p of NPCS) {
      const key = `npc:${p.key}`;
      if (findByKey(game.actors, key)) { report.skipped++; continue; }
      const data = npcData(p);
      data.folder = folder.id;
      const actor = await Actor.create(data);
      if (actor && p.weapon && itemUuid[p.weapon]) {
        const src = await fromUuid(itemUuid[p.weapon]);
        if (src) {
          const w = src.toObject(); delete w._id; delete w.folder;
          w.system.equipe = true;
          await actor.createEmbeddedDocuments("Item", [w]);
        }
      }
      report.created.push(`PNJ : ${p.name}`);
    }
  }

  // ── Quêtes
  if (want("quests")) {
    for (const q of QUESTS) {
      const key = `quest:${q.key}`;
      if (findByKey(game.items, key)) { report.skipped++; continue; }
      const items = (q.rewards ?? []).filter(r => itemUuid[r.key]).map(r => ({
        uuid: itemUuid[r.key], qty: r.qty ?? 1,
        name: (LOOT.find(l => l.key === r.key) ?? REWARDS.find(x => x.key === r.key))?.name ?? ""
      }));
      await Item.create({
        name: q.name, type: "quest", img: ICON.quest, folder: questFolder.id,
        system: {
          statut: "active", arc: q.arc, etapeActuelle: 0, etapes: q.etapes,
          description: `${q.desc}<p><i>Niveau conseillé : ${q.niveaux}</i></p>`,
          lore: q.lore, epilogue: "",
          recompense: { xp: q.xp, items }
        },
        flags: { rpg: { contentKey: key, contentVersion: CONTENT_VERSION } }
      });
      report.created.push(`Quête : ${q.name}`);
    }
  }

  // ── Journal MJ
  if (want("journal")) {
    const key = "journal:guide";
    if (findByKey(game.journal, key)) report.skipped++;
    else {
      const pages = journalPages().map((p, i) => ({
        name: p.name, type: "text", sort: (i + 1) * 100000,
        title: { show: true, level: 1 }, text: { content: p.content, format: 1 }
      }));
      await JournalEntry.create({ name: `${SETTING_NAME} — Guide du MJ`, pages,
        ownership: { default: 0 },
        flags: { rpg: { contentKey: key, contentVersion: CONTENT_VERSION } } });
      report.created.push("Journal : Guide du MJ");
    }
  }

  return report;
}

export const _test = { journalPages };
