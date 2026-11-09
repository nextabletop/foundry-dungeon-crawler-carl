import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DCC_CHANGE_TYPE, dccChangeHandler, registerDccChangeType, describeChange } from '../../module/effects/dcc-change.mjs';
import DCCEffectModel from '../../module/data/effect/effect-model.mjs';

const change = (over = {}) => ({ key: 'strength', type: 'dcc', value: '2', phase: 'initial', priority: 20, ...over });

describe('dcc change handler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pushes { target, value } into system._modifiers', () => {
    const actor = { system: { _modifiers: [] } };
    dccChangeHandler(actor, change({ key: '  item:Sword:to_hit ', value: '10%' }));
    dccChangeHandler(actor, change({ key: 'evade', value: 3 }));
    expect(actor.system._modifiers).toEqual([
      { target: 'item:Sword:to_hit', value: '10%' },
      { target: 'evade', value: '3' },
    ]);
  });

  it('ignores documents without a collector', () => {
    expect(() => dccChangeHandler({ system: {} }, change())).not.toThrow();
    expect(() => dccChangeHandler({}, change())).not.toThrow();
    expect(() => dccChangeHandler(undefined, change())).not.toThrow();
  });

  it('ignores final-phase changes, warning once per effect + key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const actor = { system: { _modifiers: [] } };
    const effect = { id: 'fx-final-1' };
    dccChangeHandler(actor, change({ phase: 'final', effect }));
    dccChangeHandler(actor, change({ phase: 'final', effect }));
    expect(actor.system._modifiers).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    dccChangeHandler(actor, change({ phase: 'final', effect, key: 'evade' }));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('registerDccChangeType', () => {
  let saved;
  beforeEach(() => {
    saved = Object.hasOwn(CONFIG, 'ActiveEffect') ? CONFIG.ActiveEffect : undefined;
    CONFIG.ActiveEffect = { changeTypes: {} };
  });
  afterEach(() => {
    if (saved === undefined) delete CONFIG.ActiveEffect;
    else CONFIG.ActiveEffect = saved;
  });

  it('registers the dcc change type on CONFIG', () => {
    registerDccChangeType();
    expect(CONFIG.ActiveEffect.changeTypes[DCC_CHANGE_TYPE]).toEqual({
      label: 'DCC.Effect.ChangeType', defaultPriority: 20, handler: dccChangeHandler,
    });
  });
});

describe('DCCEffectModel schema', () => {
  it('a fresh change defaults to the dcc type', () => {
    const { fields } = DCCEffectModel.defineSchema().changes.element;
    expect(fields.type.initial).toBe(DCC_CHANGE_TYPE);
  });

  it('keeps the core key/value/phase/priority change fields', () => {
    const { fields } = DCCEffectModel.defineSchema().changes.element;
    expect(Object.keys(fields)).toEqual(['key', 'type', 'value', 'phase', 'priority']);
    expect(fields.phase.initial).toBe('initial');
    expect(fields.value.initial).toBe('');
    expect(fields.type.options.required).toBe(true);
    expect(fields.type.options.blank).toBe(false);
  });
});

describe('DCCEffectModel.isSuppressed', () => {
  const effectOn = (owner) => {
    const model = new DCCEffectModel();
    model.parent = { parent: owner };
    return model;
  };
  const item = (type, system) => ({ documentName: 'Item', type, system });

  for (const type of ['gear', 'weapon']) {
    it(`${type}: pack + inactive is suppressed`, () => {
      expect(effectOn(item(type, { slot: 'pack', active: false })).isSuppressed).toBe(true);
    });
    it(`${type}: slotted in head is not suppressed (undefined)`, () => {
      expect(effectOn(item(type, { slot: 'head', active: false })).isSuppressed).toBeUndefined();
    });
    it(`${type}: pack + active is not suppressed (undefined)`, () => {
      expect(effectOn(item(type, { slot: 'pack', active: true })).isSuppressed).toBeUndefined();
    });
  }

  for (const type of ['skill', 'spell']) {
    it(`${type}: enabled false is suppressed`, () => {
      expect(effectOn(item(type, { enabled: false })).isSuppressed).toBe(true);
    });
    it(`${type}: enabled true is not suppressed (undefined)`, () => {
      expect(effectOn(item(type, { enabled: true })).isSuppressed).toBeUndefined();
    });
  }

  it('actor-level effects are never suppressed by the model (undefined)', () => {
    expect(effectOn({ documentName: 'Actor', type: 'pc', system: {} }).isSuppressed).toBeUndefined();
  });

  it('an orphan effect (no parent) is undefined', () => {
    expect(new DCCEffectModel().isSuppressed).toBeUndefined();
  });
});

describe('describeChange', () => {
  it('dcc changes read "key value"', () => {
    expect(describeChange({ key: 'strength', type: 'dcc', value: '2' })).toBe('strength 2');
    expect(describeChange({ key: 'item:Dagger:to_hit', type: 'dcc', value: '10%' })).toBe('item:Dagger:to_hit 10%');
  });
  it('other change types are named', () => {
    expect(describeChange({ key: 'system.armor', type: 'add', value: '1' })).toBe('system.armor 1 (add)');
  });
  it('shows the current name and ID for stable targets, with a raw fallback for deleted items', () => {
    const entry = change({ key: 'item-id:A1:damage', value: '+1d4' });
    expect(describeChange(entry, [{ id: 'A1', name: 'Renamed Dagger' }]))
      .toBe('item:Renamed Dagger [A1]:damage +1d4');
    expect(describeChange(entry, [])).toBe('item-id:A1:damage +1d4');
    expect(describeChange({ ...entry, type: 'add' }, [{ id: 'A1', name: 'Dagger' }]))
      .toBe('item-id:A1:damage +1d4 (add)');
  });
  it('tolerates missing parts', () => {
    expect(describeChange({ type: 'dcc' })).toBe('');
  });
});
