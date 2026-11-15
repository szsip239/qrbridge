import { createController } from './controller.mjs';

const names = { 'com.tencent.mm': '微信', 'com.eg.android.AlipayGphone': '支付宝' };
const bridge = window.MosaicWidget;
const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('button')];
let busy = false;
let running = false;
let phoneTimer;

function syncButtons() {
  for (const button of buttons) button.disabled = busy || button.dataset.blocked === 'true';
}

function viewfinder() {
  const { left, top, width, height } = $('viewfinder').getBoundingClientRect();
  const inset = 6;
  return { x: left + inset, y: top + inset, width: width - 2 * inset, height: height - 2 * inset };
}

function notice(last) {
  if (!last) return '';
  if (!last.ok) return `${last.name} 失败：${last.message}`;
  return last.result.opened?.includes('DoubleAppResolver') ? '出现分身选择框：请在手机画面里选原版 App' : '';
}

function render(snapshot) {
  running = snapshot.running;
  $('dot').dataset.on = snapshot.running;
  $('state').textContent = snapshot.running ? `运行中 · ${names[snapshot.target] ?? '未指定 App'}` : '未运行';
  $('detail').textContent = snapshot.running
    ? `相机 ${snapshot.host.streams ? '已连接' : '待连接'} · ${snapshot.host.image_loaded ? '已送码' : '未送码'}`
    : snapshot.message;
  for (const button of buttons) {
    button.dataset.current = button.dataset.package === snapshot.target;
    button.dataset.blocked = button.dataset.package ? snapshot.running : !snapshot.running;
  }
  syncButtons();
  $('message').textContent = notice(snapshot.last);
  if (!snapshot.running) {
    setPhoneView(false);
    $('screen').removeAttribute('src');
  }
}

function present({ safeArea }) {
  for (const side of ['top', 'right', 'bottom', 'left']) {
    document.body.style.setProperty(`--safe-${side}`, `${Math.max(safeArea[side], 10)}px`);
  }
}

const controller = createController(bridge, {
  onSnapshot: render,
  onBusy: value => { busy = value; syncButtons(); },
  onError: error => { $('message').textContent = `读取失败：${error.message}`; },
});
bridge.onThemeChange(theme => { document.documentElement.dataset.mosaicTheme = theme.mode; });
document.documentElement.dataset.mosaicTheme = bridge.theme?.mode ?? 'light';
present(bridge.presentation);
bridge.onPresentationChange(present);
for (const button of document.querySelectorAll('[data-package]')) {
  button.addEventListener('click', () => controller.up(button.dataset.package).then(() => running && setPhoneView(true)));
}
$('down').addEventListener('click', () => controller.down());

async function showScreen() {
  $('screen').src = (await controller.screen()).image;
}
function setPhoneView(on) {
  $('view').setAttribute('aria-pressed', on);
  $('phone').hidden = !on;
  $('viewfinder').hidden = on;
  clearInterval(phoneTimer);
  if (on) {
    showScreen().catch(error => { $('message').textContent = `画面读取失败：${error.message}`; });
    phoneTimer = setInterval(() => showScreen().catch(() => {}), 2000);
  }
}
$('view').addEventListener('click', () => setPhoneView($('phone').hidden));
$('scan').addEventListener('click', () => { setPhoneView(false); controller.scan(viewfinder()); });
bridge.onVisibilityChange(visible => { if (!visible) setPhoneView(false); });
$('screen').addEventListener('click', event => {
  const image = $('screen');
  const box = image.getBoundingClientRect();
  controller.tap({
    x: (event.clientX - box.left) * image.naturalWidth / box.width,
    y: (event.clientY - box.top) * image.naturalHeight / box.height,
  }).then(showScreen);
});
$('back').addEventListener('click', () => controller.back().then(showScreen));
controller.refresh().catch(error => { $('message').textContent = `读取失败：${error.message}`; });
