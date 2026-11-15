import { targets } from './owner.mjs';

export const installationId = 'installation.qrbridge';
export const capabilityPackage = { id: 'qrbridge.bridge', version: '0.1.0' };
const emptyObject = { type: 'object', properties: {}, additionalProperties: false };
/** The viewfinder in CSS pixels from the Widget's top-left corner. */
export const viewfinder = { type: 'object', additionalProperties: false,
  properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'number', minimum: 0 }])),
  required: ['x', 'y', 'width', 'height'] };
const done = key => ({ type: 'object', additionalProperties: false, properties: { [key]: { type: 'boolean' } }, required: [key] });

export const actions = {
  'qrbridge.status': {
    input: emptyObject,
    output: { type: 'object', additionalProperties: true, properties: { running: { type: 'boolean' } }, required: ['running'] },
    effect: 'read', connections: [], errors: [],
  },
  'qrbridge.up': {
    input: { type: 'object', additionalProperties: false,
      properties: { package: { type: 'string', enum: Object.keys(targets) } }, required: ['package'] },
    output: { type: 'object', additionalProperties: false,
      properties: { started: { type: 'boolean' }, opened: { type: 'string' } }, required: ['started', 'opened'] },
    effect: 'write', connections: [], errors: [],
  },
  'qrbridge.down': { input: emptyObject, output: done('stopped'), effect: 'write', connections: [], errors: [] },
  'qrbridge.screen': {
    input: emptyObject,
    output: { type: 'object', additionalProperties: false, properties: { image: { type: 'string' } }, required: ['image'] },
    effect: 'read', connections: [], errors: [],
  },
  'qrbridge.tap': {
    input: { type: 'object', additionalProperties: false,
      properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } }, required: ['x', 'y'] },
    output: done('tapped'), effect: 'write', connections: [], errors: [],
  },
  'qrbridge.back': { input: emptyObject, output: done('tapped'), effect: 'write', connections: [], errors: [] },
  'qrbridge.scan': {
    input: { type: 'object', additionalProperties: false,
      properties: { placementId: { type: 'string', minLength: 1 }, ...viewfinder.properties }, required: ['placementId', ...viewfinder.required] },
    output: done('scanned'), effect: 'write', connections: [], errors: [],
  },
};

export const capabilityManifest = {
  schemaVersion: 1, ...capabilityPackage, title: '扫码桥接',
  description: 'Start, inspect and stop the Android QR virtual camera bridge.',
  interfaceVersion: '1', upgradeRole: 'managed_reference',
  sharedConfig: { schema: emptyObject, defaults: {} }, connectionRequirements: {}, triggers: {}, actions,
};

export function createCapabilityAdapter(owner) {
  const handlers = {
    'qrbridge.status': () => owner.snapshot(),
    'qrbridge.up': input => owner.up(input),
    'qrbridge.down': () => owner.down(),
    'qrbridge.scan': input => owner.scan(input),
    'qrbridge.screen': () => owner.screen(),
    'qrbridge.tap': input => owner.tap(input),
    'qrbridge.back': () => owner.back(),
  };
  return {
    async health() { return { status: 'healthy' }; },
    recovery(action) { return actions[action].effect === 'read' ? 'effect_key' : 'manual'; },
    async invoke({ action, input }) { return handlers[action](input); },
    async subscribe() { throw new Error('qrbridge_trigger_unknown'); },
  };
}
