import { createBridgeCli } from './bridge-cli.mjs';
import { createOwner } from './owner.mjs';
import { capabilityManifest, createCapabilityAdapter, installationId } from './capability.mjs';
import { registerWidgetLibrary } from './widget-library.mjs';

export const name = 'qrbridge';
export const inject = ['mosaicBoard'];

export async function apply(ctx, config) {
  await ctx.effect(async () => {
    const owner = createOwner({ run: createBridgeCli(config), logDir: config.logDir });
    const resources = new AsyncDisposableStack();
    try {
      const capability = ctx.mosaicBoard.registerCapability({
        id: installationId, manifest: capabilityManifest, config: {}, installedAt: new Date().toISOString(),
      }, createCapabilityAdapter(owner), { actionsWithoutDataDelivery: ['qrbridge.up', 'qrbridge.down'] });
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
