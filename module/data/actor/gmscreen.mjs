import { int, bool } from '../_fields.mjs';
import { baseActor, baselineUpdate, isRosterPc, rosterAdd, rosterRemove, undoFloorEndBlockers, uniqueUuids } from '../../rules/gm-screen.mjs';
import { rosterEntries } from '../../gm-link.mjs';

/**
 * The GM screen (Chunk 8): party-wide gates for rostered Crawlers. See
 * docs/superpowers/specs/2026-09-23-gm-screen-design.md and rules/gm-screen.mjs.
 * Standalone (no creature derive, health or _modifiers).
 * - `safehouse` — while off, a linked Crawler can't Level Up
 * - `floorEndSeq` — floor-end counter; each linked PC's `floorEndDone` is its cursor
 * - `roster` — world-actor UUIDs of linked Crawlers, deduped on write
 *
 * Operations (Task 29) are GM-only: baselines write PCs a player may own, so every
 * method starts with the isGM check. All read `this._source`. Writes are absolute values
 * (never increments), so a repeated click or two clients acting on the same intent write
 * the same value. Races ACROSS documents (screen vs PC, or two GMs on the screen) are
 * last-write-wins and not guarded; see the plan's "Known limitations (cross-client races)".
 */
export default class GmScreenModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      safehouse: bool(false),
      floorEndSeq: int(0, { min: 0 }),
      roster: new fields.ArrayField(new fields.DocumentUUIDField({ type: 'Actor', embedded: false }),
        { required: true, initial: [] }),
    };
  }

  /**
   * Default Observer ownership (players read, only the GM writes), and dedupe a
   * roster arriving with the create (duplicated or imported screen).
   * @override
   */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    // Only default ownership when unset: a duplicated screen keeps the ownership its GM chose.
    // The data.system.roster fallback only matters for a partial (or mocked) source; core's
    // _source always carries the cleaned roster.
    this.parent.updateSource({
      ...((data.ownership?.default === undefined)
        ? { 'ownership.default': CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } : {}),
      'system.roster': uniqueUuids(this._source?.roster ?? data.system?.roster),
    });
  }

  /**
   * Backstop dedupe of a roster write; the add path dedupes before writing.
   * @override
   */
  async _preUpdate(changes, options, user) {
    if (Array.isArray(changes.system?.roster)) changes.system.roster = uniqueUuids(changes.system.roster);
    return super._preUpdate(changes, options, user);
  }


  /**
   * Roster a Crawler: baseline its BASE actor to the current counter and write the roster
   * in ONE updateDocuments request, baseline row first. The server applies the batch as one
   * write, but the client drops any row a hook vetoes or that fails validation, and sends
   * the rest. If the baseline row is dropped while the roster row lands, the PC would be
   * linked with a stale cursor (phantom floor ends), so the roster entry is taken back out.
   * A re-drop writes nothing, so stacked floor ends survive.
   * @param {Actor} pc - the dropped actor (a token actor is rostered by its base actor)
   * @returns {Promise<Actor[]|null>} the updated documents, or null when refused, already
   *   rostered or rolled back
   */
  async addToRoster(pc) {
    if (!game.user.isGM) return null;
    const reject = () => { ui.notifications.warn(game.i18n.localize('DCC.GmScreen.DropRejected')); return null; };
    if ((pc?.type !== 'pc') || pc.pack) return reject();
    const base = baseActor(pc);
    const uuid = base?.uuid;
    if (!base || !uuid) return reject();
    const name = base.name ?? pc.name;
    const next = rosterAdd(this._source.roster, uuid);
    if (!next) {
      ui.notifications.info(game.i18n.format('DCC.GmScreen.AlreadyRostered', { name }));
      return null;
    }
    const updated = await foundry.documents.Actor.implementation.updateDocuments([
      { _id: base.id, ...baselineUpdate(base.system?._source, this._source.floorEndSeq) },
      { _id: this.parent.id, 'system.roster': next },
    ]);
    if ((updated ?? []).some(d => (d?.id ?? d?._id) === base.id)) return updated;
    ui.notifications.warn(game.i18n.format('DCC.GmScreen.AddFailed', { name }));
    if ((this._source.roster ?? []).includes(uuid)) {
      await this.parent.update({ 'system.roster': rosterRemove(this._source.roster, uuid) });
    }
    return null;
  }

  /**
   * Unroster a Crawler (its gates lift). No PC write: a later re-add re-baselines.
   * @param {string} uuid - the roster entry
   * @returns {Promise<Actor|null>} the updated screen actor, or null for a non-GM
   */
  async removeFromRoster(uuid) {
    if (!game.user.isGM) return null;
    return this.parent.update({ 'system.roster': rosterRemove(this._source.roster, uuid) });
  }

  /**
   * GM End Floor: counter + 1 only. The confirm dialog is the sheet's (Task 30).
   * @returns {Promise<Actor|null>} the updated screen actor, or null for a non-GM
   */
  async endFloor() {
    if (!game.user.isGM) return null;
    return this.parent.update({ 'system.floorEndSeq': this._source.floorEndSeq + 1 });
  }

  /**
   * Undo End Floor: counter - 1. Refused at 0, and while any rostered Crawler's cursor has
   * reached the counter (named in the warning); a missing actor never blocks.
   * The blocker check reads cached cursors, so a PC's End Floor on another client can land
   * in between (see the plan's "Known limitations (cross-client races)"). That can't be
   * prevented; after the write the cursors are re-read and the GM is warned, naming any
   * Crawler now ahead of the counter.
   * @returns {Promise<Actor|null>} the updated screen actor, or null when refused
   */
  async undoEndFloor() {
    if (!game.user.isGM) return null;
    const seq = this._source.floorEndSeq;
    if (!(seq > 0)) return null;
    const cursor = a => a.system?._source?.floorEndDone;
    const blockers = undoFloorEndBlockers(seq, rosterPcs(this._source.roster)
      .map(a => ({ name: a.name, floorEndDone: cursor(a) })));
    if (blockers.length) {
      ui.notifications.warn(game.i18n.format('DCC.GmScreen.UndoBlocked', { names: listFormat(blockers) }));
      return null;
    }
    const updated = await this.parent.update({ 'system.floorEndSeq': seq - 1 });
    const raced = rosterPcs(this._source.roster).filter(a => (+cursor(a) || 0) > (seq - 1)).map(a => a.name);
    if (raced.length) ui.notifications.warn(game.i18n.format('DCC.GmScreen.UndoRaced', { names: listFormat(raced) }));
    return updated;
  }

  /**
   * Baseline every rostered Crawler in one request (setting onChange); missing and non-PC
   * entries are skipped.
   * @returns {Promise<Actor[]|null>} the updated PCs, or null when there is nothing to write
   */
  async rebaselineRoster() {
    if (!game.user.isGM) return null;
    const seq = this._source.floorEndSeq;
    const rows = rosterPcs(this._source.roster)
      .map(actor => ({ _id: actor.id, ...baselineUpdate(actor.system?._source, seq) }));
    if (!rows.length) return null;
    return foundry.documents.Actor.implementation.updateDocuments(rows);
  }
}

/** Present, world PC actors on the roster; a missing or edited uuid resolving to anything else is skipped. */
const rosterPcs = roster => rosterEntries(roster).map(e => e.actor).filter(isRosterPc);

const listFormat = names => game.i18n.getListFormatter().format(names);
