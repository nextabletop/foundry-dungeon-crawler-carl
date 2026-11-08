import DCCActorSheetBase, { ACTOR_PARTIALS, templatePath as path } from './actor-sheet-base.mjs';
import { GUNNER_SLOTS } from '../config.mjs';
import { VEHICLE_SIZES } from '../rules/vehicle.mjs';
import { vehicleWeaponRows, crewRows, singleFlight } from './sheet-rows.mjs';
import { addCrewMember, removeCrewMember, assignCrewRole, crewDropRejection } from '../rules/crew.mjs';

/** <select> choices: value -> label key (localized by selectOptions). */
const KIND_OPTIONS = Object.freeze({ vehicle: 'DCC.Vehicle.Kinds.vehicle', mount: 'DCC.Vehicle.Kinds.mount' });
const MODE_OPTIONS = Object.freeze({
  accelerate: 'DCC.Vehicle.Mode.accelerate', stop: 'DCC.Vehicle.Mode.stop', longhaul: 'DCC.Vehicle.Mode.longhaul',
});
const ADVANTAGE_OPTIONS = Object.freeze({ '': 'DCC.Vehicle.AdvantageNone', adv: 'DCC.Vehicle.AdvantageChip.adv', dis: 'DCC.Vehicle.AdvantageChip.dis' });
const GUNNER_OPTIONS = Object.freeze(Object.fromEntries(['', ...GUNNER_SLOTS].map(s => [s, `DCC.Vehicle.GunnerSlot.${s || 'none'}`])));

/**
 * Vehicle / Mount stat block (R20 mode = vehicle, views/_vehicle.pug): one
 * scrolling page, no tabs. `kind` (vehicle | mount) swaps the attack list
 * title, the Gunner / Skill columns and the rules chips. The stat block and
 * the Notes editor are separate parts, as on the mob sheet, so an open Notes
 * editor survives stat-block re-renders.
 *
 * Crew (Task 21): drop a world PC / Mob on the sheet to add it as a
 * passenger; each crew row reads the live actor (fromUuidSync) for its name,
 * HB, DR and quick-roll lists, and module/crew-hooks.mjs re-renders the sheet
 * when a crew member changes. Crew rolls (Task 22): the Driving / Ram / Race
 * cards add the Driver's drive-skill bonus (VehicleModel#resolveDriver), a
 * vehicle weapon's to-hit adds its gunner's skill bonus, and a crew row's
 * quick-roll selects roll that member's skills / attacks from the vehicle.
 * Owned item types: weapons only.
 */
export default class VehicleSheet extends DCCActorSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ['vehicle'],
    position: { width: 680, height: 860 },
    actions: {
      rollDriving: VehicleSheet.#onRollDriving,
      rollRam: VehicleSheet.#onRollRam,
      applyRam: VehicleSheet.#onApplyRam,
      rollRace: VehicleSheet.#onRollRace,
      damageResistanceAbsorbed: VehicleSheet.#onDamageResistanceAbsorbed,
      openCrew: VehicleSheet.#onOpenCrew,
      removeCrew: VehicleSheet.#onRemoveCrew,
    },
  };

  static ALLOWED_ITEM_TYPES = ['weapon'];

  static RICH_TEXT_PARTS = {
    notes: [{ key: 'notes', label: 'DCC.Bio.Notes', wide: true }],
  };

  static PARTS = {
    body: {
      template: path('actor/vehicle/body.hbs'),
      templates: [ACTOR_PARTIALS.healthBar, ACTOR_PARTIALS.unresolved, ACTOR_PARTIALS.vehicleWeaponList, ACTOR_PARTIALS.itemRow],
    },
    notes: { template: path('actor/vehicle/notes.hbs'), templates: [ACTOR_PARTIALS.richFields] },
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    return Object.assign(context, {
      isMount: system.kind === 'mount',
      kindOptions: KIND_OPTIONS,
      sizeOptions: Object.fromEntries(VEHICLE_SIZES.map(({ v }) => [v, game.i18n.format('DCC.Vehicle.SizeOption', {
        v, name: game.i18n.localize(`DCC.Vehicle.Sizes.${v}`),
      })])),
      modeOptions: MODE_OPTIONS,
      advantageOptions: ADVANTAGE_OPTIONS,
      gunnerSlots: GUNNER_OPTIONS,
      ...this._healthContext(),
      attacks: vehicleWeaponRows(this.document.itemTypes.weapon),
      crew: crewRows(system._source.crew, VehicleSheet.#resolveCrew, system.kind),
    });
  }

  /* -------------------------------------------- */
  /*  Crew                                        */
  /* -------------------------------------------- */

  /**
   * A crew UUID -> `{ actor, limited, observer }` for crewRows (null when
   * the actor no longer exists). Below Observer on the crew actor, its row
   * shows only the name and role; below Limited, not even the name.
   */
  static #resolveCrew(uuid) {
    const actor = foundry.utils.fromUuidSync(uuid);
    if (!actor) return null;
    return {
      actor,
      limited: actor.testUserPermission(game.user, 'LIMITED'),
      observer: actor.testUserPermission(game.user, 'OBSERVER'),
    };
  }

  /**
   * Write a new crew list; on failure show the error. `restore` puts a
   * control back to its rendered value.
   * @returns {Promise<boolean>} whether the update succeeded
   */
  async #updateCrew(crew, restore) {
    try {
      await this.document.update({ 'system.crew': crew });
      return true;
    } catch (err) {
      restore?.();
      ui.notifications.error(err, { console: true });
      return false;
    }
  }

  /**
   * Dropping a PC / Mob adds it to the crew as a passenger (anywhere on the
   * sheet: an actor drop means nothing else here). Only an editable sheet
   * (a vehicle owner's) may;
   * vehicles, unlinked token actors and compendium actors are rejected, and
   * one already aboard is not added twice.
   * @param {DragEvent} _event
   * @param {Actor} actor
   * @returns {Promise<Actor|null>} the actor when it was added
   * @override
   */
  async _onDropActor(_event, actor) {
    if (!this.isEditable || !actor) return null;
    const reason = crewDropRejection({
      type: actor.type,
      isToken: actor.isToken,
      inWorld: !actor.pack && (game.actors.get(actor.id) === actor),
    });
    if (reason) {
      ui.notifications.warn(`DCC.Crew.Reject.${reason}`, { format: { name: actor.name } });
      return null;
    }
    const crew = addCrewMember(this.document.system._source.crew, actor.uuid);
    if (!crew) {
      ui.notifications.info('DCC.Crew.AlreadyAboard', { format: { name: actor.name } });
      return null;
    }
    return (await this.#updateCrew(crew)) ? actor : null;
  }

  /**
   * Crew-row controls are unnamed (not part of the actor form): the role
   * select rewrites `system.crew` through assignCrewRole, and a quick-roll
   * select fires _onCrewRoll then resets. Every other control falls through.
   * @inheritDoc
   */
  _onChangeForm(formConfig, event) {
    const control = event.target;
    const uuid = control.closest?.('[data-crew-uuid]')?.dataset.crewUuid;
    if (uuid && control.matches('[data-crew-role]')) return void this.#setCrewRole(uuid, control);
    if (uuid && control.matches('[data-crew-roll]')) {
      const itemId = control.value;
      control.value = '';
      if (itemId) this._onCrewRoll(uuid, control.dataset.crewRoll, itemId);
      return;
    }
    return super._onChangeForm(formConfig, event);
  }

  /**
   * Assign a crew role (exclusive Driver / Gunner N: the old holder becomes a
   * passenger). A crew member whose actor no longer exists can't take a role
   * (missing rows render no select; this guards a stale one).
   */
  async #setCrewRole(uuid, control) {
    const restore = () => { for (const opt of control.options) opt.selected = opt.defaultSelected; };
    const alive = !!foundry.utils.fromUuidSync(uuid);
    const crew = (this.isEditable && alive) ? assignCrewRole(this.document.system._source.crew, uuid, control.value) : null;
    if (!crew) return restore();
    await this.#updateCrew(crew, restore);
  }

  /**
   * A crew quick-roll pick: one of the member's skills / spells (`kind`
   * 'skill') or attacks ('attack'), by item id, rolled from the vehicle with
   * its aboard penalty (DCCActor#rollCrewSkill / #rollCrewAttack). Pending
   * edits are saved first: the card reads the vehicle's Speed, kind, drive
   * skill and Floor. Only a viewer with Observer on the crew member gets the
   * selects; the actor methods re-check that and that the member is aboard.
   * @param {string} uuid - the crew actor's UUID
   * @param {'skill'|'attack'} kind
   * @param {string} itemId - the crew actor's item id
   * @returns {Promise<object|null>} postCard's result, or null when nothing rolled
   * @protected
   */
  async _onCrewRoll(uuid, kind, itemId) {
    try {
      if (!(await this._flushForm())) return null;
      const crew = foundry.utils.fromUuidSync(uuid);
      if (!crew) return null;
      return await (kind === 'attack'
        ? this.document.rollCrewAttack(crew, itemId)
        : this.document.rollCrewSkill(crew, itemId));
    } catch (err) {
      ui.notifications.error(err, { console: true });
      return null;
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  // Each action saves pending input first (_flushForm), so e.g. Apply
  // aftermath reads the Damage dealt just typed; an invalid form aborts it.

  /** @this {VehicleSheet} */
  static async #onRollDriving() {
    if (!(await this._flushForm())) return;
    await this.document.rollDriving();
  }

  /** @this {VehicleSheet} */
  static async #onRollRam() {
    if (!(await this._flushForm())) return;
    await this.document.rollRam();
  }

  /**
   * Flush + apply as one guarded step: a click while an earlier one is still
   * flushing or applying is ignored, so two fast clicks can't both apply. (The
   * actor's own guard covers only the apply, not the flush before it.)
   */
  #applyRamOnce = singleFlight(async () => {
    if (!(await this._flushForm())) return null;
    return this.document.applyRamAftermath();
  });

  /** Apply the ram aftermath (an owner edit, like any sheet input). @this {VehicleSheet} */
  static async #onApplyRam() {
    if (!this.isEditable) return;
    await this.#applyRamOnce();
  }

  /** @this {VehicleSheet} */
  static async #onRollRace() {
    if (!(await this._flushForm())) return;
    await this.document.rollRace();
  }

  /** "DR absorbed a hit": -1 slot (reads no input). @this {VehicleSheet} */
  static async #onDamageResistanceAbsorbed() {
    if (this.isEditable) await this.document.damageResistanceAbsorbed();
  }

  /** Open a crew member's sheet. @this {VehicleSheet} */
  static #onOpenCrew(_event, target) {
    const uuid = target.closest('[data-crew-uuid]')?.dataset.crewUuid;
    foundry.utils.fromUuidSync(uuid)?.sheet?.render(true);
  }

  /** Unlink a crew member (a missing one too); the actor itself is untouched. @this {VehicleSheet} */
  static async #onRemoveCrew(_event, target) {
    const uuid = target.closest('[data-crew-uuid]')?.dataset.crewUuid;
    if (!this.isEditable || !uuid) return;
    await this.#updateCrew(removeCrewMember(this.document.system._source.crew, uuid));
  }
}
