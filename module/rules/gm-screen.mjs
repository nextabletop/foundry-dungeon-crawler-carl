// GM screen rules (Chunk 8): the Crawler <-> screen link, the floor-end
// cursor and the roster. See docs/superpowers/specs/2026-09-23-gm-screen-design.md
// (Foundry design). No Foundry globals — see foundry/module/rules/ conventions.
//
// A screen is a `gmscreen` actor with `system { safehouse, floorEndSeq,
// roster }`; roster entries are world-actor UUIDs. A linked Crawler holds its
// own cursor `floorEndDone` (+ `floorEndEpoch`, bumped on every baseline).

export const GM_SCREEN_TYPE = 'gmscreen';

/** Floor ends a linked Crawler may still run (floor ends stack). */
export const floorEndsAvailable = (seq, done) => Math.max(0, (+seq || 0) - (+done || 0));

/** End Floor is refused: a linked Crawler with no unconsumed floor end. Unlinked (or no gate) is never blocked.
 *  `!(available > 0)` fails closed on a non-number. The ONE rule for DCCActor#endFloor and advancementView. */
export const floorEndBlocked = gate => !!gate?.linked && !(gate.available > 0);

/** The base (world) actor of a Crawler, and the UUID it is rostered by, even for a sheet opened from an unlinked token.
 *  v14: the base actor hangs off the TokenDocument (actor.token.baseActor); Actor has no baseActor. */
export const baseActor = actor => (actor?.isToken ? actor.token?.baseActor : actor) ?? null;
export const baseActorUuid = actor => baseActor(actor)?.uuid ?? null;

const NO_LINK = Object.freeze({ screen: null, linked: false });

/**
 * { screen, linked }. `actorsById` is anything with get(id) (game.actors, a Map).
 * Fails open: blank id, missing actor or a non-gmscreen actor -> { screen: null, linked: false }.
 */
export const resolveGmLink = ({ settingId, actorsById, baseUuid } = {}) => {
  if (!settingId) return { ...NO_LINK };
  const screen = actorsById?.get?.(settingId) ?? null;
  if (screen?.type !== GM_SCREEN_TYPE) return { ...NO_LINK };
  const linked = !!baseUuid && (screen.system?.roster ?? []).includes(baseUuid);
  return { screen, linked };
};

// Shared and frozen: gmGate returns this very object, so callers must not
// mutate the returned gate (spread it to change a field).
export const UNLINKED = Object.freeze({ linked: false, safehouse: false, available: null });

/**
 * The Crawler-side gate from a resolved link and the PC's SOURCE system data:
 * linked   -> { linked: true, safehouse: !!screen.system.safehouse, available: floorEndsAvailable(seq, pc.floorEndDone) }
 * unlinked -> { linked: false, safehouse: false, available: null }
 */
export const gmGate = ({ screen, linked } = {}, pcSource = {}) => {
  if (!linked || !screen) return UNLINKED;
  const system = screen.system ?? {};
  return { linked: true, safehouse: !!system.safehouse, available: floorEndsAvailable(system.floorEndSeq, pcSource?.floorEndDone) };
};

/** Baseline a PC to the screen's counter: cursor = seq, epoch + 1 (dotted update keys). */
export const baselineUpdate = (pcSource = {}, seq = 0) => ({
  'system.floorEndDone': +seq || 0,
  'system.floorEndEpoch': (+pcSource?.floorEndEpoch || 0) + 1,
});

/** Non-blank strings, first occurrence kept, order preserved. */
export const uniqueUuids = list => [...new Set((list ?? []).filter(u => (typeof u === 'string') && u))];

/** The roster after adding `uuid`, or null when uuid is blank or already rostered (caller writes nothing). */
export const rosterAdd = (roster, uuid) => {
  const r = roster ?? [];
  return (!uuid || r.includes(uuid)) ? null : [...r, uuid];
};
export const rosterRemove = (roster, uuid) => (roster ?? []).filter(u => u !== uuid);

/**
 * A resolved roster entry that counts as a Crawler: a world pc Actor. A hand-edited uuid resolving
 * to a mob, an Item, a compendium actor or an index entry (no documentName) does not: it is never
 * baselined, never blocks Undo End Floor and shows as an invalid row. The ONE rule for
 * GmScreenModel and the sheet's roster rows.
 */
export const isRosterPc = a => (a?.documentName === 'Actor') && (a.type === 'pc') && !a.pack;

/**
 * Names of rostered Crawlers that already consumed the latest floor end (cursor >= seq),
 * which block Undo End Floor. `pcs`: [{ name, floorEndDone }]; null entries (missing actors) are skipped.
 * seq <= 0 -> [] (nothing to undo; the caller refuses separately).
 */
export const undoFloorEndBlockers = (seq, pcs = []) => {
  const n = +seq || 0;
  if (n <= 0) return [];
  return (pcs ?? []).filter(pc => pc && (+pc.floorEndDone || 0) >= n).map(pc => pc.name);
};
