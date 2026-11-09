import { VEHICLE_SIZE_MAX, VEHICLE_CONSTITUTION_MODIFIER_DEFAULT, CREW_ROLES, STATS } from '../../config.mjs';
import { int, str, bool, html, pool } from '../_fields.mjs';
import { deriveVehicle } from '../../rules/derive.mjs';
import { crewCacheFrom, crewSkillBonus, crewSlotRole } from '../../rules/crew.mjs';
import { resetModifiers, ownedItems, engineItems, assignItemDerived, assignHealth, rewriteHealthPointsEdit, rewriteHealthBarSlotCount } from './_derive-wiring.mjs';

const DERIVED_ITEM_TYPES = new Set(['attack']);

/**
 * A crew actor's roll-time cache (R20 crewPayload, read live instead of
 * pushed): `{ statModifiers, skills, attacks }`, see rules/crew.mjs crewCacheFrom.
 * @param {Actor} actor - a PC / Mob
 */
export const crewCache = (actor) => {
  const stats = actor?.system?.stats ?? {};
  const statModifiers = Object.fromEntries(STATS.map(s => [s, +stats[s]?.modifier || 0]));
  return crewCacheFrom({ statModifiers, items: actor?.items ?? [] });
};

export default class VehicleModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      kind: str('vehicle', { choices: ['vehicle', 'mount'] }),
      size: int(4, { min: 1, max: VEHICLE_SIZE_MAX }),
      speed: int(0),
      speedMax: int(4),
      // null means the default (5). Deliberate deviation: R20 allows 0; minimum here is 1.
      constitutionModifier: new fields.NumberField({ required: true, nullable: true, integer: true, min: 1, initial: VEHICLE_CONSTITUTION_MODIFIER_DEFAULT }),
      passengers: int(1),
      driveSkill: str('Driving'),
      armor: int(0),
      floor: int(1),
      healthBar: int(4, { min: 0 }),
      healthPoints: pool(),
      rollAdvantage: str('', { choices: ['', 'adv', 'dis'], blank: true }),
      drivingMode: str('accelerate', { choices: ['accelerate', 'stop', 'longhaul'] }),
      drivingTarget: int(1),
      ramTargetEvade: int(10),
      ramTargetLarger: bool(false),
      ramDamageDealt: int(0),
      raceAhead: int(0),
      showRangeInChat: bool(true),
      showNotesInChat: bool(true),
      // Crew: world PC / Mob actors (never unlinked token actors), one role each.
      // Linked by dropping an actor on the sheet; role rules in rules/crew.mjs.
      crew: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.DocumentUUIDField({ type: 'Actor', embedded: false }),
        role: str('passenger', { choices: CREW_ROLES }),
      }), { required: true, initial: [] }),
      passengersNote: str(),
      notes: html(),
    };
  }

  prepareBaseData() {
    super.prepareBaseData();
    resetModifiers(this);
  }

  /**
   * Derived (instance-only):
   * - `healthConstitutionModifier` — the effective Con Mod the health bar uses
   *   (stored `constitutionModifier` null -> default 5); the stored
   *   `constitutionModifier` itself is left untouched
   * - `healthBarSlots`, `healthBarDisplay` (stored `healthBar` clamped;
   *   `healthBar` itself untouched), `healthPoints.value/max`,
   *   `unresolvedModifiers`
   * - `damageResistance`, `damageResistanceBonus`, `move`, `cruise`, `penalty`
   * - `step` — 10 for a mount, null otherwise
   * - `item.system.derived` on every owned item
   */
  prepareDerivedData() {
    super.prepareDerivedData();
    const items = ownedItems(this);
    const d = deriveVehicle({
      kind: this.kind,
      size: this.size,
      speed: this.speed,
      constitutionModifier: this.constitutionModifier,
      armor: this.armor,
      healthBar: this.healthBar,
      modifiers: this._modifiers ?? [],
      items: engineItems(items, DERIVED_ITEM_TYPES),
    });

    assignHealth(this, d);
    this.healthConstitutionModifier = d.constitutionModifierEffective;
    this.damageResistance = d.damageResistance;
    this.damageResistanceBonus = d.damageResistanceBonus;
    this.move = d.move;
    this.cruise = d.cruise;
    this.penalty = d.penalty;
    this.step = d.step ?? null;

    assignItemDerived(items, d.items);
  }

  /**
   * Route `system.healthPoints.value` edits to `system.healthBar` slots (see rewriteHealthPointsEdit).
   * @override
   */
  async _preUpdate(changes, options, user) {
    const explicitHealthBar = Object.hasOwn(changes.system ?? {}, 'healthBar');
    rewriteHealthPointsEdit(this, changes);
    rewriteHealthBarSlotCount(this, changes, 'vehicle', explicitHealthBar);
    return super._preUpdate(changes, options, user);
  }

  /**
   * The live crew actor holding `role`, or null (role empty, or the actor was
   * deleted: a missing crew member counts as nobody).
   * @param {string|null} role - a CREW_ROLES value
   * @returns {Actor|null}
   */
  crewMember(role) {
    const entry = role ? (this.crew ?? []).find(c => c.role === role) : null;
    return entry ? (foundry.utils.fromUuidSync(entry.uuid) ?? null) : null;
  }

  /**
   * Who is driving, and their roll bonus, resolved at roll time. The one seam
   * for crew rolls: the Driving check, Ram and Race all read it. The bonus is
   * the driver's skill named by `driveSkill` (untrained: their Dex mod, R20
   * driverOf). Nobody (or a deleted driver) -> bonus 0 and the card says "No
   * driver assigned". `actor` (only when there is a driver) is the driver,
   * whose privacy the card follows.
   * @returns {{bonus:number, driver:{name:string, untrained:boolean, mob:boolean}|null, actor?:Actor}}
   */
  resolveDriver() {
    const actor = this.crewMember('driver');
    if (!actor) return { bonus: 0, driver: null };
    const { bonus, untrained } = crewSkillBonus(crewCache(actor), this.driveSkill || 'Driving', 'dexterity');
    return { bonus, driver: { name: actor.name, untrained, mob: actor.type === 'mob' }, actor };
  }

  /**
   * The crew member firing a weapon in gunner slot `slot` ('driver' | '1'..'4';
   * blank = nobody), for rules/crew.mjs vehicleWeaponCard.
   * @returns {{actor:Actor|null, gunner:{name:string, cache:object, mob:boolean}|null}}
   */
  resolveGunner(slot) {
    const actor = this.crewMember(crewSlotRole(slot));
    if (!actor) return { actor: null, gunner: null };
    return { actor, gunner: { name: actor.name, cache: crewCache(actor), mob: actor.type === 'mob' } };
  }

  /**
   * Whether a weapon roll goes through the gunner (vehicleWeaponCard): a
   * vehicle's to-hit. Damage, and every mount attack (a mount attacks on its
   * own, R20 vehicleAttackFields), roll the plain weapon.
   * @param {'toHit'|'damage'} which
   */
  rollsWithGunner(which) {
    return (which !== 'damage') && (this.kind !== 'mount');
  }

  /** The aboard-penalty inputs (rules/crew.mjs crewPenalty). */
  get penaltyInputs() {
    return { kind: this.kind, speed: this.speed, driveSkill: this.driveSkill };
  }

  /** Vehicles have no stats: the only roll shortcut is `@floor`. */
  rollShortcuts() {
    return { floor: this.floor };
  }
}
