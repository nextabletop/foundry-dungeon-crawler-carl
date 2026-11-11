import { describe, it, expect } from 'vitest';
import { STATS } from '../../module/config.mjs';
import { CreatureModel, PcModel, MobModel, VehicleModel } from '../../module/data/actor/_module.mjs';
import { WeaponModel } from '../../module/data/item/_module.mjs';
import DCCActor from '../../module/documents/actor.mjs';
import { dccChangeHandler } from '../../module/effects/dcc-change.mjs';

// The mock TypeDataModel only Object.assigns its data: pass a full source
// object and attach `parent` by hand. Assigning `model.parent` only works in
// the mock; real Foundry defines `parent` as a non-writable property.

const stats = (over = {}) => Object.fromEntries(STATS.map((s) => [s, { base: over[s] ?? 1 }]));

const creatureSource = (over = {}) => ({
  level: 1, floor: 1, stats: stats(), healthBar: 10, healthPoints: { value: 0, max: 0 },
  armor: 0, moveBase: 20, stepBase: 10, size: 'M', notes: '', ...over,
});
const pcSource = (over = {}) => creatureSource({ mana: { value: 0, max: 0 }, manaStat: 'intelligence', ...over });

const vehicleSource = (over = {}) => ({
  kind: 'vehicle', size: 4, speed: 0, speedMax: 4, constitutionModifier: null, armor: 0, floor: 1, healthBar: 4,
  healthPoints: { value: 0, max: 0 }, ...over,
});

const prepare = (Model, source, items = []) => {
  const model = new Model(source);
  model.parent = { items };
  model.prepareBaseData();
  model.prepareDerivedData();
  return model;
};

const item = (id, type, name, system = {}) => ({ id, type, name, system });
const dagger = () => item('a1', 'attack', 'Dagger',
  { stat: 'dexterity', rank: 0, die: '1d4', damageBonus: 0, damageType: 'piercing', linkedItemIds: ['s1'] });
const knives = () => item('s1', 'skill', 'Knives',
  { stat: 'dexterity', rank: 2, enabled: true, class: '', linkedItemIds: ['a1'] });
const rope = () => item('g1', 'gear', 'Rope', { quantity: 1 });

describe('PcModel derive wiring', () => {
  it('prepareBaseData resets the modifier collector', () => {
    const model = new PcModel(pcSource());
    model._modifiers = [{ target: 'strength', value: '2' }];
    model.prepareBaseData();
    expect(model._modifiers).toEqual([]);
  });

  it('fresh PC: all mods 1, healthPoints 10/10, evade 1, move 20, step 10, mana.max 1', () => {
    const m = prepare(PcModel, pcSource());
    for (const s of STATS) {
      expect(m.stats[s].base).toBe(1);
      expect(m.stats[s].enhancement).toBe(1);
      expect(m.stats[s].modifier).toBe(1);
    }
    expect(m.healthBarSlots).toBe(10);
    expect(m.healthBar).toBe(10);
    expect(m.healthBarDisplay).toBe(10);
    expect(m.healthPoints).toEqual({ value: 10, max: 10 });
    expect(m.mana.max).toBe(1);
    expect(m.evade).toBe(1);
    expect(m.damageResistance).toBe(0);
    expect(m.move).toBe(20);
    expect(m.step).toBe(10);
    expect(m.moveBonus).toBe(0);
    expect(m.stepBonus).toBe(0);
    expect(m.evadeBonus).toBe(0);
    expect(m.damageResistanceBonus).toBe(0);
    expect(typeof m.mobEvade).toBe('number');
    expect(m.unresolvedModifiers).toEqual([]);
  });

  it('keeps the stored healthBar; only healthBarDisplay is clamped', () => {
    const m = prepare(PcModel, pcSource({ healthBar: 14 }));
    expect(m.healthBar).toBe(14);
    expect(m.healthBarDisplay).toBe(10);
  });

  it('reads this._modifiers as the modifier input', () => {
    const model = new PcModel(pcSource());
    model.parent = { items: [] };
    model.prepareBaseData();
    model._modifiers.push({ target: 'strength', value: '2' }, { target: 'damage_resistance', value: '3' });
    model.prepareDerivedData();
    expect(model.stats.strength.enhancement).toBe(3);
    expect(model.stats.strength.modifier).toBe(2);
    expect(model.damageResistance).toBe(3);
    expect(model.damageResistanceBonus).toBe(3);
  });

  it.each([PcModel, MobModel])('preserves authored movement bases while deriving modifiers for %s', (Model) => {
    const model = new Model(creatureSource({ moveBase: 0, stepBase: 12, mana: { value: 0, max: 0 } }));
    model.parent = { items: [] };
    model.prepareBaseData();
    model._modifiers.push(
      { target: 'move', value: '5' },
      { target: 'step', value: '50%' },
    );
    model.prepareDerivedData();
    expect(model).toMatchObject({ moveBase: 0, stepBase: 12, move: 5, step: 18 });
  });

  it('exposes Evade flat, percentage and dice modifiers on the actor model', () => {
    const model = new PcModel(pcSource({ stats: stats({ dexterity: 10, intelligence: 50 }) }));
    model.parent = { items: [] };
    model.prepareBaseData();
    model._modifiers.push(
      { target: 'evade', value: '25%' },
      { target: 'evade', value: '+1d4' },
    );
    model.prepareDerivedData();
    expect(model).toMatchObject({
      evade: 5, evadeBonus: 1, evadeDice: '+1d4', evadeBuffLabel: '1+1d4', evadeRollLabel: '+5+1d4',
    });
  });

  it('writes item.system.derived for Attacks and skills, {} for gear', () => {
    const items = [dagger(), knives(), rope()];
    items[2].system.derived = { stale: true };
    prepare(PcModel, pcSource(), items);
    const [a, s, g] = items;
    expect(s.system.derived.rankEffective).toBe(2);
    expect(s.system.derived.skillBonus).toBe(3); // dex mod 1 + rank 2
    expect(a.system.derived.toHit).toBe(3); // dex mod 1 + linked Knives rank 2
    expect(a.system.derived.damageLabel).toEqual(expect.any(String));
    expect(g.system.derived).toEqual({});
  });

  it.each([PcModel, MobModel, VehicleModel])('applies stable item targets through %s derivation', Model => {
    const items = [dagger(), { ...dagger(), id: 'a2' }];
    const model = new Model(Model === VehicleModel ? vehicleSource() : pcSource());
    model.parent = { items };
    model.prepareBaseData();
    dccChangeHandler({ system: model }, { key: 'item-id:a1:damage', value: '+1d4', phase: 'initial' });
    dccChangeHandler({ system: model }, { key: 'item-id:deleted:to_hit', value: '1', phase: 'initial' });
    model.prepareDerivedData();
    expect(items[0].system.derived.damageModifierDice).toBe('+1d4');
    expect(items[1].system.derived.damageModifierDice).toBe('');
    expect(model.unresolvedModifiers).toEqual([expect.objectContaining({ target: 'item-id:deleted:to_hit', reason: 'noItem' })]);
  });

  it('accepts a Map-like items collection', () => {
    const items = new Map([['s1', knives()]]);
    prepare(PcModel, pcSource(), items);
    expect(items.get('s1').system.derived.skillBonus).toBe(1 + 2);
  });

  it('preparing twice on the same instance gives identical results', () => {
    const items = [dagger(), knives(), rope()];
    const m = prepare(PcModel, pcSource({ healthBar: 7 }), items);
    const snapshot = () => structuredClone({ ...m, parent: undefined, derived: items.map(i => i.system.derived) });
    const first = snapshot();
    m.prepareBaseData();
    m.prepareDerivedData();
    expect(snapshot()).toEqual(first);
  });

  it('rollShortcuts exposes mods, level and floor', () => {
    const m = prepare(PcModel, pcSource({ level: 3, floor: 2, stats: stats({ strength: 10 }) }));
    expect(m.rollShortcuts()).toEqual({ str: 4, int: 1, con: 1, dex: 1, cha: 1, level: 3, floor: 2 });
  });
});

describe('MobModel derive wiring', () => {
  it('level 3 mob has 3 health slots', () => {
    const m = prepare(MobModel, creatureSource({ level: 3, healthBar: 3 }));
    expect(m.healthBarSlots).toBe(3);
    expect(m.healthPoints).toEqual({ value: 3, max: 3 });
    expect(m.move).toBe(20);
    expect(m.step).toBe(10);
    expect(m.mobMove).toBe(30);
  });

  it('wires Mob combat bases and preserves manually entered mana', () => {
    const model = new MobModel(creatureSource({
      floor: 4, surprise: 0, mobEvadeBase: 6, mana: { value: 7, max: 12 },
    }));
    model.parent = { items: [item('s1', 'spell', 'Spell')] };
    model.prepareBaseData();
    model._modifiers.push({ target: 'evade', value: '3' }, { target: 'move', value: '50%' });
    model.prepareDerivedData();
    expect(model).toMatchObject({ mobSurprise: 4, mobEvade: 13, mobMove: 40, mana: { value: 7, max: 12 } });
  });

  it('hiding optional sections leaves owned items and active modifiers in effect', () => {
    const items = [knives(), rope()];
    const model = new MobModel(creatureSource({
      mobShowInventory: false, mobShowSkills: false, mobShowBuffs: false,
    }));
    model.parent = { items };
    const recalculate = () => {
      model.prepareBaseData();
      model._modifiers.push({ target: 'strength', value: '2' });
      model.prepareDerivedData();
    };
    recalculate();
    expect(model.stats.strength.enhancement).toBe(3);
    expect(items[0].system.derived.skillBonus).toBe(3);
    expect(model.parent.items).toEqual(items);
    model.mobShowInventory = true;
    model.mobShowSkills = true;
    model.mobShowBuffs = true;
    recalculate();
    expect(model.stats.strength.enhancement).toBe(3);
    expect(items[0].system.derived.skillBonus).toBe(3);
    expect(model.parent.items).toEqual(items);
  });
});

describe('custom creature Health Bars', () => {
  it.each([PcModel, MobModel])('derives custom slot and HP totals for %s', (Model) => {
    const m = prepare(Model, creatureSource({
      healthBarSlotsCustom: 25, healthBar: 17, stats: stats({ constitution: 10 }),
      mana: { value: 0, max: 0 },
    }));
    expect(m.healthBarSlots).toBe(25);
    expect(m.healthBarDisplay).toBe(17);
    expect(m.healthPoints).toEqual({ value: 68, max: 100 });
  });

  describe('creature movement base edits', () => {
    it.each([PcModel, MobModel])('derives totals from edited bases with active modifiers for %s', (Model) => {
      const model = new Model(creatureSource({ mana: { value: 0, max: 0 } }));
      model.parent = { items: [] };
      const recalculate = () => {
        model.prepareBaseData();
        model._modifiers.push(
          { target: 'move', value: '5' }, { target: 'move', value: '50%' },
          { target: 'step', value: '2' }, { target: 'step', value: '50%' },
        );
        model.prepareDerivedData();
      };
      recalculate();
      expect(model).toMatchObject({ moveBase: 20, move: 37, moveBonus: 17, stepBase: 10, step: 18, stepBonus: 8 });
      model.moveBase = 30;
      model.stepBase = 0;
      recalculate();
      expect(model).toMatchObject({ moveBase: 30, move: 52, moveBonus: 22, stepBase: 0, step: 3, stepBonus: 3 });
      recalculate();
      expect(model).toMatchObject({ moveBase: 30, move: 52, stepBase: 0, step: 3 });
    });
  });
});

describe('VehicleModel derive wiring', () => {
  it('prepareBaseData resets the modifier collector', () => {
    const model = new VehicleModel(vehicleSource());
    model.prepareBaseData();
    expect(model._modifiers).toEqual([]);
  });

  it('size 4 vehicle: healthPoints.max 20, default constitutionModifier 5', () => {
    const m = prepare(VehicleModel, vehicleSource());
    expect(m.healthBarSlots).toBe(4);
    expect(m.constitutionModifier).toBeNull(); // stored value untouched
    expect(m.healthConstitutionModifier).toBe(5);
    expect(m.healthPoints).toEqual({ value: 20, max: 20 });
    expect(m.damageResistance).toBe(0);
    expect(m.damageResistanceBonus).toBe(0);
    expect(m.cruise).toEqual(expect.any(Number));
    expect(m.penalty).toBe(0);
    expect(m.step).toBeNull();
    expect(m.unresolvedModifiers).toEqual([]);
  });

  it('explicit constitutionModifier is used as healthConstitutionModifier', () => {
    const m = prepare(VehicleModel, vehicleSource({ constitutionModifier: 3 }));
    expect(m.constitutionModifier).toBe(3);
    expect(m.healthConstitutionModifier).toBe(3);
    expect(m.healthPoints.max).toBe(12);
  });

  it.each(['vehicle', 'mount'])('retains explicit zero Constitution Modifier for a %s', (kind) => {
    const m = prepare(VehicleModel, vehicleSource({ kind, constitutionModifier: 0, healthBar: 3 }));
    expect(m.constitutionModifier).toBe(0);
    expect(m.healthConstitutionModifier).toBe(0);
    expect(m.healthBarDisplay).toBe(3);
    expect(m.healthPoints).toEqual({ value: 0, max: 0 });
  });

  it('recomputes HP without changing filled slots when Constitution Modifier changes or is cleared', () => {
    const m = prepare(VehicleModel, vehicleSource({ constitutionModifier: 0, healthBar: 3 }));
    m.constitutionModifier = 2;
    m.prepareBaseData();
    m.prepareDerivedData();
    expect(m.healthBar).toBe(3);
    expect(m.healthPoints).toEqual({ value: 6, max: 8 });
    m.constitutionModifier = null;
    m.prepareBaseData();
    m.prepareDerivedData();
    expect(m.healthBar).toBe(3);
    expect(m.healthConstitutionModifier).toBe(5);
    expect(m.healthPoints).toEqual({ value: 15, max: 20 });
  });

  it('mount gets a step of 10; a plain vehicle gets null', () => {
    expect(prepare(VehicleModel, vehicleSource({ kind: 'mount' })).step).toBe(10);
    expect(prepare(VehicleModel, vehicleSource()).step).toBeNull();
  });

  it('mount -> vehicle on the same instance clears step to null', () => {
    const m = prepare(VehicleModel, vehicleSource({ kind: 'mount' }));
    m.kind = 'vehicle';
    m.prepareBaseData();
    m.prepareDerivedData();
    expect(m.step).toBeNull();
  });

  it('preparing twice on the same instance gives identical results', () => {
    const items = [item('a1', 'attack', 'Cannon', { rank: 2, die: '2d6', damageBonus: 1, damageType: 'fire' }), rope()];
    const m = prepare(VehicleModel, vehicleSource({ healthBar: 2 }), items);
    const snapshot = () => structuredClone({ ...m, parent: undefined, derived: items.map(i => i.system.derived) });
    const first = snapshot();
    m.prepareBaseData();
    m.prepareDerivedData();
    expect(snapshot()).toEqual(first);
  });

  it('Attacks get derived values; other items get {}', () => {
    const items = [item('a1', 'attack', 'Cannon', { rank: 2, die: '2d6', damageBonus: 1, damageType: 'fire' }), rope()];
    prepare(VehicleModel, vehicleSource(), items);
    expect(items[0].system.derived.toHit).toBe(2);
    expect(items[0].system.derived.damageBase).toBe(1);
    expect(items[1].system.derived).toEqual({});
  });

  it('rollShortcuts returns only floor', () => {
    expect(prepare(VehicleModel, vehicleSource({ floor: 3 })).rollShortcuts()).toEqual({ floor: 3 });
  });
});

describe('DCCActor#getRollData', () => {
  it('merges system data with the roll shortcuts', () => {
    const system = prepare(PcModel, pcSource());
    const data = DCCActor.prototype.getRollData.call({ system });
    expect(data.stats.dexterity.modifier).toBe(1);
    expect(data.dex).toBe(1);
    expect(data.level).toBe(1);
    expect(data.floor).toBe(1);
  });
});

describe('model guards', () => {
  it('a creature model without a creatureType throws on derive', () => {
    class Bare extends CreatureModel {}
    const m = new Bare(creatureSource());
    m.parent = { items: [] };
    m.prepareBaseData();
    expect(() => m.prepareDerivedData()).toThrow(/creatureType/);
  });

  it('item models start with derived = {} (unowned items are safe)', () => {
    const w = new WeaponModel({});
    w.prepareBaseData();
    expect(w.derived).toEqual({});
  });
});
