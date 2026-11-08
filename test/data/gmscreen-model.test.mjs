import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GmScreenModel } from '../../module/data/actor/_module.mjs';
import { floorEndsAvailable } from '../../module/rules/gm-screen.mjs';

// The mock TypeDataModel only Object.assigns its data: `_source` and `parent`
// are attached by hand. The mock has no CONST, so it is stubbed per test.

const makeModel = (source) => {
  const model = new GmScreenModel();
  if (source) model._source = source;
  model.parent = { updateSource: vi.fn() };
  return model;
};

describe('GmScreenModel#_preCreate', () => {
  beforeEach(() => { globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } }; });
  afterEach(() => { delete globalThis.CONST; });

  it('defaults ownership to Observer and writes an empty roster for an empty source', async () => {
    const model = makeModel();
    await model._preCreate({}, {}, {});
    expect(model.parent.updateSource).toHaveBeenCalledTimes(1);
    expect(model.parent.updateSource).toHaveBeenCalledWith({ 'ownership.default': 2, 'system.roster': [] });
  });

  it('dedupes the source roster in the same updateSource call', async () => {
    const model = makeModel({ roster: ['Actor.a', 'Actor.a'] });
    await model._preCreate({}, {}, {});
    expect(model.parent.updateSource).toHaveBeenCalledTimes(1);
    expect(model.parent.updateSource).toHaveBeenCalledWith({ 'ownership.default': 2, 'system.roster': ['Actor.a'] });
  });

  it('falls back to the create data roster when the source has none', async () => {
    const model = makeModel();
    await model._preCreate({ system: { roster: ['Actor.a', 'Actor.b', 'Actor.a'] } }, {}, {});
    expect(model.parent.updateSource).toHaveBeenCalledWith(
      { 'ownership.default': 2, 'system.roster': ['Actor.a', 'Actor.b'] });
  });

  it('keeps an ownership default that arrives with the create (duplicated screen)', async () => {
    const model = makeModel();
    await model._preCreate({ ownership: { default: 0 } }, {}, {});
    expect(model.parent.updateSource).toHaveBeenCalledTimes(1);
    const [update] = model.parent.updateSource.mock.calls[0];
    expect(update).not.toHaveProperty(['ownership.default']);
    expect(update).toEqual({ 'system.roster': [] });
  });

  it('returns false without writing when super._preCreate cancels', async () => {
    const model = makeModel();
    const proto = Object.getPrototypeOf(GmScreenModel.prototype);
    const spy = vi.spyOn(proto, '_preCreate').mockResolvedValue(false);
    try {
      expect(await model._preCreate({}, {}, {})).toBe(false);
      expect(model.parent.updateSource).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe('GmScreenModel#_preUpdate', () => {
  it('dedupes changes.system.roster', async () => {
    const model = makeModel();
    const changes = { system: { roster: ['Actor.a', 'Actor.b', 'Actor.a'] } };
    await model._preUpdate(changes, {}, {});
    expect(changes.system.roster).toEqual(['Actor.a', 'Actor.b']);
  });

  it('leaves changes without a roster untouched', async () => {
    const model = makeModel();
    const changes = { system: { safehouse: true } };
    await model._preUpdate(changes, {}, {});
    expect(changes).toEqual({ system: { safehouse: true } });
    const empty = {};
    await model._preUpdate(empty, {}, {});
    expect(empty).toEqual({});
    const nullRoster = { system: { roster: null } };
    await model._preUpdate(nullRoster, {}, {});
    expect(nullRoster).toEqual({ system: { roster: null } });
  });

  it('returns super._preUpdate\'s false while still deduping the roster', async () => {
    const model = makeModel();
    const proto = Object.getPrototypeOf(GmScreenModel.prototype);
    const spy = vi.spyOn(proto, '_preUpdate').mockResolvedValue(false);
    try {
      const changes = { system: { roster: ['Actor.a', 'Actor.a'] } };
      expect(await model._preUpdate(changes)).toBe(false);
      expect(changes.system.roster).toEqual(['Actor.a']);
    } finally { spy.mockRestore(); }
  });
});

// ---- Task 29: roster, floor-end counter and re-baseline operations ----
// foundry.documents.Actor.implementation, game.user, fromUuidSync and ui are
// stubbed per test and restored after. The parent stub has no `system`: every
// method reads this._source.

describe('GmScreenModel operations', () => {
  let saved;
  let byUuid;
  const operationsModel = (source = {}) => {
    const model = new GmScreenModel();
    model._source = { safehouse: false, floorEndSeq: 0, roster: [], ...source };
    model.parent = { id: 'scr', update: vi.fn(async () => {}) };
    return model;
  };
  const pcActor = (id, system = {}, extra = {}) => ({ id, documentName: 'Actor', type: 'pc', name: id,
    uuid: `Actor.${id}`, isToken: false, system: { _source: system, ...system }, ...extra });
  const register = (...actors) => { for (const a of actors) byUuid.set(a.uuid, a); };
  const updateDocuments = () => foundry.documents.Actor.implementation.updateDocuments;

  beforeEach(() => {
    saved = { impl: foundry.documents.Actor.implementation, user: game.user,
      fromUuidSync: foundry.utils.fromUuidSync, ui: globalThis.ui };
    byUuid = new Map();
    foundry.documents.Actor.implementation = { updateDocuments: vi.fn(async u => u) };
    game.user = { isGM: true, isActiveGM: true };
    foundry.utils.fromUuidSync = vi.fn(uuid => byUuid.get(uuid) ?? null);
    globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
  });
  afterEach(() => {
    foundry.documents.Actor.implementation = saved.impl;
    game.user = saved.user;
    foundry.utils.fromUuidSync = saved.fromUuidSync;
    globalThis.ui = saved.ui;
    vi.restoreAllMocks();
  });

  describe('addToRoster', () => {
    it('mid-campaign add baselines the pc and writes the roster in one request (available 0)', async () => {
      const model = operationsModel({ floorEndSeq: 3 });
      const pc = pcActor('pc', { floorEndDone: 0, floorEndEpoch: 1 });
      await model.addToRoster(pc);
      expect(updateDocuments()).toHaveBeenCalledTimes(1);
      expect(updateDocuments()).toHaveBeenCalledWith([
        { _id: 'pc', 'system.floorEndDone': 3, 'system.floorEndEpoch': 2 },
        { _id: 'scr', 'system.roster': ['Actor.pc'] },
      ]);
      const [[baseline]] = updateDocuments().mock.calls[0];
      expect(floorEndsAvailable(3, baseline['system.floorEndDone'])).toBe(0);
      expect(model.parent.update).not.toHaveBeenCalled();
    });

    it('takes the roster entry back out when the client drops the baseline row', async () => {
      const model = operationsModel({ floorEndSeq: 3, roster: ['Actor.a'] });
      // The screen row lands (its source now lists the pc); the pc row was vetoed client-side.
      foundry.documents.Actor.implementation.updateDocuments = vi.fn(async (rows) => {
        model._source.roster = rows[1]['system.roster'];
        return [{ id: 'scr' }];
      });
      const format = vi.spyOn(game.i18n, 'format');
      expect(await model.addToRoster(pcActor('pc'))).toBeNull();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
      expect(format).toHaveBeenCalledWith('DCC.GmScreen.AddFailed', { name: 'pc' });
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.roster': ['Actor.a'] });
    });

    it('warns without a roster write when both rows were dropped', async () => {
      const model = operationsModel({ floorEndSeq: 3 });
      foundry.documents.Actor.implementation.updateDocuments = vi.fn(async () => []);
      expect(await model.addToRoster(pcActor('pc'))).toBeNull();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
      expect(model.parent.update).not.toHaveBeenCalled();
    });

    it('returns the updated documents when the baseline row lands', async () => {
      const model = operationsModel();
      const docs = [{ id: 'pc' }, { id: 'scr' }];
      foundry.documents.Actor.implementation.updateDocuments = vi.fn(async () => docs);
      expect(await model.addToRoster(pcActor('pc'))).toBe(docs);
      expect(ui.notifications.warn).not.toHaveBeenCalled();
    });

    it('appends to an existing roster', async () => {
      const model = operationsModel({ floorEndSeq: 1, roster: ['Actor.a'] });
      await model.addToRoster(pcActor('pc'));
      const [rows] = updateDocuments().mock.calls[0];
      expect(rows).toEqual([
        { _id: 'pc', 'system.floorEndDone': 1, 'system.floorEndEpoch': 1 },
        { _id: 'scr', 'system.roster': ['Actor.a', 'Actor.pc'] },
      ]);
    });

    it('a re-drop of a rostered pc writes nothing and shows info', async () => {
      const model = operationsModel({ floorEndSeq: 3, roster: ['Actor.pc'] });
      const format = vi.spyOn(game.i18n, 'format');
      expect(await model.addToRoster(pcActor('pc', { floorEndDone: 1 }))).toBeNull();
      expect(updateDocuments()).not.toHaveBeenCalled();
      expect(model.parent.update).not.toHaveBeenCalled();
      expect(ui.notifications.info).toHaveBeenCalledTimes(1);
      expect(ui.notifications.warn).not.toHaveBeenCalled();
      expect(format).toHaveBeenCalledWith('DCC.GmScreen.AlreadyRostered', { name: 'pc' });
    });

    it('a token actor adds its base uuid and baselines the base actor', async () => {
      const model = operationsModel({ floorEndSeq: 2 });
      const base = pcActor('base', { floorEndDone: 0, floorEndEpoch: 4 });
      const token = { id: 'tok', type: 'pc', name: 'tok', isToken: true, uuid: 'Scene.s.Token.t.Actor.base',
        token: { baseActor: base }, system: { _source: { floorEndDone: 9, floorEndEpoch: 9 } } };
      await model.addToRoster(token);
      expect(updateDocuments()).toHaveBeenCalledWith([
        { _id: 'base', 'system.floorEndDone': 2, 'system.floorEndEpoch': 5 },
        { _id: 'scr', 'system.roster': ['Actor.base'] },
      ]);
    });

    it('refuses a mob, a compendium pc and a null with a warning and no write', async () => {
      const model = operationsModel();
      const localize = vi.spyOn(game.i18n, 'localize');
      for (const bad of [pcActor('m', {}, { type: 'mob' }), pcActor('c', {}, { pack: 'world.pcs' }), null]) {
        expect(await model.addToRoster(bad)).toBeNull();
      }
      expect(ui.notifications.warn).toHaveBeenCalledTimes(3);
      expect(localize).toHaveBeenCalledWith('DCC.GmScreen.DropRejected');
      expect(updateDocuments()).not.toHaveBeenCalled();
      expect(model.parent.update).not.toHaveBeenCalled();
    });

    it('refuses a pc without a resolvable base uuid', async () => {
      const model = operationsModel();
      expect(await model.addToRoster({ type: 'pc', isToken: true, token: {}, system: {} })).toBeNull();
      expect(await model.addToRoster({ type: 'pc', isToken: false, id: 'x', system: {} })).toBeNull();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(2);
      expect(ui.notifications.info).not.toHaveBeenCalled();
      expect(updateDocuments()).not.toHaveBeenCalled();
    });

    it('a non-GM writes nothing, even for their own pc', async () => {
      game.user = { isGM: false, isActiveGM: false };
      const model = operationsModel({ floorEndSeq: 3 });
      expect(await model.addToRoster(pcActor('mine', { floorEndDone: 0 }, { isOwner: true }))).toBeNull();
      expect(updateDocuments()).not.toHaveBeenCalled();
      expect(model.parent.update).not.toHaveBeenCalled();
      expect(ui.notifications.warn).not.toHaveBeenCalled();
    });
  });

  describe('removeFromRoster', () => {
    it('writes only the screen roster, with no pc write', async () => {
      const model = operationsModel({ roster: ['Actor.a', 'Actor.b'] });
      await model.removeFromRoster('Actor.a');
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.roster': ['Actor.b'] });
      expect(updateDocuments()).not.toHaveBeenCalled();
    });

    it('a non-GM writes nothing', async () => {
      game.user = { isGM: false, isActiveGM: false };
      const model = operationsModel({ roster: ['Actor.a'] });
      expect(await model.removeFromRoster('Actor.a')).toBeNull();
      expect(model.parent.update).not.toHaveBeenCalled();
    });
  });

  describe('endFloor', () => {
    it('only bumps the counter', async () => {
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.a'] });
      await model.endFloor();
      expect(model.parent.update).toHaveBeenCalledTimes(1);
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 3 });
      expect(updateDocuments()).not.toHaveBeenCalled();
    });

    it('is allowed with an empty roster', async () => {
      const model = operationsModel();
      await model.endFloor();
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 1 });
    });

    it('a non-GM writes nothing', async () => {
      game.user = { isGM: false, isActiveGM: false };
      const model = operationsModel({ floorEndSeq: 2 });
      expect(await model.endFloor()).toBeNull();
      expect(model.parent.update).not.toHaveBeenCalled();
    });
  });

  describe('undoEndFloor', () => {
    it('at seq 0 makes no call', async () => {
      const model = operationsModel({ floorEndSeq: 0 });
      expect(await model.undoEndFloor()).toBeNull();
      expect(model.parent.update).not.toHaveBeenCalled();
      expect(ui.notifications.warn).not.toHaveBeenCalled();
    });

    it('is blocked by a rostered pc at the counter and names it', async () => {
      register(pcActor('carl', { floorEndDone: 2 }), pcActor('donut', { floorEndDone: 1 }));
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.carl', 'Actor.donut'] });
      const format = vi.spyOn(game.i18n, 'format');
      expect(await model.undoEndFloor()).toBeNull();
      expect(model.parent.update).not.toHaveBeenCalled();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
      expect(format).toHaveBeenCalledWith('DCC.GmScreen.UndoBlocked', { names: 'carl' });
    });

    it('names every blocker via the list formatter', async () => {
      register(pcActor('carl', { floorEndDone: 2 }), pcActor('donut', { floorEndDone: 3 }));
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.carl', 'Actor.donut'] });
      const format = vi.spyOn(game.i18n, 'format');
      await model.undoEndFloor();
      expect(format).toHaveBeenCalledWith('DCC.GmScreen.UndoBlocked', { names: 'carl, donut' });
    });

    it('reads the pc cursor from its source, not the prepared system', async () => {
      register({ ...pcActor('carl'), system: { floorEndDone: 2, _source: { floorEndDone: 1 } } });
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.carl'] });
      await model.undoEndFloor();
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 1 });
    });

    it('succeeds when every rostered pc is behind the counter, touching only the counter', async () => {
      register(pcActor('carl', { floorEndDone: 1 }));
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.carl'] });
      await model.undoEndFloor();
      expect(model.parent.update).toHaveBeenCalledTimes(1);
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 1 });
      expect(updateDocuments()).not.toHaveBeenCalled();
      expect(ui.notifications.warn).not.toHaveBeenCalled();
    });

    it('warns, naming the pc, when a pc End Floor raced past the new counter', async () => {
      const carl = pcActor('carl', { floorEndDone: 1 });
      register(carl, pcActor('donut', { floorEndDone: 0 }));
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.carl', 'Actor.donut'] });
      // Another client's End Floor lands while the undo is in flight.
      model.parent.update = vi.fn(async (u) => { carl.system._source.floorEndDone = 2; model._source.floorEndSeq = u['system.floorEndSeq']; });
      const format = vi.spyOn(game.i18n, 'format');
      await model.undoEndFloor();
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 1 });
      expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
      expect(format).toHaveBeenCalledWith('DCC.GmScreen.UndoRaced', { names: 'carl' });
    });

    it('ignores roster uuids that resolve to a non-pc (edited roster)', async () => {
      register(pcActor('mob', { floorEndDone: 5 }, { type: 'mob' }),
        pcActor('item', { floorEndDone: 5 }, { documentName: 'Item', type: 'pc' }),
        pcActor('packed', { floorEndDone: 5 }, { pack: 'world.pcs' }));
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.mob', 'Actor.item', 'Actor.packed'] });
      await model.undoEndFloor();
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 1 });
      expect(ui.notifications.warn).not.toHaveBeenCalled();
      await model.rebaselineRoster();
      expect(updateDocuments()).not.toHaveBeenCalled();
    });

    it('a missing roster entry does not block', async () => {
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.gone'] });
      await model.undoEndFloor();
      expect(model.parent.update).toHaveBeenCalledWith({ 'system.floorEndSeq': 1 });
    });

    it('a non-GM writes nothing', async () => {
      game.user = { isGM: false, isActiveGM: false };
      const model = operationsModel({ floorEndSeq: 2 });
      expect(await model.undoEndFloor()).toBeNull();
      expect(model.parent.update).not.toHaveBeenCalled();
    });
  });

  describe('reads _source, not the prepared model', () => {
    it('every method uses _source.floorEndSeq and _source.roster', async () => {
      register(pcActor('a', { floorEndDone: 0, floorEndEpoch: 0 }));
      const model = operationsModel({ floorEndSeq: 2, roster: ['Actor.a'] });
      Object.assign(model, { floorEndSeq: 99, roster: ['Actor.x'] });
      await model.endFloor();
      expect(model.parent.update).toHaveBeenLastCalledWith({ 'system.floorEndSeq': 3 });
      await model.undoEndFloor();
      expect(model.parent.update).toHaveBeenLastCalledWith({ 'system.floorEndSeq': 1 });
      await model.removeFromRoster('Actor.a');
      expect(model.parent.update).toHaveBeenLastCalledWith({ 'system.roster': [] });
      await model.rebaselineRoster();
      expect(updateDocuments()).toHaveBeenLastCalledWith([{ _id: 'a', 'system.floorEndDone': 2, 'system.floorEndEpoch': 1 }]);
      await model.addToRoster(pcActor('b'));
      expect(updateDocuments()).toHaveBeenLastCalledWith([
        { _id: 'b', 'system.floorEndDone': 2, 'system.floorEndEpoch': 1 },
        { _id: 'scr', 'system.roster': ['Actor.a', 'Actor.b'] },
      ]);
    });
  });

  describe('rebaselineRoster', () => {
    it('writes one baseline row per present rostered actor in one call', async () => {
      register(pcActor('a', { floorEndDone: 0, floorEndEpoch: 1 }), pcActor('b', { floorEndDone: 5, floorEndEpoch: 0 }));
      const model = operationsModel({ floorEndSeq: 4, roster: ['Actor.a', 'Actor.gone', 'Actor.b'] });
      await model.rebaselineRoster();
      expect(updateDocuments()).toHaveBeenCalledTimes(1);
      expect(updateDocuments()).toHaveBeenCalledWith([
        { _id: 'a', 'system.floorEndDone': 4, 'system.floorEndEpoch': 2 },
        { _id: 'b', 'system.floorEndDone': 4, 'system.floorEndEpoch': 1 },
      ]);
      expect(model.parent.update).not.toHaveBeenCalled();
    });

    it('an all-missing or empty roster makes no call', async () => {
      await operationsModel({ floorEndSeq: 4, roster: ['Actor.gone'] }).rebaselineRoster();
      await operationsModel({ floorEndSeq: 4 }).rebaselineRoster();
      expect(updateDocuments()).not.toHaveBeenCalled();
    });

    it('a non-GM writes nothing', async () => {
      game.user = { isGM: false, isActiveGM: false };
      register(pcActor('a'));
      expect(await operationsModel({ roster: ['Actor.a'] }).rebaselineRoster()).toBeNull();
      expect(updateDocuments()).not.toHaveBeenCalled();
    });
  });
});
