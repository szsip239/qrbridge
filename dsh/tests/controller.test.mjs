import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../widget/assets/controller.mjs';

test('an action waits for the owner record instead of unrelated Host status broadcasts', async () => {
  const emitted = [];
  const ticks = [];
  let record = { running: true, busy: null, last: { at: 'before' } };
  const bridge = {
    requestReadIntent: async () => record,
    emitIntent: (name, payload) => emitted.push([name, payload]),
    onVisibilityChange: () => () => {},
  };
  const busy = [];
  let snapshot;
  const controller = createController(bridge, { onSnapshot: value => { snapshot = value; }, onBusy: value => busy.push(value), onError: assert.fail,
    sleep: () => new Promise(resolve => ticks.push(resolve)) });
  await controller.refresh();
  const action = controller.open('com.tencent.mm', true);
  assert.equal(controller.down(), action);
  record = { running: true, busy: 'open', last: { at: 'after' } };
  ticks.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(busy, [true]);
  record = { ...record, busy: null };
  ticks.shift()();
  await action;
  assert.deepEqual(emitted, [['qrbridge.open', { package: 'com.tencent.mm', scan: true }]]);
  assert.deepEqual(busy, [true, false]);
  assert.equal(snapshot.last.at, 'after');
});
