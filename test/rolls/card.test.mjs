import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { attackCardExtras, cardContext, naturalD20, htmlToText, joinNotes, spellCardExtras } from '../../module/rules/card.mjs';

const d = (faces, ...results) => ({ faces, results: results.map(([result, active = true]) => ({ result, active })) });

describe('naturalD20', () => {
  it('reads the single d20 result', () => {
    expect(naturalD20([d(20, [17])])).toBe(17);
  });
  it('uses the kept die for 2d20kh1 / 2d20kl1', () => {
    expect(naturalD20([d(20, [4, false], [19])])).toBe(19);
    expect(naturalD20([d(20, [4], [19, false])])).toBe(4);
  });
  it('finds the first d20 even when it is not the first die', () => {
    expect(naturalD20([d(6, [3]), d(20, [1]), d(20, [20])])).toBe(1);
  });
  it('is null when there is no d20', () => {
    expect(naturalD20([d(6, [6])])).toBeNull();
    expect(naturalD20([])).toBeNull();
    expect(naturalD20()).toBeNull();
  });
});

describe('cardContext', () => {
  it('flags a crit on a natural 20 while retaining the default black header', () => {
    const ctx = cardContext({ name: 'Punch', tag: 'To Hit' }, { roll: { total: 25, d20: 20 } });
    expect(ctx.crit).toBe(true);
    expect(ctx.fumble).toBe(false);
    expect(ctx.damageOnly).toBe(false);
    expect(ctx.headClass).toBe('');
    expect(ctx.roll).toEqual({ total: 25, crit: true, fumble: false });
  });

  it('flags a fumble on a natural 1 while retaining the default black header', () => {
    const ctx = cardContext({ name: 'Punch' }, { roll: { total: 3, d20: 1 } });
    expect(ctx.fumble).toBe(true);
    expect(ctx.crit).toBe(false);
    expect(ctx.headClass).toBe('');
  });

  it('a total of 20 is not a crit unless the die was a 20', () => {
    const ctx = cardContext({}, { roll: { total: 20, d20: 15 } });
    expect(ctx.crit).toBe(false);
    expect(ctx.headClass).toBe('');
  });

  it('a roll with no d20 is neither crit nor fumble', () => {
    const ctx = cardContext({}, { roll: { total: 7, d20: null } });
    expect(ctx.crit).toBe(false);
    expect(ctx.fumble).toBe(false);
  });

  it('utility rolls suppress crit/fumble badges and header tints', () => {
    const crit = cardContext({ utility: true, result: 'Success' }, { roll: { total: 20, d20: 20 } });
    const fumble = cardContext({ utility: true, result: 'Failure' }, { roll: { total: 1, d20: 1 } });
    expect(crit).toMatchObject({ crit: false, fumble: false, headClass: '', result: 'Success' });
    expect(fumble).toMatchObject({ crit: false, fumble: false, headClass: '', result: 'Failure' });
  });

  it('damage without a roll is damage-only with the gold-red tint', () => {
    const ctx = cardContext({ name: 'Sword', tag: 'Damage', type: 'Slashing' }, { damage: { total: 9 } });
    expect(ctx.damageOnly).toBe(true);
    expect(ctx.crit).toBe(false);
    expect(ctx.fumble).toBe(false);
    expect(ctx.headClass).toBe('gold-red');
    expect(ctx.damage).toEqual({ total: 9, type: 'Slashing' });
    expect(ctx.roll).toBeUndefined();
  });

  it('roll + damage (spell cast) is not damage-only; the roll tint wins', () => {
    const ctx = cardContext({}, { roll: { total: 22, d20: 20 }, damage: { total: 5 } });
    expect(ctx.damageOnly).toBe(false);
    expect(ctx.headClass).toBe('');
    expect(ctx.damage).toEqual({ total: 5, type: '' });
  });

  describe('Roll20 card styling parity', () => {
    const template = readFileSync(new URL('../../templates/chat/card.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');

    it('renders the breakout portrait only when an image exists', () => {
      expect(template).toContain('{{#if img}}<span class="dcc-card-token"><img src="{{img}}" alt="{{characterName}}"></span>{{/if}}');
    });

    it('keeps the Roll20 cast-detail order: Range, Mana Cost, Duration, Cooldown', () => {
      const positions = ['DCC.Card.Range', 'DCC.Card.ManaCost', 'DCC.Card.Duration', 'DCC.Card.Cooldown']
        .map(label => template.indexOf(label));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it('ports the current Roll20 dimensions, typography, palette, and result pill', () => {
      for (const rule of [
        'min-width: 200px;',
        'max-width: 300px;',
        'font-family: "Roboto Condensed", "Arial Narrow", system-ui, sans-serif;',
        '--rt-crit: #40e240;',
        '--rt-fumble: #8b1e22;',
        'font-size: 14px;',
        'font-size: 12px;',
        'min-width: 56px;',
        'padding: 4px 16px;',
        'grid-template-columns: max-content minmax(0, auto);',
      ]) expect(css).toContain(rule);
    });

    it('uses black headers in both themes and red only for damage', () => {
      expect(css).toContain('--rt-bar: #000000;');
      expect(css.match(/--rt-bar:/g)).toHaveLength(1);
      expect(css).toContain('.dcc-card .dcc-card-head.gold-red');
      expect(css).not.toContain('.dcc-card .dcc-card-head.fail');
      expect(css).not.toContain('.dcc-card .dcc-card-head.crit');
    });
  });

  it('passes through all text fields', () => {
    const fields = {
      name: 'Fireball', characterName: 'Carl', img: 'carl.webp', tag: 'Spell',
      target: 14, dc: 12, penalty: 'Aboard: -2', note: 'Driver: Donut',
      range: '30 feet', notes: 'Reach', duration: '2 rounds', cooldown: 'Once per scene',
      cost: 3, insufficient: true, advantage: 'Advantage',
    };
    const ctx = cardContext(fields, { roll: { total: 11, d20: 9 } });
    expect(ctx).toMatchObject({
      name: 'Fireball', characterName: 'Carl', img: 'carl.webp', tag: 'Spell',
      target: { value: 14 }, dc: { value: 12 }, penalty: 'Aboard: -2', note: 'Driver: Donut',
      range: '30 feet', notes: 'Reach', duration: '2 rounds', cooldown: 'Once per scene',
      cost: { value: 3 }, insufficient: true, advantage: 'Advantage',
    });
  });

  it('omits empty sections', () => {
    const ctx = cardContext({
      name: 'X', tag: '', target: '', dc: null, penalty: undefined, note: '',
      result: '', range: '', duration: null, cooldown: undefined, cost: '', insufficient: false, advantage: '',
    }, {});
    for (const k of ['roll', 'damage', 'target', 'dc', 'result', 'penalty', 'note', 'range', 'duration', 'cooldown', 'cost', 'insufficient', 'advantage', 'tag']) {
      expect(ctx[k], k).toBeUndefined();
    }
    expect(ctx.name).toBe('X');
    expect(ctx.headClass).toBe('');
  });

  it('keeps zero-valued sections (a 0 total / DC / target still renders)', () => {
    const ctx = cardContext({ dc: 0, target: 0 }, { roll: { total: 0, d20: 2 }, damage: { total: 0 } });
    expect(ctx.roll).toEqual({ total: 0, crit: false, fumble: false });
    expect(ctx.damage).toEqual({ total: 0, type: '' });
    expect(ctx.dc).toEqual({ value: 0 });
    expect(ctx.target).toEqual({ value: 0 });
  });

  it('omits a 0 mana cost and a falsy insufficient flag (R20 omits them at 0/false)', () => {
    for (const insufficient of [0, false, '']) {
      const ctx = cardContext({ cost: 0, insufficient }, {});
      expect(ctx.cost).toBeUndefined();
      expect(ctx.insufficient).toBeUndefined();
    }
    expect(cardContext({ insufficient: 1 }).insufficient).toBe(true);
  });

  it('treats a string "0" mana cost as zero', () => {
    expect(cardContext({ cost: '0' }).cost).toBeUndefined();
    expect(cardContext({ cost: '2' }).cost).toEqual({ value: '2' });
  });

  describe('inline-roll neutralisation', () => {
    // Mirrors Handlebars.escapeExpression (&<>"'`= only) — what {{field}} does.
    const hbsEscape = s => String(s).replace(/[&<>"'`=]/g, c => `&#${c.charCodeAt(0)};`);
    // Core ChatMessage#_preCreate inline-roll matcher (chat-message.mjs:501).
    const INLINE = /\[\[(.*?)(]{2,3})(?:{([^}]+)})?/;

    it('breaks [[ and ]] in every text field so core never evaluates them', () => {
      const evil = 'x [[1d20]] y [[[/r 1d6]]]';
      const ctx = cardContext(
        {
          name: evil, characterName: evil, tag: evil, type: evil, advantage: evil, penalty: evil, note: evil, notes: evil,
          result: evil, range: evil, duration: evil, cooldown: evil, target: evil, dc: evil, cost: evil,
        },
        { damage: { total: 1 } },
      );
      const texts = [
        ctx.name, ctx.characterName, ctx.tag, ctx.damage.type, ctx.advantage, ctx.penalty, ctx.note, ctx.notes,
        ctx.result, ctx.range, ctx.duration, ctx.cooldown, ctx.target.value, ctx.dc.value, ctx.cost.value,
      ];
      for (const t of texts) {
        expect(t).not.toContain('[[');
        expect(t).not.toContain(']]');
        expect(INLINE.test(hbsEscape(t))).toBe(false);
      }
    });

    it('survives Handlebars escaping without literal entities and still reads as brackets', () => {
      const out = hbsEscape(cardContext({ note: 'roll [[1d6]]' }).note);
      expect(out).not.toContain('&');
      expect(out.replace(/​/g, '')).toBe('roll [[1d6]]');
    });

    it('leaves numbers and plain text untouched', () => {
      const ctx = cardContext({ name: 'Sword [a]', dc: 12 });
      expect(ctx.name).toBe('Sword [a]');
      expect(ctx.dc).toEqual({ value: 12 });
    });
  });

  it('tolerates missing arguments', () => {
    const ctx = cardContext();
    expect(ctx.crit).toBe(false);
    expect(ctx.damageOnly).toBe(false);
  });
});

describe('Attack and Spell chat extras', () => {
  it('omits empty fields, defaults settings on, and keeps toggles independent', () => {
    const attack = { range: ' 30ft\r\n cone ', description: '<p>First</p><p>Second</p>' };
    expect(attackCardExtras({}, attack)).toEqual({ range: '30ft · cone', notes: 'First · Second' });
    expect(attackCardExtras({ showRangeInChat: false }, attack)).toEqual({ notes: 'First · Second' });
    expect(attackCardExtras({ showNotesInChat: false }, attack)).toEqual({ range: '30ft · cone' });
    expect(attackCardExtras({}, { range: ' ', description: '<p> </p>' })).toEqual({});
  });

  it('prefers Spell text independently and falls back only to a populated linked Attack field', () => {
    const attack = { range: '60ft', description: '<p>Attack note</p>' };
    expect(spellCardExtras({}, { range: '30ft', description: '<p> </p>', duration: '2\r\n rounds', cooldown: ' ' }, attack))
      .toEqual({ range: '30ft', notes: 'Attack note', duration: '2 · rounds' });
    expect(spellCardExtras({}, { range: ' ', description: '<p>Spell note</p>' }, attack))
      .toEqual({ range: '60ft', notes: 'Spell note' });
    expect(spellCardExtras({ showRangeInChat: false, showNotesInChat: false },
      { duration: '2 rounds', cooldown: 'Once' }, attack))
      .toEqual({ duration: '2 rounds', cooldown: 'Once' });
  });

  it('removes unsafe description HTML, keeps input text line-safe, and neutralizes inline rolls', () => {
    const extras = spellCardExtras({}, {
      range: ' <img src=x onerror=alert(1)> [[1d6]]\nnext ',
      description: '<p>Before [[1d20]]</p><script>bad()</script><p>&lt;img src=x&gt;</p>',
      duration: 'one\n[[2d6]]',
      cooldown: 'two\r\nlines',
    });
    const ctx = cardContext(extras);
    expect(ctx.notes).not.toContain('bad()');
    expect(ctx.notes).toContain('<img src=x>');
    for (const field of ['range', 'notes', 'duration', 'cooldown']) {
      expect(ctx[field]).not.toMatch(/[\r\n]/);
      expect(ctx[field]).not.toContain('[[');
      expect(ctx[field]).not.toContain(']]');
    }
    const template = readFileSync(new URL('../../templates/chat/card.hbs', import.meta.url), 'utf8');
    for (const field of ['range', 'notes', 'duration', 'cooldown']) {
      expect(template).toContain(`{{${field}}}`);
      expect(template).not.toContain(`{{{${field}}}}`);
    }
  });
});

describe('htmlToText (gear descriptions -> a plain-text card note)', () => {
  it('strips tags and keeps the text', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });
  it('block ends and <br> become line breaks; blank runs collapse', () => {
    expect(htmlToText('<h2>Title</h2><p>A<br>B</p><p></p><ul><li>x</li><li>y</li></ul>')).toBe('Title\nA\nB\nx\ny');
  });
  it('decodes entities AFTER stripping, so escaped markup stays literal text', () => {
    expect(htmlToText('&amp; &lt;b&gt; &quot;q&quot; &#39;s&#39;&nbsp;&#65;&#x42;')).toBe('& <b> "q" \'s\' AB');
  });
  it('drops script / style bodies entirely', () => {
    expect(htmlToText('<p>ok</p><script>alert(1)</script><style>p{}</style>')).toBe('ok');
  });
  it('labelled enricher links read as their label', () => {
    expect(htmlToText('<p>See @UUID[Actor.abc]{Carl} now</p>')).toBe('See Carl now');
  });
  it('non-string / empty -> empty string', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
  });
});

describe('htmlToText hardening', () => {
  it('drops HTML comments (even ones containing tags)', () => {
    expect(htmlToText('a<!-- <p>x</p> -->b')).toBe('ab');
  });
  it('decodes common typographic entities; nbsp collapses to a space', () => {
    expect(htmlToText('a&hellip;b&mdash;c&ndash;d &lsquo;e&rsquo; &ldquo;f&rdquo;&nbsp;g')).toBe('a…b—c–d ‘e’ “f” g');
  });
  it('unknown named entities stay literal', () => {
    expect(htmlToText('&bogus;')).toBe('&bogus;');
  });
  it('caps the input at 20000 characters', () => {
    expect(htmlToText('x'.repeat(30000))).toHaveLength(20000);
  });
  it('pathological input stays linear (< 200ms each)', () => {
    for (const s of ['<'.repeat(100000), '@a['.repeat(30000), '<script>'.repeat(5000), '<!--'.repeat(10000)]) {
      const t = performance.now();
      htmlToText(s);
      expect(performance.now() - t).toBeLessThan(200);
    }
  });
});

describe('htmlToText script/style removal', () => {
  it('removes several script/style elements, keeps the text between', () => {
    expect(htmlToText('a<SCRIPT src=x>1</script>b<style>p{}</STYLE >c')).toBe('abc');
  });
  it('an unclosed script drops the rest', () => {
    expect(htmlToText('keep<script>alert(1)')).toBe('keep');
  });
  it('lowercases ASCII only, so non-ASCII text before a script keeps indices aligned', () => {
    const text = htmlToText(`${'İ'.repeat(10)}Before<script>bad()</script>After`);
    expect(text).toContain('Before');
    expect(text).toContain('After');
    expect(text).not.toContain('bad');
  });
});

describe('joinNotes (card note parts)', () => {
  it('joins with a middle dot and drops empty / false parts', () => {
    expect(joinNotes(['a', '', false, null, 'b'])).toBe('a · b');
    expect(joinNotes([])).toBe('');
  });
});
