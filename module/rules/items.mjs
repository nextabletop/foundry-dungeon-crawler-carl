// Shared plain-item helpers for the pure rules modules (modifiers, derive).
// No Foundry globals — see foundry/module/rules/ conventions.

// An item's stable key: the embedded document id, or the raw source `_id`.
export const idOf = (item) => item.id ?? item._id;

// A spell whose attack row is enabled also counts as an attack (weapon).
export const isAttackSpell = (item) => item.type === 'spell' && item.system?.attack?.enabled === true;

// Case-insensitive, whitespace-trimmed name key for by-name matching.
export const normName = (name) => String(name ?? '').trim().toLowerCase();
