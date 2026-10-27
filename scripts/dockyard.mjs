import { open, mkdir, writeFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockyardManager, ResourceRegistry, ResourceError, isInside } from '../packages/core/dist/index.js';
import { componentSchema } from '../packages/shared/dist/index.js';

const maxBytes = 1024 * 1024;
export async function readJsonInput(file) {
  const handle = await open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('JSON input must be a regular file.');
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(bytes, length, bytes.length - length, length);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    if (length > maxBytes) throw new Error('JSON input exceeds 1 MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { await handle.close(); }
}

async function claimNewDirectory(destination) {
  const target = path.resolve(destination);
  await mkdir(path.dirname(target), { recursive: true });
  // Exclusive creation: existing directories are never reused or cleared.
  await mkdir(target);
  return target;
}

export const demoFileComponent = {
  schemaVersion: 1, revision: 1, id: 'demo', name: 'Dockyard 连接验证资源',
  type: 'file', key: '002511', source: { path: 'files/002511.txt' },
  aliases: ['连接示例'], description: '仅用于连接验收，不是用户真实烟雾素材。',
  tags: ['demo', 'connection-test'], metadata: { demo: true }, enabled: true,
};
export const demoPaletteComponent = {
  schemaVersion: 1, revision: 1, id: 'palette', name: 'My Palette', type: 'palette',
  enabled: true, entries: [
    { key: 'warm-orange', name: 'Warm Orange', value: '#E98C3A', aliases: ['暖橙色', '常用暖橙色'] },
    { key: 'cream', name: 'Cream', value: '#FFF4DD', aliases: ['奶油白'] },
  ],
};
export const demoInstructionComponent = {
  schemaVersion: 1, revision: 1, id: 'fx-rules', type: 'instruction', enabled: true,
  key: 'fx-rules', name: 'FX Design Rules', aliases: ['FX 规则'],
  content: '保持轮廓清晰，优先使用轻量效果。此文本仅为演示规则。',
};

export async function createDemo(destination) {
  const dataDir = await claimNewDirectory(destination);
  await mkdir(path.join(dataDir, 'files'));
  await writeFile(path.join(dataDir, 'files', '002511.txt'), 'Dockyard 演示连接资源。\n', 'utf8');
  const manager = new DockyardManager(dataDir);
  await manager.initialize();
  for (const component of [demoFileComponent, demoPaletteComponent, demoInstructionComponent]) {
    await manager.saveComponent(component);
  }
  await manager.setWorkspaceComponents('default', ['demo', 'palette', 'fx-rules']);
  return { dataDir, components: 3 };
}

export async function migrateLegacy(source, destination) {
  const sourceDir = await realpath(path.resolve(source));
  const registryDir = await realpath(path.join(sourceDir, 'assets'));
  if (!isInside(sourceDir, registryDir)) throw new Error('Legacy registry escapes its data directory.');
  const entries = (await readdir(registryDir, { withFileTypes: true }))
    .filter(entry => entry.name.endsWith('.json')).sort((a, b) => a.name < b.name ? -1 : 1);
  if (entries.length > 128) throw new Error('This migration supports at most 128 records in the default workspace.');
  const components = [];
  for (const [index, entry] of entries.entries()) {
    const recordPath = await realpath(path.join(registryDir, entry.name));
    if (!isInside(registryDir, recordPath)) throw new Error('Legacy record escapes its registry.');
    const record = await readJsonInput(recordPath);
    if (record.schemaVersion !== 1 || typeof record.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(record.id)
      || record.id !== entry.name.slice(0, -5) || typeof record.path !== 'string'
      || !record.path || typeof record.type !== 'string' || !record.type) {
      throw new Error('Invalid legacy record: ' + entry.name);
    }
    components.push(componentSchema.parse({
      schemaVersion: 1, id: 'legacy-' + String(index + 1).padStart(6, '0'),
      name: record.name, type: 'file', key: record.id,
      source: { path: path.resolve(sourceDir, record.path) },
      description: record.description, tags: record.tags ?? [],
      metadata: record.metadata ?? {}, enabled: record.enabled ?? true,
    }));
  }
  // All source records are validated before creating any destination data.
  const dataDir = await claimNewDirectory(destination);
  const manager = new DockyardManager(dataDir);
  await manager.initialize();
  for (const component of components) await manager.saveComponent(component);
  await manager.setWorkspaceComponents('default', components.map(component => component.id));
  return {
    dataDir, migrated: components.length,
    references: components.map(component => ({ key: component.key, ref: component.id + '::' + component.key })),
  };
}

export async function main(args) {
  const [command, ...rest] = args;
  const options = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] === undefined || options.has(rest[i])) {
      throw new Error('Expected unique --option value pairs.');
    }
    options.set(rest[i], rest[i + 1]);
  }
  const allowed = {
    init: ['--data-dir'], demo: ['--data-dir'],
    context: ['--data-dir'], workspaces: ['--data-dir'],
    'workspace-create': ['--data-dir', '--id', '--name'],
    'workspace-rename': ['--data-dir', '--id', '--name'],
    'workspace-select': ['--data-dir', '--id', '--components'],
    'workspace-switch': ['--data-dir', '--id'],
    'put-component': ['--data-dir', '--file'],
    select: ['--data-dir', '--components'],
    get: ['--data-dir', '--ref'],
    search: ['--data-dir', '--query'], refresh: ['--data-dir', '--component'],
    migrate: ['--data-dir', '--source'],
  };
  if (!allowed[command] || [...options.keys()].some(key => !allowed[command].includes(key))
    || allowed[command].some(key => !options.has(key))) {
    throw new Error('Usage: dockyard.mjs init|demo|get|search|context|refresh|put-component|select|workspaces|workspace-create|workspace-rename|workspace-select|workspace-switch|migrate --data-dir PATH [--ref REF|--file JSON|--components id,id|--source OLD_PATH|--query QUERY|--component ID|--id ID|--name NAME]');
  }
  const dataDir = options.get('--data-dir');
  if (!dataDir.trim()) throw new Error('Data directory must not be empty.');
  const manager = new DockyardManager(dataDir);
  switch (command) {
    case 'context': return new ResourceRegistry(dataDir).context();
    case 'workspaces': return manager.listWorkspaces();
    case 'workspace-create': return manager.createWorkspace({ schemaVersion: 1, id: options.get('--id'), name: options.get('--name') });
    case 'workspace-rename': return manager.renameWorkspace(options.get('--id'), options.get('--name'));
    case 'workspace-select': return manager.setWorkspaceComponents(options.get('--id'), options.get('--components').split(',').map(id => id.trim()).filter(Boolean));
    case 'workspace-switch': return manager.setActiveWorkspace(options.get('--id'));
    case 'init': return manager.initialize();
    case 'demo': return createDemo(dataDir);
    case 'put-component': return manager.saveComponent(await readJsonInput(path.resolve(options.get('--file'))));
    case 'select': return manager.setActiveWorkspaceComponents( options.get('--components').split(',').map(id => id.trim()).filter(Boolean));
    case 'get': return { resource: await new ResourceRegistry(dataDir).get(options.get('--ref')) };
    case 'search': return new ResourceRegistry(dataDir).search(options.get('--query'));
    case 'refresh': { const index = await manager.refresh(options.get('--component')); return { componentId: index.componentId, builtAt: index.snapshot?.builtAt, report: index.lastRefresh }; }
    case 'migrate': return migrateLegacy(options.get('--source'), dataDir);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (error) {
    console.error(JSON.stringify({
      code: error instanceof ResourceError ? error.code : 'COMMAND_FAILED',
      message: error.message,
    }));
    process.exitCode = 1;
  }
}
