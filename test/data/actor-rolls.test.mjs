import { describe, it, expect, vi, beforeEach } from 'vitest';

// Glue test for DCCActor's roll entry points: which formulas/fields reach
// postCard and which updates follow a cast. The real card is a live gate.
vi.mock('../../module/rolls/card.mjs', () => ({
  postCard: vi.fn(async (actor, fields, formulas) => ({ fields, formulas })),
}));
const { postCard } = await import('../../module/rolls/card.mjs');
const { default: DCCActor } = await import('../../module/documents/actor.mjs');

const makeActor = (system = {}) => {
  const actor = new DCCActor({ type: 'pc', name: 'Carl', system: { mana: { value: 5, max: 10 }, autoEnableCast: true, ...system } });
  actor.update = vi.fn(async () => actor);
  return actor;
};
let nextId = 0;
const makeItem = (type, name, system = {}, derived = {}) => {
  const item = { id: `i${++nextId}`, type, name, system: { ...system, derived } };
  item.update = vi.fn(async () => item);
  return item;
};

beforeEach(() => postCard.mockClear());

/** Owned item: parented to `actor`. */
const own = (actor, item) => Object.assign(item, { parent: actor });

describe('rollSkill', () => {
  it('rolls 1d20 + skillBonus tagged with the check type', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('skill', 'Knives', { checkType: 'opposed' }, { skillBonus: 4 })));
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Knives', tag: 'DCC.CheckType.opposed' });
    expect(formulas).toEqual({ roll: '1d20 + 4' });
  });
  it('an Opposed skill names the opposing stat in its tag', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('skill', 'Persuade', {
      checkType: 'opposed', opposedStat: 'charisma',
    }, { skillBonus: 4 })));
    expect(postCard.mock.calls[0][1].tag).toBe('CHA-DCC.CheckType.opposed');
  });
  it('a Passive skill posts its description without a d20', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('skill', 'Powerful', {
      checkType: 'passive', description: '<p>Multiply damage.</p><p>Rank 2: +1</p>',
    }, { skillBonus: 2 })));
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Powerful', tag: 'DCC.CheckType.passive', note: 'Multiply damage.\nRank 2: +1' });
    expect(formulas).toEqual({});
  });
  it('a spell routes to castSpell (spends mana)', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 3 })));
    expect(postCard.mock.calls[0][1].cost).toBe(3);
    expect(actor.update).toHaveBeenCalledWith({ 'system.mana.value': 2 });
  });
  it('no derived bonus -> no card', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('skill', 'X')));
    expect(postCard).not.toHaveBeenCalled();
  });
});

describe('rollWeapon', () => {
  it('to-hit: 1d20 + toHit', async () => {
    const actor = makeActor();
    await actor.rollWeapon(own(actor, makeItem('weapon', 'Dagger', { die: '1d4', damageType: 'piercing' }, { toHit: 4, damageBase: 0 })), 'toHit');
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Dagger', tag: 'DCC.Roll.ToHit' });
    expect(formulas).toEqual({ roll: '1d20 + 4' });
  });
  it('damage: die + damageBase with the damage type', async () => {
    const actor = makeActor();
    await actor.rollWeapon(own(actor, makeItem('weapon', 'Dagger', { die: '1d4', damageType: 'piercing' }, { toHit: 4, damageBase: 2 })), 'damage');
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Dagger', tag: 'DCC.Roll.Damage', type: 'piercing' });
    expect(formulas).toEqual({ damage: '1d4 + 2' });
  });
  it('damage with a blank die rolls damageBase alone', async () => {
    const actor = makeActor();
    await actor.rollWeapon(own(actor, makeItem('weapon', 'Punch', { die: '', damageType: '' }, { damageBase: 3 })), 'damage');
    expect(postCard.mock.calls[0][2]).toEqual({ damage: '3' });
  });
  it('spell attack: damage uses attack.die / attack.damageType', async () => {
    const spell = makeItem('spell', 'Firebolt', { attack: { enabled: true, die: '2d6', damageType: 'fire' } }, { damageBase: 1, skillBonus: 2, manaCostEffective: 1 });
    const actor = makeActor();
    await actor.rollWeapon(own(actor, spell), 'damage');
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields.type).toBe('fire');
    expect(formulas).toEqual({ damage: '2d6 + 1' });
  });
  it('spell attack: to-hit casts the spell (dual entry)', async () => {
    const actor = makeActor();
    const spell = makeItem('spell', 'Firebolt', { enabled: true, attack: { enabled: true, die: '2d6' } }, { toHit: 9, skillBonus: 2, manaCostEffective: 1 });
    await actor.rollWeapon(own(actor, spell), 'toHit');
    expect(postCard.mock.calls[0][2]).toEqual({ roll: '1d20 + 2' });
    expect(actor.update).toHaveBeenCalledWith({ 'system.mana.value': 4 });
  });
});

describe('castSpell', () => {
  it('affordable: card with cost, mana spent, spell enabled', async () => {
    const actor = makeActor({ mana: { value: 5, max: 10 } });
    const spell = makeItem('spell', 'Zap', { enabled: false, checkType: 'unopposed' }, { skillBonus: 1, manaCostEffective: 3 });
    await actor.castSpell(own(actor, spell));
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Zap', tag: 'DCC.CheckType.unopposed', cost: 3, insufficient: false });
    expect(formulas).toEqual({ roll: '1d20 + 1' });
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(actor.update).toHaveBeenCalledWith({ 'system.mana.value': 2 });
    expect(spell.update).toHaveBeenCalledTimes(1);
    expect(spell.update).toHaveBeenCalledWith({ 'system.enabled': true });
  });
  it('insufficient: card flagged, mana untouched', async () => {
    const actor = makeActor({ mana: { value: 0, max: 0 }, autoEnableCast: false });
    const spell = makeItem('spell', 'Zap', { enabled: false }, { skillBonus: 1, manaCostEffective: 3 });
    await actor.castSpell(own(actor, spell));
    expect(postCard.mock.calls[0][1].insufficient).toBe(true);
    expect(actor.update).not.toHaveBeenCalled();
    expect(spell.update).not.toHaveBeenCalled();
  });
  it('already enabled: no item update', async () => {
    const actor = makeActor();
    const spell = makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 1 });
    await actor.castSpell(own(actor, spell));
    expect(spell.update).not.toHaveBeenCalled();
  });
  it('a Passive spell spends mana and posts no d20', async () => {
    const actor = makeActor();
    const spell = makeItem('spell', 'Aura', {
      enabled: true, checkType: 'passive',
    }, { skillBonus: 2, manaCostEffective: 3 });
    await actor.castSpell(own(actor, spell));
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Aura', tag: 'DCC.CheckType.passive', cost: 3, insufficient: false });
    expect(formulas).toEqual({});
    expect(actor.update).toHaveBeenCalledWith({ 'system.mana.value': 2 });
  });
  it('not a spell -> nothing', async () => {
    const actor = makeActor();
    await actor.castSpell(own(actor, makeItem('skill', 'Knives', {}, { skillBonus: 1 })));
    expect(postCard).not.toHaveBeenCalled();
  });
});

describe('roll options and ownership', () => {
  const speaker = { alias: 'Crew: Carl' };
  it('forwards options (speaker) to postCard for every entry point, incl. spell reroutes', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('skill', 'K', {}, { skillBonus: 1 })), { speaker });
    await actor.rollWeapon(own(actor, makeItem('weapon', 'W', { die: '1d4' }, { toHit: 1, damageBase: 0 })), 'toHit', { speaker });
    await actor.rollWeapon(own(actor, makeItem('weapon', 'W', { die: '1d4' }, { toHit: 1, damageBase: 0 })), 'damage', { speaker });
    await actor.rollSkill(own(actor, makeItem('spell', 'S', { enabled: true }, { skillBonus: 1, manaCostEffective: 0 })), { speaker });
    await actor.rollWeapon(own(actor, makeItem('spell', 'S', { enabled: true }, { skillBonus: 1, manaCostEffective: 0 })), 'toHit', { speaker });
    expect(postCard).toHaveBeenCalledTimes(5);
    for (const call of postCard.mock.calls) expect(call[3]).toEqual({ speaker });
  });
  it('an item owned by another actor rolls nothing', async () => {
    const actor = makeActor();
    const other = makeActor();
    await actor.rollSkill(own(other, makeItem('skill', 'K', {}, { skillBonus: 1 })));
    await actor.rollWeapon(own(other, makeItem('weapon', 'W', {}, { toHit: 1 })));
    await actor.castSpell(own(other, makeItem('spell', 'S', {}, { skillBonus: 1 })));
    await actor.rollSkill(makeItem('skill', 'Unowned', {}, { skillBonus: 1 }));
    expect(postCard).not.toHaveBeenCalled();
  });
});

describe('castSpell guard and order', () => {
  it('spends mana before posting the card', async () => {
    const actor = makeActor({ mana: { value: 5, max: 10 } });
    const order = [];
    actor.update.mockImplementation(async () => { order.push('update'); return actor; });
    postCard.mockImplementationOnce(async () => { order.push('card'); return {}; });
    await actor.castSpell(own(actor, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 3 })));
    expect(order).toEqual(['update', 'card']);
  });
  it('concurrent casts of one spell: the second is dropped (one cost)', async () => {
    const actor = makeActor({ mana: { value: 5, max: 10 } });
    let release;
    postCard.mockImplementationOnce(() => new Promise(r => { release = () => r({}); }));
    const spell = own(actor, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 3 }));
    const first = actor.castSpell(spell);
    const second = await actor.castSpell(spell);
    expect(second).toBeNull();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await first;
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(postCard).toHaveBeenCalledTimes(1);
    // guard released: a later cast goes through
    await actor.castSpell(spell);
    expect(postCard).toHaveBeenCalledTimes(2);
  });
  it('concurrent casts of two different spells: the second is dropped (guard is per actor)', async () => {
    const actor = makeActor({ mana: { value: 5, max: 10 } });
    let release;
    postCard.mockImplementationOnce(() => new Promise(r => { release = () => r({}); }));
    const zap = own(actor, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 3 }));
    const bolt = own(actor, makeItem('spell', 'Bolt', { enabled: true }, { skillBonus: 1, manaCostEffective: 3 }));
    const first = actor.castSpell(zap);
    expect(await actor.castSpell(bolt)).toBeNull();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await first;
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(postCard).toHaveBeenCalledTimes(1);
  });
  it('the guard is per actor: another actor can cast meanwhile', async () => {
    const a = makeActor();
    const b = makeActor();
    let release;
    postCard.mockImplementationOnce(() => new Promise(r => { release = () => r({}); }));
    const first = a.castSpell(own(a, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1 })));
    await b.castSpell(own(b, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1 })));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await first;
    expect(postCard).toHaveBeenCalledTimes(2);
  });
  it('the guard is released when the card throws', async () => {
    const actor = makeActor();
    const spell = own(actor, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 0 }));
    postCard.mockImplementationOnce(async () => { throw new Error('boom'); });
    await expect(actor.castSpell(spell)).rejects.toThrow('boom');
    await actor.castSpell(spell);
    expect(postCard).toHaveBeenCalledTimes(2);
  });
  it('an actor without mana (mob) casts a plain check: no mana update, no cost / insufficient flag', async () => {
    const mob = new DCCActor({ type: 'mob', name: 'Goblin', system: {} });
    mob.update = vi.fn();
    const spell = own(mob, makeItem('spell', 'Hex', { enabled: true, checkType: 'opposed' }, { skillBonus: 2, manaCostEffective: 3 }));
    await expect(mob.castSpell(spell)).resolves.toBeDefined();
    expect(mob.update).not.toHaveBeenCalled();
    // No mana pool: a plain check card (no cost, no insufficient-mana flag).
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Hex', tag: 'DCC.CheckType.opposed' });
    expect(formulas).toEqual({ roll: '1d20 + 2' });
  });
});

describe('useHotlistItem', () => {
  const speaker = { alias: 'Crew: Carl' };
  it('spell -> castSpell (mana spent)', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('spell', 'Zap', { enabled: true }, { skillBonus: 1, manaCostEffective: 3 })));
    expect(postCard.mock.calls[0][1]).toMatchObject({ name: 'Zap', cost: 3 });
    expect(actor.update).toHaveBeenCalledWith({ 'system.mana.value': 2 });
  });
  it('weapon -> to-hit roll', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('weapon', 'Dagger', { die: '1d4' }, { toHit: 4, damageBase: 0 })));
    expect(postCard.mock.calls[0][1]).toEqual({ name: 'Dagger', tag: 'DCC.Roll.ToHit' });
    expect(postCard.mock.calls[0][2]).toEqual({ roll: '1d20 + 4' });
  });
  it('skill -> skill check', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('skill', 'Knives', { checkType: 'opposed' }, { skillBonus: 2 })));
    expect(postCard.mock.calls[0][2]).toEqual({ roll: '1d20 + 2' });
  });
  it('gear -> a roll-less card with the plain-text description', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('gear', 'Rations', { description: '<p>Eat &amp; heal</p>' })), { speaker });
    const [, fields, formulas, options] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Rations', tag: 'TYPES.Item.gear', note: 'Eat & heal' });
    expect(formulas).toEqual({});
    expect(options).toEqual({ speaker });
  });
  it('gear without a description -> card with no note', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('gear', 'Rope', {})));
    expect(postCard.mock.calls[0][1]).toEqual({ name: 'Rope', tag: 'TYPES.Item.gear', note: '' });
  });
  it('forwards options for rolls too', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('weapon', 'W', {}, { toHit: 1 })), { speaker });
    expect(postCard.mock.calls[0][3]).toEqual({ speaker });
  });
  it('an item not owned by this actor -> null, nothing posted', async () => {
    const actor = makeActor();
    expect(await actor.useHotlistItem(own(makeActor(), makeItem('gear', 'Rope', {})))).toBeNull();
    expect(await actor.useHotlistItem(makeItem('gear', 'Rope', {}))).toBeNull();
    expect(postCard).not.toHaveBeenCalled();
  });
});
