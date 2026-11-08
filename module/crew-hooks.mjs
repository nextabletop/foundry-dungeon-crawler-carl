import { crewRenderTargets, crewEvent, owningActor, touchesCrew } from './rules/crew.mjs';
import { openActorSheets, queueRender } from './sheet-refresh.mjs';

/**
 * Crew refresh (Task 21). A vehicle's crew rows read the live crew actors, and
 * a PC / Mob sheet's Crewing line reads the vehicles' crew lists, so neither
 * sheet re-renders on its own when the OTHER actor changes. These hooks
 * re-render the affected open sheets. The decisions (which sheets, which
 * changes count, the owning actor) are pure and tested in rules/crew.mjs;
 * this module is wiring only. Hooks fire on every client and only ever
 * render — no document writes.
 *
 * Deliberately imports no sheet class: sheets are told apart by their actor's
 * type, and a PC / Mob sheet exposes `crewingUuids` (DCCCreatureSheet).
 */

/** A sheet in the shape crewRenderTargets reads. */
const describeSheet = (app) => {
  const actor = app.document;
  const isVehicle = actor.type === 'vehicle';
  return {
    id: app.id,
    type: actor.type,
    uuid: actor.uuid,
    crew: isVehicle ? crewEvent(actor).crew : undefined,
    crewing: isVehicle ? undefined : (app.crewingUuids ?? []),
  };
};

/** Queue a re-render of the open sheets an actor change affects. */
const refresh = (event) => {
  if (!event?.uuid) return;
  const sheets = openActorSheets();
  const ids = new Set(crewRenderTargets(event, sheets.map(describeSheet)));
  queueRender(sheets.filter(app => ids.has(app.id)));
};

export function registerCrewHooks() {
  Hooks.on('updateActor', (actor, changes) => refresh(crewEvent(actor, { crewChanged: touchesCrew(changes) })));
  Hooks.on('createActor', actor => refresh(crewEvent(actor, { crewChanged: true })));
  Hooks.on('deleteActor', actor => refresh(crewEvent(actor, { crewChanged: true, deleted: true })));
  for (const type of ['Item', 'ActiveEffect']) {
    for (const action of ['create', 'update', 'delete']) {
      Hooks.on(`${action}${type}`, doc => refresh(crewEvent(owningActor(doc))));
    }
  }
}
