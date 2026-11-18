import assert from 'node:assert/strict';
import test from 'node:test';
import { androidKey, classifyGesture, scrollGesture, phonePoint, bindPhoneInput } from '../widget/assets/input.mjs';
import { createController } from '../widget/assets/controller.mjs';

test('editing and navigation keys map to Android while IME and Mac shortcuts stay local', () => {
  const mapping = { Enter: 'ENTER', Backspace: 'DEL', Delete: 'FORWARD_DEL', ArrowLeft: 'DPAD_LEFT', ArrowRight: 'DPAD_RIGHT', ArrowUp: 'DPAD_UP', ArrowDown: 'DPAD_DOWN', Tab: 'TAB', Escape: 'ESCAPE' };
  for (const [key, code] of Object.entries(mapping)) assert.deepEqual(androidKey({ key }), { key: `KEYCODE_${code}`, meta: 0 });
  assert.deepEqual(androidKey({ key: 'Tab', shiftKey: true }), { key: 'KEYCODE_TAB', meta: 1 });
  for (const event of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'v', metaKey: true }, { key: '你' }]) assert.equal(androidKey(event), null);
});

test('movement wins over elapsed time, holds tolerate jitter, and scroll keeps both axes', () => {
  const gesture = { start: { x: 40, y: 80 }, end: { x: 42, y: 83 }, distance: 3, duration: 120 };
  assert.deepEqual(classifyGesture(gesture), { command: 'tap', x: 40, y: 80 });
  assert.deepEqual(classifyGesture({ ...gesture, duration: 550 }), { command: 'long-press', x: 40, y: 80, duration: 600 });
  assert.deepEqual(classifyGesture({ ...gesture, distance: 20, duration: 800 }), { command: 'swipe', x: 40, y: 80, end_x: 42, end_y: 83, duration: 800 });
  for (const [deltaMode, deltaX, deltaY] of [[0, 48, -96], [1, 1, -2], [2, .1, -.2]]) {
    assert.deepEqual(scrollGesture(gesture.start, { deltaMode, deltaX, deltaY }, 480), { command: 'scroll', x: 40, y: 80, delta_x: 1, delta_y: -2 });
  }
});

test('letterboxing rejects margins and captured drags clamp to the screen', () => {
  const image = { naturalWidth: 720, naturalHeight: 1280, getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 400 }) };
  assert.equal(phonePoint(image, { clientX: 12, clientY: 30 }), null);
  assert.deepEqual(phonePoint(image, { clientX: 160, clientY: 220 }), { x: 360, y: 640 });
  assert.deepEqual(phonePoint(image, { clientX: -50, clientY: 500 }, true), { x: 0, y: 1279 });
});

function surface(extra = {}) {
  const listeners = {};
  const windowListeners = {};
  return { ownerDocument: { defaultView: { addEventListener: (name, fn) => { windowListeners[name] = fn; } } },
    ...extra, listeners, windowListeners, addEventListener: (name, fn) => { listeners[name] = fn; } };
}

test('Mac composition sends the committed Chinese once and paste preserves Unicode and newlines', async () => {
  const sent = [];
  const editor = surface({ value: '' });
  const image = surface();
  bindPhoneInput(image, editor, event => sent.push(event), () => true);
  editor.listeners.compositionstart();
  editor.value = 'ni';
  editor.listeners.input({ isComposing: true });
  editor.value = '你好';
  editor.listeners.input({ isComposing: false });
  assert.deepEqual(sent, []);
  editor.listeners.compositionend();
  editor.listeners.input({ isComposing: false });
  await Promise.resolve();
  assert.deepEqual(sent, [{ command: 'text', text: '你好' }]);
  assert.equal(editor.value, '');
  let prevented = false;
  editor.listeners.paste({ preventDefault: () => { prevented = true; }, clipboardData: { getData: type => { assert.equal(type, 'text/plain'); return '中文\n🙂'; } } });
  assert.equal(prevented, true);
  assert.deepEqual(sent.at(-1), { command: 'text', text: '中文\n🙂' });
});

test('pointer cancellation sends nothing, and a hold does not become a second tap', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  const image = surface({ naturalWidth: 720, naturalHeight: 1280, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }), setPointerCapture() {} });
  const editor = surface({ value: '', focus() {} });
  bindPhoneInput(image, editor, event => sent.push(event), () => true);
  const event = { clientX: 10, clientY: 20, button: 0, pointerId: 1, timeStamp: 0, preventDefault() {} };
  image.listeners.pointerdown(event);
  image.listeners.pointercancel();
  t.mock.timers.tick(600);
  assert.deepEqual(sent, []);
  image.listeners.pointerdown(event);
  t.mock.timers.tick(550);
  image.listeners.pointerup({ ...event, timeStamp: 800 });
  assert.deepEqual(sent, [{ command: 'long-press', x: 20, y: 40, duration: 600 }]);
});

test('clicking the phone focuses its editable textarea before dispatching the tap', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const steps = [];
  const image = surface({ naturalWidth: 720, naturalHeight: 1280, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }),
    setPointerCapture: () => steps.push('capture') });
  const editor = surface({ value: '', focus: options => { assert.deepEqual(options, { preventScroll: true }); steps.push('focus textarea'); } });
  bindPhoneInput(image, editor, input => steps.push(input.command), () => true);
  const event = { clientX: 10, clientY: 20, button: 0, pointerId: 1, timeStamp: 0, preventDefault() {} };
  image.listeners.pointerdown(event);
  image.listeners.pointerup({ ...event, timeStamp: 100 });
  assert.deepEqual(steps, ['focus textarea', 'capture', 'tap']);
});

test('leaving the native window releases DOM focus so the next click can request keyboard focus again', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let editing = false, focusChanges = 0;
  const image = surface({ naturalWidth: 720, naturalHeight: 1280, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }), setPointerCapture() {} });
  const editor = surface({ value: '', focus() { if (!editing) focusChanges++; editing = true; }, blur() { editing = false; } });
  bindPhoneInput(image, editor, () => {}, () => true);
  const event = { clientX: 10, clientY: 20, button: 0, pointerId: 1, timeStamp: 0, preventDefault() {} };
  image.listeners.pointerdown(event);
  image.listeners.pointerup({ ...event, timeStamp: 100 });
  editor.windowListeners.blur?.();
  assert.equal(editing, false);
  image.listeners.pointerdown(event);
  image.listeners.pointerup({ ...event, timeStamp: 100 });
  assert.equal(focusChanges, 2);
});

test('rapid inputs and back emit every request without an action lock or status subprocess', () => {
  const sent = [];
  const controller = createController({ requestReadIntent: assert.fail, emitIntent: (...args) => sent.push(args), onVisibilityChange: () => () => {} }, { onSnapshot: assert.fail, onBusy: assert.fail, onError: assert.fail });
  controller.tap({ x: 20, y: 30 });
  controller.input({ command: 'text', text: '你' });
  controller.input({ command: 'key', key: 'KEYCODE_DEL', meta: 0 });
  controller.back();
  assert.deepEqual(sent.map(([name]) => name), ['qrbridge.tap', 'qrbridge.text', 'qrbridge.key', 'qrbridge.back']);
});
