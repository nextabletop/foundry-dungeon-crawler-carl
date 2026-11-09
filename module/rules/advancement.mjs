// Skill advancement + undo-stack arithmetic. Ported from
// character-sheet/source/sections/_skills.pug:107-147.
// No Foundry globals — see foundry/module/rules/ conventions.

import {
  UNDO_MAX, RANK_CAP, RANK_CAP_DEEP, RANK_CAP_DEEP_FLOOR, LEVEL_UP_MIN_FLOOR, ADVANCING_TYPES,
} from '../config.mjs';
import { isActive } from './engine.mjs';
import { isPassiveCheck } from './items.mjs';

// Advancement roll: a 1d20 that must EXCEED the current rank to raise it by 1.
export const advancementRoll = (rank, d20) => {
  const r = +rank || 0;
  return (+d20 || 0) > r ? r + 1 : r;
};

// Rank cap: 15 on Floors 1-5, 20 on Floor 6+.
export const rankCapClamp = (rank, floor) => {
  const cap = (+floor || 0) >= RANK_CAP_DEEP_FLOOR ? RANK_CAP_DEEP : RANK_CAP;
  return Math.min(+rank || 0, cap);
};

// Advancement cadence (risk 5): Rank <= 4 advances at session end, Rank >= 5 at
// floor end.
export const advancesAt = (rank, trigger) => ((+rank || 0) <= 4 ? trigger === 'session' : trigger === 'floor');

// Advance one rank then clamp to the floor cap.
export const nextRank = (rank, d20, floor) => rankCapClamp(advancementRoll(rank, d20), floor);

// Undo stack: push a snapshot, keep at most `max` (newest) entries.
export const undoPush = (stack, snapshot, max = UNDO_MAX) => {
  const next = [...(stack || []), snapshot];
  return next.length > max ? next.slice(next.length - max) : next;
};

export const undoPop = (stack) => {
  if (!stack || !stack.length) return { snapshot: null, rest: [] };
  const rest = stack.slice();
  const snapshot = rest.pop();
  return { snapshot, rest };
};

// Is `skill` due to advance at `trigger`? A Foundry item, shaped like
// inventory.mjs's items: { id, system: { rank, mark, checkType } }. Due means
// marked, not passive, and advancesAt(rank, trigger) holds.
export const isDue = (skill, trigger) => {
  const system = skill?.system || {};
  return isActive(system.mark) && !isPassiveCheck(system) && advancesAt(system.rank, trigger);
};

// New pure function replacing R20's processAdvancement worker
// (character-sheet/source/sections/_skills.pug:169-181), re-expressed over
// Foundry item shapes instead of attributes/sections.
//   skills: [{ id, system: { rank, mark, checkType } }]
//   rolls:  {[id]: d20}
// Per R20: the mark is cleared on EVERY due row, even when the d20 roll fails
// to exceed the current rank (advancementRoll then leaves rank unchanged, but
// the mark is still consumed). A due row with no roll supplied is a caller
// bug (every due row must be rolled before planning), so it throws rather
// than silently skipping the mark-clear.
export const planAdvancement = ({
  skills = [], trigger, floor, rolls = {},
} = {}) => {
  const updates = [];
  for (const s of skills) {
    if (!isDue(s, trigger)) continue;
    if (rolls?.[s.id] == null) {
      throw new Error(`planAdvancement: missing roll for due skill "${s.id}"`);
    }
    const rank = +s.system?.rank || 0;
    updates.push({ id: s.id, rank: nextRank(rank, rolls[s.id], floor), mark: false });
  }
  return { updates };
};

// Undo snapshot of an actor, mirroring R20 snapshotState
// (character-sheet/source/sections/_skills.pug:149-158): rank and mark of
// EVERY skill row (spells included — R20 spells are skills rows), due or not,
// plus pendingLevels and floor. Level and stat points are NOT captured, so an
// Undo never reverts a Level Up (R20 behaviour). Also captures the GM-screen
// floor-end cursor (floorEndDone) and its epoch (floorEndEpoch); the epoch is
// capture-only — restoreUpdates compares it, never restores it.
//   actorLike: { items: [{ id, type, system }],
//                system: { pendingLevels, floor, floorEndDone, floorEndEpoch } }
// Returns plain data (safe to store in system.undoStack).
export const snapshot = ({ items = [], system = {} } = {}) => ({
  skills: items
    .filter(i => ADVANCING_TYPES.includes(i?.type))
    .map(i => ({ id: i.id, rank: +i.system?.rank || 0, mark: !!i.system?.mark })),
  pendingLevels: +system.pendingLevels || 0,
  floor: +system.floor || 0,
  floorEndDone: +system.floorEndDone || 0,
  floorEndEpoch: +system.floorEndEpoch || 0,
});

// The updates that restore `snap` (R20 undoAdvancement, _skills.pug:203-215).
//   actor: { 'system.pendingLevels', 'system.floor' } — each only when the
//          snapshot holds it (R20 checks `!== undefined`) — plus
//          'system.floorEndDone' only when the snapshot's cursor was taken in
//          the current epoch (see below).
//   items: [{ _id, 'system.rank', 'system.mark' }] for updateEmbeddedDocuments.
// `presentIds` (optional iterable of item ids): when given, rows for items no
// longer on the actor are dropped, since updateEmbeddedDocuments rejects
// unknown ids. Omitted = keep every row.
// `currentEpoch`: the actor's current SOURCE system.floorEndEpoch, passed raw.
// The cursor is restored only when snap.floorEndDone, snap.floorEndEpoch and
// currentEpoch are all integers and the epochs are strictly equal, so a
// snapshot from before a re-baseline (or an old snapshot without the fields,
// or a missing current epoch) never rewinds the cursor. The epoch itself is
// never written: restoring it would make stale snapshots current again.
export const restoreUpdates = (snap, presentIds, currentEpoch) => {
  const present = presentIds ? new Set(presentIds) : null;
  const actor = {};
  if (snap?.pendingLevels !== undefined) actor['system.pendingLevels'] = snap.pendingLevels;
  if (snap?.floor !== undefined) actor['system.floor'] = snap.floor;
  if (Number.isInteger(snap?.floorEndDone) && Number.isInteger(snap?.floorEndEpoch)
    && Number.isInteger(currentEpoch) && snap.floorEndEpoch === currentEpoch) {
    actor['system.floorEndDone'] = snap.floorEndDone;
  }
  const items = (snap?.skills || [])
    .filter(s => !present || present.has(s.id))
    .map(s => ({ _id: s.id, 'system.rank': s.rank, 'system.mark': s.mark }));
  return { actor, items };
};

// Why Level Up is unavailable, or null when it is allowed. Mirrors the R20
// levelUp gate order (_skills.pug:194-201): no pending level first, then the
// saferoom floor; then, for a Crawler linked to the GM screen (`linked`), the
// GM's safehouse toggle. Callers passing neither flag are never Safehouse-blocked.
// Returns an i18n key suffix: 'NoPending' | 'Saferoom' | 'Safehouse'.
export const levelUpBlocker = ({ pendingLevels, floor, linked, safehouse } = {}) => {
  if ((+pendingLevels || 0) <= 0) return 'NoPending';
  if ((+floor || 0) < LEVEL_UP_MIN_FLOOR) return 'Saferoom';
  if (linked && !safehouse) return 'Safehouse';
  return null;
};
