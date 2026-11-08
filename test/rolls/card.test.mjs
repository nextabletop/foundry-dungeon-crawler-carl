import { describe, it, expect } from 'vitest';
import { cardContext, naturalD20, htmlToText, joinNotes } from '../../module/rules/card.mjs';

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
  it('flags a crit on a natural 20 and tints the header', () => {
    const ctx = cardContext({ name: 'Punch', tag: 'To Hit' }, { roll: { total: 25, d20: 20 } });
    expect(ctx.crit).toBe(true);
    expect(ctx.fumble).toBe(false);
    expect(ctx.damageOnly).toBe(false);
    expect(ctx.headClass).toBe('crit');
    expect(ctx.roll).toEqual({ total: 25, crit: true, fumble: false });
  });

  it('flags a fumble on a natural 1', () => {
    const ctx = cardContext({ name: 'Punch' }, { roll: { total: 3, d20: 1 } });
    expect(ctx.fumble).toBe(true);
    expect(ctx.crit).toBe(false);
    expect(ctx.headClass).toBe('fail');
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
    expect(ctx.headClass).toBe('crit');
    expect(ctx.damage).toEqual({ total: 5, type: '' });
  });

  it('passes through all text fields', () => {
    const fields = {
      name: 'Fireball', characterName: 'Carl', img: 'carl.webp', tag: 'Spell',
      target: 14, dc: 12, penalty: 'Aboard: -2', note: 'Driver: Donut',
      cost: 3, insufficient: true, advantage: 'Advantage',
    };
    const ctx = cardContext(fields, { roll: { total: 11, d20: 9 } });
    expect(ctx).toMatchObject({
      name: 'Fireball', characterName: 'Carl', img: 'carl.webp', tag: 'Spell',
      target: { value: 14 }, dc: { value: 12 }, penalty: 'Aboard: -2', note: 'Driver: Donut',
      cost: { value: 3 }, insufficient: true, advantage: 'Advantage',
    });
  });

  it('omits empty sections', () => {
    const ctx = cardContext({ name: 'X', tag: '', target: '', dc: null, penalty: undefined, note: '', cost: '', insufficient: false, advantage: '' }, {});
    for (const k of ['roll', 'damage', 'target', 'dc', 'penalty', 'note', 'cost', 'insufficient', 'advantage', 'tag']) {
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
        { name: evil, characterName: evil, tag: evil, type: evil, advantage: evil, penalty: evil, note: evil, target: evil, dc: evil, cost: evil },
        { damage: { total: 1 } },
      );
      const texts = [ctx.name, ctx.characterName, ctx.tag, ctx.damage.type, ctx.advantage, ctx.penalty, ctx.note, ctx.target.value, ctx.dc.value, ctx.cost.value];
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
