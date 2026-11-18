import { execFile, spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { createBridgeCli } from './bridge-cli.mjs';
import { createOwner } from './owner.mjs';
import { onRecords, createMirrorOpener, createControlOpener } from './host-streams.mjs';
import { actions, capabilityManifest, createCapabilityAdapter, installationId } from './capability.mjs';
import { registerWidgetLibrary } from './widget-library.mjs';

export const name = 'qrbridge';
export const inject = ['mosaicBoard'];

const exec = promisify(execFile);

async function capture({ x, y, width, height }, path) {
  const region = [x, y, width, height].map(Math.round).join(',');
  await exec('/usr/sbin/screencapture', ['-x', `-R${region}`, path]);
}

/** Opens a long-lived connection to the phone host for one streaming command. */
function createHostLink({ serial }) {
  const adb = (...args) => exec('adb', [...(serial ? ['-s', serial] : []), ...args]);
  return async command => {
    const port = (await adb('forward', 'tcp:0', 'localabstract:android_qr_bridge')).stdout.trim();
    const socket = connect(Number(port), '127.0.0.1');
    // The forward lives as long as its socket, however the stream ends.
    const removed = once(socket, 'close').then(() => adb('forward', '--remove', `tcp:${port}`)).catch(() => {});
    const close = async () => {
      socket.destroy();
      await removed;
    };
    try {
      await once(socket, 'connect');
      socket.write(`${JSON.stringify({ command })}\n`);
      return { socket, close };
    } catch (error) {
      await close();
      throw error;
    }
  };
}

/** Streams the desktop under the card, with the card excluded, until stopped. */
function createCaptureOpener(glassFeed) {
  const rect = r => [r.x, r.y, r.width, r.height].join(',');
  return async (frame, region, onFrame) => {
    const child = spawn(glassFeed, [rect(frame), rect(region)], { stdio: ['pipe', 'pipe', 'pipe'] });
    onRecords(child.stdout, 0, (_, jpeg) => onFrame(jpeg));
    await new Promise((resolve, reject) => {
      let errors = '';
      child.stderr.on('data', chunk => {
        errors += chunk;
        if (errors.includes('FEEDING')) resolve();
      });
      child.on('exit', () => reject(new Error(errors.trim() || '取景程序退出')));
    });
    return async () => { child.kill(); };
  };
}

function createFeedOpener(link) {
  return async onClose => {
    const { socket, close } = await link('feed');
    socket.on('close', onClose);
    const length = Buffer.alloc(4);
    return {
      write(jpeg) {
        length.writeUInt32BE(jpeg.length);
        socket.write(Buffer.from(length));
        socket.write(jpeg);
      },
      close,
    };
  };
}

function writeClipboard(text) {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/pbcopy', error => error ? reject(error) : resolve());
    child.stdin.end(text, 'utf8');
  });
}

export async function apply(ctx, config) {
  let surfaces;
  ctx.inject(['mosaicNativeSurfaces'], scope => {
    scope.effect(() => {
      surfaces = scope.mosaicNativeSurfaces;
      return () => { surfaces = undefined; };
    }, 'qrbridge: Widget Window frames');
  });
  const windowFrame = placementId => {
    if (!surfaces) throw new Error('没有原生小窗服务，需要 @mosaic/dsh-native-probe');
    return surfaces.widgetWindowFrame(placementId);
  };
  await ctx.effect(async () => {
    const link = createHostLink(config);
    // Failed actions stay on disk for review; the card only shows them for a few seconds.
    const logFailure = entry => appendFile(join(config.logDir, 'failures.log'), `${JSON.stringify(entry)}\n`);
    const owner = createOwner({ run: createBridgeCli(config), logDir: config.logDir, logFailure, capture, windowFrame,
      openCapture: createCaptureOpener(config.glassFeed), openFeed: createFeedOpener(link), openMirror: createMirrorOpener(link),
      openControl: createControlOpener(link), writeClipboard });
    const resources = new AsyncDisposableStack();
    try {
      const capability = ctx.mosaicBoard.registerCapability({
        id: installationId, manifest: capabilityManifest, config: {}, installedAt: new Date().toISOString(),
      }, createCapabilityAdapter(owner), { actionsWithoutDataDelivery: Object.keys(actions).filter(name => actions[name].effect === 'write') });
      resources.defer(() => owner.close());
      resources.defer(() => capability.dispose());
      const library = await registerWidgetLibrary(ctx.mosaicBoard);
      resources.defer(() => library.dispose());
      return () => resources.disposeAsync();
    } catch (error) {
      await resources.disposeAsync();
      throw error;
    }
  }, 'qrbridge: bridge owner');
}
