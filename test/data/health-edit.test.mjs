import { describe, it, expect, vi } from 'vitest';
import { STATS } from '../../module/config.mjs';
import { PcModel, MobModel, VehicleModel } from '../../module/data/actor/_module.mjs';
import { applyHealthPointsEdit } from '../../module/rules/health.mjs';
import DCCActor from '../../module/documents/actor.mjs';

// The mock TypeDataModel only Object.assigns its data: pass a full source and
// attach `parent` by hand. Core's cleanData expands dotted keys before
// _preUpdate, so change objects are built with expandObject to mirror that.

const stats = (over = {}) => Object.fromEntries(STATS.map((s) => [s, { base: over[s] ?? 1 }]));

const creatureSource = (over = {}) => ({
  level: 1, floor: 1, stats: stats(), healthBar: 10, healthPoints: { value: 0, max: 0 },
  armor: 0, moveBase: 0, stepBase: 5, size: 'M', notes: '', ...over,
});
const pcSource = (over = {}) => creatureSource({ mana: { value: 0, max: 0 }, manaStat: 'intelligence', ...over });
const vehicleSource = (over = {}) => ({
  kind: 'vehicle', size: 4, speed: 0, speedMax: 4, constitutionModifier: null, armor: 0, floor: 1, healthBar: 4,
  healthPoints: { value: 0, max: 0 }, ...over,
});

const prepare = (Model, source) => {
  const model = new Model(source);
  model.parent = { items: [] };
  model.prepareBaseData();
  model.prepareDerivedData();
  return model;
};

// Constitution base -> stat modifier: 1 -> 1, 6 -> 3, 10 -> 4.
const pc = (con, healthBar) => prepare(PcModel, pcSource({ stats: stats({ constitution: con }), healthBar }));
const changes = (flat) => foundry.utils.expandObject(flat);

describe('oracle: applyHealthPointsEdit', () => {
  it('applyHealthPointsEdit(10, 31, 4) -> healthBar 8, healthPoints 32 (healthbar.test.js:60)', () => {
    expect(applyHealthPointsEdit(10, 31, 4)).toEqual({ healthBar: 8, healthPoints: 32 });
  });
});

describe('model _preUpdate: healthPoints edits become slot changes', () => {
  it('10 healthPoints -> 7 with con mod 1 -> healthBar 7, healthPoints removed from the changes', async () => {
    const m = pc(1, 10);
    expect(m.stats.constitution.modifier).toBe(1);
    const c = changes({ 'system.healthPoints.value': 7 });
    await m._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(7);
    expect(c.system).not.toHaveProperty('healthPoints');
  });

  it('con mod 3, healthBar 10 (healthPoints 30), entered 25 -> healthBar 9 (healthPoints 27)', async () => {
    const m = pc(6, 10);
    expect(m.stats.constitution.modifier).toBe(3);
    expect(m.healthPoints.value).toBe(30);
    const c = changes({ 'system.healthPoints.value': 25 });
    await m._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(9);
    expect(c.system.healthBar * m.stats.constitution.modifier).toBe(27);
  });

  it('con mod 4, healthBar 10, entered 31 -> healthBar 8', async () => {
    const m = pc(10, 10);
    expect(m.stats.constitution.modifier).toBe(4);
    const c = changes({ 'system.healthPoints.value': 31 });
    await m._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(8);
  });

  it('mob uses its own slot count as the clamp', async () => {
    const m = prepare(MobModel, creatureSource({ level: 3, healthBar: 1 }));
    expect(m.healthBarSlots).toBe(3);
    const c = changes({ 'system.healthPoints.value': 99 });
    await m._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(3);
  });

  it('an explicit system.healthBar in the same update wins; healthPoints is still dropped', async () => {
    const m = pc(1, 10);
    const c = changes({ 'system.healthPoints.value': 2, 'system.healthBar': 6 });
    await m._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(6);
    expect(c.system).not.toHaveProperty('healthPoints');
  });

  it('leaves unrelated updates untouched', async () => {
    const m = pc(1, 10);
    const c = changes({ 'system.level': 2, name: 'X' });
    await m._preUpdate(c, {}, {});
    expect(c).toEqual({ system: { level: 2 }, name: 'X' });
  });

  it('works when changes has no system key', async () => {
    const m = pc(1, 10);
    const c = { name: 'X' };
    await expect(m._preUpdate(c, {}, {})).resolves.not.toBe(false);
    expect(c).toEqual({ name: 'X' });
  });

  it('never cancels the update', async () => {
    const m = pc(1, 10);
    await expect(m._preUpdate(changes({ 'system.healthPoints.value': 7 }), {}, {})).resolves.not.toBe(false);
  });

  it('computes the delta from the displayed (clamped) healthBar when stored healthBar exceeds the slots', async () => {
    const m = pc(1, 14);
    expect(m.healthPoints.value).toBe(10);
    const c = changes({ 'system.healthPoints.value': 7 });
    await m._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(7);
  });

  it('a non-finite entered healthPoints (HUD "abc" -> NaN) leaves healthBar alone and drops healthPoints', async () => {
    const m = pc(1, 10);
    const c = changes({ 'system.healthPoints.value': NaN });
    await m._preUpdate(c, {}, {});
    expect(c.system).not.toHaveProperty('healthBar');
    expect(c.system).not.toHaveProperty('healthPoints');
  });

  it('a healthPoints.max-only update is dropped without touching healthBar', async () => {
    const m = pc(1, 10);
    const c = changes({ 'system.healthPoints.max': 50 });
    await m._preUpdate(c, {}, {});
    expect(c).toEqual({ system: {} });
  });

  it('entering the current healthPoints is a no-op (an over-cap stored healthBar is preserved)', async () => {
    const m = pc(1, 14);
    const c = changes({ 'system.healthPoints.value': m.healthPoints.value });
    await m._preUpdate(c, {}, {});
    expect(c.system).not.toHaveProperty('healthBar');
    expect(c.system).not.toHaveProperty('healthPoints');
  });

  it('a sub-slot edit on an over-cap actor leaves the stored healthBar alone', async () => {
    const m = pc(6, 14);
    expect(m.healthPoints.value).toBe(30);
    const c = changes({ 'system.healthPoints.value': 29 });
    await m._preUpdate(c, {}, {});
    expect(c.system).not.toHaveProperty('healthBar');
    expect(c.system).not.toHaveProperty('healthPoints');
  });

  it('vehicle uses healthConstitutionModifier (null constitutionModifier -> 5): healthBar 4 (healthPoints 20), entered 12 -> healthBar 3', async () => {
    const v = prepare(VehicleModel, vehicleSource());
    expect(v.constitutionModifier).toBeNull(); // stored value untouched
    expect(v.healthConstitutionModifier).toBe(5);
    const c = changes({ 'system.healthPoints.value': 12 });
    await v._preUpdate(c, {}, {});
    expect(c.system.healthBar).toBe(3);
    expect(c.system).not.toHaveProperty('healthPoints');
  });

  it('creature healthConstitutionModifier is the constitution stat mod', () => {
    expect(pc(6, 10).healthConstitutionModifier).toBe(3);
  });
});

describe('DCCActor health methods', () => {
  const actorFor = (system) => {
    const actor = new DCCActor({ system });
    actor.update = vi.fn(async () => actor);
    return actor;
  };

  it('applyDamage subtracts DR, chunks by con mod and issues one healthBar update', async () => {
    const a = actorFor(prepare(PcModel, pcSource({ stats: stats({ constitution: 6 }), healthBar: 10, armor: 2 })));
    expect(a.system.damageResistance).toBe(2);
    await a.applyDamage(9); // 9 - 2 = 7 -> floor(7/3) = 2 slots
    expect(a.update).toHaveBeenCalledTimes(1);
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 8 });
  });

  it('applyDamage on a vehicle includes DR and uses healthConstitutionModifier', async () => {
    const a = actorFor(prepare(VehicleModel, vehicleSource({ armor: 3 })));
    expect(a.system.damageResistance).toBe(3);
    await a.applyDamage(13); // 13 - 3 = 10 -> 2 slots of 5
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 2 });
  });

  it('healSlots defaults to 1 and clamps at healthBarSlots', async () => {
    const a = actorFor(pc(1, 8));
    await a.healSlots();
    expect(a.update).toHaveBeenLastCalledWith({ 'system.healthBar': 9 });
    await a.healSlots(5);
    expect(a.update).toHaveBeenLastCalledWith({ 'system.healthBar': 10 });
    expect(a.update).toHaveBeenCalledTimes(2);
  });

  it('setSlots clamps to [0, healthBarSlots]', async () => {
    const a = actorFor(prepare(VehicleModel, vehicleSource({ healthBar: 3 })));
    await a.setSlots(2);
    expect(a.update).toHaveBeenLastCalledWith({ 'system.healthBar': 2 });
    await a.setSlots(9);
    expect(a.update).toHaveBeenLastCalledWith({ 'system.healthBar': 4 });
    await a.setSlots(-1);
    expect(a.update).toHaveBeenLastCalledWith({ 'system.healthBar': 0 });
  });

  it('applyDamage with negative or NaN damage issues no update', async () => {
    const a = actorFor(pc(1, 10));
    await a.applyDamage(-5);
    await a.applyDamage(NaN);
    expect(a.update).not.toHaveBeenCalled();
  });

  it('applyDamage that removes no slot issues no update', async () => {
    const a = actorFor(pc(6, 10));
    await a.applyDamage(2);
    expect(a.update).not.toHaveBeenCalled();
  });

  it('healSlots(0) and healSlots(-3) are no-ops', async () => {
    const a = actorFor(pc(1, 8));
    await a.healSlots(0);
    await a.healSlots(-3);
    expect(a.update).not.toHaveBeenCalled();
  });

  it('healSlots truncates a fractional count', async () => {
    const a = actorFor(pc(1, 5));
    await a.healSlots(2.9);
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 7 });
  });

  it('healSlots at full issues no update', async () => {
    const a = actorFor(pc(1, 10));
    await a.healSlots(1);
    expect(a.update).not.toHaveBeenCalled();
  });

  it('setSlots truncates: setSlots(2.5) -> 2', async () => {
    const a = actorFor(pc(1, 10));
    await a.setSlots(2.5);
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 2 });
  });

  it('setSlots to the current value issues no update', async () => {
    const a = actorFor(pc(1, 6));
    await a.setSlots(6);
    expect(a.update).not.toHaveBeenCalled();
  });
});
