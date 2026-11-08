import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { openActorSheets, queueRender, flushRenders } from '../../module/sheet-refresh.mjs';
import { registerCrewHooks } from '../../module/crew-hooks.mjs';
import { onUpdateActor as gmOnUpdateActor } from '../../module/gm-link.mjs';

// The queue creates its debounce lazily on the first queueRender and keeps it,
// so a trailing, timer-based debounce (like foundry.utils.debounce) is stubbed
// for the whole file and driven with fake timers.

class FakeSheet {}
const app = (document, rendered = true) => Object.assign(new FakeSheet(), { document, rendered, render: vi.fn() });
const pc = id => ({ id, type: 'pc', uuid: `Actor.${id}`, system: { _source: {} } });

let saved;
beforeAll(() => {
  saved = { debounce: foundry.utils.debounce, sheets: foundry.applications.sheets, instances: foundry.applications.instances };
  foundry.utils.debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  foundry.applications.sheets = { ...(saved.sheets ?? {}), ActorSheetV2: FakeSheet };
});
afterAll(() => {
  foundry.utils.debounce = saved.debounce;
  foundry.applications.sheets = saved.sheets;
});
beforeEach(() => {
  vi.useFakeTimers();
  foundry.applications.instances = new Map();
});
afterEach(() => {
  flushRenders();
  vi.useRealTimers();
  foundry.applications.instances = saved.instances;
});

const openApps = (...apps) => { apps.forEach((a, i) => foundry.applications.instances.set(`app${i}`, a)); return apps; };

describe('openActorSheets', () => {
  it('keeps rendered ActorSheetV2 apps that have a document', () => {
    const [hit] = openApps(app(pc('a')), app(pc('b'), false), app(null),
      { document: pc('c'), rendered: true, render: vi.fn() });
    expect(openActorSheets()).toEqual([hit]);
  });
});

describe('queueRender', () => {
  it('renders nothing until the debounce fires', () => {
    const a = app(pc('a'));
    queueRender([a]);
    expect(a.render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(a.render).toHaveBeenCalledTimes(1);
    expect(a.render).toHaveBeenCalledWith();
  });

  it('N queued refreshes of the same sheet render it once', () => {
    const a = app(pc('a'));
    const b = app(pc('b'));
    for (let i = 0; i < 5; i += 1) queueRender([a]);
    queueRender([a, b, a]);
    vi.advanceTimersByTime(100);
    expect(a.render).toHaveBeenCalledTimes(1);
    expect(b.render).toHaveBeenCalledTimes(1);
  });

  it('skips an app that closed before the flush', () => {
    const a = app(pc('a'));
    queueRender([a]);
    a.rendered = false;
    vi.advanceTimersByTime(50);
    expect(a.render).not.toHaveBeenCalled();
  });

  it('an empty or missing list queues nothing', () => {
    queueRender([]);
    queueRender(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushRenders drains the queue synchronously', () => {
    const a = app(pc('a'));
    queueRender([a]);
    flushRenders();
    expect(a.render).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(a.render).toHaveBeenCalledTimes(1);
  });
});

describe('crew and GM screen refreshes share the queue', () => {
  it('a crew refresh and a gm-link refresh of the same pc sheet render it once', () => {
    const handlers = {};
    const savedHooks = globalThis.Hooks;
    const savedSettings = game.settings;
    const savedActors = game.actors;
    globalThis.Hooks = { on: (name, fn) => { (handlers[name] ??= []).push(fn); } };
    try {
      registerCrewHooks();
      const screen = { id: 's', type: 'gmscreen', uuid: 'Actor.s', system: { roster: ['Actor.a'] } };
      game.settings = { get: () => 's', set: async () => {} };
      game.actors = new Map([['s', screen]]);
      const vehicle = { id: 'v', type: 'vehicle', uuid: 'Actor.v', system: { _source: { crew: [{ uuid: 'Actor.a' }] } } };
      const pcApp = Object.assign(app(pc('a')), { id: 'pc-a', crewingUuids: ['Actor.v'] });
      openApps(pcApp);

      for (const fn of handlers.updateActor) fn(vehicle, { system: { crew: [] } }); // crew: the pc is aboard
      gmOnUpdateActor(screen); // GM screen: the configured screen changed
      vi.advanceTimersByTime(50);
      expect(pcApp.render).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Hooks = savedHooks;
      game.settings = savedSettings;
      game.actors = savedActors;
    }
  });
});
