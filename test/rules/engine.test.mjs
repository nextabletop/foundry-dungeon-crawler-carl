import { describe, it, expect } from 'vitest';
import { statModifier, isActive, parseModifierValue, applyModifiers, backCalcBase, healthBarSlotsFor, whisperToGM, cardMessageMode } from '../../module/rules/engine.mjs';

// Ported from character-sheet/__tests__/engine.test.js
describe('statModifier (sourced step chart)', () => {
  const cases = [
    [1, 1], [2, 1],
    [3, 2], [5, 2],
    [6, 3], [9, 3],
    [10, 4], [19, 4],
    [20, 5], [49, 5],
    [50, 6], [99, 6],
    [100, 7], [149, 7],
    [150, 8], [199, 8],
    [200, 9], [299, 9],
    [300, 10], [9999, 10],
  ];
  it.each(cases)('value %i -> mod %i', (val, mod) => {
    expect(statModifier(val)).toBe(mod);
  });
  it('never returns below +1, even for 0 or negative', () => {
    expect(statModifier(0)).toBe(1);
    expect(statModifier(-5)).toBe(1);
  });
  it('caps at +10', () => {
    expect(statModifier(1000000)).toBe(10);
  });
});

describe('isActive', () => {
  it('treats undefined/null/empty/"0"/0/false as inactive', () => {
    expect(isActive(undefined)).toBe(false);
    expect(isActive(null)).toBe(false);
    expect(isActive('')).toBe(false);
    expect(isActive('0')).toBe(false);
    expect(isActive(0)).toBe(false);
    expect(isActive(false)).toBe(false);
  });
  it('treats everything else as active', () => {
    expect(isActive('1')).toBe(true);
    expect(isActive(1)).toBe(true);
    expect(isActive(true)).toBe(true);
    expect(isActive('on')).toBe(true);
  });
});

describe('parseModifierValue (text -> {kind, value})', () => {
  it('a bare number is flat', () => {
    expect(parseModifierValue('2')).toEqual({ kind: 'flat', value: 2 });
  });
  it('a trailing % is percent', () => {
    expect(parseModifierValue('10%')).toEqual({ kind: 'percent', value: 10 });
  });
  it('negative numbers parse', () => {
    expect(parseModifierValue('-3')).toEqual({ kind: 'flat', value: -3 });
  });
  it('trims whitespace', () => {
    expect(parseModifierValue(' 5 ')).toEqual({ kind: 'flat', value: 5 });
  });
  it('unparseable body degrades to 0, kind preserved', () => {
    expect(parseModifierValue('  ')).toEqual({ kind: 'flat', value: 0 });
    expect(parseModifierValue('abc')).toEqual({ kind: 'flat', value: 0 });
    expect(parseModifierValue(undefined)).toEqual({ kind: 'flat', value: 0 });
  });
  it('double-% / bogus percent bodies degrade to 0 percent (Number(), not parseFloat)', () => {
    expect(parseModifierValue('10%%')).toEqual({ kind: 'percent', value: 0 });
    expect(parseModifierValue('x%')).toEqual({ kind: 'percent', value: 0 });
  });
});

describe('applyModifiers (floor((base+flat)*(1+percent/100)))', () => {
  it('combines flat and percent', () => {
    expect(applyModifiers(20, 5, 10)).toBe(27); // floor(25*1.1)=floor(27.5)=27
  });
  it('no flat, no percent is a no-op', () => {
    expect(applyModifiers(20, 0, 0)).toBe(20);
  });
  it('flat only adds', () => {
    expect(applyModifiers(20, 5, 0)).toBe(25);
  });
  it('percent stacks additively then floors', () => {
    expect(applyModifiers(20, 5, 20)).toBe(30); // floor(25*1.2)=30
  });
  it('negative percent reduces', () => {
    expect(applyModifiers(20, 5, -10)).toBe(22); // floor(25*0.9)=floor(22.5)=22
  });
});

describe('backCalcBase (stale-aggregate guard)', () => {
  it('subtracts the bonus from the entered value', () => {
    expect(backCalcBase(10, 3)).toBe(7);
  });
  it('treats a missing/NaN bonus as "no bonus", returning entered as-is', () => {
    expect(backCalcBase(10, undefined)).toBe(10);
    expect(backCalcBase(10, null)).toBe(10);
    expect(backCalcBase(10, NaN)).toBe(10);
  });
});

// Ported from character-sheet/__tests__/mode.test.js
describe('healthBarSlotsFor (Health Bar slot count by mode)', () => {
  it('pc always has 10 slots', () => {
    expect(healthBarSlotsFor('pc', 3, 6)).toBe(10);
  });
  it('mob has min(level, 10), floor 1', () => {
    expect(healthBarSlotsFor('mob', 3)).toBe(3);
    expect(healthBarSlotsFor('mob', 15)).toBe(10);
    expect(healthBarSlotsFor('mob', 0)).toBe(1);
  });
  it('vehicle has min(size, 8), floor 1', () => {
    expect(healthBarSlotsFor('vehicle', 1, 6)).toBe(6);
    expect(healthBarSlotsFor('vehicle', 1, 0)).toBe(1);
    expect(healthBarSlotsFor('vehicle', 1, 12)).toBe(8);
  });
});

describe('whisperToGM (replaces whisperPrefix; returns a boolean, not a chat prefix)', () => {
  it('pc and vehicle never whisper', () => {
    expect(whisperToGM('pc', false)).toBe(false);
    expect(whisperToGM('vehicle', false)).toBe(false);
  });
  it('mob whispers unless mobPublic is true', () => {
    expect(whisperToGM('mob', false)).toBe(true);
    expect(whisperToGM('mob', true)).toBe(false);
  });
});

describe('cardMessageMode (the one whisper decision for a card)', () => {
  const mob = (mobPublic = false) => ({ type: 'mob', system: { mobPublic } });
  it('a hidden mob upgrades public / ic to gm and keeps the private modes', () => {
    for (const [chosen, expected] of [['public', 'gm'], ['ic', 'gm'], ['self', 'self'], ['blind', 'blind'], ['gm', 'gm']]) {
      expect(cardMessageMode(mob(), chosen), chosen).toBe(expected);
    }
  });
  it('a public mob, a PC or a vehicle keeps the chosen mode', () => {
    expect(cardMessageMode(mob(true), 'public')).toBe('public');
    expect(cardMessageMode({ type: 'pc', system: {} }, 'ic')).toBe('ic');
    expect(cardMessageMode({ type: 'vehicle' }, 'public')).toBe('public');
  });
});
