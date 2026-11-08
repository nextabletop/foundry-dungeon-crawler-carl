// Attack assembly + mob static-target math + mana-on-cast arithmetic. Ported
// from character-sheet/source/sections/_combat.pug:187-217 and
// character-sheet/source/javascript/_spells.js:16.
// No Foundry globals — see foundry/module/rules/ conventions.
//
// rankDamageDie is deliberately NOT ported: it is an unfinished stub in R20
// (the Rank -> bonus-damage-die chart is UNSOURCED per _data-notes.md).

// To-Hit and Damage are materialized per attack so the roll-button labels ARE
// the values (e.g. "To Hit +10", "Damage 2d8 +4 slashing").
export const attackToHit = (statModifier, rank, misc) => (+statModifier || 0) + (+rank || 0) + (+misc || 0);

// R20 quirk, preserved verbatim: the template always inserts a space between
// `die` and the sign, so a blank die (e.g. damageLabel('', 4) -> ' +4') keeps
// a leading space rather than collapsing it away.
export const damageLabel = (die, flat, type) => {
  const f = +flat || 0;
  const sign = f >= 0 ? '+' : '-';
  const base = `${die || ''} ${sign}${Math.abs(f)}`;
  return type ? `${base} ${type}` : base;
};

// ── Mob / NPC math ──
// Asymmetric combat: crawlers roll all d20s. A mob exposes static targets —
// To-Hit and Evade (both + Floor) — that crawlers roll against; the GM rolls
// only mob damage.
export const mobToHit = (statModifier, floor) => 10 + (+statModifier || 0) + (+floor || 0);

export const mobEvade = (dexterityModifier, floor) => 10 + (+dexterityModifier || 0) + (+floor || 0);

// Current mana after spending `cost`, never below 0.
export const manaAfterCast = (current, cost) => Math.max(0, (+current || 0) - (+cost || 0));

// ── Roll formulas ──
// `head ± |n|` with a signed flat term, so a debuffed bonus never reads "+ -2".
// A zero term is dropped; a blank head leaves just the number.
export const signedFormula = (head, n) => {
  const v = Number.isFinite(+n) ? +n : 0;
  const h = String(head ?? '').trim();
  if (!h) return String(v);
  if (v === 0) return h;
  return `${h} ${v < 0 ? '-' : '+'} ${Math.abs(v)}`;
};

// Skill / to-hit / cast check: 1d20 + bonus.
export const checkFormula = (bonus) => signedFormula('1d20', bonus);

// Damage: die + damageBase, or damageBase alone when the die is blank.
export const damageFormula = (die, damageBase) => signedFormula(die, damageBase);

// ── Spell cast ──
// R20 _spells.js castOutputFields + doCast: an unaffordable cast still rolls but
// keeps the mana (cost 4 / mana 3 leaves 3); an exact-cost cast is affordable.
// Auto-enable (Settings, default on) enables the spell on every cast, affordable
// or not, as R20's doCast does.
export const castPlan = ({ manaValue, costEffective, enabled, autoEnable } = {}) => {
  const before = +manaValue || 0;
  const cost = +costEffective || 0;
  const insufficient = cost > before;
  return {
    insufficient,
    manaAfter: insufficient ? before : manaAfterCast(before, cost),
    enable: !!autoEnable && !enabled,
  };
};
