import { useRef, useState } from 'react';
import { getConfigurationState, initialConfigurationState, resolveConfigurationValues,
  type ConfigurationComponent, type ConfigurationValues, type Workspace } from '@dockyard/shared';
import { t } from '../i18n';
import type { Reply } from '../contracts';

type Draft = {
  workspaceId: string; component: ConfigurationComponent; presetId: string;
  baseline: ConfigurationValues; values: ConfigurationValues; error?: string;
};
const draftKey = (workspaceId: string, componentId: string, presetId: string) => JSON.stringify([workspaceId, componentId, presetId]);
function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

// Lives above the panels so changing component, preset or workspace never drops a pending edit.
export function useConfigurationAutosave(reload: () => Promise<unknown>) {
  const drafts = useRef(new Map<string, Draft>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flight = useRef<Promise<void> | undefined>(undefined);
  const [, render] = useState(0);
  const refresh = () => render(value => value + 1);

  async function drain() {
    for (;;) {
      const entry = [...drafts.current].find(([, draft]) => {
        if (draft.error) return false;
        try { resolveConfigurationValues(draft.component.items, draft.values); return true; } catch { return false; }
      });
      if (!entry) break;
      const [key, draft] = entry;
      const values = { ...draft.values };
      try {
        const latest = unwrap(await window.dockyard.state());
        const workspace = latest.workspaces.find(value => value.id === draft.workspaceId);
        const component = latest.components.find(value => value.component.id === draft.component.id)?.component;
        const preset = workspace && (getConfigurationState(workspace.configurations, draft.component.id) ?? initialConfigurationState()).presets.find(value => value.id === draft.presetId);
        if (!workspace || !preset || component?.type !== 'configuration' || component.revision !== draft.component.revision) throw new Error(t('配置已变化，草稿已保留。请撤销后重新编辑。'));
        const items = preset.items ?? component.items;
        if (JSON.stringify(items) !== JSON.stringify(draft.component.items)) throw new Error(t('配置已变化，草稿已保留。请撤销后重新编辑。'));
        const saved = resolveConfigurationValues(items, preset.values);
        const changes = Object.keys(values).filter(key => values[key] !== draft.baseline[key]);
        if (changes.some(key => saved[key] !== draft.baseline[key])) throw new Error(t('配置已变化，草稿已保留。请撤销后重新编辑。'));
        const merged = { ...saved, ...Object.fromEntries(changes.map(key => [key, values[key]])) };
        unwrap(await window.dockyard.updateConfiguration(workspace.id, component.id, workspace.revision, component.revision,
          { type: 'saveValues', presetId: preset.id, values: merged }));
        // Input may have advanced while IPC was running. Keep the newer values queued.
        const current = drafts.current.get(key);
        if (current) {
          drafts.current.set(key, { ...current, baseline: merged, values: {
            ...merged, ...Object.fromEntries(Object.keys(current.values).filter(key => current.values[key] !== values[key]).map(key => [key, current.values[key]])),
          } });
        }
        await reload();
        const refreshed = drafts.current.get(key);
        if (refreshed && JSON.stringify(refreshed.values) === JSON.stringify(refreshed.baseline)) drafts.current.delete(key);
      } catch (error) {
        const current = drafts.current.get(key);
        if (current) drafts.current.set(key, { ...current, error: (error as Error).message });
        await reload().catch(() => {});
      }
      refresh();
    }
  }
  async function flush() {
    clearTimeout(timer.current);
    if (!flight.current) flight.current = drain().finally(() => { flight.current = undefined; });
    await flight.current;
  }
  function change(workspace: Workspace, component: ConfigurationComponent, presetId: string, baseline: ConfigurationValues, key: string, value: ConfigurationValues[string]) {
    const id = draftKey(workspace.id, component.id, presetId);
    const previous = drafts.current.get(id);
    drafts.current.set(id, { workspaceId: workspace.id, component, presetId, baseline: previous?.baseline ?? baseline,
      values: { ...(previous?.values ?? baseline), [key]: value }, error: previous?.error });
    refresh();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 250);
  }
  function discard(workspaceId: string, componentId: string, presetId: string) {
    drafts.current.delete(draftKey(workspaceId, componentId, presetId)); refresh();
  }
  function retry(workspaceId: string, componentId: string, presetId: string) {
    const key = draftKey(workspaceId, componentId, presetId), draft = drafts.current.get(key);
    if (draft) drafts.current.set(key, { ...draft, error: undefined });
    refresh(); void flush();
  }
  return { change, flush, discard, retry,
    draft: (workspaceId: string, componentId: string, presetId: string) => drafts.current.get(draftKey(workspaceId, componentId, presetId)),
  };
}
export type ConfigurationAutosave = ReturnType<typeof useConfigurationAutosave>;
