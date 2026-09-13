// module/rules/aura-target.js
//
// Qui une aura vise — et, ce qui en découle, ce que son PORTEUR subit.
//
// Vit dans son propre module sans aucune dépendance, comme effect-tick.js et
// pour la même raison : trois mondes qui ne peuvent pas s'importer l'un
// l'autre en ont besoin (auras.js pour construire la copie, turn-effects.js
// pour le dégât par tour, status-effects.js pour les mods de stats). Une
// seconde copie de cette règle, c'était la garantie qu'elles finiraient par
// répondre différemment à la même question.
//
// ── La règle, et pourquoi elle a dû être écrite ────────────────────────────
//
// L'émetteur ne reçoit JAMAIS de copie de sa propre aura : refreshAuras saute
// explicitement son propre token (`targetToken.id === sourceToken.id`). Mais
// il porte l'état SOURCE, et cet état est, pour tout le reste du moteur, un
// état actif ordinaire — donc son dégât par tour tombait sur lui et ses mods
// de stats s'appliquaient à lui. Une aura « 1 + Int÷10 dégâts/tour · ennemis »
// blessait donc son propre lanceur à chaque tour, sans que rien ne le dise :
// symptôme rapporté tel quel sur un sort « Courant continu ».
//
// Ce comportement n'était pourtant pas gratuit — c'est lui qui fait qu'une
// aura de SOIN soigne aussi son porteur, l'émetteur ne recevant pas de copie.
// On ne peut donc pas simplement couper le paiement de l'état source : il faut
// le couper là où l'aura ne vise pas son porteur, et nulle part ailleurs.
//
// D'où la coupure : une aura dont la cible est « ennemis » est une ÉMISSION,
// pas un effet porté. Une aura « alliés » ou « tous » continue de payer son
// porteur, exactement comme avant.
//
// Ce qui reste délibérément appliqué au porteur, même pour une aura
// « ennemis » : ce qui le PROTÈGE (résistances accordées, bonus de dégâts aux
// attaques). L'archétype « Fournaise » — je brûle ce qui m'entoure ET je
// résiste au feu — s'écrit en un seul effet, et le couper lui retirerait la
// moitié utile. Le porteur ne subit plus ce qui blesse ; il garde ce qui aide.

/**
 * L'aura porte-t-elle quelque chose de NUISIBLE ?
 *
 * Sert uniquement de repli quand le MJ n'a pas choisi de cible explicite sur
 * l'effet : un DOT ou un malus de stat se déduit comme visant les ennemis.
 */
export function auraHasHarm(auraState) {
  const dot = Number(auraState?.dot?.perTick ?? auraState?.dot?.flat ?? 0) || 0;
  if (dot > 0) return true;

  const mods = auraState?.mods ?? {};
  for (const m of Object.values(mods)) {
    const flat = Number(m?.flat ?? 0) || 0;
    const pct  = Number(m?.pct ?? 0) || 0;
    if (flat < 0 || pct < 0) return true;
  }
  return false;
}

/**
 * Cible de l'aura : la valeur choisie par le MJ sur l'effet
 * (aura.target = allies | enemies | both) fait foi. Sans choix explicite,
 * on déduit du contenu : buff => alliés, malus/DOT => ennemis.
 */
export function auraTargetOf(auraState) {
  const explicit = String(auraState?.aura?.target ?? "").trim().toLowerCase();
  if (explicit === "allies" || explicit === "enemies" || explicit === "both") return explicit;
  return auraHasHarm(auraState) ? "enemies" : "allies";
}

/**
 * Cet état doit-il payer son PORTEUR (dégât par tour, fatigue par tour,
 * mods de stats) ?
 *
 * Faux uniquement pour l'état SOURCE d'une aura qui ne vise que les ennemis.
 * Tout le reste — un état ordinaire, une copie reçue (`type: "auraApplied"`,
 * qui ne porte pas `isAura`), une aura « alliés » ou « tous » — répond vrai,
 * donc rien de ce qui existait ne change de comportement.
 */
export function auraAffectsBearer(state) {
  if (!state?.isAura) return true;
  return auraTargetOf(state) !== "enemies";
}
