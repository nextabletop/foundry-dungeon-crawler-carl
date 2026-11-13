import DCCCreatureSheet from './creature-sheet.mjs';
import { ACTOR_PARTIALS, templatePath as path, runGuarded, confirmYesNo } from './actor-sheet-base.mjs';
import { inventoryView, hotlistCells, advancementView, singleFlight } from './sheet-rows.mjs';
import { ITEM_SLOTS, HOTLIST_CAP, ACCESSORY_CAP, APP_CLASSES } from '../config.mjs';

/** Inventory slot <select> choices: value -> label key. */
const SLOT_OPTIONS = Object.freeze(Object.fromEntries(ITEM_SLOTS.map(s => [s, `DCC.Slot.${s}`])));

/**
 * Bio tab rich-text fields (HTMLFields on the pc / creature model), in display
 * order. `wide` spans both grid columns (R20 `.dcc-bio .f.span2`). Rendered by
 * the base sheet's RICH_TEXT_PARTS machinery.
 */
const BIO_FIELDS = Object.freeze([
  { key: 'popularity', label: 'DCC.Bio.Popularity' },
  { key: 'pastTrauma', label: 'DCC.Bio.PastTrauma' },
  { key: 'looseEnds', label: 'DCC.Bio.LooseEnds' },
  { key: 'regrets', label: 'DCC.Bio.Regrets' },
  { key: 'notes', label: 'DCC.Bio.Notes', wide: true },
]);

const COMBAT_PART = {
  template: path('actor/pc/combat.hbs'),
  templates: [ACTOR_PARTIALS.defenses, ACTOR_PARTIALS.unresolved],
};

/**
 * The tab parts, in tab order. Single source for both TABS (the nav) and the
 * matching PARTS entries; the base sheet hands each part its `context.tab`.
 */
const TAB_PARTS = {
  attacks: {
    template: path('actor/pc/attacks.hbs'),
    templates: [ACTOR_PARTIALS.attackList, ACTOR_PARTIALS.crewing, ACTOR_PARTIALS.itemRow],
    scrollable: [''],
  },
  buffs: { template: path('actor/pc/buffs.hbs'), templates: [ACTOR_PARTIALS.buffList, ACTOR_PARTIALS.itemRow], scrollable: [''] },
  inventory: { template: path('actor/pc/inventory.hbs'), templates: [ACTOR_PARTIALS.itemRow], scrollable: [''] },
  skills: { template: path('actor/pc/skills.hbs'), templates: [ACTOR_PARTIALS.skillList, ACTOR_PARTIALS.itemRow], scrollable: [''] },
  bio: { template: path('actor/pc/bio.hbs'), templates: [ACTOR_PARTIALS.richFields], scrollable: [''] },
};

export default class PcSheet extends DCCCreatureSheet {
  static DEFAULT_OPTIONS = {
    classes: ['pc'],
    position: { width: 720, height: 900 },
    actions: {
      createInventoryItem: PcSheet.#onCreateInventoryItem,
      createSkillOrSpell: PcSheet.#onCreateSkillOrSpell,
      useHotlist: PcSheet.#onUseHotlist,
      advancementEndSession: PcSheet.#onAdvancementEndSession,
      advancementEndFloor: PcSheet.#onAdvancementEndFloor,
      advancementLevelUp: PcSheet.#onAdvancementLevelUp,
      advancementUndo: PcSheet.#onAdvancementUndo,
    },
  };

  static RICH_TEXT_PARTS = { bio: BIO_FIELDS };

  static TABS = {
    primary: {
      tabs: Object.keys(TAB_PARTS).map(id => ({ id })),
      initial: 'attacks',
      labelPrefix: 'DCC.Tab',
    },
  };

  /**
   * The R20 frame as sibling parts; system.css places them on a grid (header
   * across the top, abilities down the left, vitals / tab strip / tab body to
   * its right, hotlist pinned across the bottom). Only the tab body scrolls.
   */
  static PARTS = {
    header: { template: path('actor/pc/header.hbs') },
    abilities: { template: path('actor/pc/abilities.hbs') },
    vitals: { template: path('actor/pc/vitals.hbs'), templates: [ACTOR_PARTIALS.healthBar] },
    combat: COMBAT_PART,
    tabs: { template: 'templates/generic/tab-navigation.hbs' },
    ...TAB_PARTS,
    hotlist: { template: path('actor/pc/hotlist.hbs') },
  };

  /**
   * Inventory tab (paper doll, accessories, gear + weapon list) and the
   * header hotlist strip.
   * @inheritDoc
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // One SOURCE snapshot feeds both the view and the GM screen gate: the same
    // DCCActor#advancementGate that endFloor / levelUp re-check, so the buttons
    // and the refusals can never disagree.
    const src = this.document.system._source;
    return Object.assign(context, {
      ...inventoryView(this.document.itemTypes),
      skillsAndSpells: [...context.skills, ...context.spells],
      hotlist: hotlistCells(this.document.items.contents, HOTLIST_CAP).map(PcSheet.#hotlistLabel),
      hotlistCap: HOTLIST_CAP,
      accessoryCap: ACCESSORY_CAP,
      slotOptions: SLOT_OPTIONS,
      advancement: advancementView(src, context.editable, this.document.advancementGate(src)),
    });
  }

  /**
   * A filled hotlist cell's tooltip / aria-label: name, the ×N quantity when
   * above 1, and what a click does. Empty (null) cells pass through.
   */
  static #hotlistLabel(cell) {
    if (!cell) return cell;
    const action = game.i18n.localize(cell.hint);
    const label = cell.quantity
      ? game.i18n.format('DCC.Hotlist.CellQuantity', { name: cell.name, quantity: cell.quantity, action })
      : game.i18n.format('DCC.Hotlist.Cell', { name: cell.name, action });
    return { ...cell, label };
  }

  #createInventoryItem = singleFlight(() => runGuarded(async () => {
    if (!this.isEditable) return;
    const type = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('DCC.Inventory.AddItem') },
      content: `<p>${foundry.utils.escapeHTML(game.i18n.localize('DCC.Inventory.ChooseItemType'))}</p>`,
      buttons: [
        { action: 'gear', label: game.i18n.localize('TYPES.Item.gear') },
        { action: 'weapon', label: game.i18n.localize('TYPES.Item.weapon') },
        { action: 'cancel', label: game.i18n.localize('DCC.Inventory.Cancel') },
      ],
      classes: [...APP_CLASSES],
      rejectClose: false,
      modal: true,
    });
    if (type === null || type === 'cancel') return;
    if (type !== 'gear' && type !== 'weapon') throw new Error(`Unexpected inventory item type: ${type}`);
    await this._createOwnedItem(type);
  }));

  /** @this {PcSheet} */
  static async #onCreateInventoryItem() {
    await this.#createInventoryItem();
  }

  #createSkillOrSpell = singleFlight(() => runGuarded(async () => {
    if (!this.isEditable) return;
    const type = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('DCC.Items.AddSkillOrSpell') },
      content: `<p>${foundry.utils.escapeHTML(game.i18n.localize('DCC.Items.ChooseSkillOrSpell'))}</p>`,
      buttons: [
        { action: 'skill', label: game.i18n.localize('TYPES.Item.skill') },
        { action: 'spell', label: game.i18n.localize('TYPES.Item.spell') },
        { action: 'cancel', label: game.i18n.localize('DCC.Inventory.Cancel') },
      ],
      classes: [...APP_CLASSES],
      rejectClose: false,
      modal: true,
    });
    if (type === null || type === 'cancel') return;
    if (type !== 'skill' && type !== 'spell') throw new Error(`Unexpected skill or spell item type: ${type}`);
    await this._createOwnedItem(type);
  }));

  /** @this {PcSheet} */
  static async #onCreateSkillOrSpell() {
    await this.#createSkillOrSpell();
  }

  /**
   * Hotlist click. The dispatch lives on DCCActor#useHotlistItem so crew
   * rolls and macros share it; the sheet only resolves the item.
   * @this {PcSheet}
   */
  static async #onUseHotlist(_event, target) {
    const item = this._itemFromTarget(target);
    if (!item || !(await this._flushForm())) return;
    await this.document.useHotlistItem(item);
  }

  /* -------------------------------------------- */
  /*  Advancement (thin: the rules live on DCCActor) */
  /* -------------------------------------------- */

  /**
   * Run an advancement action (runGuarded) after saving pending input
   * (_flushForm): End Session / End Floor / Level Up read the Floor, Level and
   * the skills' Mark / Rank / Check Type, and Undo restores them (an in-flight
   * edit landing after the restore would win). An invalid form aborts it.
   * One flight for all four actions (singleFlight): the flush and End Floor's
   * confirm run before the actor's own guard, so without it a second click
   * would open a second confirm and a Yes to both would advance twice. A click
   * while one is in flight is dropped.
   * @type {(fn: () => Promise<unknown>) => Promise<void|null>}
   */
  #advancement = singleFlight(fn => runGuarded(async () => {
    if (await this._flushForm()) await fn();
  }));

  /** @this {PcSheet} */
  static async #onAdvancementEndSession() {
    await this.#advancement(() => this.document.endSession());
  }

  /**
   * End Floor asks first (a floor is a big, rare step; End Session does not).
   * @this {PcSheet}
   */
  static async #onAdvancementEndFloor() {
    await this.#advancement(async () => {
      const proceed = await confirmYesNo('DCC.Advance.ConfirmFloorTitle',
        foundry.utils.escapeHTML(game.i18n.format('DCC.Advance.ConfirmFloorContent', { name: this.document.name })));
      if (proceed) await this.document.endFloor();
    });
  }

  /** @this {PcSheet} */
  static async #onAdvancementLevelUp() {
    await this.#advancement(() => this.document.levelUp());
  }

  /** @this {PcSheet} */
  static async #onAdvancementUndo() {
    await this.#advancement(() => this.document.undoAdvancement());
  }
}
