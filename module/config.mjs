export const SYSTEM_ID = 'dungeon-crawler-carl';
export const STATS = ['strength', 'intelligence', 'constitution', 'dexterity', 'charisma'];
/** Roll-data short keys for stat mods (@str .. @cha); see CreatureModel#rollShortcuts. */
export const ROLL_ABBR = { strength: 'str', intelligence: 'int', constitution: 'con', dexterity: 'dex', charisma: 'cha' };
export const GEAR_SLOTS = ['head', 'torso', 'arms', 'hands', 'legs', 'feet'];
export const ITEM_SLOTS = ['pack', ...GEAR_SLOTS];
export const CHECK_TYPES = ['opposed', 'unopposed', 'evade', 'passive'];
export const FIELD_TARGETS = [...STATS, 'damage_resistance', 'evade', 'move', 'step', 'mana'];
export const ITEM_ASPECTS = { attack: ['to_hit', 'damage'], skill: ['rank', 'mana_cost'], spell: ['rank', 'mana_cost'] };
export const GUNNER_SLOTS = ['driver', '1', '2', '3', '4'];
/** Vehicle crew roles (VehicleModel.crew[].role): one Driver (Rider on a mount), one per Gunner slot, any number of passengers. */
export const CREW_ROLES = ['driver', 'gunner1', 'gunner2', 'gunner3', 'gunner4', 'passenger'];
/** Classes for DCC windows that aren't sheets (dialogs, Configure Sheet): picks up the sheet tokens + style. */
export const APP_CLASSES = Object.freeze(['dcc', 'dcc-app']);
export const HEALTH_BAR_MAX_SLOTS = 10;
export const VEHICLE_SIZE_MAX = 8;
export const VEHICLE_CONSTITUTION_MODIFIER_DEFAULT = 5;
export const UNDO_MAX = 20;
/** Hotlist cells and Accessories list length (R20: Max 10 each). */
export const HOTLIST_CAP = 10;
export const ACCESSORY_CAP = 10;
export const RANK_CAP = 15;
export const RANK_CAP_DEEP = 20;
export const RANK_CAP_DEEP_FLOOR = 6;
/** Level Up (R20 levelUp, _skills.pug:194): the saferoom floor gate and the stat points granted. */
export const LEVEL_UP_MIN_FLOOR = 3;
export const LEVEL_UP_STAT_POINTS = 3;
/** Item types that advance at session / floor end (R20: every repeating_skills row, spells included). */
export const ADVANCING_TYPES = ['skill', 'spell'];
