# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A custom French-language Foundry VTT game system (`id: "rpg"`, system.json), built for Foundry V13 (ApplicationV2 / DocumentSheetV2 / HandlebarsApplicationMixin). No build step: pure ES modules loaded directly by Foundry (`esmodules: ["module/init.js"]` in `system.json`), no bundler, no `package.json` scripts. `node_modules/handlebars` at repo root exists only to validate templates locally (see Verifying changes below).

## Verifying changes (no build, no test suite)

There is no bundler and no test runner. Before considering a change done, run these checks — they catch the two classes of errors `node --check` misses: link-time failures (duplicate exports, bad imports) and template syntax errors.

**1. Every module loads without throwing** — write a throwaway ESM harness that stubs the Foundry globals and imports every file under `module/`:
```js
// stubs: foundry, game, CONFIG, CONST, Hooks, ui, canvas, Actor, Item, Combat, Combatant,
// ChatMessage, Roll, Dialog, RollTable, Macro, JournalEntry, Scene, Token, TokenDocument,
// fromUuid, fromUuidSync, loadTemplates, renderTemplate, getDocumentClass, Handlebars, PIXI
// (a Proxy that is callable/constructible/indexable works for all of them)
// then: for f of walk("module") -> await import(pathToFileURL(f))
```
A module that throws at import time (e.g. two files declaring the same top-level name) is otherwise invisible until Foundry loads it in-browser.

**2. Every `.hbs` template compiles**: `Handlebars.precompile(fs.readFileSync(path, "utf8"))` for each file under `templates/`.

**3. `system.json` and `template.json` are valid JSON** (`python3 -c "import json; json.load(open('...'))"`) — hand-editing `template.json` to add a schema field is common and easy to break.

Do all three from the repo root; there's no reason to scaffold this outside it.

## Architecture

### The permission model is the hard part

Most bugs in this codebase are permission bugs, not logic bugs: an action *works* for the GM and silently does nothing for a player. Two mechanisms enforce this and both are easy to defeat by accident:

- **`preUpdateItem` / `preUpdateActor` hooks in `init.js`** whitelist which dot-paths a non-GM write may touch (`system.equipe`, `system.cooldown.restant`, etc.). Foundry returns `false` from the hook to silently reject the whole update — no error, no partial write. When a player-facing feature "does nothing," check this whitelist first. Foundry itself injects bookkeeping keys into the payload (`_id` on `updateEmbeddedDocuments`, `_stats`, `sort`, `flags.*`, and `type` when unchanged) — the filter must ignore these rather than compare every key literally, or **every** grouped write from a player fails at once. See the `isBookkeeping` predicate in `init.js` for the current set.
- **Sheet-side view mode**: every sheet's `_onRender` checks `game.user.isGM` and, if false, disables every `input/select/textarea` in the content region (never the window header — that's where Close/Pin live) via `sheetContent()` / `sheetActionButtons()` in `sheets/sheet-helpers.js`. Any handler a player needs (declare a spell, change an equipment slot) must be bound **before** this early return, and any control the player is allowed to touch must be explicitly exempted from the blanket disable.

A hook's rejection is silent by design — when debugging a "nothing happens" report, log the rejected keys rather than guessing.

### `game.rpg.*` is the module→macro bridge

Macros (`module/macro/*.js`) are plain scripts installed as Foundry `Macro` documents (via `auto-install.js`, which fetches the file's source and creates/updates the compendium macro — see `MACRO_LIST` there for the macro→file→version mapping). They are **not** ES modules and cannot `import`. Anything a macro needs from `module/rules/*` must be exposed on the `game.rpg` namespace during `init.js`'s `ready` hook (e.g. `game.rpg.combat`, `game.rpg.ranges`, `game.rpg.chat`, `game.rpg.defaultActions`). When adding a rule module a macro will call, remember to attach it to `game.rpg` — importing it directly from a macro file will fail silently at runtime.

### Derived stats: one function, one direction

`RPGActor.prepareDerivedData()` in `documents/actor.js` is the single source of truth for every computed stat (effective principales, defenses, fatigue max, pods/carry capacity, epuisement/exhaustion state, etc.). It reads `system.base.*` plus equipment/effect bonuses and writes `system.derived.*`. Sheets and rules read `system.derived.effective.*` — never recompute a formula in a sheet or macro. If a stat looks wrong, this file is where the bug almost always is, not in the sheet displaying it.

### Combat resolution is declare → GM-validate → resolve, always in that order

For both spells (`rules/spells.js`) and weapon attacks (`rules/attack-declare.js` + `rules/attack-resolve.js`): the player's action posts a chat message with the roll and a set of GM-only buttons (Échec/Réussite/Critique/Échec Critique). Only after the GM clicks does damage actually get rolled and applied — `resolveDeclaredSpellFromMessage` / the attack-resolve equivalent. Never short-circuit this to apply damage at declaration time; the whole flow (fatigue cost, cooldowns, action budget consumption) is wired to fire at resolution, not declaration.

- **`computeTN` in `rules/combat.js`** is the single seuil-de-touché (target number) formula: `TN = tnFromRatio(atk/def stats) + difficulté − bonus de toucher`, clamped to `[6, 16]`. Difficulty is *not itself* the TN — always route a forced/overridden difficulty back through `computeTN`/`applyDifficulty` rather than adding it to `tnFinal` after the fact, or you bypass the clamp and the friendly-target branch.
- **Friendly/self targets skip the stat comparison entirely** (`isFriendlyTarget`, keyed off token disposition): the difficulty field on the item *is* the TN outright, and `0` means automatic success. This only applies when the target is an ally or the caster themself — don't reuse this branch for hostile targets.
- **Chat visibility** (`rules/chat-visibility.js`): `.rpg-gm-only` spans are stripped from the DOM for non-GMs, `.rpg-hp-secret` spans are stripped unless the viewer owns the referenced actor. Both hooks run in `renderChatMessageHTML`. Anything revealing a verdict before GM validation, or an enemy's exact HP, must go through one of these wrappers (`gmOnly()` / `hpSecret()`), not be written to raw chat content.

### Action economy: budget slots, not free-form

`rules/action-budget.js` tracks a per-combatant, per-round budget (`slotsTotal.max = 2`) with named slots (`attaque`, `sortNormal`, `sortRapide`, `deplacement`, `recuperation`, `echangeArme`), each independently capped, stored as a combat flag (`getBudget`/`saveBudget`/`canUseSlot`/`reserveSlot`/`confirmSlot`). Fatigue-per-action is a *separate* concern from slot consumption — `actionFatigueCost(slot)` reads world settings (`fatigueAttaque`, `fatigueDeplacement`, `fatigueEchangeArme`), defaulting attack to 1 and movement/weapon-swap to 0, but a weapon's own `system.fatigueCost` field overrides the setting when present. Fatigue itself is **not capped at its max** (`prepareDerivedData` in `actor.js`) — the max is an exhaustion *threshold*, not a storage ceiling, so overshooting it is meaningful and must climb back down through it.

### Every actor gets baseline "spell" items, not hardcoded actions

`rules/default-actions.js` grants every `character`/`monster` a small set of always-available actions (Repos, Attaquer, Changer d'arme), implemented as real `type: "spell"` items so they get chat declaration, GM validation, action-budget integration, and hotbar drag-for-free. Attribution happens on `createActor` and via a version-gated backfill (`backfillDefaultActions`, called from `ready`) for actors created before a given action existed — bump the module's internal `VERSION` constant when adding a new default action so existing actors pick it up. `runDefaultAction(actor, item, opts)` is the dispatcher both the sheet and the hotbar (`rules/hotbar.js`) call before falling through to the normal spell workflow — check `defaultActionKey(item)` there when adding a new baseline action rather than special-casing item names.

### Codex: compendium visibility is possession-gated

`rules/codex.js` filters `renderCompendium` for non-GMs so item-type compendiums only show entries a player's character has ever had (`flags.rpg.codex` on the actor, populated by `createItem`, matched against compendium entries by source UUID / id / lowercased name — never purged, since "has had" persists after an item is sold or consumed). Non-item compendiums (journal/rules, roll tables) are never filtered. Monster actor sheets are separately gated: GM must set `system.pvReveal` (`none`/`pct`/`exact`) to reveal anything beyond illustration+description, and monsters need at least `LIMITED` ownership for a player to open the sheet at all (`openMonsterToPlayers`, run once per monster the first time it's touched by `grantDefaultActions`/backfill — never overrides a GM-set ownership level).

### Theming is global and mandatory per-window

`styles/theme.css` defines the design tokens (`--ink`, `--brass`, `--ember`, `--el-*`, etc.) for three user-selectable themes (`sombre`/`clair`/`contraste`, world/client setting `rpg.uiTheme`). Every sheet must call `applyUiTheme(root)` (`sheets/sheet-helpers.js`) from its own `_onRender`, and `applyGlobalTheme()` (called once from `init.js`'s `ready` hook) stamps the theme class on `<body>` so non-sheet windows (macro dialogs, DialogV2 prompts) inherit it too. A new sheet or macro dialog that skips this will render in Foundry's default (unthemed) look regardless of the user's choice.

### Movement is metric, not grid-square

Distances are computed in meters via weighted-diagonal movement cost (`rules/movement-tracker.js`, `rules/distance.js`), not raw grid squares — terrain difficulty (`rules/region-behaviors.js`, V13 drawn Regions) and movement-type immunities (`rules/movement-types.js`) both scale this cost. Because cost isn't linear when terrain varies along a path, clamping a drag to "however far is left" requires a binary search over `calculateMovementCost` (`rules/drag-limit.js`) rather than vector scaling. The speed limit is enforced twice: at drag-time (visual clamp, `drag-limit.js`) and at commit-time (`onPreUpdateToken` in `movement-tracker.js`, which clamps rather than outright rejects an over-budget move so V13's non-`return false`-honoring token update doesn't leave the player confused).

## Repo layout notes

- `module/sheets/*-v2.js` are the live ApplicationV2 sheets; the non-`-v2` files of the same name (`character-sheet.js`, `monster-sheet.js`, `item-weapon-sheet.js`, ...) are the old V1 implementations, unregistered but kept in-tree for reference.
- `templates/item/spell-sheet.hbs` (and its controller `item-spell-sheet-v2.js`) is the most heavily-loaded item sheet: damages[], restores[] (heal/mana/fatigue given back, mirrors damages[] with a `siphon` lifesteal % field), and effectsUI[] (bonus/malus/aura/DOT/HOT catalog) all live there, each with GM-editable grids that must stay hidden from non-owner players and a separate `playerInfo`-style read-only summary for the player view.
- `packs/*/[name].db` are newline-delimited JSON (NDJSON) compendium sources, hand-editable with a small Python script (`json.loads` per line, mutate, re-`json.dumps` per line) — this is how `packs/documentation/documentation.db` (in-game player/GM guides) gets updated. Don't hand-edit `packs/documentation/documentation.db` if Foundry has the world open locally and may have rewritten it (locally-modified `.db` blocks `git pull` — `git checkout -- packs/documentation/documentation.db` before pulling if this happens).
- A `.claudeignore` exists (`*.db`, `assets/`, `GUIDE_TEST.md`, `HANDOFF.md`) and a `.claude/settings.local.json` mirrors it via `permissions.deny` on `Read`/`Glob`/`Grep` (not `Bash` — the NDJSON edit trick above is unaffected). Neither took effect when tested empirically (2026-07-28) from a session that was already running before the files existed on disk — config appears to be read at session start, not hot-reloaded (same caveat documented for hooks: the watcher only covers directories present at launch). If you need to confirm either is active, test from a **freshly started** session (`Read`/`Glob`/`Grep` on a path both files list, e.g. `packs/*.db`) rather than assuming — don't trust a stale "doesn't work" conclusion from a session where the config was added mid-way, and don't trust it works without testing fresh either.
- `system.json`'s `version` field should not be bumped without being explicitly asked to — treat this as a standing instruction, not a one-off.
- Push only to the working branch, never to `main` — the user merges to `main` on GitHub directly. Treat this as a standing instruction, not a one-off.
