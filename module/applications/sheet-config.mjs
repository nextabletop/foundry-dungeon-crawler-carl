import { SYSTEM_ID, STATS, APP_CLASSES } from '../config.mjs';

const CoreSheetConfig = foundry.applications.apps.DocumentSheetConfig;

/** Settings tab mana-stat <select> choices: value -> label key. */
const STAT_OPTIONS = Object.freeze(Object.fromEntries(STATS.map(s => [s, `DCC.Stat.${s}`])));

/**
 * Configure Sheet dialog with the actor's sheet settings (the R20 Settings
 * view) above core's sheet / theme choices. The settings fieldset renders
 * only for actor types that have settings (pc: mana ability, auto-enable on
 * cast; mob: public rolls). Submit writes the `system.*` fields to the actor,
 * then runs core's own handler for the sheet / theme fields.
 */
export default class DCCSheetConfig extends CoreSheetConfig {
  static DEFAULT_OPTIONS = {
    classes: [...APP_CLASSES, 'dcc-sheet-config'],
    position: { width: 500 },
    form: { handler: DCCSheetConfig.#onSubmitForm },
  };

  static PARTS = {
    dcc: { template: `systems/${SYSTEM_ID}/templates/actor/sheet-config.hbs` },
    ...CoreSheetConfig.PARTS,
  };

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === 'dcc') {
      const doc = this.document;
      Object.assign(context, {
        dccType: doc.type,
        systemSource: doc.system._source,
        statOptions: STAT_OPTIONS,
        rootId: this.id,
        canEdit: doc.isOwner,
      });
    }
    return context;
  }

  /**
   * Save the sheet settings, then hand the sheet / theme fields to core.
   * @this {DCCSheetConfig}
   */
  static async #onSubmitForm(event, form, formData) {
    const system = foundry.utils.expandObject(formData.object).system;
    if (system && this.document.isOwner) await this.document.update({ system });
    return CoreSheetConfig.DEFAULT_OPTIONS.form.handler.call(this, event, form, formData);
  }
}
