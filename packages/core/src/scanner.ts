import path from 'node:path';
import { lstat, realpath, opendir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  folderEntrySchema, type Component, type FolderEntry, type FolderSnapshot, type RefreshReport,
} from '@dockyard/shared';
import { isInside } from './storage.js';

export type FolderComponent = Extract<Component, { type: 'folder' }>;
export function sourceFingerprint(component: FolderComponent, dataDir: string): string {
  const source = path.resolve(dataDir, component.source.path);
  return createHash('sha256').update(JSON.stringify({ indexVersion: 1, source })).digest('hex');
}
export type ScanProgress = { files: number; directories: number };
export type ScanResult = { snapshot: FolderSnapshot | null; report: RefreshReport };

// Eight directory operations at a time; files are enumerated, never opened.
export async function scanFolder(component: FolderComponent, dataDir: string, onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
  const report: RefreshReport = {
    status: 'ready', attemptedAt: new Date().toISOString(), files: 0, skipped: 0, errors: 0, issues: [],
  };
  const issue = (relativePath: string, code: string) => {
    report.errors++;
    if (report.issues.length < 20) report.issues.push({ path: relativePath.slice(0, 1024), code });
  };
  const requestedRoot = path.resolve(dataDir, component.source.path);
  let root: string;
  let dataRoot: string;
  let rootIdentity: string;
  try {
    const info = await lstat(requestedRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('INVALID_ROOT');
    rootIdentity = [info.dev, info.ino, info.birthtimeMs].join(':');
    root = await realpath(requestedRoot);
    dataRoot = await realpath(dataDir);
    if (isInside(dataRoot, root)) throw new Error('DATA_DIRECTORY');
  } catch (error) {
    issue('', (error as NodeJS.ErrnoException).code ?? (error as Error).message);
    report.status = 'failed';
    return { snapshot: null, report };
  }
  const entries: FolderEntry[] = [];
  const queue = [''];
  let queued = 1;
  let fatal = false;
  let visited = 0;
  while (queue.length && !fatal) {
    const batch = queue.splice(0, 8);
    const children = await Promise.all(batch.map(async relative => {
      const found: string[] = [];
      const directory = path.join(root, relative);
      try {
        // Recheck queued directories in case an ancestor became a link after enumeration.
        const info = await lstat(directory);
        const actual = await realpath(directory);
        if (info.isSymbolicLink() || !isInside(root, actual) || isInside(dataRoot, actual)
          || actual !== directory) {
          if (!relative) throw new Error('ROOT_CHANGED');
          report.skipped++;
          issue(relative, 'DIRECTORY_CHANGED');
          return found;
        }
        const handle = await opendir(directory);
        for await (const child of handle) {
          const local = relative ? relative + '/' + child.name : child.name;
          const target = path.join(root, local);
          if (child.isSymbolicLink() || (child.isDirectory() && ['.git', 'node_modules'].includes(child.name.toLowerCase()))
            || isInside(dataRoot, target)) {
            report.skipped++;
            continue;
          }
          if (child.isDirectory()) {
            if (++queued > 100000) { issue('', 'DIRECTORY_LIMIT'); fatal = true; break; }
            found.push(local);
          } else if (child.isFile()) {
            const extension = path.extname(child.name);
            const stem = child.name.slice(0, child.name.length - extension.length);
            const key = /^(\d+)(?=[_\- ]|$)/.exec(stem)?.[1] ?? local;
            const parsed = folderEntrySchema.safeParse({ relativePath: local, key, name: child.name, extension: extension.toLowerCase() });
            if (!parsed.success) { report.skipped++; issue(local, 'UNSUPPORTED_NAME'); continue; }
            entries.push(parsed.data);
            report.files++;
            if (entries.length > 100000) { issue('', 'INDEX_LIMIT'); fatal = true; break; }
          } else { report.skipped++; }
        }
      } catch (error) {
        issue(relative, (error as NodeJS.ErrnoException).code ?? 'SCAN_FAILED');
        if (!relative) fatal = true;
        else report.skipped++;
      }
      return found;
    }));
    visited += batch.length;
    onProgress?.({ files: report.files, directories: visited });
    queue.push(...children.flat());
  }
  // Detect a replaced root before publishing a snapshot of its former contents.
  try {
    const current = await lstat(requestedRoot);
    if ((await realpath(requestedRoot)) !== root || current.isSymbolicLink()
      || [current.dev, current.ino, current.birthtimeMs].join(':') !== rootIdentity) {
      issue('', 'ROOT_CHANGED'); fatal = true;
    }
  } catch { issue('', 'ROOT_CHANGED'); fatal = true; }
  report.issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  if (fatal) { report.status = 'failed'; return { snapshot: null, report }; }
  report.status = report.errors ? 'partial' : 'ready';
  entries.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  return {
    report,
    snapshot: {
      indexVersion: 1, generation: randomUUID(), sourceFingerprint: sourceFingerprint(component, dataDir),
      sourceRoot: root, builtAt: new Date().toISOString(), status: report.status, entries,
    },
  };
}
