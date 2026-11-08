import { describe, it, expect } from 'vitest';
import { STATS } from '../../module/config.mjs';

// Checks the Foundry mock itself behaves like the real helpers it stands in for.

describe('foundry.utils.mergeObject (mock)', () => {
  const { mergeObject } = foundry.utils;

  it('merges in place and returns original, expanding dotted keys', () => {
    const original = { system: { healthPoints: { value: 1, max: 5 } } };
    const out = mergeObject(original, { 'system.healthPoints.value': 3 });
    expect(out).toBe(original);
    expect(original.system.healthPoints).toEqual({ value: 3, max: 5 });
  });

  it('expands dotted keys on original too', () => {
    const original = { 'a.b': 1 };
    mergeObject(original, { a: { c: 2 } });
    expect(original).toEqual({ a: { b: 1, c: 2 } });
  });

  it('inplace:false leaves original untouched', () => {
    const original = { a: { b: 1 } };
    const out = mergeObject(original, { 'a.c': 2 }, { inplace: false });
    expect(out).not.toBe(original);
    expect(out).toEqual({ a: { b: 1, c: 2 } });
    expect(original).toEqual({ a: { b: 1 } });
  });

  it('deep-clones inserted values', () => {
    const inner = { x: [1, 2] };
    const out = mergeObject({}, { inner });
    expect(out.inner).toEqual(inner);
    expect(out.inner).not.toBe(inner);
    expect(out.inner.x).not.toBe(inner.x);
  });

  it('replaces arrays and primitives', () => {
    expect(mergeObject({ a: [1, 2], b: 1 }, { a: [3], b: 2 })).toEqual({ a: [3], b: 2 });
  });

  it.each(['insertKeys', 'insertValues', 'overwrite', 'enforceTypes', 'applyOperators', 'performDeletions'])(
    'throws on unsupported option %s', (opt) => {
      expect(() => mergeObject({}, {}, { [opt]: true })).toThrow(/unsupported/);
    });
});

describe('CONFIG (mock)', () => {
  it('CONFIG.DCC is seeded from config.mjs', () => {
    expect(CONFIG.DCC.STATS).toEqual(STATS);
  });
});
