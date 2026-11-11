import { describe, it, expect } from 'vitest';
import { CHECK_TYPES, STATS } from '../../module/config.mjs';
import { CreatureModel, PcModel, MobModel, VehicleModel, GmScreenModel, actorModels } from '../../module/data/actor/_module.mjs';
import {
  WeaponModel, SkillModel, SpellModel, GearModel, AttackModel, itemModels,
} from '../../module/data/item/_module.mjs';
import DCCEffectModel from '../../module/data/effect/effect-model.mjs';

const keys = Model => Object.keys(Model.defineSchema());

describe('actor schemas', () => {
  it('CreatureModel has the shared creature fields', () => {
    expect(keys(CreatureModel)).toEqual(expect.arrayContaining(
      ['level', 'floor', 'stats', 'healthBar', 'healthBarSlotsCustom', 'healthPoints', 'armor', 'moveBase', 'stepBase', 'size',
        'showRangeInChat', 'showNotesInChat', 'notes']));
  });

  it('CreatureModel stores move/step bases only, never derived move/step', () => {
    const k = keys(CreatureModel);
    expect(k).not.toContain('move');
    expect(k).not.toContain('step');
    const schema = CreatureModel.defineSchema();
    expect(schema.moveBase.initial).toBe(20);
    expect(schema.stepBase.initial).toBe(10);
  });

  it('PCs and Mobs inherit the current move and step defaults', () => {
    for (const model of [PcModel, MobModel]) {
      const schema = model.defineSchema();
      expect(schema.moveBase.initial).toBe(20);
      expect(schema.stepBase.initial).toBe(10);
    }
  });

  it('PCs and Mobs have a nullable custom Health Bar count bounded to 1–100', () => {
    for (const model of [PcModel, MobModel]) {
      const field = model.defineSchema().healthBarSlotsCustom;
      expect(field.initial).toBeNull();
      expect(field.options).toMatchObject({ nullable: true, integer: true, min: 1, max: 100 });
    }
    expect(keys(VehicleModel)).not.toContain('healthBarSlotsCustom');
  });

  it('stats has exactly the 5 STATS, each with base initial 1', () => {
    const { stats } = CreatureModel.defineSchema();
    expect(Object.keys(stats.fields)).toEqual(STATS);
    for (const s of STATS) expect(stats.fields[s].fields.base.initial).toBe(1);
  });

  it('PcModel extends creature and adds mana, manaStat, undoStack', () => {
    const k = keys(PcModel);
    expect(k).toEqual(expect.arrayContaining(keys(CreatureModel)));
    expect(k).toEqual(expect.arrayContaining([
      'race', 'pronouns', 'class', 'crawlerNumber', 'aiFavor', 'pcCombatEdit', 'pcAbilitiesEdit', 'pendingLevels', 'statPoints',
      'undoStack', 'mana', 'manaStat', 'autoEnableCast', 'popularity', 'pastTrauma', 'looseEnds', 'regrets']));
    const schema = PcModel.defineSchema();
    expect(schema.pcCombatEdit).toBeInstanceOf(foundry.data.fields.BooleanField);
    expect(schema.pcCombatEdit.initial).toBe(false);
    expect(schema.pcAbilitiesEdit).toBeInstanceOf(foundry.data.fields.BooleanField);
    expect(schema.pcAbilitiesEdit.initial).toBe(false);
    expect(schema.manaStat.initial).toBe('intelligence');
    // Choice arrays become value→value records so <select> option values are the strings, not indices.
    expect(schema.manaStat.options.choices).toEqual(Object.fromEntries(STATS.map(s => [s, s])));
    expect(schema.undoStack.initial).toEqual([]);
  });

  it('PcModel has the floor-end cursor fields, integers defaulting to 0', () => {
    const schema = PcModel.defineSchema();
    for (const f of ['floorEndDone', 'floorEndEpoch']) {
      expect(schema[f]).toBeInstanceOf(foundry.data.fields.NumberField);
      expect(schema[f].initial).toBe(0);
      expect(schema[f].options.integer).toBe(true);
      expect(schema[f].options.min).toBe(0);
    }
  });

  it('MobModel extends creature and defaults Mob whispers off', () => {
    const k = keys(MobModel);
    expect(k).toEqual(expect.arrayContaining(keys(CreatureModel)));
    expect(k).toEqual(expect.arrayContaining(['descriptors', 'surprise', 'mobEvadeBase', 'mana', 'mobCombatEdit', 'mobAbilitiesEdit', 'mobWhisper']));
    expect(k).not.toContain('mobPublic');
    expect(MobModel.defineSchema().mobWhisper.initial).toBe(false);
    expect(MobModel.defineSchema().mobCombatEdit.initial).toBe(false);
    expect(MobModel.defineSchema().mobAbilitiesEdit.initial).toBe(false);
    expect(keys(PcModel)).not.toContain('mobAbilitiesEdit');
    expect(MobModel.defineSchema().mobEvadeBase.initial).toBe(10);
  });

  it('optional Mob sections default hidden and are not added to PCs or Vehicles', () => {
    const mob = MobModel.defineSchema();
    for (const field of ['mobShowInventory', 'mobShowSkills', 'mobShowBuffs']) {
      expect(mob[field]).toBeInstanceOf(foundry.data.fields.BooleanField);
      expect(mob[field].initial).toBe(false);
      expect(keys(PcModel)).not.toContain(field);
      expect(keys(VehicleModel)).not.toContain(field);
    }
  });

  it('VehicleModel has kind, size, crew and its roll inputs', () => {
    expect(keys(VehicleModel)).toEqual(expect.arrayContaining([
      'kind', 'size', 'speed', 'speedMax', 'constitutionModifier', 'passengers', 'driveSkill', 'armor', 'floor',
      'healthBar', 'healthPoints', 'rollAdvantage', 'drivingMode', 'drivingTarget', 'ramTargetEvade', 'ramTargetLarger',
      'ramDamageDealt', 'raceAhead', 'crew', 'passengersNote', 'notes']));
    const schema = VehicleModel.defineSchema();
    expect(Object.keys(schema.crew.element.fields)).toEqual(['uuid', 'role']);
    expect(schema.constitutionModifier.options.nullable).toBe(true);
    expect(schema.constitutionModifier.options.min).toBe(0);
    expect(schema.constitutionModifier.initial).toBe(5);
  });

  it('chat extra settings default on for PCs, Mobs, and Vehicles', () => {
    for (const model of [PcModel, MobModel, VehicleModel]) {
      expect(model.defineSchema().showRangeInChat.initial).toBe(true);
      expect(model.defineSchema().showNotesInChat.initial).toBe(true);
    }
  });

  it('GmScreenModel has exactly safehouse, floorEndSeq and a UUID roster', () => {
    expect(keys(GmScreenModel)).toEqual(['safehouse', 'floorEndSeq', 'roster']);
    const schema = GmScreenModel.defineSchema();
    expect(schema.roster.element).toBeInstanceOf(foundry.data.fields.DocumentUUIDField);
    expect(schema.roster.element.options).toEqual({ type: 'Actor', embedded: false });
    expect(schema.roster.initial).toEqual([]);
    expect(schema.floorEndSeq.initial).toBe(0);
    expect(schema.floorEndSeq.options.min).toBe(0);
    expect(schema.safehouse.initial).toBe(false);
  });

  it('actorModels maps the four actor types', () => {
    expect(actorModels).toEqual({ pc: PcModel, mob: MobModel, vehicle: VehicleModel, gmscreen: GmScreenModel });
  });
});

describe('item schemas', () => {
  const base = ['description', 'onHotlist', 'linkedItemIds'];

  it('weapon', () => {
    expect(keys(WeaponModel)).toEqual([...base, 'quantity', 'slot', 'active']);
  });

  it('skill', () => {
    expect(keys(SkillModel)).toEqual(expect.arrayContaining([...base,
      'stat', 'rank', 'mark', 'enabled', 'isAttack', 'checkType', 'opposedStat', 'class',
      'range', 'cooldown', 'limitations', 'upgrades']));
    const schema = SkillModel.defineSchema();
    expect(schema.upgrades).toBeInstanceOf(foundry.data.fields.HTMLField);
    expect(schema.checkType.initial).toBe('opposed');
    expect(schema.checkType.options.choices).toEqual(Object.fromEntries(CHECK_TYPES.map(type => [type, type])));
    expect(schema.opposedStat.initial).toBe('');
    expect(schema.opposedStat.options.choices).toEqual(Object.fromEntries(['', ...STATS].map(stat => [stat, stat])));
    expect(keys(SkillModel)).not.toContain('passive');
  });

  it('spell is a skill plus manaCost and duration, without embedded attack data', () => {
    expect(keys(SpellModel)).toEqual([...keys(SkillModel), 'manaCost', 'duration']);
  });

  it('gear', () => {
    expect(keys(GearModel)).toEqual(expect.arrayContaining([...base, 'quantity', 'slot', 'active', 'accessory']));
  });

  it('attack is the canonical offensive-action record', () => {
    expect(keys(AttackModel)).toEqual([
      ...base, 'stat', 'rank', 'mobToHitBase', 'mobToHitNone', 'mobNoDamage', 'primarySkillId', 'skillUses',
      'die', 'damageStat', 'damageBonus', 'damageType', 'range', 'gunnerSlot', 'skillName',
    ]);
    const schema = AttackModel.defineSchema();
    expect(schema.linkedItemIds.initial).toEqual([]);
    expect(schema.primarySkillId.initial).toBe('');
    expect(schema.mobToHitBase.initial).toBeNull();
    expect(schema.mobToHitNone.initial).toBe(false);
    expect(schema.mobNoDamage).toBeInstanceOf(foundry.data.fields.BooleanField);
    expect(schema.mobNoDamage.initial).toBe(false);
    expect(schema.stat.initial).toBe('strength');
    expect(schema.stat.options.choices)
      .toEqual(Object.fromEntries(['', ...STATS].map(stat => [stat, stat])));
    expect(schema.damageStat.initial).toBe('');
    expect(schema.damageStat.options.choices)
      .toEqual(Object.fromEntries(['', ...STATS].map(stat => [stat, stat])));
    expect(schema.skillUses.initial).toEqual([]);
    expect(schema.skillUses.element.fields).toHaveProperty('skillId');
    expect(schema.skillUses.element.fields.stat.options.choices)
      .toEqual(Object.fromEntries(['', ...STATS].map(stat => [stat, stat])));
  });

  it('itemModels maps all five item types', () => {
    expect(itemModels).toEqual({
      weapon: WeaponModel,
      skill: SkillModel,
      spell: SpellModel,
      gear: GearModel,
      attack: AttackModel,
    });
  });
});

describe('effect model', () => {
  it('extends ActiveEffectTypeDataModel (not just TypeDataModel)', () => {
    expect(foundry.data.ActiveEffectTypeDataModel).not.toBe(foundry.abstract.TypeDataModel);
    expect(Object.getPrototypeOf(DCCEffectModel)).toBe(foundry.data.ActiveEffectTypeDataModel);
    expect(Object.keys(DCCEffectModel.defineSchema())).toEqual(['changes']);
  });
});
