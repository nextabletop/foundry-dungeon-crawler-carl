import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Glue test for DCCActor's advancement actions (R20 _skills.pug:149-217):
// which rolls are made, which updates follow, and the summary card. The pure
// rules (planAdvancement, snapshot, restoreUpdates) are tested in
// test/rules/advancement.test.mjs.
vi.mock('../../module/rolls/card.mjs', () => ({
  postCard: vi.fn(async (actor, fields, formulas) => ({ fields, formulas })),
}));
const { postCard } = await import('../../module/rolls/card.mjs');
const { default: DCCActor } = await import('../../module/documents/actor.mjs');
const { gmLinkFor } = await import('../../module/gm-link.mjs');
const { advancementView } = await import('../../module/applications/sheet-rows.mjs');

/** Roll stub: d20 totals come from `queue`; every construction and evaluate option is recorded. */
class FixedRoll {
  static queue = [];
  static made = [];
  constructor(formula) {
    this.formula = formula;
    FixedRoll.made.push(this);
  }
  async evaluate(options) {
    this.options = options;
    this.total = FixedRoll.queue.shift();
    return this;
  }
}

const setPath = (obj, path, val) => {
  const parts = path.split('.');
  const last = parts.pop();
  parts.reduce((o, k) => (o[k] ??= {}), obj)[last] = val;
};

let nextId = 0;
const makeItem = (type, name, system = {}) => ({ id: `i${++nextId}`, type, name, system: { ...system } });

/**
 * A PC whose update / updateEmbeddedDocuments really apply (dotted keys), so
 * End Session -> Undo round-trips can be asserted on the resulting state.
 */
const makeActor = ({ system = {}, items = [], type = 'pc', isOwner = true } = {}) => {
  const actor = new DCCActor({
    type, name: 'Carl', isOwner, uuid: 'Actor.carl', isToken: false,
    system: { level: 1, floor: 1, pendingLevels: 0, statPoints: 0, undoStack: [], floorEndDone: 0, floorEndEpoch: 0, ...system },
    items: { contents: items },
  });
  actor.update = vi.fn(async (data) => {
    for (const [k, v] of Object.entries(data)) setPath(actor, k, structuredClone(v));
    return actor;
  });
  actor.updateEmbeddedDocuments = vi.fn(async (_type, rows) => {
    for (const { _id, ...changes } of rows) {
      const item = items.find(i => i.id === _id);
      for (const [k, v] of Object.entries(changes)) setPath(item, k, v);
    }
    return rows;
  });
  return actor;
};

const realRoll = foundry.dice.Roll;
beforeEach(() => {
  postCard.mockClear();
  FixedRoll.queue = [];
  FixedRoll.made = [];
  foundry.dice.Roll = FixedRoll;
  globalThis.ui = { notifications: { warn: vi.fn() } };
});
afterEach(() => {
  foundry.dice.Roll = realRoll;
  delete globalThis.ui;
});

describe('endSession', () => {
  it('rolls one silent d20 per DUE skill/spell only, advances, clears marks, +1 pending level', async () => {
    const knives = makeItem('skill', 'Knives', { rank: 2, mark: true });       // due, d20 2 >= 2 -> 3
    const zap = makeItem('spell', 'Zap', { rank: 4, mark: true });             // due (spell), d20 3 < 4 -> stays 4
    const idle = makeItem('skill', 'Idle', { rank: 1, mark: false });          // not marked
    const high = makeItem('skill', 'High', { rank: 7, mark: true });           // rank >= 5: floor only
    const passive = makeItem('skill', 'Passive', { rank: 0, mark: true, checkType: 'passive' });
    const sword = makeItem('weapon', 'Sword', { rank: 0, mark: true });        // not a skill
    const actor = makeActor({ items: [knives, zap, idle, high, passive, sword], system: { pendingLevels: 1 } });
    FixedRoll.queue = [2, 3];

    const result = await actor.endSession();

    expect(FixedRoll.made.map(r => r.formula)).toEqual(['1d20', '1d20']);
    for (const r of FixedRoll.made) expect(r.options).toEqual({ allowInteractive: false });
    expect(result.rolls).toEqual({ [knives.id]: 2, [zap.id]: 3 });
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      { _id: knives.id, 'system.rank': 3, 'system.mark': false },
      { _id: zap.id, 'system.rank': 4, 'system.mark': false },
    ]);
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(actor.system.pendingLevels).toBe(2);
    expect(actor.system.floor).toBe(1);
    expect(high.system).toEqual({ rank: 7, mark: true });
  });

  it('item write fails after the actor write: the undo entry still exists, no card', async () => {
    const knives = makeItem('skill', 'Knives', { rank: 0, mark: true });
    const actor = makeActor({ items: [knives] });
    actor.updateEmbeddedDocuments.mockRejectedValueOnce(new Error('items down'));
    FixedRoll.queue = [9];
    await expect(actor.endSession()).rejects.toThrow('items down');
    expect(actor.system.undoStack).toHaveLength(1);
    expect(knives.system).toEqual({ rank: 0, mark: true });
    expect(postCard).not.toHaveBeenCalled();
  });

  it('pushes a snapshot of every skill/spell row (pre-advance) and the counters', async () => {
    const knives = makeItem('skill', 'Knives', { rank: 2, mark: true });
    const idle = makeItem('spell', 'Idle', { rank: 6, mark: false });
    const actor = makeActor({ items: [knives, idle], system: { pendingLevels: 1, floor: 2, undoStack: [{ old: true }] } });
    FixedRoll.queue = [20];
    await actor.endSession();
    expect(actor.system.undoStack).toEqual([
      { old: true },
      { skills: [{ id: knives.id, rank: 2, mark: true }, { id: idle.id, rank: 6, mark: false }], pendingLevels: 1, floor: 2, floorEndDone: 0, floorEndEpoch: 0 },
    ]);
  });

  it('caps the undo stack at UNDO_MAX (20), dropping the oldest', async () => {
    const stack = Array.from({ length: 20 }, (_, n) => ({ n }));
    const actor = makeActor({ system: { undoStack: stack } });
    await actor.endSession();
    expect(actor.system.undoStack).toHaveLength(20);
    expect(actor.system.undoStack[0]).toEqual({ n: 1 });
  });

  it('nothing due: still snapshots and grants the level; no item update, no rolls', async () => {
    const actor = makeActor({ items: [makeItem('skill', 'Idle', { rank: 1, mark: false })] });
    await actor.endSession();
    expect(FixedRoll.made).toHaveLength(0);
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.system.pendingLevels).toBe(1);
    expect(actor.system.undoStack).toHaveLength(1);
    expect(postCard.mock.calls[0][1].note).toBe('DCC.Advance.NoneDue\nDCC.Advance.PendingLine');
  });

  it('writes the actor (undo entry) before the items, then posts one roll-less summary card', async () => {
    const order = [];
    const knives = makeItem('skill', 'Knives', { rank: 0, mark: true });
    const actor = makeActor({ items: [knives] });
    const { update, updateEmbeddedDocuments } = actor;
    actor.update = vi.fn(async (d) => { order.push('actor'); return update(d); });
    actor.updateEmbeddedDocuments = vi.fn(async (...a) => { order.push('items'); return updateEmbeddedDocuments(...a); });
    postCard.mockImplementationOnce(async () => { order.push('card'); return {}; });
    FixedRoll.queue = [1];
    await actor.endSession();
    expect(order).toEqual(['actor', 'items', 'card']);
    expect(postCard).toHaveBeenCalledTimes(1);
    const [, fields, formulas, options] = postCard.mock.calls[0];
    expect(formulas).toEqual({});
    expect(options).toEqual({ extraRolls: FixedRoll.made });
    expect(options.extraRolls[0].total).toBe(1);
    expect(fields).toEqual({
      name: 'DCC.Advance.Label',
      tag: 'DCC.Advance.EndSession',
      note: 'DCC.Advance.SkillLine\nDCC.Advance.PendingLine',
    });
  });

  it('formats each line as name, old rank, new rank and d20', async () => {
    const format = vi.spyOn(game.i18n, 'format');
    const knives = makeItem('skill', 'Knives', { rank: 2, mark: true });
    const actor = makeActor({ items: [knives], system: { pendingLevels: 3 } });
    FixedRoll.queue = [12];
    await actor.endSession();
    expect(format).toHaveBeenCalledWith('DCC.Advance.SkillLine', { name: 'Knives', from: 2, to: 3, d20: 12 });
    expect(format).toHaveBeenCalledWith('DCC.Advance.PendingLine', { from: 3, to: 4 });
    format.mockRestore();
  });
});

describe('endFloor', () => {
  it('advances rank >= 5 rows, +1 floor, tagged End Floor', async () => {
    const high = makeItem('skill', 'High', { rank: 7, mark: true });
    const low = makeItem('skill', 'Low', { rank: 2, mark: true }); // session-only
    const actor = makeActor({ items: [high, low], system: { floor: 2 } });
    FixedRoll.queue = [9];
    await actor.endFloor();
    expect(FixedRoll.made).toHaveLength(1);
    expect(high.system).toEqual({ rank: 8, mark: false });
    expect(low.system).toEqual({ rank: 2, mark: true });
    expect(actor.system.floor).toBe(3);
    expect(actor.system.pendingLevels).toBe(0);
    expect(postCard.mock.calls[0][1].tag).toBe('DCC.Advance.EndFloor');
  });

  it('caps by the CURRENT floor (R20 advances before the increment): Floor 5 -> rank 15 stays 15', async () => {
    const maxed = makeItem('skill', 'Maxed', { rank: 15, mark: true });
    const actor = makeActor({ items: [maxed], system: { floor: 5 } });
    FixedRoll.queue = [20];
    await actor.endFloor();
    expect(maxed.system).toEqual({ rank: 15, mark: false });
    expect(actor.system.floor).toBe(6);
  });
});

describe('levelUp (R20 levelUp: pending - 1, level + 1, stat points + 3)', () => {
  it('pending level on Floor 3+: one update', async () => {
    const actor = makeActor({ system: { level: 4, floor: 3, pendingLevels: 2, statPoints: 1 } });
    await actor.levelUp();
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(actor.update).toHaveBeenCalledWith({ 'system.level': 5, 'system.statPoints': 4, 'system.pendingLevels': 1 });
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });
  it('posts a short roll-less card: Level N -> N+1, +3 stat points', async () => {
    const format = vi.spyOn(game.i18n, 'format');
    const actor = makeActor({ system: { level: 4, floor: 3, pendingLevels: 1 } });
    await actor.levelUp();
    expect(postCard).toHaveBeenCalledTimes(1);
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(formulas).toBeUndefined();
    expect(fields).toEqual({ name: 'DCC.Advance.Label', tag: 'DCC.Advance.LevelUp', note: 'DCC.Advance.LevelLine' });
    expect(format).toHaveBeenCalledWith('DCC.Advance.LevelLine', { from: 4, to: 5, points: 3 });
    format.mockRestore();
  });
  it('pushes no undo entry', async () => {
    const actor = makeActor({ system: { floor: 3, pendingLevels: 1 } });
    await actor.levelUp();
    expect(actor.system.undoStack).toEqual([]);
  });
  it('no pending level: warns NoPending, no update', async () => {
    const actor = makeActor({ system: { floor: 5, pendingLevels: 0 } });
    expect(await actor.levelUp()).toBeNull();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Advance.Blocked.NoPending');
    expect(actor.update).not.toHaveBeenCalled();
    expect(postCard).not.toHaveBeenCalled();
  });
  it('below Floor 3: warns Saferoom, no update', async () => {
    const actor = makeActor({ system: { floor: 2, pendingLevels: 1 } });
    await actor.levelUp();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Advance.Blocked.Saferoom');
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('undoAdvancement', () => {
  it('End Session then Undo restores ranks, marks and pendingLevels, and pops the stack', async () => {
    const knives = makeItem('skill', 'Knives', { rank: 0, mark: true });
    const actor = makeActor({ items: [knives], system: { pendingLevels: 0 } });
    FixedRoll.queue = [10];
    await actor.endSession();
    expect(knives.system).toEqual({ rank: 1, mark: false });
    actor.update.mockClear();
    actor.updateEmbeddedDocuments.mockClear();

    await actor.undoAdvancement();
    expect(knives.system).toEqual({ rank: 0, mark: true });
    expect(actor.system.pendingLevels).toBe(0);
    expect(actor.system.undoStack).toEqual([]);
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });
  it('restores the items BEFORE popping the stack / counters', async () => {
    const order = [];
    const knives = makeItem('skill', 'Knives', { rank: 1, mark: false });
    const actor = makeActor({ items: [knives], system: { undoStack: [{ skills: [{ id: knives.id, rank: 0, mark: true }], pendingLevels: 0, floor: 1 }] } });
    const { update, updateEmbeddedDocuments } = actor;
    actor.update = vi.fn(async (d) => { order.push('actor'); return update(d); });
    actor.updateEmbeddedDocuments = vi.fn(async (...a) => { order.push('items'); return updateEmbeddedDocuments(...a); });
    await actor.undoAdvancement();
    expect(order).toEqual(['items', 'actor']);
  });
  it('a failed item restore leaves the stack intact (Undo can be retried)', async () => {
    const knives = makeItem('skill', 'Knives', { rank: 0, mark: true });
    const actor = makeActor({ items: [knives], system: { pendingLevels: 0 } });
    FixedRoll.queue = [10, 10];
    await actor.endSession();
    actor.updateEmbeddedDocuments.mockRejectedValueOnce(new Error('items down'));
    await expect(actor.undoAdvancement()).rejects.toThrow('items down');
    expect(actor.system.undoStack).toHaveLength(1);
    expect(actor.system.pendingLevels).toBe(1);
    await actor.undoAdvancement();
    expect(actor.system.undoStack).toHaveLength(0);
    expect(knives.system).toEqual({ rank: 0, mark: true });
    expect(actor.system.pendingLevels).toBe(0);
  });
  it('End Floor then Undo restores the floor', async () => {
    const actor = makeActor({ system: { floor: 4 } });
    await actor.endFloor();
    await actor.undoAdvancement();
    expect(actor.system.floor).toBe(4);
  });
  it('skips rows whose item has been deleted since', async () => {
    const kept = makeItem('skill', 'Kept', { rank: 5, mark: false });
    const actor = makeActor({
      items: [kept],
      system: { undoStack: [{ skills: [{ id: kept.id, rank: 3, mark: true }, { id: 'deleted', rank: 1, mark: true }], pendingLevels: 0, floor: 1 }] },
    });
    await actor.undoAdvancement();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [{ _id: kept.id, 'system.rank': 3, 'system.mark': true }]);
  });
  it('does not revert a Level Up (level / stat points are not snapshotted)', async () => {
    const actor = makeActor({ system: { floor: 3, pendingLevels: 0, level: 2 } });
    await actor.endSession();
    await actor.levelUp();
    await actor.undoAdvancement();
    expect(actor.system.level).toBe(3);
    expect(actor.system.statPoints).toBe(3);
    expect(actor.system.pendingLevels).toBe(0);
  });
  it('empty stack: warns, no update', async () => {
    const actor = makeActor();
    expect(await actor.undoAdvancement()).toBeNull();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Advance.UndoEmpty');
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('advancement guards', () => {
  it('non-owner: every action is a no-op', async () => {
    const actor = makeActor({ isOwner: false, system: { floor: 3, pendingLevels: 1, undoStack: [{ skills: [] }] } });
    for (const fn of ['endSession', 'endFloor', 'levelUp', 'undoAdvancement']) expect(await actor[fn]()).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
    expect(postCard).not.toHaveBeenCalled();
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });
  it('not a PC: no-op', async () => {
    const actor = makeActor({ type: 'mob' });
    expect(await actor.endSession()).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('re-entry: a second action while one is in flight is dropped', async () => {
    const knives = makeItem('skill', 'Knives', { rank: 0, mark: true });
    const actor = makeActor({ items: [knives] });
    FixedRoll.queue = [5, 5];
    const [first, second, undo] = await Promise.all([actor.endSession(), actor.endSession(), actor.undoAdvancement()]);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(undo).toBeNull();
    expect(actor.system.pendingLevels).toBe(1);
    expect(actor.system.undoStack).toHaveLength(1);
    expect(FixedRoll.made).toHaveLength(1);
  });
  it('the guard is released after a failure', async () => {
    const actor = makeActor();
    actor.update.mockRejectedValueOnce(new Error('boom'));
    await expect(actor.endSession()).rejects.toThrow('boom');
    expect(await actor.endSession()).not.toBeNull();
  });
});

describe('GM screen gates', () => {
  const realGet = game.settings.get;
  const realActors = game.actors;
  /** Configure screen 'scr' with Carl ('Actor.carl') rostered. Mutate `screen.system` to change the gate. */
  let screen;
  const link = ({ safehouse = false, floorEndSeq = 0, roster = ['Actor.carl'] } = {}) => {
    screen = { id: 'scr', type: 'gmscreen', system: { safehouse, floorEndSeq, roster } };
    game.settings.get = () => 'scr';
    game.actors = new Map([['scr', screen]]);
  };
  const updateKeys = actor => actor.update.mock.calls.flatMap(([d]) => Object.keys(d));
  afterEach(() => {
    game.settings.get = realGet;
    game.actors = realActors;
  });

  it('linked, seq 0 / done 0: End Floor is refused with FloorWaiting (no update, no roll, no card)', async () => {
    link({ floorEndSeq: 0 });
    const high = makeItem('skill', 'High', { rank: 7, mark: true });
    const actor = makeActor({ items: [high] });
    expect(await actor.endFloor()).toBeNull();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Advance.FloorWaiting');
    expect(actor.update).not.toHaveBeenCalled();
    expect(FixedRoll.made).toHaveLength(0);
    expect(postCard).not.toHaveBeenCalled();
  });

  it('linked, seq 2: each End Floor consumes one floor end in the SAME update as undoStack and floor; the third is refused', async () => {
    link({ floorEndSeq: 2 });
    const actor = makeActor({ system: { floor: 1 } });

    await actor.endFloor();
    expect(actor.update).toHaveBeenCalledTimes(1);
    const first = actor.update.mock.calls[0][0];
    expect(Object.keys(first).sort()).toEqual(['system.floor', 'system.floorEndDone', 'system.undoStack']);
    expect(first['system.floorEndDone']).toBe(1);
    expect(first['system.floor']).toBe(2);

    await actor.endFloor();
    expect(actor.update).toHaveBeenCalledTimes(2);
    expect(actor.update.mock.calls[1][0]['system.floorEndDone']).toBe(2);
    expect(actor.system.floor).toBe(3);

    expect(await actor.endFloor()).toBeNull();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Advance.FloorWaiting');
    expect(actor.update).toHaveBeenCalledTimes(2);
    expect(actor.system.floorEndDone).toBe(2);
  });

  it('linked End Floor double-click with one floor end: one advance, one update, the cursor moves once', async () => {
    link({ floorEndSeq: 1 });
    const actor = makeActor({ system: { floor: 2 } });
    const results = await Promise.all([actor.endFloor(), actor.endFloor()]);
    expect(results.filter(r => r !== null)).toHaveLength(1);
    expect(actor.update).toHaveBeenCalledTimes(1);
    expect(actor.system.floorEndDone).toBe(1);
    expect(actor.system.floor).toBe(3);
  });

  it('the snapshot holds the PRE-increment cursor and the current epoch', async () => {
    link({ floorEndSeq: 1 });
    const actor = makeActor({ system: { floorEndEpoch: 3 } });
    await actor.endFloor();
    expect(actor.system.undoStack.at(-1)).toMatchObject({ floorEndDone: 0, floorEndEpoch: 3 });
  });

  it('linked End Floor then Undo restores floorEndDone at the same epoch: End Floor is available again', async () => {
    link({ floorEndSeq: 1 });
    const actor = makeActor({ system: { floor: 2 } });
    await actor.endFloor();
    expect(gmLinkFor(actor).available).toBe(0);
    await actor.undoAdvancement();
    expect(actor.system.floorEndDone).toBe(0);
    expect(actor.system.floor).toBe(2);
    expect(gmLinkFor(actor).available).toBe(1);
    expect(await actor.endFloor()).not.toBeNull();
  });

  it('End Floor at epoch 1, re-link (epoch 2), Undo: the cursor is NOT restored and the epoch stays 2', async () => {
    link({ floorEndSeq: 1 });
    const actor = makeActor({ system: { floorEndEpoch: 1 } });
    await actor.endFloor();
    expect(actor.system.floorEndDone).toBe(1);
    actor.system.floorEndEpoch = 2; // a re-baseline (roster re-add / setting change)
    actor.update.mockClear();
    await actor.undoAdvancement();
    expect(updateKeys(actor)).not.toContain('system.floorEndDone');
    expect(updateKeys(actor)).not.toContain('system.floorEndEpoch');
    expect(actor.system.floorEndDone).toBe(1);
    expect(actor.system.floorEndEpoch).toBe(2);
    expect(actor.system.floor).toBe(1); // the rest of the undo still applies
  });

  it('Undo passes the RAW source epoch: a missing current epoch never restores the cursor', async () => {
    const actor = makeActor({
      system: { floorEndEpoch: undefined, floorEndDone: 1, undoStack: [{ skills: [], pendingLevels: 0, floor: 1, floorEndDone: 0, floorEndEpoch: 0 }] },
    });
    await actor.undoAdvancement();
    expect(updateKeys(actor)).not.toContain('system.floorEndDone');
    expect(actor.system.floorEndDone).toBe(1);
  });

  it('endSession while linked never writes floorEndDone (and is not gated by floor ends)', async () => {
    link({ floorEndSeq: 0 });
    const actor = makeActor();
    expect(await actor.endSession()).not.toBeNull();
    expect(updateKeys(actor)).not.toContain('system.floorEndDone');
    expect(actor.system.pendingLevels).toBe(1);
  });

  it('unlinked End Floor (default mock) never writes floorEndDone', async () => {
    const actor = makeActor({ system: { floor: 1 } });
    expect(await actor.endFloor()).not.toBeNull();
    expect(updateKeys(actor)).not.toContain('system.floorEndDone');
    expect(actor.system.floor).toBe(2);
  });

  it('a screen that does not roster this PC leaves End Floor ungated', async () => {
    link({ floorEndSeq: 0, roster: ['Actor.other'] });
    const actor = makeActor();
    expect(await actor.endFloor()).not.toBeNull();
    expect(updateKeys(actor)).not.toContain('system.floorEndDone');
  });

  it('linked, floor 3, pending 1: safehouse off refuses Level Up with Safehouse; on allows it', async () => {
    link({ safehouse: false });
    const actor = makeActor({ system: { floor: 3, pendingLevels: 1, level: 2 } });
    expect(await actor.levelUp()).toBeNull();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Advance.Blocked.Safehouse');
    expect(actor.update).not.toHaveBeenCalled();

    screen.system.safehouse = true;
    expect(await actor.levelUp()).toBe(actor);
    expect(actor.system.level).toBe(3);
    expect(actor.system.pendingLevels).toBe(0);
  });

  it('an unlinked PC is never Safehouse-blocked', async () => {
    const actor = makeActor({ system: { floor: 3, pendingLevels: 1 } });
    expect(await actor.levelUp()).toBe(actor);
  });

  it('a mob never reaches the gate (#advancementGuard refuses it)', async () => {
    link({ floorEndSeq: 1, safehouse: true });
    const actor = makeActor({ type: 'mob', system: { floor: 3, pendingLevels: 1 } });
    const spy = vi.spyOn(actor, 'advancementGate');
    for (const fn of ['endFloor', 'levelUp']) expect(await actor[fn]()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  describe('one shared gate for the actor and the sheet', () => {
    it('advancementGate() is gmLinkFor(actor) on the source data', () => {
      link({ floorEndSeq: 3, safehouse: true });
      const actor = makeActor({ system: { floorEndDone: 1 } });
      expect(actor.advancementGate()).toEqual(gmLinkFor(actor));
      expect(actor.advancementGate()).toEqual({ linked: true, safehouse: true, available: 2 });
    });

    it('endFloor and levelUp read the gate through advancementGate', async () => {
      const actor = makeActor({ system: { floor: 3, pendingLevels: 1 } });
      const spy = vi.spyOn(actor, 'advancementGate').mockReturnValue({ linked: true, safehouse: false, available: 0 });
      expect(await actor.endFloor()).toBeNull();
      expect(await actor.levelUp()).toBeNull();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(ui.notifications.warn.mock.calls.map(c => c[0])).toEqual(['DCC.Advance.FloorWaiting', 'DCC.Advance.Blocked.Safehouse']);
    });

    it.each([
      ['safehouse off, no floor end', { safehouse: false, floorEndSeq: 0 }],
      ['safehouse on, one floor end', { safehouse: true, floorEndSeq: 1 }],
    ])('%s: the sheet view (advancementView + advancementGate) agrees with the actor', async (_label, gate) => {
      link(gate);
      const actor = makeActor({ system: { floor: 3, pendingLevels: 1 } });
      const src = actor.system._source ?? actor.system; // what the sheet passes (Task 31)
      const view = advancementView(src, true, actor.advancementGate(src));

      const leveled = await actor.levelUp();
      expect(leveled !== null).toBe(view.canLevelUp);
      if (!view.canLevelUp) expect(ui.notifications.warn).toHaveBeenLastCalledWith(view.levelUpTooltip);

      ui.notifications.warn.mockClear();
      const ended = await actor.endFloor();
      expect(ended !== null).toBe(view.canEndFloor);
      if (!view.canEndFloor) expect(ui.notifications.warn).toHaveBeenLastCalledWith(view.endFloorTooltip);
    });
  });
});
