import { SYSTEM_ID } from './config.mjs';
import { GM_SCREEN_TYPE, baseActorUuid, gmGate, resolveGmLink, UNLINKED } from './rules/gm-screen.mjs';
import { openActorSheets, queueRender } from './sheet-refresh.mjs';

/**
 * GM screen glue (Chunk 8, Task 27): the world setting that picks the screen,
 * link resolution for a Crawler, and the hooks that keep open sheets live.
 * The decisions live in rules/gm-screen.mjs; this module only reads game.*
 * at CALL time (importing it has no side effects).
 *
 * Imports config, the pure rules and sheet-refresh only, never a sheet or document, so
 * documents/actor.mjs and data/actor/gmscreen.mjs can import it without a cycle.
 */

export const GM_SCREEN_SETTING = 'gmScreen';

/** The configured screen id ('' when none). */
export const gmScreenId = () => game.settings.get(SYSTEM_ID, GM_SCREEN_SETTING) ?? '';

/**
 * The Crawler gate for `actor` ({linked, safehouse, available}); UNLINKED for non-pc actors.
 * `source` defaults to actor.system._source. The link resolves by BASE uuid; the cursor is the
 * acting actor's own (see the plan's "Chunk 8 ambiguity resolutions").
 */
export const gmLinkFor = (actor, source = actor?.system?._source ?? actor?.system) => {
  if (actor?.type !== 'pc') return UNLINKED;
  const link = resolveGmLink({ settingId: gmScreenId(), actorsById: game.actors, baseUuid: baseActorUuid(actor) });
  return gmGate(link, source);
};

/**
 * Rostered actors in roster order: [{ uuid, actor|null }] via foundry.utils.fromUuidSync.
 * Accepts a roster UUID array (what GmScreenModel passes: this._source.roster) or a gmscreen actor (the sheet).
 */
export const rosterEntries = (screenOrRoster) => {
  const roster = Array.isArray(screenOrRoster) ? screenOrRoster : (screenOrRoster?.system?.roster ?? []);
  return roster.map(uuid => ({ uuid, actor: foundry.utils.fromUuidSync(uuid) ?? null }));
};

/**
 * Queue a re-render of every open actor sheet whose actor matches `pred` (render(), never force).
 * Shares crew-hooks.mjs's debounced queue, so a burst renders each sheet once.
 */
export const rerenderActorSheets = (pred) => queueRender(openActorSheets().filter(app => pred(app.document)));
export const rerenderPcSheets = () => rerenderActorSheets(a => a.type === 'pc');
const rerenderScreenSheets = (pred = () => true) => rerenderActorSheets(a => (a.type === GM_SCREEN_TYPE) && pred(a));
const rerenderScreensListing = (uuid) => {
  if (uuid) rerenderScreenSheets(a => (a.system?.roster ?? []).includes(uuid));
};

/**
 * Setting onChange, on every client (create and update). Foundry does not
 * await it, so errors are reported here. Only the active GM re-baselines.
 */
export const onGmScreenSettingChange = async (value) => {
  try {
    rerenderPcSheets();
    rerenderScreenSheets(); // the screen sheet's "is configured" hint depends on the setting
    if (!game.user?.isActiveGM) return;
    const { screen } = resolveGmLink({ settingId: value, actorsById: game.actors });
    if (!screen) return;
    await screen.system.rebaselineRoster(); // direct call: a rename fails loudly instead of skipping the baseline
  } catch (err) {
    ui.notifications.error(err, { console: true });
  }
};

export const onUpdateActor = (actor) => {
  if ((actor.type === GM_SCREEN_TYPE) && (actor.id === gmScreenId())) rerenderPcSheets();
  if (actor.type === 'pc') rerenderScreensListing(baseActorUuid(actor));
};

export const onDeleteActor = (actor) => {
  if (actor.type === GM_SCREEN_TYPE) {
    // Clearing the setting fires its onChange on every client, which re-renders the PC
    // sheets. The local render below only matters when no active GM is online to clear
    // it; otherwise the shared queue coalesces the two renders into one.
    if (game.user?.isActiveGM && (actor.id === gmScreenId())) {
      game.settings.set(SYSTEM_ID, GM_SCREEN_SETTING, '').catch(err => ui.notifications.error(err, { console: true }));
    }
    rerenderPcSheets();
  } else if (actor.type === 'pc') {
    rerenderScreensListing(baseActorUuid(actor)); // the row turns "(missing)"
  }
};

export const onCreateActor = (actor) => {
  if (actor.type === GM_SCREEN_TYPE) rerenderPcSheets();
};

export const registerGmScreenSetting = () => {
  game.settings.register(SYSTEM_ID, GM_SCREEN_SETTING, {
    name: 'DCC.Setting.GmScreen.Name',
    hint: 'DCC.Setting.GmScreen.Hint',
    scope: 'world',
    config: true,
    requiresReload: false,
    type: new foundry.data.fields.StringField({
      blank: true, // choices would otherwise force blank:false (fields.mjs:1630)
      // Called on every validate and settings-form render; game.actors may not exist yet.
      choices: () => ({
        '': '—',
        ...Object.fromEntries((game.actors?.filter(a => a.type === GM_SCREEN_TYPE) ?? []).map(a => [a.id, a.name])),
      }),
    }),
    default: '',
    onChange: onGmScreenSettingChange,
  });
};

export const registerGmScreenHooks = () => {
  Hooks.on('updateActor', onUpdateActor);
  Hooks.on('deleteActor', onDeleteActor);
  Hooks.on('createActor', onCreateActor);
};
