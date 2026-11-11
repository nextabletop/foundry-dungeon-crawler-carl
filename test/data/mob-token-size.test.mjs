import { describe, expect, it, vi } from 'vitest';
import DCCActor from '../../module/documents/actor.mjs';
import MobModel from '../../module/data/actor/mob.mjs';
import { mobTokenSize } from '../../module/rules/token-size.mjs';

describe('Mob descriptor token sizes', () => {
  it.each([
    [1, 25], [2, 35], [3, 50], [4, 70], [5, 140], [6, 210], [7, 280],
    [8, 350], [9, 420], [10, 490], [11, 560], [12, 630], [13, 700],
  ])('size %i uses Roll20 width %i on a 70px grid', (size, pixels) => {
    expect(mobTokenSize(`Boss; Gargantuan (${size}), Insectoid`)).toBe(pixels / 70);
  });

  it.each([
    ['Neighborhood Boss; Tiny (1), Insectoid', 25 / 70],
    ['mob;  tInY  ( 1 ), dragon', 25 / 70],
    ['Borough Boss 2; Medium (5), Humanoid', 2],
    ['Colossal (7)', 4],
    ['Gargantuan (8)', 5],
    ['Large (99)', 1],
    ['Tiny (0)', 1],
    ['Floor 3; Boss, Insectoid', null],
    ['A small but fierce insect', null],
    ['', null],
    [null, null],
  ])('reads %j as %s grid units', (descriptors, size) => {
    expect(mobTokenSize(descriptors)).toBe(size);
  });
});

describe('Mob prototype token sizing', () => {
  const setup = descriptors => {
    const model = new MobModel({ descriptors });
    model._source = { descriptors };
    model.parent = { items: [], updateSource: vi.fn(), isToken: false };
    return model;
  };

  it('sets the prototype on creation with a numbered size', async () => {
    const model = setup('Boss; Tiny (1), Insectoid');
    await model._preCreate({ system: { descriptors: model.descriptors } }, {}, {});
    expect(model.parent.updateSource).toHaveBeenCalledWith({
      'prototypeToken.width': 25 / 70, 'prototypeToken.height': 25 / 70,
    });
  });

  it('preserves the prototype on creation without a numbered size', async () => {
    const model = setup('Boss, Insectoid');
    await model._preCreate({}, {}, {});
    expect(model.parent.updateSource).not.toHaveBeenCalled();
  });

  it('updates the prototype atomically when the descriptor size changes', async () => {
    const model = setup('Tiny (1), Insectoid');
    const changes = { system: { descriptors: 'Large (5), Insectoid' }, prototypeToken: { name: 'Boss' } };
    await model._preUpdate(changes, {}, {});
    expect(changes.prototypeToken).toEqual({ name: 'Boss', width: 2, height: 2 });
  });

  it('preserves explicit prototype dimensions in the same update', async () => {
    const model = setup('Tiny (1)');
    const changes = { system: { descriptors: 'Large (5)' }, prototypeToken: { width: 3, height: 4 } };
    await model._preUpdate(changes, {}, {});
    expect(changes.prototypeToken).toEqual({ width: 3, height: 4 });
  });

  it('resets to one grid unit if a numbered size is removed', async () => {
    const model = setup('Tiny (1)');
    const changes = { system: { descriptors: 'Insectoid' } };
    await model._preUpdate(changes, {}, {});
    expect(changes.prototypeToken).toEqual({ width: 1, height: 1 });
  });

  it('leaves prototype dimensions alone for unrelated or equivalent edits', async () => {
    const model = setup('Tiny (1), Insectoid');
    for (const changes of [{ system: { level: 2 } }, { system: { descriptors: 'Boss; tiny (1)' } }]) {
      await model._preUpdate(changes, {}, {});
      expect(changes).not.toHaveProperty('prototypeToken');
    }
  });

  it('does not modify prototype data on a placed unlinked token actor', async () => {
    const model = setup('Tiny (1)');
    model.parent.isToken = true;
    const changes = { system: { descriptors: 'Large (5)' } };
    await model._preUpdate(changes, {}, {});
    expect(changes).not.toHaveProperty('prototypeToken');
  });
});

describe('creating tokens from actors', () => {
  it('sizes an existing Mob at drop time even if its prototype predates this feature', async () => {
    const prototypeToken = { width: 1, height: 1, name: 'Admiral Stoma' };
    const actor = new DCCActor({ type: 'mob', system: { descriptors: 'Neighborhood Boss; Tiny (1), Insectoid' }, prototypeToken });
    const data = { x: 100, y: 200 };
    const options = { parent: { id: 'scene' } };
    const token = await actor.getTokenDocument(data, options);
    expect(token).toEqual({ width: 25 / 70, height: 25 / 70, name: 'Admiral Stoma', ...data, options });
    expect(prototypeToken).toEqual({ width: 1, height: 1, name: 'Admiral Stoma' });
    expect(data).toEqual({ x: 100, y: 200 });
  });

  it('uses the latest descriptors on subsequent drops and preserves explicit dimensions', async () => {
    const actor = new DCCActor({ type: 'mob', system: { descriptors: 'Tiny (1)' }, prototypeToken: { width: 1, height: 1 } });
    expect(await actor.getTokenDocument()).toMatchObject({ width: 25 / 70, height: 25 / 70 });
    actor.system.descriptors = 'Large (5)';
    expect(await actor.getTokenDocument()).toMatchObject({ width: 2, height: 2 });
    expect(await actor.getTokenDocument({ width: 3, height: 4 })).toMatchObject({ width: 3, height: 4 });
  });

  it.each(['mob', 'pc', 'vehicle'])('preserves prototype dimensions for %s without an applicable size', async type => {
    const descriptors = type === 'mob' ? 'Boss, Insectoid' : 'Tiny (1)';
    const actor = new DCCActor({ type, system: { descriptors }, prototypeToken: { width: 3, height: 2 } });
    expect(await actor.getTokenDocument()).toMatchObject({ width: 3, height: 2 });
  });
});
