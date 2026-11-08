import CreatureModel from './creature.mjs';
import { int, str, bool } from '../_fields.mjs';

export default class MobModel extends CreatureModel {
  static creatureType = 'mob';

  static defineSchema() {
    return {
      ...super.defineSchema(),
      descriptors: str(),
      surprise: int(10),
      mobPublic: bool(false),
    };
  }
}
