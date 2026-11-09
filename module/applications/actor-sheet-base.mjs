import { itemModels } from '../data/item/_module.mjs';
import { SYSTEM_ID, APP_CLASSES } from '../config.mjs';
import DCCSheetConfig from './sheet-config.mjs';
import { slotClickTarget, slotView, isDying } from '../rules/health.mjs';
import { translateDefenseEdits } from '../rules/engine.mjs';
import { inlineFieldValue, inlineEditTarget, isBlankHTML, richTextFieldNames, enableViewOnlyControls } from './sheet-rows.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Partials shared by several actor sheets. Preloaded once at init (index.mjs)
 * and also listed in the `templates` of each PARTS entry that uses them.
 */
/** Template path from a repo-relative `templates/...` path (shared by every actor sheet). */
export const templatePath = p => `systems/${SYSTEM_ID}/templates/${p}`;

export const ACTOR_PARTIALS = Object.freeze({
  healthBar: templatePath('actor/partials/health-bar.hbs'),
  defenses: templatePath('actor/partials/defenses.hbs'),
  itemRow: templatePath('actor/partials/item-row.hbs'),
  unresolved: templatePath('actor/partials/unresolved.hbs'),
  attackList: templatePath('actor/partials/attack-list.hbs'),
  vehicleWeaponList: templatePath('actor/partials/vehicle-weapon-list.hbs'),
  skillList: templatePath('actor/partials/skill-list.hbs'),
  buffList: templatePath('actor/partials/buff-list.hbs'),
  richFields: templatePath('actor/partials/rich-fields.hbs'),
  crewing: templatePath('actor/partials/crewing.hbs'),
});

/**
 * Run a sheet action, surfacing any failure (e.g. a rejected update) as an error
 * notification instead of an unhandled rejection.
 * @param {() => Promise<unknown>|unknown} fn
 * @returns {Promise<void>}
 */
export const runGuarded = async (fn) => {
  try {
    await fn();
  } catch (err) {
    ui.notifications.error(err, { console: true });
  }
};

/**
 * A modal Yes / No confirm (DialogV2.confirm). Resolves true only on Yes; closing it is a No.
 * `html` is inserted as TRUSTED HTML inside a <p>: the caller must escape any data in it
 * (foundry.utils.escapeHTML), e.g. actor names.
 * @param {string} titleKey - i18n key for the window title
 * @param {string} html - the (already localized and escaped) message
 * @returns {Promise<boolean>}
 */
export const confirmYesNo = async (titleKey, html) => (await foundry.applications.api.DialogV2.confirm({
  window: { title: game.i18n.localize(titleKey) },
  content: `<p>${html}</p>`,
  classes: [...APP_CLASSES],
  rejectClose: false,
  modal: true,
})) === true;

/** Shared ApplicationV2 actor sheet for all DCC actor types. */
export default class DCCActorSheetBase extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheet) {
  static DEFAULT_OPTIONS = {
    classes: ['dcc', 'sheet', 'actor'],
    position: { width: 720, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      configureSheet: DCCActorSheetBase.#onConfigureSheet,
      setSlots: DCCActorSheetBase.#onSetSlots,
      healSlot: DCCActorSheetBase.#onHealSlot,
      createItem: DCCActorSheetBase.#onCreateItem,
      editItem: DCCActorSheetBase.#onEditItem,
      deleteItem: DCCActorSheetBase.#onDeleteItem,
      rollAttack: DCCActorSheetBase.#onRollAttack,
    },
  };

  /**
   * Rich-text parts: part id -> the HTMLFields it edits, in display order
   * (`{key, label, wide?}`; `wide` spans both grid columns). Such a part gets
   * `context.richFields` (see #richTextFields) for partials/rich-fields.hbs.
   * @type {Record<string, {key:string, label:string, wide?:boolean}[]>}
   */
  static RICH_TEXT_PARTS = {};

  /** Item types this sheet's actor may own (default: every item type). Subclasses narrow it. */
  static ALLOWED_ITEM_TYPES = Object.keys(itemModels);

  /** In-flight inline item updates (each settles without rejecting); see _settleInlineEdits. */
  #inlineEdits = new Set();

  /**
   * Reject dropped items whose type this actor cannot own, then defer to core
   * (which creates the item). Same-actor sorts and non-owner drops go straight
   * to core, which sorts or no-ops them.
   * @param {DragEvent} event
   * @param {Item} item
   * @returns {Promise<Item|null>}
   */
  async _onDropItem(event, item) {
    const sameActor = !!item?.parent && (item.parent.uuid === this.actor.uuid);
    if (sameActor || !this.actor.isOwner) return super._onDropItem(event, item);
    if (!this.constructor.ALLOWED_ITEM_TYPES.includes(item?.type)) {
      ui.notifications.warn(game.i18n.format('DCC.Drop.Rejected', {
        type: game.i18n.localize(`TYPES.Item.${item?.type}`),
        actorType: game.i18n.localize(`TYPES.Actor.${this.document.type}`),
      }));
      return null;
    }
    return super._onDropItem(event, item);
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      system: this.document.system,
      systemSource: this.document.system._source,
      config: CONFIG.DCC,
      items: this.document.itemTypes,
    });
  }

  /**
   * Health bar context for partials/health-bar.hbs: the slot view (displayed
   * healthBar vs the actor's slot count), the Con Mod each slot shows, and dying.
   */
  _healthContext() {
    const system = this.document.system;
    return {
      health: {
        slots: slotView(system.healthBarDisplay, system.healthBarSlots),
        constitutionModifier: system.healthConstitutionModifier,
        dying: isDying(system.healthBarDisplay),
      },
    };
  }

  /**
   * Save the form and wait for the update, so an action that reads the actor
   * right after sees what was just typed: leaving a field by clicking a button
   * fires its submitOnChange update without awaiting it. That blur update may
   * still be in flight, so this can send a second (harmless, same-value)
   * update. Rich-text fields are left out, so an open editor's unsaved text is
   * never committed by a button click. Validates like a normal submit; on an
   * invalid value it shows the error and returns false (the caller aborts).
   * Pending inline item edits are awaited first (see _settleInlineEdits).
   * @returns {Promise<boolean>} true when the action may proceed
   * @protected
   */
  async _flushForm() {
    await this._settleInlineEdits();
    if (!this.isEditable) return true;
    try {
      const formData = new foundry.applications.ux.FormDataExtended(this.form);
      for (const name of richTextFieldNames(this.constructor.RICH_TEXT_PARTS)) delete formData.object[name];
      const submitData = this._prepareSubmitData(null, this.form, formData);
      await this._processSubmitData(null, this.form, submitData);
      return true;
    } catch (err) {
      ui.notifications.error(err, { console: true });
      return false;
    }
  }

  /**
   * Tab wiring: a part whose id matches a tab in the (single) TABS group gets
   * that tab as `context.tab`, so TABS is the one source of truth for which
   * parts are tabs. The render context is shared across parts, so every other
   * part gets `tab` cleared rather than inheriting the previous part's.
   * @inheritDoc
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
    const richDefs = this.constructor.RICH_TEXT_PARTS[partId];
    context.richFields = richDefs ? await this.#richTextFields(richDefs) : undefined;
    return context;
  }

  /**
   * Each rich-text field with its DataField (for {{formInput}}, which names the
   * toggled <prose-mirror> `system.<key>`), the stored source value, and the
   * enriched HTML shown while the editor is closed. Saving an editor fires a
   * bubbling `change` on the form, so it rides the normal submitOnChange.
   */
  async #richTextFields(defs) {
    const actor = this.document;
    const fields = actor.system.schema.fields;
    const source = actor.system._source;
    const rollData = actor.getRollData();
    const { enrichHTML } = foundry.applications.ux.TextEditor.implementation;
    return Promise.all(defs.map(async ({ key, label, wide }) => {
      const value = source[key] ?? '';
      const enriched = await enrichHTML(value, { relativeTo: actor, secrets: actor.isOwner, rollData });
      return { key, label, wide, field: fields[key], value, enriched, empty: isBlankHTML(value) };
    }));
  }

  /**
   * Don't re-render a part while one of its rich-text editors is open: the
   * part's replaceWith would disconnect the editor, and its unsaved text would
   * be lost (a disconnected editor's save never reaches the form). Any actor
   * update (a health click, another user's edit) re-renders the sheet, so this
   * matters. The next render after the editor closes (its save submits)
   * refreshes the part.
   * @inheritDoc
   */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (options.isFirstRender || !options.parts) return;
    const editing = Object.entries(this.parts ?? {})
      .filter(([, el]) => el?.querySelector?.('prose-mirror.active'))
      .map(([id]) => id);
    if (editing.length) options.parts = options.parts.filter(id => !editing.includes(id));
  }

  /**
   * Re-render when a rich-text editor closes. A closed editor shows the
   * enriched HTML it was rendered with; if its text was already stored (another
   * field's submit carries the editor value), its save is a no-op update and
   * nothing else would refresh that stale view.
   * @inheritDoc
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('close', event => {
      if (event.target.matches?.('.dcc-bio prose-mirror')) this.render();
    });
  }

  /**
   * Name each rich-text editor by its label span (the field wrapper is not a <label>).
   * @inheritDoc
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // On a sheet this user can't edit, core just disabled every form control
    // (DocumentSheetV2#_onRender -> _toggleDisabled). Re-enable only the
    // allow-listed [data-view-only] ones (open an item / effect / crew / vehicle
    // sheet, crew quick-rolls), never anything that writes (isViewOnlyControl).
    if (!this.isEditable) enableViewOnlyControls(this.element);
    // .dcc-bio is the rich-field wrapper class from templates/actor/partials/rich-fields.hbs.
    for (const editor of this.element.querySelectorAll('.dcc-bio prose-mirror')) {
      const label = editor.closest('.dcc-bio-f')?.querySelector('.dcc-bio-lab');
      if (label?.id) editor.setAttribute('aria-labelledby', label.id);
    }
  }

  /**
   * Display-only move/step inputs are named `dcc.move` / `dcc.step`; turn an
   * edited value into `system.moveBase` / `system.stepBase` (backCalcBase
   * against the current flat bonus) before core validates the submit data.
   * Core: DocumentSheetV2#_prepareSubmitData calls this before validate.
   * @inheritDoc
   */
  _processFormData(event, form, formData) {
    return translateDefenseEdits(super._processFormData(event, form, formData), this.document.system);
  }

  /**
   * Inline item edits. A control inside a `[data-item-id]` row that carries
   * `data-field` (e.g. "system.rank") edits that owned item directly and is
   * NOT part of the actor form: it has no `name`, so FormDataExtended skips it,
   * and returning here without calling super means no actor submit fires.
   * Every other control falls through to the normal submitOnChange.
   * @inheritDoc
   */
  _onChangeForm(formConfig, event) {
    const control = event.target;
    const edit = inlineEditTarget(control);
    const item = edit ? this.document.items.get(edit.itemId) : null;
    if (!item) return super._onChangeForm(formConfig, event);
    if (!this.isEditable) return;
    const value = inlineFieldValue(control);
    // Blank / non-numeric number: restore the rendered value, write nothing.
    if (value === undefined) return DCCActorSheetBase.#restoreControl(control);
    const pending = item.update({ [edit.field]: value }).catch((err) => {
      DCCActorSheetBase.#restoreControl(control);
      ui.notifications.error(err, { console: true });
    });
    this.#inlineEdits.add(pending);
    pending.finally(() => this.#inlineEdits.delete(pending));
  }

  /**
   * Wait for in-flight inline item edits. An inline edit is not awaited (it
   * fires on change), and the item only changes once the server replies, so
   * a roll button clicked straight after (e.g. a vehicle weapon's Gunner or
   * Skill just edited: the text input's change fires on blur, before the
   * click) would otherwise read the old value.
   *
   * Risk: an update that never settles (a stalled socket) stalls the roll
   * with it. Deliberately no timeout: rolling on a stale value is the bug
   * this prevents, and a stalled socket breaks every other write too.
   * @returns {Promise<void>}
   * @protected
   */
  async _settleInlineEdits() {
    if (this.#inlineEdits.size) await Promise.all([...this.#inlineEdits]);
  }

  /** Put an inline control back to its rendered value. */
  static #restoreControl(control) {
    if (control.type === 'checkbox') control.checked = control.defaultChecked;
    else if (control.tagName === 'SELECT') {
      for (const opt of control.options) opt.selected = opt.defaultSelected;
    } else control.value = control.defaultValue;
  }

  /**
   * Core sorts against every `[data-item-id]` sibling in the drop list; the
   * Attacks list mixes weapons and attack spells, so restrict the target and
   * siblings to the dragged item's type. Otherwise the same as core
   * (ActorSheetV2#_onSortItem).
   * @override
   */
  _onSortItem(event, item) {
    const items = this.actor.items;
    const source = items.get(item.id);
    const dropTarget = event.target.closest('[data-item-id]');
    const target = dropTarget ? items.get(dropTarget.dataset.itemId) : null;
    if (!source || !target || (source.id === target.id) || (target.type !== source.type)) return;
    const siblings = [];
    for (const element of dropTarget.parentElement.children) {
      const sibling = items.get(element.dataset.itemId);
      if (sibling && (sibling.id !== source.id) && (sibling.type === source.type)) siblings.push(sibling);
    }
    const updateData = foundry.utils.performIntegerSort(source, { target, siblings })
      .map(({ target: t, update }) => ({ ...update, _id: t._id }));
    return this.actor.updateEmbeddedDocuments('Item', updateData);
  }

  /** The owned item whose `[data-item-id]` row holds `target`. */
  _itemFromTarget(target) {
    const id = target.closest('[data-item-id]')?.dataset.itemId;
    return id ? this.document.items.get(id) : undefined;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Header "Configure Sheet": core's dialog plus the actor's sheet settings
   * (DCCSheetConfig), positioned as core positions its own.
   * @this {DCCActorSheetBase}
   * @param {PointerEvent} event
   */
  static #onConfigureSheet(event) {
    event.stopPropagation();
    if (event.detail > 1) return;
    const width = DCCSheetConfig.DEFAULT_OPTIONS.position.width;
    this.renderChild(new DCCSheetConfig({
      document: this.document,
      position: { top: this.position.top + 40, left: this.position.left + ((this.position.width - width) / 2) },
    }));
  }

  /**
   * Health bar slot click (see slotClickTarget).
   * @this {DCCActorSheetBase}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target - carries data-slot (1-based)
   */
  static async #onSetSlots(_event, target) {
    const actor = this.document;
    await actor.setSlots(slotClickTarget(target.dataset.slot, actor.currentSlots));
  }

  /**
   * Heal one slot.
   * @this {DCCActorSheetBase}
   */
  static async #onHealSlot() {
    await this.document.healSlots(1);
  }

  /**
   * Create an owned item of `data-type` (one this actor may own) and open its sheet.
   * @this {DCCActorSheetBase}
   */
  static async #onCreateItem(_event, target) {
    if (!this.isEditable) return;
    const { type } = target.dataset;
    if (!this.constructor.ALLOWED_ITEM_TYPES.includes(type)) return;
    const typeLabel = game.i18n.localize(`TYPES.Item.${type}`);
    const [item] = await this.document.createEmbeddedDocuments('Item', [{
      type, name: game.i18n.format('DCC.Items.New', { type: typeLabel }),
    }]);
    item?.sheet.render(true);
  }

  /**
   * Attack roll; `data-roll` is 'toHit' or 'damage'. Saves pending input
   * first (_flushForm: form fields, then inline item edits), so the roll reads
   * what was just set; an invalid form aborts it (the item and roll kind are
   * read before the flush: a re-render replaces the DOM).
   * @this {DCCActorSheetBase}
   */
  static async #onRollAttack(_event, target) {
    const item = this._itemFromTarget(target);
    if (!item) return;
    const which = target.dataset.roll === 'damage' ? 'damage' : 'toHit';
    if (!(await this._flushForm())) return;
    await this.document.rollAttack(item, which);
  }

  /** Open an owned item's sheet. @this {DCCActorSheetBase} */
  static async #onEditItem(_event, target) {
    this._itemFromTarget(target)?.sheet.render(true);
  }

  /** Delete an owned item (core confirm dialog). @this {DCCActorSheetBase} */
  static async #onDeleteItem(_event, target) {
    if (!this.isEditable) return;
    await this._itemFromTarget(target)?.deleteDialog({ classes: [...APP_CLASSES] });
  }
}
