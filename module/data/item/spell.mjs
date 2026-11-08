import SkillModel from './skill.mjs';
import { DAMAGE_TYPES } from '../../config.mjs';
import { int, str, bool } from '../_fields.mjs';

export default class SpellModel extends SkillModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      manaCost: int(0),
      // When enabled the spell also appears in the attack list.
      attack: new fields.SchemaField({
        enabled: bool(false),
        die: str(''),
        damageBonus: int(0),
        damageType: str('', { choices: ['', ...DAMAGE_TYPES], blank: true }),
      }),
    };
  }
}
