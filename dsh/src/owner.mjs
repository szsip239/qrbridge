import { join } from 'node:path';

export const targets = {
  'com.tencent.mm': '微信',
  'com.eg.android.AlipayGphone': '支付宝',
};

export function createOwner({ run, logDir, now = () => new Date() }) {
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
