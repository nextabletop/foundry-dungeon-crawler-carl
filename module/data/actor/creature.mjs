import { STATS, ROLL_ABBR } from '../../config.mjs';
import { deriveCreature } from '../../rules/derive.mjs';
import { int, str, bool, html, pool } from '../_fields.mjs';
import { resetModifiers, ownedItems, engineItems, assignItemDerived, assignHealth, rewriteHealthPointsEdit } from './_derive-wiring.mjs';

const DERIVED_ITEM_TYPES = new Set(['attack', 'skill', 'spell']);

/**
 * Shared model for creatures (pc + mob).
 *
 * Derived (instance-only, never in source) after prepareDerivedData:
 * - `stats[s].enhancement`, `stats[s].modifier` — enhanced value and stat modifier
 * - `healthBarSlots` — health-bar slot count; `healthBarDisplay` — stored
 *   `healthBar` clamped to [0, healthBarSlots] for display. The stored
 *   `healthBar` itself is left untouched.
 * - `healthPoints.value`, `healthPoints.max` — healthBar x Con Mod
 * - `healthConstitutionModifier` — the Con Mod the health bar uses (hit
 *   points per slot): the constitution stat modifier
 * - `evade`, `evadeBonus`, `evadeDice`, `evadeBuffLabel`, `evadeRollLabel`, and
 *   `damageResistance`, `move`, `step` with their flat bonuses (the stored bases are `armor`,
 *   `moveBase`, `stepBase`)
 * - `mobToHit`, `mobEvade` — mob static targets
 * - `unresolvedModifiers` — modifiers the engine could not apply
 * - `item.system.derived` on every owned item
 */
export default class CreatureModel extends foundry.abstract.TypeDataModel {
  /**
   * Engine mode for deriveCreature ('pc' | 'mob'). No default: every concrete
   * subclass must define it; prepareDerivedData throws otherwise.
   * @type {'pc'|'mob'|undefined}
   */
  static creatureType;

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      level: int(1),
      floor: int(1),
      stats: new fields.SchemaField(Object.fromEntries(
        STATS.map(s => [s, new fields.SchemaField({ base: int(1) })]),
      )),
      healthBar: int(10, { min: 0 }),
      healthPoints: pool(),
      armor: int(0),
      moveBase: int(0),
      stepBase: int(5),
      size: str('M'),
      showRangeInChat: bool(true),
      showNotesInChat: bool(true),
      notes: html(),
    };
  }

  prepareBaseData() {
    super.prepareBaseData();
    resetModifiers(this);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const type = this.constructor.creatureType;
    if (!type) throw new Error(`${this.constructor.name} must define static creatureType ('pc' | 'mob')`);
    const items = ownedItems(this);
    const d = deriveCreature({
      type,
      level: this.level,
      floor: this.floor,
      healthBar: this.healthBar,
      armor: this.armor,
      moveBase: this.moveBase,
      stepBase: this.stepBase,
      stats: this.stats,
      manaStat: this.manaStat,
      modifiers: this._modifiers ?? [],
      items: engineItems(items, DERIVED_ITEM_TYPES),
    });

    assignHealth(this, d);
    for (const s of STATS) {
      this.stats[s].enhancement = d.stats[s].enhancement;
      this.stats[s].modifier = d.stats[s].modifier;
    }
    this.healthConstitutionModifier = d.stats.constitution.modifier;
    this.evade = d.evade;
    this.damageResistance = d.damageResistance;
    this.move = d.move;
    this.step = d.step;
    this.moveBonus = d.moveBonus;
    this.stepBonus = d.stepBonus;
    this.evadeBonus = d.evadeBonus;
    this.evadeDice = d.evadeDice;
    this.evadeBuffLabel = d.evadeBuffLabel;
    this.evadeRollLabel = d.evadeRollLabel;
    this.damageResistanceBonus = d.damageResistanceBonus;
    this.mobToHit = d.mobToHit;
    this.mobEvade = d.mobEvade;
    this._applyDerived(d);

    assignItemDerived(items, d.items);
  }

  /**
   * Route `system.healthPoints.value` edits to `system.healthBar` slots (see rewriteHealthPointsEdit).
   * @override
   */
  async _preUpdate(changes, options, user) {
    rewriteHealthPointsEdit(this, changes);
    return super._preUpdate(changes, options, user);
  }

  /** Subclass hook for type-specific derived values. */
  _applyDerived(_d) {}

  /** Short roll-data keys: `@str`..`@cha` (stat modifiers), `@level`, `@floor`. */
  rollShortcuts() {
    return {
      ...Object.fromEntries(STATS.map(s => [ROLL_ABBR[s], this.stats[s].modifier])),
      level: this.level,
      floor: this.floor,
    };
  }
}
