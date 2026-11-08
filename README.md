# Dungeon Crawler Carl — Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear.

## Install (development)

The Foundry data directory is `F:\FoundryData-Dev`. The system folder there is a **directory junction** to this repo's `foundry/` folder, so edits here are live on the server:

```powershell
New-Item -ItemType Junction `
  -Path   'F:\FoundryData-Dev\Data\systems\dungeon-crawler-carl' `
  -Target 'E:\Git\NexTableTop\DungeonCrawlerCarl\foundry'
```

Live testing only works from the main checkout, because the junction points there. Edits in a git worktree never reach the server.

## Dev server

```powershell
node "F:\Program Files\Foundry Virtual Tabletop\resources\app\main.mjs" --dataPath="F:\FoundryData-Dev" --port=30001
```

Then open http://localhost:30001 and launch the `dcc-testing` world.

Hot reload is **off** (`options.json` has `"hotReload": false`), so reload the browser after every change to JS, templates, CSS or `lang/en.json`.

## Tests

```powershell
npm --prefix foundry install   # once
npm --prefix foundry test      # vitest run
```

The rules in `module/rules/` are pure (no Foundry globals) and are tested directly. Data models and documents run against `test/setup/foundry-mock.mjs`. The Roll20 tests in `../character-sheet/__tests__/` are the oracle for ported behaviour.

## Naming

- Identifiers follow ADR-0013 (`character-sheet/docs/adr/0013-attribute-naming-convention.md` on the R20 branch): words are spelled out (`healthBar`, `healthPoints`, `damageResistance`, `stats.<stat>.modifier`, `quantity`, `toHit`). Foundry writes them in camelCase for schema paths, JS names and `data-action` names (lang key segments are PascalCase, e.g. `Vehicle.DamageResistanceAbsorbed`), so macros read `@healthPoints.value` or `@stats.dexterity.modifier`. The `@str` … `@cha` roll shortcuts stay short.
- Modifier target strings are R20's snake_case values exactly (`damage_resistance`, `to_hit`, `mana_cost`, `damage_type`); see below.
- CSS class names are kept as they were (`.dcc-hb`, `.dcc-hp`, `.dcc-hot-*`, `.dcc-acc*`, …), except `.qty`, which became `.quantity` as in R20. `.dcc-adv*` also became `.dcc-advancement*`, so that `adv` in a class name never has to mean both advancement and advantage.
- UI label text stays abbreviated ("HP", "DR", "Con Mod", "Qty"); the key still spells the name out (`Inventory.Quantity` = "Qty"). The `Short` suffix marks an abbreviated label for a concept that also has a long label elsewhere (`Defense.DamageResistance` = "Damage Resistance" vs `Defense.DamageResistanceShort` / `Crew.DamageResistanceShort` = "DR"; also `Health.HealthPointsShort`, `Crew.HealthBarShort`).

## Modifiers: the "DCC Modifier" effect type

Modifiers are ActiveEffects whose changes use the custom change type **DCC Modifier** (`type: 'dcc'`). A new change on a DCC effect defaults to it. A change's **key** is the target and its **value** is the amount. The change must use the **initial** phase; a final-phase `dcc` change is ignored, with a console warning.

Where to add them:

- On an **item**: the item sheet's Effects section, **+ Modifier**. This creates a transferred effect. It applies only while the item is live:
  - weapon or gear: in a gear slot, or flagged Active;
  - skill or spell: its **Enabled** toggle is on. It is off by default, as in R20. Casting a spell turns it on when "Auto-enable skill modifiers on cast" is ticked in the Crawler's **Configure Sheet** dialog, which is the default.
- On a **Crawler or Mob** itself: **+ Buff** in the buff list. Buffs can be toggled on and off.

### Value

| Value         | Meaning     |
| ------------- | ----------- |
| `2`, `-1`     | flat amount |
| `10%`, `-25%` | percent     |

Anything that doesn't parse counts as 0, and keeps its kind: `abc%` is 0 %.

Flat and percent amounts combine as `floor((base + flat) * (1 + percent / 100))`.

### Key (target)

Every part of a key is **case-insensitive**, including the `item:` and `group:` prefixes (`Item:`, `GROUP:` work). The one exception is an item's name: it is kept as typed, and it still matches item names case-insensitively.

**1. A field**, as a bare word:

`strength`, `intelligence`, `constitution`, `dexterity`, `charisma`, `damage_resistance`, `evade`, `move`, `step`, `mana`

| Field               | Effect                                        |
| ------------------- | --------------------------------------------- |
| a stat              | the Enhanced value (and therefore its mod)    |
| `damage_resistance` | armor → DR                                    |
| `evade`             | `10 + Dex mod` → Evade                        |
| `move`, `step`      | move / step                                   |
| `mana`              | Max Mana, from the mana stat's Enhanced value |

On a vehicle, only `damage_resistance` and weapon targets apply.

**2. One item, by name:** `item:<Name>:<aspect>`

- The name may contain colons. Only the final segment is the aspect, as in `item:Sword: of Legends:to_hit`.
- Every owned item with that name gets the bonus.

**3. A group of items:** `group:<attacks|skills>[:<attribute>(=|!=)<value>]:<aspect>`

The sections are:

- `attacks`: weapons and attack-enabled spells;
- `skills`: skills and spells.

Each section has its own predicate attributes:

| Section   | Attributes            |
| --------- | --------------------- |
| `attacks` | `stat`, `damage_type` |
| `skills`  | `stat`, `class`       |

- Values are compared case-insensitively, as whole strings.
- An item that doesn't have the attribute reads as `''`, so `damage_type!=fire` matches a weapon with no damage type.
- A predicate with an **empty value** is dropped, leaving a bare (unfiltered) group. So `group:attacks:stat=:to_hit` behaves like `group:attacks:to_hit`, and the same goes for `!=`. This mirrors the R20 group builder. It applies only to an attribute the section allows; `group:attacks:class=:to_hit` is still an unresolved illegal attribute.
- A predicate with no operator or an empty attribute (`stat`, `=fire`) is a parse error.
- A group that matches no items is fine. It just applies nothing.

Examples: `group:attacks:damage_type=slashing:damage`, `group:skills:class!=bard:mana_cost`, `group:skills:rank`.

**Aspects:**

| Item                                          | Aspects             |
| --------------------------------------------- | ------------------- |
| weapon (and an attack-enabled spell's attack) | `to_hit`, `damage`  |
| skill, spell                                  | `rank`, `mana_cost` |

- A **percent on `damage` is dropped**. Damage takes flat amounts only.
- `rank` feeds the skill bonus. On a weapon linked to a skill, the weapon uses the skill's _base_ rank.

**Unresolved modifiers.** A modifier that targets nothing is listed on the sheet under "⚠ Unresolved modifiers" and is not applied. That covers a parse error, no item with that name, an aspect the item doesn't have, an attribute the section doesn't have, an unknown section, or a percent on damage.

**Same vocabulary as R20.** Every field, section, attribute and aspect name is the R20 sheet's value exactly (snake_case), so a modifier key reads the same on both platforms. There are no aliases for older spellings (`dr`, `tohit`, `manaCost`, `weapons`, `dmgType`); a key using one shows up as unresolved. The one difference is the shape: the Foundry group key always ends in `:<aspect>`, where R20 picked the aspect in a second select.

## Crew (vehicles and mounts)

**Adding crew**

- Drag a Crawler or Mob **from the Actors sidebar** onto a vehicle sheet. It joins as a Passenger.
- These can't crew: vehicles, unlinked token actors and compendium actors. An actor already aboard isn't added twice.
- Only the vehicle's owner can add crew, remove crew or change roles.

**Roles**

- The role select on each crew row offers Driver (Rider on a mount), Gunner 1–4 and Passenger.
- Driver and each Gunner slot are exclusive. Giving a role to someone else makes its previous holder a Passenger.

**Driving, Ram and Race**

- These checks add the Driver's drive-skill bonus. The drive skill defaults to "Driving" and is matched by name, case-insensitively.
- With no matching skill, the roll uses the Driver's Dex mod and is untrained.
- With no Driver, the bonus is 0 and the card says so.
- A Mob driver's cards follow the Mob's privacy: they are whispered to the GM unless the Mob is public (**Configure Sheet → Rolls are public**).

**Vehicle weapons**

- The **Gunner** column picks the crew slot that fires the weapon.
- The **Skill** column names the gunner's skill that adds to its to-hit.

**Quick rolls from a crew row**

- The skill and attack selects roll that member's skills and attacks from the vehicle, with the aboard penalty.
- The penalty is 0 for the drive skill. Otherwise it's −3 on a mount or −Speed on a vehicle.
- The Driver's attacks roll at Disadvantage.
- Every crew attack card notes that a melee attack adds a Speed die, which you add by hand.
- A Mob crew member posts `target = 10 + bonus + penalty + floor` instead of rolling.

**Who sees what**

- You need **Observer** on a crew member to see its HB and DR and to use its quick rolls.
- With Limited, you see its name only. Below Limited, the row shows "(unknown crew member)".
- A crew member whose actor was deleted shows "(missing)" and can still be removed.

**The Crewing line.** A Crawler's or Mob's header shows a **Crewing** line: a chip for each vehicle it crews, with the role held there. A chip opens that vehicle.

**Observers.** Users who can only observe a sheet can still open item and effect sheets, open crew actors and Crewing vehicles, and use the crew quick-roll selects. Everything that writes stays disabled.

## GM screen

The GM screen gates two things for the Crawlers on its **roster**: **floor ends** and **Level Up**. A Crawler that isn't on the roster behaves as if there were no GM screen.

**Setup**

1. Create an actor of type **GM Screen**. It is created with default **Observer** ownership, so players can see it.
2. In **Game Settings → Configure Settings**, on the system's tab, set **GM Screen** to that actor. Blank turns the integration off. The sheet shows a notice while it isn't the selected screen. Deleting the selected actor clears the setting, but only while an active GM is online; otherwise the stale id stays until a GM clears it, and it gates nobody meanwhile.
3. Drag Crawler actors **from the Actors sidebar** onto the GM screen, which adds them to the roster.
   - Only a GM can do this, and only world Crawler actors can join.
   - Adding a Crawler **baselines** it: its floor-end cursor is set to the current counter, so it starts with no floor ends available.
   - Dropping a Crawler that is already rostered does nothing. Re-baselining it would wipe its stacked floor ends.
   - Changing the setting to another screen re-baselines everyone on that screen's roster.
4. Use a row's remove button to take a Crawler off the roster. That lifts both gates for it.

**Floor ends**

- The GM's **End Floor** raises the screen's counter by one, after a confirm. It works with an empty roster too.
- Each rostered Crawler may run its own End Floor once per unconsumed floor end. Floor ends stack: `available = max(0, counter − that Crawler's cursor)`.
- The Crawler's End Floor tooltip shows how many floor ends are available ("Floor end available (n)"). At 0 the button is disabled and the tooltip says it is waiting for the GM.
- The counter is display-only. It can't be typed over.

**Safehouse**

- While the screen's **Safehouse** box is off, a rostered Crawler can't Level Up.
- While it's on, the Crawler header shows an "In safehouse" badge.
- The safehouse affects nothing else.

**The GM is gated like a player** on a rostered Crawler. There is no bypass; to lift the gates, unroster the Crawler.

**Undo**

- **Undo End Floor** takes the counter back by one.
- It is disabled when:
  - the counter is 0, or
  - any rostered Crawler has already used the latest floor end, or joined since. A cursor ≥ the counter blocks it, and the tooltip names those Crawlers.
- A missing (deleted) roster entry never blocks it.
- A Crawler's own **Undo** reverses its End Floor. That includes giving the floor end back, but only while the screen hasn't re-baselined it since.

## Initiative

`CONFIG.Combat.initiative` is set in `index.mjs`:

```js
{ formula: '1d20 + @stats.dexterity.modifier', decimals: 0 }
```

This is an **assumption**: the R20 sheet has no initiative roll.

- Crawlers and Mobs roll `1d20 + Dex mod`.
- Vehicles and GM screens have no `stats.dexterity`, and Foundry replaces missing roll data with `0` when it parses the formula, so they roll a plain `1d20`.

**GM screen**

- **Unlinked-token Crawlers drift.**
  - The roster link resolves through the _base_ actor.
  - The floor-end cursor is read and written on the actor End Floor runs on. For a sheet opened from an unlinked token, that is the token's synthetic actor.
  - Roster adds and re-baselines write only the base actor.
  - So a Crawler played through an unlinked token can drift from its roster row. **Use linked tokens for Crawlers** (`prototypeToken.actorLink`).

**Cross-client races (accepted, not guarded).**

- Every write is an absolute value, so a repeated click, or two clients doing the same thing, converges.
- Races between _different_ documents are last-write-wins:
  - **GM Undo End Floor vs a Crawler's End Floor.** A Crawler's End Floor on another client can land between the Undo's blocker check and its −1 write, and that floor end is swallowed. Afterwards the GM is warned, with the names of any Crawler now ahead of the counter. The roster also flags a cursor ahead of the counter. Remove and re-add that Crawler to re-baseline it.
  - **Re-baseline vs a Crawler's End Floor.** A re-baseline on a setting change sets cursor = counter. If a Crawler's End Floor lands just before it, the consumed floor end is overwritten. If it lands just after, the cursor passes the counter. Either way the Crawler can see phantom (or lost) floor ends. Its own Undo can't restore the cursor either, because the re-baseline changed the epoch.
  - **Two GMs.**
    - One GM's End Floor and another GM's Undo End Floor race on the counter; the last write wins.
    - Two concurrent roster adds each write a whole roster built from their own cached copy, so one add replaces the other. Both Crawlers are baselined, but only one ends up rostered.
- **Roster add is one request, not a transaction.**
  - The Crawler's baseline and the roster change go out in one `updateDocuments` call.
  - If the Crawler row were skipped while the roster row landed, that Crawler would be linked with a stale cursor.
  - This is unlikely for these plain integer fields, and it is not retried.
