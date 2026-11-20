import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createBridgeCli } from './bridge-cli.mjs';
import { createOwner } from './owner.mjs';
import { actions, capabilityManifest, createCapabilityAdapter, installationId } from './capability.mjs';
import { registerWidgetLibrary } from './widget-library.mjs';

export const name = 'qrbridge';
export const inject = ['mosaicBoard'];

const exec = promisify(execFile);

async function toJpeg(png) {
  const jpeg = png.replace(/\.png$/, '.jpg');
  await exec('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', png, '--out', jpeg]);
  return readFile(jpeg);
}

async function capture({ x, y, width, height }, path) {
  const region = [x, y, width, height].map(Math.round).join(',');
  await exec('/usr/sbin/screencapture', ['-x', `-R${region}`, path]);
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
    const owner = createOwner({ run: createBridgeCli(config), logDir: config.logDir, capture, windowFrame, toJpeg });
    const resources = new AsyncDisposableStack();
    try {
      const capability = ctx.mosaicBoard.registerCapability({
        id: installationId, manifest: capabilityManifest, config: {}, installedAt: new Date().toISOString(),
      }, createCapabilityAdapter(owner), { actionsWithoutDataDelivery: Object.keys(actions).filter(name => actions[name].effect === 'write') });
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
