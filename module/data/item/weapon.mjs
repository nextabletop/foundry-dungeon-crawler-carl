import BaseItemModel from './base-item.mjs';
import { STATS, DAMAGE_TYPES, ITEM_SLOTS, GUNNER_SLOTS } from '../../config.mjs';
import { int, str, bool } from '../_fields.mjs';

export default class WeaponModel extends BaseItemModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Attack
      stat: str('strength', { choices: STATS }),
      rank: int(0),
      // Name of a skill whose base rank replaces `rank` when set (resolved by name).
      skill: str(),
      die: str('1d6'),
      damageBonus: int(0),
      damageType: str('bludgeoning', { choices: ['', ...DAMAGE_TYPES], blank: true }),
      // Inventory
      quantity: int(1),
      slot: str('pack', { choices: ITEM_SLOTS }),
      active: bool(false),
      // Vehicle-only
      gunnerSlot: str('', { choices: ['', ...GUNNER_SLOTS], blank: true }),
      skillName: str(),
    };
  }
}
