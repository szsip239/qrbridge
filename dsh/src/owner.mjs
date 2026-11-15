import { join } from 'node:path';

export const targets = {
  'com.tencent.mm': '微信',
  'com.eg.android.AlipayGphone': '支付宝',
};

export function createOwner({ run, logDir, capture, windowFrame, toJpeg, now = () => new Date() }) {
  let target = null;
  let last = null;
  let inFlight = null;

  async function record(name, job) {
    // Each action is several adb calls; a second click must not interleave with the first.
    if (inFlight) throw new Error(`“${inFlight}”还在进行`);
    inFlight = name;
    try {
      const result = await job();
      last = { name, ok: true, at: now().toISOString(), result };
      return result;
    } catch (error) {
      last = { name, ok: false, message: error.message, at: now().toISOString() };
      throw error;
    } finally {
      inFlight = null;
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
        const { launch } = await run(['up', name]);
        target = name;
        return { started: true, opened: launch.match(/^Activity: (.+)$/m)[1] };
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
