# Roll20 to Foundry Parity Matrix

Last audited: 2026-11-09  
Roll20 source baseline: `f241a34c`  
Foundry system baseline: `0bc83db` plus the current uncommitted worktree

This document tracks behavioral and UI parity between the Roll20 character sheet in the sibling `dungeon-crawler-carl/character-sheet/` repository and this standalone Foundry VTT system. The obsolete nested `foundry-system/` copy is not the implementation target.

The goal is not a line-for-line port. Roll20 repeating rows, sheet workers, and `k.send` protocols should become native Foundry documents, data models, applications, Active Effects, UUID links, and chat messages while preserving the player-visible rules and workflows.

## Authority and scope

When sources disagree, use this order:

1. Current Roll20 tests under [`character-sheet/__tests__/`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests/)
2. Current domain glossary in [`character-sheet/CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md)
3. Current Roll20 source under [`character-sheet/source/`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/)
4. Older Foundry implementation plans and comments

For example, the glossary currently says using a skill automatically marks it, but the current spell tests require the Used checkbox to remain manual. The tests are authoritative for this audit.

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

The original scope excluded migration of existing Foundry characters. Schema corrections do not need Roll20-style migration hooks, aliases, or dual-read compatibility; preserve any current world data while developing and testing.

The original audit was updated incrementally as work progressed. Recent rows distinguish implementation and automated coverage from remaining live Foundry checks and future content-drop work; older Aligned rows are not evidence that a live check was performed.

## Status legend

| Status | Meaning |
| --- | --- |
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
| --- | --- |
| P0 | Rules or schema blocker. Complete before dependent UI/content work. |
| P1 | Required player-facing parity. |
| P2 | Important workflow, presentation, or content parity. |
| P3 | Polish or a non-blocking Foundry extension. |
| - | No parity work currently required. |

## Implementation batches

| Batch | Scope                                                    |
| ----- | -------------------------------------------------------- |
| B1    | Schema and shared vocabulary                             |
| B2    | Core calculations, Health Bar, resources, and settings   |
| B3    | Skills, spells, check types, and advancement             |
| B4    | Attacks, linkage, rolls, and chat cards                  |
| B5    | Inventory, modifiers, buffs, and hotlist                 |
| B6    | Mob rules and UI                                         |
| B7    | Vehicle/Mount and crew reconciliation                    |
| B8    | Compendium content and compound drops                    |
| B9    | Visual, accessibility, live Foundry, and regression pass |

## 1. Platform architecture

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| ARC-01 | Crawler, Mob, Vehicle/Mount, and GM Screen are distinct sheet modes. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`views/`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/) | [`system.json`](../system.json), [`module/data/actor/`](../module/data/actor/) | Native equivalent | - | Keep separate Foundry Actor types. |
| ARC-02 | Rules calculations are deterministic and testable outside the UI. | [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`module/rules/`](../module/rules/), [`test/rules/`](../test/rules/) | Native equivalent | - | Continue pure-rule-first implementation. |
| ARC-03 | Item-like repeating rows become durable Foundry documents. | [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug), [`_skills.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_skills.pug) | [`module/data/item/`](../module/data/item/) | Native equivalent | - | Keep owned Items; revise schemas in B1. |
| ARC-04 | Modifier sources apply only while their source is active. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`effects/dcc-change.mjs`](../module/effects/dcc-change.mjs), [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) | Native equivalent | - | Keep Active Effects and source suppression. |
| ARC-05 | Existing Roll20/Foundry data migrations are not required for this alignment. | [`variables.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/variables.js) | The initial alignment scope excluded migration; Foundry test actors may now exist. | Out of scope | - | Change schemas directly; do not add migration code. Preserve current world data. |

## 2. Core creature data and calculations

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| CORE-01 | Five stats store Unenhanced values and derive Enhanced values and Stat Mods from the current threshold table. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs), [`rules/engine.mjs`](../module/rules/engine.mjs) | Aligned | - | Preserve tests while changing dependent rules. |
| CORE-02 | Modifier materialization is `floor((base + flat) * (1 + percent / 100))`. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/engine.mjs`](../module/rules/engine.mjs) | Aligned | - | No change. |
| CORE-03 | Crawler Evade is `1d20 + Dex Mod + Evade modifiers`, with no Intelligence or hidden +10; dice modifiers roll separately. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/javascript/_engine.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/engine.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) applies flat and percentage modifiers to Dex Mod and preserves dice; the PC defense strip and roll use the resulting values. Evade and Damage Resistance share the left half of Combat with compact formula columns; Evade's d20 is inline with its label, and Evade Total is a red roll button. Other boxed Combat displays use theme-aware borders and text, while editable fields use underlines. | Partial | P0 | B2: implemented and tested; live Foundry roll and display need a smoke test. |
| CORE-04 | DR is editable Armor plus active DR modifiers. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`rules/derive.mjs`](../module/rules/derive.mjs), [`templates/actor/partials/defenses.hbs`](../templates/actor/partials/defenses.hbs) | Aligned | - | No change. |
| CORE-05 | Move and Step are editable bases with independently derived effective values; defaults are 20 and 10. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs) defaults to 20 and 10 for PCs and Mobs; [`defenses.hbs`](../templates/actor/partials/defenses.hbs) edits stored bases and separately displays derived totals. | Partial | P0 | B1/B2: implemented and tested; live Foundry editing and display verification remains. |
| CORE-06 | Crawler Size is a free-text display/edit value. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs) | Aligned | - | No change. |
| CORE-07 | AI Favor is an editable Crawler resource. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug) | [`data/actor/pc.mjs`](../module/data/actor/pc.mjs) stores the value; the Crawler Combat strip displays it and exposes its input in edit mode. | Partial | P2 | Live Foundry editing and display verification remains. |
| CORE-08 | Mana ability is configurable and Max Mana uses the selected Enhanced stat plus modifiers. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug) | [`data/actor/pc.mjs`](../module/data/actor/pc.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs); Crawler Mana is centered as an independent block in the right Combat column, with its label above bordered maximum on the left and current on the right. | Aligned | - | No calculation change. |
| CORE-09 | PC identity fields include race, class, pronouns, crawler number, and the current bio fields. | [`components/_header.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/components/_header.pug), [`_bio.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_bio.pug) | [`data/actor/pc.mjs`](../module/data/actor/pc.mjs), [`templates/actor/pc/`](../templates/actor/pc/) | Partial | P2 | B9: compare labels, Notes & Debuffs vs Bio, and visibility by actor type. |

## 3. Health Bar and damage

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| HP-01 | Health Bar slots are the source of truth; HP is slots multiplied by Con Mod. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`data/actor/_derive-wiring.mjs`](../module/data/actor/_derive-wiring.mjs); Crawler, Mob, and Vehicle slots show percentages below the blocks without a separate HP total, and place Heal Slot in the header. | Aligned | - | Preserve; live health-bar visual check pending. |
| HP-02 | PC auto slots = 10; Mob auto slots = min(Level, 10); Vehicle slots = Size, never below 1. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/engine.mjs`](../module/rules/engine.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | Preserve as auto behavior. |
| HP-03 | PC and Mob may override slot count with any positive whole number up to the sanity guard of 100. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js) | [`data/actor/creature.mjs`](../module/data/actor/creature.mjs) stores the nullable override; Configure Sheet exposes it and derivation uses it. | Partial | P0 | B1/B2: implemented and tested; live settings and persistence check pending. |
| HP-04 | Growing a custom bar fills newly added slots; shrinking clamps from the high end. | [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js) | [`data/actor/_derive-wiring.mjs`](../module/data/actor/_derive-wiring.mjs) reconciles stored slots when custom count, Mob level, or Vehicle size changes. | Partial | P1 | B2: implemented and tested; live update check pending. |
| HP-05 | Slot labels are `floor(i / N * 100)%`; the last is always 100%, and long bars wrap at 12 per row. | [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js), [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs) generates N percentage-labeled, tier-colored slots; [`system.css`](../styles/system.css) lays out up to 12 columns. | Partial | P1 | B2/B9: implemented and tested; live visual check pending. |
| HP-06 | Clicking a slot fills to it; clicking the current top slot removes one. | [`hbslots.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/hbslots.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`applications/actor-sheet-base.mjs`](../module/applications/actor-sheet-base.mjs) | Partial | P1 | B2: custom-slot click logic tested; live interaction check pending. |
| HP-07 | Per-hit damage applies DR, loses whole Con-Mod chunks, and shrugs the remainder. | [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | No change. |
| HP-08 | HP edits and HP-based healing use chunk rules; slot healing restores whole slots directly. | [`healthbar.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/healthbar.test.js) | [`rules/health.mjs`](../module/rules/health.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) use the derived custom maximum. | Partial | P1 | B2: custom maximum tested; live token and healing checks pending. |
| HP-09 | A Crawler at zero slots is Dying; a Mob at zero is dead. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`mob.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/mob.test.js) | Mob sheet shows Dead at zero; Crawler sheet shows Dying. | Partial | P2 | B6/B9: implementation complete; live presentation check pending. |

## 4. Modifiers, buffs, and effects

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| MOD-01 | Modifier values support flat numbers, percentages, and roll-time dice such as `+1d4`. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/engine.mjs`](../module/rules/engine.mjs) parses dice; [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) retains them, and [`rules/derive.mjs`](../module/rules/derive.mjs) uses them for Crawler Evade and Attack damage. | Partial | P0 | B1/B4: implemented and tested for current roll paths; live Evade and damage checks remain. |
| MOD-02 | Field targets include stats, DR, Evade, Move, Step, and Mana using current snake_case vocabulary. | [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js), [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`config.mjs`](../module/config.mjs), [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) | Aligned | - | Preserve vocabulary. |
| MOD-03 | A modifier may target one specific attack/skill row without relying on a mutable name. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) resolves `item-id:<ID>:<aspect>` to one owned Attack, Skill, or Spell; [`effect-sheet.mjs`](../module/applications/effect-sheet.mjs) provides an owned-item chooser. Legacy name targets still match all same-named items; missing or illegal targets are unresolved. | Partial | P0 | B1/B5: implemented and tested; live Foundry authoring and persistence checks pending. B8 must remap actor-scoped IDs during content conversion/copy. |
| MOD-04 | Group targets support attacks/skills, equality/inequality filters, and current aspect names. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) resolves filtered groups and preserves ordinary `=` in predicate values; its colon-delimited grammar still limits free-text values. | Partial | P1 | Deferred by user: handle and test free-text values containing `:` and operator-like text when needed. |
| MOD-05 | Damage modifiers are flat or dice only; percentages do not apply to a damage expression. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs) retains signed damage dice and reports percent damage as unresolved; derivation, direct rolls, and crew cards use the dice. | Partial | P0 | B4/B5: implemented and tested; live damage roll/card check remains. |
| MOD-06 | Inventory items are active when worn or explicitly Active; skills/spells and buffs use enable toggles. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | [`rules/inventory.mjs`](../module/rules/inventory.mjs), transferred effects, actor buffs | Aligned | - | Preserve. |
| MOD-07 | Buffs/Debuffs support both numeric modifier sources and status-only rows with descriptions. | [`_buffs.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_buffs.pug) | Actor Active Effects may have DCC changes or no changes; [`buff-list.hbs`](../templates/actor/partials/buff-list.hbs) | Native equivalent | P2 | B5/B9: verify status-only creation/editing and description display live. |
| MOD-08 | Unresolved targets are visible and do not silently apply. | [`modifiers.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/modifiers.test.js) | [`rules/modifiers.mjs`](../module/rules/modifiers.mjs), [`unresolved.hbs`](../templates/actor/partials/unresolved.hbs) report missing IDs and illegal aspects using the existing unresolved reasons. | Aligned | - | Live Foundry warning check pending. |

## 5. Skills, spells, and advancement

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| SKL-01 | Check types are Opposed (default), Unopposed, Evade, and Passive; Generic is not offered. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`_skills.pug`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/sections/_skills.pug), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/engine.test.js) | [`config.mjs`](../module/config.mjs), [`data/item/skill.mjs`](../module/data/item/skill.mjs), and the actor/item skill controls use the four current check types with Opposed as the default. | Aligned | - | Completed 2026-11-09. |
| SKL-02 | Opposed checks may name the opposing stat and display `<STAT>-Opposed`. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/javascript/_spells.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`data/item/skill.mjs`](../module/data/item/skill.mjs) and the item sheet allow editing the opposing stat for Opposed checks; actor rows and chat display the abbreviated stat with the type. | Aligned | - | Live Foundry display check pending. |
| SKL-03 | Passive non-spells have no d20, no Stat contribution, no Used mark UI, and post their description card. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs), actor/item sheets, advancement, and crew quick-use share the Passive check-type behavior. | Aligned | - | Completed 2026-11-09. |
| SKL-04 | Passive spells still cast/spend mana but post no d20. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`documents/actor.mjs`](../module/documents/actor.mjs) uses the normal mana/auto-enable cast plan and posts a roll-less card for Passive spells. | Aligned | - | Completed 2026-11-09. |
| SKL-05 | Skills and spells carry Range, Cooldown, Limitations, and Notes & Upgrades; spells additionally carry Duration and Mana Cost. | [`_skills.pug`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/sections/_skills.pug), [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/skills.test.js) | Skill/Spell models and item sheets carry the authored fields; actor rows summarize Range/Cooldown, spell Mana/Duration, and Notes & Upgrades; spell cards include populated Duration/Cooldown. | Aligned | - | Completed 2026-11-09. Range/Notes chat visibility remains tracked by ATK-10. |
| SKL-06 | A spell behaves as a skill plus spell fields, regardless of platform storage shape. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md) | [`data/item/spell.mjs`](../module/data/item/spell.mjs) extends SkillModel. | Native equivalent | - | Separate Foundry Item type is acceptable. |
| SKL-07 | Casting spends affordable mana, preserves remaining mana when unaffordable, posts an insufficient notice, and may auto-enable modifiers. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`rules/combat.mjs`](../module/rules/combat.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) cover the cast plan, including Passive spells and chat extras. | Aligned | - | Preserve; live chat-extra checks are tracked in ATK-10. |
| SKL-08 | Used is manual in the current Roll20 contract; rolling/casting/attacking does not change it. | [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | Foundry roll paths do not set `system.mark`. | Aligned | - | Keep manual unless the Roll20 contract changes. |
| SKL-09 | Skill bonus is Stat Mod + effective Rank; Passive non-spell bonus is Rank only. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/engine.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) uses effective Rank only for Passive skills and spells. | Aligned | - | Completed 2026-11-09. |
| SKL-10 | Rank caps at 15 on Floors 1-5 and 20 on Floor 6+. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skills.test.js) | [`rules/advancement.mjs`](../module/rules/advancement.mjs) | Aligned | - | Preserve. |
| SKL-11 | Manual advancement succeeds when d20 is greater than or equal to Rank. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/skills.test.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | [`rules/advancement.mjs`](../module/rules/advancement.mjs) shares the `d20 >= Rank` comparison between manual Skill Checks and bulk advancement. | Aligned | - | Completed 2026-11-09. |
| SKL-12 | Skill cards expose the current manual Skill Check action against Rank; Passive skills cannot use it. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/skills.test.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js) | The Skill Check control is intentionally omitted from actor and item sheets; the underlying roll method remains available. Skill/Spell rows show Rank, Type, Roll, Used, and Mods, with hotlist editing on the item sheet. | Divergent | - | User-requested UI; live Foundry layout and interaction check pending. |
| SKL-13 | Current Roll20 bulk End Session/End Floor/Level Up controls remain deferred in the rendered sheet. | [`skills.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/skills.test.js) | The Foundry advancement and GM-screen implementation remains available, but its PC-header controls and indicators are commented out and GM Screen is excluded from the Create Actor type list. | Aligned | - | Keep the underlying extension available without rendering its controls. |
| SKL-14 | Undo snapshots ranks, marks, pending levels, floor, and current floor-end cursor/epoch semantics. | [`gm-advancement.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/gm-advancement.test.js) | [`rules/advancement.mjs`](../module/rules/advancement.mjs), [`documents/actor.mjs`](../module/documents/actor.mjs) | Aligned | - | Preserve; Passive detection follows the current check type. |

## 6. Attacks, rolls, and chat cards

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| ATK-01 | Every offensive action is an Attack record; a granting item/skill/spell links to it rather than embedding its fields. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | Creature, Mob, Vehicle, hotlist, and crew attack paths use canonical [`AttackModel`](../module/data/item/attack.mjs) Items; attack-marked Skills/Spells automatically create a linked Attack when owned or dropped, while Weapon remains inventory-only. | Aligned | - | Completed 2026-11-09. |
| ATK-02 | Linked chains are stable, bidirectional, stale-tolerant, and cascade deletion across item -> spell/skill -> attack. | [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | [`item-links.mjs`](../module/rules/item-links.mjs) uses stable owned Item IDs, validates/repairs bidirectional links, tolerates stale/asymmetric references, and walks mutually linked chains for guarded cascade deletion in [`item.mjs`](../module/documents/item.mjs). | Aligned | - | Preserve while wiring compound drops and generated Attacks. |
| ATK-03 | Linked rows keep independent names; granting skill Rank flows one way to the linked attack. | [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | Attack/source names remain independent; stable Item links supply the linked Skill/Spell effective Rank without mutable-name resolution. | Aligned | - | Completed 2026-11-09. |
| ATK-04 | Attacks may select a primary skill and alternate skill uses; missing/ambiguous names are visible. | [`skilluse.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/skilluse.test.js) | Canonical Attacks store a stable-ID primary Skill/Spell plus alternate uses with label, Skill/Spell ID, optional ability override, and optional Range. Alternate rows inherit Attack damage and modifiers; missing IDs remain visible and roll at Rank 0, while stable IDs eliminate name ambiguity. | Native equivalent | - | Completed 2026-11-09. |
| ATK-05 | PC To-Hit is Stat Mod + linked/effective Rank + modifiers. | [`attacks.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attacks.test.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) resolves linked effective Rank by stable Item ID before applying Attack modifiers. | Aligned | - | Completed 2026-11-09. |
| ATK-06 | To-Hit and Damage are separate rolls; a spell's linked attack To-Hit invokes the same cast path as the spell. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js), [`linkage.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/linkage.test.js) | [`DCCActor.rollAttack`](../module/documents/actor.mjs) keeps separate rolls and routes a Spell-linked Attack's To-Hit through `castSpell`. | Aligned | - | Completed 2026-11-09. |
| ATK-07 | Damage supports die + flat modifier + roll-time modifier dice + free-text damage type. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/javascript/_spells.js), [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/attackfields.test.js) | Canonical Attacks store die/flat/free-text type; [`modifiers.mjs`](../module/rules/modifiers.mjs) preserves signed dice modifiers for derivation, labels, crew caches, and damage rolls. | Aligned | - | Completed 2026-11-09. |
| ATK-08 | Zero flat damage is omitted from the label; a blank die and zero flat label as No Damage. | [`attacks.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attacks.test.js) | A blank or sentinel die without flat or dice damage derives No Damage for Crawlers, Mobs, and Vehicles. Primary and alternate rows show plain No Damage text; damage modifiers remain rollable. | Partial | P1 | Live Foundry display check pending. |
| ATK-09 | Attacks have free-text Range and Notes & Effects. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`AttackModel`](../module/data/item/attack.mjs) stores Range and the shared HTML description is labeled Notes & Effects on its item sheet. Mob attack rows show the notes as escaped plain text beneath the attack. | Partial | P1 | Live Foundry Mob attack display needs a smoke test. |
| ATK-10 | Settings control whether attack/spell Range and Notes appear in chat; Duration/Cooldown appear when set. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js) | PC, Mob and Vehicle sheet settings apply to Attack, Spell, hotlist and crew rolls. Spell text falls back to its linked Attack; Duration/Cooldown are independent. | Partial | P1 | B2/B4: implemented and tested; live Foundry settings and cards need a smoke test. |
| ATK-11 | Chat text from editable descriptions/range/notes is sanitized and line-safe. | [`_spells.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_spells.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`rules/card.mjs`](../module/rules/card.mjs) converts authored HTML notes to plain text, flattens extra-field line breaks and neutralizes inline rolls; the chat template escapes all fields. | Partial | P1 | B4: automated tests cover the new card fields; live Foundry rendering needs a smoke test. |
| ATK-12 | Crit/fumble presentation and natural-d20 extraction work for normal rolls; utility rolls suppress badges. | [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/__tests__/spells.test.js), [`rolltemplate/_index.pug`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/source/rolltemplate/_index.pug) | Foundry cards retain crit/fumble badges and number colors; headers are always black except for damage-only cards, which are red. Utility rolls suppress crit/fumble badges. | Divergent | - | User-requested black fumble header; live Foundry appearance check pending. |
| ATK-13 | Rank bonus-damage die remains unsourced and is not invented. | [`attacks.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attacks.test.js) | [`rules/combat.mjs`](../module/rules/combat.mjs) deliberately omits it. | Aligned | - | Keep out of scope until sourced. |

## 7. Inventory, gear, buffs, and hotlist

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| INV-01 | Inventory is the canonical item store; gear slots and accessories are derived views. | [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug), [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | Owned Items plus [`rules/inventory.mjs`](../module/rules/inventory.mjs); the Crawler inventory's Add Item button offers Gear or Weapon and creates the selected Item type. | Native equivalent | - | Preserve. |
| INV-02 | Gear slots are Head, Torso, Arms, Hands, Legs, Feet; Pack is unequipped. | [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug) | [`config.mjs`](../module/config.mjs), [`templates/actor/pc/inventory.hbs`](../templates/actor/pc/inventory.hbs) | Aligned | - | No change. |
| INV-03 | Accessories list active accessory items and caps display at 10. | [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | [`rules/inventory.mjs`](../module/rules/inventory.mjs) | Aligned | - | No change. |
| INV-04 | Hotlist accepts items, skills/spells, and attacks, caps at 10, and dispatches the correct action/card. | [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js), [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`applications/sheet-rows.mjs`](../module/applications/sheet-rows.mjs) groups canonical Attacks after inventory/skills/spells; [`documents/actor.mjs`](../module/documents/actor.mjs) dispatches each type to its current action/card. | Aligned | - | Completed 2026-11-09. |
| INV-05 | Hotlist placement is stable: removals leave gaps and new entries fill the lowest gap. | [`inventory.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/inventory.test.js) | Foundry derives hotlist cells from current item order; no persistent slot ownership exists. | Divergent | P2 | B5: decide whether exact stable-cell behavior is required in Foundry, then implement or document native ordering. |
| INV-06 | Hotlisted plain items post sanitized description cards. | [`spells.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/spells.test.js) | [`documents/actor.mjs`](../module/documents/actor.mjs), [`rules/card.mjs`](../module/rules/card.mjs) | Aligned | - | Preserve. |
| INV-07 | Item, skill, and buff descriptions remain visible in collapsed summaries when populated. | [`collapse-ui.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/collapse-ui.test.js), [`_inventory.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_inventory.pug) | Foundry uses item sheets/list rows rather than equivalent collapsible cards. | Partial | P2 | B5/B9: define Foundry-native summary affordance. |
| INV-08 | Duplicate gear-slot occupancy is visible to the user. | Current Foundry UI requirement; Roll20 shows one derived occupant. | [`templates/actor/pc/inventory.hbs`](../templates/actor/pc/inventory.hbs) flags slot conflicts. | Foundry extension | - | Preserve. |

## 8. Mob rules and UI

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| MOB-01 | Mob attack To-Hit is editable `to_hit_base` + attack modifiers + Floor; blank seeds once from 10 + Stat Mod + Rank; zero is valid. | [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js), [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | [`data/item/attack.mjs`](../module/data/item/attack.mjs) seeds the base on Mob Attack/Actor creation; [`rules/derive.mjs`](../module/rules/derive.mjs) applies attack modifiers to the portion above 10 and adds Floor. | Partial | P0 | B6: implemented and tested; live Foundry checks pending. B8: handle fixed final targets on crawler-snapshot drops. |
| MOB-02 | Mob attack To-Hit may be `None`; modifiers do not resurrect it. | [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | Each Attack has a separate No Mob To-Hit flag; the list displays None and Mob crew cards omit the target. | Partial | P0 | B6: implemented and tested; live Foundry check pending. |
| MOB-03 | Mob attacks may explicitly be No Damage; blank or sentinel die with zero flat and no dice modifiers also derives no damage. | [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) derives No Damage; the Mob Attack editor, primary and alternate rows, direct rolls, and crew cards honor it. | Partial | P0 | B1/B6: implemented and tested; live Foundry check pending. B8: initialize the flag for content drops. |
| MOB-04 | Mob Evade is an editable base + Floor; blank defaults to 10 and zero is valid. | [`mob.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/mob.test.js), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) applies Evade modifiers to the editable Mob base, then adds Floor. | Partial | P0 | B6: implemented and tested; live Foundry check pending. |
| MOB-05 | Mob Surprise is editable base + Floor; blank defaults to 10 and zero is valid. | [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | [`data/actor/mob.mjs`](../module/data/actor/mob.mjs) stores the Surprise base; [`rules/derive.mjs`](../module/rules/derive.mjs) adds Floor. | Partial | P0 | B6: implemented and tested; live Foundry check pending. |
| MOB-06 | Mob Move total is effective Move + effective Step. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`engine.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/engine.test.js) | [`rules/derive.mjs`](../module/rules/derive.mjs) combines both effective movement values for the Mob strip. | Partial | P1 | B6: implemented and tested; live Foundry check pending. |
| MOB-07 | Mob combat totals remain visible; a pencil/lock reveals editable bases. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`attackfields.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/attackfields.test.js) | [`mob/body.hbs`](../templates/actor/mob/body.hbs) displays a responsive grid of totals and an edit toggle. | Partial | P1 | B6: implemented and tested; live Foundry check pending. |
| MOB-08 | Mob rolls are public by default; a setting optionally whispers them to the GM. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`_engine.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/javascript/_engine.js) | [`data/actor/mob.mjs`](../module/data/actor/mob.mjs) defaults `mobWhisper` off; [`rules/engine.mjs`](../module/rules/engine.mjs) applies it to card and crew privacy while preserving selected private roll modes. | Partial | P0 | B1/B6: implemented and tested; live multi-user card, crew, and settings checks pending. |
| MOB-09 | Mob mana appears only when the Mob has at least one spell; a dropped Mob initializes current/max mana from Enhanced Intelligence once. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js) | Mobs have a manual mana pool, displayed when they own a spell and spent on casts. | Partial | P0 | B6: live check pending. B8: initialize mana when converting/dropping crawler snapshots; no equivalent drop pipeline exists yet. |
| MOB-10 | Inventory, Buffs, and Skills/Spells are optional Mob sections, enabled by content drops without disabling user choices. | [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug), [`compendium-npc.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium-npc.test.js) | Mob settings default the three sections off; [`mob/body.hbs`](../templates/actor/mob/body.hbs) renders each when enabled without changing items or effects. | Partial | P1 | B1/B6: toggles implemented; live check pending. B8: enable sections for appropriate content drops. |
| MOB-11 | Mob combat is asymmetric: crawlers roll d20s; Mob attacks roll damage only and show static targets. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md) | [`templates/actor/partials/attack-list.hbs`](../templates/actor/partials/attack-list.hbs) displays per-Attack static targets and damage actions, or No Damage text. | Partial | P0 | B6: live check pending. |

## 9. Vehicle, Mount, and crew

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| VEH-01 | Vehicle/Mount Size 1-8 controls Health Bar slots; blank defaults to Medium/4. | [`_vehicle.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_vehicle.pug), [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | [`data/actor/vehicle.mjs`](../module/data/actor/vehicle.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | Preserve. |
| VEH-02 | Vehicle Con Mod defaults to 5 but may be explicitly 0. | [`_vehicle.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_vehicle.pug), [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | Vehicle and Mount schema and sheet accept zero; HP becomes 0 and damage cannot remove slots, matching Roll20's zero guard. Direct slot edits remain available. | Verify live | P1 | B1/B7: verify entering, saving and clearing zero in Foundry. |
| VEH-03 | Speed derives Move, Cruise, and attack penalty; Mount Step is 10. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md), [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | [`rules/vehicle.mjs`](../module/rules/vehicle.mjs), [`rules/derive.mjs`](../module/rules/derive.mjs) | Aligned | - | Preserve. |
| VEH-04 | Driving, Ram/Trample, Race/Chase, Advantage/Disadvantage, and aftermath workflows use current formulas. | [`vehicle.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/vehicle.test.js) | [`rules/vehicle.mjs`](../module/rules/vehicle.mjs), [`documents/vehicle-rolls.mjs`](../module/documents/vehicle-rolls.mjs) | Aligned | Verify live | B7/B9: run focused regression plus live cards. |
| VEH-05 | Crew roles are exclusive for Driver/Rider and Gunner 1-4; passengers are unrestricted. | [`crew.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crew.test.js) | [`rules/crew.mjs`](../module/rules/crew.mjs), [`data/actor/vehicle.mjs`](../module/data/actor/vehicle.mjs) | Native equivalent | - | Preserve UUID-based links. |
| VEH-06 | Crew values are live, permissions-aware, and missing crew remain removable. | [`crew.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crew.test.js) | [`applications/sheet-rows.mjs`](../module/applications/sheet-rows.mjs), [`applications/vehicle-sheet.mjs`](../module/applications/vehicle-sheet.mjs) | Native equivalent | Verify live | B7/B9: validate permission tiers with multiple users. |
| VEH-07 | Driver skill fallback, aboard penalties, Mob static targets, driver Disadvantage, and vehicle gunner rolls use current formulas. | [`crewrolls.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crewrolls.test.js) | [`rules/crew.mjs`](../module/rules/crew.mjs), [`documents/vehicle-rolls.mjs`](../module/documents/vehicle-rolls.mjs), and tests cover revised check types, canonical Attacks, Mob privacy, and the crew formulas. | Partial | P1 | B7: implemented and tested; live crew, privacy, and permission checks remain. |
| VEH-08 | Vehicle and crew attack cards honor current attack dice, Range, Notes, and chat-extra settings. | [`crewrolls.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/crewrolls.test.js) | [`documents/vehicle-rolls.mjs`](../module/documents/vehicle-rolls.mjs) applies chat extras to vehicle and crew attacks; [`rules/crew.mjs`](../module/rules/crew.mjs) carries derived damage dice and Mob No Damage. | Partial | P1 | B4/B7: implemented and tested; live vehicle and crew card checks remain. |
| VEH-09 | Crew connections use stable Foundry world Actor UUIDs rather than Roll20 name probes/pushed caches. | [`CONTEXT.md`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/character-sheet/CONTEXT.md) | [`data/actor/vehicle.mjs`](../module/data/actor/vehicle.mjs), [`applications/vehicle-sheet.mjs`](../module/applications/vehicle-sheet.mjs) | Native equivalent | - | Preserve. |

## 11. Compendium and content drops

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| CMP-01 | Skills and spells import all current authored fields, check types, opposed stat, modifiers, and optional linked attacks. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`templates/skills.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/skills.json), [`templates/spells.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/spells.json) | Foundry accepts ordinary Item drops but has no conversion/compound-drop layer. | Missing | P1 | B8 after B1-B4 schemas stabilize. |
| CMP-02 | Gear imports quantity/slot/active/accessory/hotlist, modifiers, linked skill/spell/attack chains, and descriptions. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`templates/gear.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/gear.json) | Core Item drop creates only the dropped Item. | Missing | P1 | B8: publish complete Foundry Items or implement atomic compound creation. |
| CMP-03 | Data-choice gear prompts for valid options, queues choices, shows slot conflicts, revalidates, and creates nothing on cancel. | [`dropchoice.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/dropchoice.test.js) | No choice workflow exists. | Missing | P2 | B8: implement a Foundry dialog only for content that still requires runtime choices. |
| CMP-04 | Race/Class drops update identity and replace/grant their sourced buffs and skills without duplicating unrelated content. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`templates/races.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/races.json), [`templates/classes.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/classes.json) | No compound Race/Class drop workflow exists. | Missing | P2 | B8: decide whether these become Items, Advancements, or a dedicated drop service. |
| CMP-05 | Character drops create/fill a Mob with stats, attacks, skills/spells, gear, buffs, notes, token defaults, full health, and initialized mana. | [`compendium-npc.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium-npc.test.js), [`templates/characters.json`](https://github.com/nextabletop/dungeon-crawler-carl/blob/main/compendium/core-rulebook/templates/characters.json) | Numbered Mob sizes in Descriptors set prototype and newly dropped token dimensions using the Roll20 size map; no Mob import/drop workflow exists in the system. | Partial | P1 | Token sizing: live Foundry check pending. B8: prefer prebuilt Foundry Actor compendium entries; add conversion only if source JSON remains canonical. |
| CMP-06 | Content import rejects ambiguous references instead of silently linking the wrong row/document. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js), [`dropchoice.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/dropchoice.test.js) | Ordinary Foundry document drops avoid name resolution, but compound relationships are not implemented. | Partial | P1 | B8: resolve links by source IDs/UUIDs and fail atomically with a notification. |
| CMP-07 | Vehicle sheets reject incompatible Roll20 page drops; Foundry sheets accept only owned Item types appropriate to the actor. | [`compendium.test.js`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/__tests__/compendium.test.js) | [`applications/actor-sheet-base.mjs`](../module/applications/actor-sheet-base.mjs) validates owned Item types. | Native equivalent | - | Extend validation for the revised Attack/link types. |

## 12. UI, accessibility, and Foundry integration

| ID | Contract | Roll20 evidence | Foundry evidence | Status | Priority | Batch / next action |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | Crawler layout retains recognizable header, abilities, vitals, combat, inventory, skills, bio, and hotlist organization. | [`DungeonCrawlerCarl.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/DungeonCrawlerCarl.pug) | [`applications/pc-sheet.mjs`](../module/applications/pc-sheet.mjs), [`templates/actor/pc/`](../templates/actor/pc/); the header follows the paper sheet's field order without a type badge, using Mob-style labels and centered Level and Floor. Individually bordered ability cards use centered full-name roll buttons, an enhanced/base score row with an owner-only edit toggle, and a labeled modifier below; the taller default window accommodates the abilities, with scrolling available at smaller sizes. Current Mana has an input underline and sheet accents use Roll20 red. Combat and Attacks have separate bordered sections with matching backgrounds; Combat has Evade above Damage Resistance, Move and Step above AI Favor and Size, and Mana in a third column, with an owner-only edit toggle and borderless Buffs values. Action buttons and health slots use black borders; roll, ability, and add buttons share the stat-block hover fills. | Partial | P2 | Live Foundry layout and edit-mode verification remains. |
| UI-02 | Mob is a condensed stat-block workflow with current combat strip, optional sections, and Notes & Debuffs. | [`_combat.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/sections/_combat.pug), [`_settings.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_settings.pug) | Mob sheets use a single-column layout and optional sections; Combat and the evenly spaced five-column Abilities grid scroll horizontally when needed. The header places Floor beside Name and an italic Descriptors field across the full second row. UI typography uses a readable sans-serif font, uppercase section headings and consistent title-case labels; Notes use the Attack description size even when pasted text specifies a different size, without changing stored formatting. Roll and add-button hovers follow Roll20's colored fills. Ability labels roll checks; enhanced scores and modifiers appear below, with editable bases and net buffs in edit mode. Numbered size in Descriptors controls newly dropped token dimensions; the stored Size field is retained but not transferred. | Partial | P1 | B6: live layout and token-size checks pending. |
| UI-03 | Vehicle/Mount presents current formulas, rules chips, actions, attacks, crew, and Notes & Debuffs. | [`_vehicle.pug`](https://github.com/nextabletop/dungeon-crawler-carl/tree/main/character-sheet/source/views/_vehicle.pug) | [`templates/actor/vehicle/`](../templates/actor/vehicle/), [`applications/vehicle-sheet.mjs`](../module/applications/vehicle-sheet.mjs); the header Floor is centered, and list headings are centered across Crawler, Mob, and Vehicle sheets while add controls remain on the right. | Partial | P2 | B7/B9 after shared attack changes. |
| UI-04 | Editable controls have visible labels/accessible names; icon-only actions have tooltips and aria labels. | Roll20 Pug components and accessibility tests | Foundry templates generally use labels, tooltips, and aria labels. | Partial | P2 | B9: audit every newly changed template and keyboard path. |
| UI-05 | Read-only users may inspect allowed documents and use permitted rolls, while write actions remain disabled. | Foundry-specific workflow | [`actor-sheet-base.mjs`](../module/applications/actor-sheet-base.mjs), crew and GM-screen sheets | Foundry extension | Verify live | B9: multi-user permission smoke test. |
| UI-06 | Initiative uses `1d20 + Dex Mod` for creatures; vehicle/GM behavior remains the documented Foundry assumption. | No Roll20 initiative contract. | [`index.mjs`](../index.mjs) | Foundry extension | P3 | Preserve unless rules provide a sourced formula. |
| UI-07 | Foundry system schema, templates, localization, and tests stay synchronized. | N/A | [`system.json`](../system.json), [`lang/en.json`](../lang/en.json), [`test/`](../test/) | Partial | P1 | Every implementation batch updates all four surfaces together. |
| UI-08 | Full automated tests pass, followed by live Foundry smoke tests for persistence, drag/drop, rolls, permissions, and layout. | Roll20 suite is the behavioral oracle. | [`package.json`](../package.json), [`test/`](../test/) | Verify live | P1 | Run focused tests per batch; full suite and live matrix in B9. |

## Next implementation task

**VEH-02: Vehicle Constitution Modifier zero (P1).** Implementation and automated coverage are complete; live Foundry verification remains.

Live checks for MOD-03 and completed Mob, combat, and crew work can run independently. B8 content conversion must remap stable modifier target IDs.

## Skipped for now

- **MOD-04: Group-target delimiter edge cases.** Deferred by user; no damage types containing `:`, `!=`, or `=` were found in the compendium JSON. Revisit support for free-text predicate values containing delimiters when needed.

## Recommended execution order

1. **B1 - Schema and vocabulary**
   - ~~Check types and opposed stat~~
   - ~~Skill/spell metadata~~
   - ~~Attack/link fields and free-text damage type~~
   - ~~Mob bases, optional states, and manual mana~~ — live checks and B8 initialization pending
   - ~~Mob optional section visibility controls~~ — live Foundry check and content-drop enablement pending
   - ~~Mob privacy setting~~ — live Foundry settings check pending
   - ~~Custom Health Bar count~~ — live Foundry settings check pending
   - ~~Vehicle Con Mod zero~~ — live Foundry persistence check pending

2. **B2 - Core calculations and resources**
   - ~~Crawler Evade implementation~~ — live Foundry smoke test pending
   - ~~Move/Step defaults and base-editing UI~~ — live Foundry verification remains
   - ~~Variable Health Bar derivation and view~~ — live Foundry interaction and visual checks pending
   - ~~Mob privacy plumbing~~ — live Foundry multi-user check pending
   - ~~Chat-extra settings implementation~~ — live Foundry smoke test pending

3. **~~B3 - Skills, spells, and advancement~~**
   - ~~Four check types and opposed labels~~
   - ~~Passive skill/spell behavior~~
   - ~~New authored fields~~
   - ~~Advancement `>= Rank`~~
   - ~~Manual Skill Check action~~

4. **B4 - Attacks and chat**
   - ~~Stable linked Attack architecture~~
   - ~~Skill/alternate-skill resolution~~
   - ~~Dice modifiers and free-text damage type~~
   - ~~Range/notes/duration/cooldown card implementation~~ — live Foundry smoke test pending
   - ~~Passive and insufficient-mana cards~~

5. **B5 - Inventory, modifiers, buffs, and hotlist**
   - ~~Stable ID modifier targets~~ — live Foundry check and B8 ID remapping pending
   - Group-target edge cases — deferred; see Skipped for now
   - ~~Hotlist dispatch after Attack changes~~ — stable slot placement remains
   - Status-only effects and collapsed summaries

6. **B6 - Mob**
   - ~~Attack static-target math and To-Hit None~~ — live Foundry check and B8 snapshot handling pending
   - ~~No Damage~~ — live Foundry check and B8 content-drop initialization pending
   - ~~Combat edit strip, Surprise/Evade bases, and combined Move~~ — live Foundry check pending
   - ~~Conditional manual mana and optional sections~~ — live Foundry check and B8 drop initialization pending
   - ~~Numbered Descriptor token sizing~~ — live Foundry drop check pending; existing placed tokens are unchanged

7. **B7 - Vehicle/Mount and crew**
   - ~~Reconcile revised skills, attacks, privacy, and chat extras~~ — live vehicle/crew card checks pending
   - ~~Allow Con Mod zero~~ — live Foundry persistence check pending
   - Live permission checks

8. **B8 - Compendium/content**
   - Generate or convert complete Foundry Items and Actors only after schemas are stable
   - Add compound/choice services only where prebuilt documents cannot express the workflow

9. **B9 - UI and regression**
   - Visual alignment
   - Accessibility
   - Localization completeness
   - ~~Full Vitest suite for current changes~~ — rerun for final regression
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
