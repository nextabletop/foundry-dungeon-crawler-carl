// The single ordered recompute authority: R20 `recalcAll`
// (character-sheet/source/javascript/_engine.js:313-442) re-expressed over
// plain data. No Foundry globals — see foundry/module/rules/ conventions.
//
// Not ported here (Foundry handles them elsewhere): the bonus_aggregate
// persistence, the whisper prefix
// (engine.whisperToGM), the display labels (the view layer formats
// toHit/skillBonus), and the crew push/refresh (rules/crew.mjs).

import { STATS, VEHICLE_SIZE_MAX, VEHICLE_CONSTITUTION_MODIFIER_DEFAULT } from '../config.mjs';
import { statModifier, applyModifiers, healthBarSlotsFor } from './engine.mjs';
import { resolveModifiers } from './modifiers.mjs';
import { clampSlots, healthPointsFromHealthBar, maxHealthPointsFromConstitution } from './health.mjs';
import { attackToHit, damageLabel, mobToHit, mobEvade } from './combat.mjs';
import { vehicleMove, cruiseMph } from './vehicle.mjs';
import { idOf, isPassiveCheck } from './items.mjs';
import { attackPrimarySkill } from './item-links.mjs';

// Entry sanitation. Accept any iterable (arrays, Sets, and Foundry's
// EmbeddedCollection, which extends Map — for a Map, take its values, since
// Array.from(map) yields [key, value] pairs). Non-iterables become [].
export const toList = (v) => {
  if (v instanceof Map) return Array.from(v.values());
  return v != null && typeof v[Symbol.iterator] === 'function' ? Array.from(v) : [];
};
// Drop non-object modifiers (null, or the chars of a string) and items with no id.
const cleanModifiers = (modifiers) => toList(modifiers).filter((m) => m && typeof m === 'object');
const cleanItems = (items) => toList(items).filter((it) => it && idOf(it) != null);
const itemById = items => new Map(items.map(item => [idOf(item), item]));

// One attack row's materialized values (_engine.js:379-395).
// `rank` is the rank the attack used (a linked skill's base rank, else its own).
// `itemBonus`/`itemPercent` are this item's resolveModifiers buckets, keyed by
// the modifier aspect vocabulary (`to_hit`, `damage`); the output is camelCase.
const attackRow = ({
  statModifier, damageStatModifier = 0, rank, itemBonus, itemPercent, damageModifierDice, die, damageBonus, damageType, floor,
  hasToHit = true, mob = false, mobToHitBase, mobToHitNone = false, mobNoDamage = false,
}) => {
  const base = mob && mobToHitBase != null ? mobToHitBase - 10 : attackToHit(statModifier, rank, 0);
  const toHit = hasToHit
    ? (mob && mobToHitNone ? 0 : applyModifiers(base, itemBonus.to_hit || 0, itemPercent.to_hit || 0))
    : null;
  const damageBase = (+damageStatModifier || 0) + (+damageBonus || 0) + (itemBonus.damage || 0); // damage stays flat
  const noDamageDie = /^(none|no damage|-|—)?$/i.test(String(die ?? '').trim());
  const baseDie = noDamageDie ? '' : (die || '');
  const damageDice = `${baseDie}${damageModifierDice || ''}`;
  const noDamage = (mob && mobNoDamage) || (noDamageDie && damageBase === 0 && !damageModifierDice);
  return {
    rank, hasToHit, toHit, damageBase, damageModifierDice, damageDice, noDamage,
    damageLabel: noDamage ? '' : damageLabel(damageDice, damageBase, damageType),
    mobToHit: mob && mobToHitNone ? null : mobToHit(toHit, floor),
    mobToHitNone: mob && mobToHitNone,
  };
};

// Per-item derived values for a creature (_engine.js:369-417). Returns null for
// item types with nothing to derive (e.g. gear).
const deriveItemRow = (item, context) => {
  const { modifierFor, itemBonuses, itemPercents, itemDice, items, floor, type } = context;
  const id = idOf(item);
  const sys = item.system || {};
  const itemBonus = itemBonuses[id] || {};
  const itemPercent = itemPercents[id] || {};
  const row = {};

  if (item.type === 'skill' || item.type === 'spell') {
    row.rankEffective = applyModifiers(+sys.rank || 0, itemBonus.rank || 0, itemPercent.rank || 0);
    row.skillBonus = (isPassiveCheck(sys) ? 0 : modifierFor(sys.stat)) + row.rankEffective;
    if (item.type === 'spell') {
      row.manaCostEffective = applyModifiers(+sys.manaCost || 0, itemBonus.mana_cost || 0, itemPercent.mana_cost || 0);
    }
  }

  if (item.type === 'attack') {
    const primarySkill = attackPrimarySkill(item, items);
    const primaryId = idOf(primarySkill ?? {});
    const rank = primarySkill
      ? applyModifiers(+primarySkill.system?.rank || 0, itemBonuses[primaryId]?.rank || 0, itemPercents[primaryId]?.rank || 0)
      : (sys.primarySkillId ? 0 : (+sys.rank || 0));
    Object.assign(row, attackRow({
      statModifier: modifierFor(sys.stat), rank, itemBonus, itemPercent,
      hasToHit: type !== 'pc' || sys.stat !== '',
      damageStatModifier: type === 'pc' && STATS.includes(sys.damageStat) ? modifierFor(sys.damageStat) : 0,
      damageModifierDice: itemDice[id]?.damage || '',
      die: sys.die, damageBonus: sys.damageBonus, damageType: sys.damageType, floor,
      mob: type === 'mob', mobToHitBase: sys.mobToHitBase, mobToHitNone: sys.mobToHitNone, mobNoDamage: sys.mobNoDamage,
    }));
    const byId = itemById(items);
    row.primarySkillId = primaryId || sys.primarySkillId || '';
    row.primarySkillName = primarySkill?.name ?? '';
    row.primarySkillMissing = Boolean(sys.primarySkillId && !primarySkill);
    row.skillUses = (Array.isArray(sys.skillUses) ? sys.skillUses : []).map((use, index) => {
      const candidate = byId.get(use.skillId);
      const skill = ['skill', 'spell'].includes(candidate?.type) ? candidate : null;
      const skillId = idOf(skill ?? {});
      const useRank = skill
        ? applyModifiers(+skill.system?.rank || 0, itemBonuses[skillId]?.rank || 0, itemPercents[skillId]?.rank || 0)
        : 0;
      const useStat = STATS.includes(use.stat) ? use.stat : sys.stat;
      const derived = attackRow({
        statModifier: modifierFor(useStat), rank: useRank, itemBonus, itemPercent,
        hasToHit: type !== 'pc' || useStat !== '',
        damageStatModifier: type === 'pc' && STATS.includes(sys.damageStat) ? modifierFor(sys.damageStat) : 0,
        damageModifierDice: itemDice[id]?.damage || '',
        die: sys.die, damageBonus: sys.damageBonus, damageType: sys.damageType, floor,
        mob: type === 'mob', mobToHitBase: sys.mobToHitBase, mobToHitNone: sys.mobToHitNone, mobNoDamage: sys.mobNoDamage,
      });
      return {
        index,
        label: String(use.label ?? '').trim(),
        skillId: String(use.skillId ?? ''),
        skillName: skill?.name ?? '',
        missing: Boolean(use.skillId && !skill),
        stat: useStat,
        range: String(use.range ?? '').trim() || String(sys.range ?? '').trim(),
        ...derived,
      };
    });
  }

  return Object.keys(row).length ? row : null;
};

/**
 * Derive every computed value of a creature (pc or mob) — the recalcAll port.
 * Tolerates missing/garbage input: unknown numbers read as 0, an unknown
 * `manaStat` as 'intelligence', an unknown item stat as stat mod 0.
 * @param {object} [input]
 * @param {'pc'|'mob'} input.type
 * @param {number} input.level
 * @param {number} input.floor
 * @param {number} input.healthBar - stored health, in slots
 * @param {number|null} [input.healthBarSlotsCustom] - optional PC/Mob slot count
 * @param {number} input.armor - DR base
 * @param {number} input.moveBase
 * @param {number} input.stepBase
 * @param {number|null} [input.surpriseBase] - Mob Surprise base; blank defaults to 10
 * @param {number|null} [input.mobEvadeBase] - Mob Evade base; blank defaults to 10
 * @param {Record<string,{base:number}>} input.stats
 * @param {string} [input.manaStat] - defaults to 'intelligence'
 * @param {Iterable<{target:string, value:string}>} input.modifiers - collected from active effects
 * @param {Iterable<{id:string, type:string, name:string, system:object}>} input.items - any iterable (a Map yields its values); items without an id are ignored
 * @returns {{
 *   stats: Record<string,{base:number, enhancement:number, modifier:number}>,
 *   healthBarSlots: number, healthBar: number, healthPoints: {value:number, max:number},
 *   manaMax: number, evade: number, damageResistance: number, move: number, step: number,
 *   moveBonus: number, stepBonus: number, evadeBonus: number, evadeDice: string,
 *   evadeBuffLabel: string, evadeRollLabel: string, damageResistanceBonus: number,
 *   mobEvade: number, mobSurprise: number, mobMove: number,
 *   items: Record<string, {rank?:number, toHit?:number, damageBase?:number, damageLabel?:string, mobToHit?:number,
 *                          skillBonus?:number, rankEffective?:number, manaCostEffective?:number}>,
 *   unresolved: Array<{target:string, reason:string, modifier:object}>
 * }}
 * - `healthBar` is a DISPLAY clamp to [0, healthBarSlots]; do not write it back to source data.
 * - `items` holds only Attack/Skill/Spell entries; consumers should read
 *   `derived = d.items[id] ?? {}`.
 * - Values are numbers; display labels (sign prefix etc.) are the view layer's job.
 *   `damageLabel` is the one pre-assembled string, as in R20.
 */
export const deriveCreature = (input = {}) => {
  const items = cleanItems(input.items);
  const floor = +input.floor || 0;

  // Resolve modifiers into field and per-item flat/percent buckets.
  const {
    bonus, percent, dice, itemBonus, itemPercent, itemDice, unresolved,
  } = resolveModifiers(cleanModifiers(input.modifiers), items);

  // Stats: base -> enhanced -> stat modifier.
  const stats = {};
  const modifierByStat = {};
  for (const s of STATS) {
    const base = +input.stats?.[s]?.base || 0;
    const enhancement = applyModifiers(base, bonus[s] || 0, percent[s] || 0);
    modifierByStat[s] = statModifier(enhancement);
    stats[s] = { base, enhancement, modifier: modifierByStat[s] };
  }
  const modifierFor = (stat) => (STATS.includes(stat) ? modifierByStat[stat] : 0);

  // Health Bar: slot count by type, healthBar clamped, healthPoints mirrors
  // healthBar x Con Mod.
  const healthBarSlots = healthBarSlotsFor(input.type, input.level, undefined, input.healthBarSlotsCustom);
  const healthBar = clampSlots(+input.healthBar || 0, healthBarSlots);
  const constitutionModifier = modifierByStat.constitution;
  const healthPoints = {
    value: healthPointsFromHealthBar(healthBar, constitutionModifier),
    max: maxHealthPointsFromConstitution(constitutionModifier, healthBarSlots),
  };

  // Mana and defenses.
  const manaStat = STATS.includes(input.manaStat) ? input.manaStat : 'intelligence';
  const manaMax = applyModifiers(stats[manaStat].enhancement, bonus.mana || 0, percent.mana || 0);
  const evadeBase = modifierByStat.dexterity;
  const evade = applyModifiers(evadeBase, bonus.evade || 0, percent.evade || 0);
  const evadeBonus = evade - evadeBase;
  const evadeDice = dice.evade || '';
  const evadeBuffLabel = evadeBonus ? `${evadeBonus}${evadeDice}` : (evadeDice.replace(/^\+/, '') || '0');
  const evadeRollLabel = `${evade >= 0 ? '+' : ''}${evade}${evadeDice}`;
  const damageResistance = applyModifiers(+input.armor || 0, bonus.damage_resistance || 0, percent.damage_resistance || 0);
  const move = applyModifiers(+input.moveBase || 0, bonus.move || 0, percent.move || 0);
  const step = applyModifiers(+input.stepBase || 0, bonus.step || 0, percent.step || 0);
  const mobBase = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? 10 : Number(value);
  const mobEvadeBase = mobBase(input.mobEvadeBase);

  // Per-item values: skills/spells, then canonical Attacks.
  const context = {
    modifierFor, itemBonuses: itemBonus, itemPercents: itemPercent, itemDice, items, floor, type: input.type,
  };
  const itemsOut = {};
  for (const item of items) {
    const row = deriveItemRow(item, context);
    if (row) itemsOut[idOf(item)] = row;
  }

  return {
    stats, healthBarSlots, healthBar, healthPoints, manaMax, evade, damageResistance, move, step,
    moveBonus: move - (+input.moveBase || 0),
    stepBonus: step - (+input.stepBase || 0),
    evadeBonus, evadeDice, evadeBuffLabel, evadeRollLabel,
    damageResistanceBonus: bonus.damage_resistance || 0,
    // Mob static targets.
    mobEvade: mobEvade(applyModifiers(mobEvadeBase, bonus.evade || 0, percent.evade || 0), floor),
    mobSurprise: mobBase(input.surpriseBase) + floor,
    mobMove: move + step,
    items: itemsOut,
    unresolved,
  };
};

/**
 * Derive every computed value of a vehicle or mount (R20 vehicle mode).
 * `size` is truncated to an integer (Math.trunc) and clamped to
 * 1..VEHICLE_SIZE_MAX; a non-numeric size becomes 1.
 * @param {object} [input]
 * @param {'vehicle'|'mount'} input.kind
 * @param {number} input.size
 * @param {number} input.speed
 * @param {number|null|''} input.constitutionModifier - null/undefined/'' means VEHICLE_CONSTITUTION_MODIFIER_DEFAULT
 * @param {number} input.armor
 * @param {number} input.healthBar
 * @param {Iterable<{target:string, value:string}>} input.modifiers
 * @param {Iterable<{id:string, type:string, name:string, system:object}>} input.items - any iterable (a Map yields its values); items without an id are ignored
 * @returns {{
 *   size: number, constitutionModifierEffective: number, healthBarSlots: number, healthBar: number,
 *   healthPoints: {value:number, max:number}, damageResistance: number, damageResistanceBonus: number, move: number, step?: number, cruise: number, penalty: number,
 *   items: Record<string, {toHit:number, damageBase:number, damageLabel:string}>,
 *   unresolved: Array<{target:string, reason:string, modifier:object}>
 * }}
 * - `healthBar` is a DISPLAY clamp to [0, healthBarSlots]; do not write it back to source data.
 * - `constitutionModifierEffective` is the input `constitutionModifier` with the default applied.
 * - `items` holds only Attack entries; consumers should read `d.items[id] ?? {}`.
 * - `step` is present only for a mount.
 */
export const deriveVehicle = (input = {}) => {
  const items = cleanItems(input.items);
  const {
    bonus, percent, itemBonus, itemPercent, itemDice, unresolved,
  } = resolveModifiers(cleanModifiers(input.modifiers), items);

  const size = Math.max(1, Math.min(VEHICLE_SIZE_MAX, Math.trunc(+input.size || 0)));
  const rawConstitutionModifier = input.constitutionModifier;
  const constitutionModifierEffective = rawConstitutionModifier === null || rawConstitutionModifier === undefined || rawConstitutionModifier === ''
    ? VEHICLE_CONSTITUTION_MODIFIER_DEFAULT
    : (+rawConstitutionModifier || 0);
  const healthBarSlots = healthBarSlotsFor('vehicle', 0, size);
  const healthBar = clampSlots(+input.healthBar || 0, healthBarSlots);
  const healthPoints = {
    value: healthPointsFromHealthBar(healthBar, constitutionModifierEffective),
    max: maxHealthPointsFromConstitution(constitutionModifierEffective, healthBarSlots),
  };
  const damageResistance = applyModifiers(+input.armor || 0, bonus.damage_resistance || 0, percent.damage_resistance || 0);
  const speed = +input.speed || 0;

  // Vehicle attacks have no ability mod: to-hit is rank + vehicle-side mods;
  // the gunner's skill bonus is added at roll time (_engine.js:376-381).
  const itemsOut = {};
  for (const item of items) {
    if (item.type !== 'attack') continue;
    const id = idOf(item);
    const sys = item.system || {};
    const row = attackRow({
      statModifier: 0, rank: +sys.rank || 0, itemBonus: itemBonus[id] || {}, itemPercent: itemPercent[id] || {},
      damageModifierDice: itemDice[id]?.damage || '',
      die: sys.die, damageBonus: sys.damageBonus, damageType: sys.damageType, floor: 0,
    });
    itemsOut[id] = {
      toHit: row.toHit,
      damageBase: row.damageBase,
      damageModifierDice: row.damageModifierDice,
      damageDice: row.damageDice,
      noDamage: row.noDamage,
      damageLabel: row.damageLabel,
    };
  }

  const result = {
    size, constitutionModifierEffective, healthBarSlots, healthBar, healthPoints, damageResistance,
    damageResistanceBonus: bonus.damage_resistance || 0,
    move: vehicleMove(speed),
    cruise: cruiseMph(speed),
    penalty: 0 - speed, // not -speed: avoids -0 at speed 0
    items: itemsOut,
    unresolved,
  };
  if (input.kind === 'mount') result.step = 10;
  return result;
};
