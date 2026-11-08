import * as config from '../../module/config.mjs';

// Field mocks — constructors store options, no validation
class MockDataField {
  constructor(options = {}) { this.options = options; this.initial = options.initial; }
}
class MockNumberField extends MockDataField {}
class MockStringField extends MockDataField {}
class MockBooleanField extends MockDataField {}
class MockHTMLField extends MockDataField {}
class MockFormulaField extends MockDataField {}
class MockSetField extends MockDataField {
  constructor(elementField, options = {}) { super(options); this.element = elementField; }
}
class MockSchemaField extends MockDataField {
  constructor(schema = {}, options = {}) { super(options); this.fields = schema; }
}
class MockTypedObjectField extends MockDataField {
  constructor(modelOrField, options = {}) { super(options); this.model = modelOrField; }
}
class MockEmbeddedDataField extends MockDataField {
  constructor(model, options = {}) { super(options); this.model = model; }
}
class MockCollectionField extends MockDataField {
  constructor(model, options = {}) { super(options); this.model = model; }
}
class MockArrayField extends MockDataField {
  constructor(element, options = {}) { super(options); this.element = element; }
}
class MockObjectField extends MockDataField {}
class MockDocumentUUIDField extends MockStringField {}
class MockFilePathField extends MockStringField {}

// TypeDataModel mock
class MockTypeDataModel {
  static LOCALIZATION_PREFIXES = [];
  static defineSchema() { return {}; }
  constructor(data = {}) { Object.assign(this, data); }
  prepareBaseData() {}
  prepareDerivedData() {}
  async _preCreate() {}
  async _preUpdate() {}
}

// ActiveEffectTypeDataModel mock — distinct class with the core `changes` field
class MockActiveEffectTypeDataModel extends MockTypeDataModel {
  static defineSchema() {
    return {
      changes: new MockArrayField(new MockSchemaField({
        key: new MockStringField({ required: true }),
        type: new MockStringField({ required: true, blank: false, initial: 'add' }),
        value: new MockDataField({ required: true, nullable: true, initial: '' }),
        phase: new MockStringField({ required: true, blank: false, initial: 'initial' }),
        priority: new MockNumberField(),
      })),
    };
  }
}

// Recursive merge like foundry.utils.mergeObject: dotted keys are expanded
// first, then `other` is merged INTO `original` (in place unless
// `inplace: false`), which is returned. Objects merge key-by-key; arrays and
// primitives are replaced; inserted values are deep-cloned. Only `inplace`
// and `recursive: true` are supported — any other option throws, so no test
// silently relies on behaviour the mock doesn't implement.
const isPlainObject = v => (v !== null) && (typeof v === 'object') && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const deepClone = (v) => {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepClone(x)]));
  return v;
};
const UNSUPPORTED_MERGE_OPTIONS = ['insertKeys', 'insertValues', 'overwrite', 'enforceTypes', 'applyOperators', 'performDeletions'];
function setPath(obj, path, val) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => (isPlainObject(o[k]) ? o[k] : (o[k] = {})), obj);
  target[last] = (isPlainObject(val) && isPlainObject(target[last])) ? mergeInto(target[last], val) : val;
}
function expandObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) setPath(out, k, isPlainObject(v) ? expandObject(v) : v);
  return out;
}
function mergeInto(original, other) {
  for (const [k, v] of Object.entries(other)) {
    if (isPlainObject(v) && isPlainObject(original[k])) mergeInto(original[k], v);
    else original[k] = deepClone(v);
  }
  return original;
}
function mergeObject(original = {}, other = {}, options = {}) {
  const bad = Object.keys(options).filter(k => UNSUPPORTED_MERGE_OPTIONS.includes(k)
    || (k === 'recursive' && options.recursive !== true));
  if (bad.length) throw new Error(`mock mergeObject: unsupported option(s) ${bad.join(', ')}`);
  if (options.inplace === false) original = deepClone(original);
  if (Object.keys(original).some(k => k.includes('.'))) {
    const expanded = expandObject(original);
    Object.keys(original).forEach(k => delete original[k]);
    Object.assign(original, expanded);
  }
  return mergeInto(original, expandObject(other));
}

// Roll mock with simple arithmetic evaluation
class MockRoll {
  constructor(formula = '', data = {}, options = {}) {
    this.formula = formula;
    this.data = data;
    this.options = { ...options };
    this._evaluated = false;
    this.terms = [];
    this.dice = [];
  }
  evaluateSync() {
    this._evaluated = true;
    let expr = this.formula.replace(/@([\w.]+)/g, (_, path) => {
      return path.split('.').reduce((o, k) => o?.[k], this.data) ?? 0;
    });
    try { this.total = Function(`"use strict"; return (${expr})`)(); }
    catch { this.total = 0; }
    return this;
  }
  async evaluate() { return this.evaluateSync(); }
  async render() { return `<div>${this.formula} = ${this.total}</div>`; }
  async toMessage(messageData = {}, options = {}) { return messageData; }
  get isDeterministic() { return !this.formula.match(/d\d/i); }
  static replaceFormulaData(formula, data) {
    return formula.replace(/@([\w.]+)/g, (_, path) => path.split('.').reduce((o, k) => o?.[k], data) ?? 0);
  }
}

// Assign globals
// DataModel mock (non-typed base)
class MockDataModel {
  static defineSchema() { return {}; }
  constructor(data = {}) { Object.assign(this, data); }
}

// Document mocks: enough for `class X extends foundry.documents.Actor` to load.
// getRollData mirrors core Actor#getRollData (returns this.system).
class MockDocument {
  constructor(data = {}) { Object.assign(this, data); }
  getRollData() { return this.system; }
}
class MockActor extends MockDocument {}
class MockItem extends MockDocument {}

globalThis.foundry = {
  documents: { Actor: MockActor, Item: MockItem },
  data: {
    fields: {
      NumberField: MockNumberField, StringField: MockStringField,
      BooleanField: MockBooleanField, HTMLField: MockHTMLField,
      SchemaField: MockSchemaField, SetField: MockSetField,
      TypedObjectField: MockTypedObjectField, EmbeddedDataField: MockEmbeddedDataField,
      CollectionField: MockCollectionField, FormulaField: MockFormulaField,
      ArrayField: MockArrayField, ObjectField: MockObjectField,
      DocumentUUIDField: MockDocumentUUIDField, FilePathField: MockFilePathField,
    },
    ActiveEffectTypeDataModel: MockActiveEffectTypeDataModel,
  },
  abstract: { DataModel: MockDataModel, TypeDataModel: MockTypeDataModel },
  dice: { Roll: MockRoll },
  utils: {
    mergeObject,
    expandObject,
    getProperty: (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj),
    hasProperty: (obj, path) => {
      const parts = path.split('.');
      const last = parts.pop();
      const target = parts.reduce((o, k) => o?.[k], obj);
      return (target !== null) && (typeof target === 'object') && (last in target);
    },
    setProperty: (obj, path, val) => {
      const parts = path.split('.');
      const last = parts.pop();
      const target = parts.reduce((o, k) => o[k] ??= {}, obj);
      target[last] = val;
    },
    randomID: () => Math.random().toString(36).slice(2, 10),
  },
};
globalThis.game = {
  i18n: {
    localize: (key) => key,
    format: (key, data) => key,
    getListFormatter: () => ({ format: (arr) => arr.join(', ') }),
  },
};
globalThis.CONFIG = { DCC: { ...config } };
globalThis.ChatMessage = { getSpeaker: () => ({}) };

// GM screen (Chunk 8) defaults: every test is UNLINKED unless it stubs these.
// Add-if-absent, so a default added elsewhere keeps its shape (extended, never replaced).
game.settings ??= {};
game.settings.get ??= () => '';
game.settings.set ??= async () => {};
game.actors ??= new Map();
game.user ??= { isGM: true, isActiveGM: true };
foundry.utils.fromUuidSync ??= () => null;
foundry.applications ??= {};
foundry.applications.instances ??= new Map();
// Real trailing debounce (sheet-refresh.mjs's queue); tests drain it with flushRenders().
foundry.utils.debounce ??= (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
