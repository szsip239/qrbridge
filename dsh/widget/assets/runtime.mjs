import { createController } from './controller.mjs';

const names = { 'com.tencent.mm': '微信', 'com.eg.android.AlipayGphone': '支付宝' };
const bridge = window.MosaicWidget;
const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('button')];
let busy = false;

function syncButtons() {
  for (const button of buttons) button.disabled = busy || button.dataset.blocked === 'true';
}

function render(snapshot) {
  $('dot').dataset.on = snapshot.running;
  $('state').textContent = snapshot.running ? `运行中 · ${names[snapshot.target] ?? '未指定 App'}` : '未运行';
  $('detail').textContent = snapshot.running
    ? `相机 ${snapshot.host.streams ? '已连接' : '待连接'} · ${snapshot.host.image_loaded ? '已送码' : '未送码'}`
    : snapshot.message;
  for (const button of buttons) {
    button.dataset.current = button.dataset.package === snapshot.target;
    button.dataset.blocked = button.id === 'down' ? !snapshot.running : snapshot.running;
  }
  syncButtons();
  const failure = snapshot.last && !snapshot.last.ok ? `${snapshot.last.name} 失败：${snapshot.last.message}` : '';
  $('message').textContent = failure;
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
for (const button of buttons) {
  button.addEventListener('click', () => (button.id === 'down' ? controller.down() : controller.up(button.dataset.package)));
}
controller.refresh().catch(error => { $('message').textContent = `读取失败：${error.message}`; });
