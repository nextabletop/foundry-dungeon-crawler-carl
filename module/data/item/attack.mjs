import BaseItemModel from './base-item.mjs';
import { STATS, GUNNER_SLOTS } from '../../config.mjs';
import { int, str } from '../_fields.mjs';
import { effectiveAttackRank } from '../../rules/item-links.mjs';

/** Canonical offensive action, including stable-ID primary and alternate Skill uses. */
export default class AttackModel extends BaseItemModel {
  static defineSchema() {
    const { ArrayField, SchemaField } = foundry.data.fields;
    return {
      ...super.defineSchema(),
      stat: str('strength', { choices: STATS }),
      rank: int(0),
      primarySkillId: str(),
      skillUses: new ArrayField(new SchemaField({
        label: str(),
        skillId: str(),
        stat: str('', { choices: ['', ...STATS], blank: true }),
        range: str(),
      }), { required: true, nullable: false, initial: [] }),
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
