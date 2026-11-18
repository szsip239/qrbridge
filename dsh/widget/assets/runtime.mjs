import { createController } from './controller.mjs';
import { bindPhoneInput } from './input.mjs';

const bridge = window.MosaicWidget;
const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('button')];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;
let running = false;
let visible = true;
let feeding = false;
let camera = false;
let glassTimers = [];
const loops = new Set();

function syncButtons() {
  for (const button of buttons) button.disabled = busy;
}

const actionNames = { open: '打开', down: '结束', back: '返回', tap: '点击', scan: '扫码', text: '输入', key: '按键', copy: '复制', 'long-press': '长按', swipe: '拖动', scroll: '滚动' };

const NOTICE_MS = 6000;
let noticeTimer;

function notify(text, detail = '', tone = 'error') {
  const message = $('message');
  clearTimeout(noticeTimer);
  message.title = detail;
  message.dataset.tone = tone;
  message.textContent = text;
  noticeTimer = setTimeout(() => { message.textContent = ''; }, NOTICE_MS);
}

// The last action's failure, once: later snapshots carry the same record.
let shownFailure = null;
function showNotice(last) {
  if (!last || last.ok || last.at === shownFailure) return;
  shownFailure = last.at;
  notify(`${actionNames[last.name]}失败${last.message === '请重试' ? '，请重试' : `：${last.message}`}`, last.detail ?? '');
}

function failed(what) {
  return error => {
    console.warn(what, error);
    notify(what, error.message);
  };
}

const CONTENT_WIDTH = 320;
const TOP_MARGIN = 6;
const FOLD_MS = 1200;
let windowed = false;

// The card's content holds the visible part of the phone and room for its shadow, and grows upward from its bottom edge.
function resize(open) {
  const box = $('box').getBoundingClientRect();
  const height = TOP_MARGIN + (open ? box.height : box.height / 2) + innerHeight - box.bottom;
  return bridge.resizeWindow({ width: CONTENT_WIDTH, height: Math.ceil(height), anchor: 'bottom-left' });
}

async function fitWindow(open) {
  if (windowed) await resize(open);
}

const unfolded = () => document.body.dataset.fold === 'open';

async function unfold() {
  if (unfolded()) return;
  await fitWindow(true);
  document.body.dataset.fold = 'open';
  feed();
  pollBackdrop();
}

async function fold() {
  if (document.body.dataset.fold === 'folded') return;
  document.body.dataset.fold = 'folded';
  unfeed();
  await sleep(FOLD_MS);
  if (document.body.dataset.fold === 'folded') await fitWindow(false);
}

const showError = failed('小窗调整失败');

// The whole unfolded screen is the glass: the desktop under it is captured (card excluded) for the frosted
// backdrop and, while the phone host runs, fed to the phone camera, whose app previews the centre 9:16 strip.
// Folded, the cover hides the glass, so nothing is captured.
function feed() {
  const { left, top, width, height } = $('stage').getBoundingClientRect();
  if (!windowed || !visible || !width || !unfolded()) return;
  feeding = true;
  // y counts from the card's bottom edge, which stays put while the window grows upward under the Host strip.
  controller.feed({ x: left, y: top - innerHeight, width, height });
}

function unfeed() {
  if (!feeding) return;
  feeding = false;
  controller.unfeed();
}

// iPhone Duo glass on the phone screen: frost and darken, lift the darkness, then clear onto the camera view.
function setCamera(open) {
  if (open === camera) return;
  camera = open;
  glassTimers.forEach(clearTimeout);
  document.body.dataset.glass = 'frost';
  const stages = open ? [['lift', 520], ['glass', 900]] : [['off', 420]];
  glassTimers = stages.map(([stage, at]) => setTimeout(() => { document.body.dataset.glass = stage; }, at));
}

// A stream that drops and comes back within a few seconds (host starting, reconnect) is not worth a red line.
const STALL_MS = 4000;

async function loop(name, active, step) {
  if (loops.has(name)) return;
  loops.add(name);
  let failingSince = null;
  while (visible && active()) {
    try {
      await step();
      failingSince = null;
      await sleep(50);
    } catch (error) {
      failingSince ??= Date.now();
      if (Date.now() - failingSince > STALL_MS) {
        failed('画面中断')(error);
        // The host may have gone away (phone rebooted, stopped elsewhere); a fresh status folds the card if so.
        controller.refresh().catch(failed('状态读取失败'));
      }
      await sleep(1000);
    }
  }
  loops.delete(name);
}

function pollBackdrop() {
  loop('backdrop', () => !running && unfolded(), async () => {
    const { image } = await controller.backdrop();
    if (image) for (const glass of document.querySelectorAll('.glass')) glass.src = image;
  });
}

// The glass takes the phone screen's proportions, so its frame hugs the picture.
$('mirror').addEventListener('load', () => {
  const { naturalWidth, naturalHeight } = $('mirror');
  $('box').style.setProperty('--aspect', String(naturalWidth / naturalHeight));
});

function pollScreen() {
  loop('screen', () => running, async () => {
    const frame = await controller.screen();
    $('mirror').src = frame.image;
    $('mirror').dataset.ready = 'true';
    if (frame.copied && frame.copied !== shownCopy) {
      shownCopy = frame.copied;
      notify('已复制到电脑', '', 'neutral');
    }
    showNotice(frame.last);
    setCamera(frame.camera);
  });
}

function showIdle() {
  running = false;
  document.body.dataset.state = 'idle';
  setCamera(false);
  $('mirror').dataset.ready = 'false';
  pollBackdrop();
}

function render(snapshot) {
  const stopped = running && !snapshot.running;
  showNotice(snapshot.last);
  syncButtons();
  if (snapshot.running) {
    running = true;
    document.body.dataset.state = 'running';
    // A window reopened while the host runs comes back to the phone screen, and resumes feeding the camera.
    unfold().catch(showError);
    pollScreen();
    return;
  }
  // A failed start leaves the phone open with its message; 结束 folds it.
  if (stopped) fold().catch(showError);
  showIdle();
}

const controller = createController(bridge, {
  onSnapshot: render,
  onBusy: value => { busy = value; syncButtons(); },
  onError: failed('状态读取失败'),
});
for (const button of document.querySelectorAll('[data-package]')) {
  button.addEventListener('click', async () => {
    await unfold().catch(showError);
    controller.open(button.dataset.package, button.hasAttribute('data-scan'));
  });
}
// 结束 folds at once; the phone host shuts down behind the cover.
$('down').addEventListener('click', () => {
  fold().catch(showError);
  if (!running) return;
  showIdle();
  controller.down();
});
$('back').addEventListener('click', () => controller.back());
bridge.onVisibilityChange(value => {
  visible = value;
  if (!visible) return unfeed();
  feed();
  if (running) pollScreen();
  else pollBackdrop();
});
// On the Board the card has no window of its own: the first resize fails there, and it neither resizes nor feeds.
// In a window, feeding follows the viewport, so the region is measured after each resize has been laid out.
resize(false).then(() => {
  windowed = true;
  new ResizeObserver(feed).observe($('stage'));
}, () => {});
let shownCopy = null;
bindPhoneInput($('mirror'), $('keyboard'), controller.input, () => running && !busy && visible);
controller.refresh().catch(failed('状态读取失败'));
