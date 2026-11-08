import { isItemActive } from '../../rules/inventory.mjs';
import { DCC_CHANGE_TYPE } from '../../effects/dcc-change.mjs';

/**
 * ActiveEffect system model. Must extend ActiveEffectTypeDataModel so the `changes` field exists.
 */
export default class DCCEffectModel extends foundry.data.ActiveEffectTypeDataModel {
  /**
   * Core's changes schema, with a new change's `type` defaulting to 'dcc'
   * (ActiveEffectConfig's "add change" uses the element's initial value).
   * Core fields can't be re-parented, so each change field is rebuilt from its
   * options; the type field's options carry core's type validator.
   */
  static defineSchema() {
    const schema = super.defineSchema();
    const { ArrayField, SchemaField } = foundry.data.fields;
    const { changes } = schema;
    const element = changes.element;
    const changeFields = Object.fromEntries(Object.entries(element.fields).map(([name, field]) => {
      const options = name === 'type' ? { ...field.options, initial: DCC_CHANGE_TYPE } : field.options;
      return [name, new field.constructor(options)];
    }));
    schema.changes = new ArrayField(new SchemaField(changeFields, element.options), changes.options);
    return schema;
  }

  /**
   * Gate an item's effects on the item's state. Core reads
   * `!!(system.isSuppressed ?? duration.expired)`, so "not suppressed" must be
   * `undefined` (never `false`) or duration expiry would stop working.
   * @returns {true|undefined}
   */
  get isSuppressed() {
    const item = this.parent?.parent;
    if (item?.documentName !== 'Item') return undefined; // actor-level effect or orphan
    switch (item.type) {
      case 'gear':
      case 'weapon':
        return isItemActive(item) ? undefined : true;
      case 'skill':
      case 'spell':
        return item.system?.enabled ? undefined : true;
      default:
        return undefined;
    }
  }
}
