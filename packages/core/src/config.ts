import { setTimeout as delay } from 'node:timers/promises';
import { configIdSchema, configSchema, workspaceSchema, componentSchema, type DockyardConfig, type Workspace, type Component } from '@dockyard/shared';
import { JsonStore, recordName } from './storage.js';
import { ResourceError } from './errors.js';
import { getConfigurationState, configurationTargets, configurationVisibility, validateConfigurationTargets, type ResourceVisibility } from '@dockyard/shared';
import { validateConfigurationState } from './configuration.js';

export async function readConfig(store: JsonStore) {
  if (!(await store.exists('config.json'))) {
    if (await store.exists('assets')) throw new ResourceError('LEGACY_DATA', 'Legacy assets data detected. Use scripts/dockyard.mjs migrate with a new destination; source data will not be changed.');
    throw new ResourceError('DATA_UNAVAILABLE', 'Dockyard is not initialized. Use scripts/dockyard.mjs init.');
  }
  return store.read('config.json', configSchema);
}

export function verifyWorkspace(config: DockyardConfig, workspace: Workspace): void {
  if (!config.workspaceIds.includes(workspace.id) || [...workspace.componentIds, ...Object.keys(workspace.configurations ?? {})].some(id => !config.componentIds.includes(id))) {
    throw new ResourceError('CONFIG_INVALID', 'Workspace refers to an unregistered component or workspace.');
  }
}

export type ActiveSnapshot = { config: DockyardConfig; workspace: Workspace; components: Component[]; visibility: ResourceVisibility };

export async function loadActiveSnapshot(store: JsonStore, workspaceId?: string): Promise<ActiveSnapshot> {
  if (workspaceId !== undefined && !configIdSchema.safeParse(workspaceId).success) {
    throw new ResourceError('CONFIG_INVALID', 'Invalid bound workspace ID.');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await store.isWriting()) { await delay(10); continue; }
    try {
      const configRecord = await readConfig(store);
      const config = configRecord.value;
      const selectedId = workspaceId ?? config.activeWorkspaceId;
      if (!config.workspaceIds.includes(selectedId)) throw new ResourceError('NOT_FOUND', 'Bound workspace is not registered.');
      const workspaceName = recordName('workspaces', selectedId);
      const workspaceRecord = await store.read(workspaceName, workspaceSchema);
      const workspace = workspaceRecord.value;
      if (workspace.id !== selectedId) throw new ResourceError('CONFIG_INVALID', 'Workspace ID and filename disagree.');
      verifyWorkspace(config, workspace);
      const records = new Map<string, { name: string; value: Component; token: string }>();
      const readComponent = async (id: string): Promise<Component> => {
        if (records.has(id)) return records.get(id)!.value;
        if (!config.componentIds.includes(id)) throw new ResourceError('CONFIG_INVALID', 'Configuration target is not registered: ' + id);
        const name = recordName('components', id);
        const record = await store.read(name, componentSchema);
        if (record.value.id !== id) throw new ResourceError('CONFIG_INVALID', 'Component ID and filename disagree.');
        records.set(id, { name, ...record });
        return record.value;
      };
      for (const id of workspace.componentIds) {
        const component = await readComponent(id);
        const state = getConfigurationState(workspace.configurations, id);
        if (state) {
          if (component.type !== 'configuration') throw new ResourceError('CONFIG_INVALID', 'Configuration state refers to a different component type.');
          validateConfigurationState(component, state);
        }
        if (component.type === 'configuration') {
          const items = [...component.items, ...(state?.presets.flatMap(preset => preset.items ?? []) ?? [])];
          for (const target of configurationTargets(items)) await readComponent(target.split('::')[0]);
          try { validateConfigurationTargets({ ...component, items }, new Map([...records].map(([id, record]) => [id, record.value]))); }
          catch (error) { throw new ResourceError('CONFIG_INVALID', (error as Error).message); }
        }
      }
      let unchanged = (await store.read('config.json', configSchema)).token === configRecord.token
        && (await store.read(workspaceName, workspaceSchema)).token === workspaceRecord.token;
      for (const record of records.values()) {
        if ((await store.read(record.name, componentSchema)).token !== record.token) unchanged = false;
      }
      if (unchanged && !(await store.isWriting())) {
        const components = [...records.values()].map(record => record.value);
        const { visible } = configurationVisibility(workspace, components);
        return { config, workspace, components: components.filter(component => visible.has(component.id)), visibility: visible };
      }
    } catch (error) {
      if (!(await store.isWriting()) && !(error instanceof ResourceError && error.code === 'DATA_BUSY')) throw error;
    }
    await delay(10);
  }
  throw new ResourceError('DATA_BUSY', 'Configuration is being updated; retry.');
}
