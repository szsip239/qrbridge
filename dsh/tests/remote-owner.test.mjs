import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwner } from '../src/owner.mjs';

function setup(writeClipboard) {
  let receive;
  const logs = [];
  const requests = [];
  let controls = 0;
  const owner = createOwner({ run: assert.fail, logDir: '/logs', logFailure: async entry => logs.push(entry), writeClipboard,
    openMirror: async (_closed, callback) => { receive = callback; return { latest: { jpeg: Buffer.from('jpeg'), camera: false }, close() {} }; },
    openControl: async () => { controls++; return { request: async input => { requests.push(input); return { display_id: 7 }; }, close() {} }; },
  });
  return { owner, logs, requests, receive: clip => receive(clip), controls: () => controls };
}

test('phone copies reach the Mac in order and a hint appears only after pbcopy finishes', async () => {
  const gate = Promise.withResolvers();
  const writes = [];
  const fixture = setup(async text => { writes.push(text); if (writes.length === 1) await gate.promise; });
  assert.equal((await fixture.owner.screen()).copied, 0);
  const first = fixture.receive({ text: '中文🙂' });
  const second = fixture.receive({ text: 'line1\nline2' });
  await Promise.resolve();
  assert.deepEqual(writes, ['中文🙂']);
  assert.equal((await fixture.owner.screen()).copied, 0);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes, ['中文🙂', 'line1\nline2']);
  assert.equal((await fixture.owner.screen()).copied, 2);
});

test('clipboard read/write failures reach the red failure record, never a success hint', async () => {
  const fixture = setup(async () => { throw new Error('pbcopy exited'); });
  await fixture.owner.screen();
  await fixture.receive({ text: 'text' });
  assert.equal((await fixture.owner.screen()).copied, 0);
  assert.equal(fixture.logs[0].detail, 'pbcopy exited');
  await fixture.receive({ error: 'clipboard denied' });
  const screen = await fixture.owner.screen();
  assert.equal(screen.last.name, 'copy');
  assert.equal(screen.last.ok, false);
  assert.equal(screen.last.detail, 'clipboard denied');
});

test('tap, Unicode text and back reuse the command connection without invoking the CLI', async () => {
  const fixture = setup(assert.fail);
  await Promise.all([fixture.owner.tap({ x: 20, y: 40 }), fixture.owner.text({ text: '你好' }), fixture.owner.back()]);
  assert.equal(fixture.controls(), 1);
  assert.deepEqual(fixture.requests, [{ command: 'tap', x: 20, y: 40 }, { command: 'text', text: '你好' }, { command: 'key', key: 'KEYCODE_BACK' }]);
});
