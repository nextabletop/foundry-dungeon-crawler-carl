import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postCard, TEMPLATE } from '../../module/rolls/card.mjs';

// Light glue test: mode selection, rolls, speaker, render call. Rule logic is
// covered by card.test.mjs; the real Roll/ChatMessage are a live-verify gate.
describe('postCard', () => {
  let create, render, saved, mode, evaluated;
  const BaseRoll = foundry.dice.Roll;
  class RecordingRoll extends BaseRoll {
    async evaluate(opts) { evaluated.push(opts); return super.evaluate(opts); }
    async getTooltip() { return `<div class="dice-tooltip">${this.formula}</div>`; }
  }

  beforeEach(() => {
    saved = {
      settings: game.settings, scenes: game.scenes, applications: foundry.applications,
      create: ChatMessage.create, getSpeaker: ChatMessage.getSpeaker,
    };
    mode = 'public';
    evaluated = [];
    create = vi.fn(async (data, options) => ({ id: 'msg', data, options }));
    render = vi.fn(async () => '<div class="dcc-card"></div>');
    game.settings = { get: vi.fn((ns, key) => (ns === 'core' && key === 'messageMode' ? mode : undefined)) };
    game.scenes = undefined;
    foundry.applications = { handlebars: { renderTemplate: render } };
    foundry.dice.Roll = RecordingRoll;
    ChatMessage.create = create;
    ChatMessage.getSpeaker = vi.fn(({ actor }) => ({ actor: actor.id, alias: actor.name }));
  });
  afterEach(() => {
    game.settings = saved.settings;
    game.scenes = saved.scenes;
    foundry.applications = saved.applications;
    foundry.dice.Roll = BaseRoll;
    ChatMessage.create = saved.create;
    ChatMessage.getSpeaker = saved.getSpeaker;
  });

  const actor = (type, system = {}) => ({
    id: 'a1', type, name: 'Carl', img: 'carl.webp', system, getRollData: () => ({ mod: 3 }),
  });
  const opts = () => create.mock.calls.at(-1)[1];
  const data = () => create.mock.calls.at(-1)[0];

  it('posts both rolls with the player mode, no bubble, and returns the pieces', async () => {
    const out = await postCard(actor('pc'), { name: 'Sword' }, { roll: '10 + @mod', damage: '4' });
    expect(opts()).toEqual({ messageMode: 'public', chatBubble: false });
    expect(data().rolls.map(r => r.total)).toEqual([13, 4]);
    expect(data()).not.toHaveProperty('sound');
    expect(data().content).toBe('<div class="dcc-card"></div>');
    expect(out.message).toMatchObject({ id: 'msg' });
    expect(out.check.total).toBe(13);
    expect(out.damage.total).toBe(4);
    const [path, ctx] = render.mock.calls[0];
    expect(path).toBe(TEMPLATE);
    expect(ctx).toBe(out.ctx);
    expect(ctx).toMatchObject({
      name: 'Sword', characterName: 'Carl', img: 'carl.webp',
      roll: { total: 13, formula: '10 + @mod', tooltip: '<div class="dice-tooltip">10 + @mod</div>' },
      damage: { total: 4, formula: '4' },
    });
  });

  it('ic mode still disables the chat bubble', async () => {
    mode = 'ic';
    await postCard(actor('pc'), {}, { roll: '5' });
    expect(opts()).toEqual({ messageMode: 'ic', chatBubble: false });
  });

  it('blind mode evaluates without interactive dice', async () => {
    mode = 'blind';
    await postCard(actor('pc'), {}, { roll: '5', damage: '2' });
    expect(evaluated).toEqual([{ allowInteractive: false }, { allowInteractive: false }]);
    mode = 'public';
    await postCard(actor('pc'), {}, { roll: '5' });
    expect(evaluated.at(-1)).toEqual({ allowInteractive: true });
  });

  it('a hidden mob upgrades public/ic to gm but keeps self/blind/gm', async () => {
    for (const [chosen, expected] of [['public', 'gm'], ['ic', 'gm'], ['self', 'self'], ['blind', 'blind'], ['gm', 'gm']]) {
      mode = chosen;
      await postCard(actor('mob'), {}, { damage: '2' });
      expect(opts().messageMode, chosen).toBe(expected);
    }
    mode = 'public';
    await postCard(actor('mob', { mobPublic: true }), {}, { damage: '2' });
    expect(opts().messageMode).toBe('public');
  });

  it('options.privacyOf: a vehicle card rolled by a hidden mob crew member whispers, keeping the vehicle portrait', async () => {
    const truck = { ...actor('vehicle'), name: 'Truck', img: 'truck.webp' };
    const out = await postCard(truck, {}, { damage: '2' }, { privacyOf: actor('mob') });
    expect(opts().messageMode).toBe('gm');
    expect(out.ctx).toMatchObject({ characterName: 'Truck', img: 'truck.webp' });
    await postCard(truck, {}, { damage: '2' }, { privacyOf: actor('mob', { mobPublic: true }) });
    expect(opts().messageMode).toBe('public');
    await postCard(truck, {}, { damage: '2' }, { privacyOf: actor('pc') });
    expect(opts().messageMode).toBe('public');
  });

  it('with no formulas it still posts (empty rolls) and renders the target', async () => {
    const out = await postCard(actor('mob', { mobPublic: true }), { name: 'Club', target: 14 });
    expect(data().rolls).toEqual([]);
    expect(out.check).toBeNull();
    expect(out.damage).toBeNull();
    expect(out.ctx.target).toEqual({ value: 14 });
  });

  it('appends options.extraRolls (already evaluated) after the check / damage', async () => {
    const d20a = new RecordingRoll('7');
    const d20b = new RecordingRoll('12');
    await d20a.evaluate({});
    await d20b.evaluate({});
    evaluated = [];
    await postCard(actor('pc'), { name: 'Advancement' }, { roll: '5' }, { extraRolls: [d20a, d20b] });
    expect(data().rolls.map(r => r.total)).toEqual([5, 7, 12]);
    expect(data().rolls[1]).toBe(d20a);
    expect(evaluated).toHaveLength(1);
    await postCard(actor('pc'), { name: 'Advancement' }, {}, { extraRolls: [d20a] });
    expect(data().rolls).toEqual([d20a]);
    expect(render.mock.calls.at(-1)[1]).not.toHaveProperty('roll');
  });

  it('honours a speaker override: alias and its token image', async () => {
    const tokens = new Map([['t9', { texture: { src: 'crew-token.webp' } }]]);
    game.scenes = { get: id => (id === 's1' ? { tokens } : undefined) };
    const speaker = { scene: 's1', token: 't9', alias: 'Donut' };
    await postCard(actor('pc'), { name: 'Bite' }, { roll: '3' }, { speaker });
    expect(ChatMessage.getSpeaker).not.toHaveBeenCalled();
    expect(data().speaker).toBe(speaker);
    expect(render.mock.calls[0][1]).toMatchObject({ characterName: 'Donut', img: 'crew-token.webp' });
  });

  it('falls back past wildcard token art to the prototype, then the actor image', async () => {
    const tokens = new Map([['t1', { texture: { src: 'goblins/*.webp' } }]]);
    game.scenes = { get: () => ({ tokens }) };
    const a = { ...actor('pc'), prototypeToken: { randomImg: false, texture: { src: 'proto.webp' } } };
    await postCard(a, {}, {}, { speaker: { scene: 's', token: 't1', alias: 'Carl' } });
    expect(render.mock.calls.at(-1)[1].img).toBe('proto.webp');
    a.prototypeToken = { randomImg: true, texture: { src: 'goblins/*.webp' } };
    await postCard(a, {}, {}, { speaker: { scene: 's', token: 't1', alias: 'Carl' } });
    expect(render.mock.calls.at(-1)[1].img).toBe('carl.webp');
  });

  it('calls a fields function with the dice results before rendering', async () => {
    const fields = vi.fn(({ check, damage }) => ({ name: 'Cast', note: `hit ${check.total}`, cost: damage ? 1 : 2 }));
    const out = await postCard(actor('pc'), fields, { roll: '1 + 1' });
    expect(fields).toHaveBeenCalledWith({ check: { total: 2, d20: null }, damage: null });
    expect(out.ctx).toMatchObject({ name: 'Cast', note: 'hit 2', cost: { value: 2 } });
  });
});
