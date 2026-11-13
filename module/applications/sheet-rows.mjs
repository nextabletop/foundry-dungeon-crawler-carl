// Actor-sheet display helpers: list rows for the combat / skills tabs and the
// inline item-edit plumbing. PURE (no Foundry globals) so they are unit-tested
// directly; the sheets call them from _prepareContext / _onChangeForm.

import { STATS, GEAR_SLOTS, HOTLIST_CAP, ACCESSORY_CAP, DEFAULT_ITEM_ICONS } from '../config.mjs';
import { buildGear, buildAccessories } from '../rules/inventory.mjs';
import { describeChange } from '../effects/dcc-change.mjs';
import { levelUpBlocker } from '../rules/advancement.mjs';
import { UNLINKED, floorEndBlocked, floorEndsAvailable, isRosterPc, undoFloorEndBlockers } from '../rules/gm-screen.mjs';
import { crewRoleChoices, crewRoleKey } from '../rules/crew.mjs';
import { htmlToText } from '../rules/card.mjs';
import { attackPrimarySkill, attackSource } from '../rules/item-links.mjs';
import { checkTypeOf } from '../rules/items.mjs';

/**
 * The value an inline item control on the actor sheet writes: a checkbox's
 * checked state, a number input's integer (truncated; undefined when blank or not a number,
 * meaning "skip the update"), otherwise the raw value (select, text).
 * @param {{type:string, checked?:boolean, value?:string}} control
 */
export const inlineFieldValue = ({ type, checked, value } = {}) => {
  if (type === 'checkbox') return !!checked;
  if (type === 'number') {
    const s = String(value ?? '').trim();
    const n = Number(s);
    return (s === '' || !Number.isFinite(n)) ? undefined : Math.trunc(n);
  }
  return value;
};

/**
 * The owned-item target of an inline actor-sheet control: a control carrying
 * `data-field` inside a `[data-item-id]` row. Null for any other control.
 * @param {HTMLElement} control
 * @returns {{itemId:string, field:string}|null}
 */
export const inlineEditTarget = (control) => {
  const field = control?.dataset?.field;
  const itemId = field ? control.closest?.('[data-item-id]')?.dataset?.itemId : undefined;
  return (field && itemId) ? { itemId, field } : null;
};

/**
 * A rich-text (HTMLField) value with no text and no embedded media, e.g. '' or
 * the '<p></p>' a cleared editor leaves: the read-only view shows a placeholder.
 * @param {string} [html]
 */
export const isBlankHTML = (html) => {
  const s = String(html ?? '');
  if (/<(img|video|iframe|table|hr)\b/i.test(s)) return false;
  return !s.replace(/<[^>]*>|&nbsp;|\s/g, '');
};

/**
 * Form names (`system.<key>`) of every rich-text field a sheet's
 * RICH_TEXT_PARTS declares, e.g. to leave them out of a programmatic submit.
 * @param {Record<string, {key:string}[]>} [parts]
 * @returns {string[]}
 */
export const richTextFieldNames = (parts = {}) => Object.values(parts).flat().map(({ key }) => `system.${key}`);

// ── Actor-sheet list rows ──

/** Creature ability rows, with the net effect of all modifiers on the stored base. */
export const abilityRows = (system, source) => STATS.map(key => ({
  key,
  label: `DCC.Stat.${key}`,
  abbr: `DCC.StatAbbr.${key}`,
  base: source.stats[key].base,
  enhancement: system.stats[key].enhancement,
  modifier: system.stats[key].modifier,
  buff: system.stats[key].enhancement - source.stats[key].base,
}));

/** Sheet list order: the manual sort, then name. */
export const bySort = (a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || String(a.name ?? '').localeCompare(String(b.name ?? ''));

/** Stat abbreviation label key (blank for an unknown stat). */
const statAbbr = key => (STATS.includes(key) ? `DCC.StatAbbr.${key}` : '');

/**
 * A canonical Attack row. Displays derived values only; Rank comes from a
 * linked Skill/Spell when present, otherwise from the Attack.
 */
const attackRow = (item, items, stats) => {
  const d = item.system.derived ?? {};
  const source = attackSource(item, items);
  const primarySkill = attackPrimarySkill(item, items);
  const magical = source?.type === 'spell' || primarySkill?.type === 'spell';
  return {
    id: item.id,
    name: item.name,
    img: magical && (!item.img || item.img === DEFAULT_ITEM_ICONS.attack) ? DEFAULT_ITEM_ICONS.spell : item.img,
    isSpell: source?.type === 'spell',
    skillName: primarySkill?.name ?? '',
    skillMissing: Boolean(d.primarySkillMissing),
    stat: statAbbr(item.system.stat),
    statModifier: stats[item.system.stat]?.modifier,
    rank: d.rank,
    hasToHit: d.hasToHit !== false && Number.isFinite(d.toHit),
    toHit: d.toHit,
    mobToHit: d.mobToHit,
    mobToHitNone: d.mobToHitNone,
    noDamage: d.noDamage,
    damageLabel: String(d.damageLabel ?? '').trim(),
    range: String(item.system.range ?? '').trim(),
    notes: htmlToText((item.system._source ?? item.system).description),
    skillUses: (d.skillUses ?? []).map(use => ({
      ...use,
      attackId: item.id,
      name: use.label ? `${item.name} (${use.label})` : item.name,
      stat: statAbbr(use.stat),
      statModifier: stats[use.stat]?.modifier,
      hasToHit: use.hasToHit !== false && Number.isFinite(use.toHit),
      damageLabel: String(use.damageLabel ?? '').trim(),
    })),
  };
};

/**
 * A skill / spell row. Editable controls read the stored source values;
 * roll labels read the derived ones.
 */
const skillRow = (item, stats) => {
  const src = item.system._source ?? item.system;
  const d = item.system.derived ?? {};
  const checkType = checkTypeOf(src.checkType);
  const isPassive = checkType === 'passive';
  const summary = [
    ['DCC.Items.Range', src.range],
    ['DCC.Items.Cooldown', src.cooldown],
  ];
  const row = {
    id: item.id,
    name: item.name,
    img: item.img,
    stat: statAbbr(src.stat),
    spell: item.type === 'spell',
    statModifier: stats[src.stat]?.modifier,
    rank: src.rank,
    rankEffective: d.rankEffective ?? src.rank,
    rankModified: Number.isFinite(d.rankEffective) && (d.rankEffective !== src.rank),
    bonus: d.skillBonus,
    mark: src.mark,
    enabled: src.enabled,
    checkType: src.checkType,
    checkTypeKey: `DCC.CheckType.${checkType}`,
    opposedStat: src.opposedStat,
    opposedAbbr: checkType === 'opposed' ? statAbbr(src.opposedStat) : '',
    isOpposed: src.checkType === 'opposed',
    isPassive,
    markable: !isPassive,
    onHotlist: src.onHotlist,
  };
  if (item.type === 'spell') {
    row.cost = d.manaCostEffective;
    if (Number.isFinite(d.manaCostEffective) && d.manaCostEffective !== 0) {
      summary.push(['DCC.Items.ManaCost', d.manaCostEffective]);
    }
    summary.push(['DCC.Items.Duration', src.duration]);
  }
  row.summary = summary
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => ({ label, value }));
  row.hasSummary = row.summary.length > 0;
  return row;
};

/**
 * Actor-sheet item lists from `actor.itemTypes`, each in sort order:
 * `attacks`, `skills`, `spells`. `stats` supplies prepared ability modifiers.
 */
export const sheetItemLists = (itemTypes = {}, stats = {}) => {
  const { attack = [], skill = [], spell = [] } = itemTypes;
  const items = Object.values(itemTypes).flat();
  const spells = [...spell].sort(bySort);
  return {
    attacks: [...attack].sort(bySort).map(item => attackRow(item, items, stats)),
    skills: [...skill].sort(bySort).map(item => skillRow(item, stats)),
    spells: spells.map(item => skillRow(item, stats)),
  };
};

/**
 * Vehicle / mount Attack rows, in sort order. The inline-edited gunner
 * slot and skill name, and the rank (deriveVehicle has no linked-skill rank),
 * read the stored source; to-hit and the damage label are derived.
 */
export const vehicleWeaponRows = (weapons = []) => [...weapons].sort(bySort).map((item) => {
  const src = item.system._source ?? item.system;
  const d = item.system.derived ?? {};
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    rank: src.rank,
    gunnerSlot: src.gunnerSlot ?? '',
    skillName: src.skillName ?? '',
    toHit: d.toHit,
    noDamage: d.noDamage,
    damageLabel: String(d.damageLabel ?? '').trim(),
  };
});

/**
 * Vehicle crew rows (R20 .dcc-crewrow), one per `system.crew` entry, in crew
 * order. `resolve(uuid)` returns `{ actor, limited, observer }` for the live
 * crew actor (the viewer has at least Limited / Observer on it) or null, which
 * makes a `missing` row that keeps its role and index so it can still be
 * removed. `roleOptions` is the role select's value -> label key map for this
 * vehicle `kind`; `roleLabel` the held role's label key. A `limited` row
 * (below Observer) shows the name and role only; an `unknown` one (below
 * Limited, e.g. a hidden Mob) not even the name. Otherwise the quick-roll
 * lists are the member's skills then spells (with their bonus) and its
 * canonical Attacks (with their to-hit), as on its own sheet.
 */
export const crewRows = (crew, resolve, kind) => (crew ?? []).map(({ uuid, role }, index) => {
  const roleOptions = Object.fromEntries(crewRoleChoices(kind, role).map(r => [r, crewRoleKey(r, kind)]));
  const base = { index, uuid, role, roleOptions, roleLabel: crewRoleKey(role, kind) };
  const { actor, limited, observer } = resolve?.(uuid) ?? {};
  if (!actor) return { ...base, missing: true };
  if (!limited) return { ...base, missing: false, limited: true, unknown: true };
  if (!observer) return { ...base, missing: false, limited: true, name: actor.name };
  const { attacks, skills, spells } = sheetItemLists(actor.itemTypes);
  const system = actor.system ?? {};
  return {
    ...base,
    missing: false,
    limited: false,
    name: actor.name,
    img: actor.img,
    healthBar: system.healthBarDisplay,
    healthBarSlots: system.healthBarSlots,
    damageResistance: system.damageResistance,
    skills: [...skills, ...spells].map(({ id, name, bonus }) => ({ id, name, bonus: bonus ?? 0 })),
    attacks: attacks.map(({ id, name, toHit }) => ({ id, name, toHit: toHit ?? 0 })),
  };
});

/** Actor-level effect rows (Buffs & Debuffs), in sort order. */
export const buffRows = (effects = [], items = []) => [...effects].sort(bySort).map(effect => ({
  id: effect.id,
  name: effect.name,
  img: effect.img,
  disabled: effect.disabled,
  notes: htmlToText(effect.description),
  changes: (effect.system?.changes ?? []).map(change => describeChange(change, items)).join(', '),
}));

// ── Inventory tab + hotlist ──

/**
 * An inventory row (gear or weapon). Inline controls read the stored source
 * values; `accessory` exists on gear only. `slotConflict`: worn in a slot the
 * paper doll shows another item in (it still counts as active — see buildGear).
 */
const inventoryRow = (item, occupants) => {
  const src = item.system._source ?? item.system;
  const worn = GEAR_SLOTS.includes(src.slot);
  const row = {
    id: item.id,
    name: item.name,
    img: item.img,
    isWeapon: item.type === 'weapon',
    quantity: src.quantity,
    slot: src.slot,
    active: src.active,
    onHotlist: src.onHotlist,
    notes: htmlToText(src.description),
    worn,
    slotConflict: worn && (occupants[src.slot]?.id !== item.id),
  };
  if (item.type === 'gear') row.accessory = src.accessory;
  return row;
};

/**
 * Inventory tab context from `actor.itemTypes`:
 * `inventory` (gear then weapons, each in sort order), `gearSlots` (the paper
 * doll: every gear slot with its first occupant, or null — see buildGear; gear
 * therefore wins a slot shared with a weapon) and `accessories` (active
 * accessory items, capped at ACCESSORY_CAP — see buildAccessories).
 */
export const inventoryView = ({ gear = [], weapon = [] } = {}) => {
  const items = [...[...gear].sort(bySort), ...[...weapon].sort(bySort)];
  const occupants = buildGear(items);
  return {
    inventory: items.map(item => inventoryRow(item, occupants)),
    gearSlots: GEAR_SLOTS.map(slot => ({ slot, label: `DCC.Slot.${slot}`, item: occupants[slot] })),
    accessories: buildAccessories(items, ACCESSORY_CAP),
  };
};

/** Hotlist grouping: inventory, skills/spells, then canonical Attacks. */
const HOTLIST_TYPE_ORDER = ['gear', 'weapon', 'skill', 'spell', 'attack'];
const typeRank = type => {
  const i = HOTLIST_TYPE_ORDER.indexOf(type);
  return (i === -1) ? HOTLIST_TYPE_ORDER.length : i;
};

/**
 * The header hotlist: always `cap` cells — every owned item with
 * `system.onHotlist`, grouped by type (gear, weapon, skill, spell, attack) and by
 * sort then name within a type (`sort` is only meaningful within one type),
 * the first `cap` of those, then null (empty) cells. `quantity` is set only when
 * above 1 (the ×N badge); `hint` is the key for what a click does (see
 * DCCActor#useHotlistItem).
 * @param {Item[]} [items] - all owned items
 */
export const hotlistCells = (items = [], cap = HOTLIST_CAP) => {
  const entries = items
    .filter(i => i.system?.onHotlist)
    .sort((a, b) => (typeRank(a.type) - typeRank(b.type)) || bySort(a, b))
    .slice(0, cap)
    .map(i => ({
      id: i.id,
      name: i.name,
      img: i.img,
      type: i.type,
      quantity: (Number(i.system.quantity) > 1) ? Number(i.system.quantity) : null,
      hint: `DCC.Hotlist.Use.${i.type}`,
    }));
  return [...entries, ...Array(Math.max(0, cap - entries.length)).fill(null)];
};

/**
 * Header advancement row state, from the PC's SOURCE system data.
 * `levelUpTooltip` / `undoTooltip` are i18n keys: the action's hint when
 * possible, else why not (Level Up: the same levelUpBlocker DCCActor#levelUp
 * warns with; Undo: the empty stack). The header also reads them as the
 * disabled buttons' aria-describedby text.
 *
 * `gate` is the GM screen gate (gmGate's shape; UNLINKED by default). A linked
 * Crawler may Level Up only in the safehouse and End Floor only while a floor
 * end is available; `endFloorTooltip` says which (FloorAvailable takes
 * `floorEndsAvailable` as its {n}). `canAct` gates End Session only, which is
 * never GM-gated. `safehouseBadge`: linked and the safehouse is open.
 * When not `editable`, all three tooltips are `DCC.Advance.ReadOnly`.
 * @param {{pendingLevels?:number, statPoints?:number, floor?:number, undoStack?:object[]}} source
 * @param {boolean} editable - the viewer may act (owner, sheet editable)
 * @param {{linked:boolean, safehouse:boolean, available:number|null}} [gate]
 */
/** Disabled-button reason for a viewer who can't edit the sheet. */
const READ_ONLY = 'DCC.Advance.ReadOnly';

export const advancementView = (source = {}, editable = false, gate = UNLINKED) => {
  const blocker = levelUpBlocker({ ...source, linked: gate.linked, safehouse: gate.safehouse });
  const hasUndo = (source.undoStack?.length ?? 0) > 0;
  const floorOpen = !floorEndBlocked(gate);
  let endFloorTooltip = 'DCC.Advance.EndFloorTooltip';
  if (gate.linked) endFloorTooltip = floorOpen ? 'DCC.Advance.FloorAvailable' : 'DCC.Advance.FloorWaiting';
  // A read-only viewer's buttons are disabled for that reason alone.
  const reason = key => (editable ? key : READ_ONLY);
  return {
    canAct: !!editable,
    canLevelUp: !!editable && !blocker,
    levelUpTooltip: reason(blocker ? `DCC.Advance.Blocked.${blocker}` : 'DCC.Advance.LevelUpTooltip'),
    canUndo: !!editable && hasUndo,
    undoTooltip: reason(hasUndo ? 'DCC.Advance.UndoTooltip' : 'DCC.Advance.UndoEmpty'),
    pendingLevels: +source.pendingLevels || 0,
    statPoints: +source.statPoints || 0,
    canEndFloor: !!editable && floorOpen,
    endFloorTooltip: reason(endFloorTooltip),
    floorEndsAvailable: gate.linked ? gate.available : null,
    safehouseBadge: !!(gate.linked && gate.safehouse),
  };
};

/**
 * GM screen roster rows, in roster order, from rosterEntries' `[{ uuid, actor|null }]`.
 * Values read the PC's SOURCE data (`floorEndDone` is its floor-end cursor). A null actor
 * (deleted) gives `{ uuid, missing: true }`, and an entry that is not a roster PC (isRosterPc: a
 * mob, a compendium actor, an index entry) `{ uuid, missing: true, invalid: true }`; both keep
 * their uuid so they can be removed.
 * `inconsistent`: the cursor is above the counter, the visible symptom of a PC's End Floor
 * racing a GM Undo End Floor or a re-baseline (see the plan's "Known limitations").
 * @param {{uuid:string, actor:Actor|null}[]} entries
 * @param {number} floorEndSeq - the screen's counter
 */
export const gmRosterRows = (entries, floorEndSeq) => (entries ?? []).map(({ uuid, actor }) => {
  if (!actor) return { uuid, missing: true };
  if (!isRosterPc(actor)) return { uuid, missing: true, invalid: true };
  const src = actor.system?._source ?? actor.system ?? {};
  const done = +src.floorEndDone || 0;
  return {
    uuid,
    missing: false,
    name: actor.name,
    img: actor.img,
    floor: src.floor,
    pendingLevels: +src.pendingLevels || 0,
    floorEndDone: done,
    available: floorEndsAvailable(floorEndSeq, done),
    inconsistent: done > (+floorEndSeq || 0),
  };
});

/**
 * GM screen Undo End Floor button state from gmRosterRows' rows: the same blocker rule
 * GmScreenModel#undoEndFloor re-checks (undoFloorEndBlockers; missing rows never block).
 * `reason` is the i18n key for the tooltip: DCC.GmScreen.ReadOnly when not editable, None at seq 0, Blocked (format it with the
 * blockers' names) or the plain hint.
 * @param {number} seq - the screen's counter
 * @param {object[]} rows - gmRosterRows output
 * @param {boolean} editable
 * @returns {{canUndo:boolean, blockers:string[], reason:string}}
 */
export const undoFloorView = (seq, rows, editable) => {
  if (!editable) return { canUndo: false, blockers: [], reason: 'DCC.GmScreen.ReadOnly' };
  if (!((+seq || 0) > 0)) return { canUndo: false, blockers: [], reason: 'DCC.GmScreen.UndoFloorNone' };
  const blockers = undoFloorEndBlockers(seq, (rows ?? []).filter(r => !r.missing));
  return {
    canUndo: !!editable && !blockers.length,
    blockers,
    reason: blockers.length ? 'DCC.GmScreen.UndoBlocked' : 'DCC.GmScreen.UndoFloorTooltip',
  };
};

/** Attributes that wire a control to a write; such a control is never re-enabled for a viewer. */
const WRITE_ATTRS = ['name', 'data-field', 'data-crew-role'];

/** Sheet actions a viewer may use: each only opens another document's sheet. */
export const VIEW_ONLY_ACTIONS = Object.freeze(new Set(['editItem', 'editEffect', 'openCrew', 'openCrewing']));

/**
 * Is `el` an allow-listed view-only control? It must carry `data-view-only`,
 * be either an open-a-sheet button (`data-action` in VIEW_ONLY_ACTIONS) or a
 * crew quick-roll select (`data-crew-roll`: the roll path checks Observer
 * itself), and have none of the write wiring: a `name` (actor form field),
 * `data-field` (inline item edit) or `data-crew-role` (crew role select).
 * @param {Element} el
 * @returns {boolean}
 */
export const isViewOnlyControl = el => !!el?.hasAttribute?.('data-view-only')
  && (VIEW_ONLY_ACTIONS.has(el.dataset?.action) || el.hasAttribute('data-crew-roll'))
  && !WRITE_ATTRS.some(a => el.hasAttribute(a));

/**
 * Re-enable the view-only controls under `root` after core disabled every
 * control on a sheet this user can't edit (DocumentSheetV2#_toggleDisabled).
 * Templates emit `data-view-only` only on controls that should be live (e.g. a
 * crew quick-roll select only when it has options).
 * @param {ParentNode|null} root
 * @returns {number} how many controls were re-enabled
 */
export const enableViewOnlyControls = (root) => {
  let n = 0;
  for (const el of root?.querySelectorAll?.('[data-view-only]') ?? []) {
    if (!isViewOnlyControl(el)) continue;
    el.disabled = false;
    n++;
  }
  return n;
};

/**
 * Wrap an async `fn` so only one call runs at a time: a call made while one is
 * still pending does not run `fn` and resolves null. The busy flag is set
 * synchronously, before `fn`'s first await, and cleared when it settles
 * (resolved or rejected).
 * @template T
 * @param {(...args:any[]) => Promise<T>} fn
 * @returns {(...args:any[]) => Promise<T|null>}
 */
export const singleFlight = (fn) => {
  let busy = false;
  return async (...args) => {
    if (busy) return null;
    busy = true;
    try {
      return await fn(...args);
    } finally {
      busy = false;
    }
  };
};
