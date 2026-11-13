import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Attack Item registration and sheet', () => {
  it('shows inline damage fields only on attack-marked Skills/Spells, without a separate section', () => {
    for (const type of ['skill', 'spell']) {
      const template = read(`../../templates/item/${type}.hbs`);
      expect(template).not.toContain('partials/attack-defaults.hbs');
      expect(template).not.toContain('DCC.ItemSheet.AttackDefaults');
      const damageFields = template.match(/{{#if systemSource\.isAttack}}([\s\S]*?){{\/if}}/)?.[1];
      expect(damageFields).toBeDefined();
      for (const field of ['die', 'damageStat', 'damageType']) {
        expect(damageFields).toContain(`systemFields.attackDefaults.fields.${field} value=systemSource.attackDefaults.${field}`);
        expect(damageFields).toContain(`label=(localize "DCC.Item.FIELDS.${field}.label")`);
      }
      expect(damageFields).toContain('options=selectOptions.damageStat');
    }
  });
  it('hides hotlist controls on Mob-owned items without removing their stored values', () => {
    const sheet = read('../../module/applications/item-sheet.mjs');
    expect(sheet).toContain("showHotlist: this.document.parent?.type !== 'mob'");
    for (const type of ['attack', 'gear', 'weapon', 'skill', 'spell']) {
      const template = read(`../../templates/item/${type}.hbs`);
      expect(template).toMatch(/{{#if showHotlist}}\s*(?:<div class="dcc-item-flags">\s*)?{{formGroup systemFields\.onHotlist value=systemSource\.onHotlist rootId=rootId}}\s*(?:<\/div>\s*)?{{\/if}}/);
    }
  });

  it('declares Attack as an Item document type with HTML description', () => {
    const system = JSON.parse(read('../../system.json'));
    expect(system.documentTypes.Item.attack).toEqual({ htmlFields: ['description'] });
  });

  it('provides source-link UI and is the actor attack-list creation type', () => {
    const attack = read('../../templates/item/attack.hbs');
    const actorList = read('../../templates/actor/partials/attack-list.hbs');
    expect(attack).toContain('data-attack-source');
    expect(attack).toContain('data-action="linkAttack"');
    expect(attack).toContain('attackLink.rankLinked');
    expect(actorList).toContain('data-type="attack"');
    expect(actorList).not.toContain('data-type="weapon"');
  });

  it('shows a localized Floor suffix next to the Mob base input without changing its value or None behavior', () => {
    const attack = read('../../templates/item/attack.hbs');
    const css = read('../../styles/system.css');
    expect(attack).toMatch(/{{#if showMobToHit}}[\s\S]*<label class="dcc-mob-tohit-label">[\s\S]*{{formInput systemFields\.mobToHitBase value=systemSource\.mobToHitBase disabled=systemSource\.mobToHitNone}}[\s\S]*{{localize "DCC\.Mob\.PlusFloor"}}[\s\S]*<\/label>/);
    const mobControls = attack.split('{{#if showMobToHit}}')[1].split('{{/if}}')[0];
    expect(mobControls).not.toContain('hint');
    expect(attack).toContain('systemFields.mobToHitNone value=systemSource.mobToHitNone');
    expect(css).toMatch(/\.dcc-mob-tohit-label \.form-fields \{[^}]*display: flex;[^}]*flex-wrap: nowrap;/);
    expect(css).toMatch(/\.dcc-mob-tohit-label \.form-fields > input \{[^}]*flex: 1 1 0;[^}]*width: 0;[^}]*min-width: 0;/);
    expect(css).toMatch(/\.dcc-mob-tohit-label \.form-fields > span \{ flex: none; \}/);
  });

  it('authors No Damage within the Mob-only controls', () => {
    const attack = read('../../templates/item/attack.hbs');
    expect(attack).toMatch(/{{#if showMobToHit}}[\s\S]*systemFields\.mobNoDamage value=systemSource\.mobNoDamage[\s\S]*{{\/if}}/);
    const itemSheet = read('../../module/applications/item-sheet.mjs');
    expect(itemSheet).toContain("showMobToHit: this.document.type === 'attack' && (!this.document.parent || this.document.parent.type === 'mob')");
  });

  it('places Mob attack checkboxes beside concise labels without hints', () => {
    const attack = read('../../templates/item/attack.hbs');
    const labels = JSON.parse(read('../../lang/en.json')).DCC.Item.FIELDS;
    expect(labels.mobToHitBase.label).toBe('To-Hit Base');
    expect(labels.mobToHitNone.label).toBe('No To-Hit');
    expect(attack).toContain('class="dcc-item-flags dcc-item-wide"');
    for (const id of ['mob-tohit-none', 'mob-no-damage']) {
      expect(attack).toContain(`for="{{rootId}}-${id}"`);
      expect(attack).toContain(`id=(concat rootId "-${id}")`);
    }
    const css = read('../../styles/system.css');
    expect(css).toMatch(/\.dcc-item-flags \.form-group \{[^}]*grid-template-areas: "box label" "\. hint";/);
    expect(css).toMatch(/\.dcc:is\(\.sheet.actor, \.sheet.item, \.sheet.effect, \.dcc-app\) input\[type="checkbox"\] \{[^}]*--checkbox-background-color: #9aa0aa;/);
    expect(css).toMatch(/input\[type="checkbox"\]::before \{[^}]*border: 1px solid #000;/);
  });
});
