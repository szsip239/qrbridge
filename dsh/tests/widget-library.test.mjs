import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { registerWidgetLibrary } from '../src/widget-library.mjs';

test('publishes the board host CLI for the exact scan widget package', async () => {
  const widget = JSON.parse(await readFile(new URL('../widget/manifest.json', import.meta.url)));
  const reference = { id: 'qrbridge.scan', version: widget.version };
  const library = await registerWidgetLibrary({ registerWidgetLibrary: contribution => contribution });

  assert.deepEqual(library.serviceCli, [{
    package: reference,
    serviceCli: {
      command: ['auto', 'qr'],
      helpCommand: ['auto', 'qr', '--help'],
      runOn: 'board_host',
      description: '用 status 查询虚拟相机桥接状态，沿用看板主机的 ADB 配置。',
    },
  }]);
  assert.deepEqual(library.catalog, [reference]);
  const { manifest } = await library.templates.read({ kind: 'widget', ...reference });
  assert.deepEqual({ id: manifest.id, version: manifest.version }, reference);
});
