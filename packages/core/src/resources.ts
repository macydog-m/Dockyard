import path from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { resourceRefSchema, type Component, type Resource, type FolderSnapshot, designCss } from '@dockyard/shared';
import { ResourceError } from './errors.js';
import { isInside } from './storage.js';
import { appliedConfigurationItems, isResourceVisible, type Workspace, type ResourceVisibility } from '@dockyard/shared';
import { currentConfiguration } from './configuration.js';

const normalize = (value: string) => value.trim().toLowerCase();
export type CatalogResource = { resource: Resource; relativePath?: string; extension?: string; root?: string; requestedRoot?: string };

export function projectResources(component: Component, dataDir: string, snapshot?: FolderSnapshot, workspace?: Workspace, visibility?: ResourceVisibility): CatalogResource[] {
  if (component.type === 'configuration') {
    const { preset, values, items } = currentConfiguration(component, workspace);
    return [{ resource: {
    ref: component.id + '::$current', key: component.id, componentId: component.id, name: component.name,
    type: 'configuration', aliases: [], tags: [], metadata: {},
    ...(component.description === undefined ? {} : { description: component.description }),
    ...(component.aiInstructions === undefined ? {} : { aiInstructions: component.aiInstructions }),
    preset, items: appliedConfigurationItems(items, values,
      target => !visibility || (target.includes('::') ? isResourceVisible(visibility, target) : visibility.get(target) === null)),
    } }];
  }
  if (component.type === 'folder') {
    if (!snapshot) return [];
    const overrides = new Map(component.overrides.map(value => [value.relativePath, value]));
    return snapshot.entries.map(entry => {
      const override = overrides.get(entry.relativePath);
      return {
        relativePath: entry.relativePath, extension: entry.extension, root: snapshot.sourceRoot, requestedRoot: path.resolve(dataDir, component.source.path),
        resource: {
          ref: component.id + '::' + entry.relativePath, key: entry.key, name: override?.name ?? entry.name,
          componentId: component.id, aliases: override?.aliases ?? [], tags: override?.tags ?? [], metadata: {},
          ...(override?.description === undefined ? {} : { description: override.description }),
          type: 'file', source: { path: path.join(snapshot.sourceRoot, entry.relativePath) },
          availability: 'available', kind: 'file',
        },
      };
    });
  }
  const resources: CatalogResource[] = [];
  if (component.type === 'font' || (component.type === 'palette' && component.mode === 'design')) {
    const base = { ref: component.id + '::$scheme', key: component.id, name: component.name,
      componentId: component.id, aliases: [], tags: [], metadata: {},
      ...(component.description === undefined ? {} : { description: component.description }) };
    resources.push({ resource: component.type === 'font'
      ? { ...base, type: 'font-scheme', entries: component.entries, css: designCss(undefined, component) }
      : { ...base, type: 'palette', entries: component.entries, css: designCss(component) } });
  }
  for (const entry of component.type === 'palette' || component.type === 'font' ? component.entries : [component]) {
    const base = {
      ref: component.id + '::' + entry.key, key: entry.key, name: entry.name,
      componentId: component.id, aliases: entry.aliases, tags: entry.tags, metadata: entry.metadata,
      ...(entry.description === undefined ? {} : { description: entry.description }),
    };
    if (component.type === 'file') {
      resources.push({ resource: {
        ...base, type: 'file', source: { path: path.resolve(dataDir, component.source.path) },
        availability: 'available', kind: null,
      }, extension: path.extname(component.source.path).toLowerCase() });
    } else if (component.type === 'instruction') {
      resources.push({ resource: { ...base, type: 'instruction', content: component.content } });
    } else if (component.type === 'font' && 'family' in entry) {
      resources.push({ resource: { ...entry, ...base, type: 'font' } });
    } else if (component.type === 'palette' && 'value' in entry) {
      resources.push({ resource: { ...base, type: 'color', value: entry.value.toUpperCase(), ...(entry.role ? { role: entry.role } : {}) } });
    }
  }
  return resources;
}

export function resolveReference(input: string, resources: CatalogResource[]): CatalogResource {
  const parsed = resourceRefSchema.safeParse(input);
  if (!parsed.success) throw new ResourceError('INVALID_REF', 'Use an ID, exact name/alias, or a returned componentId::localRef.');
  const ref = parsed.data;
  const scoped = ref.includes('::');
  const isKey = /^id:/i.test(ref);
  const query = normalize(isKey ? ref.slice(3) : ref);
  // Returned canonical refs also disambiguate case-sensitive filesystem collisions.
  let matches = scoped ? resources.filter(({ resource }) => resource.ref === ref) : [];
  if (matches.length === 0) matches = resources.filter(({ resource }) => normalize(scoped ? resource.ref : resource.key) === query);
  if (!scoped && !isKey && matches.length === 0) {
    matches = resources.filter(({ resource }) => resource.aliases.some(alias => normalize(alias) === query));
  }
  if (!scoped && !isKey && matches.length === 0) {
    matches = resources.filter(({ resource }) => normalize(resource.name) === query
      || (resource.type === 'file' && normalize(path.basename(resource.source.path)) === query));
  }
  if (matches.length === 0) throw new ResourceError('NOT_FOUND', 'Resource is not available in the active workspace.');
  if (matches.length > 1) {
    const sorted = matches.sort((a, b) => a.resource.ref < b.resource.ref ? -1 : a.resource.ref > b.resource.ref ? 1 : 0);
    throw new ResourceError('AMBIGUOUS_REF', 'Multiple resources match; use a candidate ref.', {
      candidates: sorted.slice(0, 10).map(({ resource: { ref, name, type, componentId } }) => ({ ref, name, type, componentId })),
      truncated: sorted.length > 10,
    });
  }
  return matches[0];
}

export async function checkAvailability(entry: CatalogResource): Promise<Resource> {
  const resource = entry.resource;
  if (resource.type === 'font' && resource.source.type === 'file') {
    try {
      const info = await stat(resource.source.path);
      return { ...resource, availability: info.isFile() ? 'available' : 'inaccessible' };
    } catch (error) {
      return { ...resource, availability: ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'inaccessible' };
    }
  }
  if (resource.type !== 'file') return resource;
  try {
    if (entry.root) {
      const actual = await realpath(resource.source.path);
      const currentRoot = await realpath(entry.requestedRoot ?? entry.root);
      // A replaced root must not expand the source boundary either.
      if (currentRoot !== entry.root || !isInside(entry.root, actual)) {
        return { ...resource, availability: 'inaccessible', kind: null };
      }
    }
    const info = await stat(resource.source.path);
    return { ...resource, availability: 'available', kind: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ...resource, availability: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'inaccessible', kind: null };
  }
}
