import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A token bar edit that resolves to no change (sub-slot HP, mana at max) fires
// no update, so the Token HUD kept showing the typed entry. DCCActor re-renders
// a HUD bound to itself after every modifyTokenAttribute.
const { default: DCCActor } = await import('../../module/documents/actor.mjs');

const base = Object.getPrototypeOf(DCCActor.prototype);
const makeActor = () => new DCCActor({ type: 'pc', name: 'Carl', system: {} });

beforeEach(() => {
  base.modifyTokenAttribute = vi.fn(async function () { return this; });
});
afterEach(() => {
  delete base.modifyTokenAttribute;
  delete globalThis.canvas;
});

describe('modifyTokenAttribute', () => {
  it('passes through to core and re-renders a HUD bound to this actor', async () => {
    const actor = makeActor();
    const hud = { rendered: true, actor, render: vi.fn() };
    globalThis.canvas = { hud: { token: hud } };
    await actor.modifyTokenAttribute('healthPoints', -1, true, true);
    expect(base.modifyTokenAttribute).toHaveBeenCalledWith('healthPoints', -1, true, true);
    expect(hud.render).toHaveBeenCalledOnce();
  });
  it('leaves a HUD bound to another actor alone', async () => {
    const hud = { rendered: true, actor: makeActor(), render: vi.fn() };
    globalThis.canvas = { hud: { token: hud } };
    await makeActor().modifyTokenAttribute('mana', 5, false, true);
    expect(hud.render).not.toHaveBeenCalled();
  });
  it('no canvas (e.g. no scene) is fine', async () => {
    await expect(makeActor().modifyTokenAttribute('mana', 5, false, true)).resolves.toBeDefined();
  });
});
