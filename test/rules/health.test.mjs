import { describe, it, expect } from 'vitest';
import {
  healthPointsFromHealthBar, maxHealthPointsFromConstitution, damageToSlots, directDamage, applyHealthPointsEdit, healSlots, isDying,
} from '../../module/rules/health.mjs';

// Ported from character-sheet/__tests__/healthbar.test.js

describe('healthPoints / hpMax materialization', () => {
  it('healthPoints = healthBar x Con Mod', () => {
    expect(healthPointsFromHealthBar(7, 4)).toBe(28);
    expect(healthPointsFromHealthBar(0, 4)).toBe(0);
  });
  it('hpMax = 10 x Con Mod', () => {
    expect(maxHealthPointsFromConstitution(4)).toBe(40);
  });
  it('a negative Con Mod is honoured, not floored to 0 (healthPoints can go negative)', () => {
    expect(healthPointsFromHealthBar(5, -1)).toBe(-5);
  });
});

describe('damageToSlots (whole-hit shrug below Con Mod)', () => {
  it('shrugs a hit smaller than Con Mod (0 slots)', () => {
    expect(damageToSlots(3, 4)).toBe(0);
  });
  it('one slot exactly at Con Mod', () => {
    expect(damageToSlots(4, 4)).toBe(1);
  });
  it('floors the division, remainder shrugged', () => {
    expect(damageToSlots(11, 4)).toBe(2); // floor(11/4)
  });
  it('a zero or negative Con Mod never removes slots (division guard)', () => {
    expect(damageToSlots(10, 0)).toBe(0);
    expect(damageToSlots(10, -2)).toBe(0);
  });
});

describe('directDamage (per hit, DR applied first)', () => {
  it('subtracts DR then chunks: 9 damage - 1 DR = 8 -> 2 slots at Con Mod 4', () => {
    const r = directDamage(10, 9, 1, 4);
    expect(r.healthBar).toBe(8);
    expect(r.healthPoints).toBe(32);
    expect(r.slotsLost).toBe(2);
  });
  it('a hit reduced below Con Mod by DR is fully shrugged', () => {
    const r = directDamage(10, 5, 3, 4); // effective 2 < 4
    expect(r.healthBar).toBe(10);
    expect(r.slotsLost).toBe(0);
  });
  it('clamps at 0 (cannot drop below empty)', () => {
    const r = directDamage(1, 100, 0, 4);
    expect(r.healthBar).toBe(0);
    expect(r.healthPoints).toBe(0);
  });
  it('summed hits differ from individual hits (chunk math, per ADR)', () => {
    // Two 3-damage hits at Con Mod 4: each shrugged individually -> 0 slots.
    let healthBar = 10;
    healthBar = directDamage(healthBar, 3, 0, 4).healthBar;
    healthBar = directDamage(healthBar, 3, 0, 4).healthBar;
    expect(healthBar).toBe(10);
    // But a single 6-damage hit -> 1 slot.
    expect(directDamage(10, 6, 0, 4).healthBar).toBe(9);
  });
  it('a negative DR increases effective damage instead of reducing it', () => {
    // effective = damage - damageResistance = 5 - (-3) = 8 -> 2 slots at Con Mod 4.
    const r = directDamage(10, 5, -3, 4);
    expect(r.healthBar).toBe(8);
    expect(r.slotsLost).toBe(2);
  });
  it('respects an explicit max lower than the current healthBar', () => {
    // effective 8 -> 2 slots off 10, but clamped to a max of 6.
    const r = directDamage(10, 9, 1, 4, 6);
    expect(r.healthBar).toBe(6);
    expect(r.slotsLost).toBe(4);
  });
  it('a healthBar already above max reports the clamp as slotsLost, even on 0 damage — R20 parity, not new behaviour', () => {
    // healthBar=12 with max=10 (e.g. after a slot-count shrink): 0 damage removes 0
    // slots by damageToSlots, but clampSlots(12, 10) still pulls healthBar down to
    // 10, and slotsLost = healthBar - newHealthBar reports that clamp as 2 slots "lost".
    const r = directDamage(12, 0, 0, 4, 10);
    expect(r.healthBar).toBe(10);
    expect(r.slotsLost).toBe(2);
  });
});

describe('applyHealthPointsEdit (token-bubble delta, remainder refunded) — return shape {healthBar, healthPoints}', () => {
  // Oracle: character-sheet/__tests__/healthbar.test.js:60 — applyHealthPointsEdit(10, 31, 4) -> healthBar 8, healthPoints 32.
  it('typing reduced HP chunks the delta and refunds remainder to a clean multiple', () => {
    // healthBar 10 @ Con Mod 4 -> healthPoints 40. User types 31 (a 9 delta): 2 slots, healthPoints realigns to 32 (not 31).
    const r = applyHealthPointsEdit(10, 31, 4);
    expect(r.healthBar).toBe(8);
    expect(r.healthPoints).toBe(32);
  });
  it('healing via healthPoints delta chunks symmetrically', () => {
    // healthBar 6 @ Con Mod 4 -> healthPoints 24. User types 32 (a +8 delta): 2 slots -> healthBar 8, healthPoints 32.
    const r = applyHealthPointsEdit(6, 32, 4);
    expect(r.healthBar).toBe(8);
    expect(r.healthPoints).toBe(32);
  });
  it('sub-slot edits are shrugged (no slot change)', () => {
    // healthBar 6 @ Con Mod 4 -> healthPoints 24. Type 22 (-2, < Con Mod): no slot lost, healthPoints stays 24.
    const r = applyHealthPointsEdit(6, 22, 4);
    expect(r.healthBar).toBe(6);
    expect(r.healthPoints).toBe(24);
  });
  it('clamps within 0..10 slots', () => {
    expect(applyHealthPointsEdit(9, 999, 4).healthBar).toBe(10);
    expect(applyHealthPointsEdit(1, -999, 4).healthBar).toBe(0);
  });
  it('a zero Con Mod makes healthPoints a constant 0 and never moves healthBar', () => {
    expect(applyHealthPointsEdit(5, 0, 0)).toEqual({ healthBar: 5, healthPoints: 0 });
  });
});

describe('healSlots (potions heal whole slots directly)', () => {
  it('adds whole slots, clamped at 10', () => {
    expect(healSlots(6, 2)).toBe(8);
    expect(healSlots(9, 5)).toBe(10);
  });
});

describe('isDying', () => {
  it('true at 0 slots', () => {
    expect(isDying(0)).toBe(true);
    expect(isDying(1)).toBe(false);
  });
  it('true below 0 slots too (a defensive floor, not just ===0)', () => {
    expect(isDying(-1)).toBe(true);
  });
});

// Variable slot count (mob = min(level,10), vehicle = size): every clamp
// accepts an optional `max` and defaults to the PC's 10 so existing callers
// are untouched.
describe('variable slot count (max param, defaults to 10)', () => {
  it('maxHealthPointsFromConstitution takes a slot count', () => {
    expect(maxHealthPointsFromConstitution(5, 6)).toBe(30);
    expect(maxHealthPointsFromConstitution(5)).toBe(50);
  });
  it('healSlots clamps at the given max', () => {
    expect(healSlots(3, 5, 6)).toBe(6);
    expect(healSlots(3, 5)).toBe(8);
  });
  it('applyHealthPointsEdit clamps at the given max', () => {
    expect(applyHealthPointsEdit(4, 999, 4, 6).healthBar).toBe(6);
  });
});
