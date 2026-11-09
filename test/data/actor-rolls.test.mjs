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
  actor.items = { contents: [] };
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
const own = (actor, item) => {
  item.parent = actor;
  actor.items ??= { contents: [] };
  if (!actor.items.contents.includes(item)) actor.items.contents.push(item);
  return item;
};

describe('rollSkill', () => {
  it('rolls 1d20 + skillBonus tagged with the check type', async () => {
    const actor = makeActor();
    await actor.rollSkill(own(actor, makeItem('skill', 'Knives', { checkType: 'opposed' }, { skillBonus: 4 })));
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Knives', tag: 'DCC.CheckType.opposed' });
    expect(formulas).toEqual({ roll: '1d20 + 4' });
  });

  describe('rollSkillCheck', () => {
    it('rolls a utility d20 against base Rank and reports equality as Success without changing Rank', async () => {
      const actor = makeActor();
      const skill = own(actor, makeItem('skill', 'Bow', {
        rank: 7,
      }, { rankEffective: 10 }));
      await actor.rollSkillCheck(skill);
      const [, fields, formulas] = postCard.mock.calls[0];
      expect(formulas).toEqual({ roll: '1d20' });
      expect(fields).toBeTypeOf('function');
      expect(fields({ check: { total: 7, d20: 7 } })).toEqual({
        name: 'Bow',
        tag: 'DCC.Advance.SkillCheck',
        dc: 7,
        result: 'DCC.Advance.Success',
        utility: true,
      });
      expect(skill.system.rank).toBe(7);
      expect(skill.update).not.toHaveBeenCalled();
    });

    it('reports Failure below base Rank', async () => {
      const actor = makeActor();
      await actor.rollSkillCheck(own(actor, makeItem('spell', 'Rootfoot', { rank: 7 })));
      const fields = postCard.mock.calls[0][1];
      expect(fields({ check: { total: 6, d20: 6 } }).result).toBe('DCC.Advance.Failure');
    });

    it('refuses Passive, unowned, non-skill, and non-PC rows', async () => {
      const actor = makeActor();
      await actor.rollSkillCheck(own(actor, makeItem('skill', 'Aura', { rank: 2, checkType: 'passive' })));
      await actor.rollSkillCheck(makeItem('skill', 'Unowned', { rank: 2 }));
      await actor.rollSkillCheck(own(actor, makeItem('weapon', 'Sword', { rank: 2 })));
      const mob = new DCCActor({ type: 'mob', name: 'Goblin', system: {} });
      await mob.rollSkillCheck(own(mob, makeItem('skill', 'Sneak', { rank: 2 })));
      expect(postCard).not.toHaveBeenCalled();
    });
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

describe('rollAttack', () => {
  it('to-hit: 1d20 + toHit', async () => {
    const actor = makeActor();
    await actor.rollAttack(own(actor, makeItem('attack', 'Dagger', { die: '1d4', damageType: 'piercing' }, { toHit: 4, damageBase: 0 })), 'toHit');
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Dagger', tag: 'DCC.Roll.ToHit' });
    expect(formulas).toEqual({ roll: '1d20 + 4' });
  });
  it('damage: die + damageBase with the damage type', async () => {
    const actor = makeActor();
    await actor.rollAttack(own(actor, makeItem('attack', 'Dagger', { die: '1d4', damageType: 'piercing' }, { toHit: 4, damageBase: 2, damageDice: '1d4' })), 'damage');
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toEqual({ name: 'Dagger', tag: 'DCC.Roll.Damage', type: 'piercing' });
    expect(formulas).toEqual({ damage: '1d4 + 2' });
  });
  it('damage with a blank die rolls damageBase alone', async () => {
    const actor = makeActor();
    await actor.rollAttack(own(actor, makeItem('attack', 'Punch', { die: '', damageType: '' }, { damageBase: 3, damageDice: '' })), 'damage');
    expect(postCard.mock.calls[0][2]).toEqual({ damage: '3' });
  });
  it('damage includes roll-time modifier dice from derivation', async () => {
    const actor = makeActor();
    const item = makeItem('attack', 'Dagger', { die: '1d4' }, {
      damageBase: 2, damageModifierDice: '+1d6', damageDice: '1d4+1d6',
    });
    await actor.rollAttack(own(actor, item), 'damage');
    expect(postCard.mock.calls[0][2]).toEqual({ damage: '1d4+1d6 + 2' });
  });
  it.each([
    ['', 3, '3'],
    ['+1d4', 0, '0+1d4'],
    ['-1d4', 2, '0-1d4 + 2'],
  ])('Mob damage rolls normalized dice %j with base %i', async (damageDice, damageBase, formula) => {
    const mob = new DCCActor({ type: 'mob', name: 'Goblin', system: {} });
    const attack = own(mob, makeItem('attack', 'Aura', { die: 'none' }, {
      noDamage: false, damageBase, damageDice,
    }));
    await mob.rollAttack(attack, 'damage');
    expect(postCard.mock.calls[0][2]).toEqual({ damage: formula });
  });
  it('a Spell-linked Attack rolls its own damage fields', async () => {
    const attack = makeItem('attack', 'Firebolt', { die: '2d6', damageType: 'fire' }, { damageBase: 1, damageDice: '2d6' });
    const actor = makeActor();
    await actor.rollAttack(own(actor, attack), 'damage');
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields.type).toBe('fire');
    expect(formulas).toEqual({ damage: '2d6 + 1' });
  });
  it('a Spell-linked Attack to-hit casts the source Spell (dual entry)', async () => {
    const actor = makeActor();
    const spell = own(actor, makeItem('spell', 'Firebolt', { enabled: true }, { skillBonus: 2, manaCostEffective: 1 }));
    const attack = own(actor, makeItem('attack', 'Firebolt Attack', {
      linkedItemIds: [spell.id],
    }, { toHit: 9 }));
    spell.system.linkedItemIds = [attack.id];
    await actor.rollAttack(attack, 'toHit');
    expect(postCard.mock.calls[0][2]).toEqual({ roll: '1d20 + 2' });
    expect(actor.update).toHaveBeenCalledWith({ 'system.mana.value': 4 });
  });
  it('an alternate Skill Use rolls its own To-Hit, name, and range', async () => {
    const actor = makeActor();
    const attack = own(actor, makeItem('attack', 'Dagger', {}, {
      toHit: 5,
      skillUses: [{ label: 'thrown', toHit: 9, range: '20ft', damageBase: 2, damageDice: '1d4' }],
    }));
    await actor.rollAttack(attack, 'toHit', { skillUseIndex: 0 });
    expect(postCard.mock.calls[0][1]).toEqual({
      name: 'Dagger (thrown)',
      tag: 'DCC.Roll.ToHit',
      range: '20ft',
    });
    expect(postCard.mock.calls[0][2]).toEqual({ roll: '1d20 + 9' });
  });
  it('an alternate Skill Use reuses the parent Attack damage', async () => {
    const actor = makeActor();
    const attack = own(actor, makeItem('attack', 'Dagger', { damageType: 'piercing' }, {
      damageBase: 2,
      damageDice: '1d4',
      skillUses: [{ label: 'thrown', toHit: 9, range: '20ft' }],
    }));
    await actor.rollAttack(attack, 'damage', { skillUseIndex: 0 });
    expect(postCard.mock.calls[0][1]).toEqual({
      name: 'Dagger (thrown)',
      tag: 'DCC.Roll.Damage',
      type: 'piercing',
      range: '20ft',
    });
    expect(postCard.mock.calls[0][2]).toEqual({ damage: '1d4 + 2' });
  });
  it('an alternate use of a Spell-granted Attack rolls normally without casting the source Spell', async () => {
    const actor = makeActor();
    const spell = own(actor, makeItem('spell', 'Magic Missile', { linkedItemIds: [] }, {
      skillBonus: 3, manaCostEffective: 2,
    }));
    const attack = own(actor, makeItem('attack', 'Magic Missile', { linkedItemIds: [spell.id] }, {
      toHit: 3,
      skillUses: [{ label: 'aimed', toHit: 7, range: '' }],
    }));
    spell.system.linkedItemIds = [attack.id];
    await actor.rollAttack(attack, 'toHit', { skillUseIndex: 0 });
    expect(postCard.mock.calls[0][2]).toEqual({ roll: '1d20 + 7' });
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('does not roll a Mob Attack with no To-Hit, but still rolls its damage', async () => {
    const mob = new DCCActor({ type: 'mob', name: 'Goblin', system: {} });
    const attack = own(mob, makeItem('attack', 'Aura', { damageType: 'fire' }, {
      toHit: 0, mobToHitNone: true, damageBase: 2, damageDice: '1d6',
      skillUses: [{ label: 'alternate', toHit: 0, mobToHitNone: true }],
    }));
    expect(await mob.rollAttack(attack, 'toHit')).toBeNull();
    expect(await mob.rollAttack(attack, 'toHit', { skillUseIndex: 0 })).toBeNull();
    expect(postCard).not.toHaveBeenCalled();
    await mob.rollAttack(attack, 'damage');
    expect(postCard).toHaveBeenCalledTimes(1);
    expect(postCard.mock.calls[0][2]).toEqual({ damage: '1d6 + 2' });
  });
  it('refuses primary and alternate No Damage Mob rolls with a notification', async () => {
    const savedUi = globalThis.ui;
    globalThis.ui = { notifications: { warn: vi.fn() } };
    try {
      const mob = new DCCActor({ type: 'mob', name: 'Goblin', system: {} });
      const attack = own(mob, makeItem('attack', 'Aura', {}, {
        noDamage: true, damageBase: 0, damageDice: '',
        skillUses: [{ label: 'alternate', noDamage: true }],
      }));
      expect(await mob.rollAttack(attack, 'damage')).toBeNull();
      expect(await mob.rollAttack(attack, 'damage', { skillUseIndex: 0 })).toBeNull();
      expect(postCard).not.toHaveBeenCalled();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(2);
      expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Roll.NoDamageWarning');
    } finally {
      globalThis.ui = savedUi;
    }
  });
  it.each(['pc', 'vehicle'])('refuses no-damage rolls for %s', async type => {
    const actor = new DCCActor({ type, system: {} });
    const attack = own(actor, makeItem('attack', 'Aura', {}, { noDamage: true, damageBase: 0, damageDice: '' }));
    const savedUi = globalThis.ui;
    globalThis.ui = { notifications: { warn: vi.fn() } };
    try {
      expect(await actor.rollAttack(attack, 'damage')).toBeNull();
      expect(ui.notifications.warn).toHaveBeenCalledOnce();
      expect(postCard).not.toHaveBeenCalled();
    } finally { globalThis.ui = savedUi; }
  });
  it.each([
    [true, true, { range: '20ft', notes: 'Reach. · Push.' }],
    [true, false, { range: '20ft' }],
    [false, true, { notes: 'Reach. · Push.' }],
    [false, false, {}],
  ])('applies independent chat settings to both Attack rolls (%s, %s)', async (showRangeInChat, showNotesInChat, extras) => {
    const actor = makeActor({ showRangeInChat, showNotesInChat });
    const attack = own(actor, makeItem('attack', 'Spear', {
      range: ' 20ft ', description: '<p>Reach.</p><p>Push.</p>',
    }, { toHit: 4, damageBase: 1, damageDice: '1d6' }));
    await actor.rollAttack(attack, 'toHit');
    await actor.rollAttack(attack, 'damage');
    const fields = postCard.mock.calls.map(call => call[1]);
    for (const card of fields) {
      expect(card.range).toBe(extras.range);
      expect(card.notes).toBe(extras.notes);
    }
  });
  it('alternate To-Hit and Damage use the selected range and parent notes under the same settings', async () => {
    const actor = makeActor();
    const attack = own(actor, makeItem('attack', 'Dagger', {
      range: '5ft', description: '<p>Sharp.</p>',
    }, {
      toHit: 4, damageBase: 1, damageDice: '1d4',
      skillUses: [{ label: 'thrown', toHit: 6, range: '20ft' }],
    }));
    for (const which of ['toHit', 'damage']) await actor.rollAttack(attack, which, { skillUseIndex: 0 });
    for (const call of postCard.mock.calls) expect(call[1]).toMatchObject({ range: '20ft', notes: 'Sharp.' });
    actor.system.showRangeInChat = false;
    actor.system.showNotesInChat = false;
    await actor.rollAttack(attack, 'toHit', { skillUseIndex: 0 });
    expect(postCard.mock.calls[2][1]).not.toHaveProperty('range');
    expect(postCard.mock.calls[2][1]).not.toHaveProperty('notes');
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
  it('a spell cast includes populated Duration and Cooldown metadata', async () => {
    const actor = makeActor();
    const spell = makeItem('spell', 'Rootfoot', {
      enabled: true, duration: '2 rounds', cooldown: 'Once per scene',
    }, { skillBonus: 2, manaCostEffective: 1 });
    await actor.castSpell(own(actor, spell));
    expect(postCard.mock.calls[0][1]).toEqual({
      name: 'Rootfoot',
      tag: 'DCC.CheckType.opposed',
      duration: '2 rounds',
      cooldown: 'Once per scene',
      cost: 1,
      insufficient: false,
    });
  });
  it('a spell cast omits blank Duration and Cooldown metadata', async () => {
    const actor = makeActor();
    const spell = makeItem('spell', 'Zap', {
      enabled: true, duration: ' ', cooldown: '',
    }, { skillBonus: 2, manaCostEffective: 1 });
    await actor.castSpell(own(actor, spell));
    expect(postCard.mock.calls[0][1]).not.toHaveProperty('duration');
    expect(postCard.mock.calls[0][1]).not.toHaveProperty('cooldown');
  });
  it('Spell, linked Attack, and hotlist cast paths share own extras and spend mana once per cast', async () => {
    const actor = makeActor();
    const spell = own(actor, makeItem('spell', 'Zap', {
      enabled: true, range: '30ft', description: '<p>Own note.</p>', duration: '2 rounds', cooldown: 'Once',
    }, { skillBonus: 3, manaCostEffective: 1 }));
    const attack = own(actor, makeItem('attack', 'Zap Attack', {
      linkedItemIds: [spell.id], range: '60ft', description: '<p>Attack note.</p>',
    }, { toHit: 3 }));
    spell.system.linkedItemIds = [attack.id];
    await actor.castSpell(spell);
    await actor.rollAttack(attack, 'toHit');
    await actor.useHotlistItem(spell);
    await actor.useHotlistItem(attack);
    for (const call of postCard.mock.calls) expect(call[1]).toMatchObject({
      range: '30ft', notes: 'Own note.', duration: '2 rounds', cooldown: 'Once',
    });
    expect(actor.update).toHaveBeenCalledTimes(4);
  });
  it('a Passive Spell falls back to its linked Attack for blank text, while duration and cooldown ignore toggles', async () => {
    const actor = makeActor();
    const spell = own(actor, makeItem('spell', 'Aura', {
      enabled: true, checkType: 'passive', range: ' ', description: '<p></p>',
      duration: '2 rounds', cooldown: 'After rest',
    }, { skillBonus: 2, manaCostEffective: 1 }));
    const attack = own(actor, makeItem('attack', 'Aura Attack', {
      linkedItemIds: [spell.id], range: '5ft', description: '<p>Fallback.</p>',
    }, { toHit: 2 }));
    spell.system.linkedItemIds = [attack.id];
    await actor.castSpell(spell);
    expect(postCard.mock.calls[0][1]).toMatchObject({
      range: '5ft', notes: 'Fallback.', duration: '2 rounds', cooldown: 'After rest',
    });
    expect(postCard.mock.calls[0][2]).toEqual({});
    actor.system.showRangeInChat = false;
    actor.system.showNotesInChat = false;
    await actor.castSpell(spell);
    expect(postCard.mock.calls[1][1]).not.toHaveProperty('range');
    expect(postCard.mock.calls[1][1]).not.toHaveProperty('notes');
    expect(postCard.mock.calls[1][1]).toMatchObject({ duration: '2 rounds', cooldown: 'After rest' });
  });
  it('an unaffordable cast still includes chat extras and does not spend mana', async () => {
    const actor = makeActor({ mana: { value: 0, max: 0 }, autoEnableCast: false });
    const spell = own(actor, makeItem('spell', 'Zap', {
      range: '10ft', description: '<p>Shock.</p>', duration: '1 round',
    }, { skillBonus: 1, manaCostEffective: 2 }));
    await actor.castSpell(spell);
    expect(postCard.mock.calls[0][1]).toMatchObject({
      range: '10ft', notes: 'Shock.', duration: '1 round', insufficient: true,
    });
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('Mob Spell casts use the same chat extras without inventing mana costs', async () => {
    const actor = makeActor({ mana: undefined });
    actor.type = 'mob';
    const spell = own(actor, makeItem('spell', 'Zap', {
      enabled: true, range: '10ft', description: '<p>Shock.</p>',
    }, { skillBonus: 1, manaCostEffective: 2 }));
    await actor.castSpell(spell);
    expect(postCard.mock.calls[0][1]).toMatchObject({ range: '10ft', notes: 'Shock.' });
    expect(postCard.mock.calls[0][1]).not.toHaveProperty('cost');
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
    await actor.rollAttack(own(actor, makeItem('attack', 'W', { die: '1d4' }, { toHit: 1, damageBase: 0 })), 'toHit', { speaker });
    await actor.rollAttack(own(actor, makeItem('attack', 'W', { die: '1d4' }, { toHit: 1, damageBase: 0, damageDice: '1d4' })), 'damage', { speaker });
    await actor.rollSkill(own(actor, makeItem('spell', 'S', { enabled: true }, { skillBonus: 1, manaCostEffective: 0 })), { speaker });
    const spell = own(actor, makeItem('spell', 'S', { enabled: true }, { skillBonus: 1, manaCostEffective: 0 }));
    const attack = own(actor, makeItem('attack', 'S Attack', { linkedItemIds: [spell.id] }, { toHit: 1 }));
    spell.system.linkedItemIds = [attack.id];
    await actor.rollAttack(attack, 'toHit', { speaker });
    expect(postCard).toHaveBeenCalledTimes(5);
    for (const call of postCard.mock.calls) expect(call[3]).toEqual({ speaker });
  });
  it('an item owned by another actor rolls nothing', async () => {
    const actor = makeActor();
    const other = makeActor();
    await actor.rollSkill(own(other, makeItem('skill', 'K', {}, { skillBonus: 1 })));
    await actor.rollAttack(own(other, makeItem('attack', 'W', {}, { toHit: 1 })));
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
  it('a Mob spends its mana and reports the cost when casting', async () => {
    const mob = new DCCActor({ type: 'mob', name: 'Goblin', system: { mana: { value: 5, max: 10 } } });
    mob.update = vi.fn();
    const spell = own(mob, makeItem('spell', 'Hex', { enabled: true, checkType: 'opposed' }, { skillBonus: 2, manaCostEffective: 3 }));
    await expect(mob.castSpell(spell)).resolves.toBeDefined();
    expect(mob.update).toHaveBeenCalledWith({ 'system.mana.value': 2 });
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields).toMatchObject({ name: 'Hex', tag: 'DCC.CheckType.opposed', cost: 3, insufficient: false });
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
  it('Attack -> to-hit roll', async () => {
    const actor = makeActor();
    await actor.useHotlistItem(own(actor, makeItem('attack', 'Dagger', { die: '1d4' }, { toHit: 4, damageBase: 0 })));
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
    await actor.useHotlistItem(own(actor, makeItem('attack', 'W', {}, { toHit: 1 })), { speaker });
    expect(postCard.mock.calls[0][3]).toEqual({ speaker });
  });
  it('an item not owned by this actor -> null, nothing posted', async () => {
    const actor = makeActor();
    expect(await actor.useHotlistItem(own(makeActor(), makeItem('gear', 'Rope', {})))).toBeNull();
    expect(await actor.useHotlistItem(makeItem('gear', 'Rope', {}))).toBeNull();
    expect(postCard).not.toHaveBeenCalled();
  });
});
