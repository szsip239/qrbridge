import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBridgeCli } from '../src/bridge-cli.mjs';
import { createOwner } from '../src/owner.mjs';

const now = () => new Date('2026-11-15T12:00:00.000Z');

test('bridge CLI passes the serial and surfaces the last stderr line on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qrbridge-'));
  const script = join(dir, 'bridge.py');
  await writeFile(script, 'import json, sys\nif sys.argv[-1] == "fail":\n    sys.exit("Traceback\\nRuntimeError: 原型 association 已存在")\nprint(json.dumps(sys.argv[1:]))\n');
  await chmod(script, 0o755);
  const run = createBridgeCli({ bridge: script, serial: 'device one' });
  assert.deepEqual(await run(['status']), ['--serial', 'device one', 'status']);
  await assert.rejects(run(['fail']), { message: '原型 association 已存在' });
});

test('up and down track the target and save the host log under logDir', async () => {
  const calls = [];
  const launch = 'Status: ok\nActivity: com.vivo.doubleinstance/.DoubleAppResolverActivity\nComplete';
  const owner = createOwner({ run: async args => { calls.push(args); return args[0] === 'up' ? { launch } : {}; }, logDir: '/logs', now });
  await owner.up({ package: 'com.tencent.mm' });
  const snapshot = await owner.snapshot();
  assert.equal(snapshot.target, 'com.tencent.mm');
  assert.equal(snapshot.last.result.opened, 'com.vivo.doubleinstance/.DoubleAppResolverActivity');
  await owner.down();
  assert.deepEqual(calls.at(-1), ['down', '/logs/host-2026-11-15T12-00-00.000Z.log']);
  assert.equal((await owner.snapshot()).target, null);
});

test('a failed action is rethrown and reported in the next snapshot while the host is down', async () => {
  const run = async ([command]) => { throw new Error(command === 'up' ? 'association 已存在' : 'connection refused'); };
  const owner = createOwner({ run, logDir: '/logs', now });
  await assert.rejects(owner.up({ package: 'com.tencent.mm' }), { message: 'association 已存在' });
  assert.deepEqual(await owner.snapshot(), {
    running: false, target: null, message: 'connection refused',
    last: { name: 'up', ok: false, message: 'association 已存在', at: '2026-11-15T12:00:00.000Z' },
  });
});

function scanOwner(streamsAfterImage, calls = []) {
  let clock = 0, imageSent = false;
  const owner = createOwner({
    run: async args => {
      calls.push(['run', args]);
      if (args[0] === 'image') imageSent = true;
      return args[0] === 'status' ? { streams: imageSent ? streamsAfterImage : 1 } : {};
    },
    logDir: '/logs', now: () => new Date(clock), sleep: async ms => { clock += ms; }, recognizeMs: 2000,
    windowFrame: async id => ({ visible: true, x: 1488, y: 52, width: 360, height: 440, id }),
    capture: async (region, path) => calls.push(['capture', region, path]),
  });
  return owner;
}
const viewfinder = { placementId: 'qrbridge.scan', x: 14, y: 140, width: 332, height: 200 };

test('scan sends the viewfinder at the window position and reports recognition when the scanner closes', async () => {
  const calls = [];
  assert.deepEqual(await scanOwner(0, calls).scan(viewfinder), { scanned: true, recognized: true });
  assert.deepEqual(calls, [
    ['run', ['status']],
    ['capture', { x: 1502, y: 192, width: 332, height: 200 }, '/logs/viewfinder.png'],
    ['run', ['image', '/logs/viewfinder.png']],
    ['run', ['status']],
  ]);
});

test('scan reports no recognition while the scanner keeps its stream open', async () => {
  assert.deepEqual(await scanOwner(1).scan(viewfinder), { scanned: true, recognized: false });
});

test('scan refuses when the phone has no camera stream open', async () => {
  const owner = createOwner({ run: async () => ({ streams: 0 }), logDir: '/logs', now, capture: assert.fail,
    windowFrame: async () => ({ visible: true, x: 0, y: 0, width: 1, height: 1 }) });
  await assert.rejects(owner.scan(viewfinder), /先在手机画面打开扫一扫/);
});

test('scan refuses a card that is not open as a window', async () => {
  const owner = createOwner({ run: assert.fail, logDir: '/logs', now, capture: assert.fail,
    windowFrame: async () => ({ visible: false, x: 0, y: 0, width: 1, height: 1 }) });
  await assert.rejects(owner.scan({ placementId: 'p', x: 0, y: 0, width: 1, height: 1 }), /置顶小窗/);
});

test('a second action is refused while the first is still running', async () => {
  const { promise, resolve } = Promise.withResolvers();
  const owner = createOwner({ run: () => promise, logDir: '/logs', now });
  const first = owner.down();
  await assert.rejects(owner.down(), /还在进行/);
  resolve({});
  await first;
  assert.equal((await owner.snapshot()).last.ok, true);
});
