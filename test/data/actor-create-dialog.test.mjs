import { afterEach, describe, expect, it, vi } from 'vitest';
import DCCActor from '../../module/documents/actor.mjs';

const parent = foundry.documents.Actor;

afterEach(() => {
  vi.restoreAllMocks();
  delete parent.createDialog;
  delete DCCActor.TYPES;
});

describe('Create Actor dialog', () => {
  it('excludes the deferred GM Screen while preserving other types and dialog options', async () => {
    Object.defineProperty(DCCActor, 'TYPES', { value: ['pc', 'mob', 'vehicle', 'gmscreen'], configurable: true });
    parent.createDialog = vi.fn(async () => 'created');
    const data = { folder: 'folder-id' };
    const createOptions = { pack: 'world.actors' };
    const options = { position: { top: 10 } };
    const renderOptions = { render: true };

    expect(await DCCActor.createDialog(data, createOptions, options, renderOptions)).toBe('created');
    expect(parent.createDialog).toHaveBeenCalledWith(
      data, createOptions, { ...options, types: ['pc', 'mob', 'vehicle'] }, renderOptions,
    );
    expect(options).toEqual({ position: { top: 10 } });
  });

  it('respects caller-provided type restrictions without reintroducing GM Screen', async () => {
    parent.createDialog = vi.fn();
    await DCCActor.createDialog({}, {}, { types: ['mob', 'gmscreen'] });
    expect(parent.createDialog).toHaveBeenCalledWith({}, {}, { types: ['mob'] }, {});
    await DCCActor.createDialog({}, {}, { types: ['gmscreen'] });
    expect(parent.createDialog).toHaveBeenLastCalledWith({}, {}, { types: [] }, {});
  });
});
