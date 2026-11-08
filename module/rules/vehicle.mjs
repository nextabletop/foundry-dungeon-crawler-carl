// Vehicle / Mount stat block math. Ported from
// character-sheet/source/javascript/_vehicle.js.
// No Foundry globals — see foundry/module/rules/ conventions.
//
// The *Fields builders (with driverNote / rollOrTarget) are re-expressed at
// the bottom as drivingCheck / ram / race: card fields + formulas, no [[ ]].
// applyRam and drAbsorbed are actor glue (DCCActor#applyRamAftermath /
// #damageResistanceAbsorbed). advLabel and drivingModeLabel are not ported: the sheet's
// selects and the card chips are localized (lang/en.json DCC.Vehicle.*).

import { signedFormula } from './combat.mjs';
import { joinNotes } from './card.mjs';

// Size ladder 1-8. ONLY Petite (3), Medium (4) and Huge (6) are confirmed by
// the extracted rules; the remaining names are placeholders.
// Ported verbatim from _vehicle.js:16.
export const VEHICLE_SIZES = [
  { v: 1, l: 'Tiny' }, { v: 2, l: 'Small' }, { v: 3, l: 'Petite' }, { v: 4, l: 'Medium' },
  { v: 5, l: 'Large' }, { v: 6, l: 'Huge' }, { v: 7, l: 'Gargantuan' }, { v: 8, l: 'Colossal' },
];

// `speed` is the vehicle's Speed rating, not a distance or a real-world
// speed. vehicleMove: ft moved per action = Speed x 50 (50' squares).
// Ported verbatim from _vehicle.js:21.
export const vehicleMove = (speed) => (+speed || 0) * 50;

// cruiseMph: long-distance cruising mph = Speed x 10. Ported verbatim from
// _vehicle.js:22.
export const cruiseMph = (speed) => (+speed || 0) * 10;

// Advantage / Disadvantage (sheet-wide roll option): adv | dis | '' -> the
// d20 expression the template rolls. Ported verbatim from _vehicle.js:26.
export const d20Expr = (advantage) => {
  if (advantage === 'adv') return '2d20kh1';
  if (advantage === 'dis') return '2d20kl1';
  return '1d20';
};

// Driving / Riding check DCs: accelerate to N = 10 + N, where `target` is
// the desired Speed to accelerate to, not a distance (fail -> half N,
// reported not applied); stop = 10 + current Speed; long-distance hour = 15
// + Floor. Any other/unknown mode falls back to the 'stop' formula, as in
// R20. Ported verbatim from _vehicle.js:39.
export const drivingCheckDC = (mode, { target, speed, floor } = {}) => {
  if (mode === 'accelerate') return 10 + (+target || 0);
  if (mode === 'longhaul') return 15 + (+floor || 0);
  return 10 + (+speed || 0); // stop (and the fallback for any unknown mode)
};

// Ram / trample: 1d6 per size class + current Speed. `size` is expected to
// be an integer 1-8 (deriveVehicle clamps VehicleModel.size to that range
// before calling this); a size below 1 or non-numeric is floored to 1d6, as
// in R20. Ported from _vehicle.js:46, with the card formulas' signedFormula
// deviation (see below): Speed 0 reads `4d6`, not `4d6 + 0`.
export const ramDamage = (size, speed) => signedFormula(`${Math.max(1, +size || 1)}d6`, +speed || 0);

// Aftermath: vs same size or smaller -> self-damage 50%, Speed halved; vs
// larger -> full damage, Speed 0. Occupants take half the vehicle's damage
// minus their own DR and the vehicle DR (reported by the caller, applied by
// hand). Ported verbatim from _vehicle.js:51.
export const ramAftermath = ({ damage, speed, targetLarger } = {}) => {
  const d = +damage || 0;
  const s = +speed || 0;
  return targetLarger
    ? { selfDamage: d, newSpeed: 0 }
    : { selfDamage: Math.floor(d / 2), newSpeed: Math.floor(s / 2) };
};

// Race / chase: current Speed + 1 per racer ahead (Slingshot Effect). This
// is only the Speed/slingshot component — the caller adds the driver's
// Driving bonus separately. Ported verbatim from _vehicle.js:60.
export const raceBonus = (speed, ahead) => (+speed || 0) + (+ahead || 0);

// ── Roll-card builders (R20 drivingCheckFields / ramFields / raceFields) ──
// Each returns `{ fields, roll?, damage? }`: postCard fields and formulas.
// Card text goes through `t(key, data)` (game.i18n.format in the actor; the
// tests pass one over lang/en.json), so these stay free of Foundry globals.
// `driver` is `{ name, untrained, mob }` or null (nobody at the wheel), and
// `driverBonus` the driver's roll bonus; both come from
// VehicleModel#resolveDriver (the Driver crew member; 0 / null when nobody).
//
// Deliberate deviation: formulas use signedFormula, so a +0 bonus reads
// `1d20` (R20: `1d20 + 0`) and a negative one `1d20 - 2`.

const CARD = 'DCC.Vehicle.Card';

// Crew note: "No driver assigned" / "Driver: Carl (untrained)". Ported from
// _vehicle.js:69 driverNote; `role` is 'driver' or 'rider'.
const crewNote = (driver, role, t) => {
  const r = role === 'rider' ? 'Rider' : 'Driver';
  if (!driver) return t(`${CARD}.No${r}`);
  return t(`${CARD}.${r}${driver.untrained ? 'Untrained' : ''}`, { name: driver.name });
};

// A mob driver never rolls a d20: it posts a static target, 10 + bonus +
// `mobExtra`; anyone else (or nobody) rolls d20 + bonus, Adv/Dis aware.
// Ported from _vehicle.js:74 rollOrTarget.
const rollOrTarget = (fields, { driver, bonus, advantage, mobExtra = 0 }, t) => {
  if (driver?.mob) return { fields: { ...fields, target: 10 + bonus + mobExtra } };
  const d20 = d20Expr(advantage);
  // `advantage` on the card fields is the chip label (chat/card.hbs).
  const advantageChip = (d20 !== '1d20') ? { advantage: t(`DCC.Vehicle.AdvantageChip.${advantage}`) } : {};
  return { fields: { ...fields, ...advantageChip }, roll: signedFormula(d20, bonus) };
};

const skillOf = driveSkill => driveSkill || 'Driving';

/**
 * Driving / Riding check. A mob driver's target adds the Floor. The role is
 * "rider" when the drive skill looks like Riding (/rid/i), as in R20.
 * Ported from _vehicle.js:86.
 */
export const drivingCheck = ({ mode, target, speed, floor, driveSkill, driverBonus, driver = null, advantage } = {}, t) => {
  const skill = skillOf(driveSkill);
  const role = /rid/i.test(skill) ? 'rider' : 'driver';
  const n = +target || 0;
  let what;
  if (mode === 'accelerate') what = t(`${CARD}.Accelerate`, { n });
  else if (mode === 'longhaul') what = t(`${CARD}.Longhaul`);
  else what = t(`${CARD}.Stop`);
  const notes = [crewNote(driver, role, t)];
  if (mode === 'accelerate') notes.push(t(`${CARD}.AccelerateFail`, { n: Math.floor(n / 2) }));
  const fields = {
    name: t(`${CARD}.DrivingName`, { skill, what }),
    tag: t(`${CARD}.DrivingTag`),
    dc: drivingCheckDC(mode, { target, speed, floor }),
    note: joinNotes(notes),
  };
  return rollOrTarget(fields, { driver, bonus: +driverBonus || 0, advantage, mobExtra: +floor || 0 }, t);
};

/**
 * Ram / Trample: always at Disadvantage vs the target's Evade, damage
 * <size>d6 + <speed>; the aftermath for both size cases is in the note (the
 * GM applies it by hand with Apply aftermath). A mob driver's target adds the
 * Floor. Ported from _vehicle.js:102.
 */
export const ram = ({ size, speed, targetEvade, kind, driveSkill, driverBonus, driver = null, floor } = {}, t) => {
  const mount = kind === 'mount';
  const fields = {
    name: t(`${CARD}.${mount ? 'Trample' : 'Ram'}`),
    tag: t(`${CARD}.RamTag`, { skill: skillOf(driveSkill) }),
    dc: +targetEvade || 0,
    note: joinNotes([crewNote(driver, mount ? 'rider' : 'driver', t), t(`${CARD}.RamAftermath`)]),
  };
  return {
    ...rollOrTarget(fields, { driver, bonus: +driverBonus || 0, advantage: 'dis', mobExtra: +floor || 0 }, t),
    damage: ramDamage(size, speed),
  };
};

/**
 * Race / Chase: driver bonus + Speed + 1 per racer ahead; manual Adv/Dis
 * (round-1 prey rolls with Advantage). A mob driver's target is a race total:
 * no Floor, +5 instead of Advantage. The role is always "driver" (R20).
 * Ported from _vehicle.js:115.
 */
export const race = ({ speed, ahead, advantage, driveSkill, driverBonus, driver = null } = {}, t) => {
  const s = +speed || 0;
  const a = +ahead || 0;
  const fields = {
    name: t(`${CARD}.Race`),
    tag: t(`${CARD}.RaceTag`, { skill: skillOf(driveSkill) }),
    note: joinNotes([crewNote(driver, 'driver', t), t(`${CARD}.RaceSpeed`, { speed: s, ahead: a }), t(`${CARD}.RaceGm`)]),
  };
  const bonus = (+driverBonus || 0) + raceBonus(s, a);
  return rollOrTarget(fields, { driver, bonus, advantage, mobExtra: advantage === 'adv' ? 5 : 0 }, t);
};
