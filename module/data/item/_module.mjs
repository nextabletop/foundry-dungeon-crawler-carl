import WeaponModel from './weapon.mjs';
import SkillModel from './skill.mjs';
import SpellModel from './spell.mjs';
import GearModel from './gear.mjs';
import AttackModel from './attack.mjs';

export { default as BaseItemModel } from './base-item.mjs';
export { WeaponModel, SkillModel, SpellModel, GearModel, AttackModel };
export const itemModels = {
  weapon: WeaponModel,
  skill: SkillModel,
  spell: SpellModel,
  gear: GearModel,
  attack: AttackModel,
};
