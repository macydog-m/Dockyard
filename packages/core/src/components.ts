import type { ScanProgress } from './scanner.js';
import path from 'node:path';
import { WorkspaceService } from './workspaces.js';
import { refreshFolder } from './folder-index.js';
import {
  componentSchema, configSchema, workspaceSchema, configIdSchema,
  configurationComponentSchema, type Component, type Workspace, type DesignDefaults,
} from '@dockyard/shared';
import { JsonStore, recordName, MAX_JSON_BYTES } from './storage.js';
import { readConfig, verifyWorkspace } from './config.js';
import { ResourceError } from './errors.js';
import { validateConfigurationState, validateComponentGraph } from './configuration.js';
import { configurationTargets, getConfigurationState, type ConfigurationAction } from '@dockyard/shared';

function parse<T>(schema: { parse(value: unknown): T }, input: unknown): T {
  try { return schema.parse(input); }
  catch { throw new ResourceError('CONFIG_INVALID', 'Invalid component or workspace configuration.'); }
}

export class DockyardManager {
  readonly store: JsonStore;
  private readonly workspaces: WorkspaceService;
  constructor(dataDir?: string) {
    this.store = new JsonStore(dataDir);
    this.workspaces = new WorkspaceService(this.store);
  }

  async initialize() {
    return this.store.withWrite(async () => {
      if (await this.store.exists('config.json')) return (await readConfig(this.store)).value;
      if (await this.store.exists('assets')) {
        throw new ResourceError('LEGACY_DATA', 'Migrate legacy assets to a new directory; initialize will not rewrite them.');
      }
      await this.store.write(recordName('workspaces', 'default'), workspaceSchema, {
        schemaVersion: 1, revision: 1, id: 'default', name: 'Default', componentIds: [],
      });
      return this.store.write('config.json', configSchema, {
        schemaVersion: 1, revision: 1, activeWorkspaceId: 'default', workspaceIds: ['default'], componentIds: [],
      });
    });
  }

  async saveComponent(input: unknown, onProgress?: (progress: ScanProgress) => void): Promise<Component> {
    const candidate = parse(componentSchema, input);
    const result = await this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const name = recordName('components', candidate.id);
      const registered = config.componentIds.includes(candidate.id);
      const existing = registered ? (await this.store.read(name, componentSchema)).value : undefined;
      if (existing && existing.id !== candidate.id) throw new ResourceError('CONFIG_INVALID', 'Component ID and filename disagree.');
      if (existing?.type === 'configuration' && existing.revision !== candidate.revision) throw new ResourceError('DATA_BUSY', 'Configuration definition changed; reload before editing.');
      const nextConfig = parse(configSchema, {
        ...config, revision: config.revision + 1, componentIds: registered ? config.componentIds : [...config.componentIds, candidate.id],
      });
      const component = {
        ...candidate, revision: (existing?.revision ?? 0) + 1,
        ...(candidate.type === 'font' ? { entries: candidate.entries.map(entry => ({
          ...entry, source: entry.source.type === 'file' ? { ...entry.source, path: path.resolve(this.store.dataDir, entry.source.path) } : entry.source,
        })) } : {}),
        ...(candidate.type === 'file' || candidate.type === 'folder'
          ? { source: { path: path.resolve(this.store.dataDir, candidate.source.path) } } : {}),
      };
      try {
        if (Buffer.byteLength(JSON.stringify(componentSchema.parse(component), null, 2) + '\n', 'utf8') > MAX_JSON_BYTES) {
          throw new Error('Record limit exceeded.');
        }
      } catch { throw new ResourceError('CONFIG_INVALID', 'Configuration cannot be serialized or exceeds its size limit.'); }
      await validateComponentGraph(this.store, config, candidate);
      // Validate all workspaces first. Removing an item deliberately removes just that item's
      // saved values; changes to the remaining types, ranges and options must stay compatible.
      const workspaceUpdates: Workspace[] = [];
      for (const workspaceId of config.workspaceIds) {
        const workspace = (await this.store.read(recordName('workspaces', workspaceId), workspaceSchema)).value;
        if (workspace.id !== workspaceId) throw new ResourceError('CONFIG_INVALID', 'Workspace ID and filename disagree.');
        let configurations = workspace.configurations;
        const state = getConfigurationState(workspace.configurations, candidate.id);
        if (state) {
          if (candidate.type !== 'configuration') throw new ResourceError('CONFIG_INVALID', 'Component has saved configuration presets.');
          const keys = new Set(candidate.items.map(item => item.key));
          const nextState = { ...state, presets: state.presets.map(preset => ({ ...preset,
            values: preset.items ? preset.values : Object.fromEntries(Object.entries(preset.values).filter(([key]) => keys.has(key))),
          })) };
          validateConfigurationState(candidate, nextState);
          configurations = { ...configurations, [candidate.id]: nextState };
        }
        const design = { ...workspace.design };
        if (design.paletteId === component.id && (!component.enabled || component.type !== 'palette' || component.mode !== 'design')) delete design.paletteId;
        if (design.fontId === component.id && (!component.enabled || component.type !== 'font')) delete design.fontId;
        if (JSON.stringify(design) !== JSON.stringify(workspace.design ?? {}) || JSON.stringify(configurations) !== JSON.stringify(workspace.configurations)) {
          workspaceUpdates.push(parse(workspaceSchema, { ...workspace, ...(workspace.design ? { design } : {}),
            ...(configurations ? { configurations } : {}), revision: workspace.revision + 1 }));
        }
      }
      for (const workspace of workspaceUpdates) await this.store.write(recordName('workspaces', workspace.id), workspaceSchema, workspace);
      const saved = await this.store.write(name, componentSchema, component);
      if (!registered) await this.store.write('config.json', configSchema, nextConfig);
      return {
        saved, scan: saved.type === 'folder' && (!existing || existing.type !== 'folder'
          || existing.source.path !== saved.source.path),
      };
    });
    if (result.scan) {
      const index = await this.refresh(result.saved.id, onProgress);
      if (index.lastRefresh.status === 'failed') {
        throw new ResourceError('INDEX_REFRESH_FAILED', 'Component was saved, but its initial index failed. Fix the source and refresh.', {
          componentId: result.saved.id, report: index.lastRefresh,
        });
      }
    }
    return result.saved;
  }

  async refresh(componentId: string, onProgress?: (progress: ScanProgress) => void) { return refreshFolder(this.store, componentId, onProgress); }

  async listComponents(): Promise<Component[]> {
    // Management reads all registered components, independently of the active workspace.
    const config = await readConfig(this.store);
    if (await this.store.isWriting()) throw new ResourceError('DATA_BUSY', 'Configuration is being updated; retry.');
    const records = [];
    for (const id of config.value.componentIds) {
      const name = recordName('components', id);
      const record = await this.store.read(name, componentSchema);
      if (record.value.id !== id) throw new ResourceError('CONFIG_INVALID', 'Component ID and filename disagree.');
      records.push({ name, ...record });
    }
    if ((await readConfig(this.store)).token !== config.token) throw new ResourceError('DATA_BUSY', 'Configuration changed; retry.');
    for (const record of records) {
      if ((await this.store.read(record.name, componentSchema)).token !== record.token) throw new ResourceError('DATA_BUSY', 'Component changed; retry.');
    }
    if (await this.store.isWriting()) throw new ResourceError('DATA_BUSY', 'Configuration is being updated; retry.');
    return records.map(record => record.value);
  }

  async saveWorkspace(input: unknown): Promise<Workspace> { return this.workspaces.save(input); }
  async createWorkspace(input: unknown): Promise<Workspace> { return this.workspaces.save(input, true); }
  async renameWorkspace(id: string, name: string): Promise<Workspace> { return this.workspaces.rename(id, name); }
  async listWorkspaces() { return this.workspaces.list(); }
  async setWorkspaceComponents(id: string, componentIds: string[]): Promise<Workspace> {
    return this.workspaces.setComponents(componentIds, id);
  }
  async setActiveWorkspaceComponents(componentIds: string[]): Promise<Workspace> {
    return this.workspaces.setComponents(componentIds);
  }
  async setWorkspaceDesign(id: string, design: DesignDefaults): Promise<Workspace> { return this.workspaces.setDesign(id, design); }
  async setWorkspaceComponentEnabled(id: string, componentId: string, enabled: boolean): Promise<Workspace> {
    return this.workspaces.setComponentEnabled(id, componentId, enabled);
  }
  async setActiveWorkspace(id: string) { return this.workspaces.setActive(id); }
  async updateConfiguration(id: string, componentId: string, expectedRevision: number, definitionRevision: number, action: ConfigurationAction): Promise<Workspace> {
    return this.workspaces.updateConfiguration(id, componentId, expectedRevision, definitionRevision, action);
  }

  async importConfiguration(workspaceId: string, expectedRevision: number, input: unknown): Promise<Component> {
    const component = parse(configurationComponentSchema, input);
    if (!configIdSchema.safeParse(workspaceId).success) throw new ResourceError('CONFIG_INVALID', 'Invalid workspace ID.');
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      if (!config.workspaceIds.includes(workspaceId)) throw new ResourceError('NOT_FOUND', 'Workspace not found.');
      if (config.componentIds.includes(component.id)) throw new ResourceError('CONFIG_INVALID', 'Component ID already exists. Use a new ID or enable the existing component from the library.');
      const workspace = (await this.store.read(recordName('workspaces', workspaceId), workspaceSchema)).value;
      if (workspace.id !== workspaceId) throw new ResourceError('CONFIG_INVALID', 'Workspace ID and filename disagree.');
      verifyWorkspace(config, workspace);
      if (workspace.revision !== expectedRevision) throw new ResourceError('DATA_BUSY', 'Workspace changed; reload before importing.');
      await validateComponentGraph(this.store, config, component);
      const nextConfig = parse(configSchema, { ...config, revision: config.revision + 1, componentIds: [...config.componentIds, component.id] });
      const nextWorkspace = parse(workspaceSchema, { ...workspace, revision: workspace.revision + 1, componentIds: [...workspace.componentIds, component.id] });
      const saved = await this.store.write(recordName('components', component.id), configurationComponentSchema, { ...component, enabled: true, revision: 1 });
      await this.store.write('config.json', configSchema, nextConfig);
      await this.store.write(recordName('workspaces', workspaceId), workspaceSchema, nextWorkspace);
      return saved;
    });
  }

  async removeComponent(id: string): Promise<void> {
    if (!configIdSchema.safeParse(id).success) throw new ResourceError('CONFIG_INVALID', 'Invalid component ID.');
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      if (!config.componentIds.includes(id)) throw new ResourceError('NOT_FOUND', 'Component is not registered.');
      for (const componentId of config.componentIds) {
        if (componentId === id) continue;
        const component = (await this.store.read(recordName('components', componentId), componentSchema)).value;
        if (component.id !== componentId) throw new ResourceError('CONFIG_INVALID', 'Component ID and filename disagree.');
        if (component.type === 'configuration' && configurationTargets(component.items).some(target => target.split('::')[0] === id)) {
          throw new ResourceError('CONFIG_INVALID', 'Remove this resource from its configurations before deleting it.', { componentId: component.id });
        }
      }
      // Validate the full edit before writing. References are removed before the manifest entry.
      const workspaces = [];
      for (const workspaceId of config.workspaceIds) {
        const name = recordName('workspaces', workspaceId);
        const workspace = (await this.store.read(name, workspaceSchema)).value;
        if (workspace.id !== workspaceId) throw new ResourceError('CONFIG_INVALID', 'Workspace ID and filename disagree.');
        verifyWorkspace(config, workspace);
        for (const [configurationId, state] of Object.entries(workspace.configurations ?? {})) {
          if (configurationId !== id && state.presets.some(preset => configurationTargets(preset.items ?? []).some(target => target.split('::')[0] === id))) {
            throw new ResourceError('CONFIG_INVALID', 'Remove this resource from its configurations before deleting it.', { componentId: configurationId });
          }
        }
        workspaces.push(workspace);
      }
      for (const workspace of workspaces.filter(value => value.componentIds.includes(id) || Object.hasOwn(value.configurations ?? {}, id))) {
        await this.store.write(recordName('workspaces', workspace.id), workspaceSchema, {
          ...workspace, revision: workspace.revision + 1, componentIds: workspace.componentIds.filter(value => value !== id),
          ...(workspace.disabledComponentIds ? { disabledComponentIds: workspace.disabledComponentIds.filter(value => value !== id) } : {}),
          ...(workspace.design ? { design: Object.fromEntries(Object.entries(workspace.design).filter(([, value]) => value !== id)) } : {}),
          ...(workspace.configurations ? { configurations: Object.fromEntries(Object.entries(workspace.configurations).filter(([key]) => key !== id)) } : {}),
        });
      }
      await this.store.write('config.json', configSchema, {
        ...config, revision: config.revision + 1, componentIds: config.componentIds.filter(value => value !== id),
      });
      // Keep the unreferenced configuration as recoverable data; never remove source files.
    });
  }
}
