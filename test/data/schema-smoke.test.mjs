import { describe, it, expect } from 'vitest';
import { CHECK_TYPES, STATS } from '../../module/config.mjs';
import { CreatureModel, PcModel, MobModel, VehicleModel, GmScreenModel, actorModels } from '../../module/data/actor/_module.mjs';
import { WeaponModel, SkillModel, SpellModel, GearModel, itemModels } from '../../module/data/item/_module.mjs';
import DCCEffectModel from '../../module/data/effect/effect-model.mjs';

const keys = Model => Object.keys(Model.defineSchema());

describe('actor schemas', () => {
  it('CreatureModel has the shared creature fields', () => {
    expect(keys(CreatureModel)).toEqual(expect.arrayContaining(
      ['level', 'floor', 'stats', 'healthBar', 'healthPoints', 'armor', 'moveBase', 'stepBase', 'size', 'notes']));
  });

  it('CreatureModel stores move/step bases only, never derived move/step', () => {
    const k = keys(CreatureModel);
    expect(k).not.toContain('move');
    expect(k).not.toContain('step');
    const schema = CreatureModel.defineSchema();
    expect(schema.moveBase.initial).toBe(0);
    expect(schema.stepBase.initial).toBe(5);
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
      'race', 'pronouns', 'class', 'crawlerNumber', 'aiFavor', 'pendingLevels', 'statPoints',
      'undoStack', 'mana', 'manaStat', 'autoEnableCast', 'popularity', 'pastTrauma', 'looseEnds', 'regrets']));
    const schema = PcModel.defineSchema();
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

  it('MobModel extends creature and adds descriptors, surprise, mobPublic', () => {
    const k = keys(MobModel);
    expect(k).toEqual(expect.arrayContaining(keys(CreatureModel)));
    expect(k).toEqual(expect.arrayContaining(['descriptors', 'surprise', 'mobPublic']));
  });

  it('VehicleModel has kind, size, crew and its roll inputs', () => {
    expect(keys(VehicleModel)).toEqual(expect.arrayContaining([
      'kind', 'size', 'speed', 'speedMax', 'constitutionModifier', 'passengers', 'driveSkill', 'armor', 'floor',
      'healthBar', 'healthPoints', 'rollAdvantage', 'drivingMode', 'drivingTarget', 'ramTargetEvade', 'ramTargetLarger',
      'ramDamageDealt', 'raceAhead', 'crew', 'passengersNote', 'notes']));
    const schema = VehicleModel.defineSchema();
    expect(Object.keys(schema.crew.element.fields)).toEqual(['uuid', 'role']);
    expect(schema.constitutionModifier.options.nullable).toBe(true);
    expect(schema.constitutionModifier.options.min).toBe(1);
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
  const base = ['description', 'onHotlist'];

  it('weapon', () => {
    expect(keys(WeaponModel)).toEqual(expect.arrayContaining([...base,
      'stat', 'rank', 'skill', 'die', 'damageBonus', 'damageType', 'quantity', 'slot', 'active', 'gunnerSlot', 'skillName']));
    expect(WeaponModel.defineSchema().damageType.options.choices).toBeUndefined();
  });

  it('skill', () => {
    expect(keys(SkillModel)).toEqual(expect.arrayContaining([...base,
      'stat', 'rank', 'mark', 'enabled', 'checkType', 'opposedStat', 'class',
      'range', 'cooldown', 'limitations']));
    const schema = SkillModel.defineSchema();
    expect(schema.checkType.initial).toBe('opposed');
    expect(schema.checkType.options.choices).toEqual(Object.fromEntries(CHECK_TYPES.map(type => [type, type])));
    expect(schema.opposedStat.initial).toBe('');
    expect(schema.opposedStat.options.choices).toEqual(Object.fromEntries(['', ...STATS].map(stat => [stat, stat])));
    expect(keys(SkillModel)).not.toContain('passive');
  });

  it('spell is a skill plus manaCost, duration, and attack', () => {
    expect(keys(SpellModel)).toEqual(expect.arrayContaining([...keys(SkillModel), 'manaCost', 'duration', 'attack']));
    const { attack } = SpellModel.defineSchema();
    expect(Object.keys(attack.fields)).toEqual(['enabled', 'die', 'damageBonus', 'damageType']);
    expect(attack.fields.damageType.options.choices).toBeUndefined();
  });

  it('gear', () => {
    expect(keys(GearModel)).toEqual(expect.arrayContaining([...base, 'quantity', 'slot', 'active', 'accessory']));
  });

  it('itemModels maps the four item types', () => {
    expect(itemModels).toEqual({ weapon: WeaponModel, skill: SkillModel, spell: SpellModel, gear: GearModel });
  });
});

describe('effect model', () => {
  it('extends ActiveEffectTypeDataModel (not just TypeDataModel)', () => {
    expect(foundry.data.ActiveEffectTypeDataModel).not.toBe(foundry.abstract.TypeDataModel);
    expect(Object.getPrototypeOf(DCCEffectModel)).toBe(foundry.data.ActiveEffectTypeDataModel);
    expect(Object.keys(DCCEffectModel.defineSchema())).toEqual(['changes']);
  });
});
