import { describe, it, expect } from 'vitest';
import { slotClickTarget, slotView } from '../../module/rules/health.mjs';

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
    expect(slotClickTarget('25', 25)).toBe(24);
    expect(slotClickTarget('25', 7)).toBe(25);
  });
});

describe('slotView', () => {
  it('yields 10 slots with i x 10% labels and tiers', () => {
    const v = slotView(10, 10);
    expect(v).toHaveLength(10);
    expect(v.map(s => s.percent)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(v.map(s => s.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(v.every(s => s.filled)).toBe(true);
  });

  it('fills slots at or below healthBar', () => {
    const v = slotView(7, 10);
    expect(v.filter(s => s.filled).map(s => s.i)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('healthBar 0 fills nothing', () => {
    expect(slotView(0, 10).some(s => s.filled)).toBe(false);
  });

  it('renders exactly the count, with proportional labels and tiers', () => {
    const v = slotView(10, 4);
    expect(v).toHaveLength(4);
    expect(v.filter(s => s.filled).map(s => s.i)).toEqual([1, 2, 3, 4]);
    expect(v.map(s => s.percent)).toEqual([25, 50, 75, 100]);
    expect(v.map(s => s.tier)).toEqual([1, 4, 7, 10]);
  });

  it('spreads colors from red to green for short bars and keeps a single slot at 100%', () => {
    expect(slotView(2, 2).map(s => s.tier)).toEqual([1, 10]);
    expect(slotView(3, 3).map(s => s.tier)).toEqual([1, 6, 10]);
    expect(slotView(1, 1)[0]).toMatchObject({ percent: 100, tier: 10 });
  });

  it('keeps tier colors bounded and ordered for every supported multi-slot bar', () => {
    for (let count = 2; count <= 100; count++) {
      const tiers = slotView(count, count).map(s => s.tier);
      expect(tiers[0]).toBe(1);
      expect(tiers.at(-1)).toBe(10);
      expect(tiers.every((tier, i) => tier >= 1 && tier <= 10 && (i === 0 || tier >= tiers[i - 1]))).toBe(true);
    }
  });

  it('supports long and uneven bars through 100 slots', () => {
    const v = slotView(7, 30);
    expect(v).toHaveLength(30);
    expect([v[0].percent, v[1].percent, v[28].percent, v[29].percent]).toEqual([3, 6, 96, 100]);
    expect([v[0].tier, v[2].tier, v[3].tier, v[29].tier]).toEqual([1, 2, 2, 10]);
    expect(v.filter(s => s.filled)).toHaveLength(7);
    expect(slotView(100, 100)).toHaveLength(100);
  });

  it('positions gradient slices across the entire bar, including wrapped and partially filled bars', () => {
    expect(slotView(1, 1)[0].gradientPosition).toBe(0);
    expect(slotView(1, 2).map(s => [s.gradientPosition, s.filled])).toEqual([[0, true], [100, false]]);
    expect(slotView(3, 3).map(s => s.gradientPosition)).toEqual([0, 50, 100]);
    const wrapped = slotView(7, 25);
    expect(wrapped[0].gradientPosition).toBe(0);
    expect(wrapped[12].gradientPosition).toBe(50);
    expect(wrapped[24].gradientPosition).toBe(100);
    expect(wrapped.filter(s => s.filled)).toHaveLength(7);
  });
});
