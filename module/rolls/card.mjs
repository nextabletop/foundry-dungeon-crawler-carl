import { cardContext, naturalD20 } from '../rules/card.mjs';
import { cardMessageMode } from '../rules/engine.mjs';

export { cardContext, naturalD20 };

/** Preloaded in index.mjs init. */
export const TEMPLATE = 'systems/dungeon-crawler-carl/templates/chat/card.hbs';

/** An image path usable in the card (random-image wildcards like `goblin/*.webp` are not). */
const usable = src => ((src && !src.includes('*')) ? src : null);

/**
 * Card portrait: the speaker's placed token, else the actor's prototype token
 * (unless random-image), else the actor image.
 */
const speakerImg = (speaker, actor) => {
  const tokenDoc = (speaker?.scene && speaker?.token)
    ? game.scenes?.get(speaker.scene)?.tokens?.get(speaker.token)
    : null;
  const proto = actor.prototypeToken;
  return usable(tokenDoc?.texture?.src)
    ?? (proto?.randomImg ? null : usable(proto?.texture?.src))
    ?? actor.img;
};

/**
 * Evaluate the check/damage formulas and post a DCC roll card to chat.
 *
 * The Roll instances go in the message's `rolls`, so Dice So Nice animates them
 * and core masks them for users who can't see a private message. Core renders its
 * own roll HTML only when `content` is empty, so the card embeds each roll's dice
 * breakdown itself (Roll#getTooltip) in a collapsible <details>.
 *
 * Visibility: the player's `core.messageMode`; a Mob with whispering enabled (cardMessageMode, of `options.privacyOf` ?? actor) upgrades
 * 'public'/'ic' to 'gm'. `chatBubble: false` because 'ic' mode would otherwise put
 * the card HTML in a token speech bubble (chat-message.mjs:533-534).
 *
 * @param {Actor} actor
 * @param {object|((results:{check:{total:number,d20:number|null}|null, damage:{total:number}|null}) => object)} [fields]
 *   Card fields (see cardContext), or a function of the dice results called after
 *   evaluation and before render.
 * @param {{roll?:string, damage?:string}} [formulas]  `roll` is the d20 check; `damage` the damage roll.
 * @param {{speaker?:object, extraRolls?:Roll[], privacyOf?:Actor}} [options]  `speaker` overrides ChatMessage.getSpeaker({actor})
 *   (crew rolls). `privacyOf`: the actor whose visibility applies instead of `actor` (a vehicle card
 *   rolled by a mob driver / gunner whispers like that mob's own rolls). `extraRolls`: already-evaluated Rolls appended to the message's `rolls` after the
 *   check / damage (e.g. advancement d20s), so Dice So Nice, the dice sound and core's private-roll
 *   masking cover them; the card body does not render them.
 * @returns {Promise<{message:ChatMessage|undefined, check:Roll|null, damage:Roll|null, ctx:object}>}
 *   `message` is undefined if a preCreateChatMessage hook cancelled creation.
 */
export async function postCard(actor, fields = {}, { roll, damage } = {}, options = {}) {
  const speaker = options.speaker ?? ChatMessage.getSpeaker({ actor });
  const chosen = game.settings.get('core', 'messageMode');
  const messageMode = cardMessageMode(options.privacyOf ?? actor, chosen);

  const rollData = actor.getRollData();
  const evaluate = async (formula) => {
    if (!formula) return null;
    const r = new foundry.dice.Roll(formula, rollData);
    await r.evaluate({ allowInteractive: messageMode !== 'blind' });
    return r;
  };
  const checkRoll = await evaluate(roll);
  const damageRoll = await evaluate(damage);

  // The natural d20 comes from the check only — a d20 damage die never crits.
  const results = {
    check: checkRoll ? { total: checkRoll.total, d20: naturalD20(checkRoll.dice) } : null,
    damage: damageRoll ? { total: damageRoll.total } : null,
  };
  const resolved = (typeof fields === 'function') ? (fields(results) ?? {}) : fields;

  const ctx = cardContext(
    { ...resolved, characterName: speaker?.alias ?? actor.name, img: speakerImg(speaker, actor) },
    { roll: results.check ?? undefined, damage: results.damage ?? undefined },
  );
  if (ctx.roll) Object.assign(ctx.roll, { formula: checkRoll.formula, tooltip: await checkRoll.getTooltip() });
  if (ctx.damage) Object.assign(ctx.damage, { formula: damageRoll.formula, tooltip: await damageRoll.getTooltip() });

  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, ctx);
  const rolls = [checkRoll, damageRoll, ...(options.extraRolls ?? [])].filter(Boolean);
  // No explicit `sound`: core adds CONFIG.sounds.dice to any message with rolls
  // (chat-message.mjs:517-518) and a roll-less card stays silent.
  const message = await ChatMessage.create({ speaker, rolls, content }, { messageMode, chatBubble: false });
  return { message, check: checkRoll, damage: damageRoll, ctx };
}
