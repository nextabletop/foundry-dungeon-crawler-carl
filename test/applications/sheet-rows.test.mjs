import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { abilityRows, inlineFieldValue, inlineEditTarget, sheetItemLists, buffRows, inventoryView, hotlistCells, advancementView, isBlankHTML, vehicleWeaponRows, richTextFieldNames, crewRows, gmRosterRows, undoFloorView, isViewOnlyControl, enableViewOnlyControls, singleFlight, VIEW_ONLY_ACTIONS } from '../../module/applications/sheet-rows.mjs';
import { STATS } from '../../module/config.mjs';
import { deriveCreature } from '../../module/rules/derive.mjs';

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

describe('chat settings UI', () => {
  it('exposes independent chat settings for creatures and vehicles, not the GM Screen', () => {
    const template = readFileSync(new URL('../../templates/actor/sheet-config.hbs', import.meta.url), 'utf8');
    expect(template).toContain('{{#unless (eq dccType "gmscreen")}}');
    expect(template).toContain('name="system.showRangeInChat"');
    expect(template).toContain('name="system.showNotesInChat"');
    expect(template).toContain('{{checked systemSource.showRangeInChat}}');
    expect(template).toContain('{{checked systemSource.showNotesInChat}}');
  });

  it('offers an opt-in Mob whisper control', () => {
    const template = readFileSync(new URL('../../templates/actor/sheet-config.hbs', import.meta.url), 'utf8');
    expect(template).toContain('{{else if (eq dccType "mob")}}');
    expect(template).toContain('name="system.mobWhisper"');
    expect(template).toContain('{{checked systemSource.mobWhisper}}');
    expect(template).not.toContain('system.mobPublic');
  });

  it('outlines unchecked settings checkboxes and preserves a distinct keyboard focus', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.dcc\.dcc-app\.dcc-sheet-config input\[type="checkbox"\]:not\(:checked\)::before\s*\{\s*outline: 1px solid var\(--d-ink-dim\);/);
    expect(css).toMatch(/\.dcc\.dcc-app\.dcc-sheet-config input\[type="checkbox"\]:focus-visible::before\s*\{\s*outline: 2px solid var\(--d-accent\);/);
  });
});

describe('Health Bar UI', () => {
  it('exposes a nullable override to PCs and Mobs only', () => {
    const template = readFileSync(new URL('../../templates/actor/sheet-config.hbs', import.meta.url), 'utf8');
    expect(template).toContain('{{#if (or (eq dccType "pc") (eq dccType "mob"))}}');
    expect(template).toContain('name="system.healthBarSlotsCustom"');
    expect(template).toContain('value="{{systemSource.healthBarSlotsCustom}}" min="1" max="100" step="1"');
  });

  describe('movement controls', () => {
    it('edits source bases on both creature sheets', () => {
      const template = readFileSync(new URL('../../templates/actor/partials/defenses.hbs', import.meta.url), 'utf8');
      const mob = readFileSync(new URL('../../templates/actor/mob/body.hbs', import.meta.url), 'utf8');
      const pc = readFileSync(new URL('../../templates/actor/pc/combat.hbs', import.meta.url), 'utf8');
      expect(template).toContain('name="system.moveBase" value="{{systemSource.moveBase}}"');
      expect(template).toContain('name="system.stepBase" value="{{systemSource.stepBase}}"');
      expect(template).toContain('>{{system.move}}</span>');
      expect(template).toContain('>{{system.step}}</span>');
      expect(template).not.toContain('name="dcc.move"');
      expect(template).not.toContain('name="dcc.step"');
      expect(pc).toContain('actor/partials/defenses.hbs');
      expect(mob).toContain('name="system.moveBase" value="{{systemSource.moveBase}}"');
      expect(mob).toContain('name="system.stepBase" value="{{systemSource.stepBase}}"');
      expect(mob).toContain('{{system.mobMove}}');
    });

    describe('Crawler combat strip', () => {
      const combat = readFileSync(new URL('../../templates/actor/pc/combat.hbs', import.meta.url), 'utf8');
      const defenses = readFileSync(new URL('../../templates/actor/partials/defenses.hbs', import.meta.url), 'utf8');
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');

      it('uses separate themed boxes for Combat and Attacks with standard list spacing', () => {
        const attacks = readFileSync(new URL('../../templates/actor/partials/attack-list.hbs', import.meta.url), 'utf8');
        expect(combat).toMatch(/class="dcc-box dcc-pc-combat"[\s\S]*actor\/partials\/defenses\.hbs[\s\S]*actor\/partials\/unresolved\.hbs"[^}]*}}\s*<\/div>\s*{{> "systems\/dungeon-crawler-carl\/templates\/actor\/partials\/attack-list\.hbs"/);
        expect(attacks).toContain('class="dcc-box dcc-list dcc-list--attacks"');
        expect(css).toMatch(/\.dcc-box \{\s*overflow: hidden;\s*padding: 8px;\s*border: 1px solid var\(--d-line\);[^}]*background: var\(--d-field\);/);
        expect(css).toContain('.dcc-list { margin-top: 8px; }');
        expect(css).not.toContain('.dcc-pc-combat-panel');
      });

      it('orders the paper-sheet fields in two rows and retains the Evade roll', () => {
        const grid = defenses.slice(defenses.indexOf('dcc-pc-defense-grid'));
        const fields = [
          'DCC.Defense.Evade"', 'system.stats.dexterity.modifier', 'system.evadeBuffLabel',
          'data-action="rollEvade"', 'system.move}}', 'system.step}}',
          'DCC.Defense.DamageResistance"', 'systemSource.armor}}', 'system.damageResistanceBonus',
          'system.damageResistance}}', 'systemSource.aiFavor}}', 'systemSource.size}}', 'DCC.Mana.Label',
        ];
        const positions = fields.map(field => grid.indexOf(field));
        expect(positions.every(position => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(grid).toContain('{{system.evadeRollLabel}}');
        expect(grid.match(/class="bx dcc-pc-defense-buff"/g)).toHaveLength(2);
        expect(defenses).not.toContain('dcc-buffline');
        expect(css).toMatch(/\.dcc-pc-defense-grid \.dcc-pc-defense-buff\s*\{[^}]*border: none;[^}]*background: transparent;/s);
        expect(css).toMatch(/\.dcc-pc-defense-grid \.dcc-fbox \.bx\s*\{[^}]*overflow-wrap: anywhere;/s);
        expect(css).toMatch(/\.dcc-pc-defense-grid \{[^}]*grid-template-columns: minmax\(62px, calc\(50% - 163px\)\) 38px 10px 40px 10px 54px repeat\(2, minmax\(45px, 1fr\)\) 130px;[^}]*gap: 10px 2px;[^}]*min-width: 450px;/s);
        expect(defenses.match(/class="dcc-fbox dcc-pc-pair-start"/g)).toHaveLength(2);
        expect(defenses.match(/class="dcc-fbox dcc-pc-pair-end"/g)).toHaveLength(2);
        expect(css).toContain('.dcc-pc-defense-grid :is(.dcc-pc-pair-start, .dcc-pc-pair-end) { width: 45px; max-width: 100%; }');
        expect(css).toContain('.dcc-pc-defense-grid .dcc-pc-pair-start { justify-self: end; }');
        expect(css).toContain('.dcc-pc-defense-grid .dcc-pc-pair-end { justify-self: start; }');
        expect(defenses).toContain('<span class="dcc-pc-evade-die">d20 +</span>');
        expect(defenses).toContain('class="dcc-pc-defense-name dcc-pc-evade-name"');
        expect(css).toMatch(/\.dcc-pc-evade-name \{[^}]*display: flex; align-items: center;[^}]*white-space: nowrap;/);
      });

      it('offers owners a persisted edit toggle for all five source fields', () => {
        expect(combat).toMatch(/{{#if editable}}[\s\S]*name="system\.pcCombatEdit" {{checked systemSource\.pcCombatEdit}}[\s\S]*{{\/if}}/);
        for (const field of ['armor', 'moveBase', 'stepBase', 'aiFavor', 'size']) {
          expect(defenses).toContain(`name="system.${field}" value="{{systemSource.${field}}}"`);
        }
        for (const field of ['armor', 'aiFavor', 'size']) {
          expect(defenses).toContain(`class="bx dcc-pc-view-only">{{systemSource.${field}}}`);
        }
        expect(css).toContain('.dcc-pc-combat .dcc-pc-edit-only { display: none; }');
        expect(css).toContain(':has(.dcc-pc-combat-edit input:checked) .dcc-pc-edit-only { display: flex; }');
        expect(css).toContain(':has(.dcc-pc-combat-edit input:checked) .dcc-pc-view-only { display: none; }');
        expect(css).toContain('.dcc-pc-defense-viewport { overflow-x: auto; }');
      });

      it('underlines Combat inputs and gives boxed displays consistent themed borders and text', () => {
        expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-pc-defense-grid \.dcc-fbox :is\(span, button\)\.bx:not\(\.dcc-pc-defense-buff\) \{\s*border: 1px solid var\(--d-line\);\s*color: var\(--d-ink\);/);
        expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-pc-defense-grid \.dcc-fbox input\.bx \{\s*border: none;\s*border-bottom: 1px solid var\(--d-line\);\s*border-radius: 0;\s*background: transparent;/);
        expect(css).toContain('.dcc-pc-defense-grid .dcc-fbox input.bx:focus-visible { outline: 2px solid var(--d-accent);');
      });

      it('styles the Evade roll as a red button with a contrasting label and hover state', () => {
        expect(defenses).toMatch(/<button[^>]*data-action="rollEvade"[^>]*>{{system\.evadeRollLabel}}<\/button>/);
        expect(css).toMatch(/button\.bx\[data-action="rollEvade"\] \{\s*border-color: #000;\s*background: var\(--d-hot\);\s*color: #fff;/);
        expect(css).toMatch(/button\.bx\[data-action="rollEvade"\]:not\(:disabled\):hover \{[^}]*background: var\(--dcc-hot-hover\);[^}]*color: #fff;/);
        expect(css).toMatch(/button\.bx\[data-action="rollEvade"\]:focus-visible \{[^}]*outline: 2px solid var\(--d-accent\);/);
      });

      it('places Mana in the third Combat column, with its label above the values', () => {
        const vitals = readFileSync(new URL('../../templates/actor/pc/vitals.hbs', import.meta.url), 'utf8');
        const pcSheet = readFileSync(new URL('../../module/applications/pc-sheet.mjs', import.meta.url), 'utf8');
        expect(vitals).not.toContain('system.mana');
        expect(combat).toMatch(/class="dcc-box dcc-pc-combat"[\s\S]*class="dcc-bar"[\s\S]*actor\/partials\/defenses\.hbs/);
        expect(pcSheet).not.toContain("mana: { template: path('actor/pc/mana.hbs') }");
        expect(defenses).toMatch(/class="dcc-pc-mana"[\s\S]*DCC\.Mana\.Label[\s\S]*{{system\.mana\.max}}[\s\S]*name="system\.mana\.value" value="{{systemSource\.mana\.value}}"[\s\S]*DCC\.Mana\.Max[\s\S]*DCC\.Mana\.Current/);
        expect(defenses.match(/name="system\.mana\.value"/g)).toHaveLength(1);
        expect(css).toContain('.dcc-pc-mana .dcc-mana .cur { width: 100%; }');
        expect(css).toMatch(/\.dcc-pc-mana \{[^}]*grid-column: 9; grid-row: 1 \/ span 2; grid-template-rows: auto auto; align-self: center; gap: 2px;/);
        expect(css).toMatch(/\.dcc-pc-mana-title \{[^}]*text-align: center;/);
        expect(css).toContain('.dcc-pc-mana .dcc-mana .sep { font-size: 24px; line-height: 1; }');
        expect(css).toMatch(/\.dcc-pc-mana \.dcc-mana \.max \{[^}]*border: 1px solid var\(--d-line\);[^}]*background: var\(--d-field\);[^}]*color: var\(--d-ink\);/);
      });
    });
  });

  describe('Mob combat strip', () => {
    const template = readFileSync(new URL('../../templates/actor/mob/body.hbs', import.meta.url), 'utf8');
    const header = template.slice(template.indexOf('<header'), template.indexOf('</header>'));
    const abilities = template.slice(template.indexOf('{{localize "DCC.Abilities"}}'), template.indexOf('actor/partials/attack-list.hbs'));
    const combat = template.slice(template.indexOf('<div class="dcc-mobstrip">'), template.indexOf('actor/partials/unresolved.hbs'));

    it('places editable Level and Surprise in combat, not the header', () => {
      for (const field of ['level', 'surprise']) {
        expect(header).not.toContain(`name="system.${field}"`);
        expect(combat).toContain(`name="system.${field}" value="{{systemSource.${field}}}"`);
        expect(template.split(`name="system.${field}"`)).toHaveLength(2);
      }
      expect(combat).not.toContain('system.mobToHit');
    });

    it('uses descriptors instead of a separate Mob Size control', () => {
      const defenses = readFileSync(new URL('../../templates/actor/partials/defenses.hbs', import.meta.url), 'utf8');
      expect(header).toContain('name="system.descriptors" value="{{systemSource.descriptors}}"');
      expect(template).not.toContain('system.size');
      expect(combat).not.toContain('DCC.Defense.Size');
      expect(defenses).toContain('name="system.size" value="{{systemSource.size}}"');
    });

    describe('Mob notes', () => {
      it('uses a Notes heading and retains an accessible editor label without a duplicate visible label', () => {
        const mobNotes = readFileSync(new URL('../../templates/actor/mob/notes.hbs', import.meta.url), 'utf8');
        const richFields = readFileSync(new URL('../../templates/actor/partials/rich-fields.hbs', import.meta.url), 'utf8');
        const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
        expect(mobNotes).toContain('{{localize "DCC.Bio.Notes"}}');
        expect(mobNotes).not.toContain('DCC.Tab.bio');
        expect(richFields).toContain('class="dcc-bio-lab" id="{{@root.rootId}}-bio-{{key}}"');
        expect(css).toContain('.dcc.sheet.actor .dcc-mob-notes .dcc-bio-lab {');
      });

      it('removes nested borders and backgrounds for both editable and read-only notes', () => {
        const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
        expect(css).toContain('.dcc.sheet.actor .dcc-mob-notes .dcc-bio-f { padding: 0; border: none; background: transparent; }');
        expect(css).toContain('.dcc.sheet.actor .dcc-mob-notes .dcc-bio :is(prose-mirror, .dcc-bio-view) { border: none; background: transparent; }');
        expect(css).toContain('.dcc.sheet.actor .dcc-mob-notes .dcc-bio prose-mirror:focus-within { outline: 2px solid var(--d-accent);');
      });

      it('matches Mob attack note typography in read-only and editable Notes content', () => {
        const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
        expect(css).toContain('--dcc-mob-note-size: 12px;');
        expect(css).toMatch(/\.dcc\.sheet\.actor\.mob :is\(\.dcc-attack-notes, \.dcc-skill-summary, \.dcc-ichanges, \.dcc-iempty\) \{ font-size: var\(--dcc-mob-note-size\); line-height: 1\.35; \}/);
        expect(css).toMatch(/\.dcc\.sheet\.actor\.mob \.dcc-mob-notes :is\(\.dcc-bio-view, prose-mirror \.editor-content\) \{[^}]*font-family: var\(--d-cond\);[^}]*font-size: var\(--dcc-mob-note-size\);[^}]*line-height: 1\.35;/);
        expect(css).toMatch(/\.dcc\.sheet\.actor\.mob \.dcc-mob-notes :is\(\.dcc-bio-view, prose-mirror \.editor-content\) \* \{\s*font-size: var\(--dcc-mob-note-size\) !important;\s*\}/);
      });
    });

    describe('Mob sheet layout', () => {
      it('uses a narrower default and keeps all sections in one column', () => {
        const sheet = readFileSync(new URL('../../module/applications/mob-sheet.mjs', import.meta.url), 'utf8');
        const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
        expect(sheet).toContain("classes: ['mob'], position: { width: 600, height: 820 }");
        expect(css).toMatch(/\.dcc\.sheet\.actor\.mob \.window-content \{\s*grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-areas: "head" "left" "right" "notes" "\.";/);
        expect(css).toMatch(/\.dcc\.sheet\.actor\.vehicle \.window-content \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
      });
    });

    describe('optional Mob sections', () => {
      it('renders controls only within the Mob settings branch', () => {
        const settings = readFileSync(new URL('../../templates/actor/sheet-config.hbs', import.meta.url), 'utf8');
        const mobSettings = settings.split('{{else if (eq dccType "mob")}}')[1].split('{{/if}}')[0];
        for (const field of ['mobShowInventory', 'mobShowSkills', 'mobShowBuffs']) {
          expect(mobSettings).toContain(`name="system.${field}"`);
          expect(mobSettings).toContain(`{{checked systemSource.${field}}}`);
        }
      });

      it('gates Mob inventory, Skills and Spells, and buffs without hiding Attacks', () => {
        const template = readFileSync(new URL('../../templates/actor/mob/body.hbs', import.meta.url), 'utf8');
        expect(template).toMatch(/{{#if system\.mobShowInventory}}[\s\S]*DCC\.Tab\.inventory[\s\S]*{{\/if}}/);
        expect(template).toMatch(/{{#if system\.mobShowSkills}}[\s\S]*rows=skills[\s\S]*rows=spells[\s\S]*{{\/if}}/);
        expect(template).toMatch(/{{#if system\.mobShowBuffs}}[\s\S]*actor\/partials\/buff-list\.hbs[\s\S]*{{\/if}}/);
        expect(template.indexOf('actor/partials/attack-list.hbs')).toBeLessThan(template.indexOf('{{#if system.mobShowBuffs}}'));
      });
    });

    it('keeps ability modifiers in Abilities and removes their duplicate combat row', () => {
      expect(abilities).toContain('s.modifier');
      expect(combat).not.toContain('s.modifier');
      expect(combat).not.toContain('dcc-mobstat');
    });

    it('places Abilities immediately after Combat and before Attacks', () => {
      expect(template).toMatch(/actor\/partials\/unresolved\.hbs"[^}]*}}\s*<\/div>\s*<div class="dcc-box">\s*<div class="dcc-bar">{{localize "DCC\.Abilities"}}[\s\S]*?{{> "systems\/dungeon-crawler-carl\/templates\/actor\/partials\/attack-list\.hbs"/);
    });

    it('uses a Mob-only readable type hierarchy with uppercase headings and consistent title-case labels', () => {
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
      expect(css).toMatch(/\.dcc\.sheet\.actor\.mob \{[^}]*--d-cond: system-ui, -apple-system, "Segoe UI", sans-serif;/);
      expect(css).toMatch(/\.dcc:is\(\.sheet\.actor, \.sheet\.item, \.sheet\.effect, \.dcc-app\) \.dcc-bar \{[^}]*font-size: 12px;[^}]*text-transform: uppercase;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor\.mob :is\(\.dcc-flabel, \.dcc-ihead\) \{[^}]*font-size: 11px;[^}]*font-weight: 700;[^}]*text-transform: none;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor\.mob \.dcc-addbtn \{[^}]*font-size: 11px;[^}]*text-transform: capitalize;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor\.mob :is\(\.dcc-attack-notes, \.dcc-skill-summary, \.dcc-ichanges, \.dcc-iempty\) \{ font-size: var\(--dcc-mob-note-size\);/);
      expect(css).toMatch(/\.dcc-hb-cell \{[^}]*container-type: inline-size;/);
      expect(css).toMatch(/\.dcc-hb-percent \{[^}]*font-size: clamp\(8px, 30cqi, 12px\);/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob \.dcc-statmod \{[^}]*font-variant: small-caps;/);
    });

    it('uses shared actor hover fills for damage, ability, roll and add buttons while retaining keyboard focus', () => {
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
      expect(css).toContain('--dcc-hot-hover: color-mix(in srgb, var(--d-hot) 75%, black);');
      expect(css).toContain('--dcc-bar-hover: color-mix(in srgb, var(--d-bar) 75%, white);');
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-statmod:not\(:disabled\):hover,\s*\.dcc\.sheet\.actor \.dcc-rollbtn--hot:not\(:disabled\):hover,\s*\.dcc\.sheet\.actor \.dcc-rollbtn\[data-action="rollAttack"\]\[data-roll="damage"\]:not\(:disabled\):hover \{[^}]*background: var\(--dcc-hot-hover\);[^}]*color: #fff;[^}]*filter: none;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-rollbtn:not\(:disabled\):hover \{[^}]*background: var\(--dcc-bar-hover\);[^}]*color: var\(--d-bar-text\);/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-addbtn:not\(:disabled\):hover \{[^}]*background: var\(--d-accent\);[^}]*color: #fff;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor :is\(\.dcc-statmod, \.dcc-rollbtn, \.dcc-addbtn\):focus-visible \{[^}]*outline: 2px solid var\(--d-accent\);/);
    });

    it('shows enhanced abilities and exposes the base and net buffs in edit mode', () => {
      expect(abilities).toContain('name="system.mobAbilitiesEdit" {{checked systemSource.mobAbilitiesEdit}}');
      expect(abilities).toMatch(/<button[^>]*class="dcc-statmod"[^>]*data-action="rollAbility"[^>]*data-stat="{{s\.key}}"[\s\S]*?>{{localize \(concat "DCC\.Mob\.StatAbbr\." s\.key\)}}<\/button>\s*<div class="dcc-mob-ability-value">\s*<span class="dcc-statenh">{{s\.enhancement}}<\/span>\s*<span class="dcc-mob-ability-mod">\({{numberFormat s\.modifier sign=true}}\)<\/span>/);
      expect(abilities).toContain("aria-label=\"{{localize 'DCC.Roll.AbilityLabel' stat=(localize s.label)}}\"");
      expect(abilities).toMatch(/<div class="dcc-mob-edit-fields">[\s\S]*name="system\.stats\.{{s\.key}}\.base"[\s\S]*<span class="dcc-mob-derived">{{s\.buff}}<\/span>/);
      expect(abilities).toContain('name="system.stats.{{s.key}}.base" value="{{s.base}}"');
      expect(abilities).toContain('aria-label="{{localize \'DCC.Mob.AbilityBase\' stat=(localize s.label)}}"');
    });

    it('distributes five Abilities evenly with balanced padding, regardless of Mana', () => {
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
      expect(abilities).toContain('class="dcc-mob-abilities"');
      expect(abilities).not.toContain('dcc-mob-abilities--with-mana');
      expect(abilities).toContain('class="dcc-stats" role="region" aria-label="{{localize \'DCC.Abilities\'}}" tabindex="0"');
      expect(css).toContain('.dcc.sheet.actor .dcc-mob-abilities { position: relative; padding: 6px 8px; }');
      expect(css).toContain('.dcc.sheet.actor .dcc-mob .dcc-stats { grid-template-columns: repeat(5, minmax(80px, 1fr)); gap: 8px; overflow-x: auto; padding: 0 16px 4px; }');
      expect(css).not.toContain('.dcc-mob-abilities--with-mana');
    });

    it('styles ability-label roll buttons and the combined score display', () => {
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
      const translations = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
      expect(Object.values(translations.DCC.Mob.StatAbbr)).toEqual(['Str', 'Int', 'Con', 'Dex', 'Cha']);
      expect(translations.DCC.StatAbbr.strength).toBe('STR');
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-statmod \{[^}]*background: var\(--d-hot\);[^}]*color: var\(--d-bar-text\);/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob \.dcc-statmod \{[^}]*font-variant: small-caps;[^}]*text-transform: none;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-ability-value \{[^}]*color: var\(--d-ink\);[^}]*white-space: nowrap;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob \.dcc-statenh \{[^}]*font-size: 26px;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob \.dcc-stat \{[^}]*container-type: inline-size;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-ability-mod \{[^}]*font-size: clamp\(18px, 26cqi, 26px\);/);
      expect(css).toMatch(/@container \(max-width: 90px\) \{\s*\.dcc\.sheet\.actor\.mob \.dcc-mob-ability-mod \{ font-size: clamp\(18px, 24cqi, 26px\); \}/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob \.dcc-stat \{[^}]*gap: 8px;/);
    });

    it('removes inner Mob combat and ability borders and the combat background', () => {
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mobstrip \{[^}]*border: none;[^}]*background: transparent;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob \.dcc-stat \{[^}]*border: none;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-stat \{[^}]*border: 1px solid var\(--d-line\);/);
    });

    it('shows totals with an edit toggle and mana only for owned spells', () => {
      const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
      const itemRow = readFileSync(new URL('../../templates/actor/partials/item-row.hbs', import.meta.url), 'utf8');
      expect(combat).toContain('name="system.mobCombatEdit"');
      expect(combat).toContain('class="fa-solid fa-pen-to-square" aria-hidden="true"');
      expect(itemRow).toContain('class="icon fa-solid fa-pen-to-square"');
      expect(css).toMatch(/\.dcc-irow button\.icon:hover,\s*\.dcc\.sheet\.actor \.dcc-mob-edit \{[^}]*width: 20px;[^}]*height: 20px;[^}]*color: var\(--d-ink-dim\);/);
      expect(css).toContain('.dcc-mob-edit input:focus-visible + i');
      expect(css).toContain('.dcc-mob-edit input:checked + i');
      for (const value of ['mobSurprise', 'mobEvade', 'mobMove', 'damageResistance']) {
        expect(combat).toContain(`{{system.${value}}}`);
      }
      expect(combat).toContain('name="system.mobEvadeBase"');
      expect(combat).toMatch(/{{#if spells\.length}}[\s\S]*name="system\.mana\.value"[\s\S]*name="system\.mana\.max"[\s\S]*{{\/if}}/);
      expect(combat).toContain('class="dcc-mob-combat-grid" role="region" aria-label="{{localize \'DCC.Tab.combat\'}}" tabindex="0"');
      expect(css).not.toContain('.dcc.sheet.actor .dcc-mob-combat > .dcc-bar { text-transform: none; }');
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-combat-stat \{[^}]*gap: 8px;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-combat-stat > \.dcc-flabel \{[^}]*color: var\(--d-ink\);[^}]*font-weight: 700;[^}]*text-transform: none;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-total \{[^}]*color: var\(--d-ink\);/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-total \{[^}]*font-size: 26px;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-combat-grid \{[^}]*grid-auto-flow: column;[^}]*grid-auto-columns: minmax\(80px, 1fr\);[^}]*overflow-x: auto;/);
      expect(css).toMatch(/\.dcc\.sheet\.actor \.dcc-mob-combat-grid \{[^}]*gap: 2px;[^}]*padding-bottom: 4px;/);
      expect(css).toContain(':is(.dcc-mobstrip, .dcc-mob-abilities):has(.dcc-mob-edit input:checked) .dcc-mob-edit-fields');
      expect(css).toMatch(/:is\(\.dcc-mobstrip, \.dcc-mob-abilities\):is\(:hover, :focus-within\) \.dcc-mob-edit,\s*\.dcc\.sheet\.actor \.dcc-mob-edit:has\(input:checked\) \{ opacity: 1; \}/);
      expect(css).toContain('@media (hover: none)');
    });

    it('edits Mob To-Hit on each Attack instead of showing a global target', () => {
      const attack = readFileSync(new URL('../../templates/item/attack.hbs', import.meta.url), 'utf8');
      const list = readFileSync(new URL('../../templates/actor/partials/attack-list.hbs', import.meta.url), 'utf8');
      expect(attack).toMatch(/{{#if showMobToHit}}[\s\S]*systemFields\.mobToHitBase[\s\S]*systemFields\.mobToHitNone[\s\S]*{{\/if}}/);
      expect(list).toContain('{{#if mobToHitNone}}');
      expect(list).toContain('{{mobToHit}}');
      expect(combat).not.toContain('DCC.Mob.ToHit');
    });

    it('uses the shared centered list heading for Mob Attacks', () => {
      const list = readFileSync(new URL('../../templates/actor/partials/attack-list.hbs', import.meta.url), 'utf8');
      expect(list).toContain('class="dcc-box dcc-list dcc-list--attacks"');
      expect(list).toContain('class="dcc-bar dcc-bar--list"');
    });
  });

  it('renders variable slots with tier colors and no more than 12 columns', () => {
    const template = readFileSync(new URL('../../templates/actor/partials/health-bar.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    const sheet = readFileSync(new URL('../../module/applications/actor-sheet-base.mjs', import.meta.url), 'utf8');
    expect(template).toContain('--dcc-hb-columns: {{health.columns}}');
    expect(template).toContain('tier-{{slot.tier}}');
    expect(template).toContain('{{slot.percent}}%');
    expect(sheet).toContain('Math.min(12, system.healthBarSlots)');
    expect(css).toContain('grid-template-columns: repeat(var(--dcc-hb-columns), minmax(0, 1fr))');
    for (let tier = 1; tier <= 10; tier++) expect(css).toContain(`.dcc-hb-slot.filled.tier-${tier} {`);
  });

  it('allows an explicit zero Vehicle Constitution Modifier in the sheet', () => {
    const vehicle = readFileSync(new URL('../../templates/actor/vehicle/body.hbs', import.meta.url), 'utf8');
    expect(vehicle).toMatch(/<input[^>]*type="number"[^>]*min="0"[^>]*name="system\.constitutionModifier"[^>]*value="{{systemSource\.constitutionModifier}}"[^>]*placeholder="5"/);
  });

  it('shows actor slot percentages below the blocks without removing the heal control', () => {
    const mob = readFileSync(new URL('../../templates/actor/mob/body.hbs', import.meta.url), 'utf8');
    const pc = readFileSync(new URL('../../templates/actor/pc/vitals.hbs', import.meta.url), 'utf8');
    const vehicle = readFileSync(new URL('../../templates/actor/vehicle/body.hbs', import.meta.url), 'utf8');
    const template = readFileSync(new URL('../../templates/actor/partials/health-bar.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    for (const sheet of [mob, pc, vehicle]) {
      expect(sheet).toContain('actor/partials/health-bar.hbs"}}');
      expect(sheet).toMatch(/<div class="dcc-box dcc-health">[\s\S]*?<div class="dcc-bar">[\s\S]*?<button[^>]*class="dcc-addbtn"[^>]*data-action="healSlot"[\s\S]*?<\/div>/);
    }
    expect(template).toMatch(/<\/button>\s*<span class="dcc-hb-percent">{{slot\.percent}}%<\/span>/);
    expect(template).not.toContain('system.healthPoints');
    expect(template).not.toContain('data-action="healSlot"');
    expect(template).toContain('data-action="setSlots" data-slot="{{slot.i}}"');
    expect(css).toMatch(/\.dcc-hb-slot \.cm \{[^}]*font-size: 18px;/);
    expect(css).toMatch(/\.dcc-hb-slot \{[^}]*border: 1px dashed #000;/);
    expect(css).toMatch(/\.dcc-hb-slot\.filled \{ border-style: solid;/);
    expect(css).toMatch(/\.dcc-hb-slot\.filled \.cm \{ color: #fff; \}/);
    expect(css).toMatch(/\.dcc-hb-percent \{[^}]*color: var\(--d-ink\);/);
    expect(css).toMatch(/\.dcc-hb \{[^}]*gap: 8px 2px;/);
    for (const [tier, hue] of [
      [1, '0, 65%, 34%'], [2, '14, 67%, 36%'], [3, '28, 69%, 37%'],
      [4, '42, 70%, 36%'], [5, '56, 68%, 33%'], [6, '70, 60%, 31%'],
      [7, '84, 56%, 29%'], [8, '98, 54%, 27%'], [9, '110, 56%, 25%'], [10, '122, 58%, 23%'],
    ]) expect(css).toContain(`.dcc-hb-slot.filled.tier-${tier} { background: hsl(${hue}); }`);
    expect(css).toContain('.dcc-health > .dcc-bar > .dcc-dying { grid-column: 1; grid-row: 1; justify-self: start; }');
    expect(css).toContain('.dcc-health > .dcc-bar > .dcc-addbtn { grid-column: 3; grid-row: 1; justify-self: end; }');
  });

  it('distinguishes dead Mobs from dying Crawlers', () => {
    const mob = readFileSync(new URL('../../templates/actor/mob/body.hbs', import.meta.url), 'utf8');
    const pc = readFileSync(new URL('../../templates/actor/pc/vitals.hbs', import.meta.url), 'utf8');
    expect(mob).toContain('{{#if health.dying}}<span class="dcc-dying">{{localize "DCC.Health.Dead"}}');
    expect(pc).toContain('{{#if health.dying}}<span class="dcc-dying">{{localize "DCC.Health.Dying"}}');
  });
});

describe('actor section headings', () => {
  it('centers list titles for Crawlers, Mobs, and Vehicles while keeping controls on the right', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.dcc\.sheet\.actor:is\(\.pc, \.mob, \.vehicle\) \.dcc-bar--list \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\) minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.dcc-bar--list > span:first-child \{[^}]*grid-column: 2;[^}]*text-align: center;/);
    expect(css).toMatch(/\.dcc-bar--list > :is\(\.dcc-addbtn, \.dcc-addbtns\) \{[^}]*grid-column: 3;[^}]*justify-self: end;/);
    expect(css).toContain('.dcc-bar--list .dcc-addbtns { flex-wrap: wrap; justify-content: flex-end; }');
    for (const path of ['partials/attack-list.hbs', 'partials/buff-list.hbs', 'partials/skill-list.hbs', 'partials/vehicle-weapon-list.hbs', 'mob/body.hbs', 'pc/inventory.hbs']) {
      const template = readFileSync(new URL(`../../templates/actor/${path}`, import.meta.url), 'utf8');
      expect(template).toMatch(/class="dcc-bar dcc-bar--list">\s*<span>/);
    }
  });
});

describe('Crawler identity header', () => {
  it('removes the identity header border for Crawlers, Mobs and Vehicles only', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toContain('.dcc.sheet.actor:is(.pc, .mob, .vehicle) .dcc-header.dcc-box { border: none; }');
    for (const path of ['pc/header.hbs', 'mob/body.hbs', 'vehicle/body.hbs']) {
      const sheet = readFileSync(new URL(`../../templates/actor/${path}`, import.meta.url), 'utf8');
      expect(sheet).toContain('<header class="dcc-header dcc-box">');
    }
  });

  it('removes the Foundry top border above the Crawler tabs', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc nav\.sheet-tabs \{[^}]*border-top: none;/);
    expect(css).toMatch(/nav\.sheet-tabs \{[^}]*border-bottom: 2px solid var\(--d-line\);/);
  });

  it('orders identity fields like the paper sheet without Type or AI Favor and centers Level and Floor', () => {
    const header = readFileSync(new URL('../../templates/actor/pc/header.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(header).toMatch(/name="name"[\s\S]*?name="system\.race"[\s\S]*?name="system\.pronouns"[\s\S]*?name="system\.level"[\s\S]*?name="system\.crawlerNumber"[\s\S]*?name="system\.class"[\s\S]*?name="system\.floor"/);
    expect(header).not.toContain('DCC.Header.Type');
    expect(header).not.toContain('system.aiFavor');
    expect(css).toContain('.dcc-headside { flex: 0 0 80px;');
    expect(css).toContain('grid-template-columns: repeat(10, minmax(0, 1fr));');
    expect(css).toContain('"name name name name race race race pron pron pron"');
    expect(css).toContain('"lvl lvl crawl crawl crawl class class class floor floor"');
    expect(css).toContain('.dcc-pcfields :is(.dcc-f-level, .dcc-f-floor) { text-align: center; }');
    expect(css).toContain('.dcc-pcfields :is(.dcc-f-level, .dcc-f-floor) .dcc-fline { text-align: center; }');
  });

  it('uses Mob-style header labels and no Type field for Crawlers, Mobs and Vehicles', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.dcc\.sheet\.actor:is\(\.pc, \.mob, \.vehicle\) \.dcc-header \.dcc-flabel \{[^}]*color: var\(--d-ink\);[^}]*font-family: system-ui[^}]*font-size: 11px;[^}]*font-weight: 700;[^}]*text-transform: none;/);
    for (const path of ['pc/header.hbs', 'mob/body.hbs', 'vehicle/body.hbs']) {
      const sheet = readFileSync(new URL(`../../templates/actor/${path}`, import.meta.url), 'utf8');
      const header = sheet.slice(sheet.indexOf('<header'), sheet.indexOf('</header>'));
      expect(header).not.toContain('DCC.Header.Type');
      expect(header).not.toContain('dcc-type-badge');
    }
  });

  it('centers the Vehicle Floor label and input', () => {
    const vehicle = readFileSync(new URL('../../templates/actor/vehicle/body.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(vehicle).toMatch(/class="dcc-field dcc-field--num dcc-grow-2 dcc-vehicle-floor"[\s\S]*?DCC\.Header\.Floor[\s\S]*?name="system\.floor"/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.vehicle \.dcc-header \.dcc-vehicle-floor,\s*\.dcc\.sheet\.actor\.vehicle \.dcc-header \.dcc-vehicle-floor \.dcc-fline \{ text-align: center; \}/);
  });
});

describe('abilityRows', () => {
  it('gives the Crawler ability strip a taller default window while retaining overflow for smaller windows', () => {
    const sheet = readFileSync(new URL('../../module/applications/pc-sheet.mjs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(sheet).toContain('position: { width: 720, height: 900 }');
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \{[^}]*overflow-y: auto;/);
  });

  it('uses the Crawler ability name as the roll button and labels the modifier below the scores', () => {
    const template = readFileSync(new URL('../../templates/actor/pc/abilities.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(template).toMatch(/<div class="nm">\s*<button[^>]*data-action="rollAbility"[^>]*data-stat="{{s\.key}}"[\s\S]*?>{{localize s\.label}}<\/button>\s*<\/div>\s*<div class="dcc-stat-cols">[\s\S]*?{{s\.enhancement}}[\s\S]*?{{localize "DCC\.Ability\.Enhanced"}}[\s\S]*?dcc-stat-separator[\s\S]*?name="system\.stats\.{{s\.key}}\.base"[\s\S]*?{{localize "DCC\.Ability\.Unenhanced"}}[\s\S]*?<\/label>\s*<\/div>\s*<div class="dcc-stat-col">\s*<span class="dcc-statenh">{{numberFormat s\.modifier sign=true}}<\/span>\s*<span class="dcc-flabel">{{localize "DCC\.Ability\.Modifier"}}<\/span>/);
    expect(template).toContain('<span class="dcc-stat-separator" aria-hidden="true">/</span>');
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \{[^}]*border: none;/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-stat \{[^}]*padding: 3px 4px; border: 1px solid var\(--d-line\);/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-stat \.nm \{[^}]*justify-content: center; text-align: center;/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-stat-cols \{[^}]*width: 100%;[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);[^}]*gap: 10px;/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-statmod \{[^}]*padding: 4px 12px;[^}]*align-items: center; justify-content: center;[^}]*font-size: 13px;/);
    const labels = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
    expect(labels.DCC.Ability.Modifier).toBe('Stat Mod');
  });

  it('gives actor roll and action buttons a black border without changing hover colors', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.dcc\.sheet\.actor:is\(\.pc, \.mob, \.vehicle\) :is\(\.dcc-statmod, \.dcc-rollbtn, \.dcc-addbtn, \.dcc-fbox button\.bx\):not\(:hover\) \{\s*border: 1px solid #000;/);
    expect(css).toContain('.dcc-addbtn:not(:hover) { outline: 1px solid var(--d-bar-text); }');
    expect(css).toContain('.dcc-addbtn:focus-visible { outline: 2px solid var(--d-accent); }');
  });

  it('lets owners toggle base-score inputs with an icon-only control', () => {
    const template = readFileSync(new URL('../../templates/actor/pc/abilities.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(template).toMatch(/{{#if editable}}[\s\S]*?class="dcc-pc-edit-toggle dcc-pc-abilities-edit"[\s\S]*?name="system\.pcAbilitiesEdit" {{checked systemSource\.pcAbilitiesEdit}} aria-label="{{localize 'DCC\.Ability\.Edit'}}"[\s\S]*?<i class="fa-solid fa-pen-to-square" aria-hidden="true"><\/i>\s*<\/label>\s*{{\/if}}/);
    expect(template).toContain('<span class="dcc-statenh dcc-statbase-view">{{s.base}}</span>');
    expect(template).toContain('name="system.stats.{{s.key}}.base" value="{{s.base}}"');
    expect(css).toContain('.dcc-a-abil:has(.dcc-pc-abilities-edit input:checked) .dcc-statbase { display: block; }');
    expect(css).toContain('.dcc-a-abil:has(.dcc-pc-abilities-edit input:checked) .dcc-statbase-view { display: none; }');
    expect(css).toContain('.dcc-pc-edit-toggle:has(input:focus-visible) { outline: 2px solid var(--d-accent);');
  });

  it('spaces Crawler ability cards and uses an underlined base input', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-stats \{[^}]*gap: 8px;/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-stat \{[^}]*gap: 8px;/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-statbase \{[^}]*display: none; border: none; border-bottom: 1px solid var\(--d-line\); border-radius: 0; background: transparent;/);
    expect(css).toMatch(/\.dcc\.sheet\.actor\.pc \.dcc-a-abil \.dcc-statbase:focus-visible \{[^}]*outline: 2px solid var\(--d-accent\);/);
  });

  it('underlines current Mana and uses Roll20 red in both themes', () => {
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    const tokens = css.slice(css.indexOf('.dcc.sheet,\n.dcc.dcc-app {'), css.indexOf('/* Stage shell'));
    expect(tokens.match(/--d-accent: #d31f29;/g)).toHaveLength(2);
    expect(css).not.toContain('#ff5a63');
    expect(css).toMatch(/\.dcc-mana \.cur \{[^}]*border-bottom: 1px solid var\(--d-line\);[^}]*color: var\(--d-accent\);/);
  });

  it('uses the enhanced score and net modifier including flat, percentage and negative effects', () => {
    const source = { stats: Object.fromEntries(STATS.map(key => [key, { base: 10 }])) };
    const system = deriveCreature({
      type: 'mob',
      stats: source.stats,
      modifiers: [
        { target: 'strength', value: '2' },
        { target: 'strength', value: '50%' },
        { target: 'dexterity', value: '-3' },
      ],
    });
    const rows = abilityRows(system, source);
    expect(rows.find(row => row.key === 'strength')).toMatchObject({ base: 10, enhancement: 18, buff: 8, modifier: 4 });
    expect(rows.find(row => row.key === 'dexterity')).toMatchObject({ base: 10, enhancement: 7, buff: -3, modifier: 3 });
    expect(rows.find(row => row.key === 'charisma')).toMatchObject({ base: 10, enhancement: 10, buff: 0 });
  });
});

describe('Mob header layout', () => {
  it('places Floor beside Name and gives italic Descriptors the full second row', () => {
    const mob = readFileSync(new URL('../../templates/actor/mob/body.hbs', import.meta.url), 'utf8');
    const header = mob.slice(mob.indexOf('<header'), mob.indexOf('</header>'));
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    const fields = ['name="name"', 'name="system.floor"', 'name="system.descriptors"'];
    const positions = fields.map(field => header.indexOf(field));
    expect(positions.every(index => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(header).toContain('class="dcc-mobfields"');
    expect(css).toContain('.dcc.sheet.actor .dcc-mobfields { display: grid; grid-template-columns: minmax(0, 1fr) max-content;');
    expect(header).toMatch(/class="dcc-field dcc-mobfield-centered">\s*<span class="dcc-flabel">{{localize "DCC.Header.Floor"}}/);
    expect(header).toContain('class="dcc-field dcc-mob-descriptors"');
    expect(css).toContain('.dcc.sheet.actor .dcc-mobfields .dcc-mobfield-centered { text-align: center; }');
    expect(css).toContain('.dcc.sheet.actor .dcc-mobfields input[name="system.floor"] { box-sizing: border-box; width: 48px; text-align: center; }');
    expect(css).toContain('.dcc.sheet.actor .dcc-mobfields .dcc-mob-descriptors { grid-column: 1 / -1; }');
    expect(css).toContain('.dcc.sheet.actor .dcc-mobfields input[name="system.descriptors"] { font-style: italic; }');
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
  it('carries No Damage to primary and alternate rows and renders plain text', () => {
    const { attacks } = sheetItemLists({ attack: [
      it_('a', 'attack', 'Aura', 0, {}, {
        noDamage: true, skillUses: [{ index: 0, label: 'alternate', noDamage: true }],
      }),
    ] });
    expect(attacks[0].noDamage).toBe(true);
    expect(attacks[0].skillUses[0].noDamage).toBe(true);
    const list = readFileSync(new URL('../../templates/actor/partials/attack-list.hbs', import.meta.url), 'utf8');
    expect(list.match(/{{#if noDamage}}/g)).toHaveLength(2);
    expect(list.match(/<span class="dcc-no-damage">{{localize "DCC\.Roll\.NoDamage"}}<\/span>/g)).toHaveLength(2);
    expect(list).not.toContain('data-action="postAttackNotes"');
    const vehicle = readFileSync(new URL('../../templates/actor/partials/vehicle-weapon-list.hbs', import.meta.url), 'utf8');
    expect(vehicle).toContain('<span class="dcc-no-damage">{{localize "DCC.Roll.NoDamage"}}</span>');
    expect(vehicle).not.toContain('data-action="postAttackNotes"');
  });
  it('attack rows carry the mob static To-Hit target (derived.mobToHit)', () => {
    const { attacks } = sheetItemLists({
      attack: [
        it_('a', 'attack', 'Club', 0, { stat: 'strength' }, { toHit: 2, mobToHit: 13 }),
        it_('p', 'attack', 'Zap', 1, {}, { mobToHit: 11 }),
        it_('z', 'attack', 'Zero', 2, {}, { mobToHit: 0, mobToHitNone: false }),
        it_('n', 'attack', 'None', 3, {}, { mobToHit: 0, mobToHitNone: true }),
      ],
    });
    expect(attacks.map(r => r.mobToHit)).toEqual([13, 11, 0, 0]);
    expect(attacks.slice(2).map(r => r.mobToHitNone)).toEqual([false, true]);
  });
  it('converts authored Attack notes to safe plain text with line breaks', () => {
    const { attacks } = sheetItemLists({
      attack: [
        it_('a', 'attack', 'Club', 0, { description: '<p>First &amp; second<br>line</p><script>bad()</script><p>&lt;b&gt;literal&lt;/b&gt;</p>' }),
        it_('b', 'attack', 'Blank', 1, { description: '<p></p>' }),
      ],
    });
    expect(attacks.map(r => r.notes)).toEqual(['First & second\nline\n<b>literal</b>', '']);
  });
  it('renders notes once for Mob attacks and uses Mob-only target and damage styling', () => {
    const list = readFileSync(new URL('../../templates/actor/partials/attack-list.hbs', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/system.css', import.meta.url), 'utf8');
    expect(list).toMatch(/{{#if mob}}{{#if notes}}\s*<span class="dcc-attack-notes">{{notes}}<\/span>\s*{{\/if}}{{\/if}}/);
    expect(list.indexOf('dcc-attack-notes')).toBeLessThan(list.indexOf('{{#each skillUses}}'));
    expect(list).toContain('data-tooltip="{{#if mob}}{{damageLabel}}{{else}}{{localize \'DCC.Roll.Damage\'}}{{/if}}"');
    expect(list).toContain('data-tooltip="{{#if ../../mob}}{{damageLabel}}{{else}}{{localize \'DCC.Roll.Damage\'}}{{/if}}"');
    expect(css).toMatch(/\.dcc-ilist--attacks\.dcc-ilist--lean > li \{ grid-template-columns: minmax\(0, 1fr\) 60px clamp\(90px, 23%, 126px\) 44px; \}/);
    expect(css).toContain('.dcc-ilist--attacks.dcc-ilist--lean { --dcc-mob-attack-size: 11px; }');
    expect(css).toMatch(/\.dcc-ilist--attacks\.dcc-ilist--lean \.dcc-target \{[^}]*border: 0;[^}]*color: var\(--d-ink\);[^}]*font-size: var\(--dcc-mob-attack-size\);/);
    expect(css).toMatch(/\.dcc-ilist--attacks\.dcc-ilist--lean \.dcc-c-dmg \.dcc-rollbtn--wide \{[^}]*display: block;[^}]*padding-inline: 4px;[^}]*font-size: var\(--dcc-mob-attack-size\);[^}]*letter-spacing: normal;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.dcc-attack-notes \{[^}]*grid-column: 1 \/ -1;[^}]*white-space: pre-line;/);
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
  const row = readFileSync(new URL('../../templates/actor/partials/item-row.hbs', import.meta.url), 'utf8');
  const description = readFileSync(new URL('../../templates/item/partials/description.hbs', import.meta.url), 'utf8');
  const upgrades = readFileSync(new URL('../../templates/item/upgrades.hbs', import.meta.url), 'utf8');

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
    expect(upgrades).toContain('systemFields.upgrades value=systemSource.upgrades');
    expect(list).not.toContain('upgrades');
  });

  it('keeps hotlist editing on item sheets and removes Skill Check controls', () => {
    for (const template of [skill, spell]) {
      expect(template).toContain('systemFields.onHotlist value=systemSource.onHotlist');
      expect(template).not.toContain('data-action="skillCheck"');
    }
    expect(list).not.toContain('system.onHotlist');
    expect(list).not.toContain('data-action="skillCheck"');
    expect(list).toContain('data-field="system.mark"');
    expect(row).not.toContain('data-field="system.mark"');
    expect(list).toContain('data-field="system.enabled"');
    expect(list).toContain('dcc-c-type');
    expect(list).toContain('fa-comment');
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
