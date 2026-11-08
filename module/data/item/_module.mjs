import WeaponModel from './weapon.mjs';
import SkillModel from './skill.mjs';
import SpellModel from './spell.mjs';
import GearModel from './gear.mjs';

export { default as BaseItemModel } from './base-item.mjs';
export { WeaponModel, SkillModel, SpellModel, GearModel };
export const itemModels = { weapon: WeaponModel, skill: SkillModel, spell: SpellModel, gear: GearModel };
