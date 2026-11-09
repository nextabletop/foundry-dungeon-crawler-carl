import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { inlineFieldValue, inlineEditTarget, sheetItemLists, buffRows, inventoryView, hotlistCells, advancementView, isBlankHTML, vehicleWeaponRows, richTextFieldNames, crewRows, gmRosterRows, undoFloorView, isViewOnlyControl, enableViewOnlyControls, singleFlight, VIEW_ONLY_ACTIONS } from '../../module/applications/sheet-rows.mjs';

// Inline item edits on the actor sheet: the value to write from a changed control.
describe('inlineFieldValue', () => {
  it('checkbox -> its checked state', () => {
    expect(inlineFieldValue({ type: 'checkbox', checked: true, value: 'on' })).toBe(true);
    expect(inlineFieldValue({ type: 'checkbox', checked: false, value: 'on' })).toBe(false);
  });

  describe('item damage field layout', () => {
    const attack = readFileSync(new URL('../../templates/item/attack.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');

    it('uses a free-text Damage Type control for canonical Attacks', () => {
      expect(attack).toContain('systemFields.damageType value=systemSource.damageType rootId=rootId');
      expect(attack).not.toContain('selectOptions.damageType');
    });

    it('gives Damage Type a wider column than Damage Die and Damage Bonus', () => {
      expect(attack).toContain('class="dcc-item-damage-grid"');
      expect(css).toContain('grid-template-columns: minmax(72px, 0.7fr) minmax(72px, 0.7fr) minmax(180px, 2fr);');
    });
  });
  it('number -> an integer (all inline number fields are int)', () => {
    expect(inlineFieldValue({ type: 'number', value: '3.7' })).toBe(3);
    expect(inlineFieldValue({ type: 'number', value: '3' })).toBe(3);
    expect(inlineFieldValue({ type: 'number', value: '-2' })).toBe(-2);
  });
  it('number: blank or garbage -> undefined (skip the update)', () => {
    expect(inlineFieldValue({ type: 'number', value: '' })).toBeUndefined();
    expect(inlineFieldValue({ type: 'number', value: '  ' })).toBeUndefined();
    expect(inlineFieldValue({ type: 'number', value: 'abc' })).toBeUndefined();
  });
  it('select / text -> the raw value', () => {
    expect(inlineFieldValue({ type: 'select-one', value: 'opposed' })).toBe('opposed');
    expect(inlineFieldValue({ type: 'text', value: 'x' })).toBe('x');
  });
});

describe('inlineEditTarget', () => {
  const control = (field, rowId) => ({
    dataset: field ? { field } : {},
    closest: sel => (sel === '[data-item-id]' && rowId ? { dataset: { itemId: rowId } } : null),
  });
  it('a data-field control in an item row -> {itemId, field}', () => {
    expect(inlineEditTarget(control('system.rank', 'abc'))).toEqual({ itemId: 'abc', field: 'system.rank' });
  });
  it('no data-field, or not in an item row -> null (normal actor form control)', () => {
    expect(inlineEditTarget(control(null, 'abc'))).toBeNull();
    expect(inlineEditTarget(control('system.rank', null))).toBeNull();
    expect(inlineEditTarget(undefined)).toBeNull();
  });
});

describe('sheetItemLists', () => {
  const it_ = (id, type, name, sort, system = {}, derived = {}) => ({
    id, type, name, img: `${id}.svg`, sort, system: { ...system, derived, _source: system },
  });
  const lists = sheetItemLists({
    attack: [
      it_('a2', 'attack', 'Zap Attack', 200, { stat: 'intelligence', linkedItemIds: ['p2'] }, { rank: 2, toHit: 3, damageLabel: '1d6+2 fire' }),
      it_('a1', 'attack', 'Axe', 100, { stat: 'strength', primarySkillId: 's1' }, {
        rank: 1,
        toHit: 2,
        damageLabel: '1d6+1 slashing',
        skillUses: [{ index: 0, label: 'thrown', skillId: 's2', skillName: 'Brawl', stat: 'dexterity', rank: 2, toHit: 4, damageLabel: '1d6+1 slashing' }],
      }),
    ],
    skill: [it_('s2', 'skill', 'Brawl', 0, { stat: 'strength', rank: 1 }), it_('s1', 'skill', 'Axes', 0, { stat: 'dexterity', rank: 2 }, { rankEffective: 3, skillBonus: 4 })],
    spell: [it_('p2', 'spell', 'Zap', 5, { stat: 'intelligence', linkedItemIds: ['a2'] }, { manaCostEffective: 3 }),
      it_('p1', 'spell', 'Heal', 5, { stat: 'intelligence' })],
  });
  it('orders each canonical item list by sort, then name', () => {
    expect(lists.attacks.map(r => r.id)).toEqual(['a1', 'a2']);
    expect(lists.skills.map(r => r.id)).toEqual(['s1', 's2']);
    expect(lists.spells.map(r => r.id)).toEqual(['p1', 'p2']);
  });
  it('attack rows: derived values, spell flag, trimmed label', () => {
    expect(lists.attacks[0]).toMatchObject({
      stat: 'DCC.StatAbbr.strength', rank: 1, toHit: 2, damageLabel: '1d6+1 slashing',
      isSpell: false, skillName: 'Axes', skillMissing: false,
    });
    expect(lists.attacks[0].skillUses[0]).toMatchObject({
      attackId: 'a1',
      name: 'Axe (thrown)',
      stat: 'DCC.StatAbbr.dexterity',
      skillName: 'Brawl',
      toHit: 4,
    });
    expect(lists.attacks[1].isSpell).toBe(true);
  });

  it('Attack templates author and roll alternate stable-ID Skill Uses', () => {
    const attack = readFileSync(new URL('../../templates/item/attack.hbs', import.meta.url), 'utf8');
    const list = readFileSync(new URL('../../templates/actor/partials/attack-list.hbs', import.meta.url), 'utf8');
    expect(attack).toContain('name="system.primarySkillId"');
    expect(attack).toContain('name="system.skillUses.{{index}}.skillId"');
    expect(attack).toContain('data-action="addSkillUse"');
    expect(attack).toContain('data-action="deleteSkillUse"');
    expect(list).toContain('data-skill-use-index="{{index}}"');
  });
  it('attack rows carry the mob static To-Hit target (derived.mobToHit)', () => {
    const { attacks } = sheetItemLists({
      attack: [
        it_('a', 'attack', 'Club', 0, { stat: 'strength' }, { toHit: 2, mobToHit: 13 }),
        it_('p', 'attack', 'Zap', 1, {}, { mobToHit: 11 }),
      ],
    });
    expect(attacks.map(r => r.mobToHit)).toEqual([13, 11]);
  });
  it('skill rows: source rank, effective rank flag, cost for spells', () => {
    expect(lists.skills[0]).toMatchObject({ rank: 2, rankEffective: 3, rankModified: true, bonus: 4 });
    expect(lists.skills[1].rankModified).toBe(false);
    expect(lists.spells[1]).toMatchObject({ cost: 3 });
    expect(lists.spells[1]).not.toHaveProperty('attack');
    expect(lists.skills[0].cost).toBeUndefined();
  });
  it('skill rows expose opposed/passive display state from checkType', () => {
    const { skills } = sheetItemLists({
      skill: [
        it_('o', 'skill', 'Persuade', 0, { checkType: 'opposed', opposedStat: 'charisma', mark: true }),
        it_('p', 'skill', 'Powerful', 1, { checkType: 'passive', mark: true }),
      ],
    });
    expect(skills[0]).toMatchObject({
      checkType: 'opposed', opposedStat: 'charisma', isOpposed: true, isPassive: false, markable: true,
    });
    expect(skills[1]).toMatchObject({
      checkType: 'passive', isOpposed: false, isPassive: true, markable: false,
    });
  });
  it('skill rows expose populated authored metadata and plain-text Notes & Upgrades', () => {
    const { skills, spells } = sheetItemLists({
      skill: [it_('s', 'skill', 'Crossbow', 0, {
        range: '50 feet', cooldown: 'Once per round', limitations: 'Needs bolts',
        description: '<p>Rank 5: ignores cover.</p>',
      })],
      spell: [it_('p', 'spell', 'Rootfoot', 0, {
        range: '30 feet', cooldown: 'Once per scene', duration: '2 rounds',
        description: '<p>Roots ensnare.</p>', attack: {},
      }, { manaCostEffective: 5 })],
    });
    expect(skills[0]).toMatchObject({
      summary: [
        { label: 'DCC.Items.Range', value: '50 feet' },
        { label: 'DCC.Items.Cooldown', value: 'Once per round' },
      ],
      notes: 'Rank 5: ignores cover.',
      hasSummary: true,
    });
    expect(skills[0].summary.some(field => field.value === 'Needs bolts')).toBe(false);
    expect(spells[0].summary).toEqual([
      { label: 'DCC.Items.Range', value: '30 feet' },
      { label: 'DCC.Items.Cooldown', value: 'Once per scene' },
      { label: 'DCC.Items.ManaCost', value: 5 },
      { label: 'DCC.Items.Duration', value: '2 rounds' },
    ]);
  });
  it('blank metadata and zero mana cost do not create an actor summary', () => {
    const { skills, spells } = sheetItemLists({
      skill: [it_('s', 'skill', 'Blank', 0, { range: ' ', cooldown: '', description: '<p></p>' })],
      spell: [it_('p', 'spell', 'Free', 0, { attack: {} }, { manaCostEffective: 0 })],
    });
    expect(skills[0]).toMatchObject({ summary: [], notes: '', hasSummary: false });
    expect(spells[0]).toMatchObject({ summary: [], notes: '', hasSummary: false });
  });
  it('empty input -> empty lists', () => {
    expect(sheetItemLists()).toEqual({ attacks: [], skills: [], spells: [] });
  });
});

describe('buffRows', () => {
  it('orders by sort, then name, and summarises changes', () => {
    const rows = buffRows([
      { id: 'b', name: 'Rage', sort: 2, disabled: false, system: { changes: [{ key: 'strength', type: 'dcc', value: '2' }] } },
      { id: 'a', name: 'Haste', sort: 1, disabled: true, system: { changes: [] } },
    ]);
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
    expect(rows[1]).toMatchObject({ disabled: false, changes: 'strength 2' });
  });
});

// Minimal owned-item stand-in: prepared `system` with `_source` = the stored values.
const item = (id, type, name, sort, system = {}) => ({ id, type, name, img: `${id}.svg`, sort, system: { ...system, _source: system } });

describe('skill rows carry the hotlist flag', () => {
  it('onHotlist from the source values', () => {
    const { skills, spells } = sheetItemLists({
      skill: [item('s', 'skill', 'Knives', 0, { onHotlist: true })],
      spell: [item('p', 'spell', 'Zap', 0, { onHotlist: false, attack: {} })],
    });
    expect(skills[0].onHotlist).toBe(true);
    expect(spells[0].onHotlist).toBe(false);
  });
});

describe('skill and spell authored metadata templates', () => {
  const skill = readFileSync(new URL('../../templates/item/skill.hbs', import.meta.url), 'utf8');
  const spell = readFileSync(new URL('../../templates/item/spell.hbs', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../../templates/actor/partials/skill-list.hbs', import.meta.url), 'utf8');
  const description = readFileSync(new URL('../../templates/item/partials/description.hbs', import.meta.url), 'utf8');

  it('edits Range, Cooldown, and Limitations on skills and spells, with spell-only Duration', () => {
    for (const template of [skill, spell]) {
      for (const field of ['range', 'cooldown', 'limitations']) {
        expect(template).toContain(`systemFields.${field} value=systemSource.${field}`);
      }
    }
    expect(spell).toContain('systemFields.duration value=systemSource.duration');
    expect(skill).not.toContain('systemFields.duration');
  });

  it('renders populated actor summaries and uses the context-specific description label', () => {
    expect(list).toContain('{{#if hasSummary}}');
    expect(list).toContain('{{#each summary}}');
    expect(list).toContain('dcc-skill-summary-notes');
    expect(description).toContain('{{descriptionLabel}}');
  });

  it('offers Skill Check on both item sheets and on non-Passive actor rows', () => {
    for (const template of [skill, spell]) {
      expect(template).toContain('{{#if canSkillCheck}}');
      expect(template).toContain('data-action="skillCheck"');
    }
    expect(list).toMatch(/{{#unless isPassive}}[\s\S]*?data-action="skillCheck"[\s\S]*?{{\/unless}}/);
  });

  it('lets Skills and Spells grant a linked Attack', () => {
    for (const template of [skill, spell]) {
      expect(template).toContain('systemFields.isAttack value=systemSource.isAttack');
    }
  });
});

describe('inventoryView', () => {
  const view = inventoryView({
    gear: [
      item('g2', 'gear', 'Ring', 200, { quantity: 1, slot: 'pack', active: true, accessory: true, onHotlist: false }),
      item('g1', 'gear', 'Helm', 100, { quantity: 1, slot: 'head', active: false, accessory: false, onHotlist: true }),
      item('g3', 'gear', 'Cap', 300, { quantity: 1, slot: 'head' }),
      item('g4', 'gear', 'Amulet', 400, { quantity: 3, slot: 'pack', active: false, accessory: true }),
    ],
    weapon: [item('w1', 'weapon', 'Gauntlet', 0, { quantity: 2, slot: 'hands', active: false, onHotlist: true })],
  });
  it('inventory: gear then weapons, each in sort order', () => {
    expect(view.inventory.map(r => r.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'w1']);
  });
  it('rows expose the stored inline values; accessory only for gear', () => {
    expect(view.inventory[0]).toMatchObject({ name: 'Helm', img: 'g1.svg', quantity: 1, slot: 'head', active: false, onHotlist: true, isWeapon: false, worn: true });
    expect(view.inventory[1]).toMatchObject({ accessory: true, worn: false });
    expect(view.inventory[4]).toMatchObject({ isWeapon: true, quantity: 2, slot: 'hands', worn: true });
    expect(view.inventory[4].accessory).toBeUndefined();
  });
  it('paper doll: every gear slot in order, the first item (gear before weapons) per slot', () => {
    expect(view.gearSlots.map(s => s.slot)).toEqual(['head', 'torso', 'arms', 'hands', 'legs', 'feet']);
    expect(view.gearSlots[0]).toEqual({ slot: 'head', label: 'DCC.Slot.head', item: { id: 'g1', name: 'Helm' } });
    expect(view.gearSlots[1].item).toBeNull();
    expect(view.gearSlots[3].item).toEqual({ id: 'w1', name: 'Gauntlet' });
  });
  it('accessories: active accessory items only', () => {
    expect(view.accessories).toEqual([{ id: 'g2', name: 'Ring' }]);
  });
  it('accessories cap at 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`a${i}`, 'gear', `A${i}`, i, { slot: 'pack', active: true, accessory: true }));
    expect(inventoryView({ gear: many }).accessories).toHaveLength(10);
  });
  it('empty input -> empty lists, six empty slots', () => {
    const empty = inventoryView();
    expect(empty.inventory).toEqual([]);
    expect(empty.accessories).toEqual([]);
    expect(empty.gearSlots.every(s => s.item === null)).toBe(true);
  });
});

describe('hotlistCells', () => {
  const items = [
    item('z', 'spell', 'Zap', 5, { onHotlist: true }),
    item('k', 'skill', 'Knives', 1, { onHotlist: true }),
    item('r', 'gear', 'Rations', 1, { onHotlist: true, quantity: 4 }),
    item('h', 'gear', 'Helm', 0, { onHotlist: false, quantity: 1 }),
    item('d', 'weapon', 'Dagger', 9, { onHotlist: true, quantity: 1 }),
    item('a', 'attack', 'Dagger Attack', 0, { onHotlist: true }),
  ];
  const cells = hotlistCells(items);
  it('always 10 cells: grouped inventory, skills/spells, Attacks, then empty cells', () => {
    expect(cells).toHaveLength(10);
    expect(cells.slice(0, 5).map(c => c.id)).toEqual(['r', 'd', 'k', 'z', 'a']);
    expect(cells.slice(5).every(c => c === null)).toBe(true);
  });
  it('entries carry name, img, type; quantity only when above 1', () => {
    expect(cells[0]).toEqual({ id: 'r', name: 'Rations', img: 'r.svg', type: 'gear', quantity: 4, hint: 'DCC.Hotlist.Use.gear' });
    expect(cells.slice(0, 5).map(c => c.hint)).toEqual([
      'DCC.Hotlist.Use.gear', 'DCC.Hotlist.Use.weapon', 'DCC.Hotlist.Use.skill',
      'DCC.Hotlist.Use.spell', 'DCC.Hotlist.Use.attack',
    ]);
    expect(cells[1].quantity).toBeNull();
    expect(cells[3].quantity).toBeNull();
  });
  it('caps at 10 hotlisted items (the first 10 by sort)', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`x${i}`, 'gear', `X${i}`, 12 - i, { onHotlist: true }));
    const c = hotlistCells(many);
    expect(c).toHaveLength(10);
    expect(c.map(e => e.id)).toEqual(['x11', 'x10', 'x9', 'x8', 'x7', 'x6', 'x5', 'x4', 'x3', 'x2']);
  });
  it('no input -> 10 empty cells', () => {
    expect(hotlistCells()).toEqual(Array(10).fill(null));
  });
});

describe('hotlistCells type grouping', () => {
  it('type order wins over sort values, even equal or huge ones', () => {
    const cells = hotlistCells([
      item('sp', 'spell', 'A', -1e9, { onHotlist: true }),
      item('sk', 'skill', 'A', 0, { onHotlist: true }),
      item('w', 'weapon', 'A', 0, { onHotlist: true }),
      item('g2', 'gear', 'B', 1e12, { onHotlist: true }),
      item('g1', 'gear', 'Z', 0, { onHotlist: true }),
    ]);
    expect(cells.slice(0, 5).map(c => c.id)).toEqual(['g1', 'g2', 'w', 'sk', 'sp']);
  });
  it('the cap applies after grouping (spells drop off first)', () => {
    const gear = Array.from({ length: 10 }, (_, i) => item(`g${i}`, 'gear', `G${i}`, i, { onHotlist: true }));
    const cells = hotlistCells([item('sp', 'spell', 'Zap', -5, { onHotlist: true }), ...gear]);
    expect(cells.map(c => c.id)).not.toContain('sp');
  });
});

describe('inventoryView slot conflicts', () => {
  const view = inventoryView({
    gear: [item('glove', 'gear', 'Glove', 5, { slot: 'hands' }), item('hat', 'gear', 'Hat', 1, { slot: 'pack' })],
    weapon: [item('fist', 'weapon', 'Knuckles', 0, { slot: 'hands' })],
  });
  it('gear and a weapon in the same slot: the gear fills the doll', () => {
    expect(view.gearSlots.find(s => s.slot === 'hands').item).toEqual({ id: 'glove', name: 'Glove' });
  });
  it('the hidden occupant is flagged slotConflict; the shown one and pack items are not', () => {
    const byId = Object.fromEntries(view.inventory.map(r => [r.id, r]));
    expect(byId.fist.slotConflict).toBe(true);
    expect(byId.glove.slotConflict).toBe(false);
    expect(byId.hat.slotConflict).toBe(false);
  });
  it('two gear items in one slot: the later one (by sort) is the conflict', () => {
    const v = inventoryView({ gear: [item('b', 'gear', 'B', 2, { slot: 'head' }), item('a', 'gear', 'A', 1, { slot: 'head' })] });
    expect(v.inventory.map(r => [r.id, r.slotConflict])).toEqual([['a', false], ['b', true]]);
  });
});

describe('advancementView (header advancement row)', () => {
  it('eligible owner: every button enabled, Level Up hint tooltip, badges', () => {
    expect(advancementView({ pendingLevels: 1, floor: 3, statPoints: 6, undoStack: [{}] }, true)).toEqual({
      canAct: true,
      canLevelUp: true,
      levelUpTooltip: 'DCC.Advance.LevelUpTooltip',
      canUndo: true,
      undoTooltip: 'DCC.Advance.UndoTooltip',
      pendingLevels: 1,
      statPoints: 6,
      canEndFloor: true,
      endFloorTooltip: 'DCC.Advance.EndFloorTooltip',
      floorEndsAvailable: null,
      safehouseBadge: false,
    });
  });
  it('Level Up disabled with the blocking reason as its tooltip', () => {
    const noPending = advancementView({ pendingLevels: 0, floor: 5 }, true);
    expect(noPending.canLevelUp).toBe(false);
    expect(noPending.levelUpTooltip).toBe('DCC.Advance.Blocked.NoPending');
    expect(advancementView({ pendingLevels: 1, floor: 2 }, true).levelUpTooltip).toBe('DCC.Advance.Blocked.Saferoom');
  });
  it('Undo disabled on an empty (or missing) stack', () => {
    expect(advancementView({ undoStack: [] }, true).canUndo).toBe(false);
    expect(advancementView({}, true).canUndo).toBe(false);
    expect(advancementView({ undoStack: [] }, true).undoTooltip).toBe('DCC.Advance.UndoEmpty');
  });
  it('not editable: nothing enabled; blank counters read 0', () => {
    expect(advancementView({ pendingLevels: 1, floor: 3, undoStack: [{}] }, false)).toMatchObject({
      canAct: false, canLevelUp: false, canUndo: false, canEndFloor: false,
      levelUpTooltip: 'DCC.Advance.ReadOnly', undoTooltip: 'DCC.Advance.ReadOnly', endFloorTooltip: 'DCC.Advance.ReadOnly',
    });
    expect(advancementView()).toMatchObject({ pendingLevels: 0, statPoints: 0 });
  });
});

describe('advancementView: the GM screen gates', () => {
  const gate = (available, safehouse = false) => ({ linked: true, safehouse, available });
  it('no gate (unlinked): End Floor enabled with the plain tooltip, no count, no badge', () => {
    expect(advancementView({}, true)).toMatchObject({
      canEndFloor: true, endFloorTooltip: 'DCC.Advance.EndFloorTooltip', floorEndsAvailable: null, safehouseBadge: false,
    });
  });
  it('linked with no floor end available: End Floor disabled, waiting tooltip', () => {
    expect(advancementView({}, true, gate(0))).toMatchObject({
      canEndFloor: false, endFloorTooltip: 'DCC.Advance.FloorWaiting', floorEndsAvailable: 0,
    });
  });
  it('linked with floor ends available: End Floor enabled, counted tooltip', () => {
    expect(advancementView({}, true, gate(2))).toMatchObject({
      canEndFloor: true, endFloorTooltip: 'DCC.Advance.FloorAvailable', floorEndsAvailable: 2,
    });
  });
  it('linked on Floor 3 with a pending level and no safehouse: Level Up blocked by Safehouse', () => {
    const view = advancementView({ pendingLevels: 1, floor: 3 }, true, gate(0, false));
    expect(view.canLevelUp).toBe(false);
    expect(view.levelUpTooltip).toBe('DCC.Advance.Blocked.Safehouse');
    expect(advancementView({ pendingLevels: 1, floor: 3 }, true, gate(0, true)).canLevelUp).toBe(true);
  });
  it('safehouse badge only when linked and the safehouse is open', () => {
    expect(advancementView({}, true, gate(0, true)).safehouseBadge).toBe(true);
    expect(advancementView({}, true, gate(0, false)).safehouseBadge).toBe(false);
    expect(advancementView({}, true, { linked: false, safehouse: true, available: null }).safehouseBadge).toBe(false);
  });
  it('not editable: End Floor disabled even with floor ends available', () => {
    expect(advancementView({}, false, gate(2)).canEndFloor).toBe(false);
    expect(advancementView({}, false).canEndFloor).toBe(false);
  });
  it('not editable: every reason is ReadOnly, not the gate or eligibility reason', () => {
    const readOnly = { levelUpTooltip: 'DCC.Advance.ReadOnly', undoTooltip: 'DCC.Advance.ReadOnly', endFloorTooltip: 'DCC.Advance.ReadOnly' };
    expect(advancementView({ pendingLevels: 1, floor: 3, undoStack: [{}] }, false, gate(2))).toMatchObject(readOnly);
    expect(advancementView({ pendingLevels: 1, floor: 3 }, false, gate(0, false))).toMatchObject(readOnly);
    expect(advancementView({}, false, gate(2)).floorEndsAvailable).toBe(2);
  });
  it('End Session (canAct) is never GM-gated', () => {
    expect(advancementView({}, true, gate(0)).canAct).toBe(true);
  });
});

describe('isBlankHTML (rich-text field shows the empty placeholder)', () => {
  it('no text: blank, empty tags, whitespace and &nbsp;', () => {
    for (const html of ['', '<p></p>', '<p> &nbsp; </p>', '<p><br></p>', undefined, null]) expect(isBlankHTML(html)).toBe(true);
  });
  it('text or embedded media is not blank', () => {
    expect(isBlankHTML('<p>Hi</p>')).toBe(false);
    for (const html of ['<img src="a.png">', '<video></video>', '<iframe></iframe>', '<table></table>', '<hr>']) expect(isBlankHTML(html)).toBe(false);
  });
});

describe('vehicleWeaponRows', () => {
  // The prepared instance differs from the stored source (as after derived
  // data / effects), so the source reads are observable.
  const w = (id, name, sort, source = {}, derived = {}, instance = {}) => ({
    id, type: 'attack', name, img: `${id}.svg`, sort, system: { ...source, ...instance, derived, _source: source },
  });
  const rows = vehicleWeaponRows([
    w('w2', 'Turret', 200, { rank: 2, gunnerSlot: '1', skillName: 'Gunnery' }, { toHit: 3, damageLabel: '2d8 +0 piercing ' },
      { rank: 9, gunnerSlot: '4', skillName: 'Stale' }),
    w('w1', 'Ram Spike', 100, { rank: 0 }),
  ]);
  it('sorts, and reads rank / gunner slot / skill name from the source', () => {
    expect(rows.map(r => r.id)).toEqual(['w1', 'w2']);
    expect(rows[1]).toEqual({
      id: 'w2', name: 'Turret', img: 'w2.svg', rank: 2, gunnerSlot: '1', skillName: 'Gunnery', toHit: 3, damageLabel: '2d8 +0 piercing',
    });
  });
  it('blank gunner slot / skill name and no derived values stay blank', () => {
    expect(rows[0]).toMatchObject({ gunnerSlot: '', skillName: '', toHit: undefined, damageLabel: '' });
  });
});

describe('crewRows (vehicle crew rows from the live crew actors)', () => {
  const it_ = (id, type, name, sort, system = {}, derived = {}) => ({
    id, type, name, img: `${id}.svg`, sort, system: { ...system, derived, _source: system },
  });
  const carl = {
    name: 'Carl', img: 'carl.svg',
    system: { healthBarDisplay: 7, healthBarSlots: 10, damageResistance: 2 },
    itemTypes: {
      skill: [it_('s1', 'skill', 'Driving', 0, { stat: 'dexterity', rank: 3 }, { skillBonus: 6 })],
      spell: [it_('p1', 'spell', 'Zap', 0, { stat: 'intelligence', linkedItemIds: ['a2'] }, { skillBonus: 2 })],
      attack: [
        it_('a1', 'attack', 'Fist', 0, { stat: 'strength' }, { toHit: 3 }),
        it_('a2', 'attack', 'Zap Attack', 1, { stat: 'intelligence', linkedItemIds: ['p1'] }, { toHit: 4 }),
      ],
    },
  };
  const actors = { 'Actor.carl': carl };
  const resolve = uuid => (actors[uuid] ? { actor: actors[uuid], limited: true, observer: true } : null);
  const rows = crewRows([{ uuid: 'Actor.carl', role: 'driver' }, { uuid: 'Actor.gone', role: 'gunner1' }], resolve, 'vehicle');

  it('a live member: name, HB / DR, role, and canonical roll lists', () => {
    expect(rows[0]).toMatchObject({
      index: 0, uuid: 'Actor.carl', role: 'driver', roleLabel: 'DCC.Crew.Role.driver', missing: false, limited: false, name: 'Carl', img: 'carl.svg', healthBar: 7, healthBarSlots: 10, damageResistance: 2,
      skills: [{ id: 's1', name: 'Driving', bonus: 6 }, { id: 'p1', name: 'Zap', bonus: 2 }],
      attacks: [{ id: 'a1', name: 'Fist', toHit: 3 }, { id: 'a2', name: 'Zap Attack', toHit: 4 }],
    });
  });
  it('role options: value -> label key, per the vehicle kind', () => {
    expect(rows[0].roleOptions).toEqual({
      driver: 'DCC.Crew.Role.driver', gunner1: 'DCC.Crew.Role.gunner1', gunner2: 'DCC.Crew.Role.gunner2',
      gunner3: 'DCC.Crew.Role.gunner3', gunner4: 'DCC.Crew.Role.gunner4', passenger: 'DCC.Crew.Role.passenger',
    });
    const [mountRow] = crewRows([{ uuid: 'Actor.carl', role: 'driver' }], resolve, 'mount');
    expect(mountRow.roleOptions).toEqual({ driver: 'DCC.Crew.Role.rider', passenger: 'DCC.Crew.Role.passenger' });
  });
  it('an unresolved UUID is a missing row (still has its role and index, so it stays removable)', () => {
    expect(rows[1]).toMatchObject({ index: 1, uuid: 'Actor.gone', role: 'gunner1', roleLabel: 'DCC.Crew.Role.gunner1', missing: true });
    expect(rows[1].name).toBeUndefined();
  });
  it('blank derived bonuses read 0; an actor with no items has empty lists', () => {
    const bare = { name: 'Bare', system: {}, itemTypes: { skill: [it_('s', 'skill', 'X', 0, {})] } };
    const [row] = crewRows([{ uuid: 'u', role: 'passenger' }], () => ({ actor: bare, limited: true, observer: true }), 'vehicle');
    expect(row.skills).toEqual([{ id: 's', name: 'X', bonus: 0 }]);
    expect(row.attacks).toEqual([]);
    expect(crewRows(undefined, resolve, 'vehicle')).toEqual([]);
  });
  it('below Observer on the crew actor: name and role only (no HB / DR / roll lists)', () => {
    const [row] = crewRows([{ uuid: 'Actor.carl', role: 'gunner2' }], () => ({ actor: carl, limited: true, observer: false }), 'vehicle');
    expect(row).toMatchObject({ uuid: 'Actor.carl', role: 'gunner2', missing: false, limited: true, name: 'Carl' });
    for (const key of ['healthBar', 'healthBarSlots', 'damageResistance', 'skills', 'attacks', 'img']) expect(row[key]).toBeUndefined();
  });
  it('below Limited on the crew actor: unknown (no name), role kept', () => {
    const [row] = crewRows([{ uuid: 'Actor.carl', role: 'driver' }], () => ({ actor: carl, limited: false, observer: false }), 'vehicle');
    expect(row).toMatchObject({ uuid: 'Actor.carl', role: 'driver', roleLabel: 'DCC.Crew.Role.driver', missing: false, limited: true, unknown: true });
    for (const key of ['name', 'healthBar', 'skills', 'attacks']) expect(row[key]).toBeUndefined();
  });
});

describe('richTextFieldNames', () => {
  it('the form names of every RICH_TEXT_PARTS field, across parts', () => {
    expect(richTextFieldNames({
      notes: [{ key: 'notes', label: 'x', wide: true }],
      bio: [{ key: 'popularity', label: 'y' }, { key: 'regrets', label: 'z' }],
    })).toEqual(['system.notes', 'system.popularity', 'system.regrets']);
  });
  it('none / empty -> []', () => {
    expect(richTextFieldNames({})).toEqual([]);
    expect(richTextFieldNames()).toEqual([]);
  });
});

describe('gmRosterRows (GM screen roster rows from rosterEntries)', () => {
  const pc = (name, src) => ({ documentName: 'Actor', type: 'pc', name, img: `${name}.png`, system: { _source: src, floorEndDone: 99 } });
  const carl = pc('Carl', { floor: 3, pendingLevels: 2, floorEndDone: 1 });
  const donut = pc('Donut', { floor: 2, pendingLevels: 0, floorEndDone: 3 });

  it('a present PC -> name, img, floor, pending and available (from _source)', () => {
    const [row] = gmRosterRows([{ uuid: 'Actor.carl', actor: carl }], 3);
    expect(row).toEqual({
      uuid: 'Actor.carl', missing: false, name: 'Carl', img: 'Carl.png',
      floor: 3, pendingLevels: 2, floorEndDone: 1, available: 2, inconsistent: false,
    });
  });
  it('falls back to system when there is no _source', () => {
    const [row] = gmRosterRows([{ uuid: 'u', actor: { documentName: 'Actor', type: 'pc', name: 'X', system: { floor: 4, pendingLevels: 1, floorEndDone: 0 } } }], 1);
    expect(row).toMatchObject({ floor: 4, pendingLevels: 1, available: 1 });
  });
  it('a missing actor -> missing:true and keeps its uuid (for Remove)', () => {
    expect(gmRosterRows([{ uuid: 'Actor.gone', actor: null }], 2)).toEqual([{ uuid: 'Actor.gone', missing: true }]);
  });
  it('preserves roster order', () => {
    const rows = gmRosterRows([
      { uuid: 'Actor.donut', actor: donut }, { uuid: 'Actor.gone', actor: null }, { uuid: 'Actor.carl', actor: carl },
    ], 3);
    expect(rows.map(r => r.uuid)).toEqual(['Actor.donut', 'Actor.gone', 'Actor.carl']);
  });
  it('flags a cursor above the counter as inconsistent (the documented race), not one at it', () => {
    expect(gmRosterRows([{ uuid: 'd', actor: donut }], 2)[0]).toMatchObject({ inconsistent: true, available: 0 });
    expect(gmRosterRows([{ uuid: 'd', actor: donut }], 3)[0]).toMatchObject({ inconsistent: false, available: 0 });
  });
  it('no entries -> []', () => {
    expect(gmRosterRows(undefined, 0)).toEqual([]);
  });
  it('a non-PC entry (a mob, an index entry with no documentName) -> an invalid missing row, still removable', () => {
    const mob = { documentName: 'Actor', type: 'mob', name: 'Rat', system: { _source: { floorEndDone: 9 } } };
    const index = { type: 'pc', name: 'Carl', _id: 'carl', system: { floorEndDone: 9 } };
    expect(gmRosterRows([{ uuid: 'Actor.rat', actor: mob }, { uuid: 'Actor.idx', actor: index }], 1)).toEqual([
      { uuid: 'Actor.rat', missing: true, invalid: true },
      { uuid: 'Actor.idx', missing: true, invalid: true },
    ]);
  });
});

describe('undoFloorView (GM screen Undo End Floor button)', () => {
  const row = (name, floorEndDone) => ({ uuid: `Actor.${name}`, missing: false, name, floorEndDone });
  it('seq 0 -> disabled with the None reason', () => {
    expect(undoFloorView(0, [row('Carl', 0)], true)).toEqual({ canUndo: false, blockers: [], reason: 'DCC.GmScreen.UndoFloorNone' });
  });
  it('a PC whose cursor reached the counter blocks, by name', () => {
    expect(undoFloorView(2, [row('Carl', 2), row('Donut', 1)], true)).toEqual({ canUndo: false, blockers: ['Carl'], reason: 'DCC.GmScreen.UndoBlocked' });
  });
  it('a missing row never blocks', () => {
    expect(undoFloorView(1, [{ uuid: 'Actor.gone', missing: true }, row('Donut', 0)], true))
      .toEqual({ canUndo: true, blockers: [], reason: 'DCC.GmScreen.UndoFloorTooltip' });
  });
  it('not editable -> disabled with the GM screen ReadOnly reason', () => {
    expect(undoFloorView(1, [row('Donut', 0)], false)).toEqual({ canUndo: false, blockers: [], reason: 'DCC.GmScreen.ReadOnly' });
    expect(undoFloorView(0, [], false)).toMatchObject({ canUndo: false, reason: 'DCC.GmScreen.ReadOnly' });
    expect(undoFloorView(2, [row('Carl', 2)], false)).toMatchObject({ canUndo: false, reason: 'DCC.GmScreen.ReadOnly' });
  });
  it('the GM screen ReadOnly key exists and is not the Crawler one', () => {
    const lang = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
    expect(lang.DCC.GmScreen.ReadOnly).toEqual(expect.any(String));
    expect(lang.DCC.GmScreen.ReadOnly.trim()).not.toBe('');
    expect(lang.DCC.GmScreen.ReadOnly).not.toBe(lang.DCC.Advance.ReadOnly);
  });
});

// Observer sheets: core disables every form control on a sheet the user can't
// edit; the base sheet re-enables ONLY the allow-listed view-only controls.
describe('isViewOnlyControl / enableViewOnlyControls', () => {
  // A fake control: `attrs` are the attribute names it carries; `dataset` its data-* values.
  const el = (attributes = [], dataset = {}) => ({
    disabled: true,
    dataset,
    hasAttribute: a => attributes.includes(a) || (a.startsWith('data-') && (toCamel(a.slice(5)) in dataset)),
  });
  const toCamel = k => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const marked = (dataset, ...attributes) => el(['data-view-only', ...attributes], dataset);
  const root = (...els) => ({ querySelectorAll: sel => (sel === '[data-view-only]' ? els.filter(e => e.hasAttribute('data-view-only')) : []) });

  it('the allow-list is the open-a-sheet actions', () => {
    expect([...VIEW_ONLY_ACTIONS].sort()).toEqual(['editEffect', 'editItem', 'openCrew', 'openCrewing']);
  });
  it.each(['editItem', 'editEffect', 'openCrew', 'openCrewing'])('a marked %s button qualifies', (action) => {
    expect(isViewOnlyControl(marked({ action }))).toBe(true);
  });
  it('a marked crew quick-roll select qualifies', () => {
    expect(isViewOnlyControl(marked({ crewRoll: 'skill' }))).toBe(true);
  });
  it('a marked control with any other action, or none, never qualifies', () => {
    expect(isViewOnlyControl(marked({ action: 'deleteItem' }))).toBe(false);
    expect(isViewOnlyControl(marked({ action: 'rollSkill' }))).toBe(false);
    expect(isViewOnlyControl(marked({}))).toBe(false);
  });
  it('an unmarked control never qualifies', () => {
    expect(isViewOnlyControl(el([], { action: 'editItem' }))).toBe(false);
    expect(isViewOnlyControl(undefined)).toBe(false);
  });
  it.each([['name'], ['data-field'], ['data-crew-role']])('a marked control that writes (%s) never qualifies', (attribute) => {
    expect(isViewOnlyControl(marked({ action: 'editItem' }, attribute))).toBe(false);
    expect(isViewOnlyControl(marked({ crewRoll: 'attack' }, attribute))).toBe(false);
  });
  it('re-enables only the qualifying marked controls and returns how many', () => {
    const open = marked({ action: 'editItem' });
    const named = marked({ action: 'editItem' }, 'name');
    const other = marked({ action: 'deleteItem' });
    const plain = el([], { action: 'editItem' });
    expect(enableViewOnlyControls(root(open, named, other, plain))).toBe(1);
    expect(open.disabled).toBe(false);
    expect(named.disabled).toBe(true);
    expect(other.disabled).toBe(true);
    expect(plain.disabled).toBe(true);
  });
  it('tolerates a missing root', () => {
    expect(enableViewOnlyControls(null)).toBe(0);
  });

  // Every data-view-only control in the shipped templates is an allowed open / crew-roll
  // control with no write wiring, so the runtime check and the markup agree.
  it('every data-view-only element in templates/**/*.hbs is an allowed, non-writing control', () => {
    const dir = new URL('../../templates/', import.meta.url);
    const files = readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.hbs'));
    const tags = files.flatMap(f => [...readFileSync(new URL(String(f).replaceAll('\\', '/'), dir), 'utf8')
      .matchAll(/<[a-z]+\b[^>]*data-view-only[^>]*>/gs)].map(m => ({ file: String(f), tag: m[0] })));
    expect(tags.length).toBeGreaterThan(0);
    for (const { file, tag } of tags) {
      const action = tag.match(/data-action="([^"]*)"/)?.[1];
      const ok = VIEW_ONLY_ACTIONS.has(action) || /data-crew-roll="/.test(tag);
      expect(ok, `${file}: ${tag}`).toBe(true);
      expect(/\sname="|data-field=|data-crew-role/.test(tag), `${file}: ${tag}`).toBe(false);
    }
  });
});

// Vehicle Apply aftermath: two fast clicks must not both flush + apply.
describe('singleFlight', () => {
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

  it('a second call while the first is pending does not run fn and resolves null', async () => {
    const gate = deferred();
    let runs = 0;
    const once = singleFlight(async () => { runs++; await gate.promise; return 'applied'; });
    const first = once();
    const second = once();
    expect(runs).toBe(1);
    expect(await second).toBeNull();
    gate.resolve();
    expect(await first).toBe('applied');
  });

  it('runs again once the first call has settled, even after a rejection', async () => {
    let runs = 0;
    const once = singleFlight(async () => { runs++; if (runs === 1) throw new Error('boom'); return runs; });
    await expect(once()).rejects.toThrow('boom');
    expect(await once()).toBe(2);
  });

  it('passes its arguments through', async () => {
    const once = singleFlight(async (a, b) => a + b);
    expect(await once(2, 3)).toBe(5);
  });

  // PcSheet#advancement / GmScreenSheet#gmAction share one flight across actions:
  // a click on another advancement button while a confirm is open is dropped too.
  it('a shared flight drops a call with a different fn while one is pending', async () => {
    const gate = deferred();
    const ran = [];
    const shared = singleFlight(async fn => fn());
    const first = shared(async () => { ran.push('endFloor'); await gate.promise; return 'floor'; });
    const second = shared(async () => { ran.push('endSession'); return 'session'; });
    expect(await second).toBeNull();
    gate.resolve();
    expect(await first).toBe('floor');
    expect(ran).toEqual(['endFloor']);
  });
});
