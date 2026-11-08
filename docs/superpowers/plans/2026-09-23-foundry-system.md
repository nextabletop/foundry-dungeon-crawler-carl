# DCC Foundry VTT System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Dungeon Crawler Carl Roll20 sheet (`character-sheet/`) to a Foundry VTT v14 game system in `./foundry`. The system has three actor types (`pc`, `mob`, `vehicle`), four item types (`weapon`, `skill`, `spell`, `gear`), and modifiers expressed as ActiveEffects.

**Architecture:**
- All game math lives in pure ES modules under `foundry/module/rules/`. They have no Foundry globals and are unit-tested with vitest. Each is ported from the R20 sheet, whose tests serve as the oracle.
- Thin `TypeDataModel`s call one pure `deriveCreature()` / `deriveVehicle()` function from `prepareDerivedData`.
- Modifiers are ActiveEffect changes of a custom change type, `dcc`. Its handler collects them during Foundry's `initial` effect phase, and the derive step applies them with the exact R20 materialization rule.
- Sheets are ApplicationV2 + Handlebars.
- Crew are linked to a vehicle by actor UUID. Crew bonuses resolve at roll time.

**Tech Stack:** Foundry VTT 14.360 (installed at `F:\Program Files\Foundry Virtual Tabletop`), ES modules (`.mjs`), Handlebars, plain CSS, vitest 4 (node env for rules, jsdom only where needed), npm.

---

## Global context every task needs

### Repos, paths and conventions
- **This repo:** `E:\Git\NexTableTop\DungeonCrawlerCarl`, branch `feat/foundry-system`. All new code goes under `foundry/`. Never touch `character-sheet/` (the R20 sheet) except to read it.
- **Reference system:** `E:\Git\NexTableTop\mythcraft\mythcraft`. It is a working Foundry v14 system with the same patterns: `index.mjs`, `module/data`, `module/applications/sheets`, `test/setup/foundry-mock.mjs`. Read it when unsure how a Foundry API is used.
- **Foundry client source**, which is ground truth for v14 APIs: `F:\Program Files\Foundry Virtual Tabletop\resources\app\client\` and `...\common\`.
- **Code style:**
  - `const`/`let`, never `var`.
  - Single quotes and template literals.
  - Conventional commits (`feat(foundry): …`, `test(foundry): …`).
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Run commands** from `foundry/` using its npm scripts, e.g. `npm --prefix foundry test`. Do not `cd` in shell commands.
- **Live Foundry testing only works from the main checkout** (`E:\Git\NexTableTop\DungeonCrawlerCarl`), because the Foundry data dir junction points there. Worktree edits never reach the live server.

### System identity
- System id: **`dungeon-crawler-carl`**. Do not use `dcc`, which belongs to Dungeon Crawl Classics.
- The Foundry data dir is `F:\FoundryData-Dev`. The system folder is `F:\FoundryData-Dev\Data\systems\dungeon-crawler-carl`, a directory junction to `E:\Git\NexTableTop\DungeonCrawlerCarl\foundry`.
- The server runs on port 30001 via `node "F:\Program Files\Foundry Virtual Tabletop\resources\app\main.mjs" --dataPath="F:\FoundryData-Dev" --port=30001`.
- Hot reload is **off** (`options.json` `hotReload:false`), so reload the browser after every change.

### v14 API rules (verified against the installed client)
- **Registration** uses namespaced APIs only:
  - `foundry.applications.apps.DocumentSheetConfig.registerSheet(foundry.documents.Actor, 'dungeon-crawler-carl', Cls, { types:[…], makeDefault:true })`
  - `foundry.applications.sheets.ActorSheet`, `foundry.applications.sheets.ItemSheet`, `foundry.applications.api.HandlebarsApplicationMixin`
  - `foundry.applications.handlebars.renderTemplate` / `loadTemplates`
  - Never the deprecated globals `renderTemplate` or `CONFIG.Dice.rollModes`. Use `CONFIG.ChatMessage.modes`.
- **ActiveEffect data model** (`CONFIG.ActiveEffect.dataModels.base`) **must** extend `foundry.data.ActiveEffectTypeDataModel`. Otherwise you get `must define a changes field`.
  - A change is `{key, type (string, default 'add'), value, phase ('initial'|'final', default 'initial'), priority}`.
  - `ActiveEffect#isSuppressed` returns `!!(this.system.isSuppressed ?? this.duration.expired)`. Suppression is therefore controlled by a getter on the AE *system model*.
- **Custom change types** are registered as `CONFIG.ActiveEffect.changeTypes[<type>] = { label, defaultPriority, handler(targetDoc, change, {field, replacementData, modifyTarget}) }`. When `handler` is a function, core calls it instead of applying the change.
- **Actor preparation order in v14:**
  1. `prepareBaseData`
  2. `prepareEmbeddedDocuments` (items are prepared here)
  3. `applyActiveEffects('initial')`
  4. `prepareDerivedData`
  5. `applyActiveEffects('final')`
- **Item-level derived values** (to-hit, skill bonus, effective mana cost) need the actor's stat mods. They are therefore computed in the **actor's** derived step and written onto each item's `system`.

### R20 behaviour to preserve (source: `character-sheet/`)
- **Stats:** `strength, intelligence, constitution, dexterity, charisma`, each with a base (the "Unenhanced" value, default 1).
- **Stat mod** (`statMod`): thresholds `>=300→10, >=200→9, >=150→8, >=100→7, >=50→6, >=20→5, >=10→4, >=6→3, >=3→2, else 1`.
- **Materialization rule:** `applyMods(base, flat, pct) = Math.floor(((+base||0)+(+flat||0))*(1+(+pct||0)/100))`.
- **Modifier value text:** `'2'` means flat 2; `'10%'` means percent 10. Anything unparseable becomes 0, keeping the kind.
- **Modifier targets:**
  - Fields: `strength, intelligence, constitution, dexterity, charisma, dr, evade, move, step, mana`.
  - One item by name: `item:<Name>:<aspect>`.
  - A group: `group:<weapons|skills>[:<attr>(=|!=)<value>]:<aspect>`.
  - Aspects: weapons have `tohit`, `damage`; skills and spells have `rank`, `manaCost`.
  - A percent on `damage` is dropped.
  - For groups, weapons accept the attrs `stat` and `dmgType`; skills and spells accept `stat` and `class`.
- **Health Bar:** the stored value is `hb` (slots remaining).
  - `hbSlots`: `pc` = 10; `mob` = `max(1,min(10,level))`; `vehicle` = `max(1,min(8,size))`.
  - `hp.value = hb*conMod` and `hp.max = hbSlots*conMod`. The vehicle's con mod is `vehicleConMod`, and blank means 5.
- **Defenses:**
  - `evade = applyMods(10 + dexMod, bonus.evade, pct.evade)`
  - `dr = applyMods(armor, bonus.dr, pct.dr)`
  - `move`/`step` are user-editable. The base is back-calculated as `entered − bonus`; the defaults are move 0, step 5.
  - `mana.max = applyMods(<manaStat>_enh, bonus.mana, pct.mana)`.
- **Rolls** (for mobs, all rolls are whispered to the GM unless `mobPublic`):
  - Ability: `1d20 + mod`.
  - Evade: `1d20 + dexMod + intMod`.
  - Skill: `1d20 + skillBonus`, where `skillBonus = statMod[stat] + applyMods(rank, rb.rank, rp.rank)`.
  - Weapon: to-hit `1d20 + tohit`, where `tohit = applyMods(statMod[stat] + rank, rb.tohit, rp.tohit)`. Damage is `die + dmgBase`, where `dmgBase = dmgBonus + rb.damage`.
- **Mob:**
  - `mobTohit = 10 + strMod + floor` and `mobEvade = 10 + dexMod + floor`.
  - Per-weapon static target: `mobtohit = 10 + tohit + floor`.
  - Mob attacks roll damage only.

The full inventory of R20 behaviour is in the section **"Appendix A — R20 spec inventory"** at the end of this plan. Read the parts relevant to your task.

---

## File structure (locked)

```
foundry/
  system.json                     manifest
  package.json                    scripts: test, test:watch, lint
  vitest.config.mjs
  .gitignore                      node_modules, packs
  index.mjs                       init/ready hooks, registrations
  lang/en.json                    all labels (DCC.* keys)
  styles/system.css               all sheet + chat CSS (layer "system")
  module/
    config.mjs                    DCC constants (stats, damage types, slots, vehicle sizes, check types)
    rules/                        PURE — no Foundry globals, imported by tests directly
      engine.mjs                  statMod, applyMods, parseModifierValue, backCalcBase, hbSlotsFor, whisperToGM
      modifiers.mjs               parseTarget, resolveModifiers(mods, items) → {bonus,pct,itemBonus,itemPct}
      health.mjs                  hpFromHb … isDying (ported verbatim)
      advancement.mjs             advancementRoll, rankCapClamp, advancesAt, nextRank, undoPush, undoPop
      combat.mjs                  attackToHit, damageLabel, mobToHit, mobEvade, manaAfterCast
      inventory.mjs               isItemActive, buildGear, buildAccessories
      vehicle.mjs                 VEHICLE_SIZES, d20Expr, advLabel, drivingCheckDC, ramAftermath, raceBonus, vehicleMove, cruiseMph
      crew.mjs                    crewSkillBonus, crewPenalty, speedDieNote
      gm-screen.mjs               floorEndsAvailable, floorEndBlocked, baseActor(Uuid), resolveGmLink, gmGate, baselineUpdate, roster helpers, undoFloorEndBlockers (Chunk 8)
      derive.mjs                  deriveCreature(input) / deriveVehicle(input) — the recalcAll port
    data/
      _fields.mjs                 small field helpers (int(), str())
      actor/creature.mjs          CreatureModel (shared by pc + mob)
      actor/pc.mjs  actor/mob.mjs  actor/vehicle.mjs  actor/_module.mjs
      actor/gmscreen.mjs          GmScreenModel (safehouse, floorEndSeq, roster) + roster / floor-end operations (Chunk 8)
      item/base-item.mjs          description
      item/weapon.mjs skill.mjs spell.mjs gear.mjs _module.mjs
      effect/effect-model.mjs     DCCEffectModel (isSuppressed from parent item)
    effects/dcc-change.mjs        CONFIG.ActiveEffect.changeTypes.dcc handler
    documents/actor.mjs           DCCActor (hp edits → hb, roll entry points)
    documents/item.mjs            DCCItem
    gm-link.mjs                   GM screen world setting, gmLinkFor, rosterEntries, live-update hooks (Chunk 8; Foundry-facing, no sheet imports)
    rolls/card.mjs                cardContext(fields, results) PURE + postCard(actor, fields) Foundry
    applications/
      actor-sheet-base.mjs        shared ApplicationV2 actor sheet (actions, item CRUD, health bar)
      pc-sheet.mjs  mob-sheet.mjs  vehicle-sheet.mjs  item-sheet.mjs
      gmscreen-sheet.mjs          GmScreenSheet (Chunk 8)
  templates/
    actor/pc/{header,combat,inventory,skills,bio,settings}.hbs
    actor/mob/body.hbs  actor/vehicle/body.hbs  actor/gmscreen/body.hbs
    actor/partials/{health-bar,item-row,defenses}.hbs
    item/{weapon,skill,spell,gear}.hbs
    chat/card.hbs
  test/
    setup/foundry-mock.mjs
    rules/*.test.mjs  data/*.test.mjs  rolls/*.test.mjs
```

---

## Chunk 1: Scaffold and tracer bullet

### Task 1: Scaffold the system package

**Files:**
- Create: `foundry/package.json`, `foundry/vitest.config.mjs`, `foundry/.gitignore`, `foundry/system.json`, `foundry/index.mjs`, `foundry/lang/en.json`, `foundry/styles/system.css`, `foundry/module/config.mjs`
- Create: `foundry/module/data/_fields.mjs`, `foundry/module/data/actor/{creature,pc,mob,vehicle,_module}.mjs`, `foundry/module/data/item/{base-item,weapon,skill,spell,gear,_module}.mjs`, `foundry/module/data/effect/effect-model.mjs`
- Create: `foundry/module/documents/{actor,item}.mjs`, `foundry/module/applications/{actor-sheet-base,pc-sheet,mob-sheet,vehicle-sheet,item-sheet}.mjs`, and minimal templates for each sheet
- Create: `foundry/test/setup/foundry-mock.mjs`, `foundry/test/data/schema-smoke.test.mjs`

- [ ] **Step 1: `foundry/package.json`**
```json
{
  "name": "dungeon-crawler-carl-foundry",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "test:watch": "vitest" },
  "devDependencies": { "vitest": "^4.1.0", "jsdom": "^29.0.1" }
}
```
Run `npm --prefix foundry install`. `.gitignore` contains `node_modules/` and `packs/`.

- [ ] **Step 2: `foundry/vitest.config.mjs`**
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  environment: 'node', setupFiles: ['./test/setup/foundry-mock.mjs'],
  include: ['test/**/*.test.mjs'], globals: true } });
```

- [ ] **Step 3: `foundry/test/setup/foundry-mock.mjs`**
  - Copy `E:\Git\NexTableTop\mythcraft\mythcraft\test\setup\foundry-mock.mjs`.
  - Add `ArrayField(element, opts)` (stores `.element`), `ObjectField`, `DocumentUUIDField` and `FilePathField` mocks. Add `foundry.data.ActiveEffectTypeDataModel = MockTypeDataModel`.
  - Replace the `mythcraft` global with `globalThis.dcc = { CONFIG: {} }`.
  - Add `foundry.utils.hasProperty` and an `async _preUpdate() {}` no-op on `MockTypeDataModel`. Task 12 needs both.
  - The mock constructor only runs `Object.assign`s the data: it sets no `parent` and applies no schema `initial` values. Tests that build models must pass a **full** source object and set `model.parent` (or `effectModel.parent.parent`) by hand.

- [ ] **Step 4: `module/config.mjs`** exports:
```js
export const SYSTEM_ID = 'dungeon-crawler-carl';
export const STATS = ['strength', 'intelligence', 'constitution', 'dexterity', 'charisma'];
export const STAT_ABBR = { strength: 'STR', intelligence: 'INT', constitution: 'CON', dexterity: 'DEX', charisma: 'CHA' };
export const DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning', 'fire', 'cold', 'lightning', 'poison', 'psychic', 'force', 'necrotic'];
export const GEAR_SLOTS = ['head', 'torso', 'arms', 'hands', 'legs', 'feet'];
export const ITEM_SLOTS = ['pack', ...GEAR_SLOTS];
export const CHECK_TYPES = ['opposed', 'unopposed', 'generic'];
export const FIELD_TARGETS = [...STATS, 'dr', 'evade', 'move', 'step', 'mana'];
export const ITEM_ASPECTS = { weapon: ['tohit', 'damage'], skill: ['rank', 'manaCost'], spell: ['rank', 'manaCost'] };
export const GUNNER_SLOTS = ['driver', '1', '2', '3', '4'];
export const HB_MAX_SLOTS = 10;
export const VEHICLE_SIZE_MAX = 8;
export const VEHICLE_CON_MOD_DEFAULT = 5;
```

- [ ] **Step 5: Data models (full schemas, derive stubbed).** Use `const fields = foundry.data.fields;`. Integers use `NumberField({required:true, nullable:false, integer:true, initial:N})`.

  **`CreatureModel`** (`actor/creature.mjs`, shared by pc and mob):
  - Identity and progress: `level` (1), `floor` (1).
  - `stats`: SchemaField of the 5 stats, each `{ base: int initial 1 }`.
  - Health: `hb` (int, initial 10, min 0), and `hp` SchemaField `{ value:int 0, max:int 0 }`. `hp` exists only so the token bar works and is overwritten in derive.
  - Defenses: `armor` (0), `moveBase` (0), `stepBase` (5), `size` (string 'M').
    - Do **not** store `move`/`step`. They are derived only. The sheet maps an edited `system.move` to `system.moveBase` via `backCalcBase` (Task 14).
    - Deliberate deviation: a fresh PC shows step 5. R20 effectively shows 0 until the user edits it.
  - `notes` (HTMLField).
  - `prepareDerivedData()` is empty for now.

  **`PcModel`** extends CreatureModel and adds:
  - Identity: `race`, `pronouns`, `class` (strings), `crawlerNumber` (string), `aiFavor` (int 0).
  - Advancement: `pendingLevels` (0), `statPoints` (0), `undoStack` (ArrayField of ObjectField, initial []).
  - Mana: `mana` SchemaField `{ value:int 0, max:int 0 }`, `manaStat` (string, choices STATS, initial 'intelligence'), `autoEnableCast` (boolean true).
  - Bio: `popularity`, `pastTrauma`, `looseEnds`, `regrets` (HTMLField).

  **`MobModel`** extends CreatureModel and adds `descriptors` (string), `surprise` (int 10) and `mobPublic` (boolean false).

  **`VehicleModel`** (standalone):
  - Core: `kind` (choices vehicle|mount, 'vehicle'), `size` (int 4, min 1 max 8), `speed` (0), `speedMax` (4), `conMod` (int, nullable, min 1, initial 5; null means 5), `passengers` (1), `driveSkill` ('Driving'), `armor` (0), `floor` (1).
    - Deliberate deviation: R20 allows a con mod of 0, which makes the vehicle immune to damage. Here the minimum is 1.
  - Health: `hb` (int 4), `hp {value,max}`.
  - Roll inputs: `rollAdv` (choices ''|adv|dis), `drivingMode` (accelerate|stop|longhaul), `drivingTarget` (1), `ramTargetEvade` (10), `ramTargetLarger` (bool), `ramDamageDealt` (0), `raceAhead` (0).
  - Crew (crew must be world actors, not unlinked token actors): `crew` (ArrayField of SchemaField `{ uuid: DocumentUUIDField({type:'Actor', embedded:false}), role: string choices driver|gunner1|gunner2|gunner3|gunner4|passenger }`, initial []). This is filled in Chunk 7, but defining the field now avoids a migration.
  - `passengersNote` (string) and `notes` (HTMLField).

  **Items** (all extend `BaseItemModel { description: HTMLField, onHotlist: boolean false }`):
  - **`weapon`:**
    - Attack: `stat` (choices STATS, 'strength'), `rank` (0), `skill` (string), `die` ('1d6'), `dmgBonus` (0), `dmgType` (choices DAMAGE_TYPES + '', 'bludgeoning').
      - `skill` is the name of a skill whose **base** rank replaces `rank` when set. This replaces R20's `is_attack` linked-attack rows, which synced the skill's base rank. Resolution is by name.
    - Inventory: `qty` (1), `slot` (choices ITEM_SLOTS, 'pack'), `active` (bool false). A weapon's effects are gated by `isItemActive`, the same as gear.
    - Vehicle-only: `gunnerSlot` (choices GUNNER_SLOTS + '', ''), `skillName` (string).
  - **`skill`:** `stat` ('dexterity'), `rank` (0), `mark` (bool), `enabled` (bool false), `checkType` (choices CHECK_TYPES, 'unopposed'), `passive` (bool), `class` (string).
  - **`spell`:** everything in skill, plus:
    - `manaCost` (0)
    - `attack` SchemaField `{ enabled:bool false, die:'', dmgBonus:0, dmgType:'' }`.
      - When `attack.enabled` is set, the spell also appears in the attack list.
      - Its to-hit uses the attack formula `applyMods(statMod(stat) + base rank, ib.tohit, ip.tohit)`, as R20's linked attack does.
      - Its to-hit button casts the spell, which deducts mana.
  - **`gear`:** `qty` (1), `slot` (choices ITEM_SLOTS, 'pack'), `active` (bool), `accessory` (bool).

  **`DCCEffectModel`** extends `foundry.data.ActiveEffectTypeDataModel` with no `defineSchema` override. Leave its `isSuppressed` getter unimplemented for now; Task 11 adds it.

- [ ] **Step 6: Documents and sheets (bare).**
  - `DCCActor extends foundry.documents.Actor` and `DCCItem extends foundry.documents.Item`, both empty.
  - `DCCActorSheetBase = HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheet)`:
    - `DEFAULT_OPTIONS = { classes:['dcc','sheet','actor'], position:{width:720,height:800}, window:{resizable:true}, form:{submitOnChange:true}, actions:{} }`
    - `_prepareContext` adds `system: this.document.system`, `source: this.document.system._source`, `config: CONFIG.DCC` and `items` grouped by type.
  - `PcSheet`, `MobSheet` and `VehicleSheet` each extend the base with one PART (`templates/actor/<type>/body.hbs` for now). Each part shows the name input and a `<pre>{{json system}}</pre>` dump, with a registered `json` Handlebars helper.
  - `DCCItemSheet = HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheet)` has one part per item type, each rendering name, img and `{{formGroup}}` for every schema field.
    - Use `systemFields` from `this.document.system.schema.fields`.
    - **Skip `SchemaField`s in the loop.** `{{formGroup}}` on a SchemaField logs a console error (`DataField#_toInput` throws). Render the fields of `spell.attack` explicitly.
    - v14's `{{formGroup field value=…}}` helper renders inputs from DataFields; see `mythcraft/templates/item/*.hbs` for usage.

- [ ] **Step 7: `index.mjs`**
```js
import * as config from './module/config.mjs';
import { actorModels } from './module/data/actor/_module.mjs';
import { itemModels } from './module/data/item/_module.mjs';
import DCCEffectModel from './module/data/effect/effect-model.mjs';
import DCCActor from './module/documents/actor.mjs';
import DCCItem from './module/documents/item.mjs';
import PcSheet from './module/applications/pc-sheet.mjs';
import MobSheet from './module/applications/mob-sheet.mjs';
import VehicleSheet from './module/applications/vehicle-sheet.mjs';
import DCCItemSheet from './module/applications/item-sheet.mjs';

Hooks.once('init', () => {
  CONFIG.DCC = config;
  CONFIG.Actor.documentClass = DCCActor;
  CONFIG.Item.documentClass = DCCItem;
  Object.assign(CONFIG.Actor.dataModels, actorModels);
  Object.assign(CONFIG.Item.dataModels, itemModels);
  CONFIG.ActiveEffect.dataModels.base = DCCEffectModel;
  CONFIG.Combat.initiative = { formula: '1d20 + @stats.dexterity.mod', decimals: 0 }; // TODO(rules): R20 sheet has no initiative; DEX mod is an assumption
  const { DocumentSheetConfig } = foundry.applications.apps;
  const id = config.SYSTEM_ID;
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, PcSheet, { types: ['pc'], makeDefault: true, label: 'DCC.Sheet.pc' });
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, MobSheet, { types: ['mob'], makeDefault: true, label: 'DCC.Sheet.mob' });
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, VehicleSheet, { types: ['vehicle'], makeDefault: true, label: 'DCC.Sheet.vehicle' });
  DocumentSheetConfig.registerSheet(foundry.documents.Item, id, DCCItemSheet, { makeDefault: true, label: 'DCC.Sheet.item' });
  Handlebars.registerHelper('json', v => JSON.stringify(v, null, 2));
});
```

- [ ] **Step 8: `system.json`**
```json
{
  "id": "dungeon-crawler-carl",
  "title": "Dungeon Crawler Carl",
  "description": "Unofficial Dungeon Crawler Carl system (port of the NexTableTop Roll20 sheet).",
  "version": "0.1.0",
  "compatibility": { "minimum": "14", "verified": "14" },
  "authors": [{ "name": "NexTableTop" }],
  "esmodules": ["index.mjs"],
  "styles": [{ "src": "styles/system.css", "layer": "system" }],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "documentTypes": {
    "Actor": {
      "pc": { "htmlFields": ["notes", "popularity", "pastTrauma", "looseEnds", "regrets"] },
      "mob": { "htmlFields": ["notes"] },
      "vehicle": { "htmlFields": ["notes"] }
    },
    "Item": {
      "weapon": { "htmlFields": ["description"] },
      "skill": { "htmlFields": ["description"] },
      "spell": { "htmlFields": ["description"] },
      "gear": { "htmlFields": ["description"] }
    }
  },
  "grid": { "type": 1, "distance": 5, "units": "ft", "diagonals": 0 },
  "primaryTokenAttribute": "hp",
  "secondaryTokenAttribute": "mana",
  "socket": false
}
```
`lang/en.json` needs at minimum:
- `TYPES.Actor.{pc,mob,vehicle}` → "Crawler", "Mob", "Vehicle"
- `TYPES.Item.{weapon,skill,spell,gear}`
- `DCC.Sheet.*`

- [ ] **Step 9: Write the schema smoke test** (`test/data/schema-smoke.test.mjs`). Import each model, call `defineSchema()`, and assert the keys:
  - `CreatureModel` has `level, floor, stats, hb, hp, armor, move, step, notes`.
  - `stats.fields` has exactly the 5 STATS, each with `base.initial === 1`.
  - `PcModel` adds `mana, manaStat, undoStack`.
  - `VehicleModel` has `kind, size, crew`.
  - Each item model has its listed fields.
  - Run `npm --prefix foundry test`. Expected: PASS.

- [ ] **Step 10: Commit**
```bash
git add foundry
git commit -m "feat(foundry): scaffold dungeon-crawler-carl system with actor/item models and bare sheets"
```

### Task 2: Link into Foundry, create the test world, and verify the loop (CONTROLLER task — not a subagent)
This task drives the live environment, so the controller does it directly and then records the rig facts in memory.

- [ ] **Step 1:** Verify that the junction `F:\FoundryData-Dev\Data\systems\dungeon-crawler-carl` → `...\DungeonCrawlerCarl\foundry` exists. It was already created on 2026-09-23. Create it only if it is missing, using `cmd /c mklink /J …`; no admin rights are needed.
- [ ] **Step 2:** Check that nothing is listening on :30001. Then start the server in the background:
  ```
  node "F:\Program Files\Foundry Virtual Tabletop\resources\app\main.mjs" --dataPath="F:\FoundryData-Dev" --port=30001
  ```
- [ ] **Step 3:** In the built-in browser, open `http://localhost:30001`.
  - If an admin key is requested, **stop and ask the user**.
  - Create world `dcc-testing` (system Dungeon Crawler Carl) through the setup UI and launch it.
  - **User prerequisite:** the agent does not create accounts. Ask the user to create a user named `claude` with role Gamemaster in `dcc-testing`, then continue.
- [ ] **Step 4:** Load `C:\Users\Scott Casey\.claude\foundry\helpers.js` via `javascript_tool`, then run `FVTT.login('claude')` and `FVTT.waitReady()`.
- [ ] **Step 5:** Acceptance check:
  - Create one actor of each type and one item of each type through the sidebar.
  - Open every sheet. Each renders its JSON dump.
  - `read_console_messages` with `onlyErrors` shows no errors from `dungeon-crawler-carl`.
- [ ] **Step 6:** Record the rig in memory: world name, user, server command and junction.

---

## Chunk 2: Pure rules (ported from R20, R20 tests are the oracle)

**Porting method for every task in this chunk:**
1. Open the named R20 source function and the named R20 test file.
2. Copy the function body verbatim into the target `.mjs` as a named `export const`.
3. Replace any `k.foo` reference with an import from a sibling rules module.
4. Convert every R20 test case that calls the function (R20 tests call `k.<fn>(...)`) into a vitest case that imports from the new module. Keep the inputs and expected outputs identical.
5. The only Roll20-specific parts to drop are functions that read `attributes`/`sections`. Those are listed as **excluded**.

Run the test first against an empty module to see it fail, then port and see it pass. Commit per task.

### Task 3: `rules/engine.mjs` and `rules/modifiers.mjs`
**Files:** create `foundry/module/rules/engine.mjs` and `foundry/module/rules/modifiers.mjs`; tests `foundry/test/rules/engine.test.mjs` and `foundry/test/rules/modifiers.test.mjs`.
- **Port to `engine.mjs`:**
  - From `character-sheet/source/javascript/_engine.js`: `statMod` (:66), `isActive` (:101), `parseModifierValue` (:110), `applyMods` (:125), `backCalcBase` (:143), `hbSlotsFor` (:53).
  - Also a new `whisperToGM(type, mobPublic)`, which returns `type === 'mob' && !mobPublic`. It replaces `whisperPrefix`.
  - Oracle: `character-sheet/__tests__/engine.test.js` and `mode.test.js`, for the cases covering these functions.
- **New `modifiers.mjs`.** This replaces R20's `gatherModifiers`/`resolveTargets`, which read Roll20 attribute keys. It works over plain objects:
```js
// mods:  [{ target: 'strength' | 'item:Longsword:tohit' | 'group:skills:stat=dexterity:rank', value: '2' | '10%' }]
// items: [{ id, type: 'weapon'|'skill'|'spell', name, system: { stat, dmgType, class } }]
// returns { bonus: {<field>: n}, pct: {<field>: n}, itemBonus: {<itemId>: {<aspect>: n}}, itemPct: {<itemId>: {<aspect>: n}}, unresolved: [target] }
export const parseTarget = (target) => { /* 'strength' → {kind:'field', field}; 'item:<Name>:<aspect>' → {kind:'item', name, aspect};
  'group:<weapons|skills>[:<attr>(=|!=)<value>]:<aspect>' → {kind:'group', section, attr, op, value, aspect}; else null */ };
export const resolveModifiers = (mods, items) => { /* ... */ };
```
- **Rules for `resolveModifiers`:**
  - **Field targets** must be in `FIELD_TARGETS`; route by `parseModifierValue(value).kind` into `bonus` or `pct`.
  - **Item targets:** match by name, case-insensitive and trimmed. Aspects must be legal for the item's type (`ITEM_ASPECTS`). If several items share the name, apply the modifier to all of them.
  - **Group targets:** `weapons` matches type weapon plus spells with `attack.enabled`, for aspects tohit/damage. `skills` matches skill and spell. The attr compare is a string compare, case-insensitive.
  - **Percent on `damage`** is dropped.
  - **Unknown targets** are pushed to `unresolved`, which the sheet shows as a warning.
- **Tests for modifiers:** write new cases covering each rule above. Port the group-parse cases from `modifiers.test.js`/`engine.test.js` (`parseGroupTarget`) as the oracle for the `group:` grammar. The `weapons` section name replaces R20's `attacks`, so rewrite those strings.
- **Commit:** `feat(foundry): port stat/modifier engine rules`

### Task 4: `rules/health.mjs`
- **Port verbatim** from `character-sheet/source/components/_health.pug:53-112`: `HB_SLOTS, slotMax, clampSlots` (the other functions depend on them), then `hpFromHb, maxHpFromCon, damageToSlots, directDamage, applyHpEdit, healSlots, conModChange, isDying`. The code is inside a pug `+module` block; strip the indentation.
- **Return shapes:** `directDamage` returns `{hb, hp, slotsLost}`. Check `applyHpEdit`'s return shape and document it in the test.
- **Excluded:** `hbChanged`, `hpEdit`, `initHealth`.
- **Oracle:** `character-sheet/__tests__/healthbar.test.js`.
- **Commit:** `feat(foundry): port health bar rules`

### Task 5: `rules/advancement.mjs`
- **Port** from `character-sheet/source/sections/_skills.pug:107-147`: `advancementRoll, rankCapClamp, advancesAt, nextRank, undoPush, undoPop`.
- **Oracle:** `skills.test.js`.
- **Excluded:** `snapshotState`, `readUndo`, `processAdvancement` and the workers.
- **Add a new pure function** `planAdvancement({ skills, trigger, floor, rolls })`:
  - `skills` is `[{id, rank, mark, passive}]`; `rolls` is `{[id]: d20}`.
  - It returns `{ updates: [{id, rank, mark:false}] }`, applying `nextRank` only to marked, non-passive skills where `advancesAt(rank, trigger)` holds.
  - Write tests for it, derived from R20's `processAdvancement` semantics at `_skills.pug:169-181`. The mark is cleared on **every** due row, even when the d20 fails.
- **Commit.**

### Task 6: `rules/combat.mjs` and `rules/inventory.mjs`
- **`combat.mjs`:**
  - Port `attackToHit, damageLabel, mobToHit, mobEvade` from `sections/_combat.pug:187-217`, and `manaAfterCast` from `javascript/_spells.js:16`.
  - Leave `rankDamageDie` **out**; it is an unfinished stub in R20 (TODO).
  - Oracles: `attacks.test.js`, `mob.test.js`, `spells.test.js` (the manaAfterCast cases).
- **`inventory.mjs`:**
  - Port `isItemActive, buildGear, buildAccessories` from `sections/_inventory.pug:79-117`.
  - Adapt the item shape to `{ id, name, system:{ slot, active, accessory } }` and keep the logic identical.
  - Oracle: `inventory.test.js` (the matching cases, with inputs reshaped).
  - Hotlist reconciliation is **not** ported. Foundry lists items with `onHotlist` directly.
- **Commit.**

### Task 7: `rules/vehicle.mjs`
- **Port** from `javascript/_vehicle.js`: `VEHICLE_SIZES` (:16), `advLabel` (:31), `drivingCheckDC` (:39), `ramAftermath` (:51).
- **Also port** from the same file: `vehicleMove` (:21), `cruiseMph` (:22), `d20Expr` (:26), `ramDamage` (:46), `raceBonus` (:60).
- **Excluded:** the `*Fields` builders (Roll20 template strings), `applyRam`, `drAbsorbed`. Chunk 6 re-expresses them as card fields.
- **Oracle:** `vehicle.test.js`.
- **Commit.**

### Task 8: `rules/crew.mjs`
- **Port** `crewSkillBonus` (`javascript/_crewrolls.js:28`), with the `cache` argument reshaped to `{ statMods:{<stat>:n}, skills:[{name, stat, bonus}] }`.
- **Adapt `crewPenalty`** (:86) to a pure signature `crewPenalty({ kind, speed, driveSkill }, skillName)`:
  - 0 when `skillName` is the drive skill (case-insensitive)
  - −3 when `kind==='mount'`
  - otherwise `−speed`
- **Port `speedDieNote`** (`_crewrolls.js:185`).
- **Return shape:** `crewSkillBonus` returns `{bonus, untrained}`, not a number.
- **Oracle:** `crewrolls.test.js`. Reshape the inputs and keep the expectations.
- **Commit.**

---

## Chunk 3: Derived data, ActiveEffects, health editing

### Task 9: `rules/derive.mjs` — the recalcAll port
**Files:** `foundry/module/rules/derive.mjs`, `foundry/test/rules/derive.test.mjs`.

Pure function; this is the whole R20 `recalcAll` (`_engine.js:313-442`) re-expressed over plain data. Read that code before starting.

```js
/**
 * @param {object} i
 * @param {'pc'|'mob'} i.type
 * @param {number} i.level, i.floor, i.hb, i.armor, i.moveBase, i.stepBase
 * @param {Record<string,{base:number}>} i.stats
 * @param {string} [i.manaStat]
 * @param {Array} i.mods       [{target, value}] collected from active effects
 * @param {Array} i.items      [{id, type, name, system}] weapons/skills/spells (spells w/ attack.enabled count as attacks)
 * @returns {{ stats: Record<string,{base,enh,mod}>, hbSlots, hb, hp:{value,max}, manaMax, evade, dr, move, step,
 *             mobTohit, mobEvade, items: Record<id, {tohit?, dmgBase?, dmgLabel?, mobTohit?, skillBonus?, manaCostEff?, effRank?}>,
 *             unresolved: string[] }}
 */
export const deriveCreature = (i) => { ... };
```
**Order, mirroring recalcAll:**
1. `resolveModifiers(mods, items)`.
2. Per stat: `enh = applyMods(base, bonus[s], pct[s])` and `mod = statMod(enh)`.
3. Health: `hbSlots = hbSlotsFor(type, level)`; clamp `hb` to [0, hbSlots]; `hp.max = hbSlots*conMod`; `hp.value = hb*conMod`.
4. Defenses and mana:
   - `manaMax = applyMods(stats[manaStat].enh, bonus.mana, pct.mana)` (pc only)
   - `evade = applyMods(10+dexMod, …)`
   - `dr = applyMods(armor, …)`
   - `move = applyMods(moveBase, …)` and `step = applyMods(stepBase, …)`
5. Skills and spells: `effRank = applyMods(rank, ib.rank, ip.rank)`; `skillBonus = statMod(stat) + effRank`; spells also get `manaCostEff = applyMods(manaCost, ib.manaCost, ip.manaCost)`.
6. Weapons:
   - `rank` is the **base** `system.rank` of the skill named by `system.skill`, if one is set and found; otherwise the weapon's own `system.rank`. R20 syncs the base rank, so rank modifiers on the skill do not carry over.
   - `tohit = applyMods(statMod(stat)+rank, ib.tohit, ip.tohit)`
   - `dmgBase = dmgBonus + (ib.damage||0)`
   - `dmgLabel = damageLabel(die, dmgBase, dmgType)`
   - `mobTohit = mobToHit(tohit, floor)`. `mobToHit(statMod, floor)` is `10 + statMod + floor`, so passing `tohit` reproduces R20 `_engine.js:393` exactly.
   - Spells with `attack.enabled` use the same attack formula over the spell's own stat and base rank: `tohit = applyMods(statMod(stat)+rank, ib.tohit, ip.tohit)` and `dmgBase = attack.dmgBonus + (ib.damage||0)`.
7. Mob strip: `mobTohit = 10+strMod+floor` and `mobEvade = 10+dexMod+floor`.
8. Also return `moveBonus` and `stepBonus` (the flat `bonus.move`/`bonus.step`). The sheet uses them with `backCalcBase` when the user edits the displayed move or step.

**`deriveVehicle(i)`:**
- Inputs: `{ kind, size, speed, conMod, armor, hb, mods, items }`.
- `conMod` is 5 when null or ''.
- Outputs:
  - `hbSlots: hbSlotsFor('vehicle',0,size)`, `hb` (clamped), `hp`, `conMod` (resolved)
  - `dr: applyMods(armor, bonus.dr, pct.dr)`
  - `move: vehicleMove(speed)` — when `kind==='mount'`, also `step: 10`
  - `cruise: cruiseMph(speed)`, `penalty: -speed`
  - `items`: per weapon, stat mod 0 as in R20 vehicle mode (`_engine.js:379-393`): `{ tohit: applyMods(rank, ib.tohit, ip.tohit), dmgBase, dmgLabel }`
  - `unresolved`

**Tests.** Write these first:
- Fresh PC: all bases 1 → every `mod` 1, `hp.max` 10, `hp.value` 10 when hb=10, `evade` 11, `dr` 0, `step` 5, `manaMax` 1.
- CON base 50 → con mod 6 → `hp.max` 60.
- A mod `{target:'strength', value:'2'}` with base 1 → enh 3 → mod 2.
- `{target:'strength', value:'100%'}` with base 10 → enh 20 → mod 5.
- A mob at level 3 → hbSlots 3, and hb 10 is clamped to 3.
- A weapon with stat dexterity, rank 2 and dex base 10 (mod 4) → tohit 6. Adding `item:Dagger:tohit` '1' → 7. `group:weapons:stat=dexterity:damage` '10%' → damage unchanged, because percent on damage is dropped.
- A weapon with `skill:'Knives'` and a skill 'Knives' of rank 3 → uses 3. Adding a `group:skills:rank` '1' mod leaves the weapon at 3, because only the base rank carries over.
- A spell with `attack.enabled` gets a `group:weapons:tohit` '1' mod → its tohit includes the +1.
- A fresh creature returns `moveBonus` 0 and `stepBonus` 0.
- A skill with `group:skills:rank` '1' → effRank +1.
- A spell with manaCost 10 and `item:Fireball:manaCost` '-50%' → 5.
- Vehicle: size 4, conMod null → hp.max 20; speed 2 → move 100, cruise 20, penalty −2. A vehicle weapon with rank 2 → tohit 2. A mount → step 10.

**Commit:** `feat(foundry): pure derive engine (recalcAll port)`

### Task 10: Wire derive into the actor models
**Files:** modify `data/actor/creature.mjs`, `pc.mjs`, `mob.mjs`, `vehicle.mjs`; test `test/data/actor-derive.test.mjs`.
- **`CreatureModel.prepareBaseData()`:** set `this._mods = []`. This is the collector the `dcc` change handler (Task 11) fills during the `initial` phase, which runs between base and derived.
- **`CreatureModel.prepareDerivedData()`:**
  - Build the input from `this` and from `this.parent.items`: weapons, skills, and spells mapped to `{id, type, name, system}`.
  - Call `deriveCreature` and assign the results onto `this`: `stats[s].enh/mod`, `hbSlots`, `hb` (display clamp only), `hp.value/max`, `evade`, `dr`, `move`, `step`, `mobTohit`, `mobEvade`, `mana.max` (pc), and `unresolvedMods`.
  - For each item result, assign it to `item.system.derived = {...}`, so templates read `item.system.derived.tohit`.
  - Move and step: the stored `moveBase`/`stepBase` are the user's base. The displayed `move`/`step` are derived, and so are `moveBonus`/`stepBonus`.
  - Add `rollShortcuts()` on the model, returning `str, int, con, dex, cha` (mods), `level` and `floor`.
  - Core `Actor#getRollData()` returns only `this.system`. So add `DCCActor#getRollData()` returning `{ ...this.system, ...this.system.rollShortcuts?.() }`. It merges rather than replaces, so `@stats.dexterity.mod` in the initiative formula still resolves.
- **`VehicleModel`:**
  - `prepareBaseData()` must set `this._mods = []`. Without it, the `dcc` handler finds no collector and vehicle DR effects are silently dropped.
  - `prepareDerivedData()` calls `deriveVehicle` with the vehicle's weapon items and assigns `item.system.derived` the same way.
- **Templates** must guard `item.system.derived`, which is undefined on unowned items. Item sheets show derived values only when `item.actor` exists.
- **Test:** construct `PcModel` with the mock (`new PcModel({...source})`), set `parent = { items: [] }`, call `prepareBaseData()` then `prepareDerivedData()`, and assert the fresh-PC numbers from Task 9.
- **Commit.**

### Task 11: ActiveEffects as DCC modifiers
**Files:** create `module/effects/dcc-change.mjs`; modify `data/effect/effect-model.mjs` and `index.mjs`; test `test/data/effects.test.mjs`.
- **`dcc-change.mjs`:**
```js
export const DCC_CHANGE_TYPE = 'dcc';
/** CONFIG.ActiveEffect.changeTypes.dcc handler: collect instead of applying. */
export function dccChangeHandler(targetDoc, change) {
  const collector = targetDoc?.system?._mods;
  if (!Array.isArray(collector)) return;          // non-DCC actor or not in a prepare cycle
  if (change.phase && change.phase !== 'initial') {  // final-phase changes land after derive and would be ignored
    console.warn(`DCC | 'dcc' modifier "${change.key}" must use the initial phase; ignored`);
    return;
  }
  collector.push({ target: String(change.key ?? '').trim(), value: String(change.value ?? '') });
}
export const registerDccChangeType = () => {
  CONFIG.ActiveEffect.changeTypes[DCC_CHANGE_TYPE] = { label: 'DCC.Effect.ChangeType', defaultPriority: 20, handler: dccChangeHandler };
};
```
  Call `registerDccChangeType()` in the `init` hook.
- **`DCCEffectModel.isSuppressed` getter.** Its parent is the ActiveEffect, and `this.parent.parent` is the owning document.
  - Use optional chaining: `const item = this.parent?.parent;`.
  - If the owner is an Item:
    - gear and weapon: return `true` when `!isItemActive(item)` (from `rules/inventory.mjs`).
    - skill and spell: return `true` when `!system.enabled`.
  - **Return `undefined` for "not suppressed"**, never `false`. Core evaluates `system.isSuppressed ?? duration.expired`, so returning `false` would disable duration expiry.
  - Actor-level effects: return `undefined`.
  - Item effects must be `transfer: true` to reach the actor. That is the default (`common/documents/active-effect.mjs:71`).
- **Item sheet effects list** (this task builds it):
  - Add an "Effects" part to `DCCItemSheet`: a list of the item's effects with edit (`effect.sheet.render(true)`) and delete.
  - Add a "+ Modifier" action: `item.createEmbeddedDocuments('ActiveEffect', [{ name: 'Modifier', img: item.img, transfer: true, system: { changes: [{ key: 'strength', type: 'dcc', value: '1', phase: 'initial' }] } }])`, then open its sheet.
  - Check how v14 `ActiveEffectConfig` exposes the change type select. Custom types registered in `CONFIG.ActiveEffect.changeTypes` should appear automatically.
- **Actor drop rules:** override `_onDropItem` in each actor sheet.
  - Vehicles accept only weapons.
  - Mobs accept weapons, skills, spells and gear.
  - For a rejected drop, show `ui.notifications.warn`.
- **Buffs** are actor-level ActiveEffects, toggled with `disabled`. There is no buff item type.
- **Tests:**
  - The handler pushes into `system._mods`, ignores docs without a collector, and ignores `phase:'final'`.
  - `isSuppressed` for gear and weapons: pack+inactive → `true`; slot head → `undefined`; pack+active → `undefined`.
  - `isSuppressed` for skills: enabled false → `true`; enabled true → `undefined`.
  - Set `model.parent = { parent: itemLike }` by hand.
- **Live acceptance (controller):**
  - Create a PC. Add a gear item "Helm" with an effect whose change type is "DCC Modifier", key `strength`, value `2`.
  - Slot pack → STR enh unchanged. Slot head → STR enh 3, mod 2.
  - Add an actor effect with key `evade` and value `10%`, then toggle it. Evade goes from 11 to 12 and back.
- **Commit.**

### Task 12: Health editing — the token bar, slot clicks and heal
**Files:** modify `documents/actor.mjs` and `data/actor/creature.mjs` (and vehicle); test `test/data/health-edit.test.mjs`.
- **`CreatureModel` and `VehicleModel` `async _preUpdate(changes, options, user)`:** if `foundry.utils.hasProperty(changes, 'system.hp.value')`, then:
  - Work out `conMod`: `this.stats.constitution.mod` for creatures, the derived `this.conMod` for vehicles.
  - Call `applyHpEdit(this.hb, entered, conMod, this.hbSlots)`, using the return shape documented in Task 4.
  - Set `changes.system.hb` to the result's hb and **delete** `changes.system.hp`. `hp` is purely derived, and the token bar edit becomes a slot change.
  - Return `super._preUpdate(...)`. This runs before the diff, so the rewritten changes are what get saved. It also covers unlinked token actors.
- **`DCCActor` methods:**
  - `applyDamage(dmg)` → `this.update({'system.hb': directDamage(hb, dmg, dr, conMod, hbSlots).hb})`
  - `healSlots(n=1)`
  - `setSlots(n)`, used by health bar clicks
- **Tests** (pure, via the model and a mock):
  - An edit from 10 hp to 7 with con mod 1 → hb 7.
  - With con mod 3, hb 10 (hp 30), an entered 25 → **hb 9, hp 27**. The delta is −5 and `floor(5/3)` is 1 slot; the partial remainder is discarded.
  - Also copy the oracle case from `__tests__/healthbar.test.js:60`: `applyHpEdit(10, 31, 4)` → hb 8, hp 32.
- **Live acceptance:** put a PC token on a scene. Set the bar to `-3`, a delta via the token HUD. `system.hb` drops by 3 and the value stays a multiple of the con mod.
- **Commit.**

---

## Chunk 4: Chat cards and the PC sheet

### Task 13: Roll card
**Files:** `module/rolls/card.mjs`, `templates/chat/card.hbs`, CSS; test `test/rolls/card.test.mjs`.
- **`cardContext(fields, results)`** is pure. It takes `fields` as `{ name, tag, type, target, dc, penalty, note, cost, insufficient, advantage }`, and `results` as `{ roll?: {total, d20}, damage?: {total} }`.
  - It returns template context with flags `crit` (d20===20), `fumble` (d20===1) and `damageOnly`, mirroring the R20 roll template (Appendix A §6).
- **`postCard(actor, fields, { roll, damage })`** takes formulas.
  - It builds `new Roll(formula, actor.getRollData())` and awaits `evaluate()`.
  - It reads the natural d20 from the first `Die` term with faces 20 (for `2d20kh1`, the kept result).
  - It renders the template with `foundry.applications.handlebars.renderTemplate` and calls `ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), rolls, content, whisper })`.
  - Message mode:
    - If `whisperToGM(actor.type, actor.system.mobPublic)`, force the GM-only mode.
    - Otherwise use the player's chosen chat mode (`game.settings.get('core','messageMode')` or the v14 equivalent).
    - Apply the mode with the v14 API. Check `client/config.mjs:242` (`CONFIG.ChatMessage.modes`) and `ChatMessage.applyMode` in the client source. Do not use the deprecated `rollMode`.
  - Also set `sound: CONFIG.sounds.dice`.
- **Card layout:**
  - Header: token image, action name, character name, tag. The tint depends on crit, fumble or damage-only.
  - Body sections in order: roll total pill (Crit!/Fumble! chip), target, damage pill with type, advantage chip, "DC N", penalty, note, "Mana Cost N", "⚠ Insufficient mana".
- **Tests:** cover the `cardContext` flag logic.
- **Commit.**

### Task 14: PC sheet — header, abilities, health, defenses
**Files:** `applications/pc-sheet.mjs`, `applications/actor-sheet-base.mjs`, `templates/actor/pc/header.hbs`, `templates/actor/partials/{health-bar,defenses}.hbs`, CSS.
- **Tabs:** combat, inventory, skills, bio, settings. Use `static TABS = { primary: { tabs:[…], initial:'combat', labelPrefix:'DCC.Tab' } }` and `PARTS` header / tabs (`templates/generic/tab-navigation.hbs`) / one part per tab. Follow `mythcraft/module/applications/sheets/character-sheet.mjs`.
- **Header:**
  - Portrait, name, race, pronouns, class, crawler #, level, floor, AI Favor.
  - The advancement button row is a placeholder for Task 17.
  - Ability cards: base input (`system.stats.<s>.base`), enhanced value and mod (read-only), and a roll button (`data-action="rollAbility" data-stat`).
  - Mana: value input / max.
  - Health bar partial:
    - 10 slot buttons (`data-action="setSlots" data-slot=i`), one per slot. A slot at or below `hb` is filled.
    - Each slot shows the con mod and `i×10%`, rainbow-coloured, matching R20 `_health.pug`.
    - Slots with index above `hbSlots` are blacked out and disabled.
    - Also show HP text `hp.value/hp.max`, a "Heal slot" button, and a dying badge when `isDying(hb)`.
- **Clicking a slot** (a rule defined here; R20 has no equivalent): clicking slot i (1-based) sets hb=i, and clicking the slot equal to the current hb sets hb=i−1, which is how a slot is cleared.
- **Defenses partial:**
  - Evade with a roll button (`1d20 + dex mod + int mod`).
  - Move input: on change, write `moveBase = backCalcBase(entered, system.moveBonus)`. Handle this in `_processSubmitData` or with a `change` listener.
  - Step input, same rule.
  - Size text, armor input, DR read-only.
  - A buff summary line.
- **Actions:**
  - `rollAbility` → `postCard(actor, {name: STAT label, tag:'Ability'}, {roll:'1d20 + <mod>'})`
  - `rollEvade`
  - `setSlots`
  - `healSlot`
- **Live acceptance:**
  - A fresh PC shows all mods 1, HP 10/10 and evade 11.
  - Clicking slot 7 → HP 7/10.
  - An ability roll posts a card with a total and a crit/fumble chip when applicable.
  - The console is clean.
- **Commit.**

### Task 15: PC combat and skills tabs — item lists and rolls
**Files:** `templates/actor/pc/{combat,skills}.hbs`, `templates/actor/partials/item-row.hbs`, sheet actions.
- **Combat tab:**
  - Weapons table: name, stat abbr, rank, To-Hit (roll button), Damage label (roll button).
  - Spells with `attack.enabled` are also listed here.
  - A "Buffs" list of actor-level effects, each with a toggle (`effect.update({disabled})`), plus edit, delete and "+ Buff". A new buff is an ActiveEffect with one `dcc` change.
  - Show a warning line listing `system.unresolvedMods` if non-empty.
- **Skills tab:**
  - Skills table: mark checkbox, name, stat, rank input (edits the item inline via `data-action` or `change` → `item.update`), bonus (roll), check type, passive, enabled toggle.
  - Spells table: the same plus mana cost (effective), with a Cast button.
- **Item CRUD** in the base sheet:
  - `createItem` (`data-type`), `editItem`, `deleteItem` (`item.deleteDialog()`).
  - Drag and drop works through the ActorSheet defaults.
- **Rolls** — put these on `DCCActor` so the hotlist and vehicle crew reuse them:
  - `rollSkill(item)` → card `{name, tag: checkType}` with roll `1d20 + skillBonus`.
  - `rollWeapon(item, 'tohit'|'damage')`:
    - To-hit: `1d20 + tohit`, tag "To Hit".
    - Damage: `die + dmgBase` with type, tag "Damage". If `die` is blank, use `dmgBase` alone.
  - `castSpell(item)`:
    - `insufficient = costEff > mana.value`.
    - The card has a roll `1d20 + skillBonus`, `cost`, and `insufficient`.
    - If affordable, update `mana.value = manaAfterCast(...)`. If `autoEnableCast` and the spell is not enabled, set `enabled:true`.
    - A spell attack's to-hit button calls `castSpell`, as in R20.
- **Live acceptance:**
  - Add skill "Knives" (dex, rank 3) → bonus 4 with base-1 stats.
  - Add weapon "Dagger" (dex, skill Knives, 1d4) → to-hit 4, damage label "1d4 piercing".
  - A spell with cost 3 and mana 0 → the card shows ⚠ and mana is unchanged.
  - Raise INT base to 10 (mana max 10). With mana 5 → mana 2 and the spell is enabled.
- **Commit.**

### Task 16: PC inventory tab — paper doll, accessories, hotlist
**Files:** `templates/actor/pc/inventory.hbs`, sheet context.
- **Context:**
  - `gearSlots = buildGear(gear items)` (the first item per slot).
  - `accessories = buildAccessories(...)` (cap 10).
  - `inventory` is all gear and weapons, with qty, slot select, active, accessory and hotlist toggles.
  - `hotlist` is every item with `system.onHotlist`, limited to the first 10 by `sort`.
- **The hotlist strip** sits at the bottom of the header, visible on all tabs. Clicking an entry:
  - spell → `castSpell`
  - weapon → `rollWeapon(tohit)`
  - skill → `rollSkill`
  - gear → post the item description to chat
- **Live acceptance:**
  - Put Helm in slot head → it shows in the Head box and its effect applies (Task 11).
  - Toggle accessory on an active ring → it appears in Accessories.
  - Hotlist a spell → it appears in the strip and a click casts it.
- **Commit.**

### Task 17: Advancement — End Session, End Floor, Level Up, Undo
**Files:** `documents/actor.mjs` (methods), header buttons.
- **`endSession()` / `endFloor()`:**
  - Snapshot `{ skills:[{id,rank,mark}], pendingLevels, floor }` with `undoPush` (max 20).
  - Roll one `new Roll('1d20')` per eligible skill, evaluated silently.
  - Call `planAdvancement` and apply the result with `updateEmbeddedDocuments('Item', …)`.
  - Session: `pendingLevels += 1`. Floor: `floor += 1`.
  - Post a summary card listing each rank change.
- **`levelUp()`:** if `pendingLevels > 0 && floor >= 3`, then `level += 1`, `statPoints += 3` and `pendingLevels -= 1`. Otherwise show `ui.notifications.warn`. Check R20 `levelUp` at `_skills.pug:194` for whether `pendingLevels` is decremented, and mirror it.
- **`undoAdvancement()`:** pop the stack and restore the snapshot.
- **Tests:** the pure part is already covered by `planAdvancement`. Add a test for building and restoring snapshots (pure helpers in `advancement.mjs`: `snapshot(actorLike)` and `restoreUpdates(snapshot)`).
- **Live acceptance:** a marked skill at rank 0 → End Session → its rank is 1 or 0 depending on the d20, and the card shows the result. Undo restores it.
- **Commit.**

### Task 18: PC bio and settings tabs, styling pass
- **Bio tab:** ProseMirror editors (`<prose-mirror>` via `{{formInput}}` / `{{editor}}` for v14 — follow mythcraft's biography tab) for popularity, past trauma, loose ends, regrets and notes.
- **Settings tab:** mana stat select and auto-enable-cast checkbox.
- **Styling:**
  - Port the R20 look from `character-sheet/source/scss/` so it's recognisably the same sheet, using CSS custom properties.
  - Include dark-theme support via `.theme-dark` (Foundry v14 applies `theme-dark` / `theme-light` to sheets).
  - Everything is scoped under `.dcc`.
- **Live acceptance:** screenshot each tab in light and dark themes. There is no overflow at the default size.
- **Commit.**

---

## Chunk 5: Mob actor

### Task 19: Mob sheet
**Files:** `applications/mob-sheet.mjs`, `templates/actor/mob/body.hbs`.
- **Layout:** a single-page stat block with no tabs.
  - Header row: name, level, floor, descriptors, surprise and the `mobPublic` toggle.
  - Mob strip: the 5 stat mods, To-Hit (`mobTohit`), Evade (`mobEvade`), DR, Surprise.
  - Stat base inputs, with the mod shown next to each. There are no Unenhanced/Enhanced columns.
  - Health bar partial, sized to `hbSlots` = level.
  - Weapons: name, static target `derived.mobTohit` (no to-hit roll button), damage roll button.
  - Skills: name, stat, rank, bonus roll.
  - Buffs list, armor, notes.
- **Rolls:** whispered to the GM unless `mobPublic` (already handled in `postCard`).
- **Live acceptance:**
  - A level 3 mob shows 3 slots.
  - A mob damage roll is a GM whisper. Toggling `mobPublic` makes it public.
  - `mobTohit` = 10 + str mod + floor.
- **Commit.**

---

## Chunk 6: Vehicle actor (its own rolls)

### Task 20: Vehicle sheet and rolls
**Files:** `applications/vehicle-sheet.mjs`, `templates/actor/vehicle/body.hbs`, `documents/actor.mjs` (vehicle roll methods). Pure card builders go in `rules/vehicle.mjs` with tests.
- **Pure builders** (tested), which return card `fields` plus formulas. Re-express R20's `drivingCheckFields`/`ramFields`/`raceFields` (`_vehicle.js:86-130`) as `{fields, roll, damage}` objects with no `[[ ]]`:
  - `drivingCheck({mode, target, speed, floor, driveSkill, driverBonus, adv})`
  - `ram({size, speed, targetEvade, kind, driveSkill, driverBonus})`
  - `race({speed, ahead, adv, driveSkill, driverBonus})`

  Port the R20 test expectations for DCs, formulas and notes.
- **Driver bonus:** in this chunk it is `0`, and the card gets the note "No driver assigned". Chunk 7 supplies the real bonus through `vehicle.system.driverBonus()` (roll-time).
- **Sheet:**
  - Vehicle/mount kind toggle; size select (VEHICLE_SIZES names); speed / speedMax; con mod; passengers; drive skill; armor → DR.
  - Derived move, cruise and penalty (a mount also shows Step 10 ft).
  - Health bar with `hbSlots` = size.
  - Driving panel: mode select, target N, adv select, and a Drive button.
  - Ram panel: target evade, target larger checkbox, and a Ram button. After the damage is entered in `ramDamageDealt`, an Apply Aftermath button calls `ramAftermath` and updates hb through `directDamage` with DR 0, plus the speed.
  - Race panel.
  - A "DR absorbed" button: `hb -= 1`.
  - Weapon list: vehicle weapons with gunner slot and skill name; mount attacks when `kind==='mount'`. Until Chunk 7, rolls use to-hit `1d20 + derived.tohit`, the weapon's rank plus modifiers, with stat mod 0.
  - A crew section placeholder.
- **Live acceptance:**
  - Size 4 → 4 slots, HP 20.
  - Speed 3 → Move 150, penalty −3.
  - Driving in stop mode → DC 13.
  - Ram against a larger target with damage 8 entered, con mod 5 → Apply Aftermath takes the vehicle down 1 slot and sets speed 0.
- **Commit.**

---

## Chunk 7: Crew (final phase)

### Task 21: Crew linking
**Files:** `data/actor/vehicle.mjs`, `applications/vehicle-sheet.mjs`, `index.mjs` (hook).
- **Linking:** drop a PC or Mob actor onto the vehicle sheet's crew section. The drop adds `{uuid, role:'passenger'}` to `system.crew`, with no duplicates by UUID. Use `_onDropActor`.
- **Crew rows:**
  - Each row shows the name, a role select, HB and DR.
  - Each row has quick-roll selects for the crew's skills and weapons.
  - Remove button.
  - `fromUuidSync(uuid)` resolves the actor. A missing actor shows as "(missing)" and stays removable.
- **Role rules:**
  - At most one driver. Assigning a new driver demotes the old one to passenger.
  - Gunner roles are exclusive per slot.
- **PC and Mob sheets** get a read-only "Crewing" line listing vehicles whose `system.crew` includes this actor's UUID. Compute it by scanning `game.actors` for vehicles in `_prepareContext`.
- **Hook:** `Hooks.on('updateActor', a => …)` re-renders any open vehicle sheet whose crew includes `a.uuid`. Also handle `updateItem`/`createItem`/`deleteItem` on an actor that crews a vehicle.
- **Live acceptance:**
  - Drag a PC onto a vehicle → it appears as a passenger. Set it to driver.
  - Changing the PC's DEX base updates the vehicle's crew row while the vehicle sheet is open.
- **Commit.**

### Task 22: Crew rolls from the vehicle card
- **`vehicle.system.crewCache(actor)`:** build `{ statMods, skills:[{name, stat, bonus: derived.skillBonus}], attacks:[{name, tohit, die, dmgBase, dmgType}] }` from a live crew actor at roll time.
- **Driver bonus:** `crewSkillBonus(cache(driver), driveSkill, 'dexterity').bonus`. It returns `{bonus, untrained}`; show "untrained" on the card when set. Check R20's fallback stat for the drive skill in `_crewrolls.js`/`_vehicle.js`, and mirror it. This replaces the Chunk 6 `0`.
- **Crew skill roll:** `1d20 + bonus - |crewPenalty|`, with the card name "<crew> — <skill>", note "aboard <vehicle>", and the untrained flag when there is no match.
- **Crew attack roll:** to-hit `1d20` (or `2d20kl1` when the crew member is the driver) `+ tohit - |pen|`. Damage `die + dmgBase` plus the `speedDieNote` text.
- **Vehicle weapon:** gunner slot → the crew member with that role (`driver` → driver) → `1d20 + crewSkillBonus(cache, skillName, stat) + weapon tohit`. With no gunner, the note is "No gunner".
- **Mob crew never rolls a d20.** Post `target = 10 + bonus + penalty + floor` as a static card. This matches R20 `rollOrTarget` (`_vehicle.js:74`); read it and mirror the rule for driving checks too, including the +5 mob adv extra.
- **Tests:** these are pure field builders (`rules/crew.mjs`: `crewSkillCard`, `crewAttackCard`, `vehicleWeaponCard`), ported from the `crewSkillRollFields`/`crewAttackRollFields`/`vehicleWeaponFields` oracles in `crewrolls.test.js`, reshaped to `{fields, roll, damage}`.
- **Live acceptance:**
  - A PC driver with a 'Driving' skill of rank 2 and dex base 1 → the Drive card shows bonus 3.
  - A gunner-1 PC with 'Guns' fires a vehicle weapon → the card uses the PC's Guns bonus.
  - A mob driver → a static target card.
- **Commit.**

---

## Chunk 8: GM screen

**Source of truth:** `docs/superpowers/specs/2026-09-23-gm-screen-design.md`. This chunk covers only its **Foundry design** section and the Foundry test list. Read the spec's "Definitions", "Shared behaviour" and "Foundry design" sections before starting any task.

**What it builds:** a new actor type `gmscreen` that a world setting selects. Through it, the GM controls two party-wide gates on rostered (linked) Crawlers:
1. Floor ends. The GM bumps the counter `floorEndSeq`. Each linked PC holds its own cursor `floorEndDone` and may run End Floor once per unconsumed floor end, so floor ends stack.
2. Safehouse. While the GM's `safehouse` toggle is off, a linked PC can't Level Up.

An unlinked PC behaves exactly as it does today.

**Settled decisions** (from the spec and the user; don't revisit them):
- **Owners may End Session and End Floor.** This matches R20 and is already how `#advancementGuard` behaves.
- **The GM is gated like a player** on a linked Crawler. No GM bypass exists. To lift the gates, the GM unrosters the Crawler.
- **Floor ends stack:** `available = max(0, floorEndSeq − floorEndDone)`.
- **Modifiers stay ActiveEffects** with the custom `dcc` change type. The GM screen adds no modifiers, and the safehouse affects nothing except Level Up.

**Independence from Chunk 7:** nothing here uses crew code (Tasks 21–22), so this chunk can run before or after Chunk 7. The `updateActor` hooks here are separate `Hooks.on` registrations and coexist with Task 21's.

**Merge points with Task 21**, which landed in commit `5e1aaa1`. **Read the current code before editing; don't assume this plan's snapshot of it:**
- `PcSheet#_prepareContext` has **no conflict**. Task 21's Crewing context lives in `DCCCreatureSheet#_prepareContext` (`creature-sheet.mjs`, `crewing: this.#crewing()`), so Task 31's `advancement` gate is the only PcSheet change.
- `templates/actor/pc/header.hbs`: Task 21 put the `crewing.hbs` partial right after the `.dcc-hdr-actions` div. Task 31 edits that region (the End Floor button and the safehouse badge inside `.dcc-hdr-actions`), so keep the partial where it is.
- The `index.mjs` `init` hook calls `registerCrewHooks()` at the end of init. Add Task 27's `registerGmScreenSetting()` / `registerGmScreenHooks()` next to it.
- `lang/en.json`: both add keys. Merge by key and keep the file valid JSON.
- `test/setup/foundry-mock.mjs` is **untouched by Task 21**. Task 27's add-if-absent (`??=`) rule still stands.

### Chunk 8 decisions (verified against the v14 client)

- **Settings `onChange` fires on create *and* update, on every client**, with the signature `(value, options, userId)`. See `client/documents/setting.mjs:39-52` (`_onCreate` / `_onUpdate`).
  - Re-baselining must therefore guard on `game.user.isActiveGM` (`client/documents/user.mjs:86`, which is `this === game.users.activeGM`, `client/documents/collections/users.mjs:70`).
  - An update fires only when the value actually changes.
- **`choices` on a `StringField` forces `blank:false`** unless `blank` is passed explicitly (`common/data/fields.mjs:1630-1634`). A function `choices` is called each time it is validated (`:1723-1726`) and each time the settings form renders. The choices function must also tolerate a missing `game.actors`, so it uses `game.actors?.filter(...) ?? []`.
- **Writing a setting validates strictly; reading does not.**
  - Writes go through `#cleanJSON`, which calls `type.validate(value, {fallback:false, strict:true})` (`client/helpers/client-settings.mjs:~343`).
  - Reads go through `Setting#_castType`, which only does `clean` + `initialize` (`client/documents/setting.mjs:~62-72`).
  - So a stored id for a deleted actor is safe to read. `resolveGmLink` fails open on it, and the `deleteActor` hook clears it anyway.
- **`{{localize key n=…}}` formats** whenever hash args are present (`client/applications/handlebars.mjs:260-264`). A key with no `{n}` placeholder is unaffected, so one tooltip expression serves both the plain and the counted End Floor tooltips.
- **`foundry.applications.instances`** is a `Map` of the currently rendered ApplicationV2 instances (`client/applications/_module.mjs:28`). The re-render hooks iterate it and don't need to import the sheet classes.
- **`TypeDataModel#_preCreate(data, options, user)`** exists, and returning `false` from it cancels the create (`common/abstract/type-data.mjs:189`). `GmScreenModel` uses it to set default Observer ownership.
- **`ActorSheetV2#_onDropActor(event, actor)` is a no-op stub** (`client/applications/sheets/actor-sheet.mjs:326`).
  - Drops are already gated upstream. The sheet's `_dragDrop` passes `permissions.drop: this._canDragDrop` (`actor-sheet.mjs:84-86`), which returns `this.isEditable` (`:211`), and `DragDrop` refuses the drop when that permission fails (`client/applications/ux/drag-drop.mjs`). So an Observer's drop never reaches `_onDrop` / `_onDropActor`.
  - `_onDrop` itself (`:255-266`) does no ownership check. The handler still starts with `if (!game.user.isGM || !this.isEditable) return null;` **as a backstop**, placed before any write, and the model's `addToRoster` repeats the `isGM` check. A player who owns a PC must never be able to write that PC's baseline through the screen, whether via a subclass, a macro or a future change to the drop permissions.
- **`Actor.implementation.updateDocuments([...])` sends one request.**
  - `common/abstract/document.mjs:648` builds one database operation, and `client/data/client-backend.mjs:186-192` sends one `update` request for it.
  - **Choice:** roster add writes the PC baseline **and** the screen's roster in a single `updateDocuments` call. This is how the spec's "together with the roster update" is realised.
  - The setting-change re-baseline writes the PC rows only, also in one call, because the roster doesn't change.
  - **One request, not atomic.** `#preUpdateDocumentArray` (`client/data/client-backend.mjs:204-250`) skips any row whose `_preUpdate` or `preUpdateActor` hook returns false, that fails validation (`updateSource` dryRun throws), or that produces an empty diff. The remaining rows still go out.
  - The baseline row comes first, but that only protects one direction:
    - If the **screen** row is skipped, the PC is merely re-baselined, which is harmless.
    - If the **PC** row is skipped while the screen row lands, the PC is linked with a stale cursor and may see phantom floor ends.
  - For plain integer fields with no system `preUpdateActor` hooks, a skipped PC row is unlikely. An empty diff can't happen either, because the epoch always increments. The plan accepts this residual risk and records it rather than adding a verify-and-retry step.
- **A synthetic actor's base actor is `actor.token?.baseActor`, not `actor.baseActor`.** `Actor` has only `isToken` and `token` (`client/documents/actor.mjs:148`, `:187`); `baseActor` is a getter on the TokenDocument (`client/documents/token.mjs:265`).
  - The spec's `actor.baseActor?.uuid` would return null for every token actor, so this chunk **corrects** it.
  - Test fixtures must mirror core: `{ isToken: true, token: { baseActor: { id, uuid } } }`.
- **`foundry.utils.fromUuidSync(uuid)`** (`client/utils/helpers.mjs:188`) resolves roster UUIDs synchronously. Roster UUIDs are always world-actor UUIDs (`Actor.<id>`), because the field uses `DocumentUUIDField({type:'Actor', embedded:false})`.
- **`DialogV2.confirm`** (`client/applications/api/dialog.mjs:316`) is used for the GM End Floor, following the PC End Floor's existing pattern in `pc-sheet.mjs`.

### Known limitations (cross-client races)

Every write is an absolute value, so a repeated click, or two clients acting on the same intent, writes the same value and converges. Races **across** documents are last-write-wins and are **not** guarded. They are accepted, not fixed:
- **GM Undo End Floor vs a PC's End Floor.** `undoEndFloor` checks blockers against the cached cursors. A PC's End Floor on another client can land between that check and the −1 write, and that floor end is then swallowed. Mitigation: after the write, the cursors are re-read and the GM is warned (`DCC.GmScreen.UndoRaced`), naming any Crawler now ahead of the counter.
- **Re-baseline vs a PC's End Floor.** A setting-change re-baseline sets cursor = seq and bumps the epoch. If a PC's End Floor lands just before it, the consumed floor end is overwritten. If it lands just after, the PC's cursor passes seq. Either way the PC can see phantom (or lost) floor ends, and the PC's Undo can't restore the cursor, because the snapshot's epoch no longer matches.
- **Two GMs.** One GM's End Floor and another's Undo End Floor race on `floorEndSeq`, and the last write wins. Two concurrent roster adds each write a whole roster array built from their own cached roster, so one add replaces the other. Both PCs are still baselined, but only one is rostered.

### Chunk 8 ambiguity resolutions (recorded; implement as written)

- **Where the cursor lives for an unlinked-token sheet.** The link resolves by the **base** actor's UUID (spec). The cursor `floorEndDone` / `floorEndEpoch`, however, is read from and written to **the actor End Floor runs on**, i.e. the synthetic token actor's delta when the sheet was opened from an unlinked token.
  - Why: that is the same document whose `floor` and `undoStack` the existing End Floor writes, and the cursor must stay consistent with that actor's own undo stack.
  - Baselines (roster add, re-baseline) write the **base** actor only, and a synthetic actor inherits them unless its delta already overrides the fields.
  - **Known limitation:** a PC played through an *unlinked* token can drift from its roster row. Crawlers should use linked tokens (`prototypeToken.actorLink`), which the test world's "Test Crawler" already does.
  - Record this in Task 23's README TODOs.
- **"The warning names those players"** (Undo End Floor blocked) is read as **Crawler actor names**, the same names the roster rows show. Owning users are not listed.
- **GM End Floor with an empty roster is allowed.** The confirm dialog says the roster is empty. Incrementing is harmless, because every Crawler added later is baselined to the current counter.
- **Undo End Floor (−1) is disabled at `floorEndSeq === 0`**, because it would be a no-op. `undoEndFloor()` also returns null there.
- **A baselined PC blocks −1.** After a mid-campaign roster add, cursor = seq. The spec's rule "cursor ≥ seq blocks" therefore blocks −1 for it too. That is correct: after a −1, that PC's next real floor end would be absorbed.
- **Re-dropping an already rostered PC does nothing.** No baseline is written, because a re-baseline would silently wipe its stacked floor ends. The drop shows an info notification. The dedupe is decided **before** any write; `_preUpdate` deduping is only a backstop.
- **Controls:**
  - `safehouse` is a plain `system.safehouse` form checkbox, using the normal `submitOnChange`.
  - `floorEndSeq` is **display-only**, not an input, so nobody can bypass the −1 guard by typing a number.
- **Missing roster rows** (actor deleted) show "(missing)" and stay removable. A missing actor never blocks −1, since it has no cursor.
- **The epoch comparison in `restoreUpdates` is strict.** The cursor is restored only when `snap.floorEndDone`, `snap.floorEndEpoch` and `currentEpoch` are **all integers** and `snap.floorEndEpoch === currentEpoch`. Do **not** use the codebase's `+x || 0` idiom here: it would turn a missing epoch into 0 and match a 0-epoch snapshot.

### Task 24: Pure GM screen rules — `rules/gm-screen.mjs`

**Files:** create `foundry/module/rules/gm-screen.mjs`; test `foundry/test/rules/gm-screen.test.mjs`.

Pure module: no Foundry globals. Write the tests first, run them against an empty module to see them fail, then implement.

```js
export const GM_SCREEN_TYPE = 'gmscreen';

/** Floor ends a linked Crawler may still run (floor ends stack). */
export const floorEndsAvailable = (seq, done) => Math.max(0, (+seq || 0) - (+done || 0));

/** The base (world) actor of a Crawler, and the UUID it is rostered by, even for a sheet opened from an unlinked token.
 *  v14: the base actor hangs off the TokenDocument (actor.token.baseActor); Actor has no baseActor. */
export const baseActor = actor => (actor?.isToken ? actor.token?.baseActor : actor) ?? null;
export const baseActorUuid = actor => baseActor(actor)?.uuid ?? null;

/**
 * { screen, linked }. `actorsById` is anything with get(id) (game.actors, a Map).
 * Fails open: blank id, missing actor or a non-gmscreen actor -> { screen: null, linked: false }.
 */
export const resolveGmLink = ({ settingId, actorsById, baseUuid } = {}) => { /* ... */ };

/**
 * The Crawler-side gate from a resolved link and the PC's SOURCE system data:
 * linked   -> { linked: true, safehouse: !!screen.system.safehouse, available: floorEndsAvailable(seq, pc.floorEndDone) }
 * unlinked -> { linked: false, safehouse: false, available: null }
 */
export const gmGate = ({ screen, linked } = {}, pcSource = {}) => { /* ... */ };
export const UNLINKED = Object.freeze({ linked: false, safehouse: false, available: null });

/** Baseline a PC to the screen's counter: cursor = seq, epoch + 1 (dotted update keys). */
export const baselineUpdate = (pcSource = {}, seq = 0) => ({
  'system.floorEndDone': +seq || 0,
  'system.floorEndEpoch': (+pcSource.floorEndEpoch || 0) + 1,
});

/** Non-blank strings, first occurrence kept, order preserved. */
export const uniqueUuids = list => [...new Set((list ?? []).filter(u => (typeof u === 'string') && u))];

/** The roster after adding `uuid`, or null when it is already rostered (caller writes NOTHING). */
export const rosterAdd = (roster = [], uuid) => { /* ... */ };
export const rosterRemove = (roster = [], uuid) => roster.filter(u => u !== uuid);

/**
 * Names of rostered Crawlers that already consumed the latest floor end (cursor >= seq),
 * which block Undo End Floor. `pcs`: [{ name, floorEndDone }]; null entries (missing actors) are skipped.
 * seq <= 0 -> [] (nothing to undo; the caller refuses separately).
 */
export const undoFloorEndBlockers = (seq, pcs = []) => { /* ... */ };
```

- **Tests:**
  - `floorEndsAvailable`: (0,0)→0, (3,1)→2, (1,3)→0 (never negative), blanks → 0.
  - `baseActor` / `baseActorUuid`:
    - A world actor gives itself and its own `uuid`.
    - `{isToken:true, token:{baseActor:{id:'a', uuid:'Actor.a'}}, uuid:'Scene.s.Token.t.Actor.a'}` gives that base actor and `'Actor.a'`.
    - A token with no base actor gives null.
    - null gives null.
  - `resolveGmLink`:
    - A blank `settingId` gives `{screen:null, linked:false}`.
    - An id not in the map gives unlinked (fail open).
    - A `mob` actor under the id gives unlinked.
    - A gmscreen whose roster lacks the UUID gives `{screen, linked:false}`.
    - A roster containing the UUID gives `linked:true`.
    - A null `baseUuid` gives `linked:false`.
  - `gmGate`:
    - Unlinked gives `UNLINKED` for any PC.
    - Linked with seq 3, done 1 and safehouse on gives `{linked:true, safehouse:true, available:2}`.
    - A missing `floorEndDone` reads as 0.
  - `baselineUpdate`: seq 4 with epoch 2 gives `{…floorEndDone:4, …floorEndEpoch:3}`; a blank epoch gives 1.
  - `uniqueUuids` drops duplicates, blanks and non-strings, and keeps order.
  - `rosterAdd`: a new UUID is appended; an existing UUID gives **null**; the input array is not mutated.
  - `rosterRemove`: removes every copy, and an absent UUID gives an equal array.
  - `undoFloorEndBlockers`:
    - seq 2 with `[{name:'Carl', floorEndDone:2}, {name:'Donut', floorEndDone:1}, null]` gives `['Carl']`.
    - A cursor above seq also blocks.
    - seq 0 gives `[]`.
- Run `npm --prefix foundry test -- gm-screen`. Expected: PASS.
- **Commit:**
```bash
git add foundry/module/rules/gm-screen.mjs foundry/test/rules/gm-screen.test.mjs
git commit -m "feat(foundry): pure GM screen rules (link, floor-end cursor, roster)"
```

### Task 25: Advancement rules and header view learn the GM gates

**Files:**
- Modify: `foundry/module/rules/advancement.mjs` (`levelUpBlocker`, `snapshot`, `restoreUpdates`)
- Modify: `foundry/module/applications/sheet-rows.mjs` (`advancementView`)
- Test (extend): `foundry/test/rules/advancement.test.mjs`
- Test (extend): `foundry/test/applications/sheet-rows.test.mjs`
- Test (update): `foundry/test/data/actor-advancement.test.mjs`
- **These existing assertions break and must be updated:**
  - `actor-advancement.test.mjs:118-120` compares the pushed `undoStack` with `toEqual`, so add `floorEndDone: 0, floorEndEpoch: 0` to the expected snapshot. The other snapshot literals in that file are *inputs* to Undo, which stay valid as old-format snapshots.
  - `advancement.test.mjs:264-278` compares snapshot shapes with `toEqual`, so add `floorEndDone`/`floorEndEpoch`.
  - `sheet-rows.test.mjs:215` compares the whole `advancementView` object with `toEqual`, so add the new keys.

Changes:
- **`levelUpBlocker({ pendingLevels, floor, linked, safehouse })`:** a third check after `'Saferoom'`, `if (linked && !safehouse) return 'Safehouse';`. The order is NoPending → Saferoom → Safehouse → null (spec). Old callers that pass neither flag are unaffected.
- **`snapshot(actorLike)`** also captures `floorEndDone: +system.floorEndDone || 0` and `floorEndEpoch: +system.floorEndEpoch || 0`. That is capture only; the epoch is never restored.
- **`restoreUpdates(snap, presentIds, currentEpoch)`:**
  - A new third argument. Add `actor['system.floorEndDone'] = snap.floorEndDone` only when all of these hold:
    - `Number.isInteger(snap?.floorEndDone)`
    - `Number.isInteger(snap?.floorEndEpoch)`
    - `Number.isInteger(currentEpoch)`
    - `snap.floorEndEpoch === currentEpoch`
  - **It never writes `system.floorEndEpoch`.** Restoring the epoch would make old snapshots current again (spec).
  - Older snapshots without the fields skip the restore.
  - Update the JSDoc.
- **`advancementView(source, editable, gate = UNLINKED)`**, where `gate` is `gmGate`'s shape from Task 24 (import `UNLINKED`):
  - `levelUpBlocker({ ...source, linked: gate.linked, safehouse: gate.safehouse })`
  - New keys:
    - `canEndFloor: !!editable && (!gate.linked || gate.available > 0)`
    - `endFloorTooltip`:
      - unlinked: `'DCC.Advance.EndFloorTooltip'`
      - linked with available 0: `'DCC.Advance.FloorWaiting'`
      - otherwise: `'DCC.Advance.FloorAvailable'`
    - `floorEndsAvailable: gate.linked ? gate.available : null`, the `{n}` for the tooltip
    - `safehouseBadge: !!(gate.linked && gate.safehouse)`
  - `canAct` still gates End Session only. End Session is never GM-gated.
- **Tests:**
  - `levelUpBlocker`, all combinations:
    - pending 0 gives NoPending, whatever the flags.
    - floor 2 gives Saferoom even when linked without a safehouse.
    - floor 3, linked, no safehouse gives Safehouse.
    - floor 3, linked, safehouse gives null.
    - floor 3, unlinked, no safehouse gives null.
  - `snapshot` includes both cursor fields, and blanks give 0.
  - `restoreUpdates`:
    - A snapshot at epoch 2 with `currentEpoch` 2 restores `floorEndDone`.
    - `currentEpoch` 3 (a re-link since) doesn't restore it.
    - `currentEpoch` undefined doesn't restore it, including a snapshot at epoch **0** (the strict-compare guard).
    - An old snapshot without the fields doesn't restore it.
    - `'system.floorEndEpoch'` is never among the keys.
  - `advancementView`:
    - No `gate` gives `canEndFloor:true` with the plain tooltip.
    - Linked with available 0 gives `canEndFloor:false` and FloorWaiting.
    - Linked with available 2 gives `canEndFloor:true`, FloorAvailable and `floorEndsAvailable:2`.
    - Linked at floor 3 with a pending level and no safehouse gives `canLevelUp:false` with the tooltip `DCC.Advance.Blocked.Safehouse`.
    - The badge shows only when linked and safehouse are both set.
    - Not editable gives `canEndFloor:false`.
- Run `npm --prefix foundry test`. Expected: all PASS.
- **Commit:**
```bash
git add foundry/module/rules/advancement.mjs foundry/module/applications/sheet-rows.mjs foundry/test/rules/advancement.test.mjs foundry/test/applications/sheet-rows.test.mjs foundry/test/data/actor-advancement.test.mjs
git commit -m "feat(foundry): safehouse level-up gate, floor-end cursor in undo snapshots"
```

### Task 26: Data — the `gmscreen` actor type and the PC cursor fields

**Files:**
- Create: `foundry/module/data/actor/gmscreen.mjs`
- Modify: `foundry/module/data/actor/pc.mjs`, `foundry/module/data/actor/_module.mjs`
- Modify: `foundry/system.json`, `foundry/lang/en.json`
- Test: `foundry/test/data/gmscreen-model.test.mjs`; extend `foundry/test/data/schema-smoke.test.mjs`
- Modify: `foundry/test/setup/foundry-mock.mjs`. Add `async _preCreate() {}` to `MockTypeDataModel`, next to the existing `_preUpdate`, or `super._preCreate` throws.
- **This existing assertion breaks and must be updated:** `schema-smoke.test.mjs:61` checks `actorModels` with `toEqual({ pc, mob, vehicle })`, so add `gmscreen: GmScreenModel`.

- **`GmScreenModel extends foundry.abstract.TypeDataModel`.** It is standalone, like `VehicleModel`, and does not extend `CreatureModel`, so there is no derive, health or `_mods`.
  - `defineSchema()`:
    - `safehouse: bool(false)`
    - `floorEndSeq: int(0, { min: 0 })`
    - `roster: new fields.ArrayField(new fields.DocumentUUIDField({ type: 'Actor', embedded: false }), { required: true, initial: [] })`
  - `async _preCreate(data, options, user)`:
    - `if ((await super._preCreate(data, options, user)) === false) return false;`
    - then `this.parent.updateSource({ 'ownership.default': CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER, 'system.roster': uniqueUuids(this._source?.roster ?? data.system?.roster) })`. This also dedupes a roster arriving with the create, e.g. from a duplicated or imported screen.
    - Players' clients can read the screen, but only the GM can write it. Players will see it in the actor directory, which is acceptable because it holds no secrets.
  - `async _preUpdate(changes, options, user)`: if `Array.isArray(changes.system?.roster)`, replace it with `uniqueUuids(...)` (Task 24), then `return super._preUpdate(...)`. This is a backstop only; the add path dedupes before writing (Task 29).
- **`PcModel` additions:** `floorEndDone: int(0, { min: 0 })` and `floorEndEpoch: int(0, { min: 0 })`. Existing PCs pick up the initial 0 on load, so no migration is needed.
- **`actorModels`** gains `gmscreen: GmScreenModel`, exported like the others.
- **`system.json`:** add `"gmscreen": {}` under `documentTypes.Actor`.
- **`lang/en.json`:**
  - `TYPES.Actor.gmscreen`: "GM Screen"
  - `DCC.Sheet.gmscreen`: "DCC GM Screen"
  - The rest of the Chunk 8 keys are added in the task that first uses them.
- **Tests:**
  - Schema smoke: `GmScreenModel` has exactly `safehouse, floorEndSeq, roster`, and `roster.element` is a `DocumentUUIDField`. `PcModel` has `floorEndDone` and `floorEndEpoch`.
  - `_preCreate`:
    - Set `model.parent = { updateSource: vi.fn() }` and stub `globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } }` (delete it after).
    - Assert `updateSource` was called with `{ 'ownership.default': 2, 'system.roster': [] }` for an empty source.
    - The mock has no `CONST`; see Task 1, Step 3.
  - `_preCreate` also passes the deduped roster (`['Actor.a','Actor.a']` becomes `['Actor.a']`, and a missing roster becomes `[]`) in the same `updateSource` call.
  - `_preUpdate` dedupes `changes.system.roster` and leaves changes without a roster untouched.
- **Commit:**
```bash
git add foundry/module/data/actor/gmscreen.mjs foundry/module/data/actor/pc.mjs foundry/module/data/actor/_module.mjs foundry/system.json foundry/lang/en.json foundry/test/data/gmscreen-model.test.mjs foundry/test/data/schema-smoke.test.mjs foundry/test/setup/foundry-mock.mjs
git commit -m "feat(foundry): gmscreen actor type and PC floor-end cursor fields"
```

### Task 27: Foundry glue — the setting, link resolution and live-update hooks

**Files:**
- Create: `foundry/module/gm-link.mjs`
- Modify: `foundry/index.mjs`, `foundry/lang/en.json`
- Modify: `foundry/test/setup/foundry-mock.mjs`
- Test: `foundry/test/data/gm-link.test.mjs`

This module (`module/gm-link.mjs`, named to match its test and to avoid confusion with the pure `module/rules/gm-screen.mjs`) is the only Foundry-facing GM screen code outside the sheet. It reads `game.*` at **call** time only, so importing it has no side effects. It imports from `config.mjs` and `rules/gm-screen.mjs` only, and **no** sheets or documents, so `documents/actor.mjs` and `data/actor/gmscreen.mjs` can import it without a cycle.

```js
export const GM_SCREEN_SETTING = 'gmScreen';

/** The configured screen id ('' when none). */
export const gmScreenId = () => game.settings.get(SYSTEM_ID, GM_SCREEN_SETTING) ?? '';

/** The configured gmscreen actor, or null (fail open). */
export const configuredScreen = () => resolveGmLink({ settingId: gmScreenId(), actorsById: game.actors }).screen;

/**
 * The Crawler gate for `actor` ({linked, safehouse, available}); UNLINKED for non-pc actors.
 * `source` defaults to actor.system._source. The link resolves by BASE uuid; the cursor is the
 * acting actor's own (see "Chunk 8 ambiguity resolutions").
 */
export const gmLinkFor = (actor, source = actor?.system?._source ?? actor?.system) => { /* resolveGmLink + gmGate */ };

/**
 * Rostered actors in roster order: [{ uuid, actor|null }] via foundry.utils.fromUuidSync.
 * Accepts a roster UUID array (what GmScreenModel passes: this._source.roster) or a gmscreen actor (the sheet).
 */
export const rosterEntries = (screenOrRoster) => {
  const roster = Array.isArray(screenOrRoster) ? screenOrRoster : (screenOrRoster?.system?.roster ?? []);
  return roster.map(uuid => ({ uuid, actor: foundry.utils.fromUuidSync(uuid) ?? null }));
};

/** Re-render every open ApplicationV2 whose document is an Actor matching `pred` (render(), never force). */
export const rerenderActorSheets = (pred) => { /* iterate foundry.applications.instances.values(), keep
  app.rendered && app instanceof foundry.applications.sheets.ActorSheetV2 && app.document && pred(app.document)
  (the same filter as module/crew-hooks.mjs), then app.render() */ };
export const rerenderPcSheets = () => rerenderActorSheets(a => a.type === 'pc');

export const onGmScreenSettingChange = (value) => { /* see below */ };
export const onUpdateActor = (actor) => { /* see below */ };
export const onDeleteActor = (actor) => { /* see below */ };
export const onCreateActor = (actor) => { /* see below */ };

export const registerGmScreenSetting = () => { /* game.settings.register, see below */ };
export const registerGmScreenHooks = () => {
  Hooks.on('updateActor', onUpdateActor);
  Hooks.on('deleteActor', onDeleteActor);
  Hooks.on('createActor', onCreateActor);
};
```

- **`registerGmScreenSetting()`**, called in `init`:
```js
game.settings.register(SYSTEM_ID, GM_SCREEN_SETTING, {
  name: 'DCC.Setting.GmScreen.Name', hint: 'DCC.Setting.GmScreen.Hint',
  scope: 'world', config: true, requiresReload: false,
  type: new foundry.data.fields.StringField({
    blank: true, // choices would otherwise force blank:false (fields.mjs:1630)
    choices: () => ({ '': '—', ...Object.fromEntries((game.actors?.filter(a => a.type === GM_SCREEN_TYPE) ?? []).map(a => [a.id, a.name])) }),
  }),
  default: '',
  onChange: onGmScreenSettingChange,
});
```
- **`async onGmScreenSettingChange(value)`** runs on every client:
  - Foundry calls `onChange` without awaiting it, so wrap the body in try/catch with `ui.notifications.error(err, {console:true})`.
  - Always call `rerenderPcSheets()` **and** `rerenderActorSheets(a => a.type === 'gmscreen')`. The GM screen sheet's `isConfigured` hint depends on the setting.
  - On the active GM's client only (`game.user.isActiveGM`), also re-baseline the new screen's roster:
    - Resolve the screen for `value`. When the value is `''` or doesn't resolve, do nothing more.
    - Otherwise `await screen.system.rebaselineRoster?.()`. The method arrives in Task 29, so the optional call keeps this task shippable on its own. **Task 29 replaces it with a direct call.**
    - This covers re-pointing to another screen, and clearing then restoring the setting.
- **`onUpdateActor(actor)`:**
  - If `actor.id === gmScreenId()`, call `rerenderPcSheets()`.
  - If `actor.type === 'pc'`, re-render open gmscreen sheets whose roster includes the base UUID: `const uuid = baseActorUuid(actor); rerenderActorSheets(a => a.type === 'gmscreen' && a.system.roster.includes(uuid))`. Matching by base UUID means a token actor's update refreshes the screen too.
- **`onDeleteActor(actor)`:**
  - For a `gmscreen`: if `game.user.isActiveGM && actor.id === gmScreenId()`, call `game.settings.set(SYSTEM_ID, GM_SCREEN_SETTING, '')`. Its `onChange` re-renders the PC sheets, and the select never holds a dangling id. Always call `rerenderPcSheets()` too, for non-GM clients.
  - For a `pc`: re-render open gmscreen sheets whose roster includes its UUID, so the row turns "(missing)".
- **`onCreateActor(actor)`:** for a `gmscreen`, call `rerenderPcSheets()`.
- **`index.mjs`:** call `registerGmScreenSetting()` and `registerGmScreenHooks()` in `init`.
- **`lang/en.json`:**
  - `DCC.Setting.GmScreen.Name`: "GM Screen"
  - `DCC.Setting.GmScreen.Hint`: "The GM Screen actor that gates floor ends and Level Up for the Crawlers on its roster. Leave blank to turn the integration off."
- **`test/setup/foundry-mock.mjs`**: add defaults so every existing test stays **unlinked**.
  - Make each one **add-if-absent** (`??=`), because Task 21 (crew, resolved by UUID, scanning `game.actors`) may already have added the same keys:
    - `game.settings ??= { get: () => '', set: async () => {} }`
    - `game.actors ??= new Map()`
    - `game.user ??= { isGM: true, isActiveGM: true }`
    - `foundry.utils.fromUuidSync ??= () => null`
    - `foundry.applications ??= {}` and `foundry.applications.instances ??= new Map()`
  - If one of these already exists with a different shape (e.g. `game.settings.get` without `set`), extend it; don't replace it.
  - Without these, `test/data/actor-advancement.test.mjs` breaks as soon as Task 28 makes End Floor and Level Up read the setting.
- **Tests** (`gm-link.test.mjs`; stub `game.settings.get`, `game.actors` and `foundry.applications.instances` per test, and restore them after):
  - `gmLinkFor`:
    - A mob gives `UNLINKED`.
    - A pc with the setting `''` gives `UNLINKED`.
    - A pc on the roster gives `linked:true` with the right `available`.
    - A **token** actor (`isToken:true, token:{baseActor:{uuid:'Actor.a'}}`) resolves by its base UUID, but `available` uses the token actor's own `floorEndDone`.
  - `rosterEntries` accepts both a UUID array and a screen-like `{ system: { roster } }`, and maps an unresolved UUID to `actor: null`.
  - `rerenderActorSheets` calls `render()` only on apps that are `rendered`, are `ActorSheetV2` instances and match the predicate. Stub `foundry.applications.sheets.ActorSheetV2` as a class and build fake apps from it, restoring it after.
  - `onUpdateActor`:
    - An update of the configured screen re-renders the pc sheets only.
    - An update of a rostered pc re-renders that screen's open sheet.
    - An update of an unrostered pc re-renders nothing.
  - `onDeleteActor` on the configured screen:
    - As the active GM, it calls `game.settings.set(…,'')`.
    - As a non-GM, it doesn't.
  - `onGmScreenSettingChange`:
    - As a non-active-GM, it re-renders only, covering both the pc sheets and the open gmscreen sheets.
    - As the active GM with a resolving screen, it calls `screen.system.rebaselineRoster` once.
    - `''` never re-baselines.
- **Commit:**
```bash
git add foundry/module/gm-link.mjs foundry/index.mjs foundry/lang/en.json foundry/test/setup/foundry-mock.mjs foundry/test/data/gm-link.test.mjs
git commit -m "feat(foundry): GM screen world setting, link resolution and live-update hooks"
```

### Task 28: Crawler actor gates — End Floor consumes, Level Up checks the safehouse, Undo restores the cursor

**Files:**
- Modify: `foundry/module/documents/actor.mjs`, `foundry/lang/en.json`
- Test (extend): `foundry/test/data/actor-advancement.test.mjs`. Add a `describe('GM screen gates')` block that reuses the file's `makeActor` / `FixedRoll` / `setPath` helpers. Give `makeActor`'s actor `uuid: 'Actor.carl'` and `isToken: false`. Also add `floorEndDone: 0, floorEndEpoch: 0` to its default `system`, the schema's initial values. Otherwise `src.floorEndEpoch` is undefined and the strict epoch guard skips every restore by design.

Import `gmLinkFor` from `../gm-link.mjs` and `floorEndBlocked` from `../rules/gm-screen.mjs`. All changes are inside the existing `#advancementGuard` (owner-only, PC-only, re-entry guarded), so **owners, GM included, stay gated alike**.
- **`advancementGate(source) { return gmLinkFor(this, source); }`** (public): the ONE gate source. `endFloor` / `levelUp` call it, and Task 31's sheet passes the same call to `advancementView`, so the buttons and the refusals can never disagree. The `source` default lives in `gmLinkFor` only.
- **`floorEndBlocked(gate)`** (pure, `rules/gm-screen.mjs`): `!!gate?.linked && !(gate.available > 0)`. The one End Floor rule, used by `endFloor` and by `advancementView` (in place of its inline `floorOpen` test).
- **`endFloor()`:**
```js
return this.#advancementGuard(async (src) => {
  const gate = this.advancementGate(src);
  if (floorEndBlocked(gate)) {
    ui.notifications.warn(game.i18n.localize('DCC.Advance.FloorWaiting'));
    return null;
  }
  return this.#advance('floor', src, { consumeFloorEnd: gate.linked });
});
```
- **`#advance(trigger, src, { consumeFloorEnd = false } = {})`:**
  - When `consumeFloorEnd` is set, add `'system.floorEndDone': (+src.floorEndDone || 0) + 1` to the **existing single** actor update, the one that pushes the undo entry and bumps the counter.
  - The snapshot is built from `src` **before** that update, so it holds the pre-increment cursor and the current epoch (Task 25).
  - An unlinked End Floor never touches `floorEndDone`, and `endSession()` never passes the flag.
- **`levelUp()`:**
  - `const gate = this.advancementGate(src);`
  - `levelUpBlocker({ ...src, linked: gate.linked, safehouse: gate.safehouse })`
  - The existing warn uses `DCC.Advance.Blocked.${blocker}`, so the new key is enough.
- **`undoAdvancement()`:** `restoreUpdates(snap, presentIds, src.floorEndEpoch)`. Pass the raw source value, never `+x || 0`; see the strict-compare note.
- **`lang/en.json`:**
  - `DCC.Advance.Blocked.Safehouse`: "The GM hasn't declared a safehouse."
  - `DCC.Advance.FloorWaiting`: "Waiting for the GM to end the floor."
  - `DCC.Advance.FloorAvailable`: "Floor end available ({n})"
- **Tests.** Link a PC by setting `game.settings.get = () => 'scr'` and `game.actors = new Map([['scr', { id:'scr', type:'gmscreen', system:{ safehouse, floorEndSeq, roster:['Actor.carl'] } }]])`:
  - Linked with seq 0 and done 0: `endFloor()` returns null, warns FloorWaiting, and makes no update and no roll.
  - Linked with seq 2 and done 0:
    - The first `endFloor()` writes `floorEndDone` 1 in the same `update` call as `undoStack` and `floor`.
    - The second writes 2.
    - The third is refused.
  - Linked End Floor followed by `undoAdvancement()` restores `floorEndDone` to 0 at the same epoch, so End Floor becomes available again.
  - End Floor at epoch 1, then set `system.floorEndEpoch = 2` (a re-link), then Undo: `floorEndDone` is **not** restored, and `floorEndEpoch` stays 2.
  - `endSession()` while linked never writes `floorEndDone`.
  - An unlinked End Floor (default mock) never writes `floorEndDone`, which also proves existing behaviour is intact.
  - Linked, floor 3, pending 1, `safehouse:false`: `levelUp()` is refused with `DCC.Advance.Blocked.Safehouse`. With `safehouse:true` it succeeds.
  - A mob actor never reaches the gate, because `#advancementGuard` refuses it as today.
- Run `npm --prefix foundry test`. Expected: all PASS, including the untouched pre-existing advancement tests.
- **Commit:**
```bash
git add foundry/module/documents/actor.mjs foundry/lang/en.json foundry/test/data/actor-advancement.test.mjs
git commit -m "feat(foundry): GM-screen floor-end and safehouse gates on Crawler advancement"
```

### Task 29: GM screen operations — roster, End Floor, Undo End Floor, re-baseline

**Files:**
- Modify: `foundry/module/data/actor/gmscreen.mjs`, `foundry/module/gm-link.mjs`, `foundry/lang/en.json`
- Test (extend): `foundry/test/data/gmscreen-model.test.mjs`, `foundry/test/data/gm-link.test.mjs`

These are methods on `GmScreenModel`, called as `screen.system.<method>()`. This follows the plan's "rules on the model/document, sheet stays thin" pattern. Every method starts `if (!game.user.isGM) return null;`, because baseline writes touch PCs, which a player may own. All methods read `this._source`.

- **`async addToRoster(pc)`:**
  1. Refuse, with `ui.notifications.warn(localize('DCC.GmScreen.DropRejected'))`, and return null when `pc?.type !== 'pc'` or `pc.pack` is set (compendium).
  2. `const base = baseActor(pc);` and `const uuid = base?.uuid;`, both from Task 24. Refuse when `!base || !uuid`.
  3. `const next = rosterAdd(this._source.roster, uuid);`. When it is `null`, show `ui.notifications.info(format('DCC.GmScreen.AlreadyRostered', {name}))` and return null **without any write**, so stacked floor ends survive a re-drop.
  4. Write it as **one** request: `foundry.documents.Actor.implementation.updateDocuments([{ _id: base.id, ...baselineUpdate(base.system._source, this._source.floorEndSeq) }, { _id: this.parent.id, 'system.roster': next }])`.
- **`async removeFromRoster(uuid)`:** `this.parent.update({ 'system.roster': rosterRemove(this._source.roster, uuid) })`. It makes no PC write. A later re-add re-baselines.
- **`async endFloor()`:** `this.parent.update({ 'system.floorEndSeq': this._source.floorEndSeq + 1 })`. The confirm dialog is the sheet's job (Task 30), so the method stays testable.
- **`async undoEndFloor()`:**
  - If `seq <= 0`, return null.
  - Otherwise work out `blockers = undoFloorEndBlockers(seq, rosterEntries(this._source.roster).map(e => e.actor && { name: e.actor.name, floorEndDone: e.actor.system._source.floorEndDone }))`.
  - When non-empty, warn `format('DCC.GmScreen.UndoBlocked', { names: game.i18n.getListFormatter().format(blockers) })` and return null.
  - Otherwise `update({ 'system.floorEndSeq': seq - 1 })`.
- **`async rebaselineRoster()`:**
  - One `updateDocuments` call with a `baselineUpdate` row for every **present** rostered actor, from `rosterEntries(this._source.roster)`.
  - Skip missing actors. An empty list means no call.
  - Task 27's setting `onChange` calls this.
- **Roster entry filter (review follow-up):** `rebaselineRoster` and `undoEndFloor` use only entries whose resolved actor passes `e.actor?.documentName === 'Actor' && e.actor.type === 'pc' && !e.actor.pack`. A hand-edited roster UUID that resolves to a mob, an item or a compendium actor is skipped: it is never baselined and never blocks −1.
- **Undo race warning (review follow-up):** after `undoEndFloor`'s `update` resolves, it re-reads the filtered roster PCs' `_source.floorEndDone`. Any cursor now above the new seq means a PC's End Floor landed in between; warn `format('DCC.GmScreen.UndoRaced', { names })`. See "Known limitations (cross-client races)".
- **In `module/gm-link.mjs`, change Task 27's `screen.system.rebaselineRoster?.()` to a direct `screen.system.rebaselineRoster()` call.** With the optional call, a rename would silently disable the phantom-floor-end protection. The existing gm-link test asserting one call now also guards the name.
- `rosterEntries` comes from Task 27, and `baseActor` from Task 24. `gmscreen.mjs` importing `../../gm-link.mjs` creates no cycle (see Task 27).
- **`lang/en.json`:**
  - `DCC.GmScreen.DropRejected`: "Only Crawler (PC) world actors can join the GM Screen roster."
  - `DCC.GmScreen.AlreadyRostered`: "{name} is already on the roster."
  - `DCC.GmScreen.UndoBlocked`: "Can't undo the floor end: {names} already used it (or joined since). Undoing would swallow their next floor end."
- **Tests:**
  - Stub `foundry.documents.Actor.implementation = { updateDocuments: vi.fn(async u => u) }`, and restore it after.
  - Set `model.parent = { id:'scr', update: vi.fn() }` and **`model._source`** explicitly (`{ safehouse, floorEndSeq, roster }`), because the mock constructor only assigns the data passed in. Every method reads `this._source` and passes `this._source.roster` to `rosterEntries`, so the parent stub needs no `system`.
  - Set `game.user.isGM` per test, and `foundry.utils.fromUuidSync` to a map lookup.
  - Stub `globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } }`.
  - `vi.spyOn(game.i18n, 'format')` to assert `names`, since the mock `format` ignores its data.
  - **Mid-campaign add gives available 0:**
    - seq 3, PC `{floorEndDone:0, floorEndEpoch:1}`.
    - `addToRoster(pc)` makes one `updateDocuments` call containing `{_id:pc.id, 'system.floorEndDone':3, 'system.floorEndEpoch':2}` **and** `{_id:'scr', 'system.roster':['Actor.pc']}`.
    - `floorEndsAvailable(3, 3)` is 0.
  - A re-drop of a rostered PC makes **no** call and shows info.
  - A token actor adds its **base** UUID and baselines the base actor's id.
  - A mob and a compendium pc are refused with a warning and make no call.
  - A non-GM makes no call at all, including for their own PC.
  - **GM End Floor and −1 only touch the counter:**
    - `endFloor()` calls `parent.update` with exactly `{ 'system.floorEndSeq': seq + 1 }`, and `updateDocuments` is not called.
    - The same holds for `undoEndFloor()` with `seq − 1`.
  - `undoEndFloor()`:
    - At seq 0 it makes no call.
    - With a rostered PC at cursor 2 and seq 2, it is blocked, warns, and the warning's `names` includes the PC name.
    - With cursor 1 and seq 2, it succeeds.
    - A missing (null) roster entry doesn't block.
  - `rebaselineRoster()` makes one call covering the present actors only; an all-missing roster makes no call.
- **Commit:**
```bash
git add foundry/module/data/actor/gmscreen.mjs foundry/module/gm-link.mjs foundry/lang/en.json foundry/test/data/gmscreen-model.test.mjs foundry/test/data/gm-link.test.mjs
git commit -m "feat(foundry): GM screen roster, floor-end counter and re-baseline operations"
```

### Task 30: GM screen sheet

**Files:**
- Create: `foundry/module/applications/gmscreen-sheet.mjs`, `foundry/templates/actor/gmscreen/body.hbs`
- Modify: `foundry/module/applications/sheet-rows.mjs` (`gmRosterRows`), `foundry/index.mjs` (register the sheet), `foundry/styles/system.css`, `foundry/lang/en.json`
- Test (extend): `foundry/test/applications/sheet-rows.test.mjs`

- **Pure row builder in `sheet-rows.mjs`:**
  - `gmRosterRows(entries, floorEndSeq)` takes `entries` in `rosterEntries`' shape, `[{uuid, actor|null}]`.
  - It returns `[{ uuid, missing, name, img, floor, pendingLevels, available }]`.
  - The values are read from `actor.system._source ?? actor.system`, with `available = floorEndsAvailable(floorEndSeq, floorEndDone)`.
  - A null actor gives `{ uuid, missing: true }`. The template shows `DCC.GmScreen.Missing` for it.
  - **Tests:**
    - A present PC gives its name, floor, pending and available.
    - A missing actor gives `missing:true` and keeps the UUID, for Remove.
    - Roster order is preserved.
- **`GmScreenSheet extends DCCActorSheetBase`:**
  - `static ALLOWED_ITEM_TYPES = []`. The base `_onDropItem` then rejects every item with its existing warning.
  - It doesn't use the health-bar or defenses partials; `DCCActorSheetBase` doesn't render them itself.
  - `DEFAULT_OPTIONS = { classes: ['gmscreen'], position: { width: 560, height: 620 }, actions: { gmEndFloor, gmUndoFloor, gmRemove } }`
  - `PARTS = { body: { template: 'systems/dungeon-crawler-carl/templates/actor/gmscreen/body.hbs', scrollable: [''] } }`, with no tabs.
  - **`_prepareContext`** adds:
    - `roster: gmRosterRows(rosterEntries(this.document), seq)`
    - `floorEndSeq: seq`
    - `canUndoFloor: context.editable && seq > 0`
    - `undoFloorTooltip`: `DCC.GmScreen.UndoFloorTooltip` when `seq > 0`, else `DCC.GmScreen.UndoFloorNone`
    - `isConfigured: this.document.id === gmScreenId()`. When false, the sheet shows the hint `DCC.GmScreen.NotConfigured`, so the GM knows to pick it in the setting.
  - **`async _onDropActor(event, actor)`:** first line `if (!game.user.isGM || !this.isEditable) return null;` (see the decisions block), then `return this.document.system.addToRoster(actor)`.
  - **Actions:**
    - `gmEndFloor`:
      - Show `DialogV2.confirm({ window:{title: localize('DCC.GmScreen.ConfirmTitle')}, content, rejectClose:false, modal:true })`.
      - `content` is `DCC.GmScreen.ConfirmContent` with `{names}`, the present roster names put through `foundry.utils.escapeHTML` and the list formatter. With an empty roster it is `DCC.GmScreen.ConfirmEmpty`.
      - On yes, call `this.document.system.endFloor()`.
    - `gmUndoFloor` calls `system.undoEndFloor()`.
    - `gmRemove` calls `system.removeFromRoster(target.closest('[data-uuid]').dataset.uuid)`.
    - Wrap each in try/catch with `ui.notifications.error(err, {console:true})`, like PcSheet's `#runAdvancement`.
- **Template `body.hbs`:**
  - A header with the portrait and a name input, bound to `document.name`.
  - A **Safehouse** checkbox: `name="system.safehouse"` checked from `systemSource.safehouse`.
  - The counter, **display-only**: `{{floorEndSeq}}`, labelled `DCC.GmScreen.FloorEnds`.
  - **End Floor** and **Undo End Floor** buttons. Put the disabled Undo button's tooltip on a wrapper span with the `aria-describedby` reason span, the same pattern as the PC header advancement row.
  - The roster table:
    - Columns: name, floor, pending, available, remove.
    - Rows carry `data-uuid`.
    - A missing row shows `(missing)`, dimmed, and keeps its Remove button.
  - A drop hint `DCC.GmScreen.DropHint` under the table.
  - For Observer players, core disables the inputs and buttons of a non-editable sheet, so no extra template logic is needed.
- **Register** in `index.mjs`: `DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, GmScreenSheet, { types: ['gmscreen'], makeDefault: true, label: 'DCC.Sheet.gmscreen' })`.
- **CSS:** a `.dcc.gmscreen` block reusing the existing `.dcc-bar`, `.dcc-box` and `.dcc-rollbtn` tokens, with light and dark themes, like Task 18.
- **`lang/en.json` (`DCC.GmScreen.*`):**
  - `Safehouse`: "Safehouse"
  - `FloorEnds`: "Floor ends"
  - `EndFloor`: "End Floor"
  - `UndoFloor`: "Undo End Floor"
  - `UndoFloorTooltip`: "Take back the last floor end (−1)"
  - `UndoFloorNone`: "No floor end to undo."
  - `ConfirmTitle`: "End the floor?"
  - `ConfirmContent`: "End the floor for: {names}? Each Crawler can then run their own End Floor once."
  - `ConfirmEmpty`: "The roster is empty. End the floor anyway? Crawlers added later start with no floor ends."
  - `Roster`: "Roster"
  - `Col.Name`: "Crawler"
  - `Col.Floor`: "Floor"
  - `Col.Pending`: "Pending"
  - `Col.Available`: "Floor ends"
  - `Missing`: "(missing)"
  - `Remove`: "Remove from roster"
  - `DropHint`: "Drag Crawler actors here to add them to the roster."
  - `NotConfigured`: "This GM Screen isn't selected in the system settings, so it gates nobody."
- **Live acceptance** (controller, `fvtt-browser-test` skill; rig as in the memory: GM user "Claude", world `dcc-testing`, "Test Crawler" with a linked token). Reload the browser after the change.
  - Create an actor of type GM Screen named "GM Screen". Its sheet opens with Safehouse off, counter 0, Undo disabled, and the "not selected" hint.
  - In Configure Settings → System, the GM Screen select lists "—" and "GM Screen". Pick it. The hint disappears.
  - Dragging "Test Mob" onto the sheet warns and leaves the roster unchanged. Dragging an item warns.
  - Drag "Test Crawler" on. A row appears with available 0.
    - `game.actors.getName('Test Crawler').system.floorEndEpoch` went up by 1.
    - Drag it again: an info notification appears, and the epoch doesn't change.
  - Press End Floor. The confirm lists "Test Crawler"; confirm it. The counter shows 1, and the row shows available 1.
  - Press Undo End Floor. The counter is 0, and Undo is disabled again.
  - Remove the row. The roster is empty.
  - `read_console_messages` with `onlyErrors` shows no `dungeon-crawler-carl` errors.
  - **User prerequisite for the next check:** the agent does not create accounts. Ask the user to add a Player-role user, e.g. `player1` with no password, to `dcc-testing`, then log in as that user.
    - The GM Screen appears in that user's actor directory, and its sheet opens read-only: disabled checkbox and buttons, and a drop does nothing.
    - Log back in as "Claude".
- **Commit:**
```bash
git add foundry/module/applications/gmscreen-sheet.mjs foundry/templates/actor/gmscreen/body.hbs foundry/module/applications/sheet-rows.mjs foundry/index.mjs foundry/styles/system.css foundry/lang/en.json foundry/test/applications/sheet-rows.test.mjs
git commit -m "feat(foundry): GM screen sheet (roster, safehouse, floor-end counter)"
```

### Task 31: Crawler sheet — gated End Floor, Level Up reason and safehouse badge

**Files:**
- Modify: `foundry/module/applications/pc-sheet.mjs`, `foundry/templates/actor/pc/header.hbs`, `foundry/styles/system.css`, `foundry/lang/en.json`

- **`PcSheet#_prepareContext`:** `const src = this.document.system._source;` then `advancement: advancementView(src, context.editable, this.document.advancementGate(src))`. Pass the SAME `src` to both. `advancementGate` (Task 28) is the one gate source `DCCActor#endFloor` / `levelUp` also read, so the button state and the refusal can never disagree; do not call `gmLinkFor` from the sheet. `advancementView` stays pure, and the sheet supplies the gate (spec).
- **`header.hbs`, End Floor:**
  - `{{disabled (not advancement.canEndFloor)}}`.
  - The wrapper-span tooltip becomes `{{localize advancement.endFloorTooltip n=advancement.floorEndsAvailable}}`.
  - When disabled, the button gets `aria-describedby` pointing at a `dcc-sr-only` reason span, the same pattern as Level Up / Undo.
  - Keep the existing End Floor confirm dialog in `#onEndFloor`. `DCCActor#endFloor` re-checks the gate, so a stale sheet can't over-consume.
- **`header.hbs`, safehouse badge:** when `advancement.safehouseBadge` is set, show a `dcc-adv-badge dcc-safehouse` chip in `.dcc-hdr-actions` reading `DCC.GmScreen.Badge`, with the tooltip `DCC.GmScreen.BadgeTooltip`. It has no other effect.
- Level Up already renders `advancement.levelUpTooltip`, so the Safehouse reason appears with no template change.
- **CSS:** `.dcc-safehouse` badge tint, in light and dark.
- **`lang/en.json`:**
  - `DCC.GmScreen.Badge`: "In safehouse"
  - `DCC.GmScreen.BadgeTooltip`: "The GM has declared a safehouse: Level Up is allowed."
- **Live acceptance** (controller, same rig; reload first). Force dice with `CONFIG.Dice.randomUniform` where a rank result matters. This covers the spec's live Foundry list:
  1. Task 30's acceptance ended with an empty roster at counter 0. Drag "Test Crawler" back onto the screen, which re-baselines it (cursor 0). Then:
     - Test Crawler's End Floor is disabled, with the tooltip "Waiting for the GM to end the floor."
     - End Session still works, and doesn't change `floorEndDone`.
  2. GM End Floor → counter 1. With both sheets open, the PC sheet re-renders by itself and End Floor is enabled, with the tooltip "Floor end available (1)".
     - Run it: floor +1, the summary card posts, and End Floor is disabled again.
     - The screen's row shows available 0.
  3. Undo on the PC: floor −1, and End Floor is enabled again (available 1).
  4. GM Undo End Floor at this point (cursor 0 < seq 1) succeeds. Then press GM End Floor twice → available 2. The PC runs End Floor twice; the third attempt is disabled.
  5. With the PC's cursor now equal to the counter, GM Undo End Floor is **blocked**, with a warning naming "Test Crawler".
  6. **Mid-campaign roster:** remove the PC, press GM End Floor once, and re-add the PC. Its available is 0, not 1.
  7. Set Test Crawler to floor 3 with a pending level, from the console: `game.actors.getName('Test Crawler').update({'system.floor': 3, 'system.pendingLevels': 1})`. Then:
     - Level Up is disabled with "The GM hasn't declared a safehouse."
     - Tick Safehouse on the screen: the "In safehouse" badge appears on the PC header and Level Up is enabled. Run it.
     - Untick: the badge disappears.
  8. **Re-link epoch:**
     - Step 6 left available at 0. Press GM End Floor (counter 4), then run a PC End Floor, which sets cursor 4.
     - Clear the setting, then re-select the screen. The PC's `floorEndEpoch` increments, and the cursor equals the counter (4).
     - PC Undo restores floor and ranks but **not** `floorEndDone`, so available stays 0.
  9. Restore a pending level with `update({'system.pendingLevels': 1})`, since step 7 used it up and step 8's Undo doesn't restore it. Then clear the setting to "—":
     - The PC's End Floor is enabled with the original tooltip.
     - Level Up at floor 3 with a pending level works without a safehouse.
     - No badge shows.
  10. Re-select the screen, then delete the GM Screen actor. The setting reads "—", and the PC sheet re-renders unlinked.
  11. The console is clean.
- **Commit:**
```bash
git add foundry/module/applications/pc-sheet.mjs foundry/templates/actor/pc/header.hbs foundry/styles/system.css foundry/lang/en.json
git commit -m "feat(foundry): Crawler header honours GM screen floor-end and safehouse gates"
```

---

### Task 23: Final pass
> Runs after Chunk 8 (GM screen); its walkthrough and README cover the GM screen too, including the unlinked-token cursor limitation.

- Run `npm --prefix foundry test`; all pass.
- Do a full live walkthrough: PC, Mob and Vehicle with crew. Screenshot each sheet.
- Write `foundry/README.md` covering install (junction), dev server, tests, the modifier key grammar for the "DCC Modifier" effect type, and known TODOs:
  - `rankDamageDie`
  - Speed die table
  - Mob damage-by-level chart
  - 100/200/300 milestones
  - Zero-zone mod swap
  - Initiative formula assumption
  - GM screen: a Crawler played through an unlinked token keeps its floor-end cursor on the token actor (Chunk 8 ambiguity resolutions); use linked tokens for Crawlers
  - GM screen cross-client races (Chunk 8 "Known limitations (cross-client races)"): GM Undo End Floor vs a PC's End Floor can swallow a floor end (the GM is warned afterwards); a re-baseline racing a PC's End Floor gives phantom floor ends that the PC's Undo can't restore; with two GMs, End Floor vs Undo is last-write-wins and concurrent roster adds replace each other's roster
  - Conditions list
- **Commit.**

---

## Appendix A — R20 spec inventory

(Verbatim from the controller's exploration; paths relative to `character-sheet/`, `S/`=`source/`, `J/`=`source/javascript/`, `T/`=`__tests__/`.)

**Modes:**
- `mode` is `pc|mob|vehicle`.
- `vehicle_kind` is `vehicle|mount`.
- Mob and vehicle modes use a single-page stat block, with no tabs.

**PC header:**
- End Session, End Floor, Level Up and Undo buttons.
- race, pronouns, class, crawler #, AI Favor.
- Abilities, each with Unenhanced and Enhanced values.
- Health Bar, Mana.
- Tabs: Combat, Inventory & Gear, Skills, Bio, Settings.
- Hotlist.

**Mob:**
- Removed: mana, hotlist, gear slots and accessories, compendium drop, advancement, crawler #, AI Favor, race/class/pronouns, skill mark/check type/passive, and the bio fields except Notes.
- Added: `descriptors`, `surprise` (default 10), and a mob strip with the five mods, `mob_tohit`, `mob_evade`, `dr` and `surprise`.
- Attacks show a static To-Hit instead of a to-hit roll button.
- Abilities show only the base value and the mod.

**Vehicle** (`S/views/_vehicle.pug`):
- Core fields: `vehicle_size`='4' (1–8, named Tiny, Small, Petite, Medium, Large, Huge, Gargantuan, Colossal), `speed`=0, `speed_max`=4, `vehicle_con_mod`=5, `passengers`=1, `drive_skill`='Driving', `armor`.
- Derived: `dr`, `vehicle_move = speed×50`, `vehicle_cruise = speed×10`, `vehicle_penalty = −speed`.
- Roll inputs:
  - `roll_adv` (''/adv/dis → d20 `1d20` / `2d20kh1` / `2d20kl1`)
  - `driving_mode` (accelerate DC 10+N, where a failure means Speed reaches ⌊N/2⌋; stop DC 10+speed; longhaul DC 15+floor)
  - `ram_target_evade`=10 (a ram is always at disadvantage, `dc=targetEvade`, damage `<size>d6 + <speed>`)
  - `ram_target_larger`
  - `race_ahead` (bonus = driverBonus + speed + ahead; a mob driver's target gets +5 with advantage)
- Ram aftermath:
  - Target larger: self-damage = damage dealt, speed → 0.
  - Otherwise: self-damage = ⌊damage/2⌋, speed = ⌊speed/2⌋.
  - Applied through `directDamage` with DR 0.
- DR absorbed: `hb −= 1`.
- A mount has a fixed Step of 10 ft.

**Crew:**
- `crewSkillBonus`: finds the cached skill by name, case-insensitive. With no match, it uses that stat's mod and the roll is untrained.
- `crewPenalty`: 0 for the drive skill; otherwise −3 on a mount or −speed on a vehicle.
- Skill: `1d20 + bonus - |pen|`.
- Attack to-hit: `1d20` (`2d20kl1` for the driver) `+ tohit - |pen|`. Damage: `die + dmgbase` plus the Speed die note.
- Vehicle weapons: `gunner_slot` → role → crew → `1d20 + crewSkillBonus(skill_name, stat) + row.tohit`.
- Mount attacks: a plain roll.
- A mob crew member never rolls. It posts `target = 10 + bonus (+ penalty) + floor`.

**Skills:**
- User-defined rows with `name, mark, enabled (modifier gate, default off), stat, rank, check_type (opposed/unopposed/generic), passive, is_spell, mana_cost, class, description`.
- Rank cap is 15, or 20 when `floor >= 6`.
- `advancesAt`: rank ≤ 4 advances at a session end, rank ≥ 5 at a floor end.
- Level Up needs `pending_levels > 0 && floor >= 3` and gives `level += 1` and `stat_points += 3`.
- The undo stack holds at most 20 entries.

**Inventory:**
- Fields: `name, qty, slot (pack/head/torso/arms/hands/legs/feet), active, accessory, on_hotlist, description`.
- An item is active when it is in a gear slot or has the active flag.
- The first item in each slot fills that slot.
- Accessories are active items with `accessory` set, capped at 10.
- The hotlist has 10 slots.

**Roll template:**
- Header: `name`, `character_name`, `tag`. The tint is gold-red for damage-only, gold for a crit, gray for a fumble.
- Body, in order: `roll` (a total pill with a Crit!/Fumble! chip), `target`, `damage` + `type`, `advantage`, `dc`, `penalty`, `note`, `cost` ("Mana Cost N"), `insufficient` ("⚠ Insufficient mana").

**Missing in R20:** do not invent these; record them as TODOs.
- The Rank damage-die chart
- The Speed die
- The mob damage-by-level chart
- The 100/200/300 milestone bonuses
- The zero-zone mod swap
- A conditions list
