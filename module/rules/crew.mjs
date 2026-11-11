// Crew-stat integration math. Ported from
// character-sheet/source/javascript/_crewrolls.js.
// No Foundry globals — see foundry/module/rules/ conventions.

import { CREW_ROLES } from '../config.mjs';
import { checkTypeLabel, idOf, isPassiveCheck } from './items.mjs';
import { signedFormula, damageFormula, mobToHit } from './combat.mjs';
import { joinNotes } from './card.mjs';

//
// crewSkillRollFields / crewAttackRollFields / vehicleWeaponFields are
// re-expressed as crewSkillCard / crewAttackCard / vehicleWeaponCard (card
// fields + formulas, no [[ ]]). Excluded (not ported): crewForSlot and
// driverOf (VehicleModel#crewMember / #resolveDriver read the crew actor
// directly), refreshCrewCards (crew rows read the live actor, sheet-rows
// crewRows) and the roll workers (DCCActor#rollCrewSkill / #rollCrewAttack /
// #rollAttack).

// A cached skill by NAME (case-insensitive); untrained -> the cached stat
// mod for `statKey` with rank 0. No cache at all -> +0 untrained.
// `cache` is reshaped from R20's `{ stat_mods, skills: [{name, stat, rank,
// bonus}] }` to `{ statModifiers: {<stat>: n}, skills: [{ name, stat, bonus }] }`.
// Ported from _crewrolls.js:28.
export const crewSkillBonus = (cache, skillName, statKey) => {
  const want = String(skillName || '').trim().toLowerCase();
  const skill = cache && want ? (cache.skills || []).find((s) => String(s.name || '').trim().toLowerCase() === want) : null;
  if (skill) return { bonus: +skill.bonus || 0, untrained: false };
  const statModifiers = (cache && cache.statModifiers) || {};
  return { bonus: +statModifiers[statKey] || 0, untrained: true };
};

// The vehicle's aboard penalty, applied to a crew member's rolls from the
// vehicle's crew card: 0 for the vehicle's drive skill (case-insensitive,
// compared after trimming so a whitespace-only skillName never matches), a
// flat -3 on a mount, otherwise -Speed on a vehicle. The result is always
// <= 0 (normalized so Speed 0 returns 0, not -0) — callers add it to a bonus
// with the sheet's usual pattern, `penalty ? \` - ${Math.abs(penalty)}\` : ''`.
// Adapted from _crewrolls.js:86 to a pure signature over `{ kind, speed,
// driveSkill }` instead of Roll20 `attributes`.
export const crewPenalty = ({ kind, speed, driveSkill } = {}, skillName) => {
  const drive = String(driveSkill || 'Driving').trim().toLowerCase();
  const want = String(skillName || '').trim().toLowerCase();
  if (want && want === drive) return 0;
  return (kind === 'mount' ? -3 : -(+speed || 0)) || 0;
};

// Speed damage die (ticket 003): melee attacks from a mount/vehicle add one
// Speed die, defined as identical to a Rank die — the chart is unsourced, so
// it is reported as text until then. Ported verbatim from _crewrolls.js:185.
export const speedDieNote = (speed) => `+1 Speed die if melee (Speed ${+speed || 0}; same as a Rank die — chart unsourced, add by hand)`;

// ── Crew rolls (Task 22) ──
// R20 pushes a cache over k.send (_crew.js crewPayload); Foundry builds the
// same payload from the live crew actor at roll time. Every entry carries the
// item `id`, so a quick-roll pick (an item id) resolves exactly even when two
// items share a name; by-name lookups (crewSkillBonus) take the first match.

const num = (v) => (Number.isFinite(+v) ? +v : 0);

/**
 * The crew cache (R20 crewPayload): `{ statModifiers, skills, attacks }`.
 * - skills: skills then spells (R20 spells are skill rows),
 *   `{ id, name, stat, bonus, checkType, opposedStat, description }`
 * - attacks: canonical Attack Items, `{ id, name, toHit, die, damageBase, damageType }`
 * `items` are plain `{ id, type, name, system }` with `system.derived`.
 */
export const crewCacheFrom = ({ statModifiers = {}, items = [] } = {}) => {
  const list = [...(items ?? [])];
  const of = type => list.filter(i => i?.type === type);
  const skills = [...of('skill'), ...of('spell')].map(i => ({
    id: idOf(i),
    name: i.name,
    stat: i.system?.stat ?? '',
    bonus: num(i.system?.derived?.skillBonus),
    checkType: i.system?.checkType ?? 'opposed',
    opposedStat: i.system?.opposedStat ?? '',
    description: i.system?.description ?? '',
  }));
  const attacks = of('attack').map((i) => {
    const src = i.system ?? {};
    const d = i.system?.derived ?? {};
    return {
      id: idOf(i),
      name: i.name,
      toHit: num(d.toHit),
      ...(d.mobToHitNone ? { mobToHitNone: true } : {}),
      ...(d.noDamage ? { noDamage: true } : {}),
      die: d.damageDice ?? src.die ?? '',
      damageBase: num(d.damageBase),
      damageType: src.damageType ?? '',
      range: src.range ?? '',
      description: src.description ?? '',
    };
  });
  return { statModifiers: { ...statModifiers }, skills, attacks };
};

/** A weapon's gunner slot -> the crew role that fires it ('driver' | 'gunnerN'), or null. */
export const crewSlotRole = (slot) => {
  if (slot === 'driver') return 'driver';
  const role = `gunner${slot}`;
  return (slot && CREW_ROLES.includes(role)) ? role : null;
};

/**
 * The crew name a vehicle card (Drive / Ram / Race, a vehicle weapon) may
 * print. A card reads the same for everyone who can see it, so this is per
 * card, not per viewer: the real name when every player can see the crew
 * actor (Limited or better), or when the card is whispered (to the GM) and
 * its roller can see the crew actor (a whisper's author sees it too); else
 * the generic label (as the crew row shows below Limited).
 */
export const crewCardName = ({ name, whispered = false, rollerCanSee = false, allPlayersCanSee = false } = {}, t) => (
  ((whispered && rollerCanSee) || allPlayersCanSee) ? name : t('DCC.Crew.Unknown'));

const CREW_CARD = 'DCC.Crew.Card';
const vehicleLabel = (name, t) => name || t(`${CREW_CARD}.AnyVehicle`);

// The aboard penalty (<= 0, from crewPenalty) kept as its own term, as R20
// prints it: `1d20 + 6 - 4`, not `1d20 + 2`.
const withPenalty = (head, bonus, penalty) => `${signedFormula(head, bonus)}${penalty ? ` - ${Math.abs(penalty)}` : ''}`;

/**
 * A crew member's skill rolled from the vehicle (R20 crewSkillRollFields):
 * 1d20 + bonus - |penalty|; a mob never rolls, it posts the static target
 * 10 + bonus + penalty + the vehicle's Floor. `penalty` is crewPenalty(vehicle,
 * skill.name) (0 on the drive skill). Ported from _crewrolls.js:93.
 */
export const crewSkillCard = ({ crewName, skill = {}, mob = false, vehicleName, penalty, floor } = {}, t) => {
  const bonus = num(skill.bonus);
  const aboardPenalty = num(penalty);
  const vehicle = vehicleLabel(vehicleName, t);
  const fields = {
    name: t(`${CREW_CARD}.SkillName`, { crew: crewName, skill: skill.name }),
    tag: checkTypeLabel(skill.checkType, skill.opposedStat, key => t(key)),
    note: joinNotes([t(`${CREW_CARD}.Aboard`, { vehicle }), skill.description]),
  };
  if (aboardPenalty) fields.penalty = t(`${CREW_CARD}.AboardPenalty`, { vehicle, penalty: aboardPenalty });
  if (isPassiveCheck(skill)) return { fields };
  if (mob) return { fields: { ...fields, target: mobToHit(bonus + aboardPenalty, floor) } };
  return { fields, roll: withPenalty('1d20', bonus, aboardPenalty) };
};

/**
 * A crew member's attack rolled from the vehicle (R20 crewAttackRollFields;
 * R20's separate to-hit and damage buttons are one card here): to-hit 1d20
 * (the Driver / Rider: 2d20kl1, Disadvantage) + toHit - |penalty|; a mob posts
 * the static target 10 + toHit + penalty + Floor instead and never takes the
 * driver Disadvantage. Damage is die + damageBase with the Speed-die note.
 * `penalty` is crewPenalty(vehicle, '') (attacks always take it).
 * Ported from _crewrolls.js:107.
 */
export const crewAttackCard = ({ crewName, attack = {}, mob = false, vehicleName, penalty, floor, driver = false, speed } = {}, t) => {
  const hit = num(attack.toHit);
  const aboardPenalty = num(penalty);
  const vehicle = vehicleLabel(vehicleName, t);
  const fields = {
    name: t(`${CREW_CARD}.SkillName`, { crew: crewName, skill: attack.name }),
    tag: t('DCC.Roll.ToHit'),
    type: attack.noDamage ? '' : (attack.damageType ?? ''),
    note: joinNotes([t(`${CREW_CARD}.Aboard`, { vehicle }), attack.noDamage ? '' : speedDieNote(speed)]),
  };
  const reasons = [];
  if (aboardPenalty) reasons.push(t(`${CREW_CARD}.AboardPenalty`, { vehicle, penalty: aboardPenalty }));
  const damage = attack.noDamage ? undefined : damageFormula(attack.die, num(attack.damageBase));
  if (mob) {
    if (reasons.length) fields.penalty = reasons.join(', ');
    if (!attack.mobToHitNone) fields.target = mobToHit(hit + aboardPenalty, floor);
    return { fields, damage };
  }
  if (driver) {
    fields.advantage = t('DCC.Vehicle.AdvantageChip.dis');
    reasons.push(t(`${CREW_CARD}.DriverDisadvantage`));
  }
  if (reasons.length) fields.penalty = reasons.join(', ');
  return { fields, roll: withPenalty(driver ? '2d20kl1' : '1d20', hit, aboardPenalty), damage };
};

/**
 * A vehicle weapon's to-hit (R20 vehicleWeaponFields): the gunner's cached
 * bonus for the weapon's skill (untrained: the gunner's mod for the weapon's
 * stat) + the weapon's own to-hit. No aboard penalty (a mounted weapon is
 * exempt). A mob gunner posts 10 + total + Floor; no gunner rolls the weapon
 * alone. `gunner` is `{ name, cache, mob }` or null.
 * Ported from _crewrolls.js:62.
 */
export const vehicleWeaponCard = ({ weapon = {}, gunner = null, floor } = {}, t) => {
  const rowHit = num(weapon.toHit);
  const fields = { name: weapon.name ?? '', tag: t('DCC.Roll.ToHit') };
  if (!gunner) return { fields: { ...fields, note: t(`${CREW_CARD}.NoGunner`) }, roll: signedFormula('1d20', rowHit) };
  const { bonus, untrained } = crewSkillBonus(gunner.cache, weapon.skillName, weapon.stat);
  const total = bonus + rowHit;
  const skill = String(weapon.skillName ?? '').trim() || t(`${CREW_CARD}.AnySkill`);
  fields.note = t(`${CREW_CARD}.Gunner${untrained ? 'Untrained' : ''}`, { name: gunner.name, skill });
  if (gunner.mob) return { fields: { ...fields, target: mobToHit(total, floor) } };
  return { fields, roll: signedFormula('1d20', total) };
};

// ── Crew linking (Task 21) ──
// Roll20 links crew over k.send (_crew.js) because sheets can't read each
// other; Foundry reads the crew actor directly, so only the roster rules and
// the role labels are ported. A crew entry is `{ uuid, role }` (VehicleModel).
// Every helper returns a fresh array of fresh entries and never mutates input.

const copyCrew = (crew) => (crew || []).map(c => ({ uuid: c.uuid, role: c.role }));

/** Crew that may be linked (R20: "A vehicle sheet cannot crew"). */
const CREW_TYPES = ['pc', 'mob'];

/** Roles offered on a mount: R20 hides the Gunner roles there (.dcc-not-mount). */
const MOUNT_ROLES = ['driver', 'passenger'];

// Add a crew member as a passenger. null when the UUID is blank or already
// aboard (no duplicates by UUID).
export const addCrewMember = (crew, uuid) => {
  if (!uuid || (crew || []).some(c => c.uuid === uuid)) return null;
  return [...copyCrew(crew), { uuid, role: 'passenger' }];
};

export const removeCrewMember = (crew, uuid) => copyCrew(crew).filter(c => c.uuid !== uuid);

// Give a crew member a role. Driver and each Gunner slot are exclusive: the
// previous holder is demoted to passenger (R20's flat role inputs can only
// name one character per slot). null for an unknown role or member.
export const assignCrewRole = (crew, uuid, role) => {
  if (!CREW_ROLES.includes(role) || !(crew || []).some(c => c.uuid === uuid)) return null;
  return copyCrew(crew).map((c) => {
    if (c.uuid === uuid) return { ...c, role };
    if (role !== 'passenger' && c.role === role) return { ...c, role: 'passenger' };
    return c;
  });
};

// Why a dropped actor can't crew a vehicle, or null when it can. `actor` is
// `{ type, isToken, inWorld }`: crew are world PC / Mob actors — a vehicle
// (the vehicle itself included) can't crew, and an unlinked token actor or a
// compendium actor has no stable world UUID. Reasons: 'type' | 'vehicle' | 'notWorld'.
export const crewDropRejection = (actor) => {
  if (actor?.type === 'vehicle') return 'vehicle';
  if (!CREW_TYPES.includes(actor?.type)) return 'type';
  if (actor.isToken || !actor.inWorld) return 'notWorld';
  return null;
};

/** A role's label key; the driver reads Rider on a mount (R20 rolesOf). */
export const crewRoleKey = (role, kind) => `DCC.Crew.Role.${(role === 'driver' && kind === 'mount') ? 'rider' : role}`;

// The roles a crew row's select offers, in CREW_ROLES order. A mount drops
// the Gunner roles but keeps the one currently held, so a vehicle switched
// to a mount still shows (and can clear) its gunners.
export const crewRoleChoices = (kind, current) => (kind === 'mount'
  ? CREW_ROLES.filter(r => MOUNT_ROLES.includes(r) || r === current)
  : [...CREW_ROLES]);

// The Crewing line on a PC / Mob sheet (R20 syncCrewingRows): every vehicle
// whose crew holds `uuid`, by name, with the role held there. `vehicles` is
// `[{ uuid, name, kind, crew }]`.
export const crewingOf = (vehicles, uuid) => (vehicles || []).flatMap((v) => {
  const entry = (v.crew || []).find(c => c.uuid === uuid);
  return entry ? [{ uuid: v.uuid, name: v.name, role: entry.role, roleKey: crewRoleKey(entry.role, v.kind) }] : [];
}).sort((a, b) => String(a.name).localeCompare(String(b.name)));

// Which open actor sheets to re-render after a change, as sheet ids.
// `sheets`: `[{ id, type, uuid, crew?, crewing? }]` — a vehicle sheet's
// `crew` is its crew UUIDs; a PC / Mob sheet's `crewing` is the vehicle UUIDs
// its Crewing line last showed (so a removed crew member, no longer in the
// vehicle's crew, still refreshes).
// `event`: the changed actor `{ uuid, type }`; a vehicle adds `crewChanged`
// (its crew, name or kind changed, or it was created / deleted) and `crew`,
// its crew UUIDs now ([] once deleted).
// - a PC / Mob changed (stats, items, effects, deleted) -> the vehicle sheets it crews
// - a vehicle's crew changed -> the PC / Mob sheets aboard now or shown aboard before
export const crewRenderTargets = (event, sheets) => {
  const open = sheets || [];
  if (event?.type !== 'vehicle') {
    return open.filter(s => s.type === 'vehicle' && (s.crew || []).includes(event?.uuid)).map(s => s.id);
  }
  if (!event.crewChanged) return [];
  const aboard = event.crew || [];
  return open
    .filter(s => s.type !== 'vehicle' && (aboard.includes(s.uuid) || (s.crewing || []).includes(event.uuid)))
    .map(s => s.id);
};

// The actor an embedded Item / ActiveEffect belongs to: its parent, or for an
// effect on an owned item, the item's parent. null for world documents.
// Documents are read as plain `{ documentName, parent }` objects.
export const owningActor = (doc) => {
  const parent = doc?.parent;
  if (parent?.documentName === 'Actor') return parent;
  return (parent?.parent?.documentName === 'Actor') ? parent.parent : null;
};

// A vehicle update (the updateActor `changes` diff, expanded) that changes
// what crew rows or Crewing lines show: the crew, the kind (Driver / Rider
// labels), the name, or the ownership (which vehicles a player's Crewing line
// may list).
export const touchesCrew = (changes) => {
  if (!changes) return false;
  const system = changes.system ?? {};
  return ('crew' in system) || ('kind' in system) || ('name' in changes) || ('ownership' in changes);
};

// The crewRenderTargets event for an actor `{ uuid, type, system }`. A
// vehicle adds `crewChanged` (the caller decides) and its stored crew UUIDs,
// [] once it is deleted. null without an actor.
export const crewEvent = (actor, { crewChanged = false, deleted = false } = {}) => {
  if (!actor) return null;
  if (actor.type !== 'vehicle') return { uuid: actor.uuid, type: actor.type };
  const crew = deleted ? [] : (actor.system?._source?.crew ?? []).map(c => c.uuid);
  return { uuid: actor.uuid, type: 'vehicle', crewChanged, crew };
};
