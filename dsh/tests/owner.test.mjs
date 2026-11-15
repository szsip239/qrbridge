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
