import DCCActorSheetBase from './actor-sheet-base.mjs';
import { STATS, ROLL_ABBR, CHECK_TYPES, APP_CLASSES } from '../config.mjs';
import { sheetItemLists, buffRows } from './sheet-rows.mjs';
import { postCard } from '../rolls/card.mjs';
import { DCC_CHANGE_TYPE } from '../effects/dcc-change.mjs';
import { crewingOf } from '../rules/crew.mjs';

/** Check-type <select> choices: value -> label key. */
const CHECK_TYPE_OPTIONS = Object.freeze(Object.fromEntries(CHECK_TYPES.map(t => [t, `DCC.CheckType.${t}`])));
const OPPOSED_STAT_OPTIONS = Object.freeze({
  '': 'DCC.None',
  ...Object.fromEntries(STATS.map(stat => [stat, `DCC.Stat.${stat}`])),
});

/**
 * Creature layer (pc + mob): ability cards, the health bar context, and the
 * ability / Evade rolls. Vehicles extend DCCActorSheetBase directly.
 */
export default class DCCCreatureSheet extends DCCActorSheetBase {
  static DEFAULT_OPTIONS = {
    actions: {
      rollAbility: DCCCreatureSheet.#onRollAbility,
      rollEvade: DCCCreatureSheet.#onRollEvade,
      rollSkill: DCCCreatureSheet.#onRollSkill,
      castSpell: DCCCreatureSheet.#onCastSpell,
      toggleEffect: DCCCreatureSheet.#onToggleEffect,
      createBuff: DCCCreatureSheet.#onCreateBuff,
      editEffect: DCCCreatureSheet.#onEditEffect,
      deleteEffect: DCCCreatureSheet.#onDeleteEffect,
      openCrewing: DCCCreatureSheet.#onOpenCrewing,
    },
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const source = system._source;
    return Object.assign(context, {
      stats: STATS.map(key => ({
        key,
        label: `DCC.Stat.${key}`,
        abbr: `DCC.StatAbbr.${key}`,
        base: source.stats?.[key]?.base,
        enhancement: system.stats?.[key]?.enhancement,
        modifier: system.stats?.[key]?.modifier,
      })),
      ...this._healthContext(),
      ...this._prepareItemLists(),
      crewing: this.#crewing(),
    });
  }

  /**
   * The vehicle UUIDs the Crewing line last showed. module/crew-hooks.mjs
   * reads it to re-render this sheet after the actor leaves a crew (the
   * vehicle's new crew no longer names it).
   * @type {string[]}
   */
  crewingUuids = [];

  /**
   * The read-only Crewing line (R20 .dcc-crewing): each world vehicle this
   * user can see whose crew holds this actor, with the role held there.
   */
  #crewing() {
    const vehicles = game.actors.filter(a => (a.type === 'vehicle') && a.visible).map(v => ({
      uuid: v.uuid, name: v.name, kind: v.system.kind, crew: v.system._source.crew,
    }));
    const crewing = crewingOf(vehicles, this.document.uuid);
    this.crewingUuids = crewing.map(c => c.uuid);
    return crewing;
  }

  /**
   * Item and buff lists: `attacks` (weapons + attack-enabled spells),
   * `skills`, `spells`, actor-level `buffs`, and the check-type choices.
   */
  _prepareItemLists() {
    return {
      ...sheetItemLists(this.document.itemTypes),
      buffs: buffRows(this.document.effects.contents),
      checkTypes: CHECK_TYPE_OPTIONS,
      opposedStats: OPPOSED_STAT_OPTIONS,
    };
  }

  /** The actor-level effect whose `[data-effect-id]` row holds `target`. */
  _effectFromTarget(target) {
    const id = target.closest('[data-effect-id]')?.dataset.effectId;
    return id ? this.document.effects.get(id) : undefined;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  // Every action that reads actor or item data saves pending input first
  // (_flushForm: a Base just typed, then inline item edits), so it reads what
  // was just set; an invalid form aborts it. Targets (item, stat) are read
  // before the flush, whose re-render replaces the DOM.

  /**
   * Ability check: 1d20 + @<abbr> (the stat mod, from DCCActor#getRollData).
   * @this {DCCCreatureSheet}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target - carries data-stat
   */
  static async #onRollAbility(_event, target) {
    const key = target.dataset.stat;
    const abbr = ROLL_ABBR[key];
    if (!abbr || !(await this._flushForm())) return;
    if (!Number.isFinite(this.document.system.stats?.[key]?.modifier)) return;
    await postCard(this.document, {
      name: game.i18n.localize(`DCC.Stat.${key}`),
      tag: game.i18n.localize('DCC.Roll.Ability'),
    }, { roll: `1d20 + @${abbr}` });
  }

  /**
   * Reactive Evade roll: 1d20 + Dex mod + Int mod (the displayed Evade is the
   * static target, 10 + Dex mod + buffs).
   * @this {DCCCreatureSheet}
   */
  static async #onRollEvade() {
    if (!(await this._flushForm())) return;
    const stats = this.document.system.stats;
    if (!Number.isFinite(stats?.dexterity?.modifier) || !Number.isFinite(stats?.intelligence?.modifier)) return;
    await postCard(this.document, {
      name: game.i18n.localize('DCC.Defense.Evade'),
      tag: game.i18n.localize('DCC.Roll.Defense'),
    }, { roll: `1d20 + @${ROLL_ABBR.dexterity} + @${ROLL_ABBR.intelligence}` });
  }

  /** Skill check (a spell casts). @this {DCCCreatureSheet} */
  static async #onRollSkill(_event, target) {
    const item = this._itemFromTarget(target);
    if (!item || !(await this._flushForm())) return;
    await this.document.rollSkill(item);
  }

  /** Cast a spell. @this {DCCCreatureSheet} */
  static async #onCastSpell(_event, target) {
    const item = this._itemFromTarget(target);
    if (!item || !(await this._flushForm())) return;
    await this.document.castSpell(item);
  }

  /** Enable / disable an actor-level buff. @this {DCCCreatureSheet} */
  static async #onToggleEffect(_event, target) {
    const effect = this._effectFromTarget(target);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  /**
   * "+ Buff": an actor-level effect with one initial-phase dcc change, then open its config.
   * @this {DCCCreatureSheet}
   */
  static async #onCreateBuff() {
    if (!this.isEditable) return;
    const [effect] = await this.document.createEmbeddedDocuments('ActiveEffect', [{
      name: game.i18n.localize('DCC.Buff.NewName'),
      img: 'icons/svg/upgrade.svg',
      system: { changes: [{ key: 'strength', type: DCC_CHANGE_TYPE, value: '1', phase: 'initial' }] },
    }]);
    effect?.sheet.render(true);
  }

  /** Open a vehicle from the Crewing line. @this {DCCCreatureSheet} */
  static #onOpenCrewing(_event, target) {
    foundry.utils.fromUuidSync(target.dataset.uuid)?.sheet?.render(true);
  }

  /** @this {DCCCreatureSheet} */
  static async #onEditEffect(_event, target) {
    this._effectFromTarget(target)?.sheet.render(true);
  }

  /** @this {DCCCreatureSheet} */
  static async #onDeleteEffect(_event, target) {
    if (!this.isEditable) return;
    await this._effectFromTarget(target)?.deleteDialog({ classes: [...APP_CLASSES] });
  }
}
