import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Glue test for DCCActor's vehicle actions and crew rolls: the vehicle's inputs and the
// resolveDriver seam reach the rules/vehicle.mjs builders, the card goes to
// postCard, and Apply aftermath / DR absorbed write the right slots. The
// card text is the builders' (tested in test/rules/vehicle.test.mjs); the
// mock i18n.format returns the key. The real card is a live gate.
vi.mock('../../module/rolls/card.mjs', () => ({
  postCard: vi.fn(async (actor, fields, formulas) => ({ fields, formulas })),
}));
const { postCard } = await import('../../module/rolls/card.mjs');
const { default: DCCActor } = await import('../../module/documents/actor.mjs');
const { VehicleModel } = await import('../../module/data/actor/_module.mjs');

const vehicleSource = (over = {}) => ({
  kind: 'vehicle', size: 4, speed: 0, speedMax: 4, constitutionModifier: null, armor: 0, floor: 1, healthBar: 4,
  healthPoints: { value: 0, max: 0 }, drivingMode: 'accelerate', drivingTarget: 1, rollAdvantage: '',
  ramTargetEvade: 10, ramTargetLarger: false, ramDamageDealt: 0, raceAhead: 0, driveSkill: 'Driving', ...over,
});

const vehicle = (over = {}, type = 'vehicle') => {
  const system = new VehicleModel(vehicleSource(over));
  system.parent = { items: [] };
  system.prepareBaseData();
  system.prepareDerivedData();
  const actor = new DCCActor({ type, name: 'Truck', system });
  actor.update = vi.fn(async () => actor);
  return actor;
};

// The crew-name rule reads the chosen message mode, the rolling user and every
// user (cardCrewName); a GM rolls in public mode with two players by default.
const GM = { isGM: true };
const PLAYERS = [{ isGM: false }, { isGM: false }];
const savedGame = { users: game.users, user: game.user, settings: game.settings };
beforeEach(() => {
  postCard.mockClear();
  game.users = [GM, ...PLAYERS];
  game.user = GM;
  game.settings = { get: () => 'public' };
});
afterEach(() => Object.assign(game, savedGame));

describe('resolveDriver seam', () => {
  it('no crew yet: nobody aboard, bonus 0', () => {
    expect(vehicle().system.resolveDriver()).toEqual({ bonus: 0, driver: null });
  });
});

describe('vehicle roll cards', () => {
  it('Driving check in stop mode at Speed 3 -> DC 13, 1d20, no-driver note', async () => {
    const a = vehicle({ drivingMode: 'stop', speed: 3 });
    await a.rollDriving();
    const [actor, fields, formulas] = postCard.mock.calls[0];
    expect(actor).toBe(a);
    expect(fields.dc).toBe(13);
    expect(fields.note).toBe('DCC.Vehicle.Card.NoDriver');
    expect(formulas).toEqual({ roll: '1d20', damage: undefined });
  });
  it('the resolveDriver seam feeds the roll bonus and the note', async () => {
    const a = vehicle({ drivingMode: 'stop', rollAdvantage: 'adv' });
    const actor = { name: 'Carl', type: 'pc', testUserPermission: () => true };
    a.system.resolveDriver = () => ({ bonus: 4, driver: { name: 'Carl', untrained: false, mob: false }, actor });
    await a.rollDriving();
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(formulas.roll).toBe('2d20kh1 + 4');
    expect(fields.note).toBe('DCC.Vehicle.Card.Driver');
  });
  it('Ram: Disadvantage vs the target Evade, <size>d6 + Speed damage', async () => {
    const a = vehicle({ size: 6, speed: 2, ramTargetEvade: 14 });
    await a.rollRam();
    const [, fields, formulas] = postCard.mock.calls[0];
    expect(fields.dc).toBe(14);
    expect(formulas).toEqual({ roll: '2d20kl1', damage: '6d6 + 2' });
  });
  it('Race: Speed + racers ahead', async () => {
    await vehicle({ speed: 3, raceAhead: 2 }).rollRace();
    expect(postCard.mock.calls[0][2].roll).toBe('1d20 + 5');
  });
  it('options (e.g. speaker) pass through to postCard', async () => {
    const speaker = { alias: 'Carl' };
    await vehicle().rollRace({ speaker });
    expect(postCard.mock.calls[0][3]).toEqual({ speaker });
  });
  it('in-flight guard: a second Drive / Ram / Race while one is posting is dropped', async () => {
    const a = vehicle();
    let release;
    postCard.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = a.rollDriving();
    expect(await a.rollRam()).toBeNull();
    expect(await a.rollRace()).toBeNull();
    release({});
    await first;
    expect(postCard).toHaveBeenCalledTimes(1);
    await a.rollRace(); // released: rolls again
    expect(postCard).toHaveBeenCalledTimes(2);
  });
  it('the guard is released when the card fails', async () => {
    const a = vehicle();
    postCard.mockImplementationOnce(async () => { throw new Error('boom'); });
    await expect(a.rollDriving()).rejects.toThrow('boom');
    await a.rollDriving();
    expect(postCard).toHaveBeenCalledTimes(2);
  });
  it('a non-vehicle actor posts nothing', async () => {
    const a = vehicle({}, 'pc');
    expect(await a.rollDriving()).toBeNull();
    expect(await a.rollRam()).toBeNull();
    expect(await a.rollRace()).toBeNull();
    expect(postCard).not.toHaveBeenCalled();
  });
});

describe('applyRamAftermath (R20 applyRam)', () => {
  it('acceptance: larger target, 8 dealt, Con Mod 5 -> down 1 slot, Speed 0', async () => {
    const a = vehicle({ healthBar: 4, speed: 3, ramDamageDealt: 8, ramTargetLarger: true });
    await a.applyRamAftermath();
    expect(a.update).toHaveBeenCalledTimes(1);
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 3, 'system.speed': 0 });
  });
  it('same size or smaller: half damage (no DR), Speed halved (R20 oracle)', async () => {
    const a = vehicle({ healthBar: 4, speed: 5, ramDamageDealt: 24, armor: 3 });
    await a.applyRamAftermath(); // 12 self-damage / Con Mod 5 -> 2 slots; DR ignored
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 2, 'system.speed': 2 });
  });
  it('larger target, 24 dealt -> healthBar 0, Speed 0 (R20 oracle)', async () => {
    const a = vehicle({ healthBar: 4, speed: 5, ramDamageDealt: 24, ramTargetLarger: true });
    await a.applyRamAftermath();
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 0, 'system.speed': 0 });
  });
  it('a sub-slot hit leaves healthBar out of the update but still writes Speed', async () => {
    const a = vehicle({ healthBar: 4, speed: 4, ramDamageDealt: 3, constitutionModifier: 3 });
    await a.applyRamAftermath(); // 1 self-damage < Con Mod 3
    expect(a.update).toHaveBeenCalledWith({ 'system.speed': 2 });
  });
  it('double-click guard: two concurrent applies issue one update', async () => {
    const a = vehicle({ healthBar: 4, speed: 3, ramDamageDealt: 8, ramTargetLarger: true });
    const [first, second] = await Promise.all([a.applyRamAftermath(), a.applyRamAftermath()]);
    expect(a.update).toHaveBeenCalledTimes(1);
    expect(first).toBe(a);
    expect(second).toBeNull();
    await a.applyRamAftermath(); // released after the first finished
    expect(a.update).toHaveBeenCalledTimes(2);
  });
  it('non-vehicle: no update', async () => {
    const a = vehicle({ ramDamageDealt: 8 }, 'mob');
    expect(await a.applyRamAftermath()).toBeNull();
    expect(a.update).not.toHaveBeenCalled();
  });
});

describe('damageResistanceAbsorbed (R20 drAbsorbed)', () => {
  it('drops one slot', async () => {
    const a = vehicle({ healthBar: 3 });
    await a.damageResistanceAbsorbed();
    expect(a.update).toHaveBeenCalledWith({ 'system.healthBar': 2 });
  });
  it('never below 0 (no update at 0)', async () => {
    const a = vehicle({ healthBar: 0 });
    await a.damageResistanceAbsorbed();
    expect(a.update).not.toHaveBeenCalled();
  });
});

// ── Crew rolls (Task 22) ──
// Crew actors are plain stand-ins found through a stubbed fromUuidSync. The
// builder text is tested in test/rules/crew.test.mjs; here the vehicle's
// inputs, the crew cache and the right poster / privacy actor reach postCard.

const STAT_MODIFIERS = { strength: 0, intelligence: 0, constitution: 0, dexterity: 1, charisma: 0 };
// Permission levels as core names them; `players` is every other non-GM
// user's level on the actor, `roller` the rolling user's (game.user).
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const crewActor = ({ uuid = 'Actor.carl', type = 'pc', name = 'Carl', modifiers = STAT_MODIFIERS, items = [], players = 3, roller = 3, mobWhisper } = {}) => ({
  uuid, type, name, items,
  testUserPermission: vi.fn((user, level) => (user.isGM ? 3 : (user === game.user ? roller : players)) >= LEVELS[level]),
  system: { mobWhisper, stats: Object.fromEntries(Object.entries(modifiers).map(([k, modifier]) => [k, { modifier }])) },
});
const skillItem = (id, name, bonus, stat = 'dexterity') => ({ id, type: 'skill', name, system: { stat, derived: { skillBonus: bonus } } });
const weaponItem = (id, name, toHit, die = '1d8', damageBase = 2) => ({
  id, type: 'attack', name, system: { stat: 'strength', die, damageType: 'piercing', derived: { toHit, damageBase, damageDice: die } },
});

describe('crew resolution (VehicleModel)', () => {
  const saved = { fromUuidSync: foundry.utils.fromUuidSync, format: game.i18n.format };
  let world;
  beforeEach(() => {
    world = {};
    foundry.utils.fromUuidSync = vi.fn(uuid => world[uuid] ?? null);
  });
  afterEach(() => {
    foundry.utils.fromUuidSync = saved.fromUuidSync;
    game.i18n.format = saved.format;
  });

  describe('crew names on vehicle cards (crewCardName)', () => {
    // Show the name the builder received: the mock format otherwise returns the bare key.
    const withNames = () => { game.i18n.format = (key, data) => (data?.name ? `${key}|${data.name}` : key); };
    it('a crew member every player can see: the real name', async () => {
      withNames();
      world['Actor.carl'] = crewActor({ items: [skillItem('s1', 'Driving', 3)] });
      const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.carl', role: 'driver' }] });
      await a.rollDriving();
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.Driver|Carl');
      expect(world['Actor.carl'].testUserPermission).toHaveBeenCalledTimes(2); // each non-GM user
    });
    it('hidden from a player on a public card: the generic label', async () => {
      withNames();
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', players: 0 });
      const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
      await a.rollDriving();
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.DriverUntrained|DCC.Crew.Unknown');
    });
    it('hidden, but the Mob card whispers to the GM: the real name', async () => {
      withNames();
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', players: 0, mobWhisper: true });
      const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
      await a.rollDriving();
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.DriverUntrained|Goblin');
    });
    it('whispered, but the rolling player cannot see the mob (the whisper author sees it): the generic label', async () => {
      withNames();
      game.user = PLAYERS[0];
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', players: 0, roller: 0, mobWhisper: true });
      const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
      await a.rollDriving();
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.DriverUntrained|DCC.Crew.Unknown');
      expect(postCard.mock.calls[0][3].privacyOf).toBe(world['Actor.gob']); // still whispered
    });
    it('whispered, and the rolling player can see the mob: the real name', async () => {
      withNames();
      game.user = PLAYERS[0];
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', players: 0, roller: 1, mobWhisper: true });
      const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
      await a.rollDriving();
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.DriverUntrained|Goblin');
    });
    it('a hidden Mob with whispering disabled is masked even for a GM roller', async () => {
      withNames();
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', players: 0, mobWhisper: false });
      await vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] }).rollDriving();
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.DriverUntrained|DCC.Crew.Unknown');
    });
    it('uses the actual privacy override when masking the crew name', async () => {
      withNames();
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', players: 0, mobWhisper: true });
      const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
      const privacyOf = crewActor({ type: 'pc' });
      await a.rollDriving({ privacyOf });
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Vehicle.Card.DriverUntrained|DCC.Crew.Unknown');
      expect(postCard.mock.calls[0][3].privacyOf).toBe(privacyOf);
    });
    it('a hidden PC gunner on a weapon card: the generic label', async () => {
      withNames();
      world['Actor.carl'] = crewActor({ players: 0 });
      const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'gunner1' }] });
      await a.rollAttack({ parent: a, type: 'attack', name: 'Turret', system: { gunnerSlot: '1', skillName: 'Guns', stat: 'dexterity', derived: { toHit: 1 } } });
      expect(postCard.mock.calls[0][1].note).toBe('DCC.Crew.Card.GunnerUntrained|DCC.Crew.Unknown');
    });
    it('crew skill cards (posted as the crew actor) keep the real name', async () => {
      game.i18n.format = (key, data) => (data?.crew ? `${key}|${data.crew}` : key);
      const carl = crewActor({ players: 0, items: [skillItem('s1', 'Knives', 4)] });
      const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'passenger' }] });
      await a.rollCrewSkill(carl, 's1');
      expect(postCard.mock.calls[0][1].name).toBe('DCC.Crew.Card.SkillName|Carl');
    });
  });

  it.each(['rollDriving', 'rollRam', 'rollRace'])('%s uses the Mob driver as privacy actor', async (action) => {
    world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', mobWhisper: true });
    const a = vehicle({ crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
    await a[action]();
    expect(postCard.mock.calls[0][3].privacyOf).toBe(world['Actor.gob']);
  });

  it('resolveDriver: the driver drive-skill bonus by name', () => {
    world['Actor.carl'] = crewActor({ items: [skillItem('s1', 'Driving', 3)] });
    const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'driver' }] });
    const r = a.system.resolveDriver();
    expect(r.bonus).toBe(3);
    expect(r.driver).toEqual({ name: 'Carl', untrained: false, mob: false });
    expect(r.actor).toBe(world['Actor.carl']);
  });
  it('resolveDriver: untrained falls back to the Dex mod (R20 driverOf)', () => {
    world['Actor.carl'] = crewActor({ modifiers: { ...STAT_MODIFIERS, dexterity: 4 } });
    const a = vehicle({ driveSkill: 'Riding', crew: [{ uuid: 'Actor.carl', role: 'driver' }] });
    expect(a.system.resolveDriver()).toMatchObject({ bonus: 4, driver: { untrained: true } });
  });
  it('resolveDriver: a mob driver is flagged', () => {
    world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin' });
    const a = vehicle({ crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
    expect(a.system.resolveDriver().driver.mob).toBe(true);
  });
  it('resolveDriver: a deleted driver, or none, counts as no driver', () => {
    expect(vehicle({ crew: [{ uuid: 'Actor.gone', role: 'driver' }] }).system.resolveDriver()).toEqual({ bonus: 0, driver: null });
    world['Actor.carl'] = crewActor();
    expect(vehicle({ crew: [{ uuid: 'Actor.carl', role: 'gunner1' }] }).system.resolveDriver()).toEqual({ bonus: 0, driver: null });
  });
  it('resolveGunner: slot -> the crew member holding that role', () => {
    world['Actor.carl'] = crewActor();
    const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'gunner2' }] });
    expect(a.system.resolveGunner('2').gunner.name).toBe('Carl');
    expect(a.system.resolveGunner('1')).toEqual({ actor: null, gunner: null });
    expect(a.system.resolveGunner('')).toEqual({ actor: null, gunner: null });
  });
  it('resolveGunner: the driver slot is the driver', () => {
    world['Actor.carl'] = crewActor();
    const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'driver' }] });
    expect(a.system.resolveGunner('driver').actor).toBe(world['Actor.carl']);
  });
  it('the Drive card gets the resolved driver and its privacy actor', async () => {
    world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin' });
    const a = vehicle({ drivingMode: 'stop', crew: [{ uuid: 'Actor.gob', role: 'driver' }] });
    await a.rollDriving();
    const [poster, fields, formulas, options] = postCard.mock.calls[0];
    expect(poster).toBe(a);
    expect(fields.target).toBe(12); // 10 + Dex 1 untrained + Floor 1
    expect(formulas.roll).toBeUndefined();
    expect(options.privacyOf).toBe(world['Actor.gob']);
  });

  describe('vehicle Attack to-hit', () => {
    const turret = (a, over = {}) => ({
      parent: a, type: 'attack', name: 'Turret',
      system: { gunnerSlot: '1', skillName: 'Guns', stat: 'dexterity', die: '2d6', derived: { toHit: 1, damageBase: 0, damageDice: '2d6' }, ...over },
    });
    it('the gunner skill bonus + the weapon to-hit', async () => {
      world['Actor.carl'] = crewActor({ items: [skillItem('s1', 'Guns', 5)] });
      const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'gunner1' }] });
      await a.rollAttack(turret(a));
      const [poster, fields, formulas, options] = postCard.mock.calls[0];
      expect(poster).toBe(a);
      expect(formulas.roll).toBe('1d20 + 6');
      expect(fields.note).toBe('DCC.Crew.Card.Gunner');
      expect(options.privacyOf).toBe(world['Actor.carl']);
    });
    it.each([false, true])('uses the Mob gunner as privacy actor with whisper=%s', async (mobWhisper) => {
      world['Actor.gob'] = crewActor({ uuid: 'Actor.gob', type: 'mob', name: 'Goblin', mobWhisper });
      const a = vehicle({ crew: [{ uuid: 'Actor.gob', role: 'gunner1' }] });
      await a.rollAttack(turret(a));
      expect(postCard.mock.calls[0][3].privacyOf).toBe(world['Actor.gob']);
    });
    it('no gunner: 1d20 + weapon to-hit', async () => {
      const a = vehicle();
      await a.rollAttack(turret(a, { gunnerSlot: '' }));
      const [, fields, formulas, options] = postCard.mock.calls[0];
      expect(formulas.roll).toBe('1d20 + 1');
      expect(fields.note).toBe('DCC.Crew.Card.NoGunner');
      expect(options).toEqual({});
    });
    it('a mount attacks on its own (plain derived to-hit)', async () => {
      world['Actor.carl'] = crewActor({ items: [skillItem('s1', 'Guns', 5)] });
      const a = vehicle({ kind: 'mount', crew: [{ uuid: 'Actor.carl', role: 'gunner1' }] });
      await a.rollAttack(turret(a));
      expect(postCard.mock.calls[0][2].roll).toBe('1d20 + 1');
      expect(foundry.utils.fromUuidSync).not.toHaveBeenCalled();
    });
    it('mount Attack rolls use the mount chat settings', async () => {
      const a = vehicle({ kind: 'mount', showRangeInChat: false, showNotesInChat: true });
      await a.rollAttack(turret(a, { range: '5ft', description: '<p>Bite.</p>' }));
      expect(postCard.mock.calls[0][1]).not.toHaveProperty('range');
      expect(postCard.mock.calls[0][1]).toMatchObject({ notes: 'Bite.' });
    });
    it('damage is the plain weapon damage', async () => {
      const a = vehicle();
      await a.rollAttack(turret(a), 'damage');
      expect(postCard.mock.calls[0][2].damage).toBe('2d6');
    });
    it('vehicle gunner and damage cards include extras without overwriting the gunner note', async () => {
      const a = vehicle();
      const attack = turret(a, { range: '100ft', description: '<p>Explodes.</p>' });
      await a.rollAttack(attack, 'toHit');
      await a.rollAttack(attack, 'damage');
      expect(postCard.mock.calls[0][1]).toMatchObject({
        note: 'DCC.Crew.Card.NoGunner', range: '100ft', notes: 'Explodes.',
      });
      expect(postCard.mock.calls[1][1]).toMatchObject({ range: '100ft', notes: 'Explodes.' });
      a.system.showRangeInChat = false;
      a.system.showNotesInChat = false;
      await a.rollAttack(attack);
      expect(postCard.mock.calls[2][1]).toMatchObject({ note: 'DCC.Crew.Card.NoGunner' });
      expect(postCard.mock.calls[2][1]).not.toHaveProperty('range');
      expect(postCard.mock.calls[2][1]).not.toHaveProperty('notes');
    });
  });

  describe('crew skill / attack from the vehicle', () => {
    it.each([false, true])('posts Mob crew skill and attack as the Mob with whisper=%s', async (mobWhisper) => {
      const gob = crewActor({
        uuid: 'Actor.gob', type: 'mob', mobWhisper,
        items: [skillItem('s1', 'Sneak', 2), weaponItem('w1', 'Claw', 3)],
      });
      const a = vehicle({ crew: [{ uuid: 'Actor.gob', role: 'passenger' }] });
      await a.rollCrewSkill(gob, 's1');
      await a.rollCrewAttack(gob, 'w1');
      expect(postCard.mock.calls.map(call => call[0])).toEqual([gob, gob]);
      expect(gob.system.mobWhisper).toBe(mobWhisper);
    });
    it('skill: posted as the crew actor with the aboard penalty', async () => {
      const carl = crewActor({ items: [skillItem('s1', 'Knives', 4)] });
      const a = vehicle({ speed: 3, crew: [{ uuid: 'Actor.carl', role: 'passenger' }] });
      await a.rollCrewSkill(carl, 's1');
      const [poster, fields, formulas] = postCard.mock.calls[0];
      expect(poster).toBe(carl);
      expect(formulas.roll).toBe('1d20 + 4 - 3');
      expect(fields.penalty).toBe('DCC.Crew.Card.AboardPenalty');
    });
    it('skill: the drive skill takes no penalty', async () => {
      const carl = crewActor({ items: [skillItem('s1', 'Driving', 2)] });
      const a = vehicle({ speed: 3, crew: [{ uuid: 'Actor.carl', role: 'driver' }] });
      await a.rollCrewSkill(carl, 's1');
      expect(postCard.mock.calls[0][2].roll).toBe('1d20 + 2');
    });
    it('skill: a mob posts a static target', async () => {
      const gob = crewActor({ uuid: 'Actor.gob', type: 'mob', items: [skillItem('s1', 'Sneak', 2)] });
      const a = vehicle({ speed: 3, floor: 2, crew: [{ uuid: 'Actor.gob', role: 'passenger' }] });
      await a.rollCrewSkill(gob, 's1');
      const [poster, fields, formulas] = postCard.mock.calls[0];
      expect(poster).toBe(gob);
      expect(fields.target).toBe(11); // 10 + 2 - 3 + 2
      expect(formulas.roll).toBeUndefined();
    });
    it('attack: the driver rolls at Disadvantage; damage die + base', async () => {
      const carl = crewActor({ items: [weaponItem('w1', 'Dagger', 3, '1d4', 1)] });
      const a = vehicle({ speed: 2, crew: [{ uuid: 'Actor.carl', role: 'driver' }] });
      await a.rollCrewAttack(carl, 'w1');
      expect(postCard.mock.calls[0][2]).toEqual({ roll: '2d20kl1 + 3 - 2', damage: '1d4 + 1' });
    });
    it('attack: a passenger rolls 1d20', async () => {
      const carl = crewActor({ items: [weaponItem('w1', 'Dagger', 3, '1d4', 1)] });
      const a = vehicle({ speed: 2, crew: [{ uuid: 'Actor.carl', role: 'passenger' }] });
      await a.rollCrewAttack(carl, 'w1');
      expect(postCard.mock.calls[0][2].roll).toBe('1d20 + 3 - 2');
    });
    it('crew Attack extras follow vehicle settings and preserve the aboard/speed note', async () => {
      const weapon = weaponItem('w1', 'Dagger', 3);
      weapon.system.range = '5ft';
      weapon.system.description = '<p>Sharp.</p>';
      const carl = crewActor({ items: [weapon] });
      const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'passenger' }] });
      await a.rollCrewAttack(carl, 'w1');
      expect(postCard.mock.calls[0][1]).toMatchObject({ range: '5ft', notes: 'Sharp.' });
      expect(postCard.mock.calls[0][1].note).toContain('Speed');
      a.system.showRangeInChat = false;
      a.system.showNotesInChat = false;
      await a.rollCrewAttack(carl, 'w1');
      expect(postCard.mock.calls[1][1].note).toContain('Speed');
      expect(postCard.mock.calls[1][1]).not.toHaveProperty('range');
      expect(postCard.mock.calls[1][1]).not.toHaveProperty('notes');
    });
    it('refused below Observer on the crew member (also covers macros)', async () => {
      game.user = PLAYERS[0];
      const carl = crewActor({ roller: 1, items: [skillItem('s1', 'Knives', 4), weaponItem('w1', 'Dagger', 3)] });
      const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'passenger' }] });
      expect(await a.rollCrewSkill(carl, 's1')).toBeNull();
      expect(await a.rollCrewAttack(carl, 'w1')).toBeNull();
      expect(postCard).not.toHaveBeenCalled();
    });
    it('refused: not aboard, unknown item, or not a vehicle', async () => {
      const carl = crewActor({ items: [skillItem('s1', 'Knives', 4)] });
      expect(await vehicle().rollCrewSkill(carl, 's1')).toBeNull();
      const a = vehicle({ crew: [{ uuid: 'Actor.carl', role: 'passenger' }] });
      expect(await a.rollCrewSkill(carl, 'nope')).toBeNull();
      expect(await a.rollCrewAttack(carl, 's1')).toBeNull();
      expect(await vehicle({ crew: [{ uuid: 'Actor.carl', role: 'passenger' }] }, 'pc').rollCrewSkill(carl, 's1')).toBeNull();
      expect(postCard).not.toHaveBeenCalled();
    });
  });
});
