import { join } from 'node:path';

export const targets = {
  'com.tencent.mm': '微信',
  'com.eg.android.AlipayGphone': '支付宝',
  'com.autonavi.minimap': '高德地图',
  'com.ffcs.js.app': '工作',
};

// The card shows a few words the user can act on; the raw adb, Python or bridge text stays in `detail`.
function friendly(error) {
  if (/还在进行/.test(error.message)) return '上一步还没完成';
  if (/not found|no devices|offline|unauthorized|refused|cannot connect/i.test(error.message)) return '手机未连接';
  return '请重试';
}

export function createOwner({ run, logDir, logFailure, capture, windowFrame, openCapture, openFeed, openMirror, openControl, writeClipboard, now = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), recognizeMs = 10000 }) {
  let target = null;
  let last = null;
  let inFlight = null;
  let backdrop = null;
  let hostUp = false;
  let feed = null;
  let mirror = null;
  let control = null;
  let copySequence = 0;
  let clipboardWrites = Promise.resolve();

  async function failure(name, error) {
    last = { name, ok: false, message: friendly(error), detail: error.message, at: now().toISOString() };
    await logFailure(last);
  }

  function receiveClipboard(clip) {
    clipboardWrites = clipboardWrites.then(async () => {
      if (clip.error) throw new Error(clip.error);
      await writeClipboard(clip.text);
      copySequence += 1;
    }).catch(error => failure('copy', error));
    return clipboardWrites;
  }

  async function input(command, payload) {
    try {
      control ??= openControl(() => { control = null; }).catch(error => { control = null; throw error; });
      return await (await control).request({ command, ...payload });
    } catch (error) {
      await failure(command, error);
      throw error;
    }
  }

  // While the host runs, every captured frame also goes to the phone camera.
  function forward(jpeg) {
    if (!hostUp) return;
    feed ??= openFeed(() => { feed = null; }).catch(() => {
      feed = null;
      return null;
    });
    feed.then(stream => stream?.write(jpeg));
  }

  async function stopCapture() {
    const open = backdrop;
    backdrop = null;
    await open?.stop();
  }

  async function stopStreams() {
    hostUp = false;
    for (const open of [feed, mirror, control]) await (await open?.catch(() => null))?.close();
    feed = null;
    mirror = null;
    control = null;
  }

  async function liveScreen() {
    mirror ??= openMirror(() => { mirror = null; }, receiveClipboard).catch(error => {
      mirror = null;
      throw error;
    });
    const stream = await mirror;
    for (const started = now(); !stream.latest; await sleep(50)) {
      if (now() - started > 3000) throw new Error('手机画面还没有出来');
    }
    return stream.latest;
  }

  async function record(name, job) {
    // Each action is several adb calls; a second click must not interleave with the first.
    if (inFlight) throw new Error(`${inFlight} 还在进行`);
    inFlight = name;
    try {
      const result = await job();
      last = { name, ok: true, at: now().toISOString(), result };
      return result;
    } catch (error) {
      await failure(name, error);
      throw error;
    } finally {
      inFlight = null;
    }
  }

  return {
    async snapshot() {
      try {
        const host = await run(['status']);
        hostUp = true;
        return { running: true, busy: inFlight, target, host, last };
      } catch (error) {
        hostUp = false;
        return { running: false, busy: inFlight, target, message: error.message, last };
      }
    },
    open({ package: name, scan }) {
      return record('open', async () => {
        const opened = await run(['open', name, ...(scan ? ['--scan'] : [])]);
        target = name;
        hostUp = true;
        return opened;
      });
    },
    scan({ placementId, x, y, width, height }) {
      return record('scan', async () => {
        const frame = await windowFrame(placementId);
        if (!frame.visible) throw new Error('扫码需要先把卡片开成置顶小窗');
        if (!(await run(['status'])).streams) throw new Error('相机未打开：先在手机画面打开扫一扫');
        const image = join(logDir, 'viewfinder.png');
        await capture({ x: frame.x + x, y: frame.y + y, width, height }, image);
        await run(['image', image]);
        for (const started = now(); now() - started < recognizeMs; await sleep(500)) {
          if (!(await run(['status'])).streams) return { scanned: true, recognized: true };
        }
        return { scanned: true, recognized: false };
      });
    },
    // Capture runs beside the adb actions, so it does not take the action lock.
    async feed({ placementId, ...region }) {
      await stopCapture();
      const frame = await windowFrame(placementId);
      if (!frame.visible) throw new Error('玻璃取景需要先把卡片开成置顶小窗');
      const holder = { latest: null };
      holder.stop = await openCapture(frame, { ...region, y: frame.height + region.y }, jpeg => {
        holder.latest = jpeg;
        forward(jpeg);
      });
      backdrop = holder;
      return { feeding: true };
    },
    async unfeed() {
      await stopCapture();
      return { feeding: false };
    },
    backdrop() {
      return { image: backdrop?.latest ? `data:image/jpeg;base64,${backdrop.latest.toString('base64')}` : '' };
    },
    async close() {
      await stopCapture();
      await stopStreams();
    },
    async screen() {
      const { jpeg, camera } = await liveScreen();
      return { image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, camera, copied: copySequence, ...(last ? { last } : {}) };
    },
    tap: point => input('tap', point),
    text: payload => input('text', payload),
    key: payload => input('key', payload),
    longPress: payload => input('long-press', payload),
    swipe: payload => input('swipe', payload),
    scroll: payload => input('scroll', payload),
    back: () => input('key', { key: 'KEYCODE_BACK' }),
    down() {
      return record('down', async () => {
        await stopStreams();
        const stamp = now().toISOString().replaceAll(':', '-');
        await run(['down', join(logDir, `host-${stamp}.log`)]);
        target = null;
        return { stopped: true };
      });
    },
  };
}
