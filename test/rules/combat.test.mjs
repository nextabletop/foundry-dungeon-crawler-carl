import { describe, it, expect } from 'vitest';
import {
  attackToHit, damageLabel, mobToHit, mobEvade, manaAfterCast,
  signedFormula, checkFormula, damageFormula, castPlan,
} from '../../module/rules/combat.mjs';

// Ported from character-sheet/__tests__/attacks.test.js
// (rankDamageDie is excluded — an unfinished R20 stub, not ported per plan.)

describe('attackToHit', () => {
  it('sums stat mod + rank + misc', () => {
    expect(attackToHit(4, 5, 1)).toBe(10);
  });
  it('treats missing parts as 0', () => {
    expect(attackToHit(3)).toBe(3);
    expect(attackToHit('', '', '')).toBe(0);
  });
});

describe('damageLabel (value-bearing label)', () => {
  it('formats die + signed flat + type', () => {
    expect(damageLabel('2d8', 4, 'slashing')).toBe('2d8+4 Slashing');
  });
  it('shows negative flats and omits an empty type', () => {
    expect(damageLabel('1d6', -2, '')).toBe('1d6-2');
  });
  it('omits a zero modifier', () => {
    expect(damageLabel('1d4', 0, 'bludgeoning')).toBe('1d4 Bludgeoning');
  });
  it.each([
    ['  fire  ', 'Fire'],
    ['Psychic', 'Psychic'],
    ['magical Bludgeoning', 'Magical Bludgeoning'],
    [undefined, ''],
  ])('capitalizes the display type %j without changing the dice', (type, label) => {
    expect(damageLabel('1d6+1d4', 2, type)).toBe(`1d6+1d4+2${label ? ` ${label}` : ''}`);
  });
  it('labels an attack with no die and no modifier as no damage', () => {
    expect(damageLabel('', 0, '')).toBe('No damage');
  });
});

// Ported from character-sheet/__tests__/mob.test.js
// (mobDies is excluded — it is isDying, already ported/tested in health.mjs.)

describe('mobToHit (10 + Stat Mod + Floor)', () => {
  it('adds the floor bonus', () => {
    expect(mobToHit(4, 3)).toBe(17);
    expect(mobToHit(0, 0)).toBe(10);
  });
});

describe('mobEvade (base + Floor)', () => {
  it('adds the floor bonus', () => {
    expect(mobEvade(2, 5)).toBe(7);
    expect(mobEvade(0, 5)).toBe(5);
  });
});

// Ported from character-sheet/__tests__/spells.test.js (manaAfterCast cases only)

describe('manaAfterCast (clamp at 0)', () => {
  it('subtracts the cost from current mana', () => {
    expect(manaAfterCast(10, 3)).toBe(7);
  });
  it('an exact-cost cast leaves 0', () => {
    expect(manaAfterCast(5, 5)).toBe(0);
  });
  it('clamps at 0 on overspend (never goes negative)', () => {
    expect(manaAfterCast(2, 5)).toBe(0);
  });
  it('treats blank/garbage as 0', () => {
    expect(manaAfterCast('', '')).toBe(0);
    expect(manaAfterCast('x', 'y')).toBe(0);
  });
});

describe('signedFormula / checkFormula / damageFormula', () => {
  it('appends a signed flat term, never "+ -n"', () => {
    expect(signedFormula('1d20', 4)).toBe('1d20 + 4');
    expect(signedFormula('1d20', -2)).toBe('1d20 - 2');
    expect(signedFormula('1d20', 0)).toBe('1d20');
  });
  it('a blank head leaves the number alone', () => {
    expect(signedFormula('', 3)).toBe('3');
    expect(signedFormula('  ', -3)).toBe('-3');
    expect(signedFormula('', 0)).toBe('0');
  });
  it('garbage numbers count as 0', () => {
    expect(signedFormula('1d20', 'x')).toBe('1d20');
  });
  it('checkFormula is 1d20 + bonus', () => {
    expect(checkFormula(4)).toBe('1d20 + 4');
    expect(checkFormula(-1)).toBe('1d20 - 1');
  });
  it('damageFormula is die + damageBase, or damageBase alone when the die is blank', () => {
    expect(damageFormula('1d4', 0)).toBe('1d4');
    expect(damageFormula('2d8', 3)).toBe('2d8 + 3');
    expect(damageFormula('1d6', -2)).toBe('1d6 - 2');
    expect(damageFormula('', 5)).toBe('5');
    expect(damageFormula(undefined, 0)).toBe('0');
    expect(damageFormula('+1d4', 0)).toBe('0+1d4');
  });
});

// R20 _spells.js castOutputFields + doCast: an unaffordable cast still rolls,
// keeps the mana, and (auto-enable on) still enables the spell.
describe('castPlan', () => {
  it('affordable: spends the cost', () => {
    expect(castPlan({ manaValue: 5, costEffective: 3, enabled: false, autoEnable: false }))
      .toEqual({ insufficient: false, manaAfter: 2, enable: false });
  });
  it('exact cost is affordable and leaves 0', () => {
    expect(castPlan({ manaValue: 3, costEffective: 3 })).toMatchObject({ insufficient: false, manaAfter: 0 });
  });
  it('insufficient: mana unchanged', () => {
    expect(castPlan({ manaValue: 0, costEffective: 3 })).toMatchObject({ insufficient: true, manaAfter: 0 });
    expect(castPlan({ manaValue: 2, costEffective: 3 })).toMatchObject({ insufficient: true, manaAfter: 2 });
  });
  it('auto-enable enables a disabled spell, affordable or not', () => {
    expect(castPlan({ manaValue: 5, costEffective: 3, enabled: false, autoEnable: true }).enable).toBe(true);
    expect(castPlan({ manaValue: 0, costEffective: 3, enabled: false, autoEnable: true }).enable).toBe(true);
  });
  it('no enable when already enabled or auto-enable is off', () => {
    expect(castPlan({ manaValue: 5, costEffective: 3, enabled: true, autoEnable: true }).enable).toBe(false);
    expect(castPlan({ manaValue: 5, costEffective: 3, enabled: false, autoEnable: false }).enable).toBe(false);
  });
  it('blank values count as 0 (free cast is never insufficient)', () => {
    expect(castPlan({})).toEqual({ insufficient: false, manaAfter: 0, enable: false });
  });
});
