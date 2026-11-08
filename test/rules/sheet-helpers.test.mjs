import { describe, it, expect } from 'vitest';
import { slotClickTarget, slotView } from '../../module/rules/health.mjs';
import { editedBase, translateDefenseEdits } from '../../module/rules/engine.mjs';

describe('slotClickTarget', () => {
  it('fills up to the clicked slot', () => {
    expect(slotClickTarget(7, 10)).toBe(7);
    expect(slotClickTarget(9, 3)).toBe(9);
  });

  it('clicking the current slot clears it', () => {
    expect(slotClickTarget(7, 7)).toBe(6);
    expect(slotClickTarget(1, 1)).toBe(0);
    expect(slotClickTarget(10, 10)).toBe(9);
  });

  it('coerces string slot indexes (data attributes)', () => {
    expect(slotClickTarget('4', 4)).toBe(3);
    expect(slotClickTarget('4', 10)).toBe(4);
  });
});

describe('slotView', () => {
  it('always yields 10 slots with i x 10% labels', () => {
    const v = slotView(10, 10);
    expect(v).toHaveLength(10);
    expect(v.map(s => s.percent)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(v.every(s => s.filled && !s.disabled)).toBe(true);
  });

  it('fills slots at or below healthBar', () => {
    const v = slotView(7, 10);
    expect(v.filter(s => s.filled).map(s => s.i)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('healthBar 0 fills nothing', () => {
    expect(slotView(0, 10).some(s => s.filled)).toBe(false);
  });

  it('disables slots above the slot count and never fills them', () => {
    const v = slotView(10, 4);
    expect(v.filter(s => s.disabled).map(s => s.i)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(v.filter(s => s.filled).map(s => s.i)).toEqual([1, 2, 3, 4]);
  });
});

describe('editedBase (move/step sheet back-calc)', () => {
  it('back-calcs a changed value against the flat bonus', () => {
    expect(editedBase(30, 0, 0)).toBe(30);
    expect(editedBase('12', 10, 5)).toBe(7);
  });

  it('writes nothing when the value is unchanged (no percent drift)', () => {
    // base 30, +10% → displays 33; an unrelated submit resends 33.
    expect(editedBase(33, 33, 0)).toBeUndefined();
    expect(editedBase('5', 5, 0)).toBeUndefined();
  });

  it('ignores blank / null / non-numeric input', () => {
    expect(editedBase('', 5, 0)).toBeUndefined();
    expect(editedBase(null, 5, 0)).toBeUndefined();
    expect(editedBase(undefined, 5, 0)).toBeUndefined();
    expect(editedBase('abc', 5, 0)).toBeUndefined();
  });

  it('treats a missing bonus as zero (stale-aggregate guard)', () => {
    expect(editedBase(8, 5, undefined)).toBe(8);
  });

  it('a 0 entry is a real edit', () => {
    expect(editedBase(0, 5, 2)).toBe(-2);
  });
});

describe('translateDefenseEdits', () => {
  const system = { move: 33, step: 5, moveBonus: 0, stepBonus: 2 };

  it('drops dcc.* and writes nothing when unchanged', () => {
    const out = translateDefenseEdits({ name: 'Carl', dcc: { move: 33, step: 5 }, system: { armor: 1 } }, system);
    expect(out).toEqual({ name: 'Carl', system: { armor: 1 } });
  });

  it('writes the back-calculated base for a changed value', () => {
    const out = translateDefenseEdits({ dcc: { move: 33, step: 9 } }, system);
    expect(out).toEqual({ system: { stepBase: 7 } });
  });

  it('handles only `move` present (step absent)', () => {
    const out = translateDefenseEdits({ dcc: { move: 40 } }, system);
    expect(out).toEqual({ system: { moveBase: 40 } });
  });

  it('back-calcs a move change against a nonzero moveBonus', () => {
    // base 20 + bonus 5 → displays 25; the user enters 30 → base 25.
    const buffed = { move: 25, step: 5, moveBonus: 5, stepBonus: 0 };
    const out = translateDefenseEdits({ dcc: { move: 30, step: 5 }, system: { armor: 2 } }, buffed);
    expect(out).toEqual({ system: { armor: 2, moveBase: 25 } });
  });

  it('leaves data without dcc untouched', () => {
    expect(translateDefenseEdits({ system: { healthBar: 3 } }, system)).toEqual({ system: { healthBar: 3 } });
  });
});
