import type { Component, Workspace, ComponentSummary, ContextResult, IndexDiagnostic } from '@dockyard/shared';
import type { LoadedFolder } from './folder-index.js';
import { MAX_RESPONSE_BYTES, responseBytes } from './responses.js';
import { ResourceError } from './errors.js';

export type ScopedComponent = { component: Component; folder?: LoadedFolder; refs?: Set<string> };
const indexStates = {
  INDEX_NOT_READY: 'not_ready', INDEX_STALE: 'stale', INDEX_INVALID: 'invalid',
  INDEX_PARTIAL: 'partial', INDEX_REFRESH_FAILED: 'refresh_failed',
} as const;

export function summarizeContext(workspace: Workspace, scoped: ScopedComponent[], diagnostics: IndexDiagnostic[]): ContextResult {
  const summaries: ComponentSummary[] = scoped.slice(0, 50).map(({ component, folder, refs }) => {
    const description = component.description === undefined ? undefined : Array.from(component.description);
    const snapshot = folder?.index?.snapshot;
    return {
      id: component.id, type: component.type, name: component.name,
      ...(description ? { description: description.slice(0, 256).join('') } : {}),
      descriptionTruncated: (description?.length ?? 0) > 256,
      ...(component.type === 'configuration' ? { currentRef: component.id + '::$current' } : {}),
      resourceCount: component.type === 'folder' ? (snapshot ? snapshot.entries.filter(entry => !refs || refs.has(component.id + '::' + entry.relativePath)).length : null)
        : refs ? refs.size
          : component.type === 'palette' || component.type === 'font' ? component.entries.length : 1,
      ...((!refs || refs.has(component.id + '::$scheme')) && (component.type === 'font' || (component.type === 'palette' && component.mode === 'design')) ? { schemeRef: component.id + '::$scheme' } : {}),
      ...(component.type === 'folder' ? { index: {
        status: folder?.diagnostic ? indexStates[folder.diagnostic.code] : 'ready',
        ...(snapshot ? { builtAt: snapshot.builtAt, snapshotStatus: snapshot.status } : {}),
        ...(folder?.index ? { lastRefreshAt: folder.index.lastRefresh.attemptedAt } : {}),
      } } : {}),
    };
  });
  const result: ContextResult = {
    workspace: { id: workspace.id, name: workspace.name, revision: workspace.revision,
      ...(workspace.design ? { design: {
        ...(scoped.some(({ component, refs }) => component.id === workspace.design?.paletteId && component.type === 'palette' && component.mode === 'design' && (!refs || refs.has(component.id + '::$scheme'))) ? { paletteRef: workspace.design.paletteId + '::$scheme' } : {}),
        ...(scoped.some(({ component, refs }) => component.id === workspace.design?.fontId && component.type === 'font' && (!refs || refs.has(component.id + '::$scheme'))) ? { fontRef: workspace.design.fontId + '::$scheme' } : {}),
      } } : {}),
    },
    components: summaries, total: scoped.length,
    diagnostics: diagnostics.slice(0, 50), diagnosticTotal: diagnostics.length,
    truncated: scoped.length > summaries.length || diagnostics.length > 50,
  };
  while (responseBytes(result) > MAX_RESPONSE_BYTES) {
    if (result.components.length) result.components.pop();
    else if (result.diagnostics.length) result.diagnostics.pop();
    else throw new ResourceError('RESOURCE_TOO_LARGE', 'Workspace summary exceeds the response size limit.');
    result.truncated = true;
  }
  return result;
}
