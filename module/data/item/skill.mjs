import BaseItemModel from './base-item.mjs';
import { STATS, CHECK_TYPES } from '../../config.mjs';
import { int, str, bool, html } from '../_fields.mjs';

export default class SkillModel extends BaseItemModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      stat: str('dexterity', { choices: STATS }),
      rank: int(0),
      mark: bool(false),
      enabled: bool(false),
      isAttack: bool(false),
      attackDefaults: new foundry.data.fields.SchemaField({
        die: str(),
        damageStat: str('', { choices: ['', ...STATS], blank: true }),
        damageBonus: int(0),
        damageType: str(),
      }),
      checkType: str('opposed', { choices: CHECK_TYPES }),
      opposedStat: str('', { choices: ['', ...STATS], blank: true }),
      class: str(),
      range: str(),
      cooldown: str(),
      limitations: str(),
      upgrades: html(),
    };
  }
}
