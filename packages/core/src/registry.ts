import { summarizeContext, type ScopedComponent } from './context.js';
import { responseBytes, MAX_RESPONSE_BYTES } from './responses.js';
import { resourceRefSchema, querySchema, type Resource, type IndexDiagnostic, type SearchResult } from '@dockyard/shared';
import { ResourceError } from './errors.js';
import { JsonStore } from './storage.js';
import { loadActiveSnapshot } from './config.js';
import { resolveReference, checkAvailability, projectResources, type CatalogResource } from './resources.js';
import { FolderIndexReader } from './folder-index.js';
import { getConfigurationState, isResourceVisible } from '@dockyard/shared';
import { prepareSearch, searchRows, type SearchRow } from './search.js';

export class ResourceRegistry {
  private readonly store: JsonStore;
  private readonly indexes: FolderIndexReader;
  private readonly catalogs = new Map<string, { token: string; resources: CatalogResource[]; rows: SearchRow[] }>();
  constructor(dataDir?: string, private readonly binding: { workspaceId?: string } = {}) {
    this.store = new JsonStore(dataDir);
    this.indexes = new FolderIndexReader(this.store);
  }
  private async scope(scope?: string) {
    const { workspace, components, visibility } = await loadActiveSnapshot(this.store, this.binding.workspaceId);
    const ids = new Set(components.map(component => component.id));
    this.indexes.retain(ids);
    for (const id of this.catalogs.keys()) if (!ids.has(id)) this.catalogs.delete(id);
    const diagnostics: IndexDiagnostic[] = [];
    const scoped: ScopedComponent[] = [];
    for (const component of components) {
      if (scope && component.id !== scope) continue;
      const folder = component.type === 'folder' ? await this.indexes.load(component) : undefined;
      if (folder?.diagnostic) diagnostics.push(folder.diagnostic);
      scoped.push({ component, folder, refs: visibility.get(component.id) ?? undefined });
    }
    return { workspace, scoped, diagnostics, visibility };
  }

  private async catalog(scope?: string) {
    const { workspace, scoped, diagnostics, visibility } = await this.scope(scope);
    const groups = [];
    for (const { component, folder, refs } of scoped) {
      const token = JSON.stringify(component) + (folder?.identity ?? '')
        + JSON.stringify(refs ? [...refs].sort() : null)
        + (component.type === 'configuration' ? JSON.stringify([workspace.id, getConfigurationState(workspace.configurations, component.id), [...visibility].map(([id, refs]) => [id, refs ? [...refs].sort() : null])]) : '');
      let catalog = this.catalogs.get(component.id);
      if (!catalog || catalog.token !== token) {
        const resources = projectResources(component, this.store.dataDir, folder?.index?.snapshot ?? undefined, workspace, visibility)
          .filter(({ resource }) => isResourceVisible(visibility, resource.ref));
        catalog = { token, resources, rows: resources.map(resource => prepareSearch(resource, component)) };
        this.catalogs.set(component.id, catalog);
      }
      groups.push(catalog);
    }
    return { groups, diagnostics };
  }

  async context() {
    const { workspace, scoped, diagnostics } = await this.scope();
    return summarizeContext(workspace, scoped, diagnostics);
  }

  async get(ref: string): Promise<Resource> {
    const parsed = resourceRefSchema.safeParse(ref);
    if (!parsed.success) throw new ResourceError('INVALID_REF', 'Use an ID, exact name/alias, or a returned componentId::localRef.');
    const scoped = parsed.data.includes('::');
    const { groups, diagnostics } = await this.catalog(scoped ? parsed.data.split('::')[0].toLowerCase() : undefined);
    const blocking = diagnostics.find(diagnostic => !scoped || !['INDEX_PARTIAL', 'INDEX_REFRESH_FAILED'].includes(diagnostic.code));
    if (blocking) throw new ResourceError(blocking.code, blocking.message, { componentId: blocking.componentId });
    try {
      return structuredClone(await checkAvailability(resolveReference(parsed.data, groups.flatMap(group => group.resources))));
    } catch (error) {
      if (error instanceof ResourceError && error.code === 'NOT_FOUND' && diagnostics.length) {
        throw new ResourceError(diagnostics[0].code, diagnostics[0].message, { componentId: diagnostics[0].componentId });
      }
      throw error;
    }
  }
  async search(query: string): Promise<SearchResult> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new ResourceError('INVALID_QUERY', 'Provide a nonempty query of at most 256 characters containing letters or numbers.');
    const { groups, diagnostics } = await this.catalog();
    const { items, total } = searchRows(groups.map(group => group.rows), parsed.data);
    const result = { items, total, truncated: total > items.length, diagnostics };
    while (result.items.length && responseBytes(result) > MAX_RESPONSE_BYTES) {
      result.items.pop(); result.truncated = true;
    }
    if (responseBytes(result) > MAX_RESPONSE_BYTES) {
      throw new ResourceError('RESOURCE_TOO_LARGE', 'Search diagnostics exceed the response size limit.');
    }
    return result;
  }
}
