import DCCCreatureSheet from './creature-sheet.mjs';
import { ACTOR_PARTIALS, templatePath as path } from './actor-sheet-base.mjs';
import { inventoryView } from './sheet-rows.mjs';

/**
 * Mob stat block: one scrolling column, without tabs. The stat block and the Notes editor are separate parts so an
 * open Notes editor is not torn down when the stat block re-renders (health
 * clicks, item edits). The window content scrolls as one page.
 *
 * Rolls whisper to the GM when `system.mobWhisper` is enabled (postCard / whisperToGM),
 * set in Configure Sheet (DCCSheetConfig).
 * Inventory, Skills & Spells, and Buffs & Debuffs are optional sheet sections.
 * Owned item types: the base default (weapon, skill, spell, gear).
 */
export default class MobSheet extends DCCCreatureSheet {
  static DEFAULT_OPTIONS = { classes: ['mob'], position: { width: 600, height: 820 } };

  static RICH_TEXT_PARTS = {
    notes: [{ key: 'notes', label: 'DCC.Bio.Notes', wide: true }],
  };

  static PARTS = {
    body: {
      template: path('actor/mob/body.hbs'),
      templates: [
        ACTOR_PARTIALS.healthBar, ACTOR_PARTIALS.defenses, ACTOR_PARTIALS.unresolved,
        ACTOR_PARTIALS.attackList, ACTOR_PARTIALS.skillList, ACTOR_PARTIALS.buffList, ACTOR_PARTIALS.itemRow,
        ACTOR_PARTIALS.crewing,
      ],
    },
    notes: { template: path('actor/mob/notes.hbs'), templates: [ACTOR_PARTIALS.richFields] },
  };

  /**
   * Inventory contains gear only (weapons are listed under Attacks).
   * @inheritDoc
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, { inventory: inventoryView({ gear: this.document.itemTypes.gear }).inventory });
  }
}
