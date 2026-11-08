import { describe, it, expect } from 'vitest';
import { isItemActive, buildGear, buildAccessories } from '../../module/rules/inventory.mjs';

// Ported from character-sheet/__tests__/inventory.test.js, inputs reshaped to
// { id, name, system: { slot, active, accessory } } (ADR-0003). Expectations
// are kept identical. gatherInventoryMods/buildHotlist/reconcileHotlist cases
// are skipped — those functions are not ported (Foundry lists items with
// `onHotlist` directly; modifiers route through rules/modifiers.mjs).

describe('isItemActive (worn in a gear slot OR active flag)', () => {
  it('active when worn in a gear slot', () => {
    expect(isItemActive({ system: { slot: 'head', active: '0' } })).toBe(true);
  });
  it('active when the active flag is set, even if in the pack', () => {
    expect(isItemActive({ system: { slot: 'pack', active: '1' } })).toBe(true);
  });
  it('inactive when in the pack and not flagged active', () => {
    expect(isItemActive({ system: { slot: 'pack', active: '0' } })).toBe(false);
    expect(isItemActive({ system: { slot: '', active: '' } })).toBe(false);
  });
  it('accepts a real boolean active flag, not just R20 string truthiness', () => {
    expect(isItemActive({ system: { slot: 'pack', active: true } })).toBe(true);
    expect(isItemActive({ system: { slot: 'pack', active: false } })).toBe(false);
  });
  it('an item with no system at all is inactive, not a throw', () => {
    expect(isItemActive({})).toBe(false);
    expect(isItemActive({ id: 'X', name: 'Mystery' })).toBe(false);
  });
});

describe('buildGear (slot occupancy derived from inventory)', () => {
  it('maps each gear slot to its occupying item', () => {
    const items = [
      { id: 'A', name: 'Helm', system: { slot: 'head' } },
      { id: 'B', name: 'Boots', system: { slot: 'feet' } },
      { id: 'C', name: 'Ration', system: { slot: 'pack' } },
    ];
    const gear = buildGear(items);
    expect(gear.head).toEqual({ id: 'A', name: 'Helm' });
    expect(gear.feet).toEqual({ id: 'B', name: 'Boots' });
    expect(gear.torso).toBe(null);
  });
  it('a deleted item leaves no orphan in its slot (risk 3)', () => {
    const before = [{ id: 'A', name: 'Helm', system: { slot: 'head' } }];
    expect(buildGear(before).head.id).toBe('A');
    const afterDelete = []; // row A removed from inventory
    expect(buildGear(afterDelete).head).toBe(null);
  });
});

describe('buildAccessories (equipped accessories, Max 10)', () => {
  it('lists active accessory items, capped at 10', () => {
    const items = [];
    for (let i = 0; i < 13; i++) {
      items.push({ id: `R${i}`, name: `Ring ${i}`, system: { accessory: '1', slot: 'pack', active: '1' } });
    }
    items.push({ id: 'X', name: 'Sword', system: { accessory: '0', slot: 'hands', active: '0' } });
    const accessories = buildAccessories(items);
    expect(accessories.length).toBe(10);
    expect(accessories.every((a) => a.id.startsWith('R'))).toBe(true);
  });
  it('excludes inactive accessories and deleted rows', () => {
    const items = [
      { id: 'A', name: 'Amulet', system: { accessory: '1', slot: 'pack', active: '1' } },
      { id: 'B', name: 'Idle Ring', system: { accessory: '1', slot: 'pack', active: '0' } },
    ];
    expect(buildAccessories(items).map((a) => a.id)).toEqual(['A']);
    expect(buildAccessories([]).length).toBe(0); // all deleted -> empty
  });
  it('an accessory is active because it is worn, even with active:false', () => {
    const items = [
      { id: 'A', name: 'Signet Gauntlet', system: { slot: 'hands', active: false, accessory: true } },
    ];
    expect(buildAccessories(items).map((a) => a.id)).toEqual(['A']);
  });
});
