import { describe, expect, it, vi } from 'vitest';
import DCCItem from '../../module/documents/item.mjs';
import {
  attackSource,
  createGrantedAttack,
  effectiveAttackRank,
  grantedAttack,
  itemLinkState,
  linkedItemIdsToDelete,
  removeGrantedAttack,
  repairOwnedItemLinks,
  setAttackSource,
} from '../../module/rules/item-links.mjs';

const item = (id, type, linkedItemIds = [], system = {}) => ({
  id,
  name: id,
  type,
  system: { linkedItemIds, ...system },
});

function actorWith(...items) {
  let nextId = 0;
  const actor = {
    items: { contents: items },
    updateEmbeddedDocuments: vi.fn(async (_type, updates) => {
      for (const update of updates) {
        const target = items.find(candidate => candidate.id === update._id);
        target.system.linkedItemIds = update['system.linkedItemIds'];
        if (Object.hasOwn(update, 'system.isAttack')) target.system.isAttack = update['system.isAttack'];
      }
      return updates;
    }),
    deleteEmbeddedDocuments: vi.fn(async () => []),
    createEmbeddedDocuments: vi.fn(async (_type, [data]) => {
      const created = item(`generated-${++nextId}`, data.type, data.system?.linkedItemIds ?? [], data.system);
      created.name = data.name;
      created.img = data.img;
      created.parent = actor;
      created.delete = vi.fn(async () => {
        actor.items.contents = actor.items.contents.filter(candidate => candidate !== created);
      });
      actor.items.contents.push(created);
      return [created];
    }),
  };
  for (const owned of items) owned.parent = actor;
  return actor;
}

describe('owned Item link graph', () => {
  it('resolves healthy links and reports stale and asymmetric references', () => {
    const source = item('source', 'skill', ['attack', 'missing', 'one-sided']);
    const attack = item('attack', 'attack', ['source']);
    const oneSided = item('one-sided', 'gear');
    const state = itemLinkState(source, [source, attack, oneSided]);
    expect(state.resolved).toEqual([attack]);
    expect(state.staleIds).toEqual(['missing']);
    expect(state.asymmetric).toEqual([oneSided]);
  });

  it('walks an item -> spell -> attack chain and skips stale or one-sided links', () => {
    const gear = item('gear', 'gear', ['spell', 'missing']);
    const spell = item('spell', 'spell', ['gear', 'attack', 'one-sided']);
    const attack = item('attack', 'attack', ['spell']);
    const oneSided = item('one-sided', 'gear');
    expect(linkedItemIdsToDelete(gear, [gear, spell, attack, oneSided]).sort())
      .toEqual(['attack', 'spell']);
  });

  it('repairs invalid references without inventing a missing backlink', async () => {
    const source = item('source', 'skill', ['attack', 'missing', 'source', 'attack']);
    const attack = item('attack', 'attack', ['source']);
    const oneSided = item('one-sided', 'gear', ['source']);
    const actor = actorWith(source, attack, oneSided);

    await repairOwnedItemLinks(actor);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      { _id: source.id, 'system.linkedItemIds': ['attack'] },
      { _id: oneSided.id, 'system.linkedItemIds': [] },
    ]);
  });
});

describe('Attack source links', () => {
  it('creates a bidirectional stable-ID link and is idempotent', async () => {
    const source = item('skill-id', 'skill', [], { rank: 4 });
    const attack = item('attack-id', 'attack', [], { rank: 1 });
    const actor = actorWith(source, attack);

    await setAttackSource(attack, source.id);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      { _id: attack.id, 'system.linkedItemIds': [source.id] },
      { _id: source.id, 'system.linkedItemIds': [attack.id], 'system.isAttack': true },
    ]);
    expect(attackSource(attack, actor.items.contents)).toBe(source);
    expect(effectiveAttackRank(attack, actor.items.contents)).toBe(4);
    source.system.derived = { rankEffective: 6 };
    expect(effectiveAttackRank(attack, actor.items.contents)).toBe(6);

    actor.updateEmbeddedDocuments.mockClear();
    expect(await setAttackSource(attack, source.id)).toEqual([]);
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('replaces displaced source/Attack links but preserves non-Attack chain links', async () => {
    const gear = item('gear', 'gear', ['spell']);
    const spell = item('spell', 'spell', ['gear', 'old-attack'], { rank: 3 });
    const oldAttack = item('old-attack', 'attack', ['spell']);
    const attack = item('attack', 'attack');
    const actor = actorWith(gear, spell, oldAttack, attack);

    await setAttackSource(attack, spell.id);
    expect(spell.system.linkedItemIds).toEqual(['gear', 'attack']);
    expect(oldAttack.system.linkedItemIds).toEqual([]);
    expect(attack.system.linkedItemIds).toEqual(['spell']);
    expect(gear.system.linkedItemIds).toEqual(['spell']);
  });

  it('rejects unowned Attacks and invalid or cross-Actor source IDs', async () => {
    await expect(setAttackSource(item('attack', 'attack'), 'source'))
      .rejects.toThrow('owned by an Actor');
    const attack = item('attack', 'attack');
    actorWith(attack);
    await expect(setAttackSource(attack, 'other-actor-source'))
      .rejects.toThrow('not a linkable Item owned by this Actor');
  });

  it('uses the Attack stored Rank when its source is not a Skill or Spell', () => {
    const source = item('gear', 'gear', ['attack']);
    const attack = item('attack', 'attack', ['gear'], { rank: 2 });
    expect(effectiveAttackRank(attack, [source, attack])).toBe(2);
  });
});

describe('granted Attacks', () => {
  it('creates and links one Attack from an owned Skill/Spell, idempotently', async () => {
    const source = item('spell', 'spell', [], { stat: 'intelligence', rank: 3, isAttack: true });
    source.name = 'Magic Missile';
    source.img = 'missile.svg';
    const actor = actorWith(source);

    const attack = await createGrantedAttack(source);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith('Item', [{
      type: 'attack',
      name: 'Magic Missile',
      img: 'missile.svg',
      system: { stat: 'intelligence', rank: 3 },
    }]);
    expect(grantedAttack(source, actor.items.contents)).toBe(attack);
    expect(attack.system.linkedItemIds).toEqual([source.id]);
    expect(source.system.linkedItemIds).toEqual([attack.id]);

    expect(await createGrantedAttack(source)).toBe(attack);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });

  it('unlinks and deletes only the granted Attack when the flag is disabled', async () => {
    const source = item('skill', 'skill', ['attack'], { rank: 2, isAttack: false });
    const attack = item('attack', 'attack', ['skill']);
    attack.delete = vi.fn(async () => {});
    actorWith(source, attack);

    expect(await removeGrantedAttack(source)).toBe(attack);
    expect(source.system.linkedItemIds).toEqual([]);
    expect(attack.system.linkedItemIds).toEqual([]);
    expect(attack.delete).toHaveBeenCalledWith({ dccLinkedCascade: true });
  });
});

describe('DCCItem linked deletion', () => {
  it('creates a granted Attack when an attack-marked Skill/Spell is dropped on an Actor', async () => {
    const source = new DCCItem({
      id: 'source',
      type: 'spell',
      name: 'Magic Missile',
      img: 'missile.svg',
      system: { stat: 'intelligence', rank: 3, isAttack: true, linkedItemIds: [] },
    });
    const actor = actorWith(source);

    await source._onCreate({}, {}, undefined);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(grantedAttack(source, actor.items.contents)?.name).toBe('Magic Missile');
  });

  it('removes the generated Attack when an owned source is no longer marked as an Attack', async () => {
    const source = new DCCItem({
      id: 'source',
      type: 'skill',
      name: 'Bow',
      system: { stat: 'dexterity', rank: 2, isAttack: true, linkedItemIds: [] },
    });
    const actor = actorWith(source);
    await source._onCreate({}, {}, undefined);
    const attack = grantedAttack(source, actor.items.contents);

    source.system.isAttack = false;
    await source._onUpdate({ system: { isAttack: false } }, {}, undefined);
    expect(attack.delete).toHaveBeenCalledWith({ dccLinkedCascade: true });
    expect(grantedAttack(source, actor.items.contents)).toBeNull();
  });

  it('deletes the mutually linked component with a recursion guard', async () => {
    const source = new DCCItem({
      id: 'source',
      type: 'skill',
      system: { linkedItemIds: ['attack'] },
    });
    const attack = item('attack', 'attack', ['source']);
    const actor = actorWith(source, attack);

    await source._preDelete({ reason: 'test' }, {});
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith(
      'Item',
      ['attack'],
      { reason: 'test', dccLinkedCascade: true },
    );
  });
});
