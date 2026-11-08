# GM Screen — Design

**Status:** approved in brainstorming on 2026-09-23. Revised after spec review the same day.
**Platforms and branches:**
- Foundry VTT v14 system: `foundry/`, on branch `feat/foundry-system`.
- Roll20 K-Scaffold sheet: `character-sheet/`, on branch `feat/gm-screen-r20` off `main`.

## Purpose

A GM-owned "GM screen" sheet puts two party-wide progression gates under GM control. Today each Crawler sheet handles them itself.

1. **Floor end.** The GM *unlocks* floor-end progression. Each player still runs their own End Floor. The GM screen never advances a character, which keeps characters in their players' hands.
2. **Safehouse status.** The GM declares whether the party is in a safehouse. This gates Level Up.

Integration is **optional**. A Crawler that isn't linked behaves exactly as it does today.

## Definitions (both platforms)

| Term | Foundry | Roll20 |
|---|---|---|
| **GM screen** | An actor of type `gmscreen`, selected by the world setting `dungeon-crawler-carl.gmScreen` | A character with `mode = 'gmscreen'`, whose id is entered in each Crawler's `gm_screen_id` |
| **Registered** | n/a. Every world `pc` actor can be dropped onto the roster. | A Crawler with `gm_screen_id` set and `mode='pc'` sends `gmRegister` to the screen automatically. The screen lists it under *Registered*. |
| **Roster** | Curated by the GM: `pc` actors dragged onto the screen | Curated by the GM: registered rows with **On roster** ticked |
| **Linked** | The setting resolves to an existing `gmscreen` actor **and** the Crawler's base-actor UUID is on its roster | `gm_screen_id` is non-blank, `mode='pc'`, **and** the latest `gmState` received says `rostered: true` |
| **Failure policy** | Screen missing or deleted → **unlinked** (fail open). The GM deleting the screen or clearing the setting ends the integration. | Screen unreachable (a stale `gm_screen_id`) → the gated actions stay **blocked** (fail closed), with a "GM screen unreachable" note. Roll20 can't tell deleted from unreachable, because a send to a missing character never resolves. The fix is to clear `gm_screen_id`. |

Only `pc` Crawlers link; mobs and vehicles never register or link. **The GM is gated like a player** on a linked Crawler. The GM can unroster the Crawler to lift the gates.

## Shared behaviour

### GM screen contents

- **Roster**, plus *Registered* on Roll20. Each row shows name, floor, pending levels and floor ends still available. Each row has a remove control; on Roll20, the On roster toggle does this.
- **Safehouse** toggle, default off.
- **Floor-end counter** `floorEndSeq`, an integer starting at 0.
- **End Floor** button. It asks for confirmation, listing the roster, then does `floorEndSeq += 1`.
- **Undo End Floor** (−1) button, for an accidental press: `floorEndSeq = max(0, floorEndSeq − 1)`.
  - It is **blocked** when any rostered Crawler has already consumed the latest floor end (its cursor ≥ `floorEndSeq`; on Roll20, the row's `floor_end_done`).
  - In that case a warning names those players. Otherwise their next real floor end would be silently absorbed.

### Floor end (linked Crawlers)

- The Crawler stores `floorEndDone` (Roll20: `gm_floor_done`), a **cursor** into the screen's counter.
- **Floor ends stack:** `available = max(0, floorEndSeq − floorEndDone)`.
- **Baseline on linking.** When a Crawler becomes linked, its cursor is set to the current `floorEndSeq`, so it starts with `available = 0`. This covers joining the roster mid-campaign and re-pointing to a new screen. It also increments `floorEndEpoch` (Roll20: `gm_floor_epoch`). See Undo below.
- **End Floor button:** enabled only when `available > 0`.
  - With `available = 0`, the tooltip reads "Waiting for the GM to end the floor".
  - Otherwise it reads "Floor end available (N)".
- **Pressing End Floor** runs that platform's **existing** End Floor, then sets `floorEndDone += 1`:
  - Foundry: undo snapshot, advancement d20s, floor +1, summary card.
  - Roll20: undo snapshot, advancement, floor +1. Roll20 posts no card today, and that is unchanged.
- **Undo.**
  - The advancement snapshot also **captures** `floorEndDone` and `floorEndEpoch`.
  - Undo restores `floorEndDone` only when the snapshot's epoch equals the **current** epoch.
  - **The epoch itself is never restored.** Restoring it would make old snapshots count as current again. So `restoreUpdates(snap, presentIds, currentEpoch)` takes the current epoch as an argument. Roll20's `undoAdvancement` follows the same rule with `gm_floor_epoch`.
  - This prevents phantom floor ends from a snapshot taken before a re-link.
  - Snapshots without the fields (older entries) skip the restore.
  - Note: End Floor → Undo → End Floor re-rolls advancement. This is existing behaviour, not a regression.
- **Unlinked Crawlers:** End Floor is always available, as today.

### Level Up gate

A pure rule `levelUpBlocker({ pendingLevels, floor, linked, safehouse })` returns the first blocker that applies:

1. `'NoPending'`: `pendingLevels ≤ 0`
2. `'Saferoom'`: `floor < 3`
3. `'Safehouse'`: `linked && !safehouse`. Tooltip: "The GM hasn't declared a safehouse".
4. `null`: allowed

On Foundry this extends the existing function. On Roll20 it's a new pure function in `_skills.pug` that replaces the inline check at `_skills.pug:197`.

### Safehouse badge

Linked Crawlers show an "In safehouse" badge in the header while the safehouse is on. It has no other effect.

### Out of scope (YAGNI)

- The safehouse affects nothing besides Level Up.
- The screen has no authoritative party floor.
- One GM screen per world or game.
- No GM bypass of the gates.
- The screen never rolls or advances for players.

## Foundry design

### Data

- **New actor type `gmscreen`** (in `system.json` documentTypes and `CONFIG.Actor.dataModels`), with `GmScreenModel`:
  - `safehouse`: BooleanField, initial false.
  - `floorEndSeq`: integer, min 0, initial 0.
  - `roster`: ArrayField of `DocumentUUIDField({ type: 'Actor', embedded: false })`, initial `[]`, deduplicated on write.
  - **Default ownership Observer**, so players' clients can read it: `GmScreenModel._preCreate` calls `this.parent.updateSource({ 'ownership.default': CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER })`. Players will see the screen in the actor directory. That's acceptable, because it holds no secrets.
- **`PcModel` additions:** `floorEndDone` and `floorEndEpoch`, both integer, min 0, initial 0.
- **World setting `dungeon-crawler-carl.gmScreen`:**
  - Registered with `scope: 'world'`, `config: true` (only GMs can change world settings) and `requiresReload: false`.
  - Type: `new foundry.data.fields.StringField({ blank: true, choices: () => ({ '': '—', ...Object.fromEntries(game.actors.filter(a => a.type === 'gmscreen').map(a => [a.id, a.name])) }) })`. The choices function is resolved lazily at render time, because actors aren't loaded at `init`. `blank: true` is required, because passing choices otherwise forces `blank: false`.
  - `onChange` re-renders open PC sheets. `onChange` fires on both first create and later updates, whereas an `updateSetting` hook would miss the first set.
  - **On the active GM's client only**, `onChange` also re-baselines every PC on the newly selected screen's roster (`floorEndDone = floorEndSeq`, `floorEndEpoch += 1`). This covers re-pointing to a different screen, and clearing then restoring the setting.
- **Deleting the configured screen.** A `deleteActor` hook on the active GM's client sets the setting to `''`, so the select never holds a dangling id.
- **Pure helper `resolveGmLink({ settingId, actorsById, baseUuid })`** returns `{ screen, linked }`.
  - `baseUuid` is `actor.isToken ? actor.baseActor?.uuid : actor.uuid`, so a sheet opened from an unlinked token resolves to its base actor.
  - A missing screen gives `linked: false` (fail open).

### GM screen sheet (`GmScreenSheet extends DCCActorSheetBase`)

- `ALLOWED_ITEM_TYPES = []`. The sheet doesn't render the base health-bar or defense partials.
- **Roster.** `_onDropActor` accepts a `pc` world actor. On add, the GM's client writes the PC's baseline (`floorEndDone = floorEndSeq`, `floorEndEpoch += 1`) together with the roster update. Other actor types are rejected with a warning. Missing actors show "(missing)" and stay removable.
- **Row values.** Each row shows name, floor, pending levels and `available`. The row builder is a pure function in `sheet-rows.mjs`.
- **Controls:**
  - Safehouse toggle.
  - End Floor: `DialogV2.confirm` listing the roster, then `floorEndSeq + 1`.
  - Undo End Floor: −1.
- Only the GM can edit (Observer players see the sheet read-only).

### Crawler changes

- `advancementView` stays pure. It receives `{ linked, safehouse, available }` from the sheet context, computed via `resolveGmLink`.
- `DCCActor#endFloor`:
  - When linked with `available ≤ 0`, it warns and returns null.
  - Otherwise it runs `#advance`. It passes the new flag `{ consumeFloorEnd: true }` **only when linked**, and the flag writes `floorEndDone + 1` in the same actor update.
  - An unlinked End Floor never touches `floorEndDone`, and End Session never passes the flag.
- `snapshot` and `restoreUpdates` include `floorEndDone` and `floorEndEpoch`, with the epoch-guarded restore described above.
- `levelUp` passes `linked` and `safehouse` to `levelUpBlocker`.
- The header shows the safehouse badge.

### Live updates (no sockets)

- An `updateActor` hook re-renders open PC sheets when the configured screen changes.
- An `updateActor` hook re-renders an open GM screen when a rostered PC changes.
- `deleteActor` and `createActor` hooks re-render PC sheets when a `gmscreen` actor is deleted or created.

### i18n

New keys:
- `DCC.Advance.Blocked.Safehouse`
- `DCC.Advance.FloorWaiting`
- `DCC.Advance.FloorAvailable` (takes `{n}`)
- `DCC.GmScreen.*`: sheet labels, confirm dialog, badge
- `TYPES.Actor.gmscreen`
- The setting's name and hint

## Roll20 design (branch `feat/gm-screen-r20`)

Premise, user-confirmed: a player's sheet can `k.send` to any other sheet, including GM-owned ones.

### Configuration

- **`gm_screen_id`** is a normal editable text input on each Crawler's Settings tab. This is the source of truth.
- `sheet.json` also adds it as a **useroption** (text, default blank), so new characters pick up the GM's game default. Existing characters are set by hand, or through Roll20's default-settings propagation where available.
  - The current autouploader doesn't push `sheet.json`, so testing the useroption needs a manual `sheet.json` upload. The editable input works without it.
- **The screen's own id.** `character_id` isn't rendered in the DOM, so an opener worker on the GM screen copies `character_id` into a visible read-only `gm_self_id`, with a copy hint.
- **New `mode` option `gmscreen`.** It gives a CSS-gated view, like mob and vehicle, containing:
  - Repeating section **`gmregistered`**, one row per registered Crawler. Fields: `char_id`, `name`, `floor`, `pending`, `floor_end_done`, `on_roster` (checkbox), `status` (`live` | `stale`), and a Remove control. Using a repeating section with a per-row toggle avoids Roll20's dynamic select limitation.
  - `safehouse` (checkbox), `floor_end_seq` (display), End Floor, and Undo End Floor.
  - An opener worker writes `safehouse` and `floor_end_seq` if they're unset, so `@{id|attr}` reads never hit a missing attribute.

### Protocol

This reuses the crew-protocol conventions (`_crew.js`): pure payload helpers with unit tests, transport verified live.

| Message | Direction | Payload | Sent when |
|---|---|---|---|
| `gmRegister` | Crawler → screen | `{char_id, name, floor, pending, floor_end_done}` | Crawler open (when `mode==='pc'` and `gm_screen_id` is set); after End Floor, End Session, Level Up or Undo; when `gm_screen_id` changes |
| `gmState` | Screen → Crawler | `{screen_id, rostered, safehouse, floor_end_seq}` | The single reply to `gmRegister`. Also sent to every **on-roster** row when Safehouse or the counter changes, and to a row when its On roster toggles. |

- **Hard rule:** a receive handler never sends, except `gmRegister`'s single `gmState` reply. There are no loops.
- **Screen `gmRegister` handler:**
  - It ignores the message unless its own `mode === 'gmscreen'`, and ignores `char_id === character_id`, so a new GM screen character created in `pc` mode can't register with itself.
  - Otherwise it upserts the `gmregistered` row by `char_id` (new rows have `on_roster` off), sets `status = live`, and replies with `gmState`.
- **Crawler `gmState` handler:**
  - Ignored unless `screen_id === gm_screen_id`.
  - Stores `gm_rostered`, `gm_safehouse` and `gm_floor_seq`.
  - When `gm_rostered` turns false→true, or `screen_id` differs from the stored `gm_linked_screen`: sets the baseline `gm_floor_done = floor_end_seq`, increments `gm_floor_epoch`, and sets `gm_linked_screen = screen_id`.
- **Push path:**
  - Sends are fire-and-forget, never awaited. A send to a dead id never resolves, and it posts one "No character was found" line to the GM's chat.
  - The existing liveness probe (the `vehicleStateChanged` pattern) marks rows `stale`. The GM removes dead rows with Remove.

### Crawler side

- **Linked** means `gm_screen_id` is non-blank, `mode==='pc'`, and `gm_rostered` is true.
- **When `gm_screen_id` changes**, a worker clears `gm_rostered`, `gm_linked_screen` and `gm_floor_busy`. The next `gmState` reply then re-baselines, so a player who clears and re-enters an id can't reclaim floor ends from while they were unlinked.
- **`gm_floor_available`**
  - A worker computes it, triggered on `gm_screen_id`, `gm_rostered` and `mode`, for manual edits and mode changes.
  - K-Scaffold attribute writes are silent and don't fire triggers. So it is also computed **inline** wherever `gm_floor_seq`, `gm_floor_done` or `gm_rostered` is written: the `gmState` handler, the End Floor worker and the Undo worker.
  - It drives CSS-gated state spans on the End Floor button: *waiting*, or *available (N)*. Roll20 `title` text can't bind to an attribute, so the tooltips are spans.
- **End Floor worker (async)**, when linked:
  1. Return immediately if `gm_floor_busy` is already set. The CSS disable alone doesn't stop a second click that read attributes before the first write landed.
  2. Set `gm_floor_busy` and the alternating probe-state attribute, then `attributes.set()`, **before** any `await`.
  3. Re-read the live counter with `pseudoQuery('@{<gm_screen_id>|floor_end_seq}')`. This is pessimistic: advancement runs only when the read resolves and `seq − gm_floor_done > 0`.
  4. If so, run the existing floor-end advancement and `gm_floor_done += 1`. The undo snapshot captures `gm_floor_done` and `gm_floor_epoch`. Then re-register.
  5. **On every resolved path** (advanced or not), clear `gm_floor_busy`, recompute `gm_floor_available` inline, and `attributes.set()` (async K-Scaffold quirk).
  6. If the read never resolves (stale id), the "unreachable" note appears after the CSS delay. `gm_floor_busy` is also cleared on sheet open and whenever `gm_screen_id` changes, so the player can retry once the id is fixed.
- **Level Up worker (async)**, when linked:
  - Before the `await`, write the probe state attribute, alternating two values the way the crew protocol alternates `looking-a` / `looking-b`, so the CSS "unreachable" reveal re-arms each time.
  - Read `pseudoQuery('@{<gm_screen_id>|safehouse}')` and parse it with `markSet`.
  - Apply `levelUpBlocker`.
  - Level Up gets CSS-gated reason spans, which are new on Roll20.
- **Stale or missing screen id:** the gated actions stay blocked, and the note appears after the CSS delay.
- `gm_safehouse` drives the header badge.

## Testing

- **Pure tests:**
  - `levelUpBlocker` for all combinations (both platforms).
  - `floorEndsAvailable(seq, done)`.
  - Baseline and epoch restore.
  - `resolveGmLink` including token base UUIDs (Foundry).
  - `gmRegisterPayload`, `gmStatePayload`, registered-row upsert, and the rostered-transition baseline (Roll20).
- **Foundry actor and sheet tests:**
  - Adding a PC mid-campaign gives available 0.
  - Linked with available 0: End Floor is refused.
  - Available 2 allows two runs.
  - Undo restores the cursor within an epoch, and skips it across a re-link.
  - The GM's End Floor and −1 only touch the counter.
  - End Session never consumes a floor end.
- **Live, Foundry:**
  - Create a `gmscreen`, pick it in the setting, and roster a PC. The PC's End Floor is disabled.
  - GM End Floor: the PC's End Floor is enabled, runs once, then is disabled again. Undo re-enables it.
  - Two GM ends allow two runs.
  - Rostering mid-campaign gives 0 available.
  - Level Up on Floor 3+ is blocked until the safehouse is on, and the badge shows.
  - Clearing the setting restores today's behaviour.
  - A player account sees the screen read-only.
- **Live, Roll20** (r20-test-rig). Run these through **Claude in Chrome** (the user's real Chrome, where the sandbox, the login and the autoupload extension live), not the built-in Claude Code browser pane:
  - A Crawler auto-registers.
  - Ticking On roster sets the baseline, and the gates apply.
  - Safehouse toggle gives the badge and the Level Up gate.
  - GM End Floor enables the Crawler's End Floor, which runs once, and the registered row updates.
  - Double-click is safe.
  - A stale id stays blocked and shows the unreachable note.
  - The useroption default works for a new character after a manual `sheet.json` upload.

## Sequencing

1. **Foundry:** a new plan chunk on `feat/foundry-system`, after the existing plan's Chunk 7 (crew) unless the user reorders.
2. **Roll20:** its own plan on `feat/gm-screen-r20`.

The two are independent; they share only this design.
