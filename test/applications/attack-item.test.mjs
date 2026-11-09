import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Attack Item registration and sheet', () => {
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
    expect(attack).toContain('{{localize "DCC.Item.FIELDS.mobToHitBase.hint"}}');
    expect(attack).toContain('systemFields.mobToHitNone value=systemSource.mobToHitNone');
    expect(css).toMatch(/\.dcc-mob-tohit-label \.form-fields \{[^}]*display: flex;[^}]*flex-wrap: nowrap;/);
    expect(css).toMatch(/\.dcc-mob-tohit-label \.form-fields > input \{[^}]*flex: 1 1 0;[^}]*width: 0;[^}]*min-width: 0;/);
    expect(css).toMatch(/\.dcc-mob-tohit-label \.form-fields > span \{ flex: none; \}/);
  });
});
