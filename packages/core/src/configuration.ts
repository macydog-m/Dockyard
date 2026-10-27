import {
  getConfigurationState, initialConfigurationState, resolveConfigurationValues, configurationStateSchema, configurationActionSchema,
  componentSchema, workspaceSchema, validateConfigurationTargets, type DockyardConfig, type Component, type Workspace, type ConfigurationState, type ConfigurationAction,
} from '@dockyard/shared';
import { ResourceError } from './errors.js';
import { JsonStore, recordName } from './storage.js';

// Called under the write lock before mutations. Also protects exact refs when a resource's keys change.
export async function validateComponentGraph(store: JsonStore, config: DockyardConfig, candidate?: Component): Promise<Map<string, Component>> {
  const components = new Map<string, Component>();
  for (const id of config.componentIds) {
    const component = id === candidate?.id ? candidate : (await store.read(recordName('components', id), componentSchema)).value;
    if (component.id !== id) throw new ResourceError('CONFIG_INVALID', 'Component ID and filename disagree.');
    components.set(id, component);
  }
  if (candidate) components.set(candidate.id, candidate);
  try {
    for (const component of components.values()) if (component.type === 'configuration') validateConfigurationTargets(component, components);
    for (const id of config.workspaceIds) {
      const workspace = (await store.read(recordName('workspaces', id), workspaceSchema)).value;
      for (const [componentId, state] of Object.entries(workspace.configurations ?? {})) {
        const definition = components.get(componentId);
        if (definition?.type !== 'configuration') continue;
        for (const preset of state.presets) if (preset.items) validateConfigurationTargets({ ...definition, items: preset.items }, components);
      }
    }
  } catch (error) { throw new ResourceError('CONFIG_INVALID', (error as Error).message); }
  return components;
}

export type ConfigurationComponent = Extract<Component, { type: 'configuration' }>;
export function validateConfigurationState(component: ConfigurationComponent, state: ConfigurationState): void {
  try {
    configurationStateSchema.parse(state);
    for (const preset of state.presets) resolveConfigurationValues(preset.items ?? component.items, preset.values);
  } catch { throw new ResourceError('CONFIG_INVALID', 'Configuration presets do not match the component definition.'); }
}
export function currentConfiguration(component: ConfigurationComponent, workspace?: Workspace) {
  const state = getConfigurationState(workspace?.configurations, component.id) ?? initialConfigurationState();
  validateConfigurationState(component, state);
  const preset = state.presets.find(preset => preset.id === state.activePresetId)!;
  const items = preset.items ?? component.items;
  return { preset: { id: preset.id, name: preset.name }, items, values: resolveConfigurationValues(items, preset.values) };
}
export function changeConfiguration(component: ConfigurationComponent, existing: ConfigurationState | undefined, input: ConfigurationAction): ConfigurationState {
  const parsed = configurationActionSchema.safeParse(input);
  if (!parsed.success) throw new ResourceError('CONFIG_INVALID', 'Invalid configuration operation.');
  const action = parsed.data;
  const state = structuredClone(existing ?? initialConfigurationState());
  validateConfigurationState(component, state);
  if (action.type === 'createPreset') {
    const source = action.copyFrom ? state.presets.find(preset => preset.id === action.copyFrom) : undefined;
    if (action.copyFrom && !source) throw new ResourceError('NOT_FOUND', 'Source preset not found.');
    state.presets.push({ id: action.id, name: action.name, values: source ? { ...source.values } : {},
      ...(source ? { items: structuredClone(source.items ?? component.items) } : action.items ? { items: action.items } : {}) });
    state.activePresetId = action.id;
  } else {
    const id = action.type === 'saveValues' ? action.presetId : action.id;
    const preset = state.presets.find(preset => preset.id === id);
    if (!preset) throw new ResourceError('NOT_FOUND', 'Preset not found.');
    if (action.type === 'saveValues') {
      try { preset.values = resolveConfigurationValues(preset.items ?? component.items, action.values); }
      catch { throw new ResourceError('CONFIG_INVALID', 'Invalid configuration type, range, step or option.'); }
    } else if (action.type === 'saveItems') {
      preset.items = action.items;
      const keys = new Set(action.items.map(item => item.key));
      preset.values = Object.fromEntries(Object.entries(preset.values).filter(([key]) => keys.has(key)));
    } else if (action.type === 'switchPreset') state.activePresetId = id;
    else if (action.type === 'renamePreset') preset.name = action.name;
    else {
      if (state.presets.length === 1) throw new ResourceError('CONFIG_INVALID', 'Keep at least one preset.');
      state.presets = state.presets.filter(preset => preset.id !== id);
      if (state.activePresetId === id) state.activePresetId = state.presets[0].id;
    }
  }
  validateConfigurationState(component, state);
  return state;
}
