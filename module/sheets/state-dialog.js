// module/sheets/state-dialog.js
//
// L'éditeur d'ÉTAT posé à la main (bouton « Ajouter un état » / ✎ des fiches
// de personnage et de monstre), et les briques qu'il partage avec elles.
//
// Pourquoi un module à part : les deux fiches en portaient chacune une copie
// intégrale — 170 lignes identiques au caractère près, sauf deux. Les deux qui
// manquaient côté monstre étaient la lecture de « Restant » et de « Difficulté
// retrait » : les champs s'affichaient, le MJ les remplissait, et le parseur ne
// les lisait jamais. Un état posé à la main sur un monstre gardait donc la
// durée par défaut et, `cleanseDC` restant à 0, n'apparaissait dans aucune
// tentative de retrait (`removableStates`, remove-state.js) — impossible à
// dissiper, sans un mot. Une copie divergente, pas une règle : d'où la fusion.
//
// Ce que l'éditeur écrit est un état ORDINAIRE, de la même forme exacte que
// celui qu'un sort pose (`upsertState`, spells.js) — c'est ce qui permet au MJ
// de donner à la main tout ce qu'un effet de sort sait accorder : dégâts par
// tour, fatigue par tour, résistance aux dégâts, résistance aux états, bonus
// de dégâts aux attaques du porteur, aura. Chacun de ces champs est lu par un
// module qui ne connaît pas cette fenêtre (actor.js, resistances.js,
// attack-bonus.js, auras.js) : rien n'est réimplémenté ici, on remplit la même
// structure.

import { listEffects, getEffectDef, EFFECT_TAGS, effectCatalogByTag } from "../rules/effect-library.js";
import { STATE_TYPES, AURA_TARGETS } from "../rules/state-builder.js";
import { DAMAGE_TYPES, DAMAGE_TYPE_KEYS, RESIST_MIN, RESIST_MAX, stateResistanceRows } from "../rules/damage-types.js";
import { BONUS_SCOPES, WEAPON_CATEGORIES, BONUS_FX_WHEN, normalizeAttackBonus } from "../rules/attack-bonus.js";
import { MOVEMENT_TYPES } from "../rules/movement-types.js";

/** Libellés des stats modifiables par un état — source unique. */
export const MOD_LABELS = {
  force: "Force",
  dexterite: "Dextérité",
  intelligence: "Intelligence",
  acuite: "Acuité",
  endurance: "Endurance",
  pvMax: "PV max",
  manaMax: "Mana max",
  fatigueMax: "Fatigue max",
  regenPv: "Régén PV",
  regenMana: "Régén Mana",
  vitesse: "Vitesse",
  scoreArmure: "Score Armure",
  scoreResistance: "Score Résistance",
  armureFixe: "Armure fixe",
  resistanceFixe: "Résistance fixe",
  toucherPhysique: "Toucher physique",
  toucherMagique: "Toucher magique",
  initiativeMod: "Initiative",
  fatigueMax: "Fatigue max",
  podsMax: "Pods max",
  retraitMod: "Seuil de retrait d'état"
};
export function normalizeState(st) {
  const out = foundry.utils.deepClone(st ?? {});
  out.id = String(out.id || foundry.utils.randomID());
  out.label = String(out.label ?? "").trim() || "État";
  out.type = String(out.type ?? "custom").trim();
  out.isAura = !!out.isAura;
  out.duration = Math.max(1, Number(out.duration ?? 1) || 1);
  out.remaining = Math.max(0, Number(out.remaining ?? out.duration) || 0);
  out.cleanseDC = Math.max(0, Number(out.cleanseDC ?? 0) || 0);
  out.dot = out.dot ?? {};
  out.dot.flat = Number(out.dot.flat ?? 0) || 0;
  out.dot.formula = String(out.dot.formula ?? "").trim();
  out.dot.perTick = Number(out.dot.perTick ?? out.dot.flat) || 0;
  // Fatigue infligée (ou rendue, en négatif) à chaque tour — même tic que les
  // PV, lu par onTurnStartForActor (turn-effects.js).
  out.dot.fatiguePerTick = Number(out.dot.fatiguePerTick ?? 0) || 0;
  // Blessure : ne s'estompe jamais seule (tickStates ne la décrémente pas),
  // seul le MJ la retire. Son DOT, lui, continue de tomber chaque tour.
  out.permanent = !!out.permanent;
  out.mods = out.mods ?? {};
  if (out.isAura) {
    out.aura = out.aura ?? {};
    out.aura.min = Number(out.aura.min ?? 0) || 0;
    out.aura.max = Number(out.aura.max ?? 0) || 0;
    out.aura.target = String(out.aura.target ?? "allies");
    out.aura.linkedItemId = String(out.aura.linkedItemId ?? "");
    out.aura.expiresWithCooldown = !!out.aura.expiresWithCooldown;
  }
  return out;
}

/**
 * Stats qu'un état peut modifier, dans l'ordre d'affichage du dialogue.
 * Même jeu de clés que `KEY_TO_BUCKET` (status-effects.js) : une clé absente
 * ici est éditable nulle part, une clé absente là-bas ne fait rien.
 */
export const MOD_KEYS = [
  "force", "dexterite", "intelligence", "acuite", "endurance",
  "pvMax", "manaMax", "regenPv", "regenMana",
  "scoreArmure", "scoreResistance", "armureFixe", "resistanceFixe",
  "vitesse", "initiativeMod", "toucherPhysique", "toucherMagique",
  "fatigueMax", "podsMax", "retraitMod"
];

/** État neuf, tel que le proposent les deux fiches. */
export function stateDefaults() {
  return normalizeState({
    id: foundry.utils.randomID(),
    label: "Poison",
    type: "poison",
    tag: "",
    isAura: false,
    duration: 3,
    remaining: 3,
    cleanseDC: 0,
    dot: { flat: 0, formula: "", perTick: 0, fatiguePerTick: 0 },
    mods: {}
  });
}

export function ensureStateDialogCSS() {
  if (document.getElementById("rpg-state-dialog-css")) return;

  const style = document.createElement("style");
  style.id = "rpg-state-dialog-css";
  style.textContent = `
/* ===== RPG State Dialog (V2) ===== */

/* on scroll sur le contenu du dialog */
.rpg-state-dialog-window {
  overflow-y: auto !important;
  overflow-x: hidden !important;
}

/* wrapper interne */
.rpg-state-dialog {
  max-height: 70vh !important;
  overflow: auto !important;
  padding-right: 12px !important;
}

/* inputs */
.rpg-state-dialog input,
.rpg-state-dialog select {
  width: 100% !important;
  box-sizing: border-box !important;
  min-width: 0 !important;
  margin: 0 !important;
}

/* lignes label/champ */
.rpg-state-dialog .line {
  display: grid !important;
  grid-template-columns: 220px 1fr !important;
  gap: 14px !important;
  align-items: center !important;
  margin-bottom: 12px !important;
}
.rpg-state-dialog .lbl {
  font-weight: 700 !important;
  opacity: .9 !important;
}

/* grilles 2 colonnes (durée/restant, portée min/max) */
.rpg-state-dialog .two {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 14px !important;
  margin-bottom: 12px !important;
}
.rpg-state-dialog .two label {
  display: block !important;
  font-weight: 700 !important;
  opacity: .9 !important;
  margin: 0 0 6px 0 !important;
}

/* mods : label + 2 inputs côte à côte (avec espace) */
.rpg-state-dialog .mods-row {
  display: grid !important;
  grid-template-columns: 220px 1fr !important;
  gap: 14px !important;
  align-items: center !important;
  margin: 10px 0 !important;
}
.rpg-state-dialog .mods-label {
  font-weight: 700 !important;
  opacity: .9 !important;
}
.rpg-state-dialog .mods-inputs {
  display: grid !important;
  grid-template-columns: 110px 110px !important;
  gap: 14px !important;
  justify-content: end !important;
  justify-items: end !important;
}
.rpg-state-dialog .mods-inputs input {
  width: 110px !important;
}

/* lignes de résistance aux états : une grille, comme la fiche de sort */
.rpg-state-dialog .rpg-res-row {
  display: grid !important;
  grid-template-columns: minmax(0,1.3fr) minmax(0,1.6fr) 70px 70px 40px 26px !important;
  gap: 8px !important;
  align-items: center !important;
  margin-bottom: 6px !important;
}
.rpg-state-dialog .rpg-res-head {
  font-size: 10px !important;
  font-weight: 700 !important;
  opacity: .7 !important;
}
.rpg-state-dialog .rpg-res-key { display: flex !important; flex-direction: column !important; gap: 3px !important; min-width: 0 !important; }
.rpg-state-dialog .rpg-res-key select { font-size: 10px !important; }
.rpg-state-dialog .rpg-res-row input[type="checkbox"] { width: auto !important; }
.rpg-state-dialog .rpg-res-add { margin: 2px 0 10px !important; cursor: pointer !important; }
.rpg-state-dialog .rpg-res-del { cursor: pointer !important; border: 0 !important; background: none !important; color: #c0392b !important; }

/* séparateurs */
.rpg-state-dialog hr {
  border: 0 !important;
  height: 1px !important;
  background: var(--border-soft, rgba(255,255,255,.12)) !important;
  margin: 16px 0 !important;
}

@media (max-width: 560px) {
  .rpg-state-dialog .line { grid-template-columns: 1fr !important; gap: 8px !important; }
  .rpg-state-dialog .two { grid-template-columns: 1fr !important; gap: 10px !important; }
  .rpg-state-dialog .mods-row { grid-template-columns: 1fr !important; gap: 8px !important; }
  .rpg-state-dialog .mods-inputs { justify-content: start !important; justify-items: start !important; }
}
  `;
  document.head.appendChild(style);
}

/**
 * Ouvre l'éditeur d'un état et rend l'état édité (ou `null` si annulé).
 *
 * La même fenêtre pour les deux fiches : ce que le MJ peut donner à un
 * monstre est exactement ce qu'il peut donner à un personnage — et, pour
 * l'essentiel, ce qu'un sort sait accorder. Les champs des sections 4 à 7
 * remplissent les MÊMES clés que `upsertState` (spells.js), donc ils sont lus
 * par le même code, sans un seul chemin de lecture supplémentaire.
 *
 * @param {object} state  état de départ (un neuf : voir `stateDefaults`)
 * @param {{title?: string}} opts
 * @returns {Promise<object|null>}
 */
export async function editStateDialog(state, { title } = {}) {
  const st = normalizeState(state);
  const keys = MOD_KEYS;

  // Catalogue d'effets nommés (Ardeur, Brûlure…), groupé par élément —
  // ne fait que pré-remplir le nom + l'élément ; tout reste éditable.
  const byTag = {};
  for (const e of listEffects()) {
    if (!byTag[e.tag]) byTag[e.tag] = [];
    byTag[e.tag].push(e);
  }
  const effectCatalogOptions = `<option value="">— Personnalisé —</option>` +
    Object.entries(byTag).map(([tag, list]) =>
      `<optgroup label="${EFFECT_TAGS[tag] ?? tag}">` +
      list.map(e => `<option value="${e.key}">${e.label}</option>`).join("") +
      `</optgroup>`
    ).join("");

  const tagOptions = Object.entries(STATE_TYPES)
    .map(([k, v]) => `<option value="${k}" ${(st.tag ?? "") === k ? "selected" : ""}>${v}</option>`).join("");

  // Types de DÉGÂTS (physique/magique + éléments) : le vocabulaire de
  // `resistancesElem`, différent de celui des états ci-dessus.
  const dmgTypeOptions = (cur) =>
    `<option value="">— Aucune —</option>` +
    DAMAGE_TYPE_KEYS.map(k =>
      `<option value="${k}" ${String(cur ?? "") === k ? "selected" : ""}>${DAMAGE_TYPES[k]}</option>`).join("");

  // Vocabulaire des ÉTATS (neutre inclus) pour la résistance aux états.
  const fxTagOptions = (cur) =>
    `<option value="">— N'importe quel type —</option>` +
    Object.entries(EFFECT_TAGS).map(([k, v]) =>
      `<option value="${k}" ${String(cur ?? "") === k ? "selected" : ""}>${v}</option>`).join("");

  // Effet PRÉCIS visé par la résistance (« Poison » seulement, pas tout le
  // type). `computeResistanceFor` compare `effectKey` au LIBELLÉ de l'état
  // reçu, en minuscules — d'où `value: "label"` : la clé technique n'y
  // correspondrait jamais. C'est la même liste que les fiches d'arme,
  // d'armure et de talent, où ce filtre existait déjà.
  const fxCatalog = effectCatalogByTag({ value: "label" });
  const fxKeyOptions = (cur, placeholder = "— Tous les effets du type choisi —") =>
    `<option value="">${placeholder}</option>` +
    Object.entries(fxCatalog).map(([group, list]) =>
      `<optgroup label="${group}">` +
      list.map(e => `<option value="${e.value}" ${String(cur ?? "") === e.value ? "selected" : ""}>${e.label}</option>`).join("") +
      `</optgroup>`).join("");

  const row = (k, label) => {
    const cur = st.mods?.[k] ?? {};
    const flat = Number(cur.flat ?? 0) || 0;
    const pct = Number(cur.pct ?? 0) || 0;

    return `
      <div class="mods-row">
        <div class="mods-label">${label}</div>
        <div class="mods-inputs">
          <input type="number" name="mods.${k}.flat" value="${flat}" placeholder="Flat"/>
          <input type="number" name="mods.${k}.pct" value="${pct}" placeholder="%"/>
        </div>
      </div>
    `;
  };

  const modsHtml = keys.map(k => row(k, MOD_LABELS[k] ?? k)).join("");

  // Une ligne de résistance aux états. Le même HTML sert au rendu initial et au
  // bouton « + Ajouter », pour que les deux ne puissent pas diverger.
  const resistRowHtml = (r = {}) => `
    <div class="rpg-res-row">
      <select data-res-field="tag">${fxTagOptions(r.tag)}</select>
      <span class="rpg-res-key">
        <select class="rpg-res-fx-pick">${fxKeyOptions(r.effectKey, "— Catalogue —")}</select>
        <input type="text" data-res-field="effectKey" value="${String(r.effectKey ?? "")}"
          placeholder="vide = tout le type"
          title="Comparé au NOM de l'état reçu, sans tenir compte de la casse. Le menu au-dessus ne fait que remplir ce champ ; un nom hors catalogue est accepté."/>
      </span>
      <input type="number" data-res-field="durationReduction" value="${Number(r.durationReduction ?? 0) || 0}" step="1"/>
      <input type="number" data-res-field="dotReductionPct" value="${Number(r.dotReductionPct ?? 0) || 0}" step="5"/>
      <input type="checkbox" data-res-field="immune" ${r.immune ? "checked" : ""}/>
      <button type="button" class="rpg-res-del" title="Retirer cette ligne">✕</button>
    </div>`;

  const resD = st.resistanceDamage ?? {};
  // Toutes les lignes de résistance aux états — `resistances[]` et, pour un
  // état posé avant la liste, l'objet unique `resistance`.
  const resRows = stateResistanceRows(st);
  const atk  = st.attackBonus ?? {};
  const atkCats = Array.isArray(atk.categories) ? atk.categories : [];
  const atkFx = atk.effect ?? {};

  const content = `
<div class="rpg-state-dialog">

  <div class="scroll">
    <form class="rpg-state-edit">

      <div class="line">
        <div class="lbl">Nom de l'effet (catalogue)</div>
        <select name="catalogEffect">${effectCatalogOptions}</select>
      </div>

      <div class="line">
        <div class="lbl">Nom (label)</div>
        <input type="text" name="label" value="${st.label}"/>
      </div>

      <div class="line">
        <div class="lbl">Type</div>
        <select name="type">
          ${["poison", "burn", "buff", "debuff", "aura", "custom"].map(t =>
            `<option value="${t}" ${st.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>

      <div class="line">
        <div class="lbl">Type / Élément (résistances, couleur d'aura)</div>
        <select name="tag">${tagOptions}</select>
      </div>

      <div class="line">
        <div class="lbl">Aura (avec portée)</div>
        <div><input type="checkbox" name="isAura" ${st.isAura ? "checked" : ""}/></div>
      </div>

      <div class="line">
        <div class="lbl">Durée illimitée (∞)</div>
        <div><input type="checkbox" name="permanent" ${st.permanent ? "checked" : ""}/>
          <small class="hint">Ne se décompte jamais : ni la durée ni le « restant » ci-dessous ne comptent,
          l'état reste tant que le MJ ne le retire pas (ou qu'un jet de retrait ne réussit pas).
          Son effet par tour, lui, continue de tomber chaque tour.</small></div>
      </div>

      <div class="two">
        <div>
          <label>Durée (tours)</label>
          <input type="number" name="duration" value="${st.duration}" min="1"/>
        </div>
        <div>
          <label>Restant (tours)</label>
          <input type="number" name="remaining" value="${st.remaining}" min="0"/>
        </div>
      </div>

      <div class="line">
        <div class="lbl">Indébuffable</div>
        <div><input type="checkbox" name="undispellable" ${!st.cleanseDC ? "checked" : ""}/>
          <small class="hint">Aucun jet ne peut le retirer : l'action « Retirer un état » ne le proposera
          même pas (<code>removableStates</code>). Décoche pour fixer une difficulté ci-dessous.</small></div>
      </div>

      <div class="line">
        <div class="lbl">Difficulté de retrait (seuil du jet)</div>
        <input type="number" name="cleanseDC" value="${st.cleanseDC}" min="0"/>
      </div>

      <div class="two">
        <div>
          <label>Portée min (m) (aura)</label>
          <input type="number" name="aura.min" value="${Number(st.aura?.min ?? 0) || 0}" min="0" step="0.1"/>
        </div>
        <div>
          <label>Portée max (m) (aura)</label>
          <input type="number" name="aura.max" value="${Number(st.aura?.max ?? 0) || 0}" min="0" step="0.1"/>
        </div>
      </div>

      <div class="line">
        <div class="lbl">Cible (aura)</div>
        <select name="aura.target">
          ${Object.entries(AURA_TARGETS).map(([t, lbl]) =>
            `<option value="${t}" ${(st.aura?.target ?? "allies") === t ? "selected" : ""}>${lbl}</option>`).join("")}
        </select>
      </div>

      <hr/>
      <h3>Par tour (DOT / soin)</h3>
      <p class="hint">Appliqué au début du tour du porteur. Positif = il subit, négatif = il récupère.</p>

      <div class="line">
        <div class="lbl">PV par tour (fixe)</div>
        <input type="number" name="dot.flat" value="${Number(st.dot.flat ?? 0) || 0}"/>
      </div>

      <div class="line">
        <div class="lbl">Dés par tour (ex : 1d4) — indicatif</div>
        <input type="text" name="dot.formula" value="${String(st.dot.formula ?? "")}" placeholder=""/>
      </div>

      <div class="line">
        <div class="lbl">Fatigue par tour</div>
        <input type="number" name="dot.fatiguePerTick" value="${Number(st.dot.fatiguePerTick ?? 0) || 0}"/>
      </div>

      <div class="line">
        <div class="lbl">Mode de déplacement accordé</div>
        <select name="mods.movementTypeGrant">
          <option value="" ${!st.mods?.movementTypeGrant ? "selected" : ""}>— Aucun —</option>
          ${Object.entries(MOVEMENT_TYPES).filter(([k]) => k !== "terrestre").map(([k, def]) =>
            `<option value="${k}" ${String(st.mods?.movementTypeGrant ?? "") === k ? "selected" : ""}>${def.label}</option>`).join("")}
        </select>
      </div>

      <hr/>
      <h3>Résistance aux DÉGÂTS accordée</h3>
      <p class="hint">% retiré aux dégâts de ce type reçus par le porteur. Négatif = vulnérabilité. 100 = immunité.</p>

      <div class="two">
        <div>
          <label>Type de dégâts</label>
          <select name="resD.tag">${dmgTypeOptions(resD.tag)}</select>
        </div>
        <div>
          <label>Résistance (%)</label>
          <input type="number" name="resD.pct" value="${Number(resD.pct ?? 0) || 0}" min="${RESIST_MIN}" max="${RESIST_MAX}"/>
        </div>
      </div>

      <hr/>
      <h3>Résistances aux ÉTATS accordées</h3>
      <p class="hint">Sur les états reçus ENSUITE par le porteur. <b>Autant de lignes que voulu</b>, et chacune
        combine librement ses filtres : un <b>type</b> seul vise toute la famille (tous les états de feu), un
        <b>effet précis</b> seul ne vise que lui quel que soit son type (« Poison » uniquement), les deux ensemble
        exigent les deux. <b>Immunité</b> = l'état n'est pas posé ; <b>dégâts par tour −100 %</b> = il est posé mais
        ne fait plus rien ; une <b>durée</b> ramenée à 0 l'empêche aussi d'être posé. Valeurs négatives =
        vulnérabilité (dure plus longtemps, tape plus fort), et les lignes qui correspondent s'additionnent.
        Indépendant du bloc ci-dessus, qui ne parle que des dégâts directs.</p>

      <div class="rpg-res-list">
        <div class="rpg-res-row rpg-res-head">
          <span>Type d'état</span><span>Effet précis</span><span>Durée −</span><span>DOT −%</span><span>Immun.</span><span></span>
        </div>
        ${resRows.map(r => resistRowHtml(r)).join("")}
      </div>
      <button type="button" class="rpg-res-add">+ Ajouter une résistance</button>

      <hr/>
      <h3>Bonus de dégâts aux attaques du porteur</h3>
      <p class="hint">« Lames aiguisées », « Arme enflammée » : s'ajoute à CHAQUE attaque tant que l'état dure.
        Avec une livraison ou un élément propre, le bonus devient sa PROPRE ligne, opposée à la résistance
        correspondante de la cible ; sans rien, il se fond dans le coup.</p>

      <div class="two">
        <div>
          <label>Porte sur</label>
          <select name="atk.scope">
            ${Object.entries(BONUS_SCOPES).map(([k, v]) =>
              `<option value="${k}" ${String(atk.scope ?? "arme") === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Catégories d'arme (aucune cochée = toutes)</label>
          <div style="display:flex;gap:10px;align-items:center">
            ${Object.entries(WEAPON_CATEGORIES).map(([k, v]) => `
              <label style="display:flex;gap:4px;align-items:center;font-weight:400">
                <input type="checkbox" name="atk.cat.${k}" ${atkCats.includes(k) ? "checked" : ""} style="width:auto"/>${v}
              </label>`).join("")}
          </div>
        </div>
      </div>

      <div class="two">
        <div>
          <label>Dégâts fixes (+N)</label>
          <input type="number" name="atk.flat" value="${Number(atk.flat ?? 0) || 0}"/>
        </div>
        <div>
          <label>Dés ajoutés (ex : 1d6)</label>
          <input type="text" name="atk.dice" value="${String(atk.dice ?? "")}" placeholder=""/>
        </div>
      </div>

      <div class="two">
        <div>
          <label>% des dégâts bruts</label>
          <input type="number" name="atk.pct" value="${Number(atk.pct ?? 0) || 0}"/>
        </div>
        <div>
          <label>Livraison du bonus</label>
          <select name="atk.livraison">
            <option value="" ${!atk.livraison ? "selected" : ""}>— celle du coup —</option>
            <option value="physique" ${atk.livraison === "physique" ? "selected" : ""}>Physique</option>
            <option value="magique"  ${atk.livraison === "magique"  ? "selected" : ""}>Magique</option>
          </select>
        </div>
      </div>

      <div class="line">
        <div class="lbl">Élément du bonus</div>
        <select name="atk.tag">${dmgTypeOptions(atk.tag)}</select>
      </div>

      <h3 style="margin-top:14px">État posé par ce bonus (« tes lames empoisonnent »)</h3>
      <p class="hint">Facultatif, et suffisant à lui seul : un bonus qui ne pose qu'un état, sans un point de
        dégât en plus, est valide. Sans nom, rien n'est posé. L'état est rafraîchi à chaque coup porté
        plutôt qu'empilé.</p>

      <div class="two">
        <div>
          <label>Nom de l'état (catalogue)</label>
          <select class="rpg-atkfx-pick">${fxKeyOptions(atkFx.label, "— Choisir dans le catalogue —")}</select>
        </div>
        <div>
          <label>Nom posé</label>
          <input type="text" name="atkFx.label" value="${String(atkFx.label ?? "")}" placeholder="vide = aucun état"/>
        </div>
      </div>

      <div class="two">
        <div>
          <label>Déclencheur</label>
          <select name="atkFx.when">
            ${Object.entries(BONUS_FX_WHEN).map(([k, v]) =>
              `<option value="${k}" ${String(atkFx.when ?? "hit") === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Durée (tours)</label>
          <input type="number" name="atkFx.duration" value="${Number(atkFx.duration ?? 1) || 1}" min="1"/>
        </div>
      </div>

      <div class="two">
        <div>
          <label>Élément de l'état posé</label>
          <select name="atkFx.tag">${dmgTypeOptions(atkFx.tag)}</select>
        </div>
        <div>
          <label>Difficulté de retrait (0 = indissipable)</label>
          <input type="number" name="atkFx.removeBaseTN" value="${Number(atkFx.removeBaseTN ?? 0) || 0}" min="0"/>
        </div>
      </div>

      <div class="two">
        <div>
          <label>Par tour</label>
          <select name="atkFx.dot.mode">
            ${[["none", "— Rien —"], ["damage", "Dégâts"], ["heal", "Soin"]].map(([k, v]) =>
              `<option value="${k}" ${String(atkFx.dot?.mode ?? "none") === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Base par tour</label>
          <input type="number" name="atkFx.dot.base" value="${Number(atkFx.dot?.base ?? 0) || 0}" min="0"/>
        </div>
      </div>

      <div class="two">
        <div>
          <label>+ stat du porteur ÷ tranche</label>
          <select name="atkFx.dot.stat">
            <option value="" ${!atkFx.dot?.stat ? "selected" : ""}>— aucune —</option>
            ${["force", "dexterite", "intelligence", "acuite", "endurance"].map(k =>
              `<option value="${k}" ${String(atkFx.dot?.stat ?? "") === k ? "selected" : ""}>${MOD_LABELS[k] ?? k}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Tranche</label>
          <input type="number" name="atkFx.dot.per" value="${Number(atkFx.dot?.per ?? 10) || 10}" min="1"/>
        </div>
      </div>

      <hr/>
      <h3>Modificateurs (buff / debuff)</h3>
      <p class="hint">Flat = +10 / -10. % = +10 / -10 (pour +10% / -10%).</p>

      ${modsHtml}
    </form>
  </div>
</div>
`;

  const parseForm = (htmlRoot) => {
    const form = htmlRoot.querySelector("form");
    const fd = new FormData(form);

    const getStr = (k, d = "") => String(fd.get(k) ?? d).trim();
    const getNum = (k, d = 0) => Number(fd.get(k) ?? d) || 0;
    const getChk = (k) => fd.get(k) !== null;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const out = normalizeState(st);
    out.label = getStr("label", out.label);
    out.type = getStr("type", out.type);
    out.tag = getStr("tag", out.tag ?? "") || null;
    out.isAura = getChk("isAura");
    out.permanent = getChk("permanent");

    out.duration = Math.max(1, getNum("duration", out.duration));
    out.remaining = Math.max(0, getNum("remaining", out.remaining));
    // « Indébuffable » et « difficulté de retrait » sont le MÊME champ vu des
    // deux côtés : `removableStates` (remove-state.js) ne propose que les états
    // portant un seuil, donc 0 veut dire « aucun jet ne le retire ». La case
    // évite au MJ de deviner que ce 0 est une règle et non un oubli ; cochée,
    // elle l'emporte sur la valeur saisie.
    out.cleanseDC = getChk("undispellable") ? 0 : Math.max(0, getNum("cleanseDC", out.cleanseDC));

    out.dot = out.dot ?? {};
    out.dot.flat = getNum("dot.flat", 0);
    out.dot.formula = getStr("dot.formula", "");
    // perTick est ce que lit turn-effects.js ; flat n'est que la saisie.
    out.dot.perTick = out.dot.flat;
    out.dot.fatiguePerTick = getNum("dot.fatiguePerTick", 0);

    if (out.isAura) {
      out.aura = out.aura ?? {};
      out.aura.min = Math.max(0, getNum("aura.min", 0));
      out.aura.max = Math.max(0, getNum("aura.max", 0));
      out.aura.target = getStr("aura.target", "allies") || "allies";
    } else {
      delete out.aura;
    }

    // Résistance aux DÉGÂTS (derived.resistancesElem, actor.js) : sans type,
    // l'objet est retiré plutôt que laissé à null — un état relu par le
    // dialogue ne doit pas garder un vestige que plus rien n'affiche.
    const rdTag = getStr("resD.tag", "");
    if (rdTag) out.resistanceDamage = { tag: rdTag, pct: clamp(getNum("resD.pct", 0), RESIST_MIN, RESIST_MAX) };
    else delete out.resistanceDamage;

    // Résistances aux ÉTATS (resistances.js), en LISTE : l'un OU l'autre des
    // deux filtres suffit sur chaque ligne — une résistance sans type mais
    // nommant « Poison » est le cas même qu'on veut écrire, et
    // `computeResistanceFor` la lit très bien (il n'ignore que celle qui n'a
    // NI tag NI effectKey). Une ligne entièrement vide est abandonnée plutôt
    // qu'écrite : inerte côté moteur, elle ne ferait qu'encombrer la fiche.
    // `resistance` (l'objet unique d'avant) est supprimé une fois relu ici,
    // sinon il s'ajouterait aux lignes à chaque lecture.
    const resistances = [];
    htmlRoot.querySelectorAll(".rpg-res-row").forEach(row => {
      if (row.classList.contains("rpg-res-head")) return;
      const f = (k) => row.querySelector(`[data-res-field="${k}"]`);
      const tag = String(f("tag")?.value ?? "").trim();
      const effectKey = String(f("effectKey")?.value ?? "").trim();
      const immune = !!f("immune")?.checked;
      const durationReduction = Number(f("durationReduction")?.value) || 0;
      const dotReductionPct = Number(f("dotReductionPct")?.value) || 0;
      if (!tag && !effectKey && !immune && !durationReduction && !dotReductionPct) return;
      resistances.push({ tag: tag || null, effectKey, durationReduction, dotReductionPct, immune });
    });
    delete out.resistance;
    if (resistances.length) out.resistances = resistances;
    else delete out.resistances;

    // Bonus de dégâts : normalisé par le module qui le lit (attack-bonus.js),
    // jamais à la main — c'est lui qui décide qu'un bonus vide vaut `null`,
    // et qu'un bonus qui ne pose qu'un état sans un point de dégât en plus
    // est parfaitement valide.
    const atkNext = normalizeAttackBonus({
      scope: getStr("atk.scope", "arme"),
      categories: Object.keys(WEAPON_CATEGORIES).filter(k => getChk(`atk.cat.${k}`)),
      flat: getNum("atk.flat", 0),
      pct: getNum("atk.pct", 0),
      dice: getStr("atk.dice", ""),
      livraison: getStr("atk.livraison", ""),
      tag: getStr("atk.tag", ""),
      // État posé sur la cible touchée. Sans nom, `normalizeBonusEffect` rend
      // null et le bonus reste purement chiffré — c'est la façon de l'enlever.
      effect: {
        label: getStr("atkFx.label", ""),
        when: getStr("atkFx.when", "hit"),
        duration: Math.max(1, getNum("atkFx.duration", 1)),
        removeBaseTN: Math.max(0, getNum("atkFx.removeBaseTN", 0)),
        tag: getStr("atkFx.tag", ""),
        dot: {
          mode: getStr("atkFx.dot.mode", "none"),
          base: Math.max(0, getNum("atkFx.dot.base", 0)),
          stat: getStr("atkFx.dot.stat", ""),
          per: Math.max(1, getNum("atkFx.dot.per", 10))
        }
      }
    });
    if (atkNext) out.attackBonus = atkNext;
    else delete out.attackBonus;

    out.mods = out.mods ?? {};
    // Le mode de déplacement accordé n'est pas une stat : il voyage dans
    // `mods` sous sa propre clé, exactement comme l'écrit spells.js, et c'est
    // là que le movement-tracker va le chercher.
    const moveGrant = getStr("mods.movementTypeGrant", "");
    if (moveGrant) out.mods.movementTypeGrant = moveGrant;
    else delete out.mods.movementTypeGrant;
    for (const k of keys) {
      const flat = getNum(`mods.${k}.flat`, 0);
      const pct = getNum(`mods.${k}.pct`, 0);
      if (flat !== 0 || pct !== 0) out.mods[k] = { flat, pct };
      else delete out.mods[k];
    }

    return out;
  };

  const DialogV2 = foundry.applications.api.DialogV2 ?? foundry.applications.api.Dialog;

  return await new Promise((resolve) => {
    ensureStateDialogCSS();

    const dlg = new DialogV2({
      window: {
        title: title || "État",
        contentClasses: ["rpg-state-dialog-window"]
      },
      position: { width: 680, height: 760 },
      content,
      buttons: [
        { action: "cancel", label: "Annuler", default: false, callback: () => resolve(null) },
        {
          action: "ok",
          label: "Enregistrer",
          default: true,
          callback: (_event, _button, dialog) => {
            const root = dialog.element ?? dialog?.form ?? dialog;
            resolve(parseForm(root));
          }
        }
      ],
      close: () => resolve(null)
    });

    dlg.render(true).then(() => {
      // Choisir un effet du catalogue ne fait que pré-remplir nom + élément :
      // le MJ garde la main sur toutes les valeurs (durée, mods, aura…).
      const root = dlg.element;
      const catalogSel = root?.querySelector('select[name="catalogEffect"]');
      const labelInput = root?.querySelector('input[name="label"]');
      const tagSel = root?.querySelector('select[name="tag"]');
      catalogSel?.addEventListener("change", () => {
        const def = getEffectDef(catalogSel.value);
        if (!def) return;
        if (labelInput) labelInput.value = def.label;
        if (tagSel) tagSel.value = def.tag;
      });

      // Les deux champs qui désignent un état PAR SON NOM (la résistance ciblée,
      // l'état posé par le bonus d'attaque) gardent une saisie libre : le
      // catalogue ne connaît pas les états écrits à la main, et « Poison » n'y
      // figure pas sous ce nom-là (il s'y appelle « Empoisonnement »). Le menu
      // ne fait donc que remplir le champ.
      const atkPick = root?.querySelector("select.rpg-atkfx-pick");
      const atkInput = root?.querySelector('input[name="atkFx.label"]');
      atkPick?.addEventListener("change", () => {
        if (atkInput && atkPick.value) atkInput.value = atkPick.value;
      });

      // Les lignes de résistance sont ajoutées et retirées à chaud : un seul
      // écouteur délégué sur la fenêtre, sinon une ligne créée après coup
      // n'aurait ni son menu de catalogue ni son ✕.
      const list = root?.querySelector(".rpg-res-list");
      root?.querySelector(".rpg-res-add")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        list?.insertAdjacentHTML("beforeend", resistRowHtml({}));
      });
      root?.addEventListener("click", (ev) => {
        const del = ev.target?.closest?.(".rpg-res-del");
        if (!del) return;
        ev.preventDefault();
        del.closest(".rpg-res-row")?.remove();
      });
      root?.addEventListener("change", (ev) => {
        const sel = ev.target?.closest?.("select.rpg-res-fx-pick");
        if (!sel || !sel.value) return;
        const input = sel.closest(".rpg-res-row")?.querySelector('[data-res-field="effectKey"]');
        if (input) input.value = sel.value;
      });
    });
  });
}
