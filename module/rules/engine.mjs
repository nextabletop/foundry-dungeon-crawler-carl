// Pure DCC modifier-aggregation engine helpers.
// Ported from character-sheet/source/javascript/_engine.js (ADR-0004/ADR-0008).
// No Foundry globals — see foundry/module/rules/ conventions.

import { HEALTH_BAR_MAX_SLOTS, HEALTH_BAR_SLOT_GUARD, VEHICLE_SIZE_MAX } from '../config.mjs';

// Stat value -> Stat Mod (sourced step chart). Min +1, max +10.
// Ported verbatim from _engine.js:66.
export const statModifier = (value) => {
  const v = +value || 0;
  if (v >= 300) return 10;
  if (v >= 200) return 9;
  if (v >= 150) return 8;
  if (v >= 100) return 7;
  if (v >= 50) return 6;
  if (v >= 20) return 5;
  if (v >= 10) return 4;
  if (v >= 6) return 3;
  if (v >= 3) return 2;
  return 1; // 1-2, and a defensive floor for 0/negative
};

// Ported verbatim from _engine.js:101.
export const isActive = (v) => v !== undefined && v !== null && v !== '' && v !== '0' && v !== 0 && v !== false;

// Parse a modifier amount text into {kind, value} (ADR-0008). A trailing '%'
// makes it a percent. A signed dice expression is retained for roll time and
// contributes no static value. Anything else is a flat number.
export const parseModifierValue = (raw) => {
  const s = String(raw == null ? '' : raw).trim();
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1));
    return { kind: 'percent', value: Number.isNaN(n) ? 0 : n };
  }
  const dice = /^([+-]?)\s*(\d+d\d+)$/i.exec(s);
  if (dice) return { kind: 'dice', value: 0, dice: `${dice[1] || '+'}${dice[2].toLowerCase()}` };
  const n = Number(s);
  return { kind: 'flat', value: Number.isNaN(n) ? 0 : n };
};

// The single materialization rule (ADR-0008): effective = floor((base + Σflat)
// × (1 + Σpercent)). Ported verbatim from _engine.js:125.
export const applyModifiers = (base, flat, percent) => Math.floor(((+base || 0) + (+flat || 0)) * (1 + (+percent || 0) / 100));

// A custom count overrides PC and Mob defaults; vehicles always use their size.
export const healthBarSlotsFor = (mode, level, size, custom) => {
  if (mode === 'vehicle') return Math.max(1, Math.min(VEHICLE_SIZE_MAX, +size || 0));
  const count = Math.floor(+custom || 0);
  if (count > 0) return Math.min(HEALTH_BAR_SLOT_GUARD, count);
  if (mode === 'mob') return Math.max(1, Math.min(HEALTH_BAR_MAX_SLOTS, +level || 0));
  return HEALTH_BAR_MAX_SLOTS;
};

// Mob rolls follow the selected message mode unless whispering is enabled.
export const whisperToGM = (type, mobWhisper) => type === 'mob' && mobWhisper === true;

/** Message modes everyone sees; 'self' / 'blind' / 'gm' are private. */
export const PUBLIC_MODES = ['public', 'ic'];

/**
 * A roll card's message mode: the player's chosen `core.messageMode`, except
 * that a Mob with whispering enabled upgrades a public one ('public' / 'ic') to
 * 'gm'. The one whisper decision: postCard and the crew-name rule both use it.
 * @param {{type:string, system?:{mobWhisper?:boolean}}} privacyActor - whose visibility applies
 * @param {string} chosen
 * @returns {string}
 */
export const cardMessageMode = (privacyActor, chosen) => (
  (whisperToGM(privacyActor?.type, privacyActor?.system?.mobWhisper) && PUBLIC_MODES.includes(chosen)) ? 'gm' : chosen);
