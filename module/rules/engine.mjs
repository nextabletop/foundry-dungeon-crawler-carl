// Pure DCC modifier-aggregation engine helpers.
// Ported from character-sheet/source/javascript/_engine.js (ADR-0004/ADR-0008).
// No Foundry globals — see foundry/module/rules/ conventions.

import { HEALTH_BAR_MAX_SLOTS, VEHICLE_SIZE_MAX } from '../config.mjs';

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

// base = entered - current aggregated bonus, with a stale/unset guard: if the
// bonus is missing/NaN, treat the entered value as the base rather than
// back-calculating against a stale aggregate. Ported verbatim from _engine.js:143.
export const backCalcBase = (entered, bonus) => {
  const e = +entered || 0;
  if (bonus === undefined || bonus === null || Number.isNaN(+bonus)) return e;
  return e - (+bonus);
};

// Health Bar slot count by mode: a PC has all 10; a mob has min(level, 10);
// a vehicle/mount has slots = size 1-8. Never < 1.
// Ported verbatim from _engine.js:53.
export const healthBarSlotsFor = (mode, level, size) => {
  if (mode === 'mob') return Math.max(1, Math.min(HEALTH_BAR_MAX_SLOTS, +level || 0));
  if (mode === 'vehicle') return Math.max(1, Math.min(VEHICLE_SIZE_MAX, +size || 0));
  return HEALTH_BAR_MAX_SLOTS;
};

// Replaces R20's whisperPrefix (which returned a chat-command prefix string).
// Mob rolls whisper to the GM by default; Settings mobPublic makes them public.
// PCs and vehicles always roll publicly.
export const whisperToGM = (type, mobPublic) => type === 'mob' && !mobPublic;

/** Message modes everyone sees; 'self' / 'blind' / 'gm' are private. */
export const PUBLIC_MODES = ['public', 'ic'];

/**
 * A roll card's message mode: the player's chosen `core.messageMode`, except
 * that a hidden mob (whisperToGM) upgrades a public one ('public' / 'ic') to
 * 'gm'. The one whisper decision: postCard and the crew-name rule both use it.
 * @param {{type:string, system?:{mobPublic?:boolean}}} privacyActor - whose visibility applies
 * @param {string} chosen
 * @returns {string}
 */
export const cardMessageMode = (privacyActor, chosen) => (
  (whisperToGM(privacyActor?.type, privacyActor?.system?.mobPublic) && PUBLIC_MODES.includes(chosen)) ? 'gm' : chosen);

/**
 * The new stored base for a sheet edit of a derived move/step value, or
 * undefined when nothing should be written. The sheet submits the whole form
 * on every change, so an unchanged (or blank/non-numeric) value must not
 * back-calc: with a percent modifier, entered - bonus != base and the base
 * would drift on every unrelated edit.
 * @param {unknown} entered - the submitted display value
 * @param {number} current - the current derived value (system.move / step)
 * @param {number} bonus - the current flat bonus (system.moveBonus / stepBonus)
 * @returns {number|undefined}
 */
export const editedBase = (entered, current, bonus) => {
  if (entered === null || entered === undefined || entered === '') return undefined;
  const e = +entered;
  if (!Number.isFinite(e) || e === +current) return undefined;
  return backCalcBase(e, bonus);
};

/**
 * Translate the sheet's display-only move/step inputs (`dcc.move`,
 * `dcc.step`) in expanded form data into stored bases (`system.moveBase`,
 * `system.stepBase`) via editedBase. Always removes `data.dcc`. Mutates and
 * returns `data`.
 * @param {object} data - expanded form data
 * @param {{move:number, step:number, moveBonus:number, stepBonus:number}} system - the prepared actor system
 * @returns {object}
 */
export const translateDefenseEdits = (data, system) => {
  const edits = data?.dcc;
  if (!edits) return data;
  delete data.dcc;
  for (const key of ['move', 'step']) {
    if (!(key in edits)) continue;
    const base = editedBase(edits[key], system[key], system[`${key}Bonus`]);
    if (base === undefined) continue;
    data.system ??= {};
    data.system[`${key}Base`] = base;
  }
  return data;
};
