import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createMirrorOpener, createControlOpener } from '../src/host-streams.mjs';

function record(kind, payload) {
  const data = Buffer.from(payload);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(data.length);
  header[4] = kind;
  return Buffer.concat([header, data]);
}

test('fragmented and joined mirror records preserve JPEG flags and UTF-8 clipboard records', async () => {
  const socket = new PassThrough();
  const clips = [];
  const mirror = await createMirrorOpener(async command => { assert.equal(command, 'mirror'); return { socket, close() {} }; })(() => {}, clip => clips.push(clip));
  const bytes = Buffer.concat([record(0, 'jpeg0'), record(2, JSON.stringify({ text: '你好🙂\ntext' })), record(1, 'jpeg1')]);
  for (const byte of bytes) socket.write(Buffer.from([byte]));
  assert.deepEqual(mirror.latest, { camera: true, jpeg: Buffer.from('jpeg1') });
  assert.deepEqual(clips, [{ text: '你好🙂\ntext' }]);
  socket.write(record(2, JSON.stringify({ error: 'clipboard read denied' })));
  assert.deepEqual(clips.at(-1), { error: 'clipboard read denied' });
  assert.equal(mirror.latest.jpeg.toString(), 'jpeg1');
});

test('one control connection matches queued responses and rejects pending input on close', async () => {
  const socket = new EventEmitter();
  const sent = [];
  socket.setEncoding = () => {};
  socket.write = text => sent.push(JSON.parse(text));
  let opens = 0;
  const control = await createControlOpener(async command => { assert.equal(command, 'control'); opens++; return { socket, close() {} }; })(() => {});
  const first = control.request({ command: 'text', text: '中文' });
  const second = control.request({ command: 'key', key: 'KEYCODE_ENTER' });
  socket.emit('data', '{"display_id":');
  socket.emit('data', '7}\n{"error":"injection failed"}\n');
  assert.deepEqual(await first, { display_id: 7 });
  await assert.rejects(second, /injection failed/);
  const third = control.request({ command: 'tap', x: 1, y: 2 });
  socket.emit('close');
  await assert.rejects(third, /断开/);
  assert.equal(opens, 1);
  assert.equal(sent.length, 3);
});
