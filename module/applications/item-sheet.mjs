import { SYSTEM_ID, STATS, CHECK_TYPES, ITEM_SLOTS, DAMAGE_TYPES, GUNNER_SLOTS, APP_CLASSES } from '../config.mjs';
import { itemModels } from '../data/item/_module.mjs';
import { DCC_CHANGE_TYPE, describeChange } from '../effects/dcc-change.mjs';
import { enableViewOnlyControls, isBlankHTML } from './sheet-rows.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Partials shared by the per-type item templates (header, description). */
const ITEM_PARTIALS = ['header', 'description'].map(p => `systems/${SYSTEM_ID}/templates/item/partials/${p}.hbs`);

/**
 * <select> options ({value, label} lang keys) for the item fields that have choices. Arrays, not
 * value -> label records: a record would list integer-like keys ('1'..'4' gunner slots) first.
 */
const OPTION_KEYS = Object.freeze({
  stat: STATS.map(v => ({ value: v, label: `DCC.Stat.${v}` })),
  checkType: CHECK_TYPES.map(v => ({ value: v, label: `DCC.CheckType.${v}` })),
  slot: ITEM_SLOTS.map(v => ({ value: v, label: `DCC.Slot.${v}` })),
  damageType: ['', ...DAMAGE_TYPES].map(v => ({ value: v, label: `DCC.DamageType.${v || 'none'}` })),
  gunnerSlot: ['', ...GUNNER_SLOTS].map(v => ({ value: v, label: `DCC.Vehicle.GunnerSlot.${v || 'none'}` })),
});

/**
 * Item sheet: one part per item type (its fields in DCC boxes; labels, hints and placeholders
 * come from DCC.Item.FIELDS via BaseItemModel.LOCALIZATION_PREFIXES) plus a shared modifiers list.
 */
export default class DCCItemSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheet) {
  static DEFAULT_OPTIONS = {
    classes: ['dcc', 'sheet', 'item'],
    position: { width: 520, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      createEffect: DCCItemSheet.#onCreateEffect,
      editEffect: DCCItemSheet.#onEditEffect,
      deleteEffect: DCCItemSheet.#onDeleteEffect,
    },
  };

  static PARTS = {
    ...Object.fromEntries(Object.keys(itemModels).map(type => [type, {
      template: `systems/${SYSTEM_ID}/templates/item/${type}.hbs`, templates: ITEM_PARTIALS, scrollable: [''],
    }])),
    effects: { template: `systems/${SYSTEM_ID}/templates/item/effects.hbs` },
  };

  /** Render only the part for this item's type, plus the shared effects part. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    for (const id of Object.keys(parts)) {
      if ((id !== this.document.type) && (id !== 'effects')) delete parts[id];
    }
    return parts;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const systemSource = system._source;
    const systemFields = system.schema.fields;
    // Templates bind systemSource (stored values) so submitOnChange never writes derived/AE-modified values back.
    const selectOptions = Object.fromEntries(Object.entries(OPTION_KEYS).map(([field, options]) => [field,
      options.map(({ value, label }) => ({ value, label: game.i18n.localize(label) }))]));
    const description = systemSource.description ?? '';
    const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(description, {
      relativeTo: this.document, secrets: this.document.isOwner, rollData: this.document.getRollData(),
    });
    const effects = this.document.effects.contents.map(effect => ({
      id: effect.id,
      name: effect.name,
      img: effect.img,
      disabled: effect.disabled,
      suppressed: effect.isSuppressed,
      changes: effect.system.changes.map(describeChange).join(', '),
    }));
    return Object.assign(context, {
      system,
      systemSource,
      systemFields,
      selectOptions,
      typeLabel: game.i18n.localize(CONFIG.Item.typeLabels[this.document.type] ?? this.document.type),
      descriptionHTML,
      descriptionEmpty: isBlankHTML(description),
      effects,
      config: CONFIG.DCC,
    });
  }

  /**
   * On a sheet this user can't edit, core has just disabled every form control
   * (DocumentSheetV2#_toggleDisabled); re-enable only the allow-listed
   * [data-view-only] ones (open an effect's sheet), as the actor sheets do.
   * @inheritDoc
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this.isEditable) enableViewOnlyControls(this.element);
    // Name the description editor by its bar (templates/item/partials/description.hbs).
    const label = this.element.querySelector('.dcc-item-desc > .dcc-bar');
    this.element.querySelector('.dcc-item-desc prose-mirror')?.setAttribute('aria-labelledby', label?.id ?? '');
  }

  /**
   * Re-render when the description editor closes. A closed editor shows the
   * enriched HTML it was rendered with; if its text was already stored (another
   * field's submit carries the editor value), its save is a no-op update and
   * nothing else would refresh that stale view.
   * @inheritDoc
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('close', event => {
      if (event.target.matches?.('.dcc-item-desc prose-mirror')) this.render();
    });
  }

  /**
   * Don't re-render the type part while its description editor is open: the
   * replaceWith would disconnect the editor and lose its unsaved text (as on
   * the actor sheets; see DCCActorSheetBase#_configureRenderOptions).
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

  /** The effect whose row holds the clicked control. */
  _effectFromTarget(target) {
    const id = target.closest('[data-effect-id]')?.dataset.effectId;
    return this.document.effects.get(id);
  }

  /** "+ Modifier": a transferred effect with one initial-phase dcc change, then open its config. */
  static async #onCreateEffect() {
    const item = this.document;
    const [effect] = await item.createEmbeddedDocuments('ActiveEffect', [{
      name: game.i18n.localize('DCC.Effect.NewName'),
      img: item.img,
      transfer: true,
      system: { changes: [{ key: 'strength', type: DCC_CHANGE_TYPE, value: '1', phase: 'initial' }] },
    }]);
    effect?.sheet.render(true);
  }

  static async #onEditEffect(event, target) {
    this._effectFromTarget(target)?.sheet.render(true);
  }

  static async #onDeleteEffect(event, target) {
    await this._effectFromTarget(target)?.deleteDialog({ classes: [...APP_CLASSES] });
  }
}
