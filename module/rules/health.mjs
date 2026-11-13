// Health Bar (slot) arithmetic. Ported verbatim from
// character-sheet/source/components/_health.pug:53-112 (ADR-0002).
// No Foundry globals — see foundry/module/rules/ conventions.

import { HEALTH_BAR_MAX_SLOTS } from '../config.mjs';

// `healthBar` is the source of truth. healthPoints = healthBar x
// Con Mod, max healthPoints = slot count x Con Mod. Damage divides by Con Mod with the
// remainder shrugged (DCC rules); the token-linked healthPoints mirror is
// refunded back to a clean multiple.

// Slot COUNT varies by mode (pc 10 · mob min(level,10) · vehicle size —
// derive.mjs materializes it as `healthBarSlots`); every clamp takes an optional
// `max` defaulting to the PC's 10 (HEALTH_BAR_MAX_SLOTS) so pre-existing callers are
// untouched.
export const slotMax = (max) => (max === undefined || max === null || max === '' ? HEALTH_BAR_MAX_SLOTS : Math.max(0, +max || 0));
export const clampSlots = (v, max) => Math.max(0, Math.min(slotMax(max), v));

export const healthPointsFromHealthBar = (healthBar, constitutionModifier) => (+healthBar || 0) * (+constitutionModifier || 0);

export const maxHealthPointsFromConstitution = (constitutionModifier, slots) => slotMax(slots) * (+constitutionModifier || 0);

// Whole slots removed by an (already DR-adjusted) damage amount. A hit smaller
// than one Con Mod is shrugged entirely; the remainder of a larger hit is lost.
export const damageToSlots = (effective, constitutionModifier) => {
  const e = +effective || 0;
  const c = +constitutionModifier || 0;
  if (c <= 0 || e < c) return 0;
  return Math.floor(e / c);
};

/**
 * Apply one hit: DR first, then chunk. Hits must be applied individually —
 * summing them changes the chunk math (a deliberate consequence of the rule).
 * Note: `slotsLost` is simply `healthBar - newHealthBar`, so a `healthBar`
 * that already exceeds `max` (e.g. after a slot-count shrink) reports slots
 * "lost" to the clamp even on a 0-damage hit — this is R20 parity, not a new
 * behaviour.
 * @param {number} healthBar - current health in slots.
 * @param {number} damage - incoming damage in hit points, before DR.
 * @param {number} damageResistance - in hit points, subtracted first.
 * @param {number} constitutionModifier - Con Mod (hit points per slot).
 * @param {number} [max] - slot cap; defaults to HEALTH_BAR_MAX_SLOTS (see slotMax).
 * @returns {{healthBar: number, healthPoints: number, slotsLost: number}}
 */
export const directDamage = (healthBar, damage, damageResistance, constitutionModifier, max) => {
  const effective = Math.max(0, (+damage || 0) - (+damageResistance || 0));
  const slots = damageToSlots(effective, constitutionModifier);
  const newHealthBar = clampSlots((+healthBar || 0) - slots, max);
  return {
    healthBar: newHealthBar,
    healthPoints: healthPointsFromHealthBar(newHealthBar, constitutionModifier),
    slotsLost: (+healthBar || 0) - newHealthBar,
  };
};

/**
 * React to a user-entered healthPoints value (token bubble). Convert the delta
 * to whole slots, shrug the sub-slot remainder, and refund healthPoints to a
 * clean multiple so the mirror always equals healthBar x Con Mod. Healing is
 * chunked symmetrically.
 * @param {number} oldHealthBar - current health in slots.
 * @param {number} enteredHealthPoints - the value the user typed, in hit points.
 * @param {number} constitutionModifier - Con Mod (hit points per slot).
 * @param {number} [max] - slot cap; defaults to HEALTH_BAR_MAX_SLOTS (see slotMax).
 * @returns {{healthBar: number, healthPoints: number}}
 */
export const applyHealthPointsEdit = (oldHealthBar, enteredHealthPoints, constitutionModifier, max) => {
  const c = +constitutionModifier || 0;
  const startHealthBar = +oldHealthBar || 0;
  const delta = (+enteredHealthPoints || 0) - healthPointsFromHealthBar(startHealthBar, c);
  let newHealthBar = startHealthBar;
  if (c > 0) {
    const slots = Math.floor(Math.abs(delta) / c);
    newHealthBar = clampSlots(startHealthBar + (delta < 0 ? -slots : slots), max);
  }
  return { healthBar: newHealthBar, healthPoints: healthPointsFromHealthBar(newHealthBar, c) };
};

// Potions heal whole slots directly (defined in slots, not hit points).
export const healSlots = (healthBar, slots, max) => clampSlots((+healthBar || 0) + (+slots || 0), max);

export const isDying = (healthBar) => (+healthBar || 0) <= 0;

// ── Sheet health bar ──

/**
 * The healthBar a slot click writes: clicking slot i (1-based) fills up to it,
 * and clicking the slot equal to the current healthBar clears it
 * (healthBar = i - 1). `current` is the displayed (clamped) healthBar.
 * @param {number} clicked
 * @param {number} current
 * @returns {number}
 */
export const slotClickTarget = (clicked, current) => {
  const i = Math.trunc(+clicked || 0);
  return i === (+current || 0) ? i - 1 : i;
};

/**
 * View model for the actor's slot count, with percentage labels and rainbow tiers.
 * @param {number} healthBar - displayed (clamped) healthBar
 * @param {number} slots - the actor's slot count (healthBarSlots)
 * @returns {{i:number, filled:boolean, percent:number, tier:number, gradientPosition:number}[]}
 */
export const slotView = (healthBar, slots) => {
  const h = +healthBar || 0;
  const max = slotMax(slots);
  return Array.from({ length: max }, (_, n) => {
    const i = n + 1;
    const tier = max === 1 ? 10 : 1 + Math.round(n * 9 / (max - 1));
    const gradientPosition = max === 1 ? 0 : n * 100 / (max - 1);
    return { i, filled: i <= h, percent: Math.floor(i * 100 / max), tier, gradientPosition };
  });
};
