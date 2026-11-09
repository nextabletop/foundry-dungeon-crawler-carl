const LINKABLE_TYPES = new Set(['attack', 'gear', 'skill', 'spell', 'weapon']);
const RANK_SOURCE_TYPES = new Set(['skill', 'spell']);

const itemArray = items => Array.from(items?.contents ?? items ?? []);
const itemId = item => item?.id ?? item?._id ?? '';
const linkIds = item => Array.from(new Set(
  (Array.isArray(item?.system?.linkedItemIds) ? item.system.linkedItemIds : [])
    .filter(id => typeof id === 'string' && id && id !== itemId(item)),
));
const itemMap = items => new Map(itemArray(items).map(item => [itemId(item), item]));

export const isLinkableItem = item => LINKABLE_TYPES.has(item?.type);

/**
 * Resolve one Item's links without assuming stored data is valid.
 * A healthy link exists only when the owned partner points back.
 */
export function itemLinkState(item, items) {
  const byId = itemMap(items);
  const id = itemId(item);
  const resolved = [];
  const staleIds = [];
  const asymmetric = [];
  for (const linkedId of linkIds(item)) {
    const linked = byId.get(linkedId);
    if (!linked) staleIds.push(linkedId);
    else if (!linkIds(linked).includes(id)) asymmetric.push(linked);
    else resolved.push(linked);
  }
  for (const candidate of byId.values()) {
    if (itemId(candidate) === id || !linkIds(candidate).includes(id)) continue;
    if (!linkIds(item).includes(itemId(candidate)) && !asymmetric.includes(candidate)) asymmetric.push(candidate);
  }
  return { resolved, staleIds, asymmetric };
}

/** The mutually linked, non-Attack source of an Attack, if one exists. */
export function attackSource(attack, items) {
  if (attack?.type !== 'attack') return null;
  return itemLinkState(attack, items).resolved.find(item => item.type !== 'attack') ?? null;
}

/** The stable-ID Skill/Spell used by an Attack, falling back to its granting source. */
export function attackPrimarySkill(attack, items) {
  if (attack?.type !== 'attack') return null;
  const source = attackSource(attack, items);
  if (source?.type === 'spell') return source;
  const primaryId = String(attack.system?.primarySkillId ?? '');
  if (primaryId) {
    const primary = itemMap(items).get(primaryId);
    return RANK_SOURCE_TYPES.has(primary?.type) ? primary : null;
  }
  return RANK_SOURCE_TYPES.has(source?.type) ? source : null;
}

/** The mutually linked Attack granted by a Skill/Spell source, if one exists. */
export function grantedAttack(source, items) {
  if (!RANK_SOURCE_TYPES.has(source?.type)) return null;
  return itemLinkState(source, items).resolved.find(item => item.type === 'attack') ?? null;
}

/** A linked Skill/Spell supplies Rank one-way; otherwise the Attack keeps its own stored Rank. */
export function effectiveAttackRank(attack, items) {
  const skill = attackPrimarySkill(attack, items);
  if (!skill) return attack?.system?.primarySkillId ? 0 : (Number(attack?.system?.rank) || 0);
  const effective = skill.system?.derived?.rankEffective;
  return Number.isFinite(effective) ? effective : (Number(skill.system?.rank) || 0);
}

/**
 * Traverse mutually linked owned Items, excluding the starting Item.
 * Missing and one-sided references are reported by itemLinkState but never deleted.
 */
export function linkedItemIdsToDelete(startItem, items) {
  const byId = itemMap(items);
  const startId = itemId(startItem);
  if (!startId) return [];
  const visited = new Set([startId]);
  const pending = [startItem];
  const result = [];
  while (pending.length) {
    const current = pending.pop();
    for (const linked of itemLinkState(current, byId.values()).resolved) {
      const id = itemId(linked);
      if (visited.has(id)) continue;
      visited.add(id);
      result.push(id);
      pending.push(linked);
    }
  }
  return result;
}

/** Remove missing, self, duplicate, non-linkable, and one-sided references from an Actor's link graph. */
export async function repairOwnedItemLinks(actor) {
  if (!actor?.items || typeof actor.updateEmbeddedDocuments !== 'function') {
    throw new Error('Item links can only be repaired on an Actor with owned Items.');
  }

  const items = itemArray(actor.items);
  const byId = itemMap(items);
  const updates = [];
  for (const item of items) {
    const id = itemId(item);
    const current = Array.isArray(item.system?.linkedItemIds) ? item.system.linkedItemIds : [];
    const desired = linkIds(item).filter(linkedId => {
      const linked = byId.get(linkedId);
      return isLinkableItem(item) && isLinkableItem(linked) && linkIds(linked).includes(id);
    });
    if (current.length !== desired.length || current.some((linkedId, index) => linkedId !== desired[index])) {
      updates.push({ _id: id, 'system.linkedItemIds': desired });
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  return updates;
}

/** Create and link the one Attack granted by an owned Skill/Spell. */
export async function createGrantedAttack(source) {
  if (!RANK_SOURCE_TYPES.has(source?.type)) throw new Error('Only a Skill or Spell can grant an Attack.');
  const actor = source.parent;
  if (!actor?.items || typeof actor.createEmbeddedDocuments !== 'function') {
    throw new Error('A Skill or Spell must be owned by an Actor before it can grant an Attack.');
  }
  const existing = grantedAttack(source, actor.items);
  if (existing) return existing;
  const [attack] = await actor.createEmbeddedDocuments('Item', [{
    type: 'attack',
    name: source.name,
    img: source.img,
    system: {
      stat: source.system?.stat ?? 'strength',
      rank: Number(source.system?.rank) || 0,
      primarySkillId: source.id,
    },
  }]);
  if (!attack) throw new Error(`Could not create the Attack granted by "${source.name}".`);
  await setAttackSource(attack, source.id);
  return attack;
}

/** Unlink and delete the Attack granted by an owned Skill/Spell, preserving the source. */
export async function removeGrantedAttack(source) {
  if (!RANK_SOURCE_TYPES.has(source?.type)) throw new Error('Only a Skill or Spell can grant an Attack.');
  const attack = grantedAttack(source, source.parent?.items);
  if (!attack) return null;
  await setAttackSource(attack, '');
  await attack.delete({ dccLinkedCascade: true });
  return attack;
}

const requireOwnedAttack = (attack) => {
  if (attack?.type !== 'attack') throw new Error('Only an Attack Item can choose an attack source.');
  if (!attack.parent?.items || typeof attack.parent.updateEmbeddedDocuments !== 'function') {
    throw new Error('An Attack must be owned by an Actor before it can be linked.');
  }
};

/**
 * Replace an Attack's granting source while preserving non-Attack chain links.
 * The update is idempotent and removes displaced Attack/source links on both sides.
 */
export async function setAttackSource(attack, sourceId = '') {
  requireOwnedAttack(attack);
  const actor = attack.parent;
  const items = itemArray(actor.items);
  const byId = itemMap(items);
  const attackId = itemId(attack);
  const source = sourceId ? byId.get(sourceId) : null;
  if (sourceId && (!source || !isLinkableItem(source) || source.type === 'attack')) {
    throw new Error(`Attack source "${sourceId}" is not a linkable Item owned by this Actor.`);
  }

  const next = new Map(items.map(item => [itemId(item), new Set(linkIds(item))]));
  const touch = new Set();
  const attackFlag = new Map();
  const removePair = (leftId, rightId) => {
    if (next.get(leftId)?.delete(rightId)) touch.add(leftId);
    if (next.get(rightId)?.delete(leftId)) touch.add(rightId);
    const sourceItem = byId.get(leftId)?.type === 'attack' ? byId.get(rightId) : byId.get(leftId);
    if (RANK_SOURCE_TYPES.has(sourceItem?.type)) attackFlag.set(itemId(sourceItem), false);
  };

  for (const item of items) {
    const id = itemId(item);
    if (id === attackId) continue;
    if (next.get(attackId)?.has(id) || next.get(id)?.has(attackId)) removePair(attackId, id);
  }

  if (source) {
    for (const linkedId of [...next.get(sourceId)]) {
      if (byId.get(linkedId)?.type === 'attack') removePair(sourceId, linkedId);
    }
    next.get(attackId).add(sourceId);
    next.get(sourceId).add(attackId);
    touch.add(attackId);
    touch.add(sourceId);
    if (RANK_SOURCE_TYPES.has(source.type)) attackFlag.set(sourceId, true);
  }

  const updateIds = new Set([...touch, ...attackFlag.keys()]);
  const updates = [...updateIds].map(id => ({
    _id: id,
    'system.linkedItemIds': [...next.get(id)],
    ...(attackFlag.has(id) ? { 'system.isAttack': attackFlag.get(id) } : {}),
  })).filter(update => {
    const current = linkIds(byId.get(update._id));
    const desired = update['system.linkedItemIds'];
    const linksChanged = current.length !== desired.length || current.some((id, index) => id !== desired[index]);
    const flagChanged = Object.hasOwn(update, 'system.isAttack')
      && byId.get(update._id)?.system?.isAttack !== update['system.isAttack'];
    return linksChanged || flagChanged;
  });
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  return updates;
}
