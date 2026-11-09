import BaseItemModel from './base-item.mjs';
import { STATS, CHECK_TYPES } from '../../config.mjs';
import { int, str, bool } from '../_fields.mjs';

export default class SkillModel extends BaseItemModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      stat: str('dexterity', { choices: STATS }),
      rank: int(0),
      mark: bool(false),
      enabled: bool(false),
      checkType: str('opposed', { choices: CHECK_TYPES }),
      opposedStat: str('', { choices: ['', ...STATS], blank: true }),
      class: str(),
    };
  }
}
