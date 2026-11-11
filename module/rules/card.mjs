// Roll chat card — PURE context builder (no Foundry globals).
// Mirrors the R20 roll template (character-sheet/source/rolltemplate/_index.pug):
// The header is red for a pure damage roll and black otherwise; body sections
// render only when their field is present.

/** Card note parts joined with a middle dot; empty / false parts are dropped. */
export const joinNotes = parts => parts.filter(Boolean).join(' · ');

/** A value is present unless undefined, null, '' or false. 0 is present. */
const present = v => v !== undefined && v !== null && v !== '' && v !== false;

/**
 * Neutralise inline-roll brackets in user text. Core ChatMessage#_preCreate
 * evaluates any `[[…]]` in message content (chat-message.mjs:499-512), so an item
 * named `[[1d20]]` would roll. A zero-width space goes between each bracket pair:
 * it still reads as `[[`, the core matcher no longer sees it, and — unlike an HTML
 * entity — Handlebars' {{…}} escaping (&<>"'`= only) leaves it alone, so no
 * literal `&#91;` shows. Non-strings pass through. (`img` is a URL and is not
 * touched.)
 */
const ZWSP = '​';
const safe = v => (typeof v === 'string'
  ? v.replace(/\[(?=\[)/g, `[${ZWSP}`).replace(/](?=])/g, `]${ZWSP}`)
  : v);

/**
 * The natural d20 from a list of evaluated dice terms: the first ACTIVE result
 * of the first 20-faced die. Keep/drop (2d20kh1 / kl1) marks the dropped result
 * `active: false`, so the kept die is what we read.
 * @param {{faces:number, results:{result:number, active:boolean}[]}[]} [dice]
 * @returns {number|null}
 */
export const naturalD20 = (dice = []) => {
  const die = dice.find(t => t?.faces === 20);
  const kept = die?.results?.find(r => r.active);
  return kept ? kept.result : null;
};

/**
 * Template context for templates/chat/card.hbs.
 * Sections are emitted as objects (or strings) only when present, so the
 * template gates on the section, never on a raw number that may be 0.
 * All text fields are inline-roll-neutralised (see `safe`).
 * @param {object} [fields] {name, characterName, img, tag, type, target, dc, result, penalty, note, range, duration, cooldown, cost, insufficient, advantage, utility}
 * @param {{roll?:{total:number, d20:number|null}, damage?:{total:number}}} [results]
 */
export const cardContext = (fields = {}, results = {}) => {
  const { roll, damage } = results;
  const hasRoll = present(roll?.total);
  const hasDamage = present(damage?.total);
  const utility = !!fields.utility;
  const crit = hasRoll && !utility && roll.d20 === 20;
  const fumble = hasRoll && !utility && roll.d20 === 1;
  const damageOnly = hasDamage && !hasRoll;

  const ctx = {
    name: safe(fields.name ?? ''),
    characterName: safe(fields.characterName ?? ''),
    img: fields.img ?? '',
    crit,
    fumble,
    damageOnly,
    headClass: damageOnly ? 'gold-red' : '',
  };
  if (present(fields.tag)) ctx.tag = safe(fields.tag);
  if (hasRoll) ctx.roll = { total: roll.total, crit, fumble };
  if (present(fields.target)) ctx.target = { value: safe(fields.target) };
  if (hasDamage) ctx.damage = { total: damage.total, type: present(fields.type) ? safe(fields.type) : '' };
  if (present(fields.advantage)) ctx.advantage = safe(fields.advantage);
  if (present(fields.dc)) ctx.dc = { value: safe(fields.dc) };
  if (present(fields.result)) ctx.result = safe(fields.result);
  if (present(fields.penalty)) ctx.penalty = safe(fields.penalty);
  if (present(fields.note)) ctx.note = safe(fields.note);
  if (present(fields.notes)) ctx.notes = safe(fields.notes);
  if (present(fields.range)) ctx.range = safe(fields.range);
  if (present(fields.duration)) ctx.duration = safe(fields.duration);
  if (present(fields.cooldown)) ctx.cooldown = safe(fields.cooldown);
  // R20 (_spells.js skillRollFields) omits cost/insufficient when 0/false.
  if (present(fields.cost) && Number(fields.cost) !== 0) ctx.cost = { value: safe(fields.cost) };
  if (fields.insufficient) ctx.insufficient = true;
  return ctx;
};

/** htmlToText input cap: descriptions beyond this are truncated before any regex runs. */
export const HTML_TEXT_MAX = 20000;

/**
 * Named entities decoded by htmlToText (others stay literal); numeric ones
 * (&#65; / &#x41;) are handled generically.
 */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: '\u00a0',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
};
const BLOCK_END = /<\/(p|div|li|h[1-6]|blockquote|pre|tr|section|article|header|footer)\s*>|<br\s*\/?>/gi;

/**
 * Remove <script>/<style> elements with their bodies, in one linear pass
 * (a lazy `[\s\S]*?` regex is quadratic on many unclosed openers). An
 * unclosed element drops everything after its opener.
 */
const stripRawElements = (s) => {
  const lower = s.replace(/[A-Z]/g, c => c.toLowerCase()); // ASCII-only: indices must match `s`
  const open = /<(script|style)\b/g;
  let out = '';
  let pos = 0;
  let m;
  while ((m = open.exec(lower))) {
    out += s.slice(pos, m.index);
    const close = lower.indexOf(`</${m[1]}`, open.lastIndex);
    if (close === -1) return out;
    const end = lower.indexOf('>', close);
    if (end === -1) return out;
    pos = end + 1;
    open.lastIndex = pos;
  }
  return out + s.slice(pos);
};

/**
 * Plain text from an item's HTML description, for a card `note` (which the
 * card template escapes — never inject the raw HTML). The input is capped at
 * HTML_TEXT_MAX; comments and script/style bodies are dropped; block ends and
 * <br> become line breaks; tags are stripped BEFORE entities are decoded, so
 * escaped markup (`&lt;b&gt;`) stays literal text; labelled enricher links
 * (`@UUID[...]{Label}`) read as their label. Every pattern is linear-time
 * (negated classes exclude their own opener). Pure string work (no DOM), so
 * nothing in the description is ever parsed or loaded by the browser.
 * @param {string} html
 * @returns {string}
 */
export const htmlToText = (html) => {
  if (typeof html !== 'string' || !html) return '';
  const text = stripRawElements(html.slice(0, HTML_TEXT_MAX).replace(/<!--[\s\S]*?-->/g, ''))
    .replace(BLOCK_END, '\n')
    .replace(/<[^<>]*>/g, '')
    .replace(/@\w+\[[^\][]*\]\{([^{}]*)\}/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return (Number.isFinite(code) && code > 0 && code <= 0x10ffff) ? String.fromCodePoint(code) : m;
    });
  return text
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
};

/** Match Roll20's compact, single-line card extras; Handlebars escapes the result. */
const cardLine = value => String(value ?? '').trim().replace(/\s*[\r\n]+\s*/g, ' · ');

/** Range and authored HTML notes on Attack cards, controlled by the rolling actor. */
export const attackCardExtras = (settings = {}, attack = {}, range = attack.range) => {
  const result = {};
  const rangeText = cardLine(range);
  const noteText = cardLine(htmlToText(attack.description));
  if (settings.showRangeInChat !== false && rangeText) result.range = rangeText;
  if (settings.showNotesInChat !== false && noteText) result.notes = noteText;
  return result;
};

/** Spell-owned extras take precedence; blank fields fall back to its granted Attack. */
export const spellCardExtras = (settings = {}, spell = {}, attack = {}) => {
  const spellRange = cardLine(spell.range);
  const spellNotes = cardLine(htmlToText(spell.description));
  const result = attackCardExtras(settings, {
    range: spellRange || attack.range,
    description: spellNotes ? spell.description : attack.description,
  });
  for (const field of ['duration', 'cooldown']) {
    const text = cardLine(spell[field]);
    if (text) result[field] = text;
  }
  return result;
};
