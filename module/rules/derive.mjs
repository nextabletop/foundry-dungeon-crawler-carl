// The single ordered recompute authority: R20 `recalcAll`
// (character-sheet/source/javascript/_engine.js:313-442) re-expressed over
// plain data. No Foundry globals — see foundry/module/rules/ conventions.
//
// Not ported here (Foundry handles them elsewhere): the bonus_aggregate
// persistence, the move/step back-calc on edit (the caller uses
// `moveBonus`/`stepBonus` with engine.backCalcBase), the whisper prefix
// (engine.whisperToGM), the display labels (the view layer formats
// toHit/skillBonus), and the crew push/refresh (rules/crew.mjs).

import { STATS, VEHICLE_SIZE_MAX, VEHICLE_CONSTITUTION_MODIFIER_DEFAULT } from '../config.mjs';
import { statModifier, applyModifiers, healthBarSlotsFor } from './engine.mjs';
import { resolveModifiers } from './modifiers.mjs';
import { clampSlots, healthPointsFromHealthBar, maxHealthPointsFromConstitution } from './health.mjs';
import { attackToHit, damageLabel, mobToHit, mobEvade } from './combat.mjs';
import { vehicleMove, cruiseMph } from './vehicle.mjs';
import { idOf, isAttackSpell, isPassiveCheck, normName } from './items.mjs';

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

// name -> skill (or spell: R20 spells are skill rows) for weapon linking.
// First match in list order wins.
const skillsByName = (items) => {
  const map = new Map();
  for (const it of items) {
    if (it.type !== 'skill' && it.type !== 'spell') continue;
    const key = normName(it.name);
    if (key && !map.has(key)) map.set(key, it);
  }
  return map;
};

// One attack row's materialized values (_engine.js:379-395).
// `rank` is the rank the attack used (a linked skill's base rank, else its own).
// `itemBonus`/`itemPercent` are this item's resolveModifiers buckets, keyed by
// the modifier aspect vocabulary (`to_hit`, `damage`); the output is camelCase.
const attackRow = ({ statModifier, rank, itemBonus, itemPercent, die, damageBonus, damageType, floor }) => {
  const toHit = applyModifiers(attackToHit(statModifier, rank, 0), itemBonus.to_hit || 0, itemPercent.to_hit || 0);
  const damageBase = (+damageBonus || 0) + (itemBonus.damage || 0); // damage stays flat
  return { rank, toHit, damageBase, damageLabel: damageLabel(die, damageBase, damageType), mobToHit: mobToHit(toHit, floor) };
};

// Per-item derived values for a creature (_engine.js:369-417). Returns null for
// item types with nothing to derive (e.g. gear).
const deriveItemRow = (item, context) => {
  const { modifierFor, itemBonuses, itemPercents, skills, floor } = context;
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

  if (item.type === 'weapon') {
    // A linked skill's BASE rank replaces the weapon's (R20 syncs the base).
    const linked = skills.get(normName(sys.skill));
    const rank = linked ? (+linked.system?.rank || 0) : (+sys.rank || 0);
    Object.assign(row, attackRow({
      statModifier: modifierFor(sys.stat), rank, itemBonus, itemPercent,
      die: sys.die, damageBonus: sys.damageBonus, damageType: sys.damageType, floor,
    }));
  } else if (isAttackSpell(item)) {
    const attack = sys.attack;
    Object.assign(row, attackRow({
      statModifier: modifierFor(sys.stat), rank: +sys.rank || 0, itemBonus, itemPercent,
      die: attack.die, damageBonus: attack.damageBonus, damageType: attack.damageType, floor,
    }));
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
 * @param {number} input.armor - DR base
 * @param {number} input.moveBase
 * @param {number} input.stepBase
 * @param {Record<string,{base:number}>} input.stats
 * @param {string} [input.manaStat] - defaults to 'intelligence'
 * @param {Iterable<{target:string, value:string}>} input.modifiers - collected from active effects
 * @param {Iterable<{id:string, type:string, name:string, system:object}>} input.items - any iterable (a Map yields its values); items without an id are ignored
 * @returns {{
 *   stats: Record<string,{base:number, enhancement:number, modifier:number}>,
 *   healthBarSlots: number, healthBar: number, healthPoints: {value:number, max:number},
 *   manaMax: number, evade: number, damageResistance: number, move: number, step: number,
 *   moveBonus: number, stepBonus: number, evadeBonus: number, damageResistanceBonus: number,
 *   mobToHit: number, mobEvade: number,
 *   items: Record<string, {rank?:number, toHit?:number, damageBase?:number, damageLabel?:string, mobToHit?:number,
 *                          skillBonus?:number, rankEffective?:number, manaCostEffective?:number}>,
 *   unresolved: Array<{target:string, reason:string, modifier:object}>
 * }}
 * - `healthBar` is a DISPLAY clamp to [0, healthBarSlots]; do not write it back to source data.
 * - `items` holds only weapon/skill/spell entries; consumers should read
 *   `derived = d.items[id] ?? {}`.
 * - Values are numbers; display labels (sign prefix etc.) are the view layer's job.
 *   `damageLabel` is the one pre-assembled string, as in R20.
 */
export const deriveCreature = (input = {}) => {
  const items = cleanItems(input.items);
  const floor = +input.floor || 0;

  // Resolve modifiers into field and per-item flat/percent buckets.
  const { bonus, percent, itemBonus, itemPercent, unresolved } = resolveModifiers(cleanModifiers(input.modifiers), items);

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
  const healthBarSlots = healthBarSlotsFor(input.type, input.level);
  const healthBar = clampSlots(+input.healthBar || 0, healthBarSlots);
  const constitutionModifier = modifierByStat.constitution;
  const healthPoints = {
    value: healthPointsFromHealthBar(healthBar, constitutionModifier),
    max: maxHealthPointsFromConstitution(constitutionModifier, healthBarSlots),
  };

  // Mana and defenses.
  const manaStat = STATS.includes(input.manaStat) ? input.manaStat : 'intelligence';
  const manaMax = applyModifiers(stats[manaStat].enhancement, bonus.mana || 0, percent.mana || 0);
  const evade = applyModifiers(10 + modifierByStat.dexterity, bonus.evade || 0, percent.evade || 0);
  const damageResistance = applyModifiers(+input.armor || 0, bonus.damage_resistance || 0, percent.damage_resistance || 0);
  const move = applyModifiers(+input.moveBase || 0, bonus.move || 0, percent.move || 0);
  const step = applyModifiers(+input.stepBase || 0, bonus.step || 0, percent.step || 0);

  // Per-item values: skills/spells, then weapons and attack spells.
  const context = { modifierFor, itemBonuses: itemBonus, itemPercents: itemPercent, skills: skillsByName(items), floor };
  const itemsOut = {};
  for (const item of items) {
    const row = deriveItemRow(item, context);
    if (row) itemsOut[idOf(item)] = row;
  }

  return {
    stats, healthBarSlots, healthBar, healthPoints, manaMax, evade, damageResistance, move, step,
    // Flat bonuses: backCalcBase on move/step edits, formula-box breakdowns.
    moveBonus: bonus.move || 0,
    stepBonus: bonus.step || 0,
    evadeBonus: bonus.evade || 0,
    damageResistanceBonus: bonus.damage_resistance || 0,
    // Mob static targets.
    mobToHit: mobToHit(modifierByStat.strength, floor),
    mobEvade: mobEvade(modifierByStat.dexterity, floor),
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
 * - `items` holds only weapon entries; consumers should read `d.items[id] ?? {}`.
 * - `step` is present only for a mount.
 */
export const deriveVehicle = (input = {}) => {
  const items = cleanItems(input.items);
  const { bonus, percent, itemBonus, itemPercent, unresolved } = resolveModifiers(cleanModifiers(input.modifiers), items);

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

  // Vehicle weapons have no ability mod: to-hit is rank + vehicle-side mods;
  // the gunner's skill bonus is added at roll time (_engine.js:376-381).
  const itemsOut = {};
  for (const item of items) {
    if (item.type !== 'weapon') continue;
    const id = idOf(item);
    const sys = item.system || {};
    const row = attackRow({
      statModifier: 0, rank: +sys.rank || 0, itemBonus: itemBonus[id] || {}, itemPercent: itemPercent[id] || {},
      die: sys.die, damageBonus: sys.damageBonus, damageType: sys.damageType, floor: 0,
    });
    itemsOut[id] = { toHit: row.toHit, damageBase: row.damageBase, damageLabel: row.damageLabel };
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
