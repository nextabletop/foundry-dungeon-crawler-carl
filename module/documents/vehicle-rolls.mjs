// Vehicle and crew rolls (R20 _vehicle.js:134-184, _crewrolls.js:204-265):
// Foundry glue between a vehicle actor, its live crew (VehicleModel) and the
// pure card builders (rules/vehicle.mjs, rules/crew.mjs). DCCActor keeps the
// thin public methods and the re-entry guards; everything here takes the
// vehicle actor as its first argument.

import { directDamage } from '../rules/health.mjs';
import { postCard } from '../rolls/card.mjs';
import { drivingCheck, ram, race, ramAftermath } from '../rules/vehicle.mjs';
import { crewPenalty, crewSkillCard, crewAttackCard, vehicleWeaponCard, crewCardName } from '../rules/crew.mjs';
import { cardMessageMode, PUBLIC_MODES } from '../rules/engine.mjs';
import { crewCache } from '../data/actor/vehicle.mjs';
import { attackCardExtras, htmlToText } from '../rules/card.mjs';

/** The card-text formatter the pure rules builders take. */
const t = (key, data) => game.i18n.format(key, data);

/** postCard options with the crew actor whose (mob) privacy the card follows, when there is one. */
const withPrivacy = (actor, options) => (actor ? { privacyOf: actor, ...options } : options);

/**
 * The name a vehicle card may print for crew member `actor` (crewCardName).
 * `whispered` comes from cardMessageMode, the same decision postCard makes
 * (the card is posted with `privacyOf: actor`); `rollerCanSee` because the
 * whisper's author (this user) sees it too.
 *
 * `allPlayersCanSee` checks EVERY non-GM user, offline ones included. That
 * is deliberately conservative: the card stays in the chat log, so a player
 * who logs in later reads it too.
 */
const cardCrewName = (actor) => {
  const mode = cardMessageMode(actor, game.settings.get('core', 'messageMode'));
  return crewCardName({
    name: actor.name,
    whispered: !PUBLIC_MODES.includes(mode),
    rollerCanSee: game.user.isGM || actor.testUserPermission(game.user, 'LIMITED'),
    allPlayersCanSee: game.users.filter(u => !u.isGM).every(u => actor.testUserPermission(u, 'LIMITED')),
  }, t);
};

/**
 * Post a vehicle roll card from a rules/vehicle.mjs builder, fed the
 * vehicle's inputs and the roll-time driver (VehicleModel#resolveDriver).
 */
const postVehicleCard = async (vehicle, build, options) => {
  const s = vehicle.system;
  const { bonus, driver, actor } = s.resolveDriver();
  const { fields, roll, damage } = build({
    mode: s.drivingMode, target: s.drivingTarget, speed: s.speed, floor: s.floor, size: s.size,
    kind: s.kind, driveSkill: s.driveSkill, advantage: s.rollAdvantage, targetEvade: s.ramTargetEvade, ahead: s.raceAhead,
    driverBonus: bonus, driver: driver ? { ...driver, name: cardCrewName(actor) } : null,
  }, t);
  return postCard(vehicle, fields, { roll, damage }, withPrivacy(actor, options));
};

/** Driving / Riding check in the selected driving mode. */
export const postDriving = (vehicle, options) => postVehicleCard(vehicle, drivingCheck, options);

/** Ram / Trample: to-hit at Disadvantage vs the target Evade, plus the ram damage. */
export const postRam = (vehicle, options) => postVehicleCard(vehicle, ram, options);

/** Race / Chase. */
export const postRace = (vehicle, options) => postVehicleCard(vehicle, race, options);

/**
 * A vehicle Attack's to-hit: the crew member in the Attack's gunner slot adds
 * their bonus for its skill (rules/crew.mjs
 * vehicleWeaponCard). Posted as the vehicle; a mob gunner's card follows
 * the mob's privacy. A mount's attacks don't come here (they roll alone).
 * @returns {Promise<object|null>}
 */
export const rollVehicleWeapon = async (vehicle, item, options) => {
  const d = item.system?.derived ?? {};
  if (!Number.isFinite(d.toHit)) return null;
  const s = vehicle.system;
  const { actor, gunner } = s.resolveGunner(item.system.gunnerSlot);
  const { fields, roll } = vehicleWeaponCard({
    weapon: { name: item.name, toHit: d.toHit, skillName: item.system.skillName, stat: item.system.stat },
    gunner: gunner && { ...gunner, name: cardCrewName(actor) }, floor: s.floor,
  }, t);
  return postCard(vehicle, { ...fields, ...attackCardExtras(s, item.system) }, { roll }, withPrivacy(actor, options));
};

/**
 * The crew entry for `crew` on `vehicle`, or null: not a vehicle, `crew`
 * not aboard, or this user below Observer on `crew` (the sheet shows no
 * quick-roll selects then; this also covers macros).
 */
const crewEntry = (vehicle, crew) => {
  if ((vehicle.type !== 'vehicle') || !crew?.uuid) return null;
  if (!crew.testUserPermission?.(game.user, 'OBSERVER')) return null;
  return (vehicle.system.crew ?? []).find(c => c.uuid === crew.uuid) ?? null;
};

/**
 * A crew member's skill (or spell, as a plain check: no mana is spent, R20
 * rollCrewSkill) rolled from `vehicle`, with the aboard penalty (none on the
 * drive skill). Posted as the crew actor, so the speaker, portrait and mob
 * privacy are the crew member's.
 * @returns {(() => Promise<object>)|null} the post, or null when refused
 *   (not aboard / below Observer / no such skill), so the caller only takes
 *   its re-entry guard for a roll that happens
 */
export const crewSkillPost = (vehicle, crew, itemId, options) => {
  if (!crewEntry(vehicle, crew)) return null;
  const skill = crewCache(crew).skills.find(k => k.id === itemId);
  if (!skill) return null;
  const s = vehicle.system;
  return () => {
    const { fields, roll } = crewSkillCard({
      crewName: crew.name, skill: { ...skill, description: htmlToText(skill.description) },
      mob: crew.type === 'mob', vehicleName: vehicle.name,
      penalty: crewPenalty(s.penaltyInputs, skill.name), floor: s.floor,
    }, t);
    return postCard(crew, fields, { roll }, options);
  };
};

/**
 * A crew member's attack (weapon or attack spell) rolled from `vehicle`:
 * to-hit with the aboard penalty (the Driver / Rider at Disadvantage) and
 * damage with the Speed-die note (R20 rollCrewAttack). Posted as the crew actor.
 * @returns {(() => Promise<object>)|null} the post, or null when refused
 */
export const crewAttackPost = (vehicle, crew, itemId, options) => {
  const entry = crewEntry(vehicle, crew);
  if (!entry) return null;
  const attack = crewCache(crew).attacks.find(k => k.id === itemId);
  if (!attack) return null;
  const s = vehicle.system;
  return () => {
    const { fields, roll, damage } = crewAttackCard({
      crewName: crew.name, attack, mob: crew.type === 'mob', vehicleName: vehicle.name,
      penalty: crewPenalty(s.penaltyInputs, ''), floor: s.floor, driver: entry.role === 'driver', speed: s.speed,
    }, t);
    return postCard(crew, { ...fields, ...attackCardExtras(s, attack) }, { roll, damage }, options);
  };
};

/**
 * Apply the ram aftermath from `ramDamageDealt` + `ramTargetLarger` (R20
 * applyRam): chunk the self-damage into the vehicle's own slots with DR 0
 * (vehicle DR protects occupants) and write the reduced Speed, in one
 * update. As in R20: no card, and the dealt damage is left in place.
 * @returns {Promise<Actor>}
 */
export const applyRamAftermath = async (vehicle) => {
  const s = vehicle.system;
  const after = ramAftermath({ damage: s.ramDamageDealt, speed: s.speed, targetLarger: s.ramTargetLarger });
  const { healthBar } = directDamage(vehicle.currentSlots, after.selfDamage, 0, s.healthConstitutionModifier, s.healthBarSlots);
  const update = { 'system.speed': after.newSpeed };
  if (healthBar !== vehicle.currentSlots) update['system.healthBar'] = healthBar;
  return vehicle.update(update);
};
