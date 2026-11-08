import { describe, it, expect } from 'vitest';
import {
  GM_SCREEN_TYPE, floorEndsAvailable, floorEndBlocked, baseActor, baseActorUuid, resolveGmLink, gmGate, UNLINKED,
  baselineUpdate, uniqueUuids, rosterAdd, rosterRemove, undoFloorEndBlockers, isRosterPc,
} from '../../module/rules/gm-screen.mjs';

// Chunk 8 (docs/superpowers/specs/2026-09-23-gm-screen-design.md, Foundry
// design). Token fixtures mirror v14 core: a synthetic actor has `isToken` and
// `token`; its base actor hangs off the TokenDocument (`token.baseActor`).

const screen = (system = {}) => ({ id: 's1', type: GM_SCREEN_TYPE, system: { safehouse: false, floorEndSeq: 0, roster: [], ...system } });

describe('floorEndBlocked (End Floor refused for a linked Crawler with no floor end)', () => {
  it('linked with none available: blocked', () => {
    expect(floorEndBlocked({ linked: true, safehouse: false, available: 0 })).toBe(true);
  });
  it('linked with one or more available: open', () => {
    expect(floorEndBlocked({ linked: true, safehouse: false, available: 1 })).toBe(false);
    expect(floorEndBlocked({ linked: true, safehouse: true, available: 3 })).toBe(false);
  });
  it('linked with a non-number available fails closed', () => {
    expect(floorEndBlocked({ linked: true, available: null })).toBe(true);
    expect(floorEndBlocked({ linked: true, available: undefined })).toBe(true);
    expect(floorEndBlocked({ linked: true, available: NaN })).toBe(true);
  });
  it('unlinked is never blocked (UNLINKED has available null)', () => {
    expect(floorEndBlocked(UNLINKED)).toBe(false);
    expect(floorEndBlocked({ linked: false, available: 0 })).toBe(false);
  });
  it('a missing gate is unlinked', () => {
    expect(floorEndBlocked()).toBe(false);
    expect(floorEndBlocked(null)).toBe(false);
  });
});

describe('floorEndsAvailable', () => {
  it('is seq minus the cursor, never negative', () => {
    expect(floorEndsAvailable(0, 0)).toBe(0);
    expect(floorEndsAvailable(3, 1)).toBe(2);
    expect(floorEndsAvailable(1, 3)).toBe(0);
  });
  it('reads blanks as 0', () => {
    expect(floorEndsAvailable(undefined, null)).toBe(0);
    expect(floorEndsAvailable('', '')).toBe(0);
    expect(floorEndsAvailable(2, undefined)).toBe(2);
  });
});

describe('baseActor / baseActorUuid', () => {
  it('a world actor is its own base', () => {
    const a = { id: 'a', uuid: 'Actor.a', isToken: false };
    expect(baseActor(a)).toBe(a);
    expect(baseActorUuid(a)).toBe('Actor.a');
  });
  it('a synthetic token actor resolves to token.baseActor', () => {
    const base = { id: 'a', uuid: 'Actor.a' };
    const synth = { isToken: true, token: { baseActor: base }, uuid: 'Scene.s.Token.t.Actor.a' };
    expect(baseActor(synth)).toBe(base);
    expect(baseActorUuid(synth)).toBe('Actor.a');
  });
  it('a token with no base actor gives null', () => {
    expect(baseActor({ isToken: true, token: {} })).toBeNull();
    expect(baseActor({ isToken: true })).toBeNull();
    expect(baseActorUuid({ isToken: true, token: { baseActor: null } })).toBeNull();
  });
  it('null gives null', () => {
    expect(baseActor(null)).toBeNull();
    expect(baseActorUuid(null)).toBeNull();
    expect(baseActorUuid(undefined)).toBeNull();
  });
});

describe('resolveGmLink', () => {
  const unlinked = { screen: null, linked: false };
  it('a blank setting id is unlinked', () => {
    const actorsById = new Map([['s1', screen({ roster: ['Actor.a'] })]]);
    expect(resolveGmLink({ settingId: '', actorsById, baseUuid: 'Actor.a' })).toEqual(unlinked);
    expect(resolveGmLink({ actorsById, baseUuid: 'Actor.a' })).toEqual(unlinked);
    expect(resolveGmLink()).toEqual(unlinked);
  });
  it('an id not in the map fails open', () => {
    expect(resolveGmLink({ settingId: 'gone', actorsById: new Map(), baseUuid: 'Actor.a' })).toEqual(unlinked);
  });
  it('a non-gmscreen actor under the id is unlinked', () => {
    const actorsById = new Map([['m1', { id: 'm1', type: 'mob', system: { roster: ['Actor.a'] } }]]);
    expect(resolveGmLink({ settingId: 'm1', actorsById, baseUuid: 'Actor.a' })).toEqual(unlinked);
  });
  it('a screen whose roster lacks the UUID gives the screen, not linked', () => {
    const s = screen({ roster: ['Actor.b'] });
    const res = resolveGmLink({ settingId: 's1', actorsById: new Map([['s1', s]]), baseUuid: 'Actor.a' });
    expect(res.screen).toBe(s);
    expect(res.linked).toBe(false);
  });
  it('a roster containing the UUID is linked', () => {
    const s = screen({ roster: ['Actor.b', 'Actor.a'] });
    expect(resolveGmLink({ settingId: 's1', actorsById: new Map([['s1', s]]), baseUuid: 'Actor.a' })).toEqual({ screen: s, linked: true });
  });
  it('a null base UUID is not linked', () => {
    const s = screen({ roster: ['Actor.a'] });
    const res = resolveGmLink({ settingId: 's1', actorsById: new Map([['s1', s]]), baseUuid: null });
    expect(res.linked).toBe(false);
  });
});

describe('gmGate', () => {
  it('unlinked gives UNLINKED for any PC', () => {
    expect(gmGate({ screen: null, linked: false }, { floorEndDone: 5 })).toEqual(UNLINKED);
    expect(gmGate({ screen: screen({ floorEndSeq: 3, safehouse: true }), linked: false }, {})).toEqual(UNLINKED);
    expect(gmGate()).toEqual(UNLINKED);
  });
  it('linked without a screen returns the shared UNLINKED object', () => {
    expect(gmGate({ screen: null, linked: true })).toBe(UNLINKED);
  });
  it('linked reads safehouse and the floor ends still available', () => {
    const s = screen({ floorEndSeq: 3, safehouse: true });
    expect(gmGate({ screen: s, linked: true }, { floorEndDone: 1 })).toEqual({ linked: true, safehouse: true, available: 2 });
  });
  it('a missing cursor reads as 0', () => {
    const s = screen({ floorEndSeq: 2 });
    expect(gmGate({ screen: s, linked: true }, {})).toEqual({ linked: true, safehouse: false, available: 2 });
    expect(gmGate({ screen: s, linked: true })).toEqual({ linked: true, safehouse: false, available: 2 });
  });
  it('UNLINKED is a frozen { linked:false, safehouse:false, available:null }', () => {
    expect(UNLINKED).toEqual({ linked: false, safehouse: false, available: null });
    expect(Object.isFrozen(UNLINKED)).toBe(true);
  });
});

describe('baselineUpdate', () => {
  it('sets the cursor to seq and bumps the epoch', () => {
    expect(baselineUpdate({ floorEndEpoch: 2 }, 4)).toEqual({ 'system.floorEndDone': 4, 'system.floorEndEpoch': 3 });
  });
  it('a blank epoch becomes 1', () => {
    expect(baselineUpdate({}, 0)).toEqual({ 'system.floorEndDone': 0, 'system.floorEndEpoch': 1 });
    expect(baselineUpdate(undefined, undefined)).toEqual({ 'system.floorEndDone': 0, 'system.floorEndEpoch': 1 });
    expect(baselineUpdate(null, 4)).toEqual({ 'system.floorEndDone': 4, 'system.floorEndEpoch': 1 });
  });
});

describe('uniqueUuids', () => {
  it('drops duplicates, blanks and non-strings, keeping first-occurrence order', () => {
    expect(uniqueUuids(['Actor.b', '', 'Actor.a', null, 'Actor.b', 7, undefined, 'Actor.c', 'Actor.a']))
      .toEqual(['Actor.b', 'Actor.a', 'Actor.c']);
  });
  it('null gives []', () => {
    expect(uniqueUuids(null)).toEqual([]);
  });
});

describe('rosterAdd / rosterRemove', () => {
  it('appends a new UUID without mutating the input', () => {
    const roster = ['Actor.a'];
    expect(rosterAdd(roster, 'Actor.b')).toEqual(['Actor.a', 'Actor.b']);
    expect(roster).toEqual(['Actor.a']);
  });
  it('an already rostered UUID gives null', () => {
    expect(rosterAdd(['Actor.a', 'Actor.b'], 'Actor.b')).toBeNull();
  });
  it('a blank UUID gives null', () => {
    expect(rosterAdd([], null)).toBeNull();
    expect(rosterAdd([], '')).toBeNull();
  });
  it('a null roster removes to []', () => {
    expect(rosterRemove(null, 'Actor.a')).toEqual([]);
  });
  it('removes every copy', () => {
    expect(rosterRemove(['Actor.a', 'Actor.b', 'Actor.a'], 'Actor.a')).toEqual(['Actor.b']);
  });
  it('an absent UUID gives an equal (new) array', () => {
    const roster = ['Actor.a'];
    const out = rosterRemove(roster, 'Actor.z');
    expect(out).toEqual(roster);
    expect(out).not.toBe(roster);
  });
});

describe('undoFloorEndBlockers', () => {
  it('names Crawlers whose cursor reached seq; skips missing actors', () => {
    expect(undoFloorEndBlockers(2, [{ name: 'Carl', floorEndDone: 2 }, { name: 'Donut', floorEndDone: 1 }, null])).toEqual(['Carl']);
  });
  it('a cursor above seq also blocks', () => {
    expect(undoFloorEndBlockers(2, [{ name: 'Carl', floorEndDone: 3 }, { name: 'Donut', floorEndDone: 0 }])).toEqual(['Carl']);
  });
  it('seq 0 gives []', () => {
    expect(undoFloorEndBlockers(0, [{ name: 'Carl', floorEndDone: 0 }])).toEqual([]);
    expect(undoFloorEndBlockers(0)).toEqual([]);
    expect(undoFloorEndBlockers(-1, [{ name: 'Carl', floorEndDone: 0 }])).toEqual([]);
  });
});

describe('isRosterPc (the one rule for which roster entries count as Crawlers)', () => {
  it('a world pc Actor -> true', () => {
    expect(isRosterPc({ documentName: 'Actor', type: 'pc' })).toBe(true);
  });
  it('a mob, a compendium pc, an index entry (no documentName), an Item, null -> false', () => {
    expect(isRosterPc({ documentName: 'Actor', type: 'mob' })).toBe(false);
    expect(isRosterPc({ documentName: 'Actor', type: 'pc', pack: 'world.crawlers' })).toBe(false);
    expect(isRosterPc({ type: 'pc', name: 'Carl', _id: 'x' })).toBe(false);
    expect(isRosterPc({ documentName: 'Item', type: 'pc' })).toBe(false);
    expect(isRosterPc(null)).toBe(false);
  });
});
