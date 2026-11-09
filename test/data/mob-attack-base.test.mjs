import { describe, it, expect, vi } from 'vitest';
import { AttackModel } from '../../module/data/item/_module.mjs';
import MobModel from '../../module/data/actor/mob.mjs';

const setup = (system = {}, type = 'mob') => {
  const actor = {
    type,
    system: { stats: { strength: { base: 20, modifier: 5 }, dexterity: { base: 10, modifier: 4 } } },
    items: [],
    updateSource: vi.fn(),
  };
  const model = new AttackModel({ stat: 'strength', rank: 2, mobToHitBase: null, mobToHitNone: false, ...system });
  const item = { id: 'a', type: 'attack', system: model, parent: actor, updateSource: vi.fn() };
  model.parent = item;
  actor.items.push(item);
  return { actor, item, model };
};

describe('Mob Attack To-Hit base initialization', () => {
  it('seeds new Mob Attacks once from ability modifier and rank', async () => {
    const { item, model } = setup();
    await model._preCreate({}, {}, {});
    expect(item.updateSource).toHaveBeenCalledWith({ 'system.mobToHitBase': 17 });
  });

  it('uses the linked skill rank when creating a granted attack', async () => {
    const { actor, item, model } = setup({ primarySkillId: 's1' });
    actor.items.push({ id: 's1', type: 'skill', system: { rank: 3, derived: { rankEffective: 4 } } });
    await model._preCreate({}, {}, {});
    expect(item.updateSource).toHaveBeenCalledWith({ 'system.mobToHitBase': 19 });
  });

  it.each([{ mobToHitBase: 0 }, { mobToHitBase: 14 }, { mobToHitNone: true }])('preserves explicit values %o', async values => {
    const { item, model } = setup(values);
    await model._preCreate({}, {}, {});
    expect(item.updateSource).not.toHaveBeenCalled();
  });

  it('does not seed attacks owned by Crawlers', async () => {
    const { item, model } = setup({}, 'pc');
    await model._preCreate({}, {}, {});
    expect(item.updateSource).not.toHaveBeenCalled();
  });

  it('seeds blank bases in actor imports but preserves authored ones', async () => {
    const blank = setup();
    const authored = setup({ mobToHitBase: 0 });
    const actor = blank.actor;
    authored.item.parent = actor;
    actor.items.push(authored.item);
    const model = new MobModel();
    model.parent = actor;
    await model._preCreate({}, {}, {});
    expect(blank.item.updateSource).toHaveBeenCalledWith({ 'system.mobToHitBase': 17 });
    expect(authored.item.updateSource).not.toHaveBeenCalled();
  });

  it('reseeds a cleared base or a None attack restored with a blank base', async () => {
    const { model } = setup({ mobToHitBase: 13 });
    const cleared = { system: { mobToHitBase: null } };
    await model._preUpdate(cleared, {}, {});
    expect(cleared.system.mobToHitBase).toBe(17);
    model.mobToHitBase = null;
    model.mobToHitNone = true;
    const enabled = { system: { mobToHitNone: false } };
    await model._preUpdate(enabled, {}, {});
    expect(enabled.system.mobToHitBase).toBe(17);
  });
});
