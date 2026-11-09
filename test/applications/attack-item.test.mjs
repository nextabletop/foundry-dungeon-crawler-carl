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
});
