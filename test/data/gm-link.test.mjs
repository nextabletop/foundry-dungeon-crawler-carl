import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SYSTEM_ID } from '../../module/config.mjs';
import { UNLINKED } from '../../module/rules/gm-screen.mjs';
import {
  GM_SCREEN_SETTING, gmScreenId, gmLinkFor, rosterEntries,
  rerenderActorSheets, rerenderPcSheets, onGmScreenSettingChange, onUpdateActor,
  onDeleteActor, onCreateActor, registerGmScreenSetting, registerGmScreenHooks,
} from '../../module/gm-link.mjs';
import { flushRenders } from '../../module/sheet-refresh.mjs';

// Every Foundry global this module reads is stubbed per test and restored
// after, so the shared mock defaults (unlinked) stay intact for other files.

class FakeSheet {}
const app = (document, rendered = true) => Object.assign(new FakeSheet(), { document, rendered, render: vi.fn() });

const screen = (id, roster = [], extra = {}) => ({ id, type: 'gmscreen', name: 'Screen', uuid: `Actor.${id}`,
  system: { safehouse: false, floorEndSeq: 0, roster, ...extra } });
const pc = (id, system = {}) => ({ id, type: 'pc', name: id, uuid: `Actor.${id}`, isToken: false, system: { _source: system, ...system } });

let saved;
let setting;
beforeEach(() => {
  saved = {
    settings: game.settings, actors: game.actors, user: game.user,
    fromUuidSync: foundry.utils.fromUuidSync, instances: foundry.applications.instances,
    sheets: foundry.applications.sheets, notifications: globalThis.ui, debounce: foundry.utils.debounce,
  };
  setting = '';
  game.settings = { get: vi.fn(() => setting), set: vi.fn(async () => {}), register: vi.fn() };
  game.actors = new Map();
  game.user = { isGM: true, isActiveGM: true };
  foundry.utils.fromUuidSync = vi.fn(() => null);
  foundry.applications.instances = new Map();
  foundry.applications.sheets = { ...(saved.sheets ?? {}), ActorSheetV2: FakeSheet };
  globalThis.ui = { notifications: { error: vi.fn() } };
  // Renders go through the shared queue (sheet-refresh.mjs); its debounce never
  // fires here, and each test drains the queue with flushRenders().
  foundry.utils.debounce = () => () => {};
});
afterEach(() => {
  game.settings = saved.settings;
  game.actors = saved.actors;
  game.user = saved.user;
  foundry.utils.fromUuidSync = saved.fromUuidSync;
  foundry.applications.instances = saved.instances;
  foundry.applications.sheets = saved.sheets;
  globalThis.ui = saved.notifications;
  flushRenders(); // never leak a queued app into the next test
  foundry.utils.debounce = saved.debounce;
});

const addActors = (...actors) => { for (const a of actors) game.actors.set(a.id, a); };
const openApps = (...apps) => { apps.forEach((a, i) => foundry.applications.instances.set(`app${i}`, a)); return apps; };

describe('mock defaults', () => {
  it('leave every actor unlinked', () => {
    expect(saved.settings.get(SYSTEM_ID, GM_SCREEN_SETTING)).toBe('');
    expect(saved.actors.get('x')).toBeUndefined();
    expect(saved.user.isActiveGM).toBe(true);
    expect(saved.fromUuidSync('Actor.x')).toBeNull();
    expect(saved.instances.size).toBe(0);
  });
});

describe('gmScreenId', () => {
  it('reads the world setting', () => {
    expect(gmScreenId()).toBe('');
    setting = 's';
    expect(gmScreenId()).toBe('s');
    expect(game.settings.get).toHaveBeenCalledWith(SYSTEM_ID, GM_SCREEN_SETTING);
  });
});

describe('gmLinkFor', () => {
  it('gives UNLINKED for a mob, even one on the roster', () => {
    addActors(screen('s', ['Actor.m'], { floorEndSeq: 2 }));
    setting = 's';
    expect(gmLinkFor({ id: 'm', type: 'mob', uuid: 'Actor.m', system: {} })).toBe(UNLINKED);
  });

  it('gives UNLINKED for a pc when the setting is blank', () => {
    addActors(screen('s', ['Actor.carl'], { floorEndSeq: 2 }));
    expect(gmLinkFor(pc('carl'))).toEqual(UNLINKED);
  });

  it('links a rostered pc with the right available count', () => {
    addActors(screen('s', ['Actor.carl'], { floorEndSeq: 3, safehouse: true }));
    setting = 's';
    expect(gmLinkFor(pc('carl', { floorEndDone: 1 }))).toEqual({ linked: true, safehouse: true, available: 2 });
  });

  it('reads the cursor from the source by default, not the prepared system', () => {
    addActors(screen('s', ['Actor.carl'], { floorEndSeq: 3 }));
    setting = 's';
    const actor = { id: 'carl', type: 'pc', uuid: 'Actor.carl', system: { floorEndDone: 3, _source: { floorEndDone: 1 } } };
    expect(gmLinkFor(actor).available).toBe(2);
    expect(gmLinkFor(actor, { floorEndDone: 0 }).available).toBe(3);
  });

  it('resolves a token actor by its base uuid but uses its own cursor', () => {
    addActors(screen('s', ['Actor.a'], { floorEndSeq: 3 }));
    setting = 's';
    const token = { type: 'pc', isToken: true, uuid: 'Scene.x.Token.t.Actor.a',
      token: { baseActor: { id: 'a', uuid: 'Actor.a', system: { floorEndDone: 0 } } },
      system: { _source: { floorEndDone: 2 } } };
    expect(gmLinkFor(token)).toEqual({ linked: true, safehouse: false, available: 1 });
  });

  it('gives UNLINKED for null', () => {
    expect(gmLinkFor(null)).toBe(UNLINKED);
  });
});

describe('rosterEntries', () => {
  it('accepts a uuid array or a screen and maps unresolved uuids to null', () => {
    const carl = pc('carl');
    foundry.utils.fromUuidSync = vi.fn(uuid => (uuid === 'Actor.carl' ? carl : undefined));
    const expected = [{ uuid: 'Actor.carl', actor: carl }, { uuid: 'Actor.gone', actor: null }];
    expect(rosterEntries(['Actor.carl', 'Actor.gone'])).toEqual(expected);
    expect(rosterEntries({ system: { roster: ['Actor.carl', 'Actor.gone'] } })).toEqual(expected);
    expect(rosterEntries(null)).toEqual([]);
  });
});

describe('rerenderActorSheets', () => {
  it('renders only rendered ActorSheetV2 apps with a document matching the predicate', () => {
    const [hit, closed, other, noDoc, miss] = openApps(
      app(pc('a')), app(pc('b'), false),
      Object.assign({}, { document: pc('c'), rendered: true, render: vi.fn() }),
      app(null), app({ type: 'mob' }),
    );
    rerenderActorSheets(a => a.type === 'pc'); flushRenders();
    expect(hit.render).toHaveBeenCalledTimes(1);
    expect(hit.render).toHaveBeenCalledWith();
    for (const a of [closed, other, noDoc, miss]) expect(a.render).not.toHaveBeenCalled();
  });

  it('rerenderPcSheets renders the pc sheets only', () => {
    const [p, s] = openApps(app(pc('a')), app(screen('s')));
    rerenderPcSheets(); flushRenders();
    expect(p.render).toHaveBeenCalledTimes(1);
    expect(s.render).not.toHaveBeenCalled();
  });
});

describe('onUpdateActor', () => {
  it('an update of the configured screen re-renders the pc sheets only', () => {
    const s = screen('s', ['Actor.a']);
    addActors(s);
    setting = 's';
    const [p, sApp, m] = openApps(app(pc('a')), app(s), app({ type: 'mob' }));
    onUpdateActor(s); flushRenders();
    expect(p.render).toHaveBeenCalledTimes(1);
    expect(sApp.render).not.toHaveBeenCalled();
    expect(m.render).not.toHaveBeenCalled();
  });

  it('an update of a rostered pc re-renders that screen\'s open sheet', () => {
    const s = screen('s', ['Actor.a']);
    const other = screen('o', ['Actor.b']);
    const a = pc('a');
    const [aApp, sApp, oApp] = openApps(app(a), app(s), app(other));
    onUpdateActor(a); flushRenders();
    expect(sApp.render).toHaveBeenCalledTimes(1);
    expect(oApp.render).not.toHaveBeenCalled();
    expect(aApp.render).not.toHaveBeenCalled();
  });

  it('a token pc update refreshes the screen by its base uuid', () => {
    const s = screen('s', ['Actor.a']);
    const [sApp] = openApps(app(s));
    onUpdateActor({ type: 'pc', isToken: true, token: { baseActor: { uuid: 'Actor.a' } }, uuid: 'Scene.x.Token.t.Actor.a' }); flushRenders();
    expect(sApp.render).toHaveBeenCalledTimes(1);
  });

  it('an update of an unrostered pc re-renders nothing', () => {
    const s = screen('s', ['Actor.a']);
    addActors(s);
    setting = 's';
    const apps = openApps(app(pc('z')), app(s), app(pc('a')));
    onUpdateActor(pc('z')); flushRenders();
    for (const a of apps) expect(a.render).not.toHaveBeenCalled();
  });
});

describe('onDeleteActor', () => {
  it('as the active GM, clears the setting for the configured screen and re-renders pcs', () => {
    setting = 's';
    const [p] = openApps(app(pc('a')));
    onDeleteActor(screen('s')); flushRenders();
    expect(game.settings.set).toHaveBeenCalledWith(SYSTEM_ID, GM_SCREEN_SETTING, '');
    expect(p.render).toHaveBeenCalledTimes(1);
  });

  it('as a non-GM, does not write the setting but still re-renders pcs', () => {
    setting = 's';
    game.user = { isGM: false, isActiveGM: false };
    const [p] = openApps(app(pc('a')));
    onDeleteActor(screen('s')); flushRenders();
    expect(game.settings.set).not.toHaveBeenCalled();
    expect(p.render).toHaveBeenCalledTimes(1);
  });

  it('does not clear the setting for another screen', () => {
    setting = 's';
    onDeleteActor(screen('other')); flushRenders();
    expect(game.settings.set).not.toHaveBeenCalled();
  });

  it('a deleted rostered pc re-renders the screens listing it', () => {
    const [sApp, oApp] = openApps(app(screen('s', ['Actor.a'])), app(screen('o', [])));
    onDeleteActor(pc('a')); flushRenders();
    expect(sApp.render).toHaveBeenCalledTimes(1);
    expect(oApp.render).not.toHaveBeenCalled();
  });
});

describe('coalescing and the missing cases', () => {
  it('an update of a screen that is not the configured one leaves pc sheets alone', () => {
    addActors(screen('s'), screen('o'));
    setting = 's';
    const [p] = openApps(app(pc('a')));
    onUpdateActor(screen('o')); flushRenders();
    expect(p.render).not.toHaveBeenCalled();
  });

  it('a pc whose id equals the setting does not count as the screen', () => {
    setting = 's';
    const [p] = openApps(app(pc('a')));
    onUpdateActor(pc('s')); flushRenders();
    expect(p.render).not.toHaveBeenCalled();
  });

  it('deleting an unrostered pc renders nothing', () => {
    const apps = openApps(app(screen('s', ['Actor.a'])), app(pc('a')));
    onDeleteActor(pc('z')); flushRenders();
    for (const a of apps) expect(a.render).not.toHaveBeenCalled();
  });

  it('a screen delete plus its setting onChange renders each pc sheet once', async () => {
    setting = 's';
    const [p] = openApps(app(pc('a')));
    onDeleteActor(screen('s'));
    await onGmScreenSettingChange('');
    flushRenders();
    expect(game.settings.set).toHaveBeenCalledTimes(1);
    expect(p.render).toHaveBeenCalledTimes(1);
  });

  it('reports a failed setting write on delete', async () => {
    setting = 's';
    const err = new Error('nope');
    game.settings.set = vi.fn(() => Promise.reject(err));
    onDeleteActor(screen('s'));
    await Promise.resolve(); await Promise.resolve();
    expect(ui.notifications.error).toHaveBeenCalledWith(err, { console: true });
  });
});

describe('onCreateActor', () => {
  it('a new gmscreen re-renders the pc sheets; other actors do nothing', () => {
    const [p] = openApps(app(pc('a')));
    onCreateActor(pc('b')); flushRenders();
    expect(p.render).not.toHaveBeenCalled();
    onCreateActor(screen('s')); flushRenders();
    expect(p.render).toHaveBeenCalledTimes(1);
  });
});

describe('onGmScreenSettingChange', () => {
  const setup = () => {
    const s = screen('s', ['Actor.a']);
    s.system.rebaselineRoster = vi.fn(async () => {});
    addActors(s);
    const [p, sApp] = openApps(app(pc('a')), app(s));
    return { s, p, sApp };
  };

  it('as a non-active-GM, re-renders pc and gmscreen sheets only', async () => {
    const { s, p, sApp } = setup();
    game.user = { isGM: true, isActiveGM: false };
    await onGmScreenSettingChange('s'); flushRenders();
    expect(p.render).toHaveBeenCalledTimes(1);
    expect(sApp.render).toHaveBeenCalledTimes(1);
    expect(s.system.rebaselineRoster).not.toHaveBeenCalled();
  });

  it('as the active GM with a resolving screen, re-baselines its roster once', async () => {
    const { s, p, sApp } = setup();
    await onGmScreenSettingChange('s'); flushRenders();
    expect(s.system.rebaselineRoster).toHaveBeenCalledTimes(1);
    expect(p.render).toHaveBeenCalledTimes(1);
    expect(sApp.render).toHaveBeenCalledTimes(1);
  });

  it('a blank or unresolved value never re-baselines', async () => {
    const { s } = setup();
    await onGmScreenSettingChange(''); flushRenders();
    await onGmScreenSettingChange('gone'); flushRenders();
    expect(s.system.rebaselineRoster).not.toHaveBeenCalled();
  });

  it('calls rebaselineRoster directly: a screen without it is reported, not silently skipped', async () => {
    addActors(screen('s'));
    await expect(onGmScreenSettingChange('s')).resolves.toBeUndefined();
    expect(ui.notifications.error).toHaveBeenCalledTimes(1);
    expect(ui.notifications.error.mock.calls[0][0]).toBeInstanceOf(TypeError);
  });

  it('reports errors instead of rejecting', async () => {
    const { s } = setup();
    const err = new Error('boom');
    s.system.rebaselineRoster = vi.fn(async () => { throw err; });
    await expect(onGmScreenSettingChange('s')).resolves.toBeUndefined();
    expect(ui.notifications.error).toHaveBeenCalledWith(err, { console: true });
  });
});

describe('registration', () => {
  it('registers a blank-able world string setting whose choices list the gmscreen actors', () => {
    registerGmScreenSetting();
    expect(game.settings.register).toHaveBeenCalledTimes(1);
    const [ns, key, cfg] = game.settings.register.mock.calls[0];
    expect([ns, key]).toEqual([SYSTEM_ID, GM_SCREEN_SETTING]);
    expect(cfg).toMatchObject({ name: 'DCC.Setting.GmScreen.Name', hint: 'DCC.Setting.GmScreen.Hint',
      scope: 'world', config: true, requiresReload: false, default: '', onChange: onGmScreenSettingChange });
    expect(cfg.type).toBeInstanceOf(foundry.data.fields.StringField);
    expect(cfg.type.options.blank).toBe(true);
    const actors = [screen('s1'), pc('a'), { ...screen('s2'), name: 'Two' }];
    game.actors = Object.assign(new Map(actors.map(a => [a.id, a])), { filter: fn => actors.filter(fn) });
    expect(cfg.type.options.choices()).toEqual({ '': '—', s1: 'Screen', s2: 'Two' });
    game.actors = undefined;
    expect(cfg.type.options.choices()).toEqual({ '': '—' });
  });

  it('registers the update, delete and create hooks', () => {
    const saveHooks = globalThis.Hooks;
    globalThis.Hooks = { on: vi.fn() };
    try {
      registerGmScreenHooks();
      expect(Hooks.on.mock.calls).toEqual([
        ['updateActor', onUpdateActor], ['deleteActor', onDeleteActor], ['createActor', onCreateActor]]);
    } finally { globalThis.Hooks = saveHooks; }
  });
});
