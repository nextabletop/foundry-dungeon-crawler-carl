import BaseItemModel from './base-item.mjs';
import { STATS, GUNNER_SLOTS } from '../../config.mjs';
import { int, str } from '../_fields.mjs';
import { effectiveAttackRank } from '../../rules/item-links.mjs';

/** Canonical offensive action. Legacy weapon/spell roll paths migrate to this model in later B4 work. */
export default class AttackModel extends BaseItemModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      stat: str('strength', { choices: STATS }),
      rank: int(0),
      die: str(),
      damageBonus: int(0),
      damageType: str(),
      range: str(),
      gunnerSlot: str('', { choices: ['', ...GUNNER_SLOTS], blank: true }),
      skillName: str(),
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.derived ??= {};
    this.derived.rank = effectiveAttackRank(this.parent, this.parent?.parent?.items);
  }
}
