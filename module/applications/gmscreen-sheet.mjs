import DCCActorSheetBase, { templatePath as path, runGuarded, confirmYesNo } from './actor-sheet-base.mjs';
import { gmRosterRows, undoFloorView, singleFlight } from './sheet-rows.mjs';
import { isRosterPc } from '../rules/gm-screen.mjs';
import { gmScreenId, rosterEntries } from '../gm-link.mjs';

/**
 * GM screen sheet (Chunk 8, Task 30): the Safehouse toggle, the floor-end counter
 * (display-only, so nobody can bypass the Undo guard by typing), GM End Floor / Undo
 * End Floor and the Crawler roster. Thin: the operations live on GmScreenModel
 * (Task 29) and every one re-checks isGM.
 *
 * Drops: core only lets an editable sheet's drop through (_canDragDrop -> isEditable),
 * and _onDropActor repeats isGM + isEditable as a backstop before any write, because a
 * roster add writes a PC baseline a player may own. No items (ALLOWED_ITEM_TYPES = []).
 *
 * Re-renders: the screen's own updates re-render it (core); a rostered PC's updates and
 * the setting change go through gm-link.mjs's hooks and the shared sheet-refresh queue.
 */
export default class GmScreenSheet extends DCCActorSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ['gmscreen'],
    position: { width: 560, height: 620 },
    actions: {
      gmEndFloor: GmScreenSheet.#onEndFloor,
      gmUndoFloor: GmScreenSheet.#onUndoFloor,
      gmRemove: GmScreenSheet.#onRemove,
    },
  };

  static ALLOWED_ITEM_TYPES = [];

  static PARTS = {
    body: { template: path('actor/gmscreen/body.hbs'), scrollable: [''] },
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const seq = this.document.system._source.floorEndSeq;
    const roster = gmRosterRows(rosterEntries(this.document), seq);
    const undo = undoFloorView(seq, roster, context.editable);
    return Object.assign(context, {
      roster,
      floorEndSeq: seq,
      canUndoFloor: undo.canUndo,
      // Pre-localized (the template shows it as-is): Blocked names the Crawlers, as the model's warning does.
      undoFloorTooltip: undo.blockers.length
        ? game.i18n.format(undo.reason, { names: game.i18n.getListFormatter().format(undo.blockers) })
        : game.i18n.localize(undo.reason),
      isConfigured: this.document.id === gmScreenId(),
    });
  }

  /**
   * Dropping a Crawler rosters it (GmScreenModel#addToRoster refuses non-PCs and
   * compendium actors, and shows the re-drop notice itself).
   * @param {DragEvent} _event
   * @param {Actor} actor
   * @returns {Promise<Actor[]|null>}
   * @override
   */
  async _onDropActor(_event, actor) {
    if (!game.user.isGM || !this.isEditable) return null;
    return this.document.system.addToRoster(actor);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * End Floor and Undo End Floor share one flight (singleFlight) around confirm
   * + write: a second click while the confirm is open is dropped, so two Yes
   * answers can't bump the counter twice.
   * @type {(fn: () => Promise<unknown>) => Promise<void|null>}
   */
  #gmAction = singleFlight(fn => runGuarded(fn));

  /**
   * GM End Floor: confirm, listing the present roster (or saying it is empty), then +1.
   * The model reads its _source only after the confirm resolves.
   * @this {GmScreenSheet}
   */
  static async #onEndFloor() {
    if (!this.isEditable) return;
    await this.#gmAction(async () => {
      const names = rosterEntries(this.document).map(e => e.actor).filter(isRosterPc)
        .map(a => foundry.utils.escapeHTML(a.name ?? ''));
      const content = names.length
        ? game.i18n.format('DCC.GmScreen.ConfirmContent', { names: game.i18n.getListFormatter().format(names) })
        : game.i18n.localize('DCC.GmScreen.ConfirmEmpty');
      if (await confirmYesNo('DCC.GmScreen.ConfirmTitle', content)) await this.document.system.endFloor();
    });
  }

  /**
   * Undo End Floor: confirm, then -1. The button is already disabled while a rostered Crawler
   * has used the latest floor end (undoFloorView); the model re-checks after the confirm,
   * since a Crawler's End Floor on another client can land in between.
   * @this {GmScreenSheet}
   */
  static async #onUndoFloor() {
    if (!this.isEditable) return;
    await this.#gmAction(async () => {
      const content = game.i18n.localize('DCC.GmScreen.ConfirmUndoContent');
      if (await confirmYesNo('DCC.GmScreen.ConfirmUndoTitle', content)) await this.document.system.undoEndFloor();
    });
  }

  /** Unroster a Crawler (a missing one too); its gates lift. @this {GmScreenSheet} */
  static async #onRemove(_event, target) {
    const uuid = target.closest('[data-uuid]')?.dataset.uuid;
    if (!this.isEditable || !uuid) return;
    await runGuarded(() => this.document.system.removeFromRoster(uuid));
  }
}
