// Shared glue between the actor data models and the pure derive engine
// (rules/derive.mjs): the modifier collector, owned-item mapping, and the
// derived values every actor type has in common, plus the healthPoints-edit rewrite
// used by each model's _preUpdate.

import { toList } from '../../rules/derive.mjs';
import { applyHealthPointsEdit, clampSlots } from '../../rules/health.mjs';
import { healthBarSlotsFor } from '../../rules/engine.mjs';

/**
 * Reset the modifier collector. Called from prepareBaseData; the `dcc`
 * ActiveEffect change handler fills it during applyActiveEffects('initial'),
 * and prepareDerivedData reads it.
 */
export const resetModifiers = (model) => {
  model._modifiers = [];
};

/** The owned items (any iterable; an EmbeddedCollection yields its values) as an array. */
export const ownedItems = (model) => toList(model.parent?.items);

/** Engine input for the items whose type is in `types`: `{ id, type, name, system }`. */
export const engineItems = (items, types) => items
  .filter(it => types.has(it?.type))
  .map(({ id, type, name, system }) => ({ id, type, name, system }));

/**
 * Write each item's derived values onto `item.system.derived`. Every item gets
 * an object ({} when the engine has nothing for it) so stale values clear.
 */
export const assignItemDerived = (items, derivedItems) => {
  for (const item of items) {
    if (item?.system) item.system.derived = derivedItems[item.id] ?? {};
  }
};

/**
 * Assign the derived values shared by every actor type. The stored
 * `healthBar` is left untouched; `healthBarDisplay` is its clamp to
 * [0, healthBarSlots] for display.
 */
export const assignHealth = (model, d) => {
  model.healthBarSlots = d.healthBarSlots;
  model.healthBarDisplay = d.healthBar;
  model.healthPoints.value = d.healthPoints.value;
  model.healthPoints.max = d.healthPoints.max;
  model.unresolvedModifiers = d.unresolved;
};

/**
 * Rewrite a healthPoints edit (token bar, sheet) in a pending update into a
 * slot change. `healthPoints` is purely derived, so
 * `changes.system.healthPoints` is always deleted (including a
 * `healthPoints.max`-only update). When `healthPoints.value` is present and
 * finite, applyHealthPointsEdit chunks it, and `changes.system.healthBar` is
 * written only if the result differs from the current (displayed) slots. An
 * explicit `system.healthBar` in the same update wins. A non-finite value
 * (core's Math.clamp passes a HUD "abc" through as NaN) and a no-op or
 * sub-slot edit leave healthBar alone, so an over-cap stored healthBar is not
 * overwritten.
 * Mutates `changes`; never cancels the update.
 *
 * Core's cleanData expands dotted keys before `_preUpdate`, so only the nested
 * form is handled. Unlinked token actors are covered too: the backend runs the
 * synthetic actor's `_preUpdate` before redirecting to the ActorDelta. A direct
 * write of `delta.system.healthPoints.value` on a token bypasses this, but is
 * harmless: healthPoints is re-derived from healthBar on preparation. The
 * delta is measured from `healthBarDisplay` (the clamped value the bar shows),
 * not the raw stored `healthBar`.
 * @param {object} model - the prepared actor TypeDataModel (needs
 *   `healthPoints`, `healthConstitutionModifier`, `healthBarDisplay`,
 *   `healthBarSlots`).
 * @param {object} changes - the candidate changes passed to `_preUpdate`.
 */
export const rewriteHealthPointsEdit = (model, changes) => {
  if (!foundry.utils.hasProperty(changes, 'system.healthPoints')) return;
  const system = changes.system;
  const entered = system.healthPoints?.value;
  if (!('healthBar' in system) && Number.isFinite(entered)) {
    const current = model.healthBarDisplay ?? model.healthBar;
    const { healthBar } = applyHealthPointsEdit(current, entered, model.healthConstitutionModifier, model.healthBarSlots);
    if (healthBar !== current) system.healthBar = healthBar;
  }
  delete system.healthPoints;
};

/** Reconcile filled slots when an update changes the slot count. */
export const rewriteHealthBarSlotCount = (model, changes, type, explicitHealthBar) => {
  const system = changes.system;
  if (!system) return;
  const relevant = type === 'vehicle' ? ['size'] : ['level', 'healthBarSlotsCustom'];
  if (!relevant.some(key => Object.hasOwn(system, key))) return;
  const value = key => Object.hasOwn(system, key) ? system[key] : model[key];
  const next = healthBarSlotsFor(type, value('level'), value('size'), value('healthBarSlotsCustom'));
  const previous = model.healthBarSlots;
  if (next === previous) return;
  const current = system.healthBar ?? model.healthBarDisplay;
  const growth = explicitHealthBar ? 0 : Math.max(0, next - previous);
  system.healthBar = clampSlots(current + growth, next);
};
