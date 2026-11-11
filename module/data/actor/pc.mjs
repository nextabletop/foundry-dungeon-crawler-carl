import CreatureModel from './creature.mjs';
import { STATS } from '../../config.mjs';
import { int, str, bool, html, pool } from '../_fields.mjs';

export default class PcModel extends CreatureModel {
  static creatureType = 'pc';

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      race: str(),
      pronouns: str(),
      class: str(),
      crawlerNumber: str(),
      aiFavor: int(0),
      pcCombatEdit: bool(false),
      pcAbilitiesEdit: bool(false),
      pendingLevels: int(0),
      statPoints: int(0),
      undoStack: new fields.ArrayField(new fields.ObjectField(), { required: true, initial: [] }),
      // GM screen floor-end cursor (Chunk 8): floor ends consumed, and the baseline epoch.
      floorEndDone: int(0, { min: 0 }),
      floorEndEpoch: int(0, { min: 0 }),
      mana: pool(),
      manaStat: str('intelligence', { choices: STATS }),
      autoEnableCast: bool(true),
      popularity: html(),
      pastTrauma: html(),
      looseEnds: html(),
      regrets: html(),
    };
  }

  /** Derived `mana.max` (the mana stat's enhanced value + mana mods); `mana.value` stays stored. */
  _applyDerived(d) {
    this.mana.max = d.manaMax;
  }
}
