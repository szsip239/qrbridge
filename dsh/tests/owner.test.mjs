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
  const owner = createOwner({ run: async args => { calls.push(args); return {}; }, logDir: '/logs', now });
  await owner.up({ package: 'com.tencent.mm' });
  assert.equal((await owner.snapshot()).target, 'com.tencent.mm');
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

test('scan captures the viewfinder at the window position and sends it as the camera image', async () => {
  const calls = [];
  const owner = createOwner({
    run: async args => { calls.push(['run', args]); return {}; }, logDir: '/logs', now,
    windowFrame: async id => ({ visible: true, x: 1488, y: 52, width: 360, height: 440, id }),
    capture: async (region, path) => calls.push(['capture', region, path]),
  });
  await owner.scan({ placementId: 'qrbridge.scan', x: 14, y: 140, width: 332, height: 200 });
  assert.deepEqual(calls, [
    ['capture', { x: 1502, y: 192, width: 332, height: 200 }, '/logs/viewfinder.png'],
    ['run', ['image', '/logs/viewfinder.png']],
  ]);
});

test('scan refuses a card that is not open as a window', async () => {
  const owner = createOwner({ run: assert.fail, logDir: '/logs', now, capture: assert.fail,
    windowFrame: async () => ({ visible: false, x: 0, y: 0, width: 1, height: 1 }) });
  await assert.rejects(owner.scan({ placementId: 'p', x: 0, y: 0, width: 1, height: 1 }), /置顶小窗/);
});

test('confirm taps the centre of the 确认登录 node in the control tree', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qrbridge-'));
  const calls = [];
  const tree = { display_id: 5, windows: [{ text: null, children: [
    { text: '即将在电脑上登录', bounds: '0 609 720 696' },
    { text: '确认登录', bounds: '30 873 690 1002', clickable: true },
  ] }] };
  const run = async args => {
    calls.push(args);
    if (args[0] === 'tree') await writeFile(args[1], JSON.stringify(tree));
    return {};
  };
  const owner = createOwner({ run, logDir: dir, now });
  await owner.confirm();
  assert.deepEqual(calls.at(-1), ['tap', '360', '938']);
  const empty = createOwner({ run: async args => { if (args[0] === 'tree') await writeFile(args[1], '{"windows":[null]}'); return {}; }, logDir: dir, now });
  await assert.rejects(empty.confirm(), /确认登录/);
});
