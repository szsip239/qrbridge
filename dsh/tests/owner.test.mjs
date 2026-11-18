import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBridgeCli } from '../src/bridge-cli.mjs';
import { createOwner } from '../src/owner.mjs';

const logFailure = async () => {};
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

test('open and down track the target and save the host log under logDir', async () => {
  const calls = [];
  const opened = { started: true, opened: 'com.tencent.mm/.plugin.scanner.ui.BaseScanUI', scanning: true };
  const owner = createOwner({ run: async args => { calls.push(args); return args[0] === 'open' ? opened : {}; }, logDir: '/logs', logFailure, now });
  await owner.open({ package: 'com.tencent.mm', scan: true });
  assert.deepEqual(calls[0], ['open', 'com.tencent.mm', '--scan']);
  const snapshot = await owner.snapshot();
  assert.equal(snapshot.target, 'com.tencent.mm');
  assert.deepEqual(snapshot.last.result, opened);
  await owner.down();
  assert.deepEqual(calls.at(-1), ['down', '/logs/host-2026-11-15T12-00-00.000Z.log']);
  assert.equal((await owner.snapshot()).target, null);
});

test('a failed action is rethrown and reported in the next snapshot while the host is down', async () => {
  const run = async ([command]) => { throw new Error(command === 'open' ? 'association 已存在' : 'connection refused'); };
  const owner = createOwner({ run, logDir: '/logs', logFailure, now });
  await assert.rejects(owner.open({ package: 'com.tencent.mm', scan: false }), { message: 'association 已存在' });
  assert.deepEqual(await owner.snapshot(), {
    running: false, busy: null, target: null, message: 'connection refused',
    last: { name: 'open', ok: false, message: '请重试', detail: 'association 已存在', at: '2026-11-15T12:00:00.000Z' },
  });
});

test('an adb error reaches the card as a few Chinese words, with the original kept as detail', async () => {
  const run = async () => { throw new Error("adb: device 'phone' not found"); };
  const owner = createOwner({ run, logDir: '/logs', logFailure, now });
  await assert.rejects(owner.open({ package: 'com.tencent.mm', scan: false }));
  assert.deepEqual((await owner.snapshot()).last, {
    name: 'open', ok: false, message: '手机未连接', detail: "adb: device 'phone' not found", at: '2026-11-15T12:00:00.000Z',
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
    logDir: '/logs', logFailure, now: () => new Date(clock), sleep: async ms => { clock += ms; }, recognizeMs: 2000,
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
  const owner = createOwner({ run: async () => ({ streams: 0 }), logDir: '/logs', logFailure, now, capture: assert.fail,
    windowFrame: async () => ({ visible: true, x: 0, y: 0, width: 1, height: 1 }) });
  await assert.rejects(owner.scan(viewfinder), /先在手机画面打开扫一扫/);
});

test('scan refuses a card that is not open as a window', async () => {
  const owner = createOwner({ run: assert.fail, logDir: '/logs', logFailure, now, capture: assert.fail,
    windowFrame: async () => ({ visible: false, x: 0, y: 0, width: 1, height: 1 }) });
  await assert.rejects(owner.scan({ placementId: 'p', x: 0, y: 0, width: 1, height: 1 }), /置顶小窗/);
});

test('a second action is refused while the first is still running', async () => {
  const { promise, resolve } = Promise.withResolvers();
  const owner = createOwner({ run: () => promise, logDir: '/logs', logFailure, now });
  const first = owner.down();
  await assert.rejects(owner.down(), /还在进行/);
  resolve({});
  await first;
  assert.equal((await owner.snapshot()).last.ok, true);
});

test('concurrent feeds keep one capture open, each stopping the one before', async () => {
  let open = 0, most = 0;
  const openCapture = async () => {
    open += 1;
    most = Math.max(most, open);
    await new Promise(resolve => setTimeout(resolve, 5));
    return async () => { open -= 1; };
  };
  const windowFrame = async () => ({ x: 0, y: 0, width: 320, height: 300, visible: true });
  const owner = createOwner({ run: async () => ({}), logDir: '/logs', logFailure, now, windowFrame, openCapture });
  const region = { placementId: 'qrbridge.scan', x: 0, y: -300, width: 320, height: 300 };
  await Promise.all([owner.feed(region), owner.feed(region), owner.feed(region)]);
  assert.equal(open, 1);
  assert.equal(most, 1);
  await owner.unfeed();
  assert.equal(open, 0);
});
