// Shared plain-item helpers for the pure rules modules (modifiers, derive).
// No Foundry globals — see foundry/module/rules/ conventions.

import { CHECK_TYPES, STATS } from '../config.mjs';

// An item's stable key: the embedded document id, or the raw source `_id`.
export const idOf = (item) => item.id ?? item._id;

// Case-insensitive, whitespace-trimmed name key for by-name matching.
export const normName = (name) => String(name ?? '').trim().toLowerCase();

/** A schema-safe check type; blank or unknown values follow the Opposed default. */
export const checkTypeOf = (value) => {
  const type = String(value ?? '').trim().toLowerCase();
  return CHECK_TYPES.includes(type) ? type : 'opposed';
};

/** Whether a skill/spell system object uses the Passive check type. */
export const isPassiveCheck = (system) => checkTypeOf(system?.checkType) === 'passive';

/** Localized check-type label, including the opposing stat when one is set. */
export const checkTypeLabel = (checkType, opposedStat, localize = key => key) => {
  const type = checkTypeOf(checkType);
  const label = localize(`DCC.CheckType.${type}`);
  const stat = String(opposedStat ?? '').trim().toLowerCase();
  return type === 'opposed' && STATS.includes(stat) ? `${stat.slice(0, 3).toUpperCase()}-${label}` : label;
};
