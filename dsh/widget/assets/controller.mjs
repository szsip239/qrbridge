const POLL_MS = 600;

export function createController(bridge, { onSnapshot, onBusy, onError, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let pending = null;
  let lastAt = null;

  async function read() {
    const snapshot = await bridge.requestReadIntent('qrbridge.status', {});
    lastAt = snapshot.last?.at ?? null;
    return snapshot;
  }

  async function refresh() {
    onSnapshot(await read());
  }

  // Host status broadcasts cover every intent of the card, the background feed included, so they cannot tell
  // when this action ended; the owner's own record can.
  async function settle(before) {
    for (;;) {
      await sleep(POLL_MS);
      const snapshot = await read();
      if (!snapshot.busy && lastAt !== before) return onSnapshot(snapshot);
    }
  }

  function act(name, payload) {
    if (pending) return pending;
    onBusy(true);
    const before = lastAt;
    bridge.emitIntent(name, payload);
    pending = settle(before).catch(onError).finally(() => {
      pending = null;
      onBusy(false);
    });
    return pending;
  }

  const unsubscribe = [
    bridge.onVisibilityChange(visible => { if (visible) refresh().catch(onError); }),
  ];

  return {
    refresh,
    open: (name, scan) => act('qrbridge.open', { package: name, scan }),
    down: () => act('qrbridge.down', {}),
    scan: viewfinder => act('qrbridge.scan', viewfinder),
    // Capture runs beside the user's actions and must not hold them up.
    feed: region => bridge.emitIntent('qrbridge.feed', region),
    unfeed: () => bridge.emitIntent('qrbridge.unfeed', {}),
    screen: () => bridge.requestReadIntent('qrbridge.screen', {}),
    backdrop: () => bridge.requestReadIntent('qrbridge.backdrop', {}),
    tap: point => bridge.emitIntent('qrbridge.tap', point),
    input: ({ command, ...payload }) => bridge.emitIntent(`qrbridge.${command}`, payload),
    back: () => bridge.emitIntent('qrbridge.back', {}),
    dispose() { unsubscribe.forEach(remove => remove()); },
  };
}
