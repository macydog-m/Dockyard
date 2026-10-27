import path from 'node:path';
import { componentSchema, folderIndexSchema, type FolderIndex, type IndexDiagnostic } from '@dockyard/shared';
import { JsonStore, recordName } from './storage.js';
import { readConfig } from './config.js';
import { ResourceError } from './errors.js';
import { scanFolder, sourceFingerprint, type FolderComponent, type ScanProgress } from './scanner.js';

export async function refreshFolder(store: JsonStore, componentId: string, onProgress?: (progress: ScanProgress) => void): Promise<FolderIndex> {
  const name = recordName('index', componentId);
  return store.withWrite(async () => {
    const config = (await readConfig(store)).value;
    if (!config.componentIds.includes(componentId)) throw new ResourceError('NOT_FOUND', 'Component is not registered.');
    const component = (await store.read(recordName('components', componentId), componentSchema)).value;
    if (component.id !== componentId || component.type !== 'folder') {
      throw new ResourceError('CONFIG_INVALID', 'Refresh requires a Folder component with a matching ID.');
    }
    const previous = await store.read(name, folderIndexSchema).catch(() => null);
    const { snapshot, report } = await scanFolder(component, store.dataDir, onProgress);
    const latestConfig = (await readConfig(store)).value;
    const latest = (await store.read(recordName('components', componentId), componentSchema)).value;
    if (!latestConfig.componentIds.includes(componentId) || latest.type !== 'folder' || latest.id !== componentId
      || sourceFingerprint(latest, store.dataDir) !== sourceFingerprint(component, store.dataDir)) {
      throw new ResourceError('INDEX_STALE', 'Folder source changed while scanning; refresh the current source.');
    }
    const retained = previous?.value.componentId === componentId ? previous.value.snapshot : null;
    return store.write(name, folderIndexSchema, {
      schemaVersion: 1, componentId, snapshot: snapshot ?? retained, lastRefresh: report,
    });
  }, componentId);
}

export type LoadedFolder = { identity: string; index?: FolderIndex; diagnostic?: IndexDiagnostic };
export class FolderIndexReader {
  private readonly cache = new Map<string, { identity: string; index: FolderIndex }>();
  constructor(private readonly store: JsonStore) {}
  retain(ids: Set<string>) {
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
  }
  async load(component: FolderComponent): Promise<LoadedFolder> {
    const name = recordName('index', component.id);
    const diagnostic = (code: IndexDiagnostic['code'], message: string): LoadedFolder => ({
      identity: code, diagnostic: { componentId: component.id, code, message },
    });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const identity = await this.store.identity(name);
        if (!identity) { this.cache.delete(component.id); return diagnostic('INDEX_NOT_READY', 'Folder has no index. Refresh it in the manager.'); }
        let cached = this.cache.get(component.id);
        if (cached?.identity !== identity) {
          const record = await this.store.read(name, folderIndexSchema);
          if (await this.store.identity(name) !== identity) continue;
          cached = { identity, index: record.value };
          this.cache.set(component.id, cached);
        }
        const index = cached.index;
        if (index.componentId !== component.id || (index.snapshot && !path.isAbsolute(index.snapshot.sourceRoot))) return diagnostic('INDEX_INVALID', 'Index component ID does not match its filename.');
        if (index.snapshot && index.snapshot.sourceFingerprint !== sourceFingerprint(component, this.store.dataDir)) {
          return diagnostic('INDEX_STALE', 'Folder source changed. Refresh before querying its index.');
        }
        const snapshot = index.snapshot;
        if (!snapshot) return {
          ...diagnostic('INDEX_NOT_READY', 'Folder has no successful index. Check the source and refresh.'),
          identity, index,
        };
        const status = index.lastRefresh.status === 'failed' ? 'INDEX_REFRESH_FAILED'
          : snapshot.status === 'partial' ? 'INDEX_PARTIAL' : undefined;
        return {
          identity, index,
          ...(status ? { diagnostic: {
            componentId: component.id, code: status,
            message: status === 'INDEX_PARTIAL' ? 'Some entries could not be indexed; results may be incomplete.'
              : 'The last refresh failed. Results use the retained snapshot.',
            builtAt: snapshot.builtAt, errors: index.lastRefresh.errors, skipped: index.lastRefresh.skipped,
          } } : {}),
        };
      }
      return diagnostic('INDEX_INVALID', 'Index changed repeatedly while reading. Retry.');
    } catch {
      this.cache.delete(component.id);
      return diagnostic('INDEX_INVALID', 'Folder index is unreadable or invalid. Refresh it in the manager.');
    }
  }
}
