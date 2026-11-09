# Roll20 to Foundry Parity Matrix

Last audited: 2026-11-09  
Roll20 source baseline: `f241a34c`  
Foundry system baseline: `e8da8e7`

This document tracks behavioral and UI parity between the current Roll20
character sheet in `character-sheet/` and the Foundry VTT system in
`foundry-system/`.

The goal is not a line-for-line port. Roll20 repeating rows, sheet workers, and
`k.send` protocols should become native Foundry documents, data models,
applications, Active Effects, UUID links, and chat messages while preserving
the player-visible rules and workflows.

## Authority and scope

When sources disagree, use this order:

1. Current Roll20 tests under
   [`character-sheet/__tests__/`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests/)
2. Current domain glossary in
   [`character-sheet/CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md)
3. Current Roll20 source under
   [`character-sheet/source/`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/)
4. Older Foundry implementation plans and comments

For example, the glossary currently says using a skill automatically marks it,
but the current spell tests require the Used checkbox to remain manual. The
tests are authoritative for this audit.

### Included

- Current rules and derived values
- Actor and item data needed by those rules
- Rolls and chat output
- Crawler, Mob, Vehicle/Mount, and GM Screen workflows
- Inventory, modifiers, buffs, skills, spells, attacks, advancement, and crew
- Current UI behavior and settings
- Foundry-native compendium and drop equivalents
- Tests needed to prove parity

### Excluded

- Roll20 sheet-version migrations and legacy attribute repair
- Compatibility with existing Foundry actors or items
- Roll20 implementation details that Foundry replaces natively
- Unsourced rules that neither implementation should invent
- Exact pixel parity where Foundry's native interaction is clearer

Because there are no existing Foundry characters, schema corrections may be
made directly without migration hooks, aliases, or dual-read compatibility.

## Status legend

| Status | Meaning |
|---|---|
| Aligned | The current Foundry behavior matches the current Roll20 contract. |
| Native equivalent | The implementation differs by platform but preserves the contract. |
| Partial | Some of the contract exists, but important fields, rules, or UI are missing. |
| Divergent | Foundry currently implements different player-visible behavior. |
| Missing | No meaningful Foundry implementation exists yet. |
| Foundry extension | Useful Foundry behavior with no current Roll20 equivalent; preserve unless product requirements change. |
| Out of scope | Deliberately not being ported. |
| Verify live | Code appears aligned, but it requires live Foundry validation. |

## Priority legend

| Priority | Meaning |
|---|---|
| P0 | Rules or schema blocker. Complete before dependent UI/content work. |
| P1 | Required player-facing parity. |
| P2 | Important workflow, presentation, or content parity. |
| P3 | Polish or a non-blocking Foundry extension. |
| - | No parity work currently required. |

## Implementation batches

| Batch | Scope |
|---|---|
| B1 | Schema and shared vocabulary |
| B2 | Core calculations, Health Bar, resources, and settings |
| B3 | Skills, spells, check types, and advancement |
| B4 | Attacks, linkage, rolls, and chat cards |
| B5 | Inventory, modifiers, buffs, and hotlist |
| B6 | Mob rules and UI |
| B7 | Vehicle/Mount and crew reconciliation |
| B8 | Compendium content and compound drops |
| B9 | Visual, accessibility, live Foundry, and regression pass |

## 1. Platform architecture

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| ARC-01 | Crawler, Mob, Vehicle/Mount, and GM Screen are distinct sheet modes. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`views/`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/) | [`system.json`](../system.json), [`module/data/actor/`](../module/data/actor/) | Native equivalent | - | Keep separate Foundry Actor types. |
| ARC-02 | Rules calculations are deterministic and testable outside the UI. | [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`module/rules/`](../module/rules/), [`test/rules/`](../test/rules/) | Native equivalent | - | Continue pure-rule-first implementation. |
| ARC-03 | Item-like repeating rows become durable Foundry documents. | [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug), [`_skills.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_skills.pug) | [`module/data/item/`](../module/data/item/) | Native equivalent | - | Keep owned Items; revise schemas in B1. |
| ARC-04 | Modifier sources apply only while their source is active. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`effects/dcc-change.mjs`](../module/effects/dcc-change.mjs), [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) | Native equivalent | - | Keep Active Effects and source suppression. |
| ARC-05 | Existing Roll20/Foundry data migrations are not required for this alignment. | [`variables.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/variables.js) | No persistent Foundry character data exists. | Out of scope | - | Change schemas directly; do not add migration code. |

## 2. Core creature data and calculations

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| CORE-01 | Five stats store Unenhanced values and derive Enhanced values and Stat Mods from the current threshold table. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs), [`rules/engine.mjs`](../module/rules/engine.mjs) | Aligned | - | Preserve tests while changing dependent rules. |
| CORE-02 | Modifier materialization is `floor((base + flat) * (1 + percent / 100))`. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/engine.mjs`](../module/rules/engine.mjs) | Aligned | - | No change. |
| CORE-03 | Crawler Evade roll bonus is Dex Mod + Int Mod + Evade modifiers, with no hidden +10. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`rules/derive.mjs`](../module/rules/derive.mjs) derives `10 + Dex Mod`. | Divergent | P0 | B2: correct the rule, labels, roll, and tests. |
| CORE-04 | DR is editable Armor plus active DR modifiers. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`rules/derive.mjs`](../module/rules/derive.mjs), [`templates/actor/partials/defenses.hbs`](../templates/actor/partials/defenses.hbs) | Aligned | - | No change. |
| CORE-05 | Move and Step are editable bases with independently derived effective values; defaults are 20 and 10. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs) defaults to 0 and 5; derivation is otherwise present. | Divergent | P0 | B1/B2: change defaults and retain base/effective separation. |
| CORE-06 | Crawler Size is a free-text display/edit value. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs) | Aligned | - | No change. |
| CORE-07 | AI Favor is an editable Crawler resource. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`data/actor/pc.mjs`](../module/data/actor/pc.mjs), [`templates/actor/pc/header.hbs`](../templates/actor/pc/header.hbs) | Aligned | - | Verify placement during B9. |
| CORE-08 | Mana ability is configurable and Max Mana uses the selected Enhanced stat plus modifiers. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug) | [`data/actor/pc.mjs`](../module/data/actor/pc.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | No calculation change. |
| CORE-09 | PC identity fields include race, class, pronouns, crawler number, and the current bio fields. | [`components/_header.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/components/_header.pug), [`_bio.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_bio.pug) | [`data/actor/pc.mjs`](../module/data/actor/pc.mjs), [`templates/actor/pc/`](../templates/actor/pc/) | Partial | P2 | B9: compare labels, Notes & Debuffs vs Bio, and visibility by actor type. |

## 3. Health Bar and damage

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| HP-01 | Health Bar slots are the source of truth; HP is slots multiplied by Con Mod. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`data/actor/_derive-wiring.mjs`](../module/data/actor/_derive-wiring.mjs) | Aligned | - | Preserve. |
| HP-02 | PC auto slots = 10; Mob auto slots = min(Level, 10); Vehicle slots = Size, never below 1. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/engine.mjs`](../module/rules/engine.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | Preserve as auto behavior. |
| HP-03 | PC and Mob may override slot count with any positive whole number up to the sanity guard of 100. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js) | No actor field or derive input exists. | Missing | P0 | B1/B2: add nullable custom slot count and use it in derive/view logic. |
| HP-04 | Growing a custom bar fills newly added slots; shrinking clamps from the high end. | [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js) | Foundry clamps display but has no custom growth transition. | Missing | P1 | B2: define update behavior and tests. |
| HP-05 | Slot labels are `floor(i / N * 100)%`; the last is always 100%, and long bars wrap at 12 per row. | [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js), [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs) always builds 10 cells with `i * 10`. | Divergent | P1 | B2/B9: make the view variable-length with percentage/tier derived from N. |
| HP-06 | Clicking a slot fills to it; clicking the current top slot removes one. | [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`applications/creature-sheet.mjs`](../module/applications/creature-sheet.mjs) | Aligned | - | Extend tests to custom bars. |
| HP-07 | Per-hit damage applies DR, loses whole Con-Mod chunks, and shrugs the remainder. | [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | No change. |
| HP-08 | HP edits and HP-based healing use chunk rules; slot healing restores whole slots directly. | [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | Extend to custom slot maximum. |
| HP-09 | A Crawler at zero slots is Dying; a Mob at zero is dead. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`mob.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/mob.test.js) | Shared Foundry view exposes `dying`; no distinct Mob death presentation was found. | Partial | P2 | B6/B9: use Mob-specific dead state/label. |

## 4. Modifiers, buffs, and effects

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| MOD-01 | Modifier values support flat numbers, percentages, and roll-time dice such as `+1d4`. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/engine.mjs`](../module/rules/engine.mjs) supports only flat and percent. | Partial | P0 | B1/B4: add dice parsing and carry dice to supported attack damage rolls. |
| MOD-02 | Field targets include stats, DR, Evade, Move, Step, and Mana using current snake_case vocabulary. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`config.mjs`](../module/config.mjs), [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) | Aligned | - | Preserve vocabulary. |
| MOD-03 | A modifier may target one specific attack/skill row without relying on a mutable name. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) targets an item by name. | Divergent | P0 | B1/B5: use stable owned Item IDs/UUIDs in the Foundry target representation. |
| MOD-04 | Group targets support attacks/skills, equality/inequality filters, and current aspect names. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) | Partial | P1 | B5: add current edge cases for free-text damage types containing `:` or `=`. |
| MOD-05 | Damage modifiers are flat or dice only; percentages do not apply to a damage expression. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) rejects percent damage but drops dice as zero. | Partial | P0 | B4/B5: retain dice separately and reject only percent. |
| MOD-06 | Inventory items are active when worn or explicitly Active; skills/spells and buffs use enable toggles. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | [`rules/inventory.mjs`](../module/rules/inventory.mjs), transferred effects, actor buffs | Aligned | - | Preserve. |
| MOD-07 | Buffs/Debuffs support both numeric modifier sources and status-only rows with descriptions. | [`_buffs.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_buffs.pug) | Actor Active Effects may have DCC changes or no changes; [`buff-list.hbs`](../templates/actor/partials/buff-list.hbs) | Native equivalent | P2 | B5/B9: verify status-only creation/editing and description display live. |
| MOD-08 | Unresolved targets are visible and do not silently apply. | [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs), [`unresolved.hbs`](../templates/actor/partials/unresolved.hbs) | Aligned | - | Update reasons for new ID/link target format. |

## 5. Skills, spells, and advancement

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| SKL-01 | Check types are Opposed (default), Unopposed, Evade, and Passive; Generic is not offered. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_skills.pug`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/sections/_skills.pug), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/engine.test.js) | [`config.mjs`](../module/config.mjs), [`data/item/skill.mjs`](../module/data/item/skill.mjs), and the actor/item skill controls use the four current check types with Opposed as the default. | Aligned | - | Completed 2026-11-09. |
| SKL-02 | Opposed checks may name the opposing stat and display `<STAT>-Opposed`. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/javascript/_spells.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`data/item/skill.mjs`](../module/data/item/skill.mjs), [`rules/items.mjs`](../module/rules/items.mjs), and the actor/item sheets expose `opposedStat` only for Opposed checks. | Aligned | - | Completed 2026-11-09. |
| SKL-03 | Passive non-spells have no d20, no Stat contribution, no Used mark UI, and post their description card. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs), actor/item sheets, advancement, and crew quick-use share the Passive check-type behavior. | Aligned | - | Completed 2026-11-09. |
| SKL-04 | Passive spells still cast/spend mana but post no d20. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`documents/actor.mjs`](../module/documents/actor.mjs) uses the normal mana/auto-enable cast plan and posts a roll-less card for Passive spells. | Aligned | - | Completed 2026-11-09. |
| SKL-05 | Skills and spells carry Range, Cooldown, Limitations, and Notes & Upgrades; spells additionally carry Duration and Mana Cost. | [`_skills.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_skills.pug), [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skills.test.js) | Skill/Spell models contain description and mana cost only. | Missing | P0 | B1/B3: add schema, item sheets, actor summaries, and chat fields. |
| SKL-06 | A spell behaves as a skill plus spell fields, regardless of platform storage shape. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md) | [`data/item/spell.mjs`](../module/data/item/spell.mjs) extends SkillModel. | Native equivalent | - | Separate Foundry Item type is acceptable. |
| SKL-07 | Casting spends affordable mana, preserves remaining mana when unaffordable, posts an insufficient notice, and may auto-enable modifiers. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`rules/combat.mjs`](../module/rules/combat.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | Extend to passive casts and chat extras. |
| SKL-08 | Used is manual in the current Roll20 contract; rolling/casting/attacking does not change it. | [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | Foundry roll paths do not set `system.mark`. | Aligned | - | Keep manual unless the Roll20 contract changes. |
| SKL-09 | Skill bonus is Stat Mod + effective Rank; Passive non-spell bonus is Rank only. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | Normal skill formula aligns; passive exception is absent. | Partial | P0 | B3: add passive branch. |
| SKL-10 | Rank caps at 15 on Floors 1-5 and 20 on Floor 6+. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skills.test.js) | [`rules/advancement.mjs`](../module/rules/advancement.mjs) | Aligned | - | Preserve. |
| SKL-11 | Manual advancement succeeds when d20 is greater than or equal to Rank. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skills.test.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`rules/advancement.mjs`](../module/rules/advancement.mjs) requires d20 to be strictly greater. | Divergent | P0 | B3: change comparison and tests. |
| SKL-12 | Skill cards expose the current manual Skill Check action against Rank; Passive skills cannot use it. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skills.test.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | No per-item manual advancement check was found. | Missing | P1 | B3: add item action and result card. |
| SKL-13 | Current Roll20 bulk End Session/End Floor/Level Up controls remain deferred in the rendered sheet. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skills.test.js) | Foundry implements bulk advancement and GM-screen gates. | Foundry extension | P3 | Preserve, but reconcile rule formulas and passive check type. |
| SKL-14 | Undo snapshots ranks, marks, pending levels, floor, and current floor-end cursor/epoch semantics. | [`gm-advancement.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/gm-advancement.test.js) | [`rules/advancement.mjs`](../module/rules/advancement.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | Update passive detection only. |

## 6. Attacks, rolls, and chat cards

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| ATK-01 | Every offensive action is an Attack record; a granting item/skill/spell links to it rather than embedding its fields. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | Weapons are Items, but spells embed an `attack` schema in [`data/item/spell.mjs`](../module/data/item/spell.mjs). | Divergent | P0 | B1/B4: settle Foundry Attack/Weapon representation and remove embedded spell attack data. |
| ATK-02 | Linked chains are stable, bidirectional, stale-tolerant, and cascade deletion across item -> spell/skill -> attack. | [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | No general owned-item linkage model exists. | Missing | P0 | B1/B4: use owned Item IDs/UUIDs and document hooks/services. |
| ATK-03 | Linked rows keep independent names; granting skill Rank flows one way to the linked attack. | [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | Weapons may resolve a skill by mutable name; spell attacks share the spell document. | Divergent | P0 | B4: replace name resolution with stable linkage. |
| ATK-04 | Attacks may select a primary skill and alternate skill uses; missing/ambiguous names are visible. | [`skilluse.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skilluse.test.js) | One weapon `skill` name exists; alternate skill-use rows/statuses do not. | Partial | P1 | B4: define native linked-skill and alternate-use representation. |
| ATK-05 | PC To-Hit is Stat Mod + linked/effective Rank + modifiers. | [`attacks.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attacks.test.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) | Partial | P0 | B4: retain formula but source Rank through stable links. |
| ATK-06 | To-Hit and Damage are separate rolls; a spell's linked attack To-Hit invokes the same cast path as the spell. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js), [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | Rolls are separate; embedded attack-spell To-Hit invokes cast. | Partial | P0 | B4: preserve dual entry with linked Attack Items. |
| ATK-07 | Damage supports die + flat modifier + roll-time modifier dice + free-text damage type. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/javascript/_spells.js), [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/attackfields.test.js) | Weapon and Spell Attack models/forms now accept free-text damage types; roll-time modifier dice remain missing. | Partial | P0 | B4: add roll-time damage modifier dice. |
| ATK-08 | Zero flat damage is omitted from the label; a blank die and zero flat label as No Damage. | [`attacks.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attacks.test.js) | [`rules/combat.mjs`](../module/rules/combat.mjs) always formats a signed flat, including `+0`. | Divergent | P1 | B4: align labels and formula/card guards. |
| ATK-09 | Attacks have free-text Range and Notes & Effects. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | No attack fields exist. | Missing | P0 | B1/B4: add fields to Attack/Weapon schema and sheets. |
| ATK-10 | Settings control whether attack/spell Range and Notes appear in chat; Duration/Cooldown appear when set. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js) | No corresponding actor settings or card fields exist. | Missing | P1 | B2/B4: add settings and card context. |
| ATK-11 | Chat text from editable descriptions/range/notes is sanitized and line-safe. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`rules/card.mjs`](../module/rules/card.mjs) strips HTML for notes. | Partial | P1 | B4: test all new card fields and Foundry HTML/text handling. |
| ATK-12 | Crit/fumble presentation and natural-d20 extraction work for normal rolls; utility rolls suppress badges. | [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js), [`rolltemplate/_index.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/rolltemplate/_index.pug) | [`rules/card.mjs`](../module/rules/card.mjs), [`templates/chat/card.hbs`](../templates/chat/card.hbs) | Partial | P2 | B4/B9: compare current badges, colors, and utility-card behavior. |
| ATK-13 | Rank bonus-damage die remains unsourced and is not invented. | [`attacks.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attacks.test.js) | [`rules/combat.mjs`](../module/rules/combat.mjs) deliberately omits it. | Aligned | - | Keep out of scope until sourced. |

## 7. Inventory, gear, buffs, and hotlist

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| INV-01 | Inventory is the canonical item store; gear slots and accessories are derived views. | [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug), [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | Owned Items plus [`rules/inventory.mjs`](../module/rules/inventory.mjs) | Native equivalent | - | Preserve. |
| INV-02 | Gear slots are Head, Torso, Arms, Hands, Legs, Feet; Pack is unequipped. | [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug) | [`config.mjs`](../module/config.mjs), [`templates/actor/pc/inventory.hbs`](../templates/actor/pc/inventory.hbs) | Aligned | - | No change. |
| INV-03 | Accessories list active accessory items and caps display at 10. | [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | [`rules/inventory.mjs`](../module/rules/inventory.mjs) | Aligned | - | No change. |
| INV-04 | Hotlist accepts items, skills/spells, and attacks, caps at 10, and dispatches the correct action/card. | [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`applications/sheet-rows.mjs`](../module/applications/sheet-rows.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Partial | P1 | B5: retest after linked Attack changes and passive cards. |
| INV-05 | Hotlist placement is stable: removals leave gaps and new entries fill the lowest gap. | [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | Foundry derives hotlist cells from current item order; no persistent slot ownership exists. | Divergent | P2 | B5: decide whether exact stable-cell behavior is required in Foundry, then implement or document native ordering. |
| INV-06 | Hotlisted plain items post sanitized description cards. | [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`documents/actor.mjs`](../module/documents/actor.mjs), [`rules/card.mjs`](../module/rules/card.mjs) | Aligned | - | Preserve. |
| INV-07 | Item, skill, and buff descriptions remain visible in collapsed summaries when populated. | [`collapse-ui.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/collapse-ui.test.js), [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug) | Foundry uses item sheets/list rows rather than equivalent collapsible cards. | Partial | P2 | B5/B9: define Foundry-native summary affordance. |
| INV-08 | Duplicate gear-slot occupancy is visible to the user. | Current Foundry UI requirement; Roll20 shows one derived occupant. | [`templates/actor/pc/inventory.hbs`](../templates/actor/pc/inventory.hbs) flags slot conflicts. | Foundry extension | - | Preserve. |

## 8. Mob rules and UI

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| MOB-01 | Mob attack To-Hit is editable `to_hit_base` + attack modifiers + Floor; blank seeds once from 10 + Stat Mod + Rank; zero is valid. | [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js), [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | Foundry derives 10 + normal attack To-Hit + Floor with no editable base. | Divergent | P0 | B1/B6: add nullable base, seed-on-create/drop behavior, and current formula. |
| MOB-02 | Mob attack To-Hit may be `None`; modifiers do not resurrect it. | [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | No representation exists. | Missing | P0 | B1/B6: model optional/none state separately from numeric zero. |
| MOB-03 | Mob attacks may explicitly be No Damage; blank die/flat/dice also derives no damage. | [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | Damage button is always rendered for an attack row. | Missing | P0 | B1/B6: add flag, derivation, and Mob action presentation. |
| MOB-04 | Mob Evade is an editable base + Floor; blank defaults to 10 and zero is valid. | [`mob.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/mob.test.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | Foundry uses 10 + Dex Mod + Floor. | Divergent | P0 | B1/B6: add base field and change derivation/UI. |
| MOB-05 | Mob Surprise is editable base + Floor; blank defaults to 10 and zero is valid. | [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | [`data/actor/mob.mjs`](../module/data/actor/mob.mjs) stores one Surprise number directly. | Divergent | P0 | B1/B6: store base and derive total. |
| MOB-06 | Mob Move total is effective Move + effective Step. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | Foundry derives Move and Step separately and does not expose a Mob combined total. | Missing | P1 | B6: add combined Mob display value. |
| MOB-07 | Mob combat totals remain visible; a pencil/lock reveals editable bases. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | Mob inputs and totals are spread across the current header/combat view with no edit lock. | Divergent | P1 | B6: rebuild the Mob combat strip. |
| MOB-08 | Mob rolls are public by default; a setting optionally whispers them to the GM. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js) | [`data/actor/mob.mjs`](../module/data/actor/mob.mjs) stores `mobPublic=false`; [`rules/engine.mjs`](../module/rules/engine.mjs) whispers by default. | Divergent | P0 | B1/B6: replace with `mobWhisper=false` and update all card/crew privacy paths. |
| MOB-09 | Mob mana appears only when the Mob has at least one spell; a dropped Mob initializes current/max mana from Enhanced Intelligence once. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js) | Mob model has no mana pool; Mob casts intentionally spend nothing. | Missing | P0 | B1/B6/B8: add Mob mana, conditional UI, and creation/drop initialization. |
| MOB-10 | Inventory, Buffs, and Skills/Spells are optional Mob sections, enabled by content drops without disabling user choices. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`compendium-npc.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium-npc.test.js) | Current Mob template always renders these sections. | Divergent | P1 | B1/B6/B8: add visibility settings and drop enablement. |
| MOB-11 | Mob combat is asymmetric: crawlers roll d20s; Mob attacks roll damage only and show static targets. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md) | [`templates/actor/partials/attack-list.hbs`](../templates/actor/partials/attack-list.hbs), [`rules/combat.mjs`](../module/rules/combat.mjs) | Partial | P0 | B6: retain asymmetry while replacing static-target math and no-damage handling. |

## 9. Vehicle, Mount, and crew

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| VEH-01 | Vehicle/Mount Size 1-8 controls Health Bar slots; blank defaults to Medium/4. | [`_vehicle.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_vehicle.pug), [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | [`data/actor/vehicle.mjs`](../module/data/actor/vehicle.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | Preserve. |
| VEH-02 | Vehicle Con Mod defaults to 5 but may be explicitly 0. | [`_vehicle.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_vehicle.pug), [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | Vehicle model enforces minimum 1 and documents the deviation. | Divergent | P1 | B1/B7: allow zero and update health guards/tests. |
| VEH-03 | Speed derives Move, Cruise, and attack penalty; Mount Step is 10. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | [`rules/vehicle.mjs`](../module/rules/vehicle.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | Preserve. |
| VEH-04 | Driving, Ram/Trample, Race/Chase, Advantage/Disadvantage, and aftermath workflows use current formulas. | [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | [`rules/vehicle.mjs`](../module/rules/vehicle.mjs), [`documents/vehicle-rolls.mjs`](../module/documents/vehicle-rolls.mjs) | Aligned | Verify live | B7/B9: run focused regression plus live cards. |
| VEH-05 | Crew roles are exclusive for Driver/Rider and Gunner 1-4; passengers are unrestricted. | [`crew.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crew.test.js) | [`rules/crew.mjs`](../module/rules/crew.mjs), [`data/actor/vehicle.mjs`](../module/data/actor/vehicle.mjs) | Native equivalent | - | Preserve UUID-based links. |
| VEH-06 | Crew values are live, permissions-aware, and missing crew remain removable. | [`crew.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crew.test.js) | [`applications/sheet-rows.mjs`](../module/applications/sheet-rows.mjs), [`applications/vehicle-sheet.mjs`](../module/applications/vehicle-sheet.mjs) | Native equivalent | Verify live | B7/B9: validate permission tiers with multiple users. |
| VEH-07 | Driver skill fallback, aboard penalties, Mob static targets, driver Disadvantage, and vehicle gunner rolls use current formulas. | [`crewrolls.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crewrolls.test.js) | [`rules/crew.mjs`](../module/rules/crew.mjs), [`documents/vehicle-rolls.mjs`](../module/documents/vehicle-rolls.mjs) | Partial | P1 | B7: rerun against new skill/passive/attack/link schemas and current Mob privacy. |
| VEH-08 | Vehicle and crew attack cards honor current attack dice, Range, Notes, and chat-extra settings. | [`crewrolls.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crewrolls.test.js) | Current vehicle cards predate new attack fields/settings. | Missing | P1 | B4/B7: share the revised attack-card builder. |
| VEH-09 | Crew connections use stable Foundry world Actor UUIDs rather than Roll20 name probes/pushed caches. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md) | [`data/actor/vehicle.mjs`](../module/data/actor/vehicle.mjs), [`applications/vehicle-sheet.mjs`](../module/applications/vehicle-sheet.mjs) | Native equivalent | - | Preserve. |

## 10. GM Screen

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| GM-01 | A GM Screen maintains roster, safehouse state, and a floor-end counter. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`gmscreen.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/gmscreen.test.js) | [`data/actor/gmscreen.mjs`](../module/data/actor/gmscreen.mjs), [`applications/gmscreen-sheet.mjs`](../module/applications/gmscreen-sheet.mjs) | Native equivalent | - | Preserve. |
| GM-02 | Rostered Crawlers are gated on available floor ends and safehouse Level Up; unrostered Crawlers are not gated. | [`gm-advancement.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/gm-advancement.test.js) | [`rules/gm-screen.mjs`](../module/rules/gm-screen.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | Preserve while updating advancement comparison/passive rules. |
| GM-03 | Floor ends stack, roster joins baseline the cursor, and epochs prevent stale Undo restoration. | [`gm-advancement.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/gm-advancement.test.js) | [`rules/gm-screen.mjs`](../module/rules/gm-screen.mjs), [`rules/advancement.mjs`](../module/rules/advancement.mjs) | Aligned | - | Preserve. |
| GM-04 | GM Undo is blocked when a rostered Crawler consumed/joined at the latest counter and identifies blockers. | [`gmscreen.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/gmscreen.test.js) | [`rules/gm-screen.mjs`](../module/rules/gm-screen.mjs), [`data/actor/gmscreen.mjs`](../module/data/actor/gmscreen.mjs) | Aligned | Verify live | B9: validate multi-client presentation. |
| GM-05 | Foundry selects the active GM Screen through a system setting and adds world Crawlers by drag/drop. | Roll20 uses character references and registration messages. | [`gm-link.mjs`](../module/gm-link.mjs), [`applications/gmscreen-sheet.mjs`](../module/applications/gmscreen-sheet.mjs) | Native equivalent | - | Preserve Foundry-native setup. |

## 11. Compendium and content drops

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| CMP-01 | Skills and spells import all current authored fields, check types, opposed stat, modifiers, and optional linked attacks. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`templates/skills.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/skills.json), [`templates/spells.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/spells.json) | Foundry accepts ordinary Item drops but has no conversion/compound-drop layer. | Missing | P1 | B8 after B1-B4 schemas stabilize. |
| CMP-02 | Gear imports quantity/slot/active/accessory/hotlist, modifiers, linked skill/spell/attack chains, and descriptions. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`templates/gear.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/gear.json) | Core Item drop creates only the dropped Item. | Missing | P1 | B8: publish complete Foundry Items or implement atomic compound creation. |
| CMP-03 | Data-choice gear prompts for valid options, queues choices, shows slot conflicts, revalidates, and creates nothing on cancel. | [`dropchoice.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/dropchoice.test.js) | No choice workflow exists. | Missing | P2 | B8: implement a Foundry dialog only for content that still requires runtime choices. |
| CMP-04 | Race/Class drops update identity and replace/grant their sourced buffs and skills without duplicating unrelated content. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`templates/races.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/races.json), [`templates/classes.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/classes.json) | No compound Race/Class drop workflow exists. | Missing | P2 | B8: decide whether these become Items, Advancements, or a dedicated drop service. |
| CMP-05 | Character drops create/fill a Mob with stats, attacks, skills/spells, gear, buffs, notes, token defaults, full health, and initialized mana. | [`compendium-npc.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium-npc.test.js), [`templates/characters.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/characters.json) | No Mob import/drop workflow exists in the system. | Missing | P1 | B8: prefer prebuilt Foundry Actor compendium entries; add conversion only if source JSON remains canonical. |
| CMP-06 | Content import rejects ambiguous references instead of silently linking the wrong row/document. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`dropchoice.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/dropchoice.test.js) | Ordinary Foundry document drops avoid name resolution, but compound relationships are not implemented. | Partial | P1 | B8: resolve links by source IDs/UUIDs and fail atomically with a notification. |
| CMP-07 | Vehicle sheets reject incompatible Roll20 page drops; Foundry sheets accept only owned Item types appropriate to the actor. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js) | [`applications/actor-sheet-base.mjs`](../module/applications/actor-sheet-base.mjs) validates owned Item types. | Native equivalent | - | Extend validation for the revised Attack/link types. |

## 12. UI, accessibility, and Foundry integration

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
|---|---|---|---|---|---|---|
| UI-01 | Crawler layout retains recognizable header, abilities, vitals, combat, inventory, skills, bio, and hotlist organization. | [`DungeonCrawlerCarl.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/DungeonCrawlerCarl.pug) | [`applications/pc-sheet.mjs`](../module/applications/pc-sheet.mjs), [`templates/actor/pc/`](../templates/actor/pc/) | Partial | P2 | B9 after behavioral batches; do not restyle unstable fields twice. |
| UI-02 | Mob is a condensed stat-block workflow with current combat strip, optional sections, and Notes & Debuffs. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug) | [`templates/actor/mob/body.hbs`](../templates/actor/mob/body.hbs) reflects the older layout. | Divergent | P1 | B6. |
| UI-03 | Vehicle/Mount presents current formulas, rules chips, actions, attacks, crew, and Notes & Debuffs. | [`_vehicle.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_vehicle.pug) | [`templates/actor/vehicle/`](../templates/actor/vehicle/), [`applications/vehicle-sheet.mjs`](../module/applications/vehicle-sheet.mjs) | Partial | P2 | B7/B9 after shared attack changes. |
| UI-04 | Editable controls have visible labels/accessible names; icon-only actions have tooltips and aria labels. | Roll20 Pug components and accessibility tests | Foundry templates generally use labels, tooltips, and aria labels. | Partial | P2 | B9: audit every newly changed template and keyboard path. |
| UI-05 | Read-only users may inspect allowed documents and use permitted rolls, while write actions remain disabled. | Foundry-specific workflow | [`actor-sheet-base.mjs`](../module/applications/actor-sheet-base.mjs), crew and GM-screen sheets | Foundry extension | Verify live | B9: multi-user permission smoke test. |
| UI-06 | Initiative uses `1d20 + Dex Mod` for creatures; vehicle/GM behavior remains the documented Foundry assumption. | No Roll20 initiative contract. | [`README.md`](../README.md), [`index.mjs`](../index.mjs) | Foundry extension | P3 | Preserve unless rules provide a sourced formula. |
| UI-07 | Foundry system schema, templates, localization, and tests stay synchronized. | N/A | [`system.json`](../system.json), [`lang/en.json`](../lang/en.json), [`test/`](../test/) | Partial | P1 | Every implementation batch updates all four surfaces together. |
| UI-08 | Full automated tests pass, followed by live Foundry smoke tests for persistence, drag/drop, rolls, permissions, and layout. | Roll20 suite is the behavioral oracle. | [`package.json`](../package.json), [`test/`](../test/) | Verify live | P1 | Run focused tests per batch; full suite and live matrix in B9. |

## Recommended execution order

1. **B1 - Schema and vocabulary**
   - Check types and opposed stat
   - Skill/spell metadata
   - Attack/link fields and free-text damage type
   - Mob bases, optional states, mana, visibility, and privacy setting
   - Custom Health Bar count
   - Vehicle Con Mod zero

2. **B2 - Core calculations and resources**
   - Crawler Evade
   - Move/Step defaults
   - Variable Health Bar derivation and view
   - Mob privacy plumbing
   - Chat-extra settings

3. **B3 - Skills, spells, and advancement**
   - Four check types and opposed labels
   - Passive skill/spell behavior
   - New authored fields
   - Advancement `>= Rank`
   - Manual Skill Check action

4. **B4 - Attacks and chat**
   - Stable linked Attack architecture
   - Skill/alternate-skill resolution
   - Dice modifiers and free-text damage type
   - Range/notes/duration/cooldown cards
   - Passive and insufficient-mana cards

5. **B5 - Inventory, modifiers, buffs, and hotlist**
   - Stable ID modifier targets
   - Group-target edge cases
   - Hotlist behavior after Attack changes
   - Status-only effects and collapsed summaries

6. **B6 - Mob**
   - Current static-target math
   - To-Hit None and No Damage
   - Combat edit strip
   - Conditional mana and optional sections

7. **B7 - Vehicle/Mount and crew**
   - Reconcile revised skills, attacks, privacy, and chat extras
   - Allow Con Mod zero
   - Live permission checks

8. **B8 - Compendium/content**
   - Generate or convert complete Foundry Items and Actors only after schemas
     are stable
   - Add compound/choice services only where prebuilt documents cannot express
     the workflow

9. **B9 - UI and regression**
   - Visual alignment
   - Accessibility
   - Localization completeness
   - Full Vitest suite
   - Live Foundry multi-user smoke pass

## Definition of parity for a row

A row may move to **Aligned** or **Native equivalent** only when:

1. The schema can represent every current authored input.
2. Pure rule tests cover the current Roll20 edge cases.
3. Actor/item document wiring persists and derives the correct values.
4. The sheet exposes the required edit and read-only states.
5. Rolls/cards show the correct result and privacy.
6. Relevant compendium content can create the same final state.
7. The focused Foundry tests pass.
8. Any interaction that depends on Foundry itself has been checked live.
