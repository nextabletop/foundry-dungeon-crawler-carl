import BaseItemModel from './base-item.mjs';
import { STATS, GUNNER_SLOTS } from '../../config.mjs';
import { int, str, bool } from '../_fields.mjs';
import { effectiveAttackRank } from '../../rules/item-links.mjs';
import { mobAttackBase } from '../../rules/combat.mjs';
import { statModifier } from '../../rules/engine.mjs';

/** Seed a blank Mob attack base without changing explicit zero or None. */
export function seedMobAttackBase(attack, actor) {
  if (actor?.type !== 'mob' || attack.system?.mobToHitNone || attack.system?.mobToHitBase != null) return;
  const stat = actor.system?.stats?.[attack.system?.stat];
  const modifier = Number.isFinite(stat?.modifier) ? stat.modifier : statModifier(stat?.enhancement ?? stat?.base);
  attack.updateSource({ 'system.mobToHitBase': mobAttackBase(modifier, effectiveAttackRank(attack, actor.items)) });
}

/** Canonical offensive action, including stable-ID primary and alternate Skill uses. */
export default class AttackModel extends BaseItemModel {
  static defineSchema() {
    const { ArrayField, SchemaField } = foundry.data.fields;
    return {
      ...super.defineSchema(),
      stat: str('strength', { choices: STATS }),
      rank: int(0),
      mobToHitBase: int(null, { nullable: true }),
      mobToHitNone: bool(false),
      mobNoDamage: bool(false),
      primarySkillId: str(),
      skillUses: new ArrayField(new SchemaField({
        label: str(),
        skillId: str(),
        stat: str('', { choices: ['', ...STATS], blank: true }),
        range: str(),
      }), { required: true, nullable: false, initial: [] }),
      die: str(),
      damageBonus: int(0),
      damageType: str(),
      range: str(),
      gunnerSlot: str('', { choices: ['', ...GUNNER_SLOTS], blank: true }),
      skillName: str(),
    };
  }

  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    seedMobAttackBase(this.parent, this.parent?.parent);
  }

  async _preUpdate(changes, options, user) {
    if ((await super._preUpdate(changes, options, user)) === false) return false;
    const actor = this.parent?.parent;
    const system = changes.system;
    if (actor?.type !== 'mob' || !system || (!Object.hasOwn(system, 'mobToHitBase') && !Object.hasOwn(system, 'mobToHitNone'))) return;
    const base = Object.hasOwn(system, 'mobToHitBase') ? system.mobToHitBase : this.mobToHitBase;
    if (base != null) return;
    if (system.mobToHitNone ?? this.mobToHitNone) return;
    const stat = actor.system?.stats?.[system.stat ?? this.stat];
    const modifier = Number.isFinite(stat?.modifier) ? stat.modifier : statModifier(stat?.enhancement ?? stat?.base);
    system.mobToHitBase = mobAttackBase(modifier, effectiveAttackRank(this.parent, actor.items));
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.derived ??= {};
    this.derived.rank = effectiveAttackRank(this.parent, this.parent?.parent?.items);
  }
}
