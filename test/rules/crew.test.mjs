import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { crewSkillBonus, crewPenalty, speedDieNote, crewCacheFrom, crewSlotRole, crewCardName, crewSkillCard, crewAttackCard, vehicleWeaponCard, addCrewMember, removeCrewMember, assignCrewRole, crewDropRejection, crewRoleKey, crewRoleChoices, crewingOf, crewRenderTargets, owningActor, touchesCrew, crewEvent } from '../../module/rules/crew.mjs';

// Ported from character-sheet/source/javascript/_crewrolls.js.
// Oracle: character-sheet/__tests__/crewrolls.test.js (inputs reshaped, R20
// expectations kept).
// crewSkillRollFields / crewAttackRollFields / vehicleWeaponFields are ported
// as crewSkillCard / crewAttackCard / vehicleWeaponCard ({ fields, roll,
// damage }, no [[ ]]). Excluded: crewForSlot / driverOf (VehicleModel reads
// the crew actor directly: crewMember / resolveDriver, tested in
// test/data/vehicle-rolls.test.mjs), refreshCrewCards (crew rows read the
// live actor) and the roll workers.

// A real `t` over lang/en.json, so card text is checked against the R20
// oracle's English strings.
const LANG = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
const t = (key, data = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], LANG);
  if (typeof text !== 'string') throw new Error(`missing lang key ${key}`);
  return text.replace(/{(\w+)}/g, (_, k) => String(data[k]));
};

// R20's cache shape was { stat_mods, skills: [{name, stat, rank, bonus}], ... }.
// Reshaped per plan to { statModifiers: {<stat>: n}, skills: [{ name, stat, bonus }] }.
const carlCache = {
  statModifiers: { strength: 4, intelligence: 2, constitution: 3, dexterity: 5, charisma: 1 },
  skills: [
    { name: 'Driving', stat: 'dexterity', bonus: 8 },
    { name: 'Gunnery', stat: 'dexterity', bonus: 6 },
  ],
};

describe('crewSkillBonus (cached skill by name, untrained fallback)', () => {
  it('finds the named skill case-insensitively and returns its bonus', () => {
    expect(crewSkillBonus(carlCache, 'gunnery', 'strength')).toEqual({ bonus: 6, untrained: false });
  });
  it('untrained: the cached stat mod for the given stat with rank 0', () => {
    expect(crewSkillBonus(carlCache, 'Cannons', 'strength')).toEqual({ bonus: 4, untrained: true });
    expect(crewSkillBonus(null, 'Cannons', 'strength')).toEqual({ bonus: 0, untrained: true });
  });
  it('matches a skill name padded with whitespace', () => {
    expect(crewSkillBonus(carlCache, '  gunnery  ', 'strength')).toEqual({ bonus: 6, untrained: false });
  });
  it('a blank or null skillName never matches and falls back to the stat mod', () => {
    expect(crewSkillBonus(carlCache, '', 'strength')).toEqual({ bonus: 4, untrained: true });
    expect(crewSkillBonus(carlCache, null, 'strength')).toEqual({ bonus: 4, untrained: true });
  });
  it('a blank or NaN cached bonus resolves to 0 but stays trained', () => {
    const cache = { statModifiers: {}, skills: [{ name: 'Sneak', stat: 'dexterity', bonus: '' }] };
    expect(crewSkillBonus(cache, 'Sneak', 'dexterity')).toEqual({ bonus: 0, untrained: false });
    const cacheNaN = { statModifiers: {}, skills: [{ name: 'Sneak', stat: 'dexterity', bonus: 'oops' }] };
    expect(crewSkillBonus(cacheNaN, 'Sneak', 'dexterity')).toEqual({ bonus: 0, untrained: false });
  });
  it('a cache with statModifiers but no skills array falls back cleanly', () => {
    const cache = { statModifiers: { dexterity: 3 } };
    expect(crewSkillBonus(cache, 'Anything', 'dexterity')).toEqual({ bonus: 3, untrained: true });
  });
  it('a statKey missing from statModifiers falls back to 0', () => {
    expect(crewSkillBonus(carlCache, 'Cannons', 'nonexistent')).toEqual({ bonus: 0, untrained: true });
  });
});

describe('crewPenalty (the vehicle\'s aboard penalty, applied on the crew card)', () => {
  it('vehicle: -Speed on any skill except the drive skill', () => {
    expect(crewPenalty({ kind: 'vehicle', speed: 4, driveSkill: 'Driving' }, 'Gunnery')).toBe(-4);
    expect(crewPenalty({ kind: 'vehicle', speed: 4, driveSkill: 'Driving' }, 'driving')).toBe(0);
  });
  it('mount: flat -3 except the drive (Riding) skill', () => {
    expect(crewPenalty({ kind: 'mount', speed: 3, driveSkill: 'Riding' }, 'Perception')).toBe(-3);
    expect(crewPenalty({ kind: 'mount', speed: 3, driveSkill: 'Riding' }, 'Riding')).toBe(0);
  });
  it('an empty/absent skillName is never the drive skill', () => {
    expect(crewPenalty({ kind: 'vehicle', speed: 4, driveSkill: 'Driving' }, '')).toBe(-4);
  });
  it('a whitespace-only skillName is never the drive skill either', () => {
    expect(crewPenalty({ kind: 'vehicle', speed: 4, driveSkill: 'Driving' }, '   ')).toBe(-4);
  });
  it('Speed 0 returns 0, not -0', () => {
    const penalty = crewPenalty({ kind: 'vehicle', speed: 0, driveSkill: 'Driving' }, 'Gunnery');
    expect(penalty).toBe(0);
    expect(Object.is(penalty, -0)).toBe(false);
  });
  it('no driveSkill given defaults to "Driving"', () => {
    expect(crewPenalty({ kind: 'vehicle', speed: 4 }, 'Driving')).toBe(0);
    expect(crewPenalty({ kind: 'vehicle', speed: 4 }, 'driving')).toBe(0);
  });
  it('a mount ignores speed entirely (flat -3 regardless of its value)', () => {
    expect(crewPenalty({ kind: 'mount', speed: 99, driveSkill: 'Riding' }, 'Perception')).toBe(-3);
    expect(crewPenalty({ kind: 'mount', speed: 0, driveSkill: 'Riding' }, 'Perception')).toBe(-3);
  });
});

describe('speedDieNote (Speed damage die, chart unsourced)', () => {
  it('reports the current Speed and flags the chart as unsourced', () => {
    expect(speedDieNote(4)).toBe('+1 Speed die if melee (Speed 4; same as a Rank die — chart unsourced, add by hand)');
  });
  it('defaults a blank speed to 0', () => {
    expect(speedDieNote('')).toBe('+1 Speed die if melee (Speed 0; same as a Rank die — chart unsourced, add by hand)');
  });
});

// ── Crew linking (Task 21) ──
// Role rules mirror character-sheet/source/views/_vehicle.pug: one Driver
// (Rider on a mount) and one holder per Gunner slot. R20 roles are flat typed
// names, so a slot can only ever name one crew member; here each crew entry
// carries one role, and assigning a held role demotes its previous holder.

const A = 'Actor.aaa';
const B = 'Actor.bbb';
const C = 'Actor.ccc';

describe('addCrewMember', () => {
  it('appends a new member as a passenger (copy, input untouched)', () => {
    const crew = [{ uuid: A, role: 'driver' }];
    const out = addCrewMember(crew, B);
    expect(out).toEqual([{ uuid: A, role: 'driver' }, { uuid: B, role: 'passenger' }]);
    expect(crew).toHaveLength(1);
  });
  it('a UUID already aboard -> null (no duplicate)', () => {
    expect(addCrewMember([{ uuid: A, role: 'passenger' }], A)).toBeNull();
  });
  it('a blank UUID -> null', () => {
    expect(addCrewMember([], '')).toBeNull();
  });
  it('no crew yet', () => {
    expect(addCrewMember(undefined, A)).toEqual([{ uuid: A, role: 'passenger' }]);
  });
});

describe('removeCrewMember', () => {
  it('drops the member by UUID, keeping order', () => {
    const crew = [{ uuid: A, role: 'driver' }, { uuid: B, role: 'passenger' }, { uuid: C, role: 'gunner1' }];
    expect(removeCrewMember(crew, B)).toEqual([{ uuid: A, role: 'driver' }, { uuid: C, role: 'gunner1' }]);
  });
  it('an unknown UUID leaves the crew as is', () => {
    expect(removeCrewMember([{ uuid: A, role: 'driver' }], B)).toEqual([{ uuid: A, role: 'driver' }]);
  });
});

describe('assignCrewRole (exclusive Driver / Gunner N)', () => {
  const crew = [{ uuid: A, role: 'driver' }, { uuid: B, role: 'gunner1' }, { uuid: C, role: 'passenger' }];
  it('a new driver demotes the old one to passenger', () => {
    expect(assignCrewRole(crew, C, 'driver')).toEqual([
      { uuid: A, role: 'passenger' }, { uuid: B, role: 'gunner1' }, { uuid: C, role: 'driver' },
    ]);
  });
  it('a gunner slot is exclusive per slot', () => {
    expect(assignCrewRole(crew, C, 'gunner1')).toEqual([
      { uuid: A, role: 'driver' }, { uuid: B, role: 'passenger' }, { uuid: C, role: 'gunner1' },
    ]);
  });
  it('different gunner slots coexist', () => {
    expect(assignCrewRole(crew, C, 'gunner2')).toEqual([
      { uuid: A, role: 'driver' }, { uuid: B, role: 'gunner1' }, { uuid: C, role: 'gunner2' },
    ]);
  });
  it('moving the driver to a gunner slot frees the driver seat', () => {
    expect(assignCrewRole(crew, A, 'gunner3')).toEqual([
      { uuid: A, role: 'gunner3' }, { uuid: B, role: 'gunner1' }, { uuid: C, role: 'passenger' },
    ]);
  });
  it('passenger is never exclusive', () => {
    const out = assignCrewRole(crew, A, 'passenger');
    expect(out.filter(c => c.role === 'passenger')).toHaveLength(2);
    expect(out[1]).toEqual({ uuid: B, role: 'gunner1' });
  });
  it('an unknown role or an absent member -> null', () => {
    expect(assignCrewRole(crew, A, 'captain')).toBeNull();
    expect(assignCrewRole(crew, 'Actor.zzz', 'driver')).toBeNull();
  });
  it('does not mutate the input', () => {
    assignCrewRole(crew, C, 'driver');
    expect(crew[0]).toEqual({ uuid: A, role: 'driver' });
  });
});

describe('crewDropRejection (who may crew a vehicle)', () => {
  const pc = { type: 'pc', isToken: false, inWorld: true };
  it('a world PC or Mob is accepted', () => {
    expect(crewDropRejection(pc)).toBeNull();
    expect(crewDropRejection({ ...pc, type: 'mob' })).toBeNull();
  });
  it('a vehicle (including the vehicle itself) is rejected', () => {
    expect(crewDropRejection({ ...pc, type: 'vehicle' })).toBe('vehicle');
  });
  it('an unlinked token actor or a compendium / non-world actor is rejected', () => {
    expect(crewDropRejection({ ...pc, isToken: true })).toBe('notWorld');
    expect(crewDropRejection({ ...pc, inWorld: false })).toBe('notWorld');
  });
  it('an unknown actor type is rejected', () => {
    expect(crewDropRejection({ ...pc, type: 'base' })).toBe('type');
    expect(crewDropRejection(undefined)).toBe('type');
  });
});

describe('crewRoleKey / crewRoleChoices (labels; Rider on a mount)', () => {
  it('label keys', () => {
    expect(crewRoleKey('driver', 'vehicle')).toBe('DCC.Crew.Role.driver');
    expect(crewRoleKey('driver', 'mount')).toBe('DCC.Crew.Role.rider');
    expect(crewRoleKey('gunner2', 'vehicle')).toBe('DCC.Crew.Role.gunner2');
    expect(crewRoleKey('passenger', 'mount')).toBe('DCC.Crew.Role.passenger');
  });
  it('a vehicle offers every role, in order', () => {
    expect(crewRoleChoices('vehicle', 'passenger')).toEqual(['driver', 'gunner1', 'gunner2', 'gunner3', 'gunner4', 'passenger']);
  });
  it('a mount offers Rider and Passenger (R20 hides the gunner roles on a mount)', () => {
    expect(crewRoleChoices('mount', 'passenger')).toEqual(['driver', 'passenger']);
  });
  it('a mount keeps a held gunner role selectable (kind switched after assignment)', () => {
    expect(crewRoleChoices('mount', 'gunner3')).toEqual(['driver', 'gunner3', 'passenger']);
  });
});

describe('crewingOf (the vehicles an actor crews)', () => {
  const vehicles = [
    { uuid: 'Actor.v2', name: 'Zamboni', kind: 'vehicle', crew: [{ uuid: A, role: 'gunner1' }] },
    { uuid: 'Actor.v1', name: 'Mongo', kind: 'mount', crew: [{ uuid: B, role: 'passenger' }, { uuid: A, role: 'driver' }] },
    { uuid: 'Actor.v3', name: 'Empty', kind: 'vehicle', crew: [] },
  ];
  it('lists each vehicle whose crew holds the UUID, by name, with the role label key', () => {
    expect(crewingOf(vehicles, A)).toEqual([
      { uuid: 'Actor.v1', name: 'Mongo', role: 'driver', roleKey: 'DCC.Crew.Role.rider' },
      { uuid: 'Actor.v2', name: 'Zamboni', role: 'gunner1', roleKey: 'DCC.Crew.Role.gunner1' },
    ]);
  });
  it('an actor on no crew -> []', () => {
    expect(crewingOf(vehicles, C)).toEqual([]);
    expect(crewingOf(undefined, C)).toEqual([]);
  });
});

describe('crewRenderTargets (which open sheets re-render)', () => {
  const sheets = [
    { id: 'veh1', type: 'vehicle', uuid: 'Actor.v1', crew: [A, B] },
    { id: 'veh2', type: 'vehicle', uuid: 'Actor.v2', crew: [C] },
    { id: 'pcA', type: 'pc', uuid: A, crewing: ['Actor.v1'] },
    { id: 'pcC', type: 'pc', uuid: C, crewing: ['Actor.v2'] },
    { id: 'mobB', type: 'mob', uuid: B, crewing: [] },
  ];
  it('a crew member changed -> the open vehicle sheets it crews', () => {
    expect(crewRenderTargets({ uuid: A, type: 'pc' }, sheets)).toEqual(['veh1']);
    expect(crewRenderTargets({ uuid: C, type: 'pc' }, sheets)).toEqual(['veh2']);
  });
  it('an actor on no crew -> nothing', () => {
    expect(crewRenderTargets({ uuid: 'Actor.zzz', type: 'mob' }, sheets)).toEqual([]);
  });
  it('a vehicle crew change -> creature sheets now aboard or last shown aboard (removals)', () => {
    // v1 now crews B only: A was removed (its sheet still shows v1), B is aboard.
    expect(crewRenderTargets({ uuid: 'Actor.v1', type: 'vehicle', crewChanged: true, crew: [B] }, sheets)).toEqual(['pcA', 'mobB']);
  });
  it('a vehicle update that does not touch the crew -> nothing', () => {
    expect(crewRenderTargets({ uuid: 'Actor.v1', type: 'vehicle', crewChanged: false, crew: [A, B] }, sheets)).toEqual([]);
  });
  it('a deleted vehicle (crew []) -> the creature sheets that showed it', () => {
    expect(crewRenderTargets({ uuid: 'Actor.v2', type: 'vehicle', crewChanged: true, crew: [] }, sheets)).toEqual(['pcC']);
  });
  it('tolerates sheets without crew / crewing lists', () => {
    expect(crewRenderTargets({ uuid: A, type: 'pc' }, [{ id: 'x', type: 'vehicle', uuid: 'Actor.v9' }, { id: 'y', type: 'pc', uuid: A }])).toEqual([]);
  });
});

describe('owningActor (the actor an Item / ActiveEffect belongs to)', () => {
  const actor = { documentName: 'Actor', uuid: A };
  it('an owned item or actor effect -> its actor', () => {
    expect(owningActor({ documentName: 'Item', parent: actor })).toBe(actor);
    expect(owningActor({ documentName: 'ActiveEffect', parent: actor })).toBe(actor);
  });
  it('an effect on an owned item -> the item\'s actor', () => {
    expect(owningActor({ documentName: 'ActiveEffect', parent: { documentName: 'Item', parent: actor } })).toBe(actor);
  });
  it('a world item / effect on a world item -> null', () => {
    expect(owningActor({ documentName: 'Item', parent: null })).toBeNull();
    expect(owningActor({ documentName: 'ActiveEffect', parent: { documentName: 'Item', parent: null } })).toBeNull();
    expect(owningActor(undefined)).toBeNull();
  });
});

describe('touchesCrew (a vehicle update the crew views care about)', () => {
  it('crew, kind, name or ownership changes', () => {
    expect(touchesCrew({ system: { crew: [] } })).toBe(true);
    expect(touchesCrew({ system: { kind: 'mount' } })).toBe(true);
    expect(touchesCrew({ name: 'Zamboni' })).toBe(true);
    expect(touchesCrew({ ownership: { default: 2 } })).toBe(true);
  });
  it('anything else does not', () => {
    expect(touchesCrew({ system: { speed: 3 } })).toBe(false);
    expect(touchesCrew({ img: 'x.png' })).toBe(false);
    expect(touchesCrew({})).toBe(false);
    expect(touchesCrew(undefined)).toBe(false);
  });
});

describe('crewEvent (the crewRenderTargets event for an actor)', () => {
  const vehicle = { uuid: 'Actor.v1', type: 'vehicle', system: { _source: { crew: [{ uuid: A, role: 'driver' }, { uuid: B, role: 'passenger' }] } } };
  it('a PC / Mob -> uuid and type only', () => {
    expect(crewEvent({ uuid: A, type: 'pc', system: {} }, { crewChanged: true })).toEqual({ uuid: A, type: 'pc' });
  });
  it('a vehicle -> crewChanged and its stored crew UUIDs', () => {
    expect(crewEvent(vehicle, { crewChanged: true })).toEqual({ uuid: 'Actor.v1', type: 'vehicle', crewChanged: true, crew: [A, B] });
    expect(crewEvent(vehicle)).toEqual({ uuid: 'Actor.v1', type: 'vehicle', crewChanged: false, crew: [A, B] });
  });
  it('a deleted vehicle -> an empty crew', () => {
    expect(crewEvent(vehicle, { crewChanged: true, deleted: true })).toEqual({ uuid: 'Actor.v1', type: 'vehicle', crewChanged: true, crew: [] });
  });
  it('no actor -> null', () => {
    expect(crewEvent(null)).toBeNull();
  });
});

// ── Crew rolls (Task 22) ──

describe('crewCacheFrom (roll-time cache from a live crew actor)', () => {
  const items = [
    { id: 's1', type: 'skill', name: 'Driving', system: { stat: 'dexterity', checkType: 'unopposed', derived: { skillBonus: 8 } } },
    { id: 'p1', type: 'spell', name: 'Magic Missile', system: { stat: 'intelligence', checkType: 'opposed', opposedStat: 'dexterity', attack: { enabled: true, die: '1d10', damageType: 'force' }, derived: { skillBonus: 4, toHit: 5, damageBase: 2 } } },
    { id: 'w1', type: 'weapon', name: 'Spear', system: { stat: 'strength', die: '1d8', damageType: 'piercing', derived: { toHit: 9, damageBase: 4 } } },
    { id: 'g1', type: 'gear', name: 'Rope', system: {} },
    { id: 'p2', type: 'spell', name: 'Heal', system: { stat: 'charisma', checkType: 'passive', description: '<p>Restore health.</p>', attack: { enabled: false }, derived: { skillBonus: 1 } } },
  ];
  it('skills are skills then spells (R20 spells are skill rows), by id, with the derived bonus', () => {
    const c = crewCacheFrom({ statModifiers: { dexterity: 5 }, items });
    expect(c.statModifiers).toEqual({ dexterity: 5 });
    expect(c.skills).toEqual([
      { id: 's1', name: 'Driving', stat: 'dexterity', bonus: 8, checkType: 'unopposed', opposedStat: '', description: '' },
      { id: 'p1', name: 'Magic Missile', stat: 'intelligence', bonus: 4, checkType: 'opposed', opposedStat: 'dexterity', description: '' },
      { id: 'p2', name: 'Heal', stat: 'charisma', bonus: 1, checkType: 'passive', opposedStat: '', description: '<p>Restore health.</p>' },
    ]);
  });
  it('attacks are weapons then attack spells; a spell reads die / type from system.attack', () => {
    expect(crewCacheFrom({ items }).attacks).toEqual([
      { id: 'w1', name: 'Spear', toHit: 9, die: '1d8', damageBase: 4, damageType: 'piercing' },
      { id: 'p1', name: 'Magic Missile', toHit: 5, die: '1d10', damageBase: 2, damageType: 'force' },
    ]);
  });
  it('tolerates no input', () => {
    expect(crewCacheFrom()).toEqual({ statModifiers: {}, skills: [], attacks: [] });
  });
  it('feeds crewSkillBonus: the drive skill by name, untrained falls back to Dex', () => {
    const c = crewCacheFrom({ statModifiers: { dexterity: 5 }, items });
    expect(crewSkillBonus(c, 'driving', 'dexterity')).toEqual({ bonus: 8, untrained: false });
    expect(crewSkillBonus(c, 'Riding', 'dexterity')).toEqual({ bonus: 5, untrained: true });
  });
});

describe('crewCardName (a crew name on a card everyone who sees it reads the same)', () => {
  it('the real name when the card is whispered and the roller (its author, who sees it) can see the crew', () => {
    expect(crewCardName({ name: 'Goblin', whispered: true, rollerCanSee: true, allPlayersCanSee: false }, t)).toBe('Goblin');
  });
  it('whispered, but the roller cannot see the crew actor: the generic label', () => {
    expect(crewCardName({ name: 'Goblin', whispered: true, rollerCanSee: false, allPlayersCanSee: false }, t)).toBe('(unknown crew member)');
  });
  it('the real name when every player can see the crew actor', () => {
    expect(crewCardName({ name: 'Carl', whispered: false, allPlayersCanSee: true }, t)).toBe('Carl');
  });
  it('otherwise the generic label', () => {
    expect(crewCardName({ name: 'Goblin', whispered: false, allPlayersCanSee: false }, t)).toBe('(unknown crew member)');
    expect(crewCardName({ name: 'Goblin' }, t)).toBe('(unknown crew member)');
  });
});

describe('crewSlotRole (weapon gunner slot -> crew role)', () => {
  it('driver -> driver, 1..4 -> gunnerN, blank / unknown -> null', () => {
    expect(crewSlotRole('driver')).toBe('driver');
    expect(crewSlotRole('1')).toBe('gunner1');
    expect(crewSlotRole('4')).toBe('gunner4');
    expect(crewSlotRole('')).toBeNull();
    expect(crewSlotRole('5')).toBeNull();
    expect(crewSlotRole(undefined)).toBeNull();
  });
});

describe('crewSkillCard (R20 crewSkillRollFields)', () => {
  it('PC crew: d20 + bonus - penalty, penalty line names the vehicle', () => {
    const r = crewSkillCard({ crewName: 'Carl', skill: { name: 'Gunnery', bonus: 6 }, mob: false, vehicleName: 'Warthog', penalty: -4, floor: 2 }, t);
    expect(r.fields.name).toBe('Carl — Gunnery');
    expect(r.fields.note).toBe('aboard Warthog');
    expect(r.roll).toBe('1d20 + 6 - 4');
    expect(r.fields.penalty).toBe('aboard Warthog: -4');
    expect(r.fields.target).toBeUndefined();
  });
  it('Passive crew skill posts its description without a roll or Mob target', () => {
    const r = crewSkillCard({
      crewName: 'Carl',
      skill: { name: 'Aura', bonus: 3, checkType: 'passive', description: 'Always active.' },
      mob: true,
      vehicleName: 'Warthog',
      penalty: -4,
      floor: 2,
    }, t);
    expect(r.roll).toBeUndefined();
    expect(r.fields.target).toBeUndefined();
    expect(r.fields.tag).toBe('Passive');
    expect(r.fields.note).toBe('aboard Warthog · Always active.');
  });
  it('exempt skill: plain roll, no penalty line', () => {
    const r = crewSkillCard({ crewName: 'Carl', skill: { name: 'Driving', bonus: 8 }, mob: false, vehicleName: 'Warthog', penalty: 0 }, t);
    expect(r.roll).toBe('1d20 + 8');
    expect(r.fields.penalty).toBeUndefined();
  });
  it('a zero bonus with a penalty reads 1d20 - 4', () => {
    expect(crewSkillCard({ crewName: 'Carl', skill: { name: 'X', bonus: 0 }, vehicleName: 'W', penalty: -4 }, t).roll).toBe('1d20 - 4');
  });
  it('mob crew: static target 10 + bonus + penalty + Floor', () => {
    const r = crewSkillCard({ crewName: 'Goblin', skill: { name: 'Perception', bonus: 3 }, mob: true, vehicleName: 'Warthog', penalty: -4, floor: 2 }, t);
    expect(r.roll).toBeUndefined();
    expect(r.fields.target).toBe(11);
  });
  it('no vehicle name reads "aboard vehicle"', () => {
    expect(crewSkillCard({ crewName: 'Carl', skill: { name: 'X', bonus: 1 } }, t).fields.note).toBe('aboard vehicle');
  });
});

describe('crewAttackCard (R20 crewAttackRollFields)', () => {
  const spear = { name: 'Spear', toHit: 9, die: '1d8', damageBase: 4, damageType: 'piercing' };
  it('to-hit: d20 + toHit - penalty; damage die + damageBase with the type and the Speed-die note', () => {
    const r = crewAttackCard({ crewName: 'Carl', attack: spear, mob: false, vehicleName: 'Warthog', penalty: -4, driver: false, speed: 4 }, t);
    expect(r.roll).toBe('1d20 + 9 - 4');
    expect(r.damage).toBe('1d8 + 4');
    expect(r.fields).toMatchObject({ name: 'Carl — Spear', type: 'piercing', penalty: 'aboard Warthog: -4' });
    expect(r.fields.advantage).toBeUndefined();
    expect(r.fields.note).toBe(`aboard Warthog · ${speedDieNote(4)}`);
  });
  it('the Driver / Rider attacks at Disadvantage', () => {
    const r = crewAttackCard({ crewName: 'Carl', attack: spear, mob: false, vehicleName: 'Warthog', penalty: -4, driver: true }, t);
    expect(r.roll).toBe('2d20kl1 + 9 - 4');
    expect(r.fields.advantage).toBe('Disadvantage');
    expect(r.fields.penalty).toBe('aboard Warthog: -4, driver: disadvantage');
  });
  it('mob crew to-hit is a static target 10 + toHit + penalty + Floor; damage still rolls', () => {
    const r = crewAttackCard({ crewName: 'Goblin', attack: spear, mob: true, penalty: -4, floor: 2, driver: true }, t);
    expect(r.fields.target).toBe(17);
    expect(r.roll).toBeUndefined();
    expect(r.fields.advantage).toBeUndefined();
    expect(r.damage).toBe('1d8 + 4');
  });
  it('no penalty and not driving: no penalty line', () => {
    expect(crewAttackCard({ crewName: 'Carl', attack: spear, penalty: 0 }, t).fields.penalty).toBeUndefined();
  });
});

describe('vehicleWeaponCard (R20 vehicleWeaponFields, to-hit)', () => {
  const carl = crewCacheFrom({
    statModifiers: { strength: 4, dexterity: 5 },
    items: [{ id: 's', type: 'skill', name: 'Gunnery', system: { stat: 'dexterity', derived: { skillBonus: 6 } } }],
  });
  const cannon = { name: 'Cannon', toHit: 1, skillName: 'Gunnery', stat: 'dexterity' };
  it('PC gunner: d20 + gunner bonus + weapon to-hit, note names the gunner', () => {
    const r = vehicleWeaponCard({ weapon: cannon, gunner: { name: 'Carl', cache: carl }, floor: 2 }, t);
    expect(r.roll).toBe('1d20 + 7');
    expect(r.fields).toMatchObject({ name: 'Cannon', tag: 'To Hit', note: 'Gunner: Carl (Gunnery)' });
  });
  it('untrained gunner falls back to the stat mod and flags it', () => {
    const r = vehicleWeaponCard({ weapon: { ...cannon, skillName: 'Cannons' }, gunner: { name: 'Carl', cache: carl }, floor: 2 }, t);
    expect(r.roll).toBe('1d20 + 6');
    expect(r.fields.note).toBe('Gunner: Carl (untrained Cannons — stat mod only)');
  });
  it('mob gunner posts a static target 10 + bonus + Floor', () => {
    const goblin = { ...carl, skills: [] };
    const r = vehicleWeaponCard({ weapon: cannon, gunner: { name: 'Goblin', cache: goblin, mob: true }, floor: 2 }, t);
    expect(r.roll).toBeUndefined();
    expect(r.fields.target).toBe(18);
  });
  it('no gunner: rolls the weapon to-hit alone and says so', () => {
    const r = vehicleWeaponCard({ weapon: cannon, gunner: null, floor: 2 }, t);
    expect(r.roll).toBe('1d20 + 1');
    expect(r.fields.note).toBe('No gunner');
  });
  it('a blank skill name reads "skill" in the note', () => {
    const r = vehicleWeaponCard({ weapon: { ...cannon, skillName: '' }, gunner: { name: 'Carl', cache: carl } }, t);
    expect(r.fields.note).toBe('Gunner: Carl (untrained skill — stat mod only)');
    expect(r.roll).toBe('1d20 + 6');
  });
});
