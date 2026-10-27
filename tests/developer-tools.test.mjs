import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { ResourceRegistry } from '../packages/core/dist/index.js';
import { migrateLegacy, createDemo } from '../scripts/dockyard.mjs';
import { fixture } from './fixtures.mjs';

test('developer CLI initializes isolated demo data and resolves Chinese aliases from another cwd', async t => {
  const f = await fixture(t, { demo: false });
  const target = path.join(f.root, 'cli demo');
  const script = fileURLToPath(new URL('../scripts/dockyard.mjs', import.meta.url));
  const run = promisify(execFile);
  const setup = await run(process.execPath, [script, 'demo', '--data-dir', target], { cwd: tmpdir(), windowsHide: true });
  assert.equal(JSON.parse(setup.stdout).components, 3);
  const lookup = await run(process.execPath, [script, 'get', '--data-dir', target, '--ref', '暖橙色'], { cwd: tmpdir(), windowsHide: true });
  assert.equal(JSON.parse(lookup.stdout).resource.value, '#E98C3A');
  assert.equal(lookup.stderr, '');
});

test('explicit migration preserves IDs and source data, writes a new model, and never overwrites a destination', async t => {
  const f = await fixture(t, { demo: false });
  const source = f.dataDir;
  await mkdir(path.join(source, 'assets'));
  await writeFile(path.join(source, 'sample.txt'), 'SOURCE_RESOURCE_UNCHANGED', 'utf8');
  const legacy = {
    schemaVersion: 1, id: '002511', name: '旧资源', type: 'text', path: 'sample.txt',
    metadata: { demo: true }, componentId: 'old',
  };
  const record = path.join(source, 'assets', '002511.json');
  await writeFile(record, JSON.stringify(legacy), 'utf8');
  const before = await readFile(record, 'utf8');
  const target = path.join(f.root, 'migrated');
  const result = await migrateLegacy(source, target);
  assert.equal(result.migrated, 1);
  const resource = await new ResourceRegistry(target).get('id:002511');
  assert.equal(resource.key, '002511');
  assert.equal(resource.ref, result.references[0].ref);
  assert.equal(resource.source.path, path.join(source, 'sample.txt'));
  assert.equal(resource.availability, 'available');
  assert.equal(await readFile(record, 'utf8'), before);
  assert.equal(await readFile(path.join(source, 'sample.txt'), 'utf8'), 'SOURCE_RESOURCE_UNCHANGED');
  await assert.rejects(migrateLegacy(source, target), { code: 'EEXIST' });
  assert.equal((await new ResourceRegistry(target).get('002511')).key, '002511');
});

test('invalid legacy input fails before creating destination data', async t => {
  const f = await fixture(t, { demo: false });
  await mkdir(path.join(f.dataDir, 'assets'));
  await writeFile(path.join(f.dataDir, 'assets', '002511.json'), '{"schemaVersion":1,"id":"wrong"}', 'utf8');
  const target = path.join(f.root, 'should-not-exist');
  await assert.rejects(migrateLegacy(f.dataDir, target), /Invalid legacy record/);
  await assert.rejects(access(target), { code: 'ENOENT' });
});

test('demo creation cannot overwrite an existing directory', async t => {
  const f = await fixture(t, { demo: false });
  await writeFile(path.join(f.dataDir, 'keep.txt'), 'KEEP', 'utf8');
  await assert.rejects(createDemo(f.dataDir), { code: 'EEXIST' });
  assert.deepEqual(await readdir(f.dataDir), ['keep.txt']);
  assert.equal(await readFile(path.join(f.dataDir, 'keep.txt'), 'utf8'), 'KEEP');
});

test('developer CLI adds a Folder, searches it, and refreshes through the same manager service', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'cli source');
  await mkdir(source);
  await writeFile(path.join(source, '000005_烟雾.png'), 'KEEP', 'utf8');
  const input = path.join(f.root, 'folder.json');
  await writeFile(input, JSON.stringify({ schemaVersion: 1, type: 'folder', id: 'library', name: 'Library', source: { path: source } }), 'utf8');
  const script = fileURLToPath(new URL('../scripts/dockyard.mjs', import.meta.url));
  const execute = promisify(execFile);
  const run = async (...args) => JSON.parse((await execute(process.execPath, [script, ...args, '--data-dir', f.dataDir], { cwd: tmpdir(), windowsHide: true })).stdout);
  assert.equal((await run('put-component', '--file', input)).type, 'folder');
  await run('select', '--components', 'library');
  assert.equal((await run('search', '--query', '烟雾')).total, 1);
  await writeFile(path.join(source, '000006_烟雾.png'), 'KEEP', 'utf8');
  assert.equal((await run('refresh', '--component', 'library')).report.status, 'ready');
  assert.equal((await run('search', '--query', '烟雾')).total, 2);
});

test('developer CLI manages workspaces and reads context without editing JSON', async t => {
  const f = await fixture(t);
  const script = fileURLToPath(new URL('../scripts/dockyard.mjs', import.meta.url));
  const execute = promisify(execFile);
  const run = async (...args) => JSON.parse((await execute(process.execPath, [script, ...args, '--data-dir', f.dataDir], { cwd: tmpdir(), windowsHide: true })).stdout);
  assert.equal((await run('workspace-create', '--id', 'colors', '--name', '颜色工作区')).id, 'colors');
  await run('workspace-select', '--id', 'colors', '--components', 'palette');
  await run('workspace-rename', '--id', 'colors', '--name', '品牌颜色');
  const listed = await run('workspaces');
  assert.equal(listed.activeWorkspaceId, 'default');
  assert.deepEqual(listed.workspaces[1].componentIds, ['palette']);
  await run('workspace-switch', '--id', 'colors');
  const summary = await run('context');
  assert.equal(summary.workspace.name, '品牌颜色');
  assert.deepEqual(summary.components.map(item => item.id), ['palette']);
  await run('select', '--components', 'fx-rules');
  assert.deepEqual((await run('context')).components.map(item => item.id), ['fx-rules']);
});
