import type { Component } from './components.js';
import type { Workspace } from './config.js';
import { configurationTargets, getConfigurationState, initialConfigurationState, resolveConfigurationValues, selectedConfigurationTargets } from './configuration.js';

export type ConfigurationComponent = Extract<Component, { type: 'configuration' }>;
export type ResourceVisibility = Map<string, Set<string> | null>;

export function validateConfigurationTargets(configuration: ConfigurationComponent, components: ReadonlyMap<string, Component>): void {
  for (const target of configurationTargets(configuration.items)) {
    const [id, localRef] = target.split('::');
    const component = components.get(id);
    if (!component) throw new Error('Configuration target is not registered: ' + target);
    if (component.type === 'configuration') throw new Error('Configuration nesting is not supported: ' + target);
    if (localRef === undefined || component.type === 'folder') continue;
    const keys = component.type === 'palette' || component.type === 'font'
      ? [...component.entries.map(entry => entry.key), ...(component.type === 'font' || component.mode === 'design' ? ['$scheme'] : [])]
      : [component.key];
    if (!keys.includes(localRef)) throw new Error('Configuration target does not exist: ' + target);
  }
}

export function configurationVisibility(workspace: Workspace, components: Component[]): { managed: Set<string>; visible: ResourceVisibility } {
  const byId = new Map(components.map(component => [component.id, component]));
  const selected = workspace.componentIds.map(id => byId.get(id)).filter((component): component is Component => !!component);
  const configurations = selected.filter((component): component is ConfigurationComponent => component.type === 'configuration');
  const disabled = new Set(workspace.disabledComponentIds);
  const managed = new Set(configurations.flatMap(configuration => configurationTargets([
    ...configuration.items, ...(getConfigurationState(workspace.configurations, configuration.id)?.presets.flatMap(preset => preset.items ?? []) ?? []),
  ]).map(target => target.split('::')[0])));
  const visible: ResourceVisibility = new Map();
  const enabled = (id: string) => byId.get(id)?.enabled && !disabled.has(id);
  for (const component of selected) {
    if (enabled(component.id) && !managed.has(component.id)) visible.set(component.id, null);
  }
  for (const configuration of configurations) {
    if (!enabled(configuration.id)) continue;
    const state = getConfigurationState(workspace.configurations, configuration.id) ?? initialConfigurationState();
    const preset = state.presets.find(preset => preset.id === state.activePresetId);
    if (!preset) throw new Error('Active configuration preset does not exist.');
    const items = preset.items ?? configuration.items;
    const values = resolveConfigurationValues(items, preset.values);
    for (const target of selectedConfigurationTargets(items, values)) {
      const [id, localRef] = target.split('::');
      if (!enabled(id)) continue;
      if (localRef === undefined) visible.set(id, null);
      else if (visible.get(id) !== null) {
        const refs = visible.get(id) ?? new Set<string>();
        refs.add(target); visible.set(id, refs);
      }
    }
  }
  return { managed, visible };
}

export function isResourceVisible(visible: ResourceVisibility, ref: string): boolean {
  const [id] = ref.split('::');
  return visible.has(id) && (visible.get(id) === null || visible.get(id)!.has(ref));
}
