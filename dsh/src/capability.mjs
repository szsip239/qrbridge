import { targets } from './owner.mjs';

export const installationId = 'installation.qrbridge';
export const capabilityPackage = { id: 'qrbridge.bridge', version: '0.1.0' };
const emptyObject = { type: 'object', properties: {}, additionalProperties: false };
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
    output: done('started'), effect: 'write', connections: [], errors: [],
  },
  'qrbridge.down': { input: emptyObject, output: done('stopped'), effect: 'write', connections: [], errors: [] },
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
  };
  return {
    async health() { return { status: 'healthy' }; },
    recovery(action) { return action === 'qrbridge.status' ? 'effect_key' : 'manual'; },
    async invoke({ action, input }) { return handlers[action](input); },
    async subscribe() { throw new Error('qrbridge_trigger_unknown'); },
  };
}
