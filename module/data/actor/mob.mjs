import CreatureModel from './creature.mjs';
import { int, str, bool, pool } from '../_fields.mjs';
import { seedMobAttackBase } from '../item/attack.mjs';
import { mobTokenSize } from '../../rules/token-size.mjs';

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
    const size = mobTokenSize(this._source?.descriptors ?? data.system?.descriptors);
    if (size !== null) this.parent.updateSource({ 'prototypeToken.width': size, 'prototypeToken.height': size });
    for (const item of this.parent.items) {
      if (item.type === 'attack') seedMobAttackBase(item, this.parent);
    }
  }

  async _preUpdate(changes, options, user) {
    if ((await super._preUpdate(changes, options, user)) === false) return false;
    if (this.parent.isToken || !Object.hasOwn(changes.system ?? {}, 'descriptors')) return;
    const previous = mobTokenSize(this._source?.descriptors ?? this.descriptors);
    const next = mobTokenSize(changes.system.descriptors);
    if (next === previous) return;
    if (next !== null || previous !== null) {
      changes.prototypeToken ??= {};
      changes.prototypeToken.width ??= next ?? 1;
      changes.prototypeToken.height ??= next ?? 1;
    }
  }
}
