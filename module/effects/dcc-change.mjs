// The `dcc` ActiveEffect change type: instead of writing to a field, each
// change is collected into the actor model's modifier list (`system._modifiers`,
// reset in prepareBaseData) and resolved by the pure derive engine in
// prepareDerivedData. Targets/values use the R20 modifier syntax
// (see rules/modifiers.mjs): 'strength', 'item:Name:to_hit', '2', '10%'.

export const DCC_CHANGE_TYPE = 'dcc';

// Effect+key pairs already warned about, so a misconfigured final-phase change
// warns once rather than on every data preparation.
const warnedFinal = new Set();

/** CONFIG.ActiveEffect.changeTypes.dcc handler: collect instead of applying. */
export function dccChangeHandler(targetDoc, change) {
  const collector = targetDoc?.system?._modifiers;
  if (!Array.isArray(collector)) return; // non-DCC actor or not in a prepare cycle
  if (change.phase && change.phase !== 'initial') { // final-phase changes land after derive and would be ignored
    const warnKey = `${change.effect?.uuid ?? change.effect?.id ?? ''}|${change.key}`;
    if (!warnedFinal.has(warnKey)) {
      warnedFinal.add(warnKey);
      console.warn(`DCC | 'dcc' modifier "${change.key}" must use the initial phase; ignored`);
    }
    return;
  }
  collector.push({ target: String(change.key ?? '').trim(), value: String(change.value ?? '') });
}

/** One-line summary of a change: `key value`, with the type shown when it isn't 'dcc'. */
export const describeChange = ({ key, type, value } = {}) => {
  const text = `${key ?? ''} ${value ?? ''}`.trim();
  return type === DCC_CHANGE_TYPE ? text : `${text} (${type})`;
};

export const registerDccChangeType = () => {
  CONFIG.ActiveEffect.changeTypes[DCC_CHANGE_TYPE] = { label: 'DCC.Effect.ChangeType', defaultPriority: 20, handler: dccChangeHandler };
};
