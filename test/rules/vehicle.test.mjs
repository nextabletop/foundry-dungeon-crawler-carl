import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  VEHICLE_SIZES, vehicleMove, cruiseMph, d20Expr, drivingCheckDC, ramDamage, ramAftermath, raceBonus,
  drivingCheck, ram, race,
} from '../../module/rules/vehicle.mjs';

// Ported from character-sheet/source/javascript/_vehicle.js
// Oracle: character-sheet/__tests__/vehicle.test.js
// The *Fields builders are ported as drivingCheck / ram / race (card fields +
// formulas, no [[ ]]). applyRam and drAbsorbed are actor glue
// (DCCActor#applyRamAftermath / #damageResistanceAbsorbed, test/data/vehicle-rolls.test.mjs).

// A real `t` over lang/en.json, so the card text is checked against the R20
// oracle's English strings.
const LANG = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
const t = (key, data = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], LANG);
  if (typeof text !== 'string') throw new Error(`missing lang key ${key}`);
  return text.replace(/{(\w+)}/g, (_, k) => String(data[k]));
};

describe('vehicle derived values', () => {
  it('Move = Speed x 50 ft per action, Cruise = Speed x 10 mph', () => {
    expect(vehicleMove(4)).toBe(200);
    expect(cruiseMph(4)).toBe(40);
    expect(vehicleMove('')).toBe(0);
  });
  it('cruiseMph is 0 for a blank or zero Speed', () => {
    expect(cruiseMph('')).toBe(0);
    expect(cruiseMph(0)).toBe(0);
  });
  it('size ladder is 1-8 with the three rulebook-confirmed names', () => {
    const byValue = Object.fromEntries(VEHICLE_SIZES.map((s) => [s.v, s.l]));
    expect(VEHICLE_SIZES).toHaveLength(8);
    expect(byValue[3]).toBe('Petite');
    expect(byValue[4]).toBe('Medium');
    expect(byValue[6]).toBe('Huge');
  });
});

describe('drivingCheckDC (Driving / Riding check modes)', () => {
  it('accelerate: DC 10 + desired Speed', () => {
    expect(drivingCheckDC('accelerate', { target: 4, speed: 1, floor: 3 })).toBe(14);
  });
  it('stop: DC 10 + current Speed', () => {
    expect(drivingCheckDC('stop', { target: 4, speed: 3, floor: 3 })).toBe(13);
  });
  it('long-distance hour: DC 15 + Floor', () => {
    expect(drivingCheckDC('longhaul', { target: 4, speed: 3, floor: 3 })).toBe(18);
  });
  it('an unknown mode falls back to the stop formula (10 + current Speed)', () => {
    expect(drivingCheckDC('bogus', { speed: 3 })).toBe(13);
  });
});

describe('ram / trample', () => {
  it('damage is 1d6 per size class + current Speed', () => {
    expect(ramDamage(6, 3)).toBe('6d6 + 3');
  });
  it('a blank or zero size floors to 1d6', () => {
    expect(ramDamage('', '')).toBe('1d6');
    expect(ramDamage(0, 2)).toBe('1d6 + 2');
  });
  it('Speed 0 drops the + 0 (signedFormula, as every card formula)', () => {
    expect(ramDamage(4, 0)).toBe('4d6');
  });
  it('aftermath vs same-size-or-smaller: self 50% damage, Speed halved', () => {
    expect(ramAftermath({ damage: 21, speed: 5, targetLarger: false })).toEqual({ selfDamage: 10, newSpeed: 2 });
  });
  it('aftermath vs larger target: full damage, Speed 0', () => {
    expect(ramAftermath({ damage: 21, speed: 5, targetLarger: true })).toEqual({ selfDamage: 21, newSpeed: 0 });
  });
  it('aftermath with no args defaults to zero damage and zero Speed', () => {
    expect(ramAftermath({})).toEqual({ selfDamage: 0, newSpeed: 0 });
  });
});

describe('advantage plumbing (sheet-wide roll option)', () => {
  it('maps adv / dis / none to the d20 expression', () => {
    expect(d20Expr('adv')).toBe('2d20kh1');
    expect(d20Expr('dis')).toBe('2d20kl1');
    expect(d20Expr('')).toBe('1d20');
    expect(d20Expr(undefined)).toBe('1d20');
  });
});

describe('race / chase bonus', () => {
  it('Speed + one Slingshot point per racer ahead', () => {
    expect(raceBonus(4, 2)).toBe(6);
    expect(raceBonus(4, '')).toBe(4);
  });
});

// Card builders. Deliberate deviation from R20: formulas go through
// signedFormula, so a +0 bonus reads `1d20` (R20: `[[1d20 + 0]]`) and a
// negative bonus reads `1d20 - 2`.
const carl = { name: 'Carl', untrained: false, mob: false };
const goblin = { name: 'Goblin', untrained: false, mob: true };

describe('drivingCheck (R20 drivingCheckFields)', () => {
  it('accelerate: name, DC, d20 + driver bonus, driver note, failure note', () => {
    const r = drivingCheck({
      mode: 'accelerate', target: 4, speed: 1, floor: 2, driveSkill: 'Driving', driver: carl, driverBonus: 7, advantage: '',
    }, t);
    expect(r.fields.name).toBe('Driving: Accelerate to 4');
    expect(r.fields.tag).toBe('Driving check');
    expect(r.fields.dc).toBe(14);
    expect(r.roll).toBe('1d20 + 7');
    expect(r.fields.note).toBe('Driver: Carl · on a failure reach Speed 2');
    expect(r.fields.advantage).toBeUndefined();
    expect(r.damage).toBeUndefined();
  });
  it('no driver rolls at +0 and says so; a Riding skill names the rider', () => {
    const r = drivingCheck({ mode: 'stop', speed: 3, floor: 1, driveSkill: 'Riding', driver: null, driverBonus: 0, advantage: '' }, t);
    expect(r.roll).toBe('1d20');
    expect(r.fields.note).toBe('No rider assigned');
    expect(r.fields.name).toBe('Riding: Stop');
    expect(r.fields.dc).toBe(13);
  });
  it('no driver on a Driving skill: "No driver assigned"', () => {
    const r = drivingCheck({ mode: 'stop', speed: 3, floor: 1 }, t);
    expect(r.fields.note).toBe('No driver assigned');
    expect(r.fields.name).toBe('Driving: Stop');
  });
  it('longhaul: DC 15 + Floor; an unknown mode falls back to Stop', () => {
    expect(drivingCheck({ mode: 'longhaul', speed: 3, floor: 3 }, t).fields).toMatchObject({ name: 'Driving: Long-distance hour', dc: 18 });
    expect(drivingCheck({ mode: 'bogus', speed: 3, floor: 3 }, t).fields).toMatchObject({ name: 'Driving: Stop', dc: 13 });
  });
  it('advantage / disadvantage set the d20 and the chip', () => {
    const r = drivingCheck({ mode: 'stop', speed: 0, driverBonus: 2, advantage: 'dis' }, t);
    expect(r.roll).toBe('2d20kl1 + 2');
    expect(r.fields.advantage).toBe('Disadvantage');
  });
  it('an untrained driver is flagged in the note', () => {
    const r = drivingCheck({ mode: 'stop', driver: { ...carl, untrained: true } }, t);
    expect(r.fields.note).toBe('Driver: Carl (untrained)');
  });
  it('a mob driver posts a static target (10 + bonus + Floor) instead of a roll', () => {
    const r = drivingCheck({ mode: 'stop', speed: 3, floor: 2, driveSkill: 'Driving', driver: goblin, driverBonus: 3, advantage: '' }, t);
    expect(r.roll).toBeUndefined();
    expect(r.fields.target).toBe(15);
  });
});

describe('ram (R20 ramFields)', () => {
  it('Disadvantage, damage die, DC = target Evade, aftermath text for both size cases', () => {
    const r = ram({ size: 4, speed: 3, targetEvade: 14, kind: 'vehicle', driveSkill: 'Driving', driver: carl, driverBonus: 5 }, t);
    expect(r.roll).toBe('2d20kl1 + 5');
    expect(r.fields.advantage).toBe('Disadvantage');
    expect(r.damage).toBe('4d6 + 3');
    expect(r.fields.dc).toBe(14);
    expect(r.fields.name).toBe('Ram');
    expect(r.fields.tag).toBe('Driving vs Evade');
    expect(r.fields.note).toMatch(/^Driver: Carl · .*50%.*Speed 0/);
  });
  it('a mount tramples and names the rider; no driver rolls at +0', () => {
    const r = ram({ size: 2, speed: 0, targetEvade: 10, kind: 'mount', driveSkill: 'Riding', driver: null, driverBonus: 0 }, t);
    expect(r.fields.name).toBe('Trample');
    expect(r.fields.tag).toBe('Riding vs Evade');
    expect(r.roll).toBe('2d20kl1');
    expect(r.damage).toBe('2d6');
    expect(r.fields.note).toMatch(/^No rider assigned · /);
  });
  it('a mob driver posts 10 + bonus + Floor and still rolls damage', () => {
    const r = ram({ size: 4, speed: 3, targetEvade: 14, kind: 'vehicle', driver: goblin, driverBonus: 3, floor: 2 }, t);
    expect(r.roll).toBeUndefined();
    expect(r.fields.target).toBe(15);
    expect(r.damage).toBe('4d6 + 3');
  });
});

describe('race (R20 raceFields)', () => {
  it('driver bonus + Speed + slingshot, optional Advantage, GM-racer text', () => {
    const r = race({ speed: 4, ahead: 1, advantage: 'adv', driveSkill: 'Driving', driver: carl, driverBonus: 5 }, t);
    expect(r.roll).toBe('2d20kh1 + 10');
    expect(r.fields.advantage).toBe('Advantage');
    expect(r.fields.name).toBe('Race / Chase');
    expect(r.fields.tag).toBe('Driving + Speed');
    expect(r.fields.note).toBe('Driver: Carl · Speed 4, 1 ahead · GM racers assume a 10 (+5 in round 1 instead of Advantage)');
  });
  it('no driver: Speed + ahead only, and the race role is always "driver"', () => {
    const r = race({ speed: 2, ahead: 0, advantage: '', driveSkill: 'Riding', driver: null, driverBonus: 0 }, t);
    expect(r.roll).toBe('1d20 + 2');
    expect(r.fields.note).toMatch(/^No driver assigned · Speed 2, 0 ahead/);
  });
  it('a mob driver assumes a 10 (+5 in round 1 instead of Advantage), no Floor', () => {
    const r = race({ speed: 2, ahead: 0, advantage: 'adv', driveSkill: 'Driving', driver: goblin, driverBonus: 3, floor: 4 }, t);
    expect(r.roll).toBeUndefined();
    expect(r.fields.target).toBe(20);
  });
});
