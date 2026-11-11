import { describe, it, expect } from 'vitest';
import {
  advancementRoll, rankCapClamp, advancesAt, nextRank, undoPush, undoPop, isDue, planAdvancement,
  snapshot, restoreUpdates, levelUpBlocker, skillCheckSuccess,
} from '../../module/rules/advancement.mjs';

// Ported from character-sheet/__tests__/skills.test.js

describe('manual Skill Check and advancement roll (d20 >= current rank)', () => {
  it('reports success when the roll equals or exceeds Rank', () => {
    expect(skillCheckSuccess(3, 3)).toBe(true);
    expect(skillCheckSuccess(3, 4)).toBe(true);
    expect(skillCheckSuccess(7, 6)).toBe(false);
  });
  it('advances when the roll equals or exceeds rank', () => {
    expect(advancementRoll(3, 3)).toBe(4);
    expect(advancementRoll(3, 4)).toBe(4);
    expect(advancementRoll(0, 1)).toBe(1);
  });
  it('does not advance when the roll is below rank', () => {
    expect(advancementRoll(10, 2)).toBe(10);
  });
});

describe('rankCapClamp (15 on Floors 1-5, 20 on Floor 6+)', () => {
  it('caps at 15 for low floors', () => {
    expect(rankCapClamp(16, 4)).toBe(15);
    expect(rankCapClamp(15, 5)).toBe(15);
    expect(rankCapClamp(10, 1)).toBe(10);
  });
  it('caps at 20 from Floor 6', () => {
    expect(rankCapClamp(25, 7)).toBe(20);
    expect(rankCapClamp(16, 6)).toBe(16);
  });
});

describe('advancesAt (session vs floor boundary, risk 5)', () => {
  it('Rank <= 4 advances at session end', () => {
    expect(advancesAt(4, 'session')).toBe(true);
    expect(advancesAt(4, 'floor')).toBe(false);
  });
  it('Rank >= 5 advances at floor end', () => {
    expect(advancesAt(5, 'floor')).toBe(true);
    expect(advancesAt(5, 'session')).toBe(false);
  });
});

describe('nextRank (advance then clamp to the floor cap)', () => {
  it('advances and respects the cap', () => {
    expect(nextRank(4, 10, 4)).toBe(5);   // 4 -> 5, under cap 15
    expect(nextRank(15, 20, 4)).toBe(15); // would be 16 but cap 15 on Floor 4
    expect(nextRank(15, 20, 6)).toBe(16); // cap 20 on Floor 6
  });
});

describe('undo stack (~20 deep)', () => {
  it('pushes snapshots, capped at the max depth', () => {
    let stack = [];
    for (let i = 0; i < 25; i++) stack = undoPush(stack, { n: i });
    expect(stack.length).toBe(20);
    expect(stack[stack.length - 1]).toEqual({ n: 24 }); // newest kept
    expect(stack[0]).toEqual({ n: 5 });                  // oldest 5 dropped
  });
  it('pops the most recent snapshot', () => {
    const stack = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const { snapshot, rest } = undoPop(stack);
    expect(snapshot).toEqual({ n: 3 });
    expect(rest).toEqual([{ n: 1 }, { n: 2 }]);
  });
  it('pop on an empty stack is safe', () => {
    expect(undoPop([])).toEqual({ snapshot: null, rest: [] });
  });
  it('pushing onto an undefined stack starts a fresh one', () => {
    expect(undoPush(undefined, { n: 1 })).toEqual([{ n: 1 }]);
  });
  it('honours a custom max', () => {
    const stack = undoPush([{ n: 1 }, { n: 2 }], { n: 3 }, 2);
    expect(stack).toEqual([{ n: 2 }, { n: 3 }]);
  });
  it('does not mutate the input stack array', () => {
    const original = [{ n: 1 }, { n: 2 }];
    const originalCopy = [...original];
    undoPush(original, { n: 3 });
    expect(original).toEqual(originalCopy);
  });
});

// New: isDue, reading the Foundry item shape { id, system: { rank, mark,
// passive } } (like inventory.mjs's items), used by planAdvancement.
describe('isDue (marked, not passive, and advancesAt holds)', () => {
  it('due when marked, active (non-passive), and advancesAt holds', () => {
    expect(isDue({ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }, 'session')).toBe(true);
  });
  it('not due when unmarked', () => {
    expect(isDue({ id: 'a', system: { rank: 3, mark: false, checkType: 'opposed' } }, 'session')).toBe(false);
  });
  it('not due when passive, even if marked', () => {
    expect(isDue({ id: 'a', system: { rank: 3, mark: true, checkType: 'passive' } }, 'session')).toBe(false);
  });
  it('not due at the wrong trigger for this rank', () => {
    expect(isDue({ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }, 'floor')).toBe(false);
    expect(isDue({ id: 'a', system: { rank: 5, mark: true, checkType: 'opposed' } }, 'session')).toBe(false);
  });
  it('accepts R20-style string mark flags via isActive ("1"/"0")', () => {
    expect(isDue({ id: 'a', system: { rank: 3, mark: '1', checkType: 'opposed' } }, 'session')).toBe(true);
    expect(isDue({ id: 'a', system: { rank: 3, mark: '0', checkType: 'opposed' } }, 'session')).toBe(false);
  });
});

// planAdvancement, derived from R20's processAdvancement semantics
// (_skills.pug:169-181) — re-expressed over Foundry item shapes.
describe('planAdvancement', () => {
  it('advances a marked, non-passive, due skill and clears its mark', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: 10 }, // equals or exceeds rank 3
    });
    expect(updates).toEqual([{ id: 'a', rank: 4, mark: false }]);
  });

  it('clears the mark even when the d20 roll fails to advance the rank', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: 1 }, // does not equal or exceed rank 3
    });
    expect(updates).toEqual([{ id: 'a', rank: 3, mark: false }]);
  });

  it('skips unmarked rows', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: false, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: 20 },
    });
    expect(updates).toEqual([]);
  });

  it('skips passive rows, even when marked', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'passive' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: 20 },
    });
    expect(updates).toEqual([]);
  });

  it('skips rows not due at this trigger (rank <= 4 advances at session, not floor)', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'floor',
      floor: 1,
      rolls: { a: 20 },
    });
    expect(updates).toEqual([]);
  });

  it('skips rows not due at this trigger (rank >= 5 advances at floor, not session)', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 5, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: 20 },
    });
    expect(updates).toEqual([]);
  });

  it('a floor-trigger pass advances only the floor-due row, clamped to the floor cap (the low-rank row is session-due, not floor-due)', () => {
    const { updates } = planAdvancement({
      skills: [
        { id: 'a', system: { rank: 15, mark: true, checkType: 'opposed' } },
        { id: 'b', system: { rank: 2, mark: true, checkType: 'opposed' } },
      ],
      trigger: 'floor', // rank 15 (>4) is only due at floor end; rank 2 (<=4) is session-due, so b is skipped here
      floor: 4,
      rolls: { a: 20, b: 20 },
    });
    expect(updates).toEqual([
      { id: 'a', rank: 15, mark: false }, // would be 16, clamped to 15 on Floor 4
    ]);
  });

  it('processes multiple due session-trigger rows independently', () => {
    const { updates } = planAdvancement({
      skills: [
        { id: 'a', system: { rank: 4, mark: true, checkType: 'opposed' } },
        { id: 'b', system: { rank: 2, mark: true, checkType: 'opposed' } },
      ],
      trigger: 'session',
      floor: 4,
      rolls: { a: 20, b: 20 },
    });
    expect(updates).toEqual([
      { id: 'a', rank: 5, mark: false },
      { id: 'b', rank: 3, mark: false },
    ]);
  });

  // New (review): a due row with no supplied roll must never silently clear
  // the mark without advancing — that would be a rules-invisible skip. It is
  // a caller bug (every due row should be rolled before planning), so this
  // throws, naming the offending id, instead of defaulting the roll to 0.
  it('throws, naming the id, when a due row has no roll', () => {
    expect(() => planAdvancement({
      skills: [{ id: 'missing-roll', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: {},
    })).toThrow(/missing-roll/);
  });

  it('does not throw for a due row with roll 0 (falsy but present)', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: 0 },
    });
    expect(updates).toEqual([{ id: 'a', rank: 3, mark: false }]);
  });

  it('does not throw for a non-due row with no roll (never evaluated)', () => {
    const { updates } = planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: false, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: {},
    });
    expect(updates).toEqual([]);
  });

  // Carry-over fix: `rolls: null` and a due row whose roll is `undefined`
  // must both throw the missing-roll error, not just an absent key.
  it('throws when rolls is null', () => {
    expect(() => planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: null,
    })).toThrow(/missing roll for due skill "a"/);
  });

  it('throws when the due row\'s roll is explicitly undefined', () => {
    expect(() => planAdvancement({
      skills: [{ id: 'a', system: { rank: 3, mark: true, checkType: 'opposed' } }],
      trigger: 'session',
      floor: 1,
      rolls: { a: undefined },
    })).toThrow(/missing roll for due skill "a"/);
  });
});

describe('snapshot (R20 snapshotState)', () => {
  const actorLike = {
    items: [
      { id: 'k', type: 'skill', system: { rank: 3, mark: true, checkType: 'opposed' } },
      { id: 's', type: 'spell', system: { rank: 6, mark: false } },
      { id: 'w', type: 'weapon', system: { rank: 2 } },
      { id: 'g', type: 'gear', system: {} },
    ],
    system: { pendingLevels: 2, floor: 4, level: 7, statPoints: 9 },
  };
  it('captures rank + mark of every skill AND spell (due or not), plus pendingLevels and floor', () => {
    expect(snapshot(actorLike)).toEqual({
      skills: [{ id: 'k', rank: 3, mark: true }, { id: 's', rank: 6, mark: false }],
      pendingLevels: 2,
      floor: 4,
      floorEndDone: 0,
      floorEndEpoch: 0,
    });
  });
  it('captures the floor-end cursor and epoch (capture only; the epoch is never restored)', () => {
    const snap = snapshot({ items: [], system: { floorEndDone: 3, floorEndEpoch: 2 } });
    expect(snap.floorEndDone).toBe(3);
    expect(snap.floorEndEpoch).toBe(2);
  });
  it('does not capture level or stat points (Undo never reverts a Level Up)', () => {
    const snap = snapshot(actorLike);
    expect(snap).not.toHaveProperty('level');
    expect(snap).not.toHaveProperty('statPoints');
  });
  it('normalizes blanks: rank 0, mark false, counters 0', () => {
    expect(snapshot({ items: [{ id: 'x', type: 'skill', system: {} }], system: {} }))
      .toEqual({ skills: [{ id: 'x', rank: 0, mark: false }], pendingLevels: 0, floor: 0, floorEndDone: 0, floorEndEpoch: 0 });
    expect(snapshot()).toEqual({ skills: [], pendingLevels: 0, floor: 0, floorEndDone: 0, floorEndEpoch: 0 });
  });
  it('is plain data, detached from the items', () => {
    const items = [{ id: 'k', type: 'skill', system: { rank: 1, mark: true } }];
    const snap = snapshot({ items, system: {} });
    items[0].system.rank = 9;
    expect(snap.skills[0].rank).toBe(1);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});

describe('restoreUpdates (R20 undoAdvancement)', () => {
  const snap = { skills: [{ id: 'k', rank: 3, mark: true }, { id: 'gone', rank: 1, mark: false }], pendingLevels: 2, floor: 4 };
  it('builds the actor counters and one item update per snapshotted row', () => {
    expect(restoreUpdates(snap)).toEqual({
      actor: { 'system.pendingLevels': 2, 'system.floor': 4 },
      items: [
        { _id: 'k', 'system.rank': 3, 'system.mark': true },
        { _id: 'gone', 'system.rank': 1, 'system.mark': false },
      ],
    });
  });
  it('drops rows whose item is no longer present when presentIds is given', () => {
    expect(restoreUpdates(snap, ['k', 'other']).items).toEqual([{ _id: 'k', 'system.rank': 3, 'system.mark': true }]);
    expect(restoreUpdates(snap, new Set()).items).toEqual([]);
  });
  it('restores 0 counters, but omits counters the snapshot lacks (R20 `!== undefined`)', () => {
    expect(restoreUpdates({ skills: [], pendingLevels: 0, floor: 0 }).actor)
      .toEqual({ 'system.pendingLevels': 0, 'system.floor': 0 });
    expect(restoreUpdates({ skills: [] }).actor).toEqual({});
  });
  it('round-trips a snapshot', () => {
    const actorLike = { items: [{ id: 'k', type: 'skill', system: { rank: 5, mark: true } }], system: { pendingLevels: 1, floor: 3 } };
    expect(restoreUpdates(snapshot(actorLike), ['k'])).toEqual({
      actor: { 'system.pendingLevels': 1, 'system.floor': 3 },
      items: [{ _id: 'k', 'system.rank': 5, 'system.mark': true }],
    });
  });
});

describe('restoreUpdates: the floor-end cursor (strict epoch compare)', () => {
  const at = (floorEndDone, floorEndEpoch) => ({ skills: [], pendingLevels: 1, floor: 3, floorEndDone, floorEndEpoch });
  it('restores floorEndDone when the snapshot epoch matches the current epoch', () => {
    expect(restoreUpdates(at(1, 2), [], 2).actor).toEqual({
      'system.pendingLevels': 1, 'system.floor': 3, 'system.floorEndDone': 1,
    });
  });
  it('does not restore after a re-link (current epoch moved on)', () => {
    expect(restoreUpdates(at(1, 2), [], 3).actor).not.toHaveProperty(['system.floorEndDone']);
  });
  it('does not restore when the current epoch is undefined, even for an epoch-0 snapshot', () => {
    expect(restoreUpdates(at(1, 2), []).actor).not.toHaveProperty(['system.floorEndDone']);
    expect(restoreUpdates(at(1, 0), [], undefined).actor).not.toHaveProperty(['system.floorEndDone']);
  });
  it('does not restore from an old snapshot without the fields, even at current epoch 0', () => {
    expect(restoreUpdates({ skills: [], pendingLevels: 1, floor: 3 }, [], 0).actor).not.toHaveProperty(['system.floorEndDone']);
    expect(restoreUpdates({ skills: [], floorEndDone: 1 }, [], 0).actor).not.toHaveProperty(['system.floorEndDone']);
  });
  it('restores a cursor of 0 at a matching epoch 0', () => {
    expect(restoreUpdates(at(0, 0), [], 0).actor['system.floorEndDone']).toBe(0);
  });
  it('never writes system.floorEndEpoch', () => {
    for (const cur of [2, 3, undefined, 0]) {
      expect(Object.keys(restoreUpdates(at(1, 2), [], cur).actor)).not.toContain('system.floorEndEpoch');
    }
  });
});

describe('levelUpBlocker (R20 levelUp gate: pending first, then Floor 3+)', () => {
  it('allows with a pending level on Floor 3+', () => {
    expect(levelUpBlocker({ pendingLevels: 1, floor: 3 })).toBeNull();
    expect(levelUpBlocker({ pendingLevels: 2, floor: 9 })).toBeNull();
  });
  it('no pending level -> NoPending (checked before the floor)', () => {
    expect(levelUpBlocker({ pendingLevels: 0, floor: 5 })).toBe('NoPending');
    expect(levelUpBlocker({ pendingLevels: 0, floor: 1 })).toBe('NoPending');
    expect(levelUpBlocker({})).toBe('NoPending');
  });
  it('below Floor 3 -> Saferoom', () => {
    expect(levelUpBlocker({ pendingLevels: 1, floor: 2 })).toBe('Saferoom');
  });
});

describe('levelUpBlocker: the GM safehouse gate (NoPending -> Saferoom -> Safehouse)', () => {
  it('no pending level -> NoPending, whatever the flags', () => {
    expect(levelUpBlocker({ pendingLevels: 0, floor: 3, linked: true, safehouse: false })).toBe('NoPending');
    expect(levelUpBlocker({ pendingLevels: 0, floor: 3, linked: true, safehouse: true })).toBe('NoPending');
  });
  it('Floor 2 -> Saferoom, even when linked without a safehouse', () => {
    expect(levelUpBlocker({ pendingLevels: 1, floor: 2, linked: true, safehouse: false })).toBe('Saferoom');
  });
  it('Floor 3, linked, no safehouse -> Safehouse', () => {
    expect(levelUpBlocker({ pendingLevels: 1, floor: 3, linked: true, safehouse: false })).toBe('Safehouse');
  });
  it('Floor 3, linked, safehouse -> allowed', () => {
    expect(levelUpBlocker({ pendingLevels: 1, floor: 3, linked: true, safehouse: true })).toBeNull();
  });
  it('Floor 3, unlinked, no safehouse -> allowed', () => {
    expect(levelUpBlocker({ pendingLevels: 1, floor: 3, linked: false, safehouse: false })).toBeNull();
  });
});
