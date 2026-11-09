/** Small DataField helpers shared by the DCC data models. */

/** A required, non-nullable integer NumberField. */
export const int = (initial = 0, options = {}) => new foundry.data.fields.NumberField({
  required: true, nullable: false, integer: true, initial, ...options,
});

/**
 * A required StringField (blank allowed unless choices say otherwise).
 * Array `choices` are converted to a `{ value: value }` record: StringField#_prepareChoiceConfig
 * uses Object.entries, so a raw array would render array indices as the <option> values.
 */
export const str = (initial = '', { choices, ...options } = {}) => new foundry.data.fields.StringField({
  required: true, initial, ...options,
  ...(choices ? { choices: Array.isArray(choices) ? Object.fromEntries(choices.map(v => [v, v])) : choices } : {}),
});

/** A required array of strings. */
export const strArray = (initial = []) => new foundry.data.fields.ArrayField(str(), {
  required: true, nullable: false, initial,
});

/** A required, non-nullable BooleanField. */
export const bool = (initial = false) => new foundry.data.fields.BooleanField({
  required: true, nullable: false, initial,
});

/** An HTMLField. */
export const html = () => new foundry.data.fields.HTMLField({ required: true, blank: true });

/** A `{ value, max }` integer pair (healthPoints, mana). */
export const pool = () => new foundry.data.fields.SchemaField({ value: int(0), max: int(0) });
