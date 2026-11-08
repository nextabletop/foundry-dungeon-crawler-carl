import BaseItemModel from './base-item.mjs';
import { ITEM_SLOTS } from '../../config.mjs';
import { int, str, bool } from '../_fields.mjs';

export default class GearModel extends BaseItemModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      quantity: int(1),
      slot: str('pack', { choices: ITEM_SLOTS }),
      active: bool(false),
      accessory: bool(false),
    };
  }
}
