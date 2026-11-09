import { describe, it, expect } from 'vitest';
import { deriveCreature, deriveVehicle } from '../../module/rules/derive.mjs';

// Port of R20 recalcAll (character-sheet/source/javascript/_engine.js:313-442).

const stats = (over = {}) => Object.fromEntries(
  ['strength', 'intelligence', 'constitution', 'dexterity', 'charisma'].map((s) => [s, { base: over[s] ?? 1 }]),
);

const pc = (over = {}) => ({
  type: 'pc', level: 1, floor: 1, healthBar: 10, armor: 0, moveBase: 0, stepBase: 5,
  stats: stats(), manaStat: 'intelligence', modifiers: [], items: [], ...over,
});

const attack = (id, name, system = {}) => ({
  id, type: 'attack', name,
  system: { stat: 'strength', rank: 0, die: '1d6', damageBonus: 0, damageType: 'slashing', linkedItemIds: [], ...system },
});
const skill = (id, name, system = {}) => ({
  id, type: 'skill', name, system: { stat: 'dexterity', rank: 0, enabled: true, class: '', ...system },
});
const spell = (id, name, system = {}) => ({
  id, type: 'spell', name,
  system: {
    stat: 'intelligence', rank: 0, enabled: true, class: '', manaCost: 0,
    ...system,
  },
});

describe('deriveCreature — stats, health, defenses', () => {
  it('fresh PC: all stat mods 1, healthPoints 10/10, evade 11, damageResistance 0, step 5, manaMax 1', () => {
    const d = deriveCreature(pc());
    for (const s of Object.values(d.stats)) expect(s).toEqual({ base: 1, enhancement: 1, modifier: 1 });
    expect(d.healthBarSlots).toBe(10);
    expect(d.healthBar).toBe(10);
    expect(d.healthPoints).toEqual({ value: 10, max: 10 });
    expect(d.evade).toBe(11);
    expect(d.damageResistance).toBe(0);
    expect(d.move).toBe(0);
    expect(d.step).toBe(5);
    expect(d.manaMax).toBe(1);
    expect(d.unresolved).toEqual([]);
  });

  it('CON base 50 -> con mod 6 -> healthPoints.max 60', () => {
    const d = deriveCreature(pc({ stats: stats({ constitution: 50 }) }));
    expect(d.stats.constitution.modifier).toBe(6);
    expect(d.healthPoints.max).toBe(60);
    expect(d.healthPoints.value).toBe(60);
  });

  it('flat stat modifier: strength +2 on base 1 -> enhancement 3 -> modifier 2', () => {
    const d = deriveCreature(pc({ modifiers: [{ target: 'strength', value: '2' }] }));
    expect(d.stats.strength).toEqual({ base: 1, enhancement: 3, modifier: 2 });
  });

  it('percent stat modifier: strength 100% on base 10 -> enhancement 20 -> modifier 5', () => {
    const d = deriveCreature(pc({ stats: stats({ strength: 10 }), modifiers: [{ target: 'strength', value: '100%' }] }));
    expect(d.stats.strength).toEqual({ base: 10, enhancement: 20, modifier: 5 });
  });

  it('mob level 3 -> healthBarSlots 3, healthBar 10 clamped to 3', () => {
    const d = deriveCreature(pc({ type: 'mob', level: 3, healthBar: 10 }));
    expect(d.healthBarSlots).toBe(3);
    expect(d.healthBar).toBe(3);
    expect(d.healthPoints).toEqual({ value: 3, max: 3 });
  });

  it('manaMax reads the configured mana stat enhancement plus mana modifiers', () => {
    const d = deriveCreature(pc({ stats: stats({ charisma: 12 }), manaStat: 'charisma', modifiers: [{ target: 'mana', value: '3' }] }));
    expect(d.manaMax).toBe(15);
  });

  it('evade uses the enhanced dex mod; damageResistance/move/step apply their modifiers', () => {
    const d = deriveCreature(pc({
      stats: stats({ dexterity: 10 }), armor: 2, moveBase: 30,
      modifiers: [{ target: 'evade', value: '1' }, { target: 'damage_resistance', value: '50%' }, { target: 'move', value: '5' }, { target: 'step', value: '2' }],
    }));
    expect(d.evade).toBe(15);
    expect(d.damageResistance).toBe(3);
    expect(d.move).toBe(35);
    expect(d.step).toBe(7);
    expect(d.moveBonus).toBe(5);
    expect(d.stepBonus).toBe(2);
  });

  it('fresh creature returns moveBonus 0 and stepBonus 0', () => {
    const d = deriveCreature(pc());
    expect(d.moveBonus).toBe(0);
    expect(d.stepBonus).toBe(0);
  });

  it('mob strip: mobToHit = 10+strengthModifier+floor, mobEvade = 10+dexterityModifier+floor', () => {
    const d = deriveCreature(pc({ type: 'mob', level: 5, floor: 3, stats: stats({ strength: 20, dexterity: 6 }) }));
    expect(d.mobToHit).toBe(18);
    expect(d.mobEvade).toBe(16);
  });

  it('passes unresolved modifiers through as-is', () => {
    const d = deriveCreature(pc({ modifiers: [{ target: 'item:Nope:to_hit', value: '1' }] }));
    expect(d.unresolved).toHaveLength(1);
    expect(d.unresolved[0]).toMatchObject({ target: 'item:Nope:to_hit', reason: 'noItem' });
  });
});

describe('deriveCreature — Attacks', () => {
  const base = () => pc({ stats: stats({ dexterity: 10 }), items: [attack('w1', 'Dagger', { stat: 'dexterity', rank: 2, die: '1d4', damageBonus: 1, damageType: 'piercing' })] });

  it('toHit = dexterityModifier 4 + rank 2 = 6; damage label and mob target', () => {
    const d = deriveCreature(base());
    expect(d.items.w1.toHit).toBe(6);
    expect(d.items.w1.damageBase).toBe(1);
    expect(d.items.w1.damageLabel).toBe('1d4+1 piercing');
    expect(d.items.w1.mobToHit).toBe(10 + 6 + 1);
  });

  it('item:Dagger:to_hit 1 -> 7', () => {
    const i = base();
    i.modifiers = [{ target: 'item:Dagger:to_hit', value: '1' }];
    expect(deriveCreature(i).items.w1.toHit).toBe(7);
  });

  it('group:attacks:stat=dexterity:damage 10% -> damage unchanged (percent damage dropped)', () => {
    const i = base();
    i.modifiers = [{ target: 'group:attacks:stat=dexterity:damage', value: '10%' }];
    const d = deriveCreature(i);
    expect(d.items.w1.damageBase).toBe(1);
    expect(d.unresolved[0]).toMatchObject({ reason: 'percentDamage' });
  });

  it('flat damage mod adds to damageBase', () => {
    const i = base();
    i.modifiers = [{ target: 'group:attacks:damage', value: '2' }];
    const d = deriveCreature(i);
    expect(d.items.w1.damageBase).toBe(3);
    expect(d.items.w1.damageLabel).toBe('1d4+3 piercing');
  });

  it('dice damage modifiers remain roll-time dice instead of becoming a flat bonus', () => {
    const i = base();
    i.modifiers = [{ target: 'group:attacks:damage', value: '+1d6' }];
    const d = deriveCreature(i);
    expect(d.items.w1).toMatchObject({
      damageBase: 1,
      damageModifierDice: '+1d6',
      damageDice: '1d4+1d6',
      damageLabel: '1d4+1d6+1 piercing',
    });
  });

  it('an Attack linked to Knives uses its effective Rank through stable IDs', () => {
    const items = [
      attack('w1', 'Dagger', { stat: 'dexterity', rank: 0, linkedItemIds: ['s1'] }),
      skill('s1', 'Knives', { stat: 'dexterity', rank: 3, linkedItemIds: ['w1'] }),
    ];
    const d = deriveCreature(pc({ items }));
    expect(d.items.w1.toHit).toBe(1 + 3);
    const d2 = deriveCreature(pc({ items, modifiers: [{ target: 'group:skills:rank', value: '1' }] }));
    expect(d2.items.s1.rankEffective).toBe(4);
    expect(d2.items.w1.toHit).toBe(1 + 4);
  });

  it('exposes the rank the attack used (linked skill base rank, else its own)', () => {
    const items = [
      attack('w1', 'Dagger', { stat: 'dexterity', rank: 0, linkedItemIds: ['s1'] }),
      skill('s1', 'Knives', { stat: 'dexterity', rank: 3, linkedItemIds: ['w1'] }),
      attack('w2', 'Club', { rank: 2 }),
      attack('w3', 'Stick', { rank: 2, linkedItemIds: ['missing'] }),
    ];
    const d = deriveCreature(pc({ items }));
    expect(d.items.w1.rank).toBe(3);
    expect(d.items.w2.rank).toBe(2);
    expect(d.items.w3.rank).toBe(2);
  });

  it('an Attack with a stale source link falls back to its own Rank', () => {
    const d = deriveCreature(pc({ items: [attack('w1', 'Club', { rank: 2, linkedItemIds: ['missing'] })] }));
    expect(d.items.w1.toHit).toBe(3);
  });

  it('a Spell-linked Attack gets group:attacks:to_hit and linked effective Rank', () => {
    const items = [
      spell('sp1', 'Fireball', { rank: 2, linkedItemIds: ['a1'] }),
      attack('a1', 'Fireball Attack', {
        stat: 'intelligence', linkedItemIds: ['sp1'], die: '2d6', damageBonus: 1, damageType: 'fire',
      }),
    ];
    const d = deriveCreature(pc({ items, modifiers: [{ target: 'group:attacks:to_hit', value: '1' }] }));
    expect(d.items.a1.toHit).toBe(1 + 2 + 1);
    expect(d.items.a1.damageBase).toBe(1);
    expect(d.items.a1.damageLabel).toBe('2d6+1 fire');
  });

  it('a Spell has no embedded attack-derived keys', () => {
    const d = deriveCreature(pc({ items: [spell('sp1', 'Heal', { rank: 1 })] }));
    expect(d.items.sp1.toHit).toBeUndefined();
    expect(d.items.sp1.damageLabel).toBeUndefined();
  });
});

describe('deriveCreature — skills and spells', () => {
  it('group:skills:rank 1 -> rankEffective +1, skillBonus = statModifier + rankEffective', () => {
    const d = deriveCreature(pc({
      stats: stats({ dexterity: 10 }),
      items: [skill('s1', 'Sneak', { stat: 'dexterity', rank: 2 })],
      modifiers: [{ target: 'group:skills:rank', value: '1' }],
    }));
    expect(d.items.s1.rankEffective).toBe(3);
    expect(d.items.s1.skillBonus).toBe(7);
    expect(d.items.s1.manaCostEffective).toBeUndefined();
  });

  it('a Passive skill or spell uses effective Rank only, without its Stat Mod', () => {
    const d = deriveCreature(pc({
      stats: stats({ dexterity: 50, intelligence: 100 }),
      items: [
        skill('s1', 'Powerful', { stat: 'dexterity', rank: 2, checkType: 'passive' }),
        spell('sp1', 'Aura', { stat: 'intelligence', rank: 3, checkType: 'passive' }),
      ],
      modifiers: [{ target: 'group:skills:rank', value: '1' }],
    }));
    expect(d.items.s1).toMatchObject({ rankEffective: 3, skillBonus: 3 });
    expect(d.items.sp1).toMatchObject({ rankEffective: 4, skillBonus: 4 });
  });

  it('spell manaCost 10 with item:Fireball:mana_cost -50% -> 5', () => {
    const d = deriveCreature(pc({
      items: [spell('sp1', 'Fireball', { manaCost: 10 })],
      modifiers: [{ target: 'item:Fireball:mana_cost', value: '-50%' }],
    }));
    expect(d.items.sp1.manaCostEffective).toBe(5);
  });
});

describe('deriveVehicle', () => {
  const veh = (over = {}) => ({ kind: 'vehicle', size: 4, speed: 2, constitutionModifier: null, armor: 0, healthBar: 4, modifiers: [], items: [], ...over });

  it('size 4, constitutionModifier null -> healthPoints.max 20; speed 2 -> move 100, cruise 20, penalty -2', () => {
    const d = deriveVehicle(veh());
    expect(d.constitutionModifierEffective).toBe(5);
    expect(d.healthBarSlots).toBe(4);
    expect(d.healthPoints).toEqual({ value: 20, max: 20 });
    expect(d.move).toBe(100);
    expect(d.cruise).toBe(20);
    expect(d.penalty).toBe(-2);
    expect(d.step).toBeUndefined();
  });

  it("constitutionModifier '' defaults to 5; an explicit constitutionModifier is used", () => {
    expect(deriveVehicle(veh({ constitutionModifier: '' })).constitutionModifierEffective).toBe(5);
    expect(deriveVehicle(veh({ constitutionModifier: 3 })).healthPoints.max).toBe(12);
  });

  it('vehicle Attack rank 2 -> toHit 2 (no stat mod)', () => {
    const d = deriveVehicle(veh({ items: [attack('w1', 'Gun', { stat: 'dexterity', rank: 2, die: '2d8', damageBonus: 0, damageType: 'piercing' })] }));
    expect(d.items.w1.toHit).toBe(2);
    expect(d.items.w1.damageBase).toBe(0);
    expect(d.items.w1.damageLabel).toBe('2d8 piercing');
  });

  it('a mount gets step 10', () => {
    expect(deriveVehicle(veh({ kind: 'mount' })).step).toBe(10);
  });

  it('damageResistance = applyModifiers(armor, bonus.damage_resistance, percent.damage_resistance)', () => {
    expect(deriveVehicle(veh({ armor: 4, modifiers: [{ target: 'damage_resistance', value: '1' }] })).damageResistance).toBe(5);
  });

  it('size is truncated to an integer and clamped to 1..8; healthBar clamps to the slots', () => {
    const a = deriveVehicle(veh({ size: 2.5, healthBar: 8 }));
    expect(a.size).toBe(2);
    expect(a.healthBarSlots).toBe(2);
    expect(a.healthBar).toBe(2);
    const b = deriveVehicle(veh({ size: 9 }));
    expect(b.size).toBe(8);
    expect(b.healthBarSlots).toBe(8);
    expect(deriveVehicle(veh({ size: 0 })).size).toBe(1);
  });

  it('passes unresolved through as-is', () => {
    const d = deriveVehicle(veh({ modifiers: [{ target: 'bogus', value: '1' }] }));
    expect(d.unresolved[0]).toMatchObject({ target: 'bogus', reason: 'parse' });
  });
});

// Every number anywhere in a derived result must be finite (no NaN/Infinity).
const allFinite = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object') return Object.values(v).every(allFinite);
  return true;
};
const CREATURE_KEYS = [
  'stats', 'healthBarSlots', 'healthBar', 'healthPoints', 'manaMax', 'evade', 'damageResistance', 'move', 'step',
  'moveBonus', 'stepBonus', 'evadeBonus', 'damageResistanceBonus', 'mobToHit', 'mobEvade', 'items', 'unresolved',
];
const VEHICLE_KEYS = ['size', 'constitutionModifierEffective', 'healthBarSlots', 'healthBar', 'healthPoints', 'damageResistance', 'damageResistanceBonus', 'move', 'cruise', 'penalty', 'items', 'unresolved'];

describe('deriveCreature — review hardening', () => {
  it('returns evadeBonus and damageResistanceBonus (flat only), default 0', () => {
    expect(deriveCreature(pc())).toMatchObject({ evadeBonus: 0, damageResistanceBonus: 0 });
    const d = deriveCreature(pc({ modifiers: [{ target: 'evade', value: '2' }, { target: 'damage_resistance', value: '3' }, { target: 'damage_resistance', value: '50%' }] }));
    expect(d.evadeBonus).toBe(2);
    expect(d.damageResistanceBonus).toBe(3);
  });

  it("a prototype-key stat ('constructor') reads stat mod 0, not a function", () => {
    const d = deriveCreature(pc({ items: [
      skill('s1', 'Odd', { stat: 'constructor', rank: 2 }),
      attack('w1', 'Odd Stick', { stat: '__proto__', rank: 1 }),
    ] }));
    expect(d.items.s1.skillBonus).toBe(2);
    expect(d.items.w1.toHit).toBe(1);
    expect(allFinite(d)).toBe(true);
  });

  it('duplicate skill names all receive modifiers while a stable link selects one source', () => {
    const items = [
      skill('s1', 'K', { rank: 2, linkedItemIds: ['w1'] }),
      skill('s2', 'k ', { rank: 7 }),
      attack('w1', 'Blade', { stat: 'strength', rank: 0, linkedItemIds: ['s1'] }),
    ];
    const d = deriveCreature(pc({ items, modifiers: [{ target: 'item:K:rank', value: '1' }] }));
    expect(d.items.s1.rankEffective).toBe(3);
    expect(d.items.s2.rankEffective).toBe(8);
    expect(d.items.w1.toHit).toBe(1 + 3);
  });
});

describe('deriveCreature — garbage in', () => {
  const check = (d) => {
    expect(Object.keys(d).sort()).toEqual([...CREATURE_KEYS].sort());
    expect(Object.keys(d.stats).sort()).toEqual(['charisma', 'constitution', 'dexterity', 'intelligence', 'strength']);
    expect(allFinite(d)).toBe(true);
  };

  it('no-arg call and {} input', () => {
    for (const d of [deriveCreature(), deriveCreature({})]) {
      check(d);
      expect(d.healthBarSlots).toBe(10);
      expect(d.items).toEqual({});
      expect(d.unresolved).toEqual([]);
    }
  });

  it('missing stats object and missing stat keys read as base 0 -> mod 1', () => {
    const a = deriveCreature(pc({ stats: undefined }));
    check(a);
    expect(a.stats.strength).toEqual({ base: 0, enhancement: 0, modifier: 1 });
    const b = deriveCreature(pc({ stats: { strength: { base: 20 } } }));
    check(b);
    expect(b.stats.strength.modifier).toBe(5);
    expect(b.stats.dexterity).toEqual({ base: 0, enhancement: 0, modifier: 1 });
  });

  it('NaN and string numbers', () => {
    const d = deriveCreature(pc({
      level: 'x', floor: NaN, healthBar: '7', armor: '3', moveBase: 'abc', stepBase: NaN,
      stats: stats({ strength: '20', dexterity: NaN }),
      items: [attack('w1', 'W', { rank: '2', damageBonus: 'z' }), spell('sp1', 'S', { rank: NaN, manaCost: '4' })],
    }));
    check(d);
    expect(d.healthBar).toBe(7);
    expect(d.damageResistance).toBe(3);
    expect(d.stats.strength.modifier).toBe(5);
    expect(d.items.w1.toHit).toBe(5 + 2);
    expect(d.items.w1.damageBase).toBe(0);
    expect(d.items.sp1.manaCostEffective).toBe(4);
  });

  it("unknown manaStat falls back to intelligence", () => {
    const d = deriveCreature(pc({ stats: stats({ intelligence: 9 }), manaStat: 'luck' }));
    check(d);
    expect(d.manaMax).toBe(9);
  });

  it('gear items are absent from items; a skill with an unknown stat gets stat mod 0', () => {
    const d = deriveCreature(pc({ items: [
      { id: 'g1', type: 'gear', name: 'Rope', system: {} },
      skill('s1', 'Weird', { stat: 'luck', rank: 3 }),
    ] }));
    check(d);
    expect(d.items.g1).toBeUndefined();
    expect(d.items.s1.skillBonus).toBe(3);
  });

  it('non-iterable lists (number, plain object) and strings derive nothing', () => {
    for (const bad of [5, { a: skill('s1', 'X') }, 'nope']) {
      const d = deriveCreature(pc({ items: bad, modifiers: bad }));
      check(d);
      expect(d.items).toEqual({});
      expect(d.unresolved).toEqual([]);
    }
  });

  it('accepts a Map (e.g. an EmbeddedCollection) of items, same result as the array', () => {
    const list = [
      attack('w1', 'Dagger', { stat: 'dexterity', rank: 0, linkedItemIds: ['s1'] }),
      skill('s1', 'Knives', { rank: 3, linkedItemIds: ['w1'] }),
      spell('sp1', 'Fireball', { manaCost: 10 }),
    ];
    const modifiers = [{ target: 'item:Fireball:mana_cost', value: '-50%' }];
    const fromMap = deriveCreature(pc({ items: new Map(list.map((it) => [it.id, it])), modifiers: new Set(modifiers) }));
    expect(fromMap).toEqual(deriveCreature(pc({ items: list, modifiers })));
    expect(fromMap.items.w1.toHit).toBe(1 + 3);
    const vMap = deriveVehicle({ size: 4, items: new Map([['w1', attack('w1', 'Gun', { rank: 2 })]]) });
    expect(vMap.items.w1.toHit).toBe(2);
  });

  it('null items/modifiers, items without an id, and non-array lists are ignored', () => {
    const d = deriveCreature(pc({
      items: [null, { type: 'skill', name: 'NoId', system: { rank: 1 } }, skill('s1', 'Ok', { rank: 1 })],
      modifiers: [null, undefined, { target: 'strength', value: '2' }],
    }));
    check(d);
    expect(Object.keys(d.items)).toEqual(['s1']);
    expect(d.stats.strength.enhancement).toBe(3);
    check(deriveCreature(pc({ items: 'nope', modifiers: 5 })));
  });
});

describe('deriveVehicle — garbage in', () => {
  const check = (d) => {
    expect(Object.keys(d).sort()).toEqual([...VEHICLE_KEYS].sort());
    expect(allFinite(d)).toBe(true);
  };

  it('no-arg call and {} input', () => {
    for (const d of [deriveVehicle(), deriveVehicle({})]) {
      check(d);
      expect(d.size).toBe(1);
      expect(d.constitutionModifierEffective).toBe(5);
      expect(d.healthPoints).toEqual({ value: 0, max: 5 });
      expect(Object.is(d.penalty, 0)).toBe(true);
    }
  });

  it('NaN and string numbers; null items/modifiers; gear and id-less items skipped', () => {
    const d = deriveVehicle({
      kind: 'vehicle', size: '3', speed: 'fast', constitutionModifier: 'x', armor: NaN, healthBar: '2',
      items: [null, { id: 'g1', type: 'gear', name: 'Tarp', system: {} }, { type: 'attack', name: 'NoId', system: {} },
        attack('w1', 'Gun', { rank: 'z' })],
      modifiers: [null, { target: 'damage_resistance', value: '1' }],
    });
    check(d);
    expect(d.size).toBe(3);
    expect(d.constitutionModifierEffective).toBe(0);
    expect(d.damageResistance).toBe(1);
    expect(d.damageResistanceBonus).toBe(1);
    expect(Object.keys(d.items)).toEqual(['w1']);
    expect(d.items.w1.toHit).toBe(0);
  });

  it('speed 0 gives penalty +0, not -0', () => {
    expect(Object.is(deriveVehicle({ speed: 0 }).penalty, 0)).toBe(true);
    expect(deriveVehicle({ speed: 3 }).penalty).toBe(-3);
  });
});
