export function createController(bridge, { onSnapshot, onBusy, onError }) {
  let pending = null;

  async function refresh() {
    onSnapshot(await bridge.requestReadIntent('qrbridge.status', {}));
  }

  function act(name, payload) {
    if (pending) return pending.done;
    pending = { ...Promise.withResolvers(), running: false };
    pending.done = pending.promise.finally(async () => {
      pending = null;
      onBusy(false);
      await refresh();
    });
    onBusy(true);
    bridge.emitIntent(name, payload);
    return pending.done;
  }

  const unsubscribe = [
    bridge.onStatusChange(status => {
      if (!pending) return;
      if (status === 'running') pending.running = true;
      else if (pending.running && (status === 'idle' || status === 'error')) pending.resolve();
    }),
    bridge.onVisibilityChange(visible => { if (visible) refresh().catch(onError); }),
  ];

  return {
    refresh,
    up: name => act('qrbridge.up', { package: name }),
    down: () => act('qrbridge.down', {}),
    scan: viewfinder => act('qrbridge.scan', viewfinder),
    screen: () => bridge.requestReadIntent('qrbridge.screen', {}),
    tap: point => act('qrbridge.tap', point),
    back: () => act('qrbridge.back', {}),
    dispose() { unsubscribe.forEach(remove => remove()); },
  };
}
