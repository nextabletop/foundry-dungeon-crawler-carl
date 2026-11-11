import {
  createGrantedAttack, linkedItemIdsToDelete, removeGrantedAttack, setAttackSource,
} from '../rules/item-links.mjs';

export default class DCCItem extends foundry.documents.Item {
  async setAttackSource(sourceId = '') {
    return setAttackSource(this, sourceId);
  }

  async _onCreate(data, options, userId) {
    await super._onCreate?.(data, options, userId);
    if (userId && userId !== game.user.id) return;
    if (!this.parent?.items) return;
    if (['skill', 'spell'].includes(this.type) && this.system.isAttack) await createGrantedAttack(this);
  }

  async _onUpdate(changed, options, userId) {
    await super._onUpdate?.(changed, options, userId);
    if (userId && userId !== game.user.id) return;
    if (!this.parent?.items) return;
    const isAttack = foundry.utils.getProperty(changed, 'system.isAttack');
    if (isAttack === true) await createGrantedAttack(this);
    else if (isAttack === false) await removeGrantedAttack(this);
  }

  async _preDelete(options, user) {
    await super._preDelete?.(options, user);
    if (options.dccLinkedCascade || !this.parent?.deleteEmbeddedDocuments) return;
    const linkedIds = linkedItemIdsToDelete(this, this.parent.items);
    if (linkedIds.length) {
      await this.parent.deleteEmbeddedDocuments('Item', linkedIds, { ...options, dccLinkedCascade: true });
    }
  }
}
