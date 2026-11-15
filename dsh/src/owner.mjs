import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const targets = {
  'com.tencent.mm': '微信',
  'com.eg.android.AlipayGphone': '支付宝',
};

export function findText(node, text) {
  if (node === null || typeof node !== 'object') return undefined;
  if (node.text === text) return node;
  for (const child of Object.values(node)) {
    const found = findText(child, text);
    if (found) return found;
  }
  return undefined;
}

export function createOwner({ run, logDir, capture, windowFrame, toJpeg, now = () => new Date() }) {
  let target = null;
  let last = null;

  async function record(name, job) {
    try {
      const result = await job();
      last = { name, ok: true, at: now().toISOString() };
      return result;
    } catch (error) {
      last = { name, ok: false, message: error.message, at: now().toISOString() };
      throw error;
    }
  }

  return {
    async snapshot() {
      try {
        const host = await run(['status']);
        return { running: true, target, host, last };
      } catch (error) {
        return { running: false, target, message: error.message, last };
      }
    },
    up({ package: name }) {
      return record('up', async () => {
        await run(['up', name]);
        target = name;
        return { started: true };
      });
    },
    scan({ placementId, x, y, width, height }) {
      return record('scan', async () => {
        const frame = await windowFrame(placementId);
        if (!frame.visible) throw new Error('扫码需要先把卡片开成置顶小窗');
        const image = join(logDir, 'viewfinder.png');
        await capture({ x: frame.x + x, y: frame.y + y, width, height }, image);
        await run(['image', image]);
        return { scanned: true };
      });
    },
    async screen() {
      const png = join(logDir, 'screen.png');
      await run(['screenshot', png]);
      return { image: `data:image/jpeg;base64,${(await toJpeg(png)).toString('base64')}` };
    },
    tap({ x, y }) {
      return record('tap', async () => {
        await run(['tap', String(Math.round(x)), String(Math.round(y))]);
        return { tapped: true };
      });
    },
    back() {
      return record('back', async () => {
        await run(['key', 'KEYCODE_BACK']);
        return { tapped: true };
      });
    },
    confirm() {
      return record('confirm', async () => {
        const tree = join(logDir, 'tree.json');
        await run(['tree', tree]);
        const button = findText(JSON.parse(await readFile(tree, 'utf8')), '确认登录');
        if (!button) throw new Error('当前画面没有“确认登录”按钮');
        const [left, top, right, bottom] = button.bounds.split(' ').map(Number);
        await run(['tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))]);
        return { tapped: true };
      });
    },
    down() {
      return record('down', async () => {
        const stamp = now().toISOString().replaceAll(':', '-');
        await run(['down', join(logDir, `host-${stamp}.log`)]);
        target = null;
        return { stopped: true };
      });
    },
  };
}
