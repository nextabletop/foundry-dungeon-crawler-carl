// Pure modifier resolution over plain item/modifier objects.
// Replaces R20's gatherModifiers/resolveTargets/parseGroupTarget
// (character-sheet/source/javascript/_engine.js), which read Roll20
// repeating-section attribute keys directly. This module has no notion of
// where `modifiers`/`items` came from — the caller (this system's `dcc`
// ActiveEffect change-type handler) supplies plain arrays.
//
// This module only ever sees changes of the custom 'dcc' change type — core
// Foundry never applies those itself (a change type with a function handler
// is dispatched to that handler instead of core's apply logic). So an
// ActiveEffectChangeData's `mode`/`priority` fields are intentionally
// ignored here; if dcc changes ever need ordering, that is the caller's
// concern before it builds the `modifiers` array, not this module's.
//
// Target grammar:
//   'strength'                         -> field target (must be in FIELD_TARGETS)
//   'item:<Name>:<aspect>'             -> one item, matched by name
//   'group:<attacks|skills>[:<attribute>(=|!=)<value>]:<aspect>' -> a filtered set of items
// e.g. 'damage_resistance', 'item:Longsword:to_hit',
//      'group:attacks:damage_type=slashing:to_hit', 'group:skills:class!=bard:mana_cost'.
//
// Vocabulary: every value string (fields, sections, aspects, group attributes)
// is R20's snake_case value exactly, so an ActiveEffect change key reads the
// same on both platforms (shared compendium):
//   fields      strength, intelligence, constitution, dexterity, charisma,
//               damage_resistance, evade, move, step, mana
//   sections    attacks (canonical Attack Items), skills (skills + spells)
//   aspects     attacks: to_hit, damage; skills: rank, mana_cost
//   attributes  attacks: stat, damage_type; skills: stat, class
// There are no aliases for the old Foundry spellings (dr, tohit, manaCost,
// weapons, dmgType): those targets are unresolved now.
// The one difference from R20 is the grammar SHAPE: Foundry always carries a
// trailing `:<aspect>` (R20 read the aspect from a second select).
//
// The output buckets are keyed by that same vocabulary, never mapped to
// camelCase: `bonus`/`percent` by field (`bonus.damage_resistance`), and
// `itemBonus`/`itemPercent` by item id, then aspect (`itemBonus[id].to_hit`,
// `itemBonus[id].mana_cost`). The camelCase names (`derived.toHit`,
// `derived.manaCostEffective`) are introduced by the consumer, rules/derive.mjs.
// A group attribute reads its item schema path through ATTRIBUTE_PATHS
// (`damage_type` -> `system.damageType`).
//
// The `item:` / `group:` prefixes are case-insensitive (like fields,
// sections, attributes and aspects); an item name keeps its casing (names
// match case-insensitively at resolve time anyway).
//
// A predicate whose value is empty or whitespace (`stat=`, `stat!=`) is
// dropped, so the target is a bare, unfiltered group. This mirrors R20's group
// builder (_modifiers.js resolveModifierTarget), which emits the predicate only
// when both an attribute and a value are chosen. Only a LEGAL attribute for the
// section is dropped this way: an illegal one (`group:attacks:class=:to_hit`)
// is kept, so resolveModifiers still reports it as illegalAttribute.
//
// parseTarget only rejects targets that are malformed by GRAMMAR (wrong
// shape, a predicate with no operator or an empty attribute, a missing
// aspect). Field names are the one exception — the field vocabulary IS the
// grammar, so an unrecognized bare word doesn't parse. Whether a syntactically
// well-formed group's section/aspect/attribute is a *legal* one, and whether
// an item target's name resolves to a real item, are semantic questions
// answered by resolveModifiers, which reports why with a `reason` on each
// unresolved entry.

import { FIELD_TARGETS, ITEM_ASPECTS } from '../config.mjs';
import { parseModifierValue } from './engine.mjs';
import { idOf, normName } from './items.mjs';

const GROUP_ASPECTS = { attacks: ['to_hit', 'damage'], skills: ['rank', 'mana_cost'] };
// Attributes a group predicate may filter on, per section (attacks: stat,
// damage_type; skills/spells: stat, class).
const GROUP_ATTRIBUTES = { attacks: ['stat', 'damage_type'], skills: ['stat', 'class'] };
const ALL_ASPECTS = ['to_hit', 'damage', 'rank', 'mana_cost'];
const ALL_GROUP_ATTRIBUTES = ['stat', 'damage_type', 'class'];
const GROUP_SECTIONS = ['attacks', 'skills'];
// Group attribute (value vocabulary) -> the item `system` key holding its value.
const ATTRIBUTE_PATHS = { stat: 'stat', class: 'class', damage_type: 'damageType' };

// Case-insensitive lookup that maps a raw string back to its canonical
// casing (e.g. 'MANA_COST' -> 'mana_cost', 'Strength' -> 'strength'). Returns
// null when nothing in `list` matches, so the caller can fall back.
const canonicalFrom = (list) => (raw) => {
  const needle = String(raw ?? '').trim().toLowerCase();
  if (!needle) return null;
  return list.find((v) => v.toLowerCase() === needle) ?? null;
};

const canonicalField = canonicalFrom(FIELD_TARGETS);
const canonicalAspect = canonicalFrom(ALL_ASPECTS);
const canonicalSection = canonicalFrom(GROUP_SECTIONS);
const canonicalAttribute = canonicalFrom(ALL_GROUP_ATTRIBUTES);

export const parseTarget = (target) => {
  if (typeof target !== 'string') return null;
  const trimmed = target.trim();
  if (!trimmed) return null;

  const field = canonicalField(trimmed);
  if (field) return { kind: 'field', field };

  const prefix = trimmed.slice(0, trimmed.indexOf(':') + 1).toLowerCase();

  if (prefix === 'item:') {
    const rest = trimmed.slice(prefix.length);
    const idx = rest.lastIndexOf(':');
    if (idx === -1) return null;
    const name = rest.slice(0, idx).trim();
    const aspectRaw = rest.slice(idx + 1).trim();
    if (!name || !aspectRaw) return null;
    return { kind: 'item', name, aspect: canonicalAspect(aspectRaw) ?? aspectRaw };
  }

  if (prefix === 'group:') {
    const rest = trimmed.slice(prefix.length);
    const parts = rest.split(':').map((p) => p.trim());
    if (parts.length < 2 || parts.length > 3) return null;
    const sectionRaw = parts[0];
    const predicate = parts.length === 3 ? parts[1] : '';
    const aspectRaw = parts[parts.length - 1];
    if (!sectionRaw || !aspectRaw) return null;
    const section = canonicalSection(sectionRaw) ?? sectionRaw.toLowerCase();
    const aspect = canonicalAspect(aspectRaw) ?? aspectRaw;

    let attribute = '';
    let operator = '=';
    let value = '';
    if (predicate) {
      // Prefer '!=' when present (it contains '=', so it must be checked
      // first); otherwise the first '='. A missing operator, or an operator
      // at index 0 (an empty attribute, e.g. 'group:attacks:=fire:to_hit'),
      // is a malformed predicate — reject the whole target rather than
      // silently treating it as an unfiltered group.
      const notEqualIndex = predicate.indexOf('!=');
      const equalIndex = predicate.indexOf('=');
      let operatorIndex = -1;
      if (notEqualIndex !== -1) { operatorIndex = notEqualIndex; operator = '!='; }
      else if (equalIndex !== -1) { operatorIndex = equalIndex; operator = '='; }
      if (operatorIndex <= 0) return null;
      const attributeRaw = predicate.slice(0, operatorIndex).trim();
      if (!attributeRaw) return null;
      // Take everything after the operator as the value, so a value that
      // itself contains '=' (e.g. 'stat=a=b') is not truncated.
      value = predicate.slice(operatorIndex + operator.length).trim();
      attribute = canonicalAttribute(attributeRaw) ?? attributeRaw;
      // No value chosen: a bare group, as R20's builder emits (see header),
      // but only for an attribute legal in the section (else resolve's
      // illegalAttribute).
      if (!value && GROUP_ATTRIBUTES[section]?.includes(attribute)) { attribute = ''; operator = '='; }
    }
    return { kind: 'group', section, attribute, operator, value, aspect };
  }

  return null;
};

const legalAspectsFor = item => ITEM_ASPECTS[item.type] || [];

// Is `item` a member of the group's section?
const inSection = (item, section) => {
  if (section === 'attacks') return item.type === 'attack';
  if (section === 'skills') return item.type === 'skill' || item.type === 'spell';
  return false;
};

const attributeValue = (item, attribute) => {
  const path = ATTRIBUTE_PATHS[attribute];
  if (!path) return undefined;
  return item.system?.[path];
};

// String compare, case-insensitive, per the group predicate's operator. An
// item that lacks the attribute entirely reads as '' — so `!=` against a value
// matches it (an Attack with no damageType set is not the excluded type). An
// empty value never gets here: parseTarget drops it to a bare group.
const matchesAttribute = (item, attribute, operator, value) => {
  if (!attribute) return true;
  const actual = String(attributeValue(item, attribute) ?? '').toLowerCase();
  const expected = String(value ?? '').toLowerCase();
  return operator === '!=' ? actual !== expected : actual === expected;
};

const addTo = (bucket, id, aspect, amount) => {
  bucket[id] = bucket[id] || {};
  bucket[id][aspect] = (bucket[id][aspect] || 0) + amount;
};

const addDiceTo = (bucket, id, aspect, dice) => {
  bucket[id] = bucket[id] || {};
  bucket[id][aspect] = (bucket[id][aspect] || '') + dice;
};

const pushUnresolved = (unresolved, modifier, reason) => {
  unresolved.push({ target: modifier.target, reason, modifier });
};

export const resolveModifiers = (modifiers, items) => {
  const bonus = {};
  const percent = {};
  const itemBonus = {};
  const itemPercent = {};
  const dice = {};
  const itemDice = {};
  const unresolved = [];

  for (const modifier of modifiers || []) {
    const parsed = parseTarget(modifier.target);
    if (!parsed) {
      pushUnresolved(unresolved, modifier, 'parse');
      continue;
    }
    const { kind: valueKind, value: amount, dice: modifierDice = '' } = parseModifierValue(modifier.value);

    if (parsed.kind === 'field') {
      if (valueKind === 'dice') {
        dice[parsed.field] = (dice[parsed.field] || '') + modifierDice;
        continue;
      }
      const target = valueKind === 'percent' ? percent : bonus;
      target[parsed.field] = (target[parsed.field] || 0) + amount;
      continue;
    }

    if (parsed.kind === 'item') {
      const key = normName(parsed.name);
      const matches = (items || []).filter((i) => normName(i.name) === key);
      if (matches.length === 0) {
        pushUnresolved(unresolved, modifier, 'noItem');
        continue;
      }
      const legal = matches.filter((i) => legalAspectsFor(i).includes(parsed.aspect));
      if (legal.length === 0) {
        pushUnresolved(unresolved, modifier, 'illegalAspect');
        continue;
      }
      if (parsed.aspect === 'damage' && valueKind === 'percent') {
        pushUnresolved(unresolved, modifier, 'percentDamage');
        continue;
      }
      if (valueKind === 'dice') {
        for (const item of legal) addDiceTo(itemDice, idOf(item), parsed.aspect, modifierDice);
        continue;
      }
      const bucket = valueKind === 'percent' ? itemPercent : itemBonus;
      for (const item of legal) addTo(bucket, idOf(item), parsed.aspect, amount);
      continue;
    }

    // group
    if (!GROUP_ASPECTS[parsed.section]) {
      pushUnresolved(unresolved, modifier, 'unknownSection');
      continue;
    }
    if (!GROUP_ASPECTS[parsed.section].includes(parsed.aspect)) {
      pushUnresolved(unresolved, modifier, 'illegalAspect');
      continue;
    }
    if (parsed.attribute && !GROUP_ATTRIBUTES[parsed.section].includes(parsed.attribute)) {
      pushUnresolved(unresolved, modifier, 'illegalAttribute');
      continue;
    }
    if (parsed.aspect === 'damage' && valueKind === 'percent') {
      pushUnresolved(unresolved, modifier, 'percentDamage');
      continue;
    }
    const matched = (items || []).filter((i) => inSection(i, parsed.section)
      && matchesAttribute(i, parsed.attribute, parsed.operator, parsed.value));
    // A group matching no items is a legitimate empty result, not an error —
    // e.g. a "while raging" buff on a Crawler without Attacks.
    if (valueKind === 'dice') {
      for (const item of matched) addDiceTo(itemDice, idOf(item), parsed.aspect, modifierDice);
    } else {
      const bucket = valueKind === 'percent' ? itemPercent : itemBonus;
      for (const item of matched) addTo(bucket, idOf(item), parsed.aspect, amount);
    }
  }

  return { bonus, percent, itemBonus, itemPercent, dice, itemDice, unresolved };
};
