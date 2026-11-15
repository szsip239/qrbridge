import { readFile } from 'node:fs/promises';
import { actions, capabilityPackage, installationId } from './capability.mjs';

const plugin = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));

export async function registerWidgetLibrary(board) {
  const root = new URL('../widget/', import.meta.url);
  const paths = ['manifest.json', 'index.html', 'assets/runtime.mjs', 'assets/controller.mjs'];
  const files = await Promise.all(paths.map(async path => ({ path, bytes: [...await readFile(new URL(path, root))] })));
  const widget = JSON.parse(Buffer.from(files[0].bytes).toString());
  const manifest = { schemaVersion: 1, kind: 'widget', id: widget.id, version: widget.version, title: widget.title, description: widget.description };
  return board.registerWidgetLibrary({
    plugin: { packageName: plugin.name, version: plugin.version },
    catalog: [{ id: widget.id, version: widget.version }],
    templates: {
      async list(kind) { return kind === undefined || kind === 'widget' ? [structuredClone(manifest)] : []; },
      async read(reference) {
        return reference.kind === manifest.kind && reference.id === manifest.id && reference.version === manifest.version
          ? structuredClone({ manifest, files }) : undefined;
      },
    },
    compose({ placementId, createdAt }) {
      return {
        capabilityPackage, bindings: [],
        automations: Object.keys(actions).map(name => ({
          schemaVersion: 1, id: `automation.${name}.${placementId}`, revision: 1, title: name, enabled: true,
          trigger: { kind: 'widget_intent', placementId, name },
          action: { installationId, name, connections: {}, input: Object.fromEntries(
            Object.keys(actions[name].input.properties).map(key => [key, key === 'placementId'
              ? { kind: 'constant', value: placementId }
              : { kind: 'pointer', source: 'intent', pointer: `/${key}` }])) },
          createdAt, updatedAt: createdAt,
        })),
      };
    },
  });
}
