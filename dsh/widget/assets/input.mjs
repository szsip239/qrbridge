const keys = {
  Enter: 'ENTER', Backspace: 'DEL', Delete: 'FORWARD_DEL',
  ArrowLeft: 'DPAD_LEFT', ArrowRight: 'DPAD_RIGHT', ArrowUp: 'DPAD_UP', ArrowDown: 'DPAD_DOWN',
  Tab: 'TAB', Escape: 'ESCAPE',
};

export function androidKey(event) {
  if (event.isComposing || event.keyCode === 229 || event.metaKey || !keys[event.key]) return null;
  return { key: `KEYCODE_${keys[event.key]}`, meta: (event.shiftKey ? 1 : 0) | (event.altKey ? 2 : 0) | (event.ctrlKey ? 4096 : 0) };
}

export const HOLD_MS = 550;
export const TOUCH_SLOP = 6;

export function classifyGesture({ start, end, duration, distance }) {
  if (distance > TOUCH_SLOP) return { command: 'swipe', ...start, end_x: end.x, end_y: end.y, duration: Math.max(1, Math.round(duration)) };
  if (duration >= HOLD_MS) return { command: 'long-press', ...start, duration: 600 };
  return { command: 'tap', ...start };
}

export function scrollGesture(point, { deltaX, deltaY, deltaMode }, height) {
  const unit = deltaMode === 1 ? 1 : (deltaMode === 2 ? height / 48 : 1 / 48);
  return { command: 'scroll', ...point, delta_x: deltaX * unit, delta_y: deltaY * unit };
}

export function phonePoint(image, event, clamp = false) {
  const box = image.getBoundingClientRect();
  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  let x = (event.clientX - box.left - (box.width - image.naturalWidth * scale) / 2) / scale;
  let y = (event.clientY - box.top - (box.height - image.naturalHeight * scale) / 2) / scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (clamp) {
    x = Math.max(0, Math.min(image.naturalWidth - 1, x));
    y = Math.max(0, Math.min(image.naturalHeight - 1, y));
  }
  if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return null;
  return { x, y };
}

export function bindPhoneInput(image, editor, send, active) {
  let composing = false;
  let press = null;
  // A panel losing the keyboard can leave its textarea focused, suppressing the next focusin request.
  editor.ownerDocument.defaultView.addEventListener('blur', () => editor.blur());
  const commit = () => {
    if (!composing && editor.value) {
      if (active()) send({ command: 'text', text: editor.value });
      editor.value = '';
    }
  };
  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; queueMicrotask(commit); });
  editor.addEventListener('input', event => { if (!event.isComposing) commit(); });
  editor.addEventListener('keydown', event => {
    if (!active()) return;
    const key = androidKey(event);
    if (!key) return;
    event.preventDefault();
    send({ command: 'key', ...key });
  });
  editor.addEventListener('paste', event => {
    if (!active()) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text) send({ command: 'text', text });
  });
  image.addEventListener('contextmenu', event => event.preventDefault());
  image.addEventListener('dragstart', event => event.preventDefault());
  image.addEventListener('pointerdown', event => {
    if (!active() || event.button !== 0) return;
    const start = phonePoint(image, event);
    if (!start) return;
    event.preventDefault();
    editor.focus({ preventScroll: true });
    image.setPointerCapture(event.pointerId);
    press = { start, end: start, at: event.timeStamp, clientX: event.clientX, clientY: event.clientY, distance: 0, sent: false };
    press.timer = setTimeout(() => {
      if (active() && press.distance <= TOUCH_SLOP) {
        send(classifyGesture({ ...press, duration: HOLD_MS }));
        press.sent = true;
      }
    }, HOLD_MS);
  });
  image.addEventListener('pointermove', event => {
    if (!press) return;
    press.end = phonePoint(image, event, true);
    press.distance = Math.max(press.distance, Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY));
    if (press.distance > TOUCH_SLOP) clearTimeout(press.timer);
  });
  const cancel = () => { if (press) clearTimeout(press.timer); press = null; };
  image.addEventListener('pointerup', event => {
    if (!press) return;
    press.distance = Math.max(press.distance, Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY));
    if (!press.sent && active()) send(classifyGesture({ ...press, end: phonePoint(image, event, true), duration: event.timeStamp - press.at }));
    cancel();
  });
  image.addEventListener('pointercancel', cancel);
  image.addEventListener('lostpointercapture', cancel);
  image.addEventListener('wheel', event => {
    if (!active()) return;
    const point = phonePoint(image, event);
    if (!point) return;
    event.preventDefault();
    send(scrollGesture(point, event, image.clientHeight));
  }, { passive: false });
}
