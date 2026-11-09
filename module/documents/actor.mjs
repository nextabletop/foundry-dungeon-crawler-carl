import { directDamage, healSlots, clampSlots } from '../rules/health.mjs';
import { checkFormula, damageFormula, castPlan } from '../rules/combat.mjs';
import { postCard } from '../rolls/card.mjs';
import { htmlToText } from '../rules/card.mjs';
import {
  postDriving, postRam, postRace, rollVehicleWeapon, crewSkillPost, crewAttackPost, applyRamAftermath,
} from './vehicle-rolls.mjs';
import {
  isDue, planAdvancement, undoPush, undoPop, snapshot, restoreUpdates, levelUpBlocker, skillCheckSuccess,
} from '../rules/advancement.mjs';
import { ADVANCING_TYPES, UNDO_MAX, LEVEL_UP_STAT_POINTS } from '../config.mjs';
import { gmLinkFor } from '../gm-link.mjs';
import { floorEndBlocked } from '../rules/gm-screen.mjs';
import { checkTypeLabel, isPassiveCheck } from '../rules/items.mjs';
import { attackSource } from '../rules/item-links.mjs';

const checkTypeTag = system => checkTypeLabel(system?.checkType, system?.opposedStat, key => game.i18n.localize(key));

/** Spell metadata that always rides on a cast card when populated. */
const spellCardMetadata = (system = {}) => Object.fromEntries(
  ['duration', 'cooldown']
    .filter(field => String(system[field] ?? '').trim())
    .map(field => [field, system[field]]),
);

export default class DCCActor extends foundry.documents.Actor {
  /**
   * Core Actor#getRollData returns only `this.system`. Merge (not replace) the
   * model's short keys on top, so both `@stats.dexterity.modifier` and `@dex` resolve.
   * The spread copies the model's own enumerable properties, which includes the
   * instance-only `_modifiers` and `unresolvedModifiers`; that is harmless in roll data.
   * @override
   */
  getRollData() {
    return { ...super.getRollData(), ...this.system.rollShortcuts?.() };
  }

  /** Current slots as the bar shows them (the stored healthBar clamped to healthBarSlots). */
  get currentSlots() {
    return this.system.healthBarDisplay ?? this.system.healthBar;
  }

  /**
   * Write `system.healthBar` unless it equals the current (displayed) slots,
   * so a no-op never overwrites an over-cap stored healthBar.
   * @returns {Promise<DCCActor>}
   */
  async #writeSlots(healthBar) {
    if (healthBar === this.currentSlots) return this;
    return this.update({ 'system.healthBar': healthBar });
  }

  /**
   * Apply one hit: the actor's derived DR first, then chunk by Con Mod.
   * Negative, NaN or sub-slot damage changes nothing and issues no update.
   * @param {number} damage - incoming damage in hit points, before DR.
   * @returns {Promise<DCCActor>}
   */
  async applyDamage(damage) {
    const { damageResistance, healthBarSlots, healthConstitutionModifier } = this.system;
    return this.#writeSlots(directDamage(this.currentSlots, damage, damageResistance, healthConstitutionModifier, healthBarSlots).healthBar);
  }

  /**
   * Heal whole slots (potions), clamped to the slot count. The count is
   * truncated; n <= 0 (or NaN) is a no-op, never damage.
   * @param {number} [n=1]
   * @returns {Promise<DCCActor>}
   */
  async healSlots(n = 1) {
    const slots = Math.trunc(+n || 0);
    if (slots <= 0) return this;
    return this.#writeSlots(healSlots(this.currentSlots, slots, this.system.healthBarSlots));
  }

  /**
   * Set the slots directly (health bar clicks), truncated and clamped to
   * [0, healthBarSlots].
   * @param {number} n
   * @returns {Promise<DCCActor>}
   */
  async setSlots(n) {
    return this.#writeSlots(clampSlots(Math.trunc(+n || 0), this.system.healthBarSlots));
  }

  /**
   * Token bar edits can resolve to no change (a sub-slot HP edit is shrugged,
   * mana is capped at max). No update then fires, so the Token HUD would keep
   * showing the typed entry (e.g. "-1"); re-render it to show the real value.
   * @override
   */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    const result = await super.modifyTokenAttribute(attribute, value, isDelta, isBar);
    const hud = globalThis.canvas?.hud?.token;
    if (hud?.rendered && (hud.actor === this)) hud.render();
    return result;
  }

  /* -------------------------------------------- */
  /*  Rolls (sheet, hotlist and crew entry points) */
  /* -------------------------------------------- */

  /**
   * Re-entry guard: one cast in flight per actor. Per actor (not per spell) so
   * two different spells cast concurrently can't both read the same mana.
   */
  #casting = false;

  /** True when `item` is an item embedded in this actor. */
  #owns(item) {
    return !!item && (item.parent === this);
  }

  /**
   * Skill use: active checks roll 1d20 + the derived skillBonus; Passive
   * skills post their description without a roll. A spell's use IS a cast
   * (R20 rollSkill -> doCast), so spells route to castSpell and always spend mana.
   * @param {Item} item - a skill or spell owned by this actor
   * @param {object} [options] - postCard options (e.g. `speaker` for crew rolls)
   * @returns {Promise<object|null>} postCard's result, or null when nothing rolled
   */
  async rollSkill(item, options = {}) {
    if (!this.#owns(item)) return null;
    if (item.type === 'spell') return this.castSpell(item, options);
    const bonus = item.system?.derived?.skillBonus;
    if (!Number.isFinite(bonus)) return null;
    const fields = { name: item.name, tag: checkTypeTag(item.system) };
    if (isPassiveCheck(item.system)) fields.note = htmlToText(item.system.description);
    return postCard(this, fields, isPassiveCheck(item.system) ? {} : { roll: checkFormula(bonus) }, options);
  }

  /**
   * Manual Skill Check (Roll20 rollSkillAdvancement): roll a bare d20 against
   * the stored base Rank and report Success/Failure without changing Rank.
   * Passive rows and non-PC actors cannot use it.
   * @param {Item} item - an owned skill or spell
   * @param {object} [options] - postCard options
   * @returns {Promise<object|null>}
   */
  async rollSkillCheck(item, options = {}) {
    if ((this.type !== 'pc') || !this.#owns(item) || !ADVANCING_TYPES.includes(item.type) || isPassiveCheck(item.system)) return null;
    const rank = Math.max(0, +(item.system?._source ?? item.system)?.rank || 0);
    return postCard(this, ({ check }) => ({
      name: item.name,
      tag: game.i18n.localize('DCC.Advance.SkillCheck'),
      dc: rank,
      result: game.i18n.localize(skillCheckSuccess(rank, check?.total) ? 'DCC.Advance.Success' : 'DCC.Advance.Failure'),
      utility: true,
    }), { roll: '1d20' }, options);
  }

  /**
   * Roll a canonical Attack Item. To-hit and damage are separate. A linked
   * Spell source makes To-Hit invoke the same cast path as that Spell.
   * @param {Item} item - an owned Attack
   * @param {'toHit'|'damage'} [which='toHit']
   * @param {object} [options] - postCard options
   * @returns {Promise<object|null>}
   */
  async rollAttack(item, which = 'toHit', options = {}) {
    if (!this.#owns(item) || item.type !== 'attack') return null;
    if ((this.type === 'vehicle') && this.system.rollsWithGunner(which)) {
      return this.#vehicleGuard(() => rollVehicleWeapon(this, item, options));
    }
    const source = attackSource(item, this.items);
    if ((source?.type === 'spell') && (which !== 'damage')) return this.castSpell(source, options);
    const d = item.system?.derived ?? {};
    if (which === 'damage') {
      if (!Number.isFinite(d.damageBase)) return null;
      return postCard(this, {
        name: item.name, tag: game.i18n.localize('DCC.Roll.Damage'), type: item.system.damageType ?? '',
      }, { damage: damageFormula(d.damageDice, d.damageBase) }, options);
    }
    if (!Number.isFinite(d.toHit)) return null;
    return postCard(this, { name: item.name, tag: game.i18n.localize('DCC.Roll.ToHit') }, { roll: checkFormula(d.toHit) }, options);
  }

  /**
   * Use an item from the hotlist (also the entry point for macros / crew):
   * spell -> castSpell, Attack -> to-hit, skill -> skill check, gear/weapon -> a
   * roll-less card with the item's description as plain text. Not gated on
   * `onHotlist`, so any owned item can be "used".
   * @param {Item} item - an item owned by this actor
   * @param {object} [options] - postCard options (e.g. `speaker`)
   * @returns {Promise<object|null>} null when nothing was posted
   */
  async useHotlistItem(item, options = {}) {
    if (!this.#owns(item)) return null;
    switch (item.type) {
      case 'spell': return this.castSpell(item, options);
      case 'attack': return this.rollAttack(item, 'toHit', options);
      case 'skill': return this.rollSkill(item, options);
      case 'weapon':
      case 'gear': return postCard(this, {
        name: item.name,
        tag: game.i18n.localize(`TYPES.Item.${item.type}`),
        note: htmlToText(item.system?.description),
      }, {}, options);
      default: return null;
    }
  }

  /**
   * Cast a spell: spend the mana if affordable and auto-enable the spell (see
   * castPlan; one update per document), then post the skill check, or a
   * roll-less card for a Passive spell, with the effective mana cost and
   * insufficient flag.
   *
   * Mana is spent BEFORE the card, reading the current mana, and a per-actor
   * re-entry guard drops any cast while another is in flight, so neither a
   * double-click nor two quick casts can spend from the same mana twice. Policy: if a hook cancels the
   * chat card, the mana stays spent (the cast happened; the card is cosmetic).
   * @param {Item} item - a spell owned by this actor
   * @param {object} [options] - postCard options
   * @returns {Promise<object|null>} null when not cast (or already casting)
   */
  async castSpell(item, options = {}) {
    if (!this.#owns(item) || (item.type !== 'spell')) return null;
    const d = item.system?.derived ?? {};
    if (!Number.isFinite(d.skillBonus)) return null;
    if (this.#casting) return null;
    this.#casting = true;
    try {
      const manaValue = this.system.mana?.value;
      // No mana pool (a mob): nothing to spend, and the card carries no cost / insufficient flag.
      const hasMana = Number.isFinite(manaValue);
      const plan = castPlan({
        manaValue, costEffective: d.manaCostEffective, enabled: item.system.enabled, autoEnable: this.system.autoEnableCast,
      });
      if (hasMana && (plan.manaAfter !== manaValue)) {
        await this.update({ 'system.mana.value': plan.manaAfter });
      }
      if (plan.enable) await item.update({ 'system.enabled': true });
      const manaFields = hasMana ? { cost: d.manaCostEffective ?? 0, insufficient: plan.insufficient } : {};
      return await postCard(this, {
        name: item.name,
        tag: checkTypeTag(item.system),
        ...spellCardMetadata(item.system),
        ...manaFields,
      }, isPassiveCheck(item.system) ? {} : { roll: checkFormula(d.skillBonus) }, options);
    } finally {
      this.#casting = false;
    }
  }

  /* -------------------------------------------- */
  /*  Vehicle actions (R20 _vehicle.js:134-184)   */
  /* -------------------------------------------- */
  // The roll glue lives in ./vehicle-rolls.mjs; these are the public entry
  // points (sheet, macros) and the per-vehicle re-entry guards.

  /**
   * Re-entry guard: one vehicle card (Drive / Ram / Race, a vehicle Attack,
   * a crew roll) in flight per vehicle, so a double-click posts one card
   * (same pattern as #casting).
   */
  #vehicleRolling = false;

  /** Re-entry guard for Apply aftermath (same pattern), separate from the cards. */
  #applyingRam = false;

  /** Run `fn` under the vehicle re-entry guard; null for a non-vehicle or while one is in flight. */
  async #vehicleGuard(fn) {
    if ((this.type !== 'vehicle') || this.#vehicleRolling) return null;
    this.#vehicleRolling = true;
    try {
      return await fn();
    } finally {
      this.#vehicleRolling = false;
    }
  }

  /**
   * Roll a crew member's skill (or spell, as a plain check: no mana is spent)
   * from this vehicle, with the aboard penalty. Posted as the crew actor.
   * @param {Actor} crew - a PC / Mob aboard this vehicle (this user: Observer or better)
   * @param {string} itemId - the crew actor's skill / spell id
   * @param {object} [options] - postCard options
   * @returns {Promise<object|null>} null when refused, no such skill, or already rolling
   */
  async rollCrewSkill(crew, itemId, options = {}) {
    const post = crewSkillPost(this, crew, itemId, options);
    return post ? this.#vehicleGuard(post) : null;
  }

  /**
   * Roll a crew member's canonical Attack from this vehicle:
   * to-hit with the aboard penalty (the Driver / Rider at Disadvantage) plus
   * damage. Posted as the crew actor.
   * @param {Actor} crew - a PC / Mob aboard this vehicle (this user: Observer or better)
   * @param {string} itemId - the crew actor's Attack Item id
   * @param {object} [options] - postCard options
   * @returns {Promise<object|null>}
   */
  async rollCrewAttack(crew, itemId, options = {}) {
    const post = crewAttackPost(this, crew, itemId, options);
    return post ? this.#vehicleGuard(post) : null;
  }

  /** Driving / Riding check in the selected driving mode. @returns {Promise<object|null>} */
  async rollDriving(options = {}) {
    return this.#vehicleGuard(() => postDriving(this, options));
  }

  /** Ram / Trample: to-hit at Disadvantage vs the target Evade, plus the ram damage. @returns {Promise<object|null>} */
  async rollRam(options = {}) {
    return this.#vehicleGuard(() => postRam(this, options));
  }

  /** Race / Chase. @returns {Promise<object|null>} */
  async rollRace(options = {}) {
    return this.#vehicleGuard(() => postRace(this, options));
  }

  /**
   * Apply the ram aftermath (R20 applyRam; see vehicle-rolls.mjs).
   * @returns {Promise<DCCActor|null>} null for a non-vehicle, or while an
   *   apply is already in flight (a double-click must not apply it twice)
   */
  async applyRamAftermath() {
    if ((this.type !== 'vehicle') || this.#applyingRam) return null;
    this.#applyingRam = true;
    try {
      return await applyRamAftermath(this);
    } finally {
      this.#applyingRam = false;
    }
  }

  /**
   * "DR absorbed a hit" (R20 drAbsorbed): the vehicle loses one slot, never
   * below 0.
   * @returns {Promise<DCCActor|null>} null for a non-vehicle
   */
  async damageResistanceAbsorbed() {
    if (this.type !== 'vehicle') return null;
    return this.setSlots(this.currentSlots - 1);
  }

  /* -------------------------------------------- */
  /*  Advancement (PC only; R20 _skills.pug:149-217) */
  /* -------------------------------------------- */

  /**
   * Re-entry guard shared by all four advancement actions: an Undo (or a
   * second End Session) landing while one is in flight would read a stale
   * undo stack / counters and double-apply or pop the wrong snapshot.
   * PER CLIENT: the flag lives on this client's Actor instance only, so it
   * stops a double-click here but not two owners clicking on two clients at
   * once (Foundry has no cross-client lock; acceptable for a player action).
   */
  #advancing = false;

  /**
   * Run `fn` under the advancement guard. Owner-only and PC-only (only the PC
   * model has pendingLevels / statPoints / undoStack; R20 marks these
   * controls .dcc-pc-only). Returns null when refused.
   */
  async #advancementGuard(fn) {
    if (!this.isOwner || (this.type !== 'pc') || this.#advancing) return null;
    this.#advancing = true;
    try {
      return await fn(this.system._source ?? this.system);
    } finally {
      this.#advancing = false;
    }
  }

  /**
   * The GM screen gate for this Crawler ({linked, safehouse, available}; UNLINKED
   * when not rostered, no screen is configured, or not a PC). THE single source
   * for the advancement gates: endFloor / levelUp read it here, and the sheet
   * must pass this same call as advancementView's third argument
   * (`advancementView(src, editable, actor.advancementGate(src))`), so the buttons
   * and the refusals can never disagree.
   * @param {object} [source] - the SOURCE system data (the cursor is read from
   *   it); omitted -> gmLinkFor's default (this actor's system._source)
   * @returns {{linked:boolean, safehouse:boolean, available:number|null}}
   */
  advancementGate(source) {
    return gmLinkFor(this, source);
  }

  /**
   * End Session: marked, non-passive skills and spells at rank <= 4 roll to
   * advance; pendingLevels += 1.
   * @returns {Promise<{updates:object[], rolls:object}|null>}
   */
  async endSession() {
    return this.#advancementGuard(src => this.#advance('session', src));
  }

  /**
   * End Floor: marked, non-passive skills and spells at rank >= 5 roll to
   * advance (capped by the CURRENT floor, as R20 advances before the
   * increment); floor += 1. A Crawler linked to the GM screen needs an
   * unconsumed floor end and consumes one (floorEndDone + 1); an unlinked PC
   * is ungated and never touches its cursor.
   * @returns {Promise<{updates:object[], rolls:object}|null>}
   */
  async endFloor() {
    return this.#advancementGuard(async (src) => {
      const gate = this.advancementGate(src);
      if (floorEndBlocked(gate)) {
        ui.notifications.warn(game.i18n.localize('DCC.Advance.FloorWaiting'));
        return null;
      }
      return this.#advance('floor', src, { consumeFloorEnd: gate.linked });
    });
  }

  /**
   * Shared End Session / End Floor (R20 processAdvancement + endSession /
   * endFloor). Order: snapshot, silent 1d20 per due row, plan; then ONE actor
   * update (undo push + counter) BEFORE the ONE item update, so a failed item
   * write still leaves an undo entry; then one summary card. The snapshot is
   * pushed and the counter bumped even when nothing is due (R20).
   * `consumeFloorEnd` (linked End Floor only) adds floorEndDone + 1 to that same
   * actor update; the snapshot, taken first, keeps the pre-increment cursor.
   */
  async #advance(trigger, src, { consumeFloorEnd = false } = {}) {
    const skills = this.items.contents
      .filter(i => ADVANCING_TYPES.includes(i.type))
      .map(i => ({ id: i.id, type: i.type, name: i.name, system: i.system?._source ?? i.system }));
    const snap = snapshot({ items: skills, system: src });

    const rolls = {};
    const dice = [];
    for (const s of skills) {
      if (!isDue(s, trigger)) continue;
      const roll = new foundry.dice.Roll('1d20');
      await roll.evaluate({ allowInteractive: false });
      rolls[s.id] = roll.total;
      dice.push(roll);
    }
    const { updates } = planAdvancement({ skills, trigger, floor: +src.floor || 0, rolls });

    // Card lines are built BEFORE the writes: document sources are updated in
    // place, so old ranks / the old counter read afterwards would be the new ones.
    const counter = (trigger === 'session') ? 'pendingLevels' : 'floor';
    const from = +src[counter] || 0;
    const byId = new Map(skills.map(s => [s.id, s]));
    const lines = updates.map(u => game.i18n.format('DCC.Advance.SkillLine', {
      name: byId.get(u.id).name, from: +byId.get(u.id).system.rank || 0, to: u.rank, d20: rolls[u.id],
    }));
    if (!lines.length) lines.push(game.i18n.localize('DCC.Advance.NoneDue'));
    lines.push(game.i18n.format(`DCC.Advance.${counter === 'floor' ? 'FloorLine' : 'PendingLine'}`, { from, to: from + 1 }));

    await this.update({
      'system.undoStack': undoPush(src.undoStack ?? [], snap, UNDO_MAX),
      [`system.${counter}`]: from + 1,
      // Absolute write (read cursor + 1, like the counter), not an increment: two clients racing one floor end both write the same value, so the cursor converges on one consumed.
      ...(consumeFloorEnd ? { 'system.floorEndDone': (+src.floorEndDone || 0) + 1 } : {}),
    });
    if (updates.length) {
      await this.updateEmbeddedDocuments('Item', updates.map(u => ({
        _id: u.id, 'system.rank': u.rank, 'system.mark': u.mark,
      })));
    }
    await postCard(this, {
      name: game.i18n.localize('DCC.Advance.Label'),
      tag: game.i18n.localize(trigger === 'session' ? 'DCC.Advance.EndSession' : 'DCC.Advance.EndFloor'),
      note: lines.join('\n'),
    }, {}, { extraRolls: dice });
    return { updates, rolls };
  }

  /**
   * Level Up (R20 levelUp, _skills.pug:194-201): needs a pending level and a
   * saferoom (floor >= 3) and, for a Crawler linked to the GM screen, the GM's
   * safehouse (advancementGate); then level + 1, statPoints + 3, pendingLevels - 1.
   * Pushes no undo entry (R20), so Undo never reverts a level. Posts a short
   * roll-less card.
   * @returns {Promise<DCCActor|null>} null when refused
   */
  async levelUp() {
    return this.#advancementGuard(async (src) => {
      const gate = this.advancementGate(src);
      const blocker = levelUpBlocker({ ...src, linked: gate.linked, safehouse: gate.safehouse });
      if (blocker) {
        ui.notifications.warn(game.i18n.localize(`DCC.Advance.Blocked.${blocker}`));
        return null;
      }
      const level = +src.level || 0;
      await this.update({
        'system.level': level + 1,
        'system.statPoints': (+src.statPoints || 0) + LEVEL_UP_STAT_POINTS,
        'system.pendingLevels': (+src.pendingLevels || 0) - 1,
      });
      await postCard(this, {
        name: game.i18n.localize('DCC.Advance.Label'),
        tag: game.i18n.localize('DCC.Advance.LevelUp'),
        note: game.i18n.format('DCC.Advance.LevelLine', { from: level, to: level + 1, points: LEVEL_UP_STAT_POINTS }),
      });
      return this;
    });
  }

  /**
   * Undo the last End Session / End Floor (R20 undoAdvancement,
   * _skills.pug:203-215): pop the stack, restore pendingLevels, floor and
   * every snapshotted row's rank + mark (manual edits since are overwritten,
   * as in R20). Rows whose item has since been deleted are skipped. The
   * floor-end cursor is restored only within the same epoch: restoreUpdates
   * gets the RAW source epoch (never coerced; see its strict compare).
   * @returns {Promise<object|null>} the restored snapshot, or null
   */
  async undoAdvancement() {
    return this.#advancementGuard(async (src) => {
      const { snapshot: snap, rest } = undoPop(src.undoStack);
      if (!snap) {
        ui.notifications.warn(game.i18n.localize('DCC.Advance.UndoEmpty'));
        return null;
      }
      // Items FIRST: the restores are idempotent, so if the item write fails
      // the snapshot is still on the stack and Undo can simply be retried.
      const { actor, items } = restoreUpdates(snap, this.items.contents.map(i => i.id), src.floorEndEpoch);
      if (items.length) await this.updateEmbeddedDocuments('Item', items);
      await this.update({ 'system.undoStack': rest, ...actor });
      return snap;
    });
  }
}
