import { describe, it, expect, vi, afterEach } from 'vitest';

class CoreEffectConfig {
  async _onRender() {}
  _onChangeForm(_config, event) { this.coreEvent = event; }
}
foundry.applications.sheets = { ActiveEffectConfig: CoreEffectConfig };
const { default: EffectSheet, effectActor, itemTargetOptions } = await import('../../module/applications/effect-sheet.mjs');

const actor = { documentName: 'Actor', items: { contents: [
  { id: 'A1', name: 'Dagger', type: 'attack' },
  { id: 'A2', name: 'Dagger', type: 'attack' },
  { id: 'S1', name: 'Knives', type: 'skill' },
  { id: 'P1', name: 'Firebolt', type: 'spell' },
  { id: 'G1', name: 'Rope', type: 'gear' },
] } };

describe('owned effect target options', () => {
  it('finds the actor only for actor-owned and owned-item effects', () => {
    expect(effectActor({ parent: actor })).toBe(actor);
    expect(effectActor({ parent: { documentName: 'Item', parent: actor } })).toBe(actor);
    expect(effectActor({ parent: { documentName: 'Item' } })).toBeNull();
    expect(effectActor({ parent: { documentName: 'Item', parent: { documentName: 'Compendium' } } })).toBeNull();
  });

  it('offers legal aspects for each individually identified attack, skill, and spell', () => {
    expect(itemTargetOptions(actor.items.contents).map(option => option.value)).toEqual([
      'item-id:A1:to_hit', 'item-id:A1:damage', 'item-id:A2:to_hit', 'item-id:A2:damage',
      'item-id:S1:rank', 'item-id:S1:mana_cost', 'item-id:P1:rank', 'item-id:P1:mana_cost',
    ]);
    expect(itemTargetOptions([{ name: 'unsaved', type: 'attack' }])).toEqual([]);
  });
});

describe('effect editor form behavior', () => {
  afterEach(() => vi.unstubAllGlobals());

  const fixture = async ({ parent = actor, typeValue = 'dcc', keyValue = 'strength', editable = true } = {}) => {
    const make = tag => ({
      tag, children: [], value: '', hidden: false,
      setAttribute(name, value) { this[name] = value; },
      append(child) { this.children.push(child); },
      querySelector(selector) { return selector === 'select' ? this.children.find(child => child.tag === 'select') : null; },
      get options() { return this.children; },
    });
    vi.stubGlobal('document', { createElement: make });
    const row = {
      container: null,
      querySelector(selector) {
        if (selector.startsWith('.key input')) return key;
        if (selector.startsWith('.type select')) return type;
        if (selector === '.dcc-item-target') return this.container;
        return null;
      },
    };
    const key = { value: keyValue, parentElement: { append(container) { row.container = container; } }, closest: () => row };
    const type = { value: typeValue, closest: () => row };
    const sheet = new EffectSheet();
    sheet.document = { parent };
    sheet.isEditable = editable;
    sheet.element = { querySelectorAll: () => [row] };
    await sheet._onRender({}, {});
    const select = row.container.querySelector('select');
    if (select) select.closest = () => row;
    return { sheet, row, key, type, select };
  };

  it('writes the selected target into the native key without submitting a separate field', async () => {
    const { sheet, key, select } = await fixture();
    expect(select.name).toBeUndefined();
    select.value = 'item-id:A2:damage';
    const event = { target: select };
    sheet._onChangeForm({}, event);
    expect(key.value).toBe('item-id:A2:damage');
    expect(sheet.coreEvent).toBe(event);
    select.value = '';
    sheet._onChangeForm({}, { target: select });
    expect(key.value).toBe('item-id:A2:damage');
  });

  it('keeps manually typed and missing targets intact and responds to type switches', async () => {
    const { sheet, row, key, type, select } = await fixture({ keyValue: 'item-id:deleted:rank', typeValue: 'add' });
    expect(row.container.hidden).toBe(true);
    expect(select.value).toBe('');
    type.value = 'dcc';
    sheet._onChangeForm({}, { target: type });
    expect(row.container.hidden).toBe(false);
    expect(key.value).toBe('item-id:deleted:rank');
    key.value = 'item-id:S1:rank';
    sheet._onChangeForm({}, { target: key });
    expect(select.value).toBe('item-id:S1:rank');
    type.value = 'add';
    sheet._onChangeForm({}, { target: type });
    expect(row.container.hidden).toBe(true);
  });

  it('does not enable the chooser on read-only sheets or unowned items', async () => {
    expect((await fixture({ editable: false })).select.disabled).toBe(true);
    const unowned = await fixture({ parent: { documentName: 'Item' } });
    expect(unowned.select).toBeUndefined();
    expect(unowned.row.container.textContent).toBe('DCC.Effect.ItemTargetUnowned');
    const empty = await fixture({ parent: { documentName: 'Actor', items: { contents: [] } } });
    expect(empty.select.disabled).toBe(true);
  });
});
