import { bool, html } from '../_fields.mjs';

/** Fields shared by every DCC item type. */
export default class BaseItemModel extends foundry.abstract.TypeDataModel {
  /** Field labels / hints / placeholders: DCC.Item.FIELDS.<path>.label in the lang file. */
  static LOCALIZATION_PREFIXES = ['DCC.Item'];

  static defineSchema() {
    return {
      description: html(),
      onHotlist: bool(false),
    };
  }

  /**
   * `derived` is instance-only: {} here so unowned items are safe to read; for
   * owned items the actor's prepareDerivedData overwrites it afterwards.
   */
  prepareBaseData() {
    super.prepareBaseData();
    this.derived = {};
  }
}
