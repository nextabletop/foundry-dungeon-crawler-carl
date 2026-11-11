import { ITEM_ASPECTS } from '../config.mjs';
import { DCC_CHANGE_TYPE } from '../effects/dcc-change.mjs';
import { idOf } from '../rules/items.mjs';

export const effectActor = effect => {
  const parent = effect?.parent;
  if (parent?.documentName === 'Actor') return parent;
  if (parent?.documentName === 'Item' && parent.parent?.documentName === 'Actor') return parent.parent;
  return null;
};

export const itemTargetOptions = items => (items ?? []).flatMap(item =>
  (ITEM_ASPECTS[item.type] ?? []).map(aspect => ({
    value: `item-id:${idOf(item)}:${aspect}`,
    name: item.name,
    id: idOf(item),
    type: item.type,
    aspect,
  }))).filter(option => option.id);

/** Core effect editor with an owned-item target chooser for DCC changes. */
export default class DCCActiveEffectConfig extends foundry.applications.sheets.ActiveEffectConfig {
  static DEFAULT_OPTIONS = {
    classes: ['dcc', 'effect'],
  };

  async _onRender(context, options) {
    await super._onRender(context, options);
    const actor = effectActor(this.document);
    const targets = itemTargetOptions(actor?.items?.contents);
    for (const row of this.element.querySelectorAll('.tab.changes [data-changes] > li[data-index]')) {
      const key = row.querySelector('.key input[name$=".key"]');
      const type = row.querySelector('.type select[name$=".type"]');
      if (!key || !type || row.querySelector('.dcc-item-target')) continue;
      const container = document.createElement('div');
      container.className = 'dcc-item-target';
      container.hidden = type.value !== DCC_CHANGE_TYPE;
      if (!actor) {
        container.textContent = game.i18n.localize('DCC.Effect.ItemTargetUnowned');
      } else {
        const select = document.createElement('select');
        select.setAttribute('aria-label', game.i18n.localize('DCC.Effect.ItemTargetLabel'));
        select.title = game.i18n.localize('DCC.Effect.ItemTargetLabel');
        select.disabled = !this.isEditable || targets.length === 0;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = game.i18n.localize(
          targets.length ? 'DCC.Effect.ItemTargetChoose' : 'DCC.Effect.ItemTargetEmpty',
        );
        select.append(placeholder);
        for (const target of targets) {
          const option = document.createElement('option');
          option.value = target.value;
          option.textContent = game.i18n.format('DCC.Effect.ItemTargetOption', {
            name: target.name,
            id: target.id,
            type: game.i18n.localize(`TYPES.Item.${target.type}`),
            aspect: game.i18n.localize(`DCC.Effect.Aspect.${target.aspect}`),
          });
          select.append(option);
        }
        select.value = targets.some(target => target.value === key.value) ? key.value : '';
        container.append(select);
      }
      key.parentElement.append(container);
    }
  }

  _onChangeForm(formConfig, event) {
    const target = event.target;
    const row = target.closest?.('.tab.changes [data-changes] > li[data-index]');
    const container = row?.querySelector('.dcc-item-target');
    const key = row?.querySelector('.key input[name$=".key"]');
    const type = row?.querySelector('.type select[name$=".type"]');
    const select = container?.querySelector('select');
    if (container && key && type) {
      if (target === select && select.value) key.value = select.value;
      if (target === key && select) {
        select.value = [...select.options].some(option => option.value === key.value) ? key.value : '';
      }
      if (target === type) container.hidden = type.value !== DCC_CHANGE_TYPE;
    }
    return super._onChangeForm(formConfig, event);
  }
}
