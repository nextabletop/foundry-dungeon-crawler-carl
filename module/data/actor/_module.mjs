import PcModel from './pc.mjs';
import MobModel from './mob.mjs';
import VehicleModel from './vehicle.mjs';
import GmScreenModel from './gmscreen.mjs';

export { default as CreatureModel } from './creature.mjs';
export { PcModel, MobModel, VehicleModel, GmScreenModel };
export const actorModels = { pc: PcModel, mob: MobModel, vehicle: VehicleModel, gmscreen: GmScreenModel };
