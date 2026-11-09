import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../module/applications/actor-sheet-base.mjs', () => ({ default: class {} }));
vi.mock('../../module/rolls/card.mjs', () => ({ postCard: vi.fn(async () => ({})) }));

const { postCard } = await import('../../module/rolls/card.mjs');
const { default: DCCCreatureSheet } = await import('../../module/applications/creature-sheet.mjs');

describe('Crawler Evade sheet action', () => {
  it.each([
    [6, '+1d4-2d6', '1d20 + 6+1d4-2d6'],
    [-2, '-1d4', '1d20 - 2-1d4'],
    [0, '', '1d20'],
  ])('rolls the displayed derived Evade %s with modifier dice %s', async (evade, evadeDice, formula) => {
    postCard.mockClear();
    const actor = { system: { evade, evadeDice } };
    const sheet = { document: actor, _flushForm: vi.fn(async () => true) };
    await DCCCreatureSheet.DEFAULT_OPTIONS.actions.rollEvade.call(sheet);
    expect(sheet._flushForm).toHaveBeenCalledOnce();
    expect(postCard).toHaveBeenCalledWith(actor, {
      name: 'DCC.Defense.Evade', tag: 'DCC.Roll.Defense',
    }, { roll: formula });
  });

  it('does not roll if saving pending edits fails', async () => {
    postCard.mockClear();
    const sheet = { document: { system: { evade: 4, evadeDice: '+1d4' } }, _flushForm: vi.fn(async () => false) };
    await DCCCreatureSheet.DEFAULT_OPTIONS.actions.rollEvade.call(sheet);
    expect(postCard).not.toHaveBeenCalled();
  });

  it('shows derived bonus and dice labels on the Evade strip', () => {
    const template = readFileSync(new URL('../../templates/actor/partials/defenses.hbs', import.meta.url), 'utf8');
    expect(template).toContain('{{system.evadeBuffLabel}}');
    expect(template).toContain('{{system.evadeRollLabel}}');
    expect(template).not.toContain('system.stats.intelligence.modifier');
  });
});
