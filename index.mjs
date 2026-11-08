import * as config from './module/config.mjs';
import { actorModels } from './module/data/actor/_module.mjs';
import { itemModels } from './module/data/item/_module.mjs';
import DCCEffectModel from './module/data/effect/effect-model.mjs';
import { registerDccChangeType } from './module/effects/dcc-change.mjs';
import DCCActor from './module/documents/actor.mjs';
import DCCItem from './module/documents/item.mjs';
import PcSheet from './module/applications/pc-sheet.mjs';
import MobSheet from './module/applications/mob-sheet.mjs';
import VehicleSheet from './module/applications/vehicle-sheet.mjs';
import GmScreenSheet from './module/applications/gmscreen-sheet.mjs';
import DCCItemSheet from './module/applications/item-sheet.mjs';
import DCCActiveEffectConfig from './module/applications/effect-sheet.mjs';
import { TEMPLATE as CARD_TEMPLATE } from './module/rolls/card.mjs';
import { ACTOR_PARTIALS } from './module/applications/actor-sheet-base.mjs';
import { registerCrewHooks } from './module/crew-hooks.mjs';
import { registerGmScreenSetting, registerGmScreenHooks } from './module/gm-link.mjs';

Hooks.once('init', () => {
  CONFIG.DCC = { ...config };
  CONFIG.Actor.documentClass = DCCActor;
  CONFIG.Item.documentClass = DCCItem;
  Object.assign(CONFIG.Actor.dataModels, actorModels);
  Object.assign(CONFIG.Item.dataModels, itemModels);
  CONFIG.ActiveEffect.dataModels.base = DCCEffectModel;
  registerDccChangeType();
  CONFIG.Combat.initiative = { formula: '1d20 + @stats.dexterity.modifier', decimals: 0 }; // TODO(rules): R20 sheet has no initiative; DEX mod is an assumption
  const { DocumentSheetConfig } = foundry.applications.apps;
  const id = config.SYSTEM_ID;
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, PcSheet, { types: ['pc'], makeDefault: true, label: 'DCC.Sheet.pc' });
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, MobSheet, { types: ['mob'], makeDefault: true, label: 'DCC.Sheet.mob' });
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, VehicleSheet, { types: ['vehicle'], makeDefault: true, label: 'DCC.Sheet.vehicle' });
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, id, GmScreenSheet, { types: ['gmscreen'], makeDefault: true, label: 'DCC.Sheet.gmscreen' });
  DocumentSheetConfig.registerSheet(foundry.documents.Item, id, DCCItemSheet, { makeDefault: true, label: 'DCC.Sheet.item' });
  DocumentSheetConfig.registerSheet(foundry.documents.ActiveEffect, id, DCCActiveEffectConfig, { makeDefault: true, label: 'DCC.Sheet.effect' });
  // Shared actor partials are preloaded once here (and still listed in each PARTS entry's templates).
  foundry.applications.handlebars.loadTemplates([CARD_TEMPLATE, ...Object.values(ACTOR_PARTIALS)]);
  registerCrewHooks();
  registerGmScreenSetting();
  registerGmScreenHooks();
});
