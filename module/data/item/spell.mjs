import SkillModel from './skill.mjs';
import { int, str } from '../_fields.mjs';

export default class SpellModel extends SkillModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      manaCost: int(0),
      duration: str(),
    };
  }
}
