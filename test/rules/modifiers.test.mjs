import { describe, it, expect } from 'vitest';
import { parseTarget, resolveModifiers } from '../../module/rules/modifiers.mjs';

// parseTarget: field / item / group grammar.
// Group-parse cases are translated from character-sheet/__tests__/engine.test.js
// (k.parseGroupTarget), which used R20's `group:<section>[:<attribute>(=|!=)<value>]`
// (no trailing aspect, section names attacks|skills). The Foundry grammar adds a
// mandatory trailing `:<aspect>`; the vocabulary is R20's snake_case values.
describe('parseTarget', () => {
  it('a bare field key parses to {kind: field}', () => {
    expect(parseTarget('strength')).toEqual({ kind: 'field', field: 'strength' });
    expect(parseTarget('damage_resistance')).toEqual({ kind: 'field', field: 'damage_resistance' });
  });

  it('field names are case-insensitive and map back to canonical casing', () => {
    expect(parseTarget('Strength')).toEqual({ kind: 'field', field: 'strength' });
    expect(parseTarget('  STRENGTH  ')).toEqual({ kind: 'field', field: 'strength' });
  });

  it('item:<Name>:<aspect> parses to {kind: item, name, aspect}', () => {
    expect(parseTarget('item:Longsword:to_hit')).toEqual({ kind: 'item', name: 'Longsword', aspect: 'to_hit' });
  });

  it('parses stable IDs without changing their case', () => {
    expect(parseTarget(' ITEM-ID:Ab12_xy:TO_HIT ')).toEqual({ kind: 'itemId', id: 'Ab12_xy', aspect: 'to_hit' });
  });

  it('item aspect is case-insensitive and maps back to canonical casing', () => {
    expect(parseTarget('item:Firebolt:MANA_COST')).toEqual({ kind: 'item', name: 'Firebolt', aspect: 'mana_cost' });
  });

  it('the item name may itself contain a colon; only the final segment is the aspect', () => {
    expect(parseTarget('item:Sword: of Legends:to_hit')).toEqual({ kind: 'item', name: 'Sword: of Legends', aspect: 'to_hit' });
  });

  it('a bare group key + aspect parses with an empty predicate (operator defaults to =)', () => {
    expect(parseTarget('group:attacks:to_hit')).toEqual({ kind: 'group', section: 'attacks', attribute: '', operator: '=', value: '', aspect: 'to_hit' });
  });

  it('an equality predicate parses to section + attribute + operator = + value + aspect', () => {
    expect(parseTarget('group:attacks:damage_type=slashing:damage'))
      .toEqual({ kind: 'group', section: 'attacks', attribute: 'damage_type', operator: '=', value: 'slashing', aspect: 'damage' });
    expect(parseTarget('group:skills:stat=charisma:rank'))
      .toEqual({ kind: 'group', section: 'skills', attribute: 'stat', operator: '=', value: 'charisma', aspect: 'rank' });
  });

  it('a negated-equality predicate parses to operator !=', () => {
    expect(parseTarget('group:skills:class!=bard:rank'))
      .toEqual({ kind: 'group', section: 'skills', attribute: 'class', operator: '!=', value: 'bard', aspect: 'rank' });
  });

  it('section, attribute and aspect are case-insensitive and map back to canonical casing', () => {
    expect(parseTarget('group:Attacks:STAT=Strength:TO_HIT'))
      .toEqual({ kind: 'group', section: 'attacks', attribute: 'stat', operator: '=', value: 'Strength', aspect: 'to_hit' });
    expect(parseTarget('group:SKILLS:MANA_COST'))
      .toEqual({ kind: 'group', section: 'skills', attribute: '', operator: '=', value: '', aspect: 'mana_cost' });
  });

  it('a value containing "=" is not truncated at the first operator match after the attribute', () => {
    expect(parseTarget('group:attacks:stat=a=b:to_hit'))
      .toEqual({ kind: 'group', section: 'attacks', attribute: 'stat', operator: '=', value: 'a=b', aspect: 'to_hit' });
  });

  it('the item: and group: prefixes are case-insensitive; the item name keeps its casing', () => {
    expect(parseTarget('Item:Longsword:TO_HIT')).toEqual({ kind: 'item', name: 'Longsword', aspect: 'to_hit' });
    expect(parseTarget('ITEM:Longsword:to_hit')).toEqual({ kind: 'item', name: 'Longsword', aspect: 'to_hit' });
    expect(parseTarget('GROUP:attacks:to_hit'))
      .toEqual({ kind: 'group', section: 'attacks', attribute: '', operator: '=', value: '', aspect: 'to_hit' });
    expect(parseTarget('  Group:skills:stat=charisma:rank  '))
      .toEqual({ kind: 'group', section: 'skills', attribute: 'stat', operator: '=', value: 'charisma', aspect: 'rank' });
  });

  // R20's group builder (_modifiers.js resolveModifierTarget) emits the predicate
  // only when an attribute AND a value are chosen; an attribute with no value yet is a bare group.
  it.each([
    ['= with an empty value', 'group:attacks:stat=:to_hit'],
    ['!= with an empty value', 'group:attacks:stat!=:to_hit'],
    ['= with a whitespace-only value', 'group:attacks:stat=   :to_hit'],
    ['an empty predicate segment', 'group:attacks::to_hit'],
  ])('a predicate with %s is a bare (unfiltered) group, like R20', (_label, target) => {
    expect(parseTarget(target)).toEqual({ kind: 'group', section: 'attacks', attribute: '', operator: '=', value: '', aspect: 'to_hit' });
  });

  it('an empty value only drops a LEGAL attribute: an illegal one is kept, so resolve reports illegalAttribute', () => {
    expect(parseTarget('group:attacks:class=:to_hit'))
      .toEqual({ kind: 'group', section: 'attacks', attribute: 'class', operator: '=', value: '', aspect: 'to_hit' });
    expect(parseTarget('group:skills:damage_type!=:rank'))
      .toEqual({ kind: 'group', section: 'skills', attribute: 'damage_type', operator: '!=', value: '', aspect: 'rank' });
  });

  it.each([
    ['empty target', ''],
    ['undefined target', undefined],
    ['whitespace-only target', '   '],
    ['non-string target', 42],
    ['a rowID-shaped bare string that is not a known field (ported from R20\'s parseGroupTarget oracle)', '-AtkRowId'],
    ['an unrecognized bare field name', 'armor'],
    ['item: with no aspect segment', 'item:Longsword'],
    ['item: with an empty aspect', 'item:Longsword:'],
    ['item-id without an ID', 'item-id::rank'],
    ['item-id with a delimiter in the ID', 'item-id:a:b:rank'],
    ['item-id with whitespace in the ID', 'item-id:a b:rank'],
    ['group: with too few segments (no aspect)', 'group:attacks'],
    ['group: with too many segments', 'group:attacks:stat=a:extra:to_hit'],
    ['group: predicate with no operator', 'group:attacks:stat:to_hit'],
    ['group: predicate with an empty attribute before "="', 'group:attacks:=fire:to_hit'],
    ['group: predicate with an empty attribute before "!="', 'group:attacks:!=fire:to_hit'],
  ])('returns null for %s (%j)', (_label, target) => {
    expect(parseTarget(target)).toBeNull();
  });
});

describe('resolveModifiers — field targets', () => {
  it('routes a flat value into bonus, keyed by field', () => {
    const result = resolveModifiers([{ target: 'strength', value: '2' }], []);
    expect(result.bonus).toEqual({ strength: 2 });
    expect(result.percent).toEqual({});
    expect(result.unresolved).toEqual([]);
  });

  it('routes a percent value into percent', () => {
    const result = resolveModifiers([{ target: 'damage_resistance', value: '10%' }], []);
    expect(result.percent).toEqual({ damage_resistance: 10 });
    expect(result.bonus).toEqual({});
  });

  it('accepts a numeric (not string) value', () => {
    const result = resolveModifiers([{ target: 'strength', value: 2 }], []);
    expect(result.bonus).toEqual({ strength: 2 });
  });

  it('sums multiple modifiers on the same field', () => {
    const result = resolveModifiers([
      { target: 'evade', value: '1' },
      { target: 'evade', value: '2' },
    ], []);
    expect(result.bonus).toEqual({ evade: 3 });
  });

  it('field name casing is normalized before routing', () => {
    const result = resolveModifiers([{ target: 'Strength', value: '2' }], []);
    expect(result.bonus).toEqual({ strength: 2 });
  });

  it('an unrecognized field is unresolved with reason "parse"', () => {
    const result = resolveModifiers([{ target: 'armor', value: '2' }], []);
    expect(result.bonus).toEqual({});
    expect(result.unresolved).toEqual([{ target: 'armor', reason: 'parse', modifier: { target: 'armor', value: '2' } }]);
  });
});

describe('resolveModifiers — item targets', () => {
  const items = [
    { id: 'w1', type: 'attack', name: 'Longsword', system: { stat: 'strength', damageType: 'slashing' } },
    { id: 's1', type: 'skill', name: 'Stealth', system: { stat: 'dexterity', class: 'rogue' } },
  ];

  it('matches by name, case-insensitive and trimmed', () => {
    const result = resolveModifiers([{ target: 'item: longsword :to_hit', value: '1' }], items);
    expect(result.itemBonus).toEqual({ w1: { to_hit: 1 } });
  });

  it('applies to every item sharing the name', () => {
    const dupItems = [...items, { id: 'w2', type: 'attack', name: 'Longsword', system: {} }];
    const result = resolveModifiers([{ target: 'item:Longsword:damage', value: '2' }], dupItems);
    expect(result.itemBonus).toEqual({ w1: { damage: 2 }, w2: { damage: 2 } });
  });

  it('accumulates multiple aspects on the same item', () => {
    const result = resolveModifiers([
      { target: 'item:Longsword:to_hit', value: '1' },
      { target: 'item:Longsword:damage', value: '2' },
    ], items);
    expect(result.itemBonus).toEqual({ w1: { to_hit: 1, damage: 2 } });
  });

  it('keeps normalized damage dice in the roll-time itemDice bucket', () => {
    const result = resolveModifiers([
      { target: 'item:Longsword:damage', value: '1d4' },
      { target: 'item:Longsword:damage', value: '- 2D6' },
    ], items);
    expect(result.itemBonus).toEqual({});
    expect(result.itemDice).toEqual({ w1: { damage: '+1d4-2d6' } });
  });

  it('falls back to _id when an item has no id (e.g. a raw Foundry Item document shape)', () => {
    const underscoreIdItems = [{ _id: 'w9', type: 'attack', name: 'Longsword', system: {} }];
    const result = resolveModifiers([{ target: 'item:Longsword:to_hit', value: '1' }], underscoreIdItems);
    expect(result.itemBonus).toEqual({ w9: { to_hit: 1 } });
  });

  it('an aspect illegal for the item type is unresolved with reason "illegalAspect"', () => {
    const result = resolveModifiers([{ target: 'item:Longsword:rank', value: '1' }], items);
    expect(result.itemBonus).toEqual({});
    expect(result.unresolved).toEqual([{ target: 'item:Longsword:rank', reason: 'illegalAspect', modifier: { target: 'item:Longsword:rank', value: '1' } }]);
  });

  it('a name that matches no item is unresolved with reason "noItem"', () => {
    const result = resolveModifiers([{ target: 'item:Nothing:to_hit', value: '1' }], items);
    expect(result.unresolved).toEqual([{ target: 'item:Nothing:to_hit', reason: 'noItem', modifier: { target: 'item:Nothing:to_hit', value: '1' } }]);
  });

  it('percent on damage is dropped: not applied, but recorded as unresolved with reason "percentDamage"', () => {
    const modifier = { target: 'item:Longsword:damage', value: '10%' };
    const result = resolveModifiers([modifier], items);
    expect(result.itemPercent).toEqual({});
    expect(result.unresolved).toEqual([{ target: modifier.target, reason: 'percentDamage', modifier }]);
  });

  it('a percent aspect other than damage is applied', () => {
    const result = resolveModifiers([{ target: 'item:Stealth:rank', value: '10%' }], items);
    expect(result.itemPercent).toEqual({ s1: { rank: 10 } });
  });

  it('an item name containing a colon still resolves', () => {
    const colonItems = [{ id: 'w3', type: 'attack', name: 'Sword: of Legends', system: {} }];
    const result = resolveModifiers([{ target: 'item:Sword: of Legends:to_hit', value: '1' }], colonItems);
    expect(result.itemBonus).toEqual({ w3: { to_hit: 1 } });
  });
});

describe('resolveModifiers — stable item targets', () => {
  const items = [
    { id: 'A1', type: 'attack', name: 'Dagger', system: {} },
    { id: 'A2', type: 'attack', name: 'Dagger', system: {} },
    { id: 'S1', type: 'skill', name: 'Knives', system: {} },
    { _id: 'P1', type: 'spell', name: 'Firebolt', system: {} },
  ];

  it('targets exactly one item regardless of duplicate names or renames', () => {
    const modifier = { target: 'item-id:A1:to_hit', value: '2' };
    expect(resolveModifiers([modifier], items).itemBonus).toEqual({ A1: { to_hit: 2 } });
    expect(resolveModifiers([modifier], [{ ...items[0], name: 'Renamed' }, ...items.slice(1)]).itemBonus)
      .toEqual({ A1: { to_hit: 2 } });
  });

  it('handles attack, skill and spell aspects and flat, percent and dice values', () => {
    const result = resolveModifiers([
      { target: 'item-id:A1:damage', value: '+1d4' },
      { target: 'item-id:S1:rank', value: '2' },
      { target: 'item-id:P1:mana_cost', value: '25%' },
    ], items);
    expect(result.itemDice).toEqual({ A1: { damage: '+1d4' } });
    expect(result.itemBonus).toEqual({ S1: { rank: 2 } });
    expect(result.itemPercent).toEqual({ P1: { mana_cost: 25 } });
    expect(result.unresolved).toEqual([]);
  });

  it.each([
    ['item-id:missing:rank', 'noItem'],
    ['item-id:a1:to_hit', 'noItem'],
    ['item-id:A1:rank', 'illegalAspect'],
    ['item-id:P1:damage', 'illegalAspect'],
    ['item-id:A1:damage', 'percentDamage'],
    ['item-id:bad id:rank', 'parse'],
  ])('reports %s as unresolved (%s)', (target, reason) => {
    const modifier = { target, value: reason === 'percentDamage' ? '10%' : '1' };
    expect(resolveModifiers([modifier], items).unresolved).toEqual([{ target, reason, modifier }]);
  });
});

describe('resolveModifiers — canonical Attack and Spell item targets', () => {
  const attack = { id: 'a1', type: 'attack', name: 'Firebolt Attack', system: { stat: 'intelligence', damageType: 'fire' } };
  const spell = { id: 'sp1', type: 'spell', name: 'Firebolt', system: { stat: 'intelligence', class: 'wizard', rank: 2 } };

  it('to_hit/damage resolve on the Attack Item', () => {
    const toHit = resolveModifiers([{ target: 'item:Firebolt Attack:to_hit', value: '1' }], [attack]);
    expect(toHit.itemBonus).toEqual({ a1: { to_hit: 1 } });
    const damage = resolveModifiers([{ target: 'item:Firebolt Attack:damage', value: '2' }], [attack]);
    expect(damage.itemBonus).toEqual({ a1: { damage: 2 } });
  });

  it('a Spell independently resolves rank/mana_cost', () => {
    const result = resolveModifiers([{ target: 'item:Firebolt:rank', value: '1' }], [spell]);
    expect(result.itemBonus).toEqual({ sp1: { rank: 1 } });
  });

  it('to_hit/damage are unresolved for a Spell', () => {
    const toHit = resolveModifiers([{ target: 'item:Firebolt:to_hit', value: '1' }], [spell]);
    expect(toHit.itemBonus).toEqual({});
    expect(toHit.unresolved).toEqual([{
      target: 'item:Firebolt:to_hit', reason: 'illegalAspect', modifier: { target: 'item:Firebolt:to_hit', value: '1' },
    }]);
  });
});

describe('resolveModifiers — group targets', () => {
  const axe = { id: 'a1', type: 'attack', name: 'Axe', system: { stat: 'strength', damageType: 'slashing' } };
  const fire = { id: 'a2', type: 'attack', name: 'Firebolt Attack', system: { stat: 'intelligence', damageType: 'fire' } };
  const attackSpell = { id: 'sp1', type: 'spell', name: 'Firebolt', system: { stat: 'intelligence', class: 'wizard' } };
  const nonAttackSpell = { id: 'sp2', type: 'spell', name: 'Heal', system: { stat: 'intelligence', class: 'wizard' } };
  const skill = { id: 's1', type: 'skill', name: 'Stealth', system: { stat: 'dexterity', class: 'rogue' } };
  const items = [axe, fire, attackSpell, nonAttackSpell, skill];

  it('group:attacks matches canonical Attack Items', () => {
    const result = resolveModifiers([{ target: 'group:attacks:to_hit', value: '1' }], items);
    expect(result.itemBonus).toEqual({ a1: { to_hit: 1 }, a2: { to_hit: 1 } });
  });

  it('group:skills matches skill and spell items', () => {
    const result = resolveModifiers([{ target: 'group:skills:rank', value: '1' }], items);
    expect(result.itemBonus).toEqual({ sp1: { rank: 1 }, sp2: { rank: 1 }, s1: { rank: 1 } });
  });

  it('filters by attribute with a case-insensitive string equality compare', () => {
    const result = resolveModifiers([{ target: 'group:attacks:damage_type=SLASHING:damage', value: '2' }], items);
    expect(result.itemBonus).toEqual({ a1: { damage: 2 } });
  });

  it('filters a canonical Attack by damage type', () => {
    const result = resolveModifiers([{ target: 'group:attacks:damage_type=fire:damage', value: '2' }], items);
    expect(result.itemBonus).toEqual({ a2: { damage: 2 } });
  });

  it('!= against an item missing the attribute entirely treats the missing value as "" (so it matches a non-empty filter)', () => {
    const noDamageType = { id: 'w4', type: 'attack', name: 'Bare Fists', system: { stat: 'strength' } };
    const result = resolveModifiers([{ target: 'group:attacks:damage_type!=slashing:to_hit', value: '1' }], [axe, noDamageType]);
    expect(result.itemBonus).toEqual({ w4: { to_hit: 1 } });
  });

  it('an attribute outside the section allowlist (attacks: stat, damage_type; skills: stat, class) is unresolved with reason "illegalAttribute"', () => {
    const modifier = { target: 'group:attacks:class=wizard:to_hit', value: '1' };
    const result = resolveModifiers([modifier], items);
    expect(result.itemBonus).toEqual({});
    expect(result.unresolved).toEqual([{ target: modifier.target, reason: 'illegalAttribute', modifier }]);
  });

  it.each([
    ['attacks', 'group:attacks:class=:to_hit'],
    ['skills', 'group:skills:damage_type!=:rank'],
    ['attacks (unknown attribute)', 'group:attacks:bogus=  :to_hit'],
  ])('an illegal attribute with an empty value (%s) is still unresolved with reason "illegalAttribute"', (_label, target) => {
    const modifier = { target, value: '1' };
    const result = resolveModifiers([modifier], items);
    expect(result.itemBonus).toEqual({});
    expect(result.unresolved).toEqual([{ target, reason: 'illegalAttribute', modifier }]);
  });

  it('a legal attribute with an empty value applies to the whole section (bare group)', () => {
    const bare = resolveModifiers([{ target: 'group:attacks:to_hit', value: '1' }], items);
    const empty = resolveModifiers([{ target: 'group:attacks:stat=:to_hit', value: '1' }], items);
    expect(empty.unresolved).toEqual([]);
    expect(empty.itemBonus).toEqual(bare.itemBonus);
    expect(Object.keys(empty.itemBonus).length).toBeGreaterThan(0);
  });

  it('filters by attribute with a negated-equality compare', () => {
    const result = resolveModifiers([{ target: 'group:skills:class!=rogue:rank', value: '1' }], items);
    expect(result.itemBonus).toEqual({ sp1: { rank: 1 }, sp2: { rank: 1 } });
  });

  it('percent on damage is dropped for group targets too, and recorded as unresolved with reason "percentDamage"', () => {
    const modifier = { target: 'group:attacks:damage', value: '10%' };
    const result = resolveModifiers([modifier], items);
    expect(result.itemPercent).toEqual({});
    expect(result.unresolved).toEqual([{ target: modifier.target, reason: 'percentDamage', modifier }]);
  });

  it('a group matching no items is NOT unresolved — it is a legitimate empty result', () => {
    const result = resolveModifiers([{ target: 'group:attacks:stat=charisma:to_hit', value: '1' }], items);
    expect(result.itemBonus).toEqual({});
    expect(result.unresolved).toEqual([]);
  });

  it('an unknown section is unresolved with reason "unknownSection"', () => {
    const modifier = { target: 'group:bogus:rank', value: '1' };
    const result = resolveModifiers([modifier], items);
    expect(result.unresolved).toEqual([{ target: modifier.target, reason: 'unknownSection', modifier }]);
  });

  it('an aspect illegal for a known section is unresolved with reason "illegalAspect"', () => {
    const modifier = { target: 'group:attacks:rank', value: '1' };
    const result = resolveModifiers([modifier], items);
    expect(result.unresolved).toEqual([{ target: modifier.target, reason: 'illegalAspect', modifier }]);
  });

  it('an item modifier and a group modifier sum onto the same item', () => {
    const result = resolveModifiers([
      { target: 'item:Axe:to_hit', value: '1' },
      { target: 'group:attacks:to_hit', value: '2' },
    ], items);
    expect(result.itemBonus).toEqual({ a1: { to_hit: 3 }, a2: { to_hit: 2 } });
  });
});

describe('resolveModifiers — robustness', () => {
  it('tolerates null/undefined mods and items', () => {
    const empty = { bonus: {}, percent: {}, itemBonus: {}, itemPercent: {}, dice: {}, itemDice: {}, unresolved: [] };
    expect(resolveModifiers(null, null)).toEqual(empty);
    expect(resolveModifiers(undefined, undefined)).toEqual(empty);
  });

  it('an undefined modifier.target is unresolved with reason "parse"', () => {
    const modifier = { value: '1' };
    const result = resolveModifiers([modifier], []);
    expect(result.unresolved).toEqual([{ target: undefined, reason: 'parse', modifier }]);
  });
});

// The value vocabulary is R20's snake_case exactly (shared compendium); the old
// Foundry spellings have no aliases, so a stale change key surfaces as Unresolved.
describe('resolveModifiers — old Foundry spellings are not aliases', () => {
  const items = [
    { id: 'w1', type: 'attack', name: 'Longsword', system: { stat: 'strength', damageType: 'slashing' } },
    { id: 'sp1', type: 'spell', name: 'Firebolt', system: { stat: 'intelligence', manaCost: 4 } },
  ];

  it.each([
    ['dr (field)', 'dr', 'parse'],
    ['tohit (item aspect)', 'item:Longsword:tohit', 'illegalAspect'],
    ['manaCost (item aspect)', 'item:Firebolt:manaCost', 'illegalAspect'],
    ['weapons (section)', 'group:weapons:to_hit', 'unknownSection'],
    ['dmgType (group attribute)', 'group:attacks:dmgType=slashing:damage', 'illegalAttribute'],
  ])('%s is unresolved', (_label, target, reason) => {
    const modifier = { target, value: '1' };
    const result = resolveModifiers([modifier], items);
    expect(result.bonus).toEqual({});
    expect(result.itemBonus).toEqual({});
    expect(result.unresolved).toEqual([{ target, reason, modifier }]);
  });

  it('the new spellings resolve: damage_resistance, to_hit, mana_cost, attacks, damage_type', () => {
    const result = resolveModifiers([
      { target: 'damage_resistance', value: '2' },
      { target: 'item:Longsword:to_hit', value: '1' },
      { target: 'item:Firebolt:mana_cost', value: '-1' },
      { target: 'group:attacks:damage_type=slashing:damage', value: '3' },
    ], items);
    expect(result.bonus).toEqual({ damage_resistance: 2 });
    expect(result.itemBonus).toEqual({ w1: { to_hit: 1, damage: 3 }, sp1: { mana_cost: -1 } });
    expect(result.unresolved).toEqual([]);
  });
});
