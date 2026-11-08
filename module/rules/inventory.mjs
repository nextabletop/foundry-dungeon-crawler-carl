// Inventory/gear derivation. Ported from
// character-sheet/source/sections/_inventory.pug:79-117 (ADR-0003).
// No Foundry globals — see foundry/module/rules/ conventions.
//
// R20's items were flat attribute rows ({slot, active, accessory, ...}); here
// an item is { id, name, system: { slot, active, accessory } }. Logic is
// otherwise identical. Hotlist reconciliation (buildHotlist/reconcileHotlist)
// is not ported — Foundry lists items with `onHotlist` directly.

import { GEAR_SLOTS, ACCESSORY_CAP } from '../config.mjs';
import { isActive } from './engine.mjs';

// An item's modifiers apply when it is worn in a gear slot OR flagged active.
// R20's `truthy` helper is the same predicate as engine.mjs's `isActive`.
export const isItemActive = (item) => {
  const system = item?.system || {};
  return GEAR_SLOTS.includes(system.slot) || isActive(system.active);
};

// Gear-slot occupancy, derived from inventory. Deleted rows simply disappear.
// R20 quirk, preserved verbatim: `find` reports only the FIRST item claiming
// a slot (display purposes only). If a second item is (incorrectly) slotted
// into the same spot, it still counts as active for isItemActive/modifier
// purposes — buildGear's display list and the modifier aggregation are
// independent, so a "hidden" second occupant still contributes its bonuses.
export const buildGear = (items) => GEAR_SLOTS.reduce((gear, slot) => {
  const it = (items || []).find((i) => i.system?.slot === slot);
  gear[slot] = it ? { id: it.id, name: it.name } : null;
  return gear;
}, {});

// Accessories list — active items flagged accessory, capped (Max 10).
export const buildAccessories = (items, cap = ACCESSORY_CAP) => (items || [])
  .filter((i) => isActive(i.system?.accessory) && isItemActive(i))
  .slice(0, cap)
  .map((i) => ({ id: i.id, name: i.name }));
