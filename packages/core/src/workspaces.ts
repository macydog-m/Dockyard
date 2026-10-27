import { setTimeout as delay } from 'node:timers/promises';
import { configSchema, workspaceSchema, configIdSchema, componentSchema, designDefaultsSchema, type DesignDefaults, type Workspace, type DockyardConfig } from '@dockyard/shared';
import { JsonStore, recordName } from './storage.js';
import { readConfig, verifyWorkspace } from './config.js';
import { ResourceError } from './errors.js';
import { changeConfiguration, validateConfigurationState, validateComponentGraph } from './configuration.js';
import { getConfigurationState, validateConfigurationTargets, type ConfigurationAction } from '@dockyard/shared';

function parseWorkspace(input: unknown): Workspace {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) throw new ResourceError('CONFIG_INVALID', 'Invalid workspace configuration.');
  return parsed.data;
}
function validateId(id: string) {
  if (!configIdSchema.safeParse(id).success) throw new ResourceError('CONFIG_INVALID', 'Invalid workspace ID.');
}

export class WorkspaceService {
  constructor(private readonly store: JsonStore) {}

  async updateConfiguration(id: string, componentId: string, expectedRevision: number, definitionRevision: number, action: ConfigurationAction): Promise<Workspace> {
    validateId(id); validateId(componentId);
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const workspace = await this.registered(config, id);
      if (workspace.revision !== expectedRevision) throw new ResourceError('DATA_BUSY', 'Workspace changed; reload before editing configuration.');
      if (!workspace.componentIds.includes(componentId) || workspace.disabledComponentIds?.includes(componentId)) {
        throw new ResourceError('NOT_FOUND', 'Configuration component is not enabled in this workspace.');
      }
      const component = (await this.store.read(recordName('components', componentId), componentSchema)).value;
      if (component.id !== componentId || component.type !== 'configuration' || !component.enabled) throw new ResourceError('CONFIG_INVALID', 'Invalid configuration component.');
      if (component.revision !== definitionRevision) throw new ResourceError('DATA_BUSY', 'Configuration definition changed; reload before editing.');
      const components = await validateComponentGraph(this.store, config);
      const state = changeConfiguration(component, getConfigurationState(workspace.configurations, componentId), action);
      try {
        for (const preset of state.presets) validateConfigurationTargets({ ...component, items: preset.items ?? component.items }, components);
      } catch (error) { throw new ResourceError('CONFIG_INVALID', (error as Error).message); }
      return this.store.write(recordName('workspaces', id), workspaceSchema, {
        ...workspace, revision: workspace.revision + 1, configurations: { ...workspace.configurations, [componentId]: state },
      });
    });
  }

  private async verifyConfiguration(workspace: Workspace) {
    const config = (await readConfig(this.store)).value;
    const components = new Map();
    for (const id of config.componentIds) components.set(id, (await this.store.read(recordName('components', id), componentSchema)).value);
    for (const [id, state] of Object.entries(workspace.configurations ?? {})) {
      const component = (await this.store.read(recordName('components', id), componentSchema)).value;
      if (component.id !== id || component.type !== 'configuration') throw new ResourceError('CONFIG_INVALID', 'Invalid configuration component reference.');
      validateConfigurationState(component, state);
      try {
        for (const preset of state.presets) validateConfigurationTargets({ ...component, items: preset.items ?? component.items }, components);
      } catch (error) { throw new ResourceError('CONFIG_INVALID', (error as Error).message); }
    }
  }

  private async registered(config: DockyardConfig, id: string, verifyReferences = true): Promise<Workspace> {
    validateId(id);
    if (!config.workspaceIds.includes(id)) throw new ResourceError('NOT_FOUND', 'Workspace is not registered.');
    const workspace = (await this.store.read(recordName('workspaces', id), workspaceSchema)).value;
    if (workspace.id !== id) throw new ResourceError('CONFIG_INVALID', 'Workspace ID and filename disagree.');
    if (verifyReferences) verifyWorkspace(config, workspace);
    return workspace;
  }

  private async verifyDesign(workspace: Workspace) {
    for (const [slot, id] of Object.entries(workspace.design ?? {})) {
      if (!id) continue;
      const component = (await this.store.read(recordName('components', id), componentSchema)).value;
      if (component.id !== id || !component.enabled || (slot === 'paletteId'
        ? component.type !== 'palette' || component.mode !== 'design' : component.type !== 'font')) {
        throw new ResourceError('CONFIG_INVALID', 'Default design schemes must be enabled components of the correct type.');
      }
    }
  }

  async setDesign(id: string, input: DesignDefaults): Promise<Workspace> {
    validateId(id);
    const design = designDefaultsSchema.safeParse(input);
    if (!design.success) throw new ResourceError('CONFIG_INVALID', 'Invalid design defaults.');
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const current = await this.registered(config, id);
      const componentIds = [...new Set([...current.componentIds, ...Object.values(design.data).filter((value): value is string => !!value)])];
      const next = parseWorkspace({ ...current, componentIds, design: design.data, revision: current.revision + 1,
        ...(current.disabledComponentIds ? { disabledComponentIds: current.disabledComponentIds.filter(value => !Object.entries(design.data).some(([slot, id]) => id === value && current.design?.[slot as keyof DesignDefaults] !== id)) } : {}),
      });
      verifyWorkspace(config, next);
      await this.verifyDesign(next);
      return this.store.write(recordName('workspaces', id), workspaceSchema, next);
    });
  }

  async save(input: unknown, createOnly = false): Promise<Workspace> {
    const candidate = parseWorkspace(input);
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      if ([...candidate.componentIds, ...Object.keys(candidate.configurations ?? {})].some(id => !config.componentIds.includes(id))) {
        throw new ResourceError('CONFIG_INVALID', 'Workspace contains an unregistered component.');
      }
      await this.verifyDesign(candidate);
      await this.verifyConfiguration(candidate);
      await validateComponentGraph(this.store, config);
      const registered = config.workspaceIds.includes(candidate.id);
      if (createOnly && registered) throw new ResourceError('CONFIG_INVALID', 'Workspace ID already exists; rename or edit it explicitly.');
      const existing = registered ? await this.registered(config, candidate.id, false) : undefined;
      const parsedConfig = configSchema.safeParse({
        ...config, revision: config.revision + 1,
        workspaceIds: registered ? config.workspaceIds : [...config.workspaceIds, candidate.id],
      });
      if (!parsedConfig.success) throw new ResourceError('CONFIG_INVALID', 'Workspace limit exceeded or invalid manifest.');
      const saved = await this.store.write(recordName('workspaces', candidate.id), workspaceSchema, {
        ...candidate, revision: (existing?.revision ?? 0) + 1,
      });
      if (!registered) await this.store.write('config.json', configSchema, parsedConfig.data);
      return saved;
    });
  }

  async rename(id: string, name: string): Promise<Workspace> {
    validateId(id);
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const workspace = await this.registered(config, id);
      const next = parseWorkspace({ ...workspace, name, revision: workspace.revision + 1 });
      return this.store.write(recordName('workspaces', id), workspaceSchema, next);
    });
  }

  // Omitting id selects the active workspace inside the same write lock.
  async setComponents(componentIds: string[], id?: string): Promise<Workspace> {
    if (id !== undefined) validateId(id);
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const current = await this.registered(config, id ?? config.activeWorkspaceId, false);
      const design = Object.fromEntries(Object.entries(current.design ?? {}).filter(([, value]) => value && componentIds.includes(value)));
      const next = parseWorkspace({ ...current, ...(current.design ? { design } : {}), revision: current.revision + 1, componentIds,
        ...(current.disabledComponentIds ? { disabledComponentIds: current.disabledComponentIds.filter(value => componentIds.includes(value)) } : {}),
      });
      verifyWorkspace(config, next);
      return this.store.write(recordName('workspaces', next.id), workspaceSchema, next);
    });
  }

  async setComponentEnabled(id: string, componentId: string, enabled: boolean): Promise<Workspace> {
    validateId(id);
    validateId(componentId);
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const current = await this.registered(config, id);
      if (!current.componentIds.includes(componentId)) throw new ResourceError('NOT_FOUND', 'Component does not belong to this workspace.');
      const disabled = new Set(current.disabledComponentIds);
      enabled ? disabled.delete(componentId) : disabled.add(componentId);
      if (disabled.size === (current.disabledComponentIds?.length ?? 0)) return current;
      return this.store.write(recordName('workspaces', id), workspaceSchema, {
        ...current, revision: current.revision + 1, disabledComponentIds: [...disabled],
      });
    });
  }

  async setActive(id: string): Promise<DockyardConfig> {
    validateId(id);
    return this.store.withWrite(async () => {
      const config = (await readConfig(this.store)).value;
      const workspace = await this.registered(config, id);
      // Reject dangling or corrupt records before switching the shared active workspace.
      await validateComponentGraph(this.store, config);
      await this.verifyConfiguration(workspace);
      for (const componentId of workspace.componentIds) {
        const component = (await this.store.read(recordName('components', componentId), componentSchema)).value;
        if (component.id !== componentId) throw new ResourceError('CONFIG_INVALID', 'Component ID and filename disagree.');
      }
      if (config.activeWorkspaceId === id) return config;
      return this.store.write('config.json', configSchema, { ...config, revision: config.revision + 1, activeWorkspaceId: id });
    });
  }

  async list(): Promise<{ activeWorkspaceId: string; workspaces: Workspace[] }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await this.store.isWriting()) { await delay(10); continue; }
      try {
        const config = await readConfig(this.store);
        const records = [];
        for (const id of config.value.workspaceIds) {
          const name = recordName('workspaces', id);
          const record = await this.store.read(name, workspaceSchema);
          if (record.value.id !== id) throw new ResourceError('CONFIG_INVALID', 'Workspace ID and filename disagree.');
          verifyWorkspace(config.value, record.value);
          records.push({ name, ...record });
        }
        let unchanged = (await readConfig(this.store)).token === config.token;
        for (const record of records) {
          if ((await this.store.read(record.name, workspaceSchema)).token !== record.token) unchanged = false;
        }
        if (unchanged && !(await this.store.isWriting())) {
          return { activeWorkspaceId: config.value.activeWorkspaceId, workspaces: records.map(record => record.value) };
        }
      } catch (error) {
        if (!(await this.store.isWriting()) && !(error instanceof ResourceError && error.code === 'DATA_BUSY')) throw error;
      }
      await delay(10);
    }
    throw new ResourceError('DATA_BUSY', 'Workspace configuration is being updated; retry.');
  }
}
