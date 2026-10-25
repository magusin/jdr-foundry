// module/rules/monster-themes.js
//
// « Mon soldat est un squelette » : le THÈME d'une créature, posé par-dessus
// son archétype sans en casser le calibrage.
//
// L'archétype (monster-archetypes.js) décide des NOMBRES : combien de tours
// elle tient, quelle part des PV d'un PJ elle enlève. Le thème décide de ce
// qu'elle EST : l'élément de ses coups, ce qu'elle résiste, ce qu'elle craint,
// l'état que laisse sa capacité signature. Les deux étaient mélangés à la main
// jusqu'ici : `buildBand` laisse volontairement les résistances à [0, 0], et
// le MJ qui saisissait « 50 % de résistance au physique » sur un spectre
// doublait sa survie sans que rien ne le lui dise.
//
// Trois règles tiennent le calibrage, et ce sont elles qui font l'intérêt du
// module plutôt que sa table :
//
//   1. **Une résistance à la LIVRAISON coûte des PV.** Le groupe frappe des
//      deux livraisons (la pesée moyenne physique et magique, item-value.js),
//      donc un spectre à 45 % de physique encaisse bien moins par coup moyen :
//      ses PV sont réduits d'autant (`themePvFactor`, calculé sur les deux
//      étages de mitigation du moteur), et il tombe dans le même nombre de
//      tours que son archétype le promet. Une vulnérabilité fait l'inverse.
//   2. **Les résistances ÉLÉMENTAIRES s'équilibrent** : chaque thème qui
//      résiste à un élément en craint un autre pour une somme voisine de zéro.
//      Un groupe ne frappe pas toujours avec le bon élément, donc on ne
//      compense pas en PV — c'est l'équilibre de la table qui le fait, et
//      c'est ce qui récompense le joueur qui lit le monstre.
//   3. **L'état infligé est PAYÉ sur les dés.** Un DOT n'est pas gratuit : son
//      espérance par tour est retirée du budget de la capacité qui le porte
//      (avant mitigation, puisque le DOT ignore l'armure — turn-effects.js),
//      et il est plafonné à 40 % de ce budget. Une brûlure ajoutée ne fait
//      donc pas monter la menace ; elle la déplace dans le temps.

import { archetypeProfile, recommendedAbilities, diceForAverage } from "./monster-archetypes.js";
import { mitigateDamage } from "./combat.js";

const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Catalogue des thèmes.
 *
 * `resist` : plages [min, max] par type de dégâts (clés DAMAGE_TYPES), tirées
 *            par la génération (`rollResistances`, monster-gen.js).
 * `onHit`  : état laissé par la capacité signature — `dot` est une FRACTION de
 *            la menace par tour visée (avant plafond), `mods` des malus plats.
 *            `effectKey`/`label`/`tag` viennent du catalogue d'effets, pour que
 *            l'icône de token s'apparie (status-icons.js : label + tag).
 * `names`  : [attaque de base, capacité spéciale].
 * `move`   : type de déplacement de la créature (movement-types.js).
 */
export const MONSTER_THEMES = [
  {
    key: "aucun", label: "Aucun (créature ordinaire)", icon: "·",
    tag: "neutre", resist: {}, onHit: null, names: null
  },
  {
    key: "bete", label: "Bête sauvage", icon: "🐺", tag: "neutre",
    resist: { feu: [-15, -10], terre: [5, 10] },
    onHit: { effectKey: "saignement", label: "Saignement", tag: "physique", dot: 0.25, duration: 2, removeBaseTN: 10 },
    names: ["Morsure", "Curée"]
  },
  {
    key: "humain", label: "Humanoïde armé", icon: "⚔️", tag: "neutre",
    resist: {},
    onHit: { effectKey: "hemorragie", label: "Hémorragie", tag: "physique", dot: 0.2, duration: 2, removeBaseTN: 11 },
    names: ["Coup d'arme", "Frappe vicieuse"]
  },
  {
    key: "mortvivant", label: "Mort-vivant", icon: "💀", tag: "obscurite",
    resist: { obscurite: [40, 50], glace: [15, 20], lumiere: [-40, -30], feu: [-25, -20], physique: [10, 15] },
    onHit: { effectKey: "affaiblissement", label: "Affaiblissement", tag: "neutre", duration: 2, removeBaseTN: 12,
             mods: [{ stat: "force", value: 2 }, { stat: "endurance", value: 2 }] },
    names: ["Griffe putride", "Étreinte de la tombe"]
  },
  {
    key: "spectre", label: "Spectre", icon: "👻", tag: "obscurite", move: "ethere",
    resist: { physique: [40, 50], obscurite: [50, 60], lumiere: [-50, -40], magique: [-15, -10], feu: [-15, -10] },
    onHit: { effectKey: "frisson", label: "Frisson", tag: "glace", dot: 0.2, duration: 2, removeBaseTN: 12 },
    names: ["Toucher glacé", "Hurlement d'outre-tombe"]
  },
  {
    key: "feu", label: "Créature de feu", icon: "🔥", tag: "feu",
    resist: { feu: [50, 60], eau: [-30, -25], glace: [-30, -25] },
    onHit: { effectKey: "brulure", label: "Brûlure", tag: "feu", dot: 0.3, duration: 2, removeBaseTN: 11 },
    names: ["Griffe ardente", "Souffle de braise"]
  },
  {
    key: "glace", label: "Créature de glace", icon: "❄️", tag: "glace",
    resist: { glace: [50, 60], eau: [15, 20], feu: [-40, -30], eclair: [-15, -10] },
    onHit: { effectKey: "givre", label: "Givre", tag: "glace", duration: 2, removeBaseTN: 11,
             mods: [{ stat: "vitesse", value: 3 }, { stat: "dexterite", value: 2 }] },
    names: ["Morsure de givre", "Blizzard"]
  },
  {
    key: "tempete", label: "Créature d'orage", icon: "⚡", tag: "eclair",
    resist: { eclair: [50, 60], air: [15, 20], terre: [-40, -30], eau: [-15, -10] },
    onHit: { effectKey: "choc", label: "Choc", tag: "eclair", dot: 0.2, duration: 1, removeBaseTN: 10,
             mods: [{ stat: "acuite", value: 2 }] },
    names: ["Décharge", "Foudre en chaîne"]
  },
  {
    key: "pierre", label: "Créature de pierre", icon: "🪨", tag: "terre", move: "terrestre",
    resist: { physique: [20, 25], terre: [50, 60], eclair: [-10, -5], eau: [-35, -30], magique: [-20, -15] },
    onHit: { effectKey: "enlisement", label: "Enlisement", tag: "terre", duration: 2, removeBaseTN: 12,
             mods: [{ stat: "vitesse", value: 4 }] },
    names: ["Poing de roc", "Séisme"]
  },
  {
    key: "venin", label: "Créature venimeuse", icon: "🕷️", tag: "terre",
    resist: { terre: [25, 30], air: [-15, -10], feu: [-15, -10] },
    onHit: { effectKey: "empoisonnement", label: "Empoisonnement", tag: "terre", dot: 0.3, duration: 2, removeBaseTN: 12 },
    names: ["Dard", "Jet de venin"]
  },
  {
    key: "ombre", label: "Créature d'ombre", icon: "🌑", tag: "obscurite",
    resist: { obscurite: [50, 60], air: [10, 15], lumiere: [-50, -40], feu: [-10, -5] },
    onHit: { effectKey: "malediction", label: "Malédiction", tag: "neutre", duration: 2, removeBaseTN: 13,
             mods: [{ stat: "toucherPhysique", value: 1 }, { stat: "toucherMagique", value: 1 }] },
    names: ["Lame d'ombre", "Voile de ténèbres"]
  },
  {
    key: "sacre", label: "Créature sacrée", icon: "☀️", tag: "lumiere",
    resist: { lumiere: [50, 60], feu: [10, 15], obscurite: [-45, -40], eclair: [-10, -5] },
    onHit: { effectKey: "marque", label: "Marque", tag: "neutre", duration: 2, removeBaseTN: 12,
             mods: [{ stat: "scoreResistance", value: 6 }] },
    names: ["Châtiment", "Jugement"]
  },
  {
    key: "abysse", label: "Créature des profondeurs", icon: "🌊", tag: "eau", move: "aquatique",
    resist: { eau: [50, 60], glace: [10, 15], eclair: [-40, -35], terre: [-15, -10] },
    onHit: { effectKey: "noyade", label: "Noyade", tag: "eau", dot: 0.2, duration: 2, removeBaseTN: 11, fatigue: 1 },
    names: ["Tentacule", "Lame de fond"]
  }
];

export function getTheme(key) {
  return MONSTER_THEMES.find(t => t.key === String(key ?? "")) ?? MONSTER_THEMES[0];
}

/** Centre d'une plage [min, max]. */
const mid = (r) => (Array.isArray(r) ? (n(r[0]) + n(r[1])) / 2 : 0);

/**
 * Facteur de PV d'un thème : compense la résistance aux deux livraisons.
 *
 * Le groupe frappe des deux livraisons (la pesée de survie moyenne la
 * mitigation physique et magique, item-value.js) : on calcule ce qu'un coup
 * moyen du groupe inflige réellement à la créature AVEC et SANS les
 * résistances du thème — mêmes deux étages que le moteur : armure/résistance
 * (`mitigateDamage`, plancher 1) puis pourcentage élémentaire — et les PV
 * sont multipliés par le rapport. Une simple règle « 1 − rés/200 » se
 * trompait de 15 % sur un spectre blindé : les deux étages ne s'additionnent
 * pas, l'arrondi et le plancher mordent avant le pourcentage.
 *
 * Sans niveau/archétype (aperçu hors contexte), on retombe sur la règle
 * linéaire. Borné à [0,5 ; 1,5] : au-delà, le thème cesse d'être une saveur
 * et devient une autre créature.
 */
export function themePvFactor(theme, level = null, archKey = null) {
  const t = typeof theme === "string" ? getTheme(theme) : theme;
  const phys = mid(t?.resist?.physique);
  const mag  = mid(t?.resist?.magique);
  if (!phys && !mag) return 1;
  let f = 1 - (phys + mag) / 200;
  if (level != null && archKey) {
    const p = archetypeProfile(level, archKey);
    const D = n(p.party.damagePerHit, 7);
    const a = p.archetype;
    const ph = mitigateDamage(D, p.defenses.armureFixe, a.armPct);
    const mg = mitigateDamage(D, p.defenses.resistanceFixe, a.resPct);
    const withElem = (v, pct) => Math.max(0, v * (1 - pct / 100));
    const before = ph + mg;
    const after  = withElem(ph, phys) + withElem(mg, mag);
    if (before > 0) f = after / before;
  }
  return Math.min(1.5, Math.max(0.5, f));
}

/**
 * Applique un thème à une bande produite par `buildBand` — en place et
 * renvoyée. Les PV sont multipliés par `themePvFactor` (donner le niveau et
 * l'archétype de la bande pour le calcul exact), les résistances
 * remplacées par celles du thème. Un thème « aucun » ne touche à rien.
 */
export function applyThemeToBand(band, themeKey, level = null, archKey = null) {
  const t = getTheme(themeKey);
  if (!band || t.key === "aucun") return band;
  const f = themePvFactor(t, level, archKey);
  if (f !== 1) {
    // PV ET régénération : la survie vaut PV ÷ (dégâts reçus − régen), donc
    // réduire les dégâts reçus d'un facteur f sans toucher la régen allonge
    // le combat bien plus que f (constaté sur un boss spectral : +20 %).
    // Les deux à l'échelle, et le nombre de tours retombe sur celui promis.
    if (Array.isArray(band.pv)) band.pv = band.pv.map(v => Math.max(1, Math.round(n(v) * f)));
    if (Array.isArray(band.regenPv)) band.regenPv = band.regenPv.map(v => Math.max(0, Math.round(n(v) * f)));
  }
  band.resistancesElem = band.resistancesElem ?? {};
  for (const [k, r] of Object.entries(t.resist ?? {})) {
    if (Array.isArray(r)) band.resistancesElem[k] = [n(r[0]), n(r[1])];
  }
  return band;
}

/**
 * Espérance de dégâts par tour d'un DOT porté par une capacité.
 *
 * `rate` = utilisations par tour (1 pour une attaque de base, 1/(1+cd) pour
 * une capacité à recharge). Le moteur RAFRAÎCHIT l'état sur un second coup
 * (même id d'état : spell_<item>_<fx>_<cible>, spells.js) au lieu de
 * l'empiler : l'état est actif avec la probabilité 1 − (1 − p)^durée, et
 * c'est ce qu'on paie — pas `dot × durée` par coup, qui compterait deux fois
 * les tours où il était déjà là.
 */
export function dotExpectedPerTurn(dot, duration, hitChance, rate = 1) {
  const p = Math.min(1, Math.max(0, n(hitChance) * n(rate, 1)));
  const d = Math.max(1, n(duration, 1));
  return n(dot) * (1 - Math.pow(1 - p, d));
}

/**
 * Capacités thématisées : les capacités recommandées de l'archétype, renommées,
 * passées dans l'élément du thème, et dont la signature (la spéciale si
 * l'archétype en a une, l'attaque de base sinon) pose l'état du thème — ses
 * dés diminués de ce que l'état rapporte (règle 3 de l'en-tête).
 *
 * Renvoie la même forme que `recommendedAbilities`, enrichie de `tag` et de
 * `effect` ; `themedAbilityItemData` en fait des données d'item.
 */
export function themedAbilities(level, archKey, themeKey, opts = {}) {
  const t = getTheme(themeKey);
  const p = archetypeProfile(level, archKey, opts);
  const specs = recommendedAbilities(level, archKey, opts).map(s => ({ ...s }));
  if (t.key === "aucun") return specs;

  const isMagic = p.archetype.livraison === "magique";
  specs.forEach((s, i) => {
    if (t.names?.[i]) s.label = t.names[i];
    // Le mage garde un nom de sort lisible s'il n'a qu'une capacité.
    if (isMagic && i === 0 && t.names?.[1] && specs.length === 1) s.label = t.names[1];
    s.tag = t.tag || "neutre";
  });

  const fx = t.onHit;
  if (!fx) return specs;
  const sigIdx = specs.length > 1 ? 1 : 0;
  const sig = specs[sigIdx];
  const hit = p.menace.hitM;
  const rate = 1 / (1 + n(sig.cooldown, 0));
  // Budget « posé » de la signature, par UTILISATION, en dégâts encaissés :
  // 0,6 × la menace par tour pour une base d'élite/boss, 2 × pour sa spéciale,
  // 1 × pour un archétype sans spéciale (monster-archetypes.js, section 4).
  const goal = n(p.menace.parTour);
  const perUseGoal = specs.length > 1 ? (sigIdx === 1 ? 2 : 0.6) * goal : goal;

  let dot = 0;
  if (n(fx.dot) > 0) {
    dot = Math.max(1, Math.round(goal * n(fx.dot)));
    // Plafond : l'état ne porte jamais plus de 40 % de la capacité.
    const share = () => dotExpectedPerTurn(dot, fx.duration, hit, rate) / Math.max(0.1, rate);
    while (dot > 1 && share() > 0.4 * perUseGoal) dot -= 1;
    const dotPerUse = share();
    const red = Math.max(0.3, 1 - n(p.party.reductionPct) / 100);
    const raw = (perUseGoal - dotPerUse) / Math.max(0.05, hit) / red - n(p.menace.statBonus);
    const d = diceForAverage(raw);
    sig.dice = d.dice; sig.flat = d.flat;
  }

  sig.effect = {
    effectKey: fx.effectKey, label: fx.label, tag: fx.tag,
    duration: Math.max(1, n(fx.duration, 1)), removeBaseTN: n(fx.removeBaseTN, 11),
    dot, fatigue: n(fx.fatigue, 0),
    // Les malus montent doucement avec le niveau (+1 tous les 4 niveaux) :
    // un −2 de Force pèse lourd au niveau 1, rien au niveau 12.
    mods: (fx.mods ?? []).map(m => ({ stat: m.stat, value: n(m.value) + Math.floor((Math.max(1, n(level, 1)) - 1) / 4) }))
  };
  sig.note = `${sig.note} · pose « ${fx.label} »` + (dot ? ` (${dot}/tour, payé sur les dés)` : "");
  return specs;
}

/** Données d'item `spell` pour une capacité thématisée (forme d'abilityItemData + effet). */
export function themedAbilityItemData(spec, { img = "icons/svg/sword.svg" } = {}) {
  const fx = spec.effect;
  const effectsUI = fx ? [{
    id: `theme-${fx.effectKey || "etat"}`,
    label: fx.label, effectKey: fx.effectKey ?? "", tag: fx.tag ?? "",
    when: "hit", target: "target",
    duration: fx.duration, permanent: false,
    removeBaseTN: fx.removeBaseTN, retraitMod: 0,
    resistDamageTag: "", resistDamagePct: 0,
    resistTag: "", resistDurationReduction: 0, resistDotPct: 0, resistImmune: false,
    movementTypeGrant: "",
    fatigueDot: n(fx.fatigue, 0),
    tick: fx.dot > 0
      ? { mode: "damage", flat: fx.dot, stat: "", per: 10, perStep: 0, livraison: spec.livraison }
      : { mode: "none", flat: 0, stat: "", per: 10, perStep: 0, livraison: spec.livraison },
    isAura: false, auraMin: 0, auraMax: 0, auraTarget: "allies",
    mods: (fx.mods ?? []).map(m => ({ stat: m.stat, mode: "flat", sens: "malus", value: Math.abs(n(m.value)) }))
  }] : [];

  return {
    name: spec.label,
    type: "spell",
    img,
    system: {
      speed: spec.speed ?? "normal",
      livraison: spec.livraison,
      difficulte: spec.difficulte ?? 0,
      coutMana: spec.coutMana ?? 0,
      fatigueCost: spec.fatigueCost ?? 1,
      range: { min: 0, max: spec.portee ?? 1.5 },
      targetCount: { min: 1, max: spec.cibles ?? 1 },
      cooldown: { max: spec.cooldown ?? 0, restant: 0 },
      tag: spec.tag ?? "neutre",
      damages: [{
        dice: spec.dice, flat: spec.flat,
        stat: spec.stat, per: spec.per ?? 10, perStep: spec.perStep ?? 1,
        critDice: "", critFlat: 0, siphon: 0,
        livraison: spec.livraison,
        // Vide = l'élément du sort (spells.js : b.tag ?? item.system.tag) ;
        // jamais "" (CLAUDE.md, « Une ligne de dégâts porte son propre élément »).
        tag: null
      }],
      effectsUI,
      description: spec.note ?? ""
    }
  };
}

/** Moyenne d'un « XdY » (dés seuls). */
function diceAvg(expr) {
  const m = String(expr ?? "").match(/^(\d+)d(\d+)$/);
  return m ? Number(m[1]) * (Number(m[2]) + 1) / 2 : 0;
}

/**
 * Capacités pour TOUTE une fourchette de niveaux.
 *
 * `themedAbilities(niveau)` dimensionne les dés pour UN niveau, alors qu'un
 * monstre « 3,4,5 » est posé à l'un des trois : l'exemplaire de niveau 3
 * frappait comme un niveau 4, celui de niveau 5 aussi. Mesuré sur le
 * bestiaire : une goule passait de 45 (Élite) à 30 (Sérieux) de pesée d'un
 * bout à l'autre de sa fourchette, une Dame Noyée de 268 à 189.
 *
 * Le moteur sait déjà faire monter des dégâts avec le niveau, sans une ligne
 * de code de plus : une ligne de dégâts ajoute ⌊stat ÷ per⌋ × perStep, et la
 * Force/l'Intelligence EFFECTIVE d'un monstre monte avec son niveau (centre
 * de bande, qui suit la référence du groupe, + 1 par niveau, actor.js). On
 * cherche donc le `per` (1 à 10) qui reproduit le mieux, niveau par niveau,
 * les dégâts bruts que chaque niveau demande, et des dés fixes pour le reste.
 * L'exemplaire tiré au niveau 3 frappe alors comme un niveau 3.
 *
 * Avec un seul niveau, c'est `themedAbilities` tel quel.
 */
export function themedAbilitiesForLevels(levels, archKey, themeKey) {
  const lv = Array.from(new Set((levels ?? []).map(Number).filter(v => v > 0))).sort((a, b) => a - b);
  if (!lv.length) return themedAbilities(1, archKey, themeKey);
  const mid = lv[Math.floor(lv.length / 2)];
  const out = themedAbilities(mid, archKey, themeKey);
  if (lv.length < 2) return out;

  const per = lv.map(l => ({
    l,
    p: archetypeProfile(l, archKey),
    specs: themedAbilities(l, archKey, themeKey)
  }));
  out.forEach((spec, i) => {
    const stat = spec.stat;
    // Brut visé à chaque niveau (dés + plat + bonus de stat que la capacité
    // « par 10 » supposait), et la stat effective qu'aura l'exemplaire.
    const pts = per.map(({ l, p, specs }) => {
      const s = specs[i];
      const S = n(p.stats?.[stat]) + l;
      return { R: diceAvg(s.dice) + n(s.flat) + Math.floor(n(p.stats?.[stat]) / 10), S };
    });
    let best = null;
    for (let d = 1; d <= 10; d++) {
      const base = pts.reduce((acc, q) => acc + (q.R - Math.floor(q.S / d)), 0) / pts.length;
      if (base < 1) continue;
      const err = pts.reduce((acc, q) => acc + (q.R - base - Math.floor(q.S / d)) ** 2, 0);
      if (!best || err < best.err - 1e-9) best = { d, base, err };
    }
    if (!best) return;
    const dd = diceForAverage(best.base);
    spec.dice = dd.dice; spec.flat = dd.flat;
    spec.per = best.d; spec.perStep = 1;
    spec.note = `${spec.note} · +1 dégât par ${best.d} ${stat === "force" ? "Force" : "Intelligence"} (suit le niveau ${lv[0]}–${lv[lv.length - 1]})`;
  });
  return out;
}
