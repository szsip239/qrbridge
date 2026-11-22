import { targets } from './owner.mjs';

export const installationId = 'installation.qrbridge';
export const capabilityPackage = { id: 'qrbridge.bridge', version: '0.1.0' };
const emptyObject = { type: 'object', properties: {}, additionalProperties: false };
/** The viewfinder in CSS pixels from the Widget's left edge; feed counts y up from the Widget's bottom edge, scan down from its top. */
export const viewfinder = { type: 'object', additionalProperties: false,
  properties: { ...Object.fromEntries(['x', 'width', 'height'].map(key => [key, { type: 'number', minimum: 0 }])), y: { type: 'number' } },
  required: ['x', 'y', 'width', 'height'] };
const done = key => ({ type: 'object', additionalProperties: false, properties: { [key]: { type: 'boolean' } }, required: [key] });
const point = { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } };
const injected = { type: 'object', additionalProperties: false, properties: { display_id: { type: 'integer' } }, required: ['display_id'] };
const inputAction = properties => ({ input: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
  output: injected, effect: 'write', connections: [], errors: [] });

export const actions = {
  'qrbridge.status': {
    input: emptyObject,
    output: { type: 'object', additionalProperties: true, properties: { running: { type: 'boolean' } }, required: ['running'] },
    effect: 'read', connections: [], errors: [],
  },
  'qrbridge.open': {
    input: { type: 'object', additionalProperties: false,
      properties: { package: { type: 'string', enum: Object.keys(targets) }, scan: { type: 'boolean' } }, required: ['package', 'scan'] },
    output: { type: 'object', additionalProperties: false,
      properties: { started: { type: 'boolean' }, opened: { type: 'string' }, scanning: { type: 'boolean' } },
      required: ['started', 'opened', 'scanning'] },
    effect: 'write', connections: [], errors: [],
  },
  'qrbridge.down': { input: emptyObject, output: done('stopped'), effect: 'write', connections: [], errors: [] },
  'qrbridge.screen': {
    input: emptyObject,
    output: { type: 'object', additionalProperties: false,
      properties: { image: { type: 'string' }, camera: { type: 'boolean' }, copied: { type: 'integer', minimum: 0 },
        last: { type: 'object', additionalProperties: true } }, required: ['image', 'camera', 'copied'] },
    effect: 'read', connections: [], errors: [],
  },
  'qrbridge.tap': inputAction(point),
  'qrbridge.text': inputAction({ text: { type: 'string' } }),
  'qrbridge.key': inputAction({ key: { type: 'string' }, meta: { type: 'integer', minimum: 0 } }),
  'qrbridge.long-press': inputAction({ ...point, duration: { type: 'integer', minimum: 1 } }),
  'qrbridge.swipe': inputAction({ ...point, end_x: { type: 'number', minimum: 0 }, end_y: { type: 'number', minimum: 0 }, duration: { type: 'integer', minimum: 1 } }),
  'qrbridge.scroll': inputAction({ ...point, delta_x: { type: 'number' }, delta_y: { type: 'number' } }),
  'qrbridge.back': { input: emptyObject, output: injected, effect: 'write', connections: [], errors: [] },
  'qrbridge.feed': {
    input: { type: 'object', additionalProperties: false,
      properties: { placementId: { type: 'string', minLength: 1 }, ...viewfinder.properties }, required: ['placementId', ...viewfinder.required] },
    output: done('feeding'), effect: 'write', connections: [], errors: [],
  },
  'qrbridge.unfeed': { input: emptyObject, output: done('feeding'), effect: 'write', connections: [], errors: [] },
  'qrbridge.backdrop': {
    input: emptyObject,
    output: { type: 'object', additionalProperties: false,
      properties: { image: { type: 'string' } }, required: ['image'] },
    effect: 'read', connections: [], errors: [],
  },
  'qrbridge.scan': {
    input: { type: 'object', additionalProperties: false,
      properties: { placementId: { type: 'string', minLength: 1 }, ...viewfinder.properties }, required: ['placementId', ...viewfinder.required] },
    output: { type: 'object', additionalProperties: false,
      properties: { scanned: { type: 'boolean' }, recognized: { type: 'boolean' } }, required: ['scanned', 'recognized'] },
    effect: 'write', connections: [], errors: [],
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
    'qrbridge.open': input => owner.open(input),
    'qrbridge.down': () => owner.down(),
    'qrbridge.scan': input => owner.scan(input),
    'qrbridge.feed': input => owner.feed(input),
    'qrbridge.unfeed': () => owner.unfeed(),
    'qrbridge.backdrop': () => owner.backdrop(),
    'qrbridge.screen': () => owner.screen(),
    'qrbridge.tap': input => owner.tap(input),
    'qrbridge.text': input => owner.text(input),
    'qrbridge.key': input => owner.key(input),
    'qrbridge.long-press': input => owner.longPress(input),
    'qrbridge.swipe': input => owner.swipe(input),
    'qrbridge.scroll': input => owner.scroll(input),
    'qrbridge.back': () => owner.back(),
  };
  return {
    async health() { return { status: 'healthy' }; },
    recovery(action) { return actions[action].effect === 'read' ? 'effect_key' : 'manual'; },
    async invoke({ action, input }) { return handlers[action](input); },
    async subscribe() { throw new Error('qrbridge_trigger_unknown'); },
  };
}
