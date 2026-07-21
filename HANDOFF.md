# 🤝 Document de passation — Système RPG Foundry VTT

> **Pour une nouvelle conversation Claude** : commence par lire ce fichier en entier,
> puis lis `GUIDE_TEST.md` pour le protocole de test complet. Le repo est à jour
> avec tout ce qui est décrit ici — clone-le et regarde le code directement pour
> les détails d'implémentation.

**Repo** : https://github.com/magusin/jdr-foundry.git
**Foundry** : V13 Stable (build 351)
**Système** : `id: "rpg"`, ES modules, DocumentSheetV2 (Application V2 API)

---

## 📌 État du projet (dernier commit : a920a4b)

Le système est **fonctionnel et jouable**. Combat, sorts, forge, météo/terrain,
déplacement en mètres avec régions, tout marche. La session actuelle portait
surtout sur : stabilisation anti-crash + refonte visuelle complète.

---

## 🏗️ Architecture rapide

```
module/
  init.js                    — hooks globaux, settings, macros auto-install, game.rpg.*
  documents/actor.js         — RPGActor.prepareDerivedData() (TOUTES les formules stats)
  documents/item.js          — RPGItem, rollDamage()
  rules/
    combat.js                — computeTN (ratio ATK/DEF → TN 6-16)
    spells.js                — declareSpell, resolveDeclaredSpellFromMessage
    attack-resolve.js         — bindAttackChatButtons, resolveAttack
    action-budget.js          — slots d'action par tour (attaque/sort/déplacement)
    action-confirm.js         — handlePendingAction
    combat-end.js             — XP + loot en fin de combat
    turn-effects.js           — tick des états entre tours
    resistances.js            — élémentaire, météo amplifie/atténue
    effect-library.js         — EFFECT_LIBRARY (catalogue d'effets)
    movement-tracker.js        — déplacement EN MÈTRES, measurePath, debounce 350ms
    region-behaviors.js        — 6 types de terrain LOCAL (régions V13 dessinées)
    movement-types.js          — 7 types déplacement (volant/aquatique/etc + immunités)
    spell-range.js              — cercle de portée visuel (MeasuredTemplate)
    weather-library.js          — météo GLOBALE multi-conditions + terrain/biome GLOBAL
                                   + HUDs affichés en haut de l'écran + dialogs intégrés
    level-up.js                 — montée de niveau auto (100 XP/niveau)
    skill-check.js               — jet de compétence initié MJ (difficulté-niveau=TN)
    skills.js                    — XP compétences (100+50×niveau par palier)
    forge.js / forge-resolve.js  — recettes, consommation ingrédients, validation MJ
    campaign-journal.js          — journal de campagne
    morale-resolve.js             — jet de moral
  sheets/
    character-sheet-v2.js       — fiche PJ (LA plus grosse, ~1500 lignes)
    monster-sheet-v2.js          — fiche Monstre (partage _editStateDialog avec PJ)
    item-*-sheet-v2.js            — armes/armures/sorts/recettes/génériques
    sheet-helpers.js               — applySheetViewMode, bindImageEditors, applyUiTheme
  utils/
    error-handler.js              — gestionnaire d'erreurs global (anti-crash)
    dialog-compat.js               — wrapper Dialog V1/V2
  macro/                           — 19 macros (voir MACRO_DEFS dans init.js)
styles/
  theme.css                       — ⭐ DESIGN TOKENS centraux, chargé EN PREMIER
  character-sheet.css / weapon-sheet.css / armor-sheet.css / spell-sheet.css /
  item-sheet.css / menu-macro.css — consomment les tokens de theme.css
templates/
  actor/character-sheet.hbs (~1000 lignes) / monster-sheet.hbs
  item/*.hbs
  region/terrain-behavior.hbs
```

---

## 🎨 Thème visuel — "Grimoire Arcanique"

**3 thèmes au choix INDIVIDUEL de chaque joueur** (réglage client `rpg.uiTheme`) :
- `sombre` (défaut) — encre #14151f, violet/laiton/braise
- `clair` — parchemin #ece4d3, accents assombris
- `contraste` — noir pur, texte blanc, accents saturés

Appliqué via `applyUiTheme(root)` dans `sheet-helpers.js`, appelé dans le
`_onRender()` de **chaque** fiche. Si tu ajoutes une nouvelle fiche, n'oublie
pas d'appeler `applyUiTheme(root)` dedans aussi.

**Variables clés** (`styles/theme.css`) : `--ink`, `--ink-text`, `--arcane`,
`--brass`, `--ember`, `--teal`, `--sage`, `--amber`, `--el-*` (8 couleurs
élémentaires). Les fiches Foundry natives (`--color-text-*`, `--color-border-*`)
sont **figées** à l'intérieur de `.rpg-sheet` pour ignorer le thème clair/sombre
du core Foundry.

⚠️ **Piège connu** : le fond de `.rpg-sheet` doit être opaque (`!important`)
sinon le fond clair par défaut de la fenêtre Foundry rend le texte illisible.
Voir commit `e5a2bb1` si ça recasse.

---

## ⚠️ Points de vigilance / pièges déjà rencontrés

1. **`submitOnChange: true` + `this.render()` manuel = boucle infinie / crash.**
   Ne JAMAIS appeler `this.render()` après un `document.update()` dans un handler
   de clic si `submitOnChange` est actif — Foundry re-rend déjà tout seul.
   Utiliser un verrou `this._btnUpdating` avec `setTimeout(300ms)` pour les
   boutons cliqués rapidement (+1/-1/+5/-5 etc).

2. **`system.blessures` (et tout array) peut être sérialisé en `{}` par Foundry.**
   Toujours faire `Array.isArray(x) ? x : Object.values(x ?? {})` avant `.push()`.

3. **Portrait (`img`) vs Token (`prototypeToken.texture.src`) sont séparés.**
   Utiliser `{ noTokenUpdate: true }` sur `update()` pour ne pas synchroniser
   l'un vers l'autre. Géré dans le hook `preUpdateActor` de `init.js`.

4. **Dialog V1 (`new Dialog(...)`) donne un warning de dépréciation en V13.**
   Utiliser `foundry.applications.api.DialogV2` avec fallback vers `Dialog`
   classique si `DialogV2` n'existe pas (V12). Voir `dialog-compat.js` et
   `_editStateDialog` dans `character-sheet-v2.js` pour l'exemple complet.

5. **Les fiches monstre et joueur PARTAGENT le code d'édition d'état**
   (`_editStateDialog`, `_normalizeState`, `_stateDefaults`, `_allModKeys`,
   `_postStateInfoToChat`) — exportées depuis `character-sheet-v2.js` et
   importées dans `monster-sheet-v2.js`. Si tu modifies l'un, vérifie l'autre.

6. **Toujours vérifier l'équilibre des accolades/div après une édition Python
   en masse** (`content.count('{') == content.count('}')`, idem pour `<div>`
   et `</div>` dans les templates HBS). Plusieurs bugs venaient de balises
   orphelines après des remplacements automatisés.

7. **Après TOUTE modification de `module/macro/*.js`, régénérer
   `packs/macros/macros.db`** avec le script Python dans les commits précédents
   (cherche `macros_defs` dans l'historique) — sinon Foundry charge l'ancienne
   version depuis le compendium.

---

## 🧪 Comment vérifier avant de commit/push (fais-le SYSTÉMATIQUEMENT)

```bash
cd /chemin/vers/jdr-foundry

# JS — syntaxe de TOUS les fichiers
npm install acorn --no-save 2>/dev/null
node -e "
const acorn=require('acorn'),fs=require('fs'),path=require('path');
function walk(dir,r=[]){for(const f of fs.readdirSync(dir)){const full=path.join(dir,f);if(fs.statSync(full).isDirectory()){if(f==='node_modules')continue;walk(full,r);}else if(f.endsWith('.js'))r.push(full);}return r;}
const files=walk('module');let err=0;
for(const f of files){const s=fs.readFileSync(f,'utf8');try{acorn.parse(s,{ecmaVersion:2022,sourceType:'module'});}catch(e1){try{acorn.parse(s,{ecmaVersion:2022,sourceType:'script'});}catch(e2){err++;console.log('ERR:',f,e1.message);}}}
console.log('JS total:',files.length,'erreurs:',err);
"

# HBS — tous les templates
npm install handlebars --no-save 2>/dev/null
node -e "
const H=require('handlebars'),fs=require('fs'),path=require('path');
function walk(dir,r=[]){for(const f of fs.readdirSync(dir)){const full=path.join(dir,f);if(fs.statSync(full).isDirectory())walk(full,r);else if(f.endsWith('.hbs'))r.push(full);}return r;}
const files=walk('templates');let err=0;
for(const f of files){try{H.precompile(fs.readFileSync(f,'utf8'));}catch(e){err++;console.log('ERR:',f,e.message);}}
console.log('HBS total:',files.length,'erreurs:',err);
"

# CSS — équilibre des accolades
for f in styles/*.css; do python3 -c "
c=open('$f').read();o,cl=c.count('{'),c.count('}')
print(f'$f: {\"OK\" if o==cl else \"DESEQUILIBRE\"}')"; done

# system.json valide
python3 -c "import json; json.load(open('system.json')); print('OK')"
```

---

## 📝 Workflow Git habituel

```bash
git config user.email "fix@rpg-system.local"
git config user.name "RPG Fix"
git add -A
git commit -m "type: description claire et détaillée du changement + pourquoi"
git push https://magusin:<TOKEN>@github.com/magusin/jdr-foundry.git main
```

Le token GitHub est fourni par l'utilisateur en début de conversation — ne
JAMAIS le committer en dur dans un fichier du repo (seulement dans la commande
`git push` elle-même, qui n'est jamais versionnée).

---

## 🎯 Idées non traitées / pistes pour la suite

- **Consommables** : volontairement laissés narratifs (RP) par choix de
  l'utilisateur — pas de logique de jeu automatique dessus pour l'instant,
  pour éviter de déséquilibrer le combat.
- **Recettes du compendium** (60 items) : ont toutes `difficulté: 0` — à
  varier par le MJ selon son propre équilibrage.
- **Compendium de sorts** : vide, à remplir par le MJ selon ses besoins.
- **Boutons de fenêtre Foundry cassés** (icônes en carrés vides dans le
  titre de fenêtre) signalés une fois — diagnostiqué comme PROBABLEMENT
  extérieur à notre CSS (le `.window-header` est structurellement en dehors
  de `.rpg-sheet`). Pas confirmé résolu — à vérifier si ça revient.
- Voir aussi la section "Axes d'amélioration" que Claude a proposée dans
  cette conversation pour d'autres idées (auras sur monstres, HUD joueur
  compact PV/Mana en combat, etc.) — redemander cette analyse si besoin,
  elle n'est pas dans ce fichier pour rester concis.

---

## 🗣️ Contexte utilisateur

L'utilisateur est le MJ (Jacques), développe ce système seul pour ses
sessions de jeu avec ses joueurs. Communique en français. Préfère que les
choses soient testées et vérifiées avant de considérer une tâche terminée
(voir `GUIDE_TEST.md` pour le protocole complet qu'il utilise). Aime les
explications claires du "pourquoi" dans les messages de commit.
