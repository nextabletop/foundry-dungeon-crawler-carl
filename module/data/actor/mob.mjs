import CreatureModel from './creature.mjs';
import { int, str, bool, pool } from '../_fields.mjs';
import { seedMobAttackBase } from '../item/attack.mjs';

export default class MobModel extends CreatureModel {
  static creatureType = 'mob';

  static defineSchema() {
    return {
      ...super.defineSchema(),
      descriptors: str(),
      surprise: int(10, { nullable: true }),
      mobEvadeBase: int(10, { nullable: true }),
      mana: pool(),
      mobCombatEdit: bool(false),
      mobAbilitiesEdit: bool(false),
      mobWhisper: bool(false),
      mobShowInventory: bool(false),
      mobShowSkills: bool(false),
      mobShowBuffs: bool(false),
    };
  }

  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    for (const item of this.parent.items) {
      if (item.type === 'attack') seedMobAttackBase(item, this.parent);
    }
  }
}
