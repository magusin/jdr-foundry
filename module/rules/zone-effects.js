// module/rules/zone-effects.js
//
// Zones de terrain avec effet : pièges cachés déclenchés au passage, murs de
// ronces/glace posés par un sort de zone, nuage toxique qui empoisonne qui
// s'y attarde... Un seul comportement de région générique (zoneEffet),
// configurable par le MJ, réutilisé pour tous ces cas :
//   - dégâts directs à l'entrée (formule de dés + type de livraison)
//   - état actif appliqué à l'entrée (label, durée, DOT, malus de vitesse)
//   - ralentissement (jusqu'à quasi-impassable) — pas de vrai refus de
//     passage, cohérent avec le reste du système de terrain (region-
//     behaviors.js documente "impassable" mais ne l'applique nulle part)
//   - masquée aux joueurs (piège) ou visible (mur de glace d'un sort)
//   - détectable par un jet de Perception (declareZonePerceptionCheck)
//
// Déclenchement : automatique, mais seulement à la VALIDATION MJ du
// déplacement (action-confirm.js, branche "move" confirmée) — jamais avant,
// pour rester dans le flux déclare → MJ valide → résout du reste du système.

import { computeFinalDamage, applyFinalDamage } from "./combat.js";
import { hpSecret } from "./chat-visibility.js";
import { isImmuneToTerrain } from "./movement-types.js";
import { applyResistances } from "./resistances.js";
import { listEffects, EFFECT_TAGS } from "./effect-library.js";
import { applyUiTheme } from "../sheets/sheet-helpers.js";

// Clé NON préfixée : comme pour Actor/Item (Actors.registerSheet("rpg", ...,
// { types: ["character"] }) — jamais "rpg.character"), un sous-type de
// document déclaré par le SYSTÈME lui-même dans system.json n'est pas
// préfixé par l'id du système ; seul un MODULE préfixerait ("moduleid.type").
// Un "rpg." ici ferait que CONFIG.RegionBehavior.dataModels ne contient
// jamais la clé que Foundry assigne réellement au document créé depuis le
// menu « Ajouter un comportement » (qui lit system.json tel quel).
export const BEHAVIOR_KEY = "zoneEffet";

function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }

function slugKey(s) {
  return String(s ?? "")
    .trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "zone";
}

function _pointInRegion(region, x, y) {
  try {
    if (region.document?.testPoint) return region.document.testPoint({ x, y });
    if (region.polygon?.contains) return region.polygon.contains(x, y);
    if (region.polygons?.some(p => p.contains?.(x, y))) return true;
    const b = region.bounds;
    if (b && !(x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)) return false;
    return true;
  } catch { return false; }
}

/**
 * Convertit `system.effectMods` (tableau [{stat, mode, value}], value déjà
 * SIGNÉE — négatif = malus, même convention que normMods() dans la fiche de
 * sort) vers le format {stat: {flat, pct}} que sumActiveEffectMods() (status-
 * effects.js) lit pour calculer les stats dérivées. C'est le format MODERNE
 * (KEY_TO_BUCKET y couvre toucherPhysique/toucherMagique/fatigueMax/podsMax
 * en plus des stats de base) — pas l'ancien modsFlat.groupe.stat restreint
 * qu'utilisait applyEffect() d'status-effects.js, qui ignorait silencieusement
 * ces 4 stats-là faute de bucket prévu pour elles.
 */
function modsToBuckets(entries) {
  const out = {};
  for (const m of (Array.isArray(entries) ? entries : [])) {
    const stat = String(m?.stat ?? "").trim();
    if (!stat) continue;
    const mode = m?.mode === "pct" ? "pct" : "flat";
    const v = n(m?.value, 0);
    if (!out[stat]) out[stat] = { flat: 0, pct: 0 };
    out[stat][mode] += v;
  }
  return out;
}

/**
 * Applique un état de zone/piège à une cible, résistances comprises (même
 * primitive — applyResistances() de resistances.js — que le système de
 * sorts ; ce fichier est explicitement cité dans son en-tête comme un futur
 * consommateur : "sorts, catalogue MJ, futurs pièges"). Remplace par clé
 * (stacking "replace") plutôt que d'empiler : redéclencher la même zone
 * persistante sur la même cible rafraîchit sa durée au lieu d'accumuler des
 * doublons — même règle que applyEffect() qu'on remplace ici.
 */
async function applyZoneStateEffect(actor, state) {
  const adjusted = applyResistances(actor, state);
  if (adjusted?._resisted) {
    return { applied: false, resisted: true, resistanceInfo: adjusted.resistanceInfo };
  }

  const current = Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
  const next = current.filter(e => e?.key !== adjusted.key);
  next.push({ ...adjusted, id: adjusted.id || foundry.utils.randomID() });

  await actor.update({ "system.etatsActifs": next });
  if (game.rpg?.status?.recompute) await game.rpg.status.recompute(actor);

  return { applied: true, resisted: false, state: adjusted };
}

/** Régions actives à (x,y) portant un comportement zoneEffet. */
export function getZoneEffectsAt(x, y) {
  if (!canvas?.regions?.placeables) return [];
  const out = [];
  for (const region of canvas.regions.placeables) {
    if (!_pointInRegion(region, x, y)) continue;
    for (const behavior of (region.document?.behaviors ?? [])) {
      if (String(behavior.type ?? "") !== BEHAVIOR_KEY) continue;
      if (behavior.system?.enabled === false) continue;
      out.push({ region, behavior });
    }
  }
  return out;
}

/** Multiplicateur de vitesse le plus pénalisant parmi les zones à ce point (1 = aucun). */
export function getZoneSpeedMultAt(x, y) {
  let mult = 1;
  for (const { behavior } of getZoneEffectsAt(x, y)) {
    const m = n(behavior.system?.speedMult, 1);
    if (m < mult) mult = m;
  }
  return mult;
}

/**
 * Déclenche les zones présentes à la position d'arrivée d'un token, après
 * validation MJ du déplacement. Applique dégâts + effet, marque la zone
 * comme révélée (elle vient de se manifester) et poste un message.
 */
export async function triggerZoneEffectsForToken({ actor, tokenId, x, y }) {
  if (!game.user.isGM || !actor) return;
  const zones = getZoneEffectsAt(x, y);
  if (!zones.length) return;

  for (const { region, behavior } of zones) {
    const sys = behavior.system ?? {};
    const triggered = Array.isArray(sys.triggeredTokens) ? sys.triggeredTokens : [];
    if (sys.onceOnly && tokenId && triggered.includes(tokenId)) continue;

    // Piège « au sol uniquement » (par défaut) : un acteur volant ou éthéré
    // passe au-dessus sans jamais le déclencher. Décoché sur la fiche pour
    // un nuage toxique ou une zone de sort censée toucher tout le monde.
    if (sys.groundOnly !== false && isImmuneToTerrain(actor, "zoneEffetSol")) continue;

    const label = String(sys.label ?? "").trim() || "Zone";
    const lines = [];

    // ── Dégâts directs ──────────────────────────────────────────────────
    const formula = String(sys.damageFormula ?? "").trim();
    if (formula) {
      try {
        const roll = await (new Roll(formula)).evaluate();
        const livraison = String(sys.damageLivraison ?? "physique");
        const { final } = computeFinalDamage({ targetActor: actor, livraison, rawDamage: roll.total });
        await applyFinalDamage({ targetActor: actor, finalDamage: final });
        const pv = Number(actor.system?.ressources?.pv?.valeur ?? 0);
        const pvMax = Number(actor.system?.ressources?.pv?.max ?? 0);
        lines.push(`💥 <b>${final}</b> dégâts (${livraison}, brut ${roll.total})` + hpSecret(actor, ` — PV: ${pv}/${pvMax}`));
      } catch (e) {
        console.warn("[RPG][Zone] formule de dégâts invalide:", formula, e);
      }
    }

    // ── État appliqué ────────────────────────────────────────────────────
    const effectLabel = String(sys.effectLabel ?? "").trim();
    if (effectLabel) {
      const dotPerTick = n(sys.effectDotPerTick, 0);
      // La zone/piège stocke sa propre étiquette libre (compat des zones déjà
      // configurées), mais on la fait correspondre au catalogue quand elle y
      // figure — même clé/tag qu'un sort appliquant le même effet, pour que
      // les résistances par tag (résistances.js) et le remplacement par clé
      // (applyZoneStateEffect ci-dessus) fonctionnent pareil dans les deux cas.
      const def = listEffects().find(e => e.label === effectLabel);
      const result = await applyZoneStateEffect(actor, {
        key: def?.key ?? slugKey(effectLabel),
        label: effectLabel,
        tag: def?.tag ?? null,
        duration: Math.max(1, n(sys.effectDuration, 1)),
        remaining: Math.max(1, n(sys.effectDuration, 1)),
        cleanseDC: 0,
        dot: dotPerTick > 0 ? { perTick: dotPerTick, flat: dotPerTick } : {},
        mods: modsToBuckets(sys.effectMods)
      });
      if (result.resisted) {
        lines.push(`🛡️ <b>${effectLabel}</b> résisté${result.resistanceInfo?.immune ? " (immunité)" : ""}`);
      } else {
        lines.push(`✨ État appliqué : <b>${effectLabel}</b>`);
      }
    }

    if (!lines.length) continue; // zone purement passive (ralentissement seul) : rien à annoncer

    // Marque déclenché / révélé
    const updates = {};
    if (sys.onceOnly) updates.triggeredTokens = [...triggered, tokenId].filter(Boolean);
    const revealed = Array.isArray(sys.revealedActorIds) ? sys.revealedActorIds : [];
    if (!revealed.includes(actor.id)) updates.revealedActorIds = [...revealed, actor.id];
    if (Object.keys(updates).length) {
      await behavior.update({ system: updates }).catch(e => console.warn("[RPG][Zone] maj comportement:", e));
    }

    await ChatMessage.create({
      speaker: { alias: label },
      content: `<div style="font-size:13px;padding:4px 0">
        <div style="font-weight:700;margin-bottom:3px">${sys.hidden ? "⚠️ Piège déclenché" : "🌀 Zone"} — ${label}</div>
        <div>${actor.name} : ${lines.join("<br>")}</div>
      </div>`
    });
  }
}

/**
 * Déclare un jet de Perception pour détecter une zone cachée (piège). Sur
 * réussite (validation MJ du jet), la zone est marquée révélée pour cet
 * acteur et un message décrit ce qui a été repéré — au MJ de choisir
 * ensuite comment le montrer sur la carte si besoin.
 */
export async function declareZonePerceptionCheck(actor, region, behavior) {
  const sys = behavior.system ?? {};
  const dc = Math.max(1, n(sys.detectDC, 12));
  const skill = actor.system?.skills?.perception;
  const skillLevel = n(skill?.level, 0);
  const tn = Math.max(1, dc - skillLevel);
  const speaker = ChatMessage.getSpeaker({ actor });

  const content = `
    <div style="font-size:13px">
      🔍 <b>${actor.name}</b> — Perception
      <div style="opacity:.85;font-size:12px;margin-top:2px">Objectif : <b>${tn}+</b> sur 1d20${skillLevel ? ` (DD ${dc} − niv.${skillLevel})` : ""}</div>
      <button type="button" class="rpg-zonecheck-roll-btn"
        data-actor-id="${actor.id}" data-tn="${tn}"
        data-region-id="${region.id}" data-behavior-id="${behavior.id}" data-scene-id="${region.parent?.id ?? region.scene?.id ?? canvas?.scene?.id ?? ""}"
        style="width:100%;margin-top:8px;padding:5px;cursor:pointer;border-radius:6px;font-weight:600">
        🎲 Lancer le dé
      </button>
    </div>`;

  await ChatMessage.create({ speaker, content });
  await ChatMessage.create({
    speaker,
    content: `<div style="font-size:11px;color:#c8960a;padding:5px;border:1px solid rgba(200,150,0,0.3);border-radius:6px">
      ⚙️ MJ — ${actor.name} → Perception vs <b>${sys.label || "Zone"}</b><br>
      DD : ${dc} | Niveau compétence : ${skillLevel} | <b>TN réel : ${tn}+</b>
    </div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}

/**
 * Déclare un jet de Crochetage pour désamorcer un piège déjà repéré. Sur
 * réussite (validation MJ du jet), le comportement est désactivé : la zone
 * ne se déclenchera plus jamais, pour personne — c'est une désactivation
 * définitive de CE piège, pas un simple contournement pour l'acteur qui a
 * réussi. Un échec ne fait rien de plus qu'échouer : on ne fait pas sauter
 * le piège au nez du joueur qui tente de le désamorcer (le MJ choisit
 * librement une conséquence narrative si la scène s'y prête).
 */
export async function declareZoneDisarmCheck(actor, region, behavior) {
  const sys = behavior.system ?? {};
  const dc = Math.max(1, n(sys.disarmDC, 14));
  const skill = actor.system?.skills?.crochetage;
  const skillLevel = n(skill?.level, 0);
  const tn = Math.max(1, dc - skillLevel);
  const speaker = ChatMessage.getSpeaker({ actor });

  const content = `
    <div style="font-size:13px">
      🛠️ <b>${actor.name}</b> — Crochetage (désamorçage)
      <div style="opacity:.85;font-size:12px;margin-top:2px">Objectif : <b>${tn}+</b> sur 1d20${skillLevel ? ` (DD ${dc} − niv.${skillLevel})` : ""}</div>
      <button type="button" class="rpg-zonedisarm-roll-btn"
        data-actor-id="${actor.id}" data-tn="${tn}"
        data-region-id="${region.id}" data-behavior-id="${behavior.id}" data-scene-id="${region.parent?.id ?? region.scene?.id ?? canvas?.scene?.id ?? ""}"
        style="width:100%;margin-top:8px;padding:5px;cursor:pointer;border-radius:6px;font-weight:600">
        🎲 Lancer le dé
      </button>
    </div>`;

  await ChatMessage.create({ speaker, content });
  await ChatMessage.create({
    speaker,
    content: `<div style="font-size:11px;color:#c8960a;padding:5px;border:1px solid rgba(200,150,0,0.3);border-radius:6px">
      ⚙️ MJ — ${actor.name} → Crochetage (désamorçage) vs <b>${sys.label || "Zone"}</b><br>
      DD : ${dc} | Niveau compétence : ${skillLevel} | <b>TN réel : ${tn}+</b>
    </div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}

/** Désactive définitivement un piège et prévient sa table (MJ + propriétaires). */
export async function disarmZone(region, behavior, actor) {
  const sys = behavior.system ?? {};
  if (sys.enabled !== false) await behavior.update({ system: { enabled: false } });
  const whisperIds = [
    ...game.users.filter(u => u.isGM).map(u => u.id),
    ...game.users.filter(u => actor.testUserPermission?.(u, "OWNER")).map(u => u.id)
  ];
  await ChatMessage.create({
    content: `🛠️ <b>${actor.name}</b> désamorce <b>${sys.label || region?.name || "un piège"}</b> — il ne se déclenchera plus.`,
    whisper: [...new Set(whisperIds)]
  });
}

/** Marque la zone révélée pour cet acteur et prévient sa table (MJ + propriétaires). */
export async function revealZoneToActor(region, behavior, actor) {
  const sys = behavior.system ?? {};
  const revealed = Array.isArray(sys.revealedActorIds) ? sys.revealedActorIds : [];
  if (!revealed.includes(actor.id)) {
    await behavior.update({ system: { revealedActorIds: [...revealed, actor.id] } });
  }
  const whisperIds = [
    ...game.users.filter(u => u.isGM).map(u => u.id),
    ...game.users.filter(u => actor.testUserPermission?.(u, "OWNER")).map(u => u.id)
  ];
  await ChatMessage.create({
    content: `🔍 <b>${actor.name}</b> repère quelque chose de suspect : <b>${sys.label || region?.name || "une zone cachée"}</b>.`,
    whisper: [...new Set(whisperIds)]
  });
}

/**
 * Enregistre le comportement de région dans Foundry V13.
 * Appelé depuis init.js dans le hook "init".
 */
export function registerZoneEffectBehavior() {
  if (!CONFIG.RegionBehavior?.dataModels) {
    console.warn("[RPG] CONFIG.RegionBehavior non disponible — Foundry V13+ requis.");
    return;
  }
  if (CONFIG.RegionBehavior.dataModels[BEHAVIOR_KEY]) return;

  // Les comportements NATIFS de Foundry (TeleportToken, ToggleBehavior…)
  // dérivent de foundry.data.regionBehaviors.RegionBehaviorType — une
  // sous-classe de TypeDataModel propre aux RegionBehavior — et non du
  // TypeDataModel générique. Une version de Foundry qui se met à exiger
  // cette base précise pour qu'un sous-type apparaisse dans le menu
  // « Ajouter un comportement » (ou s'instancie sans planter) rend nos
  // comportements invisibles/instables tant qu'ils héritent du générique —
  // d'où le repli défensif si l'espace de nom n'existe pas encore (anciennes
  // versions). On surcharge defineSchema() SANS appeler super() : le champ
  // "events" que RegionBehaviorType ajoute par défaut ne nous sert pas, nos
  // déclenchements passent par nos propres hooks (action-confirm.js).
  const RegionBehaviorTypeBase = foundry.data?.regionBehaviors?.RegionBehaviorType
                               ?? foundry.abstract.TypeDataModel;

  class ZoneEffectBehavior extends RegionBehaviorTypeBase {
    static defineSchema() {
      const fields = foundry.data.fields;
      return {
        enabled:           new fields.BooleanField({ initial: true }),
        label:             new fields.StringField({ initial: "" }),
        hidden:            new fields.BooleanField({ initial: true }),
        onceOnly:          new fields.BooleanField({ initial: true }),
        // Ignoré par un acteur volant/éthéré (vol, lévitation...) — décocher
        // pour un nuage toxique ou un mur de zone censé toucher tout le monde.
        groundOnly:        new fields.BooleanField({ initial: true }),
        detectDC:          new fields.NumberField({ initial: 12, min: 1, max: 25 }),
        disarmDC:          new fields.NumberField({ initial: 14, min: 1, max: 25 }),
        speedMult:         new fields.NumberField({ initial: 1, min: 0.1, max: 1 }),
        damageFormula:     new fields.StringField({ initial: "" }),
        damageLivraison:   new fields.StringField({ initial: "physique", choices: ["physique", "magique"] }),
        effectLabel:       new fields.StringField({ initial: "" }),
        effectDuration:    new fields.NumberField({ initial: 1, min: 1, max: 20 }),
        effectDotPerTick:  new fields.NumberField({ initial: 0, min: 0 }),
        // Remplace l'ancien effectVitesseFlat (un seul nombre, vitesse
        // uniquement) — un tableau de modificateurs de stat, même forme que
        // system.effectsUI[].mods sur la fiche de sort (item-spell-sheet-v2.js),
        // pour offrir la même palette de stats (pas seulement la vitesse) et
        // la même UI d'édition (voir ZoneEffectBehaviorSheet ci-dessous).
        // Une zone/piège déjà configurée AVANT ce changement gardait sa
        // valeur dans effectVitesseFlat côté données brutes (Foundry ignore
        // simplement une clé qui ne fait plus partie du schéma) : à
        // ressaisir manuellement ici si besoin, aucune migration auto.
        effectMods:        new fields.ArrayField(new fields.SchemaField({
          stat:  new fields.StringField({ initial: "vitesse" }),
          sens:  new fields.StringField({ initial: "malus", choices: ["bonus", "malus"] }),
          mode:  new fields.StringField({ initial: "flat", choices: ["flat", "pct"] }),
          value: new fields.NumberField({ initial: 0 })
        }), { initial: [] }),
        triggeredTokens:   new fields.ArrayField(new fields.StringField(), { initial: [] }),
        revealedActorIds:  new fields.ArrayField(new fields.StringField(), { initial: [] })
      };
    }
  }
  Object.defineProperty(ZoneEffectBehavior, "name", { value: "ZoneEffectBehavior" });

  CONFIG.RegionBehavior.dataModels[BEHAVIOR_KEY] = ZoneEffectBehavior;
  if (CONFIG.RegionBehavior.typeLabels) CONFIG.RegionBehavior.typeLabels[BEHAVIOR_KEY] = "Piège / Zone à effet (RPG)";
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[BEHAVIOR_KEY] = "fas fa-burst";

  console.log(`[RPG] Comportement région enregistré : ${BEHAVIOR_KEY}`);
}

// Même liste que STAT_LABELS dans item-spell-sheet-v2.js (dupliquée comme
// dans les autres consommateurs de ce catalogue — apply-effect.js, spells.js
// — plutôt que centralisée : trop petit pour justifier un module partagé).
const STAT_LABELS = {
  force: "Force", dexterite: "Dextérité", intelligence: "Intelligence",
  acuite: "Acuité", endurance: "Endurance",
  armureFixe: "Armure fixe", resistanceFixe: "Résistance fixe",
  scoreArmure: "Score Armure", scoreResistance: "Score Résistance",
  toucherPhysique: "Toucher physique", toucherMagique: "Toucher magique",
  initiativeMod: "Initiative", vitesse: "Vitesse",
  pvMax: "PV max", manaMax: "Mana max",
  regenPv: "Régén PV", regenMana: "Régén Mana",
  fatigueMax: "Fatigue max", podsMax: "Pods max"
};

export class ZoneEffectBehaviorSheet extends foundry.applications.sheets.RegionBehaviorConfig {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS ?? {},
    // Le template compte une quinzaine de champs (nom, 3 cases à cocher, 2 DD,
    // curseur de ralentissement, dégâts, état...) — nettement plus long que le
    // formulaire générique auto-généré pour lequel RegionBehaviorConfig calcule
    // sa hauteur par défaut. Sans hauteur explicite ni resizable, la fenêtre
    // s'ouvrait tronquée avant même les champs de dégâts, sans molette de
    // redimensionnement ni ascenseur pour aller les chercher (repéré à l'usage :
    // impossible de scroller jusqu'aux dégâts en jeu). "auto" laisse la fenêtre
    // s'ajuster au contenu réel ; resizable donne une échappatoire manuelle si
    // l'écran est trop petit pour la hauteur obtenue.
    {
      // "rpg-sheet"/"rpg-zone-sheet" ajoutés à ceux de RegionBehaviorConfig
      // (jamais en remplacement : mergeObject ne fusionne pas les tableaux
      // élément par élément, un simple "classes: [...]" ici écraserait les
      // classes core). rpg-sheet branche le thème (clair/sombre/contraste) ;
      // rpg-zone-sheet réutilise le CSS des blocs bonus/malus déjà écrit pour
      // la fiche de sort (styles/item-sheet.css, sélecteurs .fx-* partagés
      // entre .rpg-spell-sheet et .rpg-zone-sheet) sans le dupliquer.
      classes: [
        ...(Array.isArray(super.DEFAULT_OPTIONS?.classes) ? super.DEFAULT_OPTIONS.classes : []),
        "rpg-sheet", "rpg-zone-sheet"
      ],
      window: { title: "Piège / Zone à effet", resizable: true },
      position: { width: 460, height: "auto" },
      actions: {
        addEffectMod:    async function (event) { await this._actionAddEffectMod(event); },
        removeEffectMod: async function (event) { await this._actionRemoveEffectMod(event); }
      }
    },
    { inplace: false }
  );

  static PARTS = {
    form: { template: "systems/rpg/templates/region/zone-behavior.hbs" }
  };

  async _prepareContext(options) {
    // super._prepareContext() (RegionBehaviorConfig core) construit une liste
    // de champs génériques via this.document.system.schema — si le behavior
    // n'a pas (encore) un system correctement instancié en DataModel côté
    // Foundry, ça lève une exception non catchée qui casse tout rendu futur
    // de cette fiche. On ne dépend pas de ce résultat (notre template lit
    // directement system.xxx), donc un échec ici ne doit jamais empêcher
    // d'afficher/éditer le formulaire.
    let ctx;
    try {
      ctx = await super._prepareContext(options);
    } catch (e) {
      console.warn("[RPG] RegionBehaviorConfig._prepareContext (core) a échoué, repli manuel :", e);
      ctx = { document: this.document, editable: this.isEditable ?? true };
    }
    ctx.system = this.document.system ?? {};

    // Catalogue d'effets groupé par tag (même contenu que le <select> de la
    // macro "Appliquer un Effet (MJ)") — remplace le champ texte libre par
    // une liste fermée, pour que la zone retombe sur la même clé/tag qu'un
    // sort appliquant le même effet (résistances, remplacement par clé).
    // "selected" précalculé ici plutôt qu'en gymnastique de contexte relatif
    // (../../) dans un {{#each}} imbriqué deux fois côté template — plus
    // simple à lire et moins fragile si la structure du template bouge.
    const currentLabel = String(ctx.system.effectLabel ?? "");
    const byTag = {};
    for (const def of listEffects()) {
      (byTag[def.tag] ??= []).push({ ...def, selected: def.label === currentLabel });
    }
    ctx.effectGroups = Object.entries(byTag).map(([tag, defs]) => ({
      tag, tagLabel: EFFECT_TAGS[tag] ?? tag, effects: defs
    }));

    // Décore les modificateurs pour l'affichage : sens explicite (bonus/malus)
    // + quantité toujours positive dans le champ nombre — même convention que
    // decorateMod() dans item-spell-sheet-v2.js, réutilise le même CSS.
    const mods = Array.isArray(ctx.system.effectMods) ? ctx.system.effectMods : [];
    ctx.effectModsUI = mods.map(m => {
      const isMalus = m?.sens === "malus";
      return {
        stat: m?.stat ?? "vitesse",
        mode: m?.mode ?? "flat",
        isMalus,
        absValue: Math.abs(n(m?.value, 0)),
        statLabel: STAT_LABELS[m?.stat] ?? m?.stat
      };
    });

    return ctx;
  }

  async _onRender(context, options) {
    try {
      await super._onRender(context, options);
    } catch (e) {
      // Même esprit que le repli de _prepareContext ci-dessus : le rendu
      // NATIF de RegionBehaviorConfig (ex. un pied de fenêtre générique) ne
      // doit jamais empêcher NOTRE template (déjà inséré dans le DOM à ce
      // stade par le pipeline ApplicationV2) de rester utilisable.
      console.warn("[RPG] RegionBehaviorConfig._onRender (core) a échoué :", e);
    }
    applyUiTheme(this.element);
    // Filet de sécurité indépendant de "auto" ci-dessus : même si une future
    // version de Foundry recalcule la hauteur autrement, le contenu doit
    // rester atteignable au lieu de se couper silencieusement en bas.
    const content = this.element?.querySelector(".window-content");
    if (content) {
      content.style.overflowY = "auto";
      content.style.maxHeight = "80vh";
    }
  }

  /** Ajoute une ligne de modificateur vierge — repart des données du document
   *  (tableau à un seul niveau, contrairement à effectsUI[].mods sur la fiche
   *  de sort : pas besoin de relire le DOM pour ne pas perdre une saisie en
   *  cours ailleurs dans le formulaire). */
  async _actionAddEffectMod(event) {
    event?.preventDefault?.();
    const mods = foundry.utils.deepClone(this.document.system.effectMods ?? []);
    mods.push({ stat: "vitesse", sens: "malus", mode: "flat", value: 0 });
    await this.document.update({ "system.effectMods": mods }, { render: false });
    await this.render({ force: true });
  }

  async _actionRemoveEffectMod(event) {
    event?.preventDefault?.();
    const idx = Number(event?.target?.closest?.("[data-mod-index]")?.dataset?.modIndex ?? -1);
    if (!Number.isFinite(idx) || idx < 0) return;
    const mods = foundry.utils.deepClone(this.document.system.effectMods ?? []);
    mods.splice(idx, 1);
    await this.document.update({ "system.effectMods": mods }, { render: false });
    await this.render({ force: true });
  }
}

export function registerZoneEffectSheet() {
  // "RegionBehaviorConfig.registerConfig" n'existe pas dans l'API Foundry —
  // ça n'a jamais rien enregistré (erreur avalée par le try/catch), donc
  // Foundry retombait toujours sur son RegionBehaviorConfig générique par
  // défaut. Le mécanisme standard pour attacher une fiche à un sous-type de
  // document est DocumentSheetConfig.registerSheet — même fonction que
  // Actors.registerSheet/Items.registerSheet utilisés ailleurs dans init.js.
  const DocumentSheetConfig = foundry.applications?.apps?.DocumentSheetConfig;
  const RegionBehaviorDoc   = getDocumentClass?.("RegionBehavior") ?? globalThis.RegionBehavior;
  if (!DocumentSheetConfig || !RegionBehaviorDoc) return;

  try {
    DocumentSheetConfig.registerSheet(RegionBehaviorDoc, "rpg", ZoneEffectBehaviorSheet, {
      types: [BEHAVIOR_KEY],
      makeDefault: true,
      label: "Piège / Zone à effet (RPG)"
    });
  } catch (e) {
    console.warn("[RPG] enregistrement sheet zone:", e);
  }
}
