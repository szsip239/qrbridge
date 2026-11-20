import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../widget/assets/controller.mjs';

test('an action stays busy until its run finishes, then rereads the status', async () => {
  const listeners = {};
  const emitted = [];
  let reads = 0;
  const bridge = {
    requestReadIntent: async () => ({ running: true, reads: ++reads }),
    emitIntent: (name, payload) => emitted.push([name, payload]),
    onStatusChange: listener => { listeners.status = listener; return () => {}; },
    onVisibilityChange: () => () => {},
  };
  const busy = [];
  let snapshot;
  const controller = createController(bridge, { onSnapshot: value => { snapshot = value; }, onBusy: value => busy.push(value), onError: assert.fail });
  const action = controller.up('com.tencent.mm');
  assert.equal(controller.down(), action);
  listeners.status('idle');
  listeners.status('running');
  listeners.status('error');
  await action;
  assert.deepEqual(emitted, [['qrbridge.up', { package: 'com.tencent.mm' }]]);
  assert.deepEqual(busy, [true, false]);
  assert.equal(snapshot.reads, 1);
});
