/**
 * Shared, debounced actor-sheet re-render queue for the crew hooks
 * (crew-hooks.mjs) and the GM screen hooks (gm-link.mjs).
 *
 * ApplicationV2#render queues each call rather than coalescing them, so a
 * burst of hooks (one updateDocuments of N actors, one createEmbeddedDocuments
 * of N items, a crew change plus a roster change) would otherwise render the
 * same sheet once per hook. Every caller queues here instead; one debounce
 * flushes one render per sheet per burst.
 *
 * No imports and no work at import time: the debounce is created lazily on
 * the first queueRender, so importing this module never touches
 * foundry.utils. The test mock provides a real trailing debounce; tests drain
 * the queue synchronously with flushRenders().
 */

/** Batch window: one createEmbeddedDocuments of N items fires N createItem hooks. */
const RENDER_DELAY_MS = 50;

/** Open actor sheets: rendered ActorSheetV2 instances with a document. */
export const openActorSheets = () => [...foundry.applications.instances.values()]
  .filter(app => app.rendered && (app instanceof foundry.applications.sheets.ActorSheetV2) && app.document);

/** Apps due a re-render, keyed by the app object itself. */
const pending = new Set();
let debouncedFlush = null;

/** Render every queued app that is still rendered, and empty the queue. Synchronous; tests drain with it. */
export const flushRenders = () => {
  const apps = [...pending];
  pending.clear();
  for (const app of apps) if (app.rendered) app.render();
};

/** Queue `apps` for one debounced re-render each (render(), never force). */
export const queueRender = (apps) => {
  for (const app of apps ?? []) if (app) pending.add(app);
  if (!pending.size) return;
  debouncedFlush ??= foundry.utils.debounce(flushRenders, RENDER_DELAY_MS);
  debouncedFlush();
};
