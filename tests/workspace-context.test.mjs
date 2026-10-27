import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { DockyardManager } from '../packages/core/dist/index.js';
import { configSchema, contextOutputSchema, folderIndexSchema } from '../packages/shared/dist/index.js';
import { fixture, errorCode } from './fixtures.mjs';

async function withFolder(t) {
  const f = await fixture(t);
  const source = path.join(f.root, 'private-source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, '002511_PRIVATE_FILENAME.png'), 'PRIVATE_FILE_CONTENT', 'utf8');
  await f.manager.saveComponent({ schemaVersion: 1, id: 'folder', type: 'folder', name: '素材库', description: '二维特效', source: { path: source } });
  await f.manager.setWorkspaceComponents('default', ['demo', 'palette', 'fx-rules', 'folder']);
  return { ...f, source };
}

test('Workspace creation, rename, composition, list and switch preserve independent state', async t => {
  const f = await fixture(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'colors', name: '颜色', componentIds: ['palette'] });
  assert.equal((await f.read('config.json')).activeWorkspaceId, 'default');
  await assert.rejects(f.manager.createWorkspace({ schemaVersion: 1, id: 'colors', name: 'overwrite' }), errorCode('CONFIG_INVALID'));
  const renamed = await f.manager.renameWorkspace('colors', '品牌颜色');
  assert.deepEqual(renamed.componentIds, ['palette']);
  assert.equal(renamed.revision, 2);
  await assert.rejects(f.manager.renameWorkspace('colors', '   '), errorCode('CONFIG_INVALID'));
  assert.deepEqual(await f.read('workspaces/colors.json'), renamed);
  await f.manager.setWorkspaceComponents('colors', ['palette', 'fx-rules']);
  await f.manager.setActiveWorkspace('colors');
  const config = await f.read('config.json');
  assert.deepEqual(await f.manager.setActiveWorkspace('colors'), config); // Idempotent switch.
  const filesBefore = await fs.readdir(f.dataDir);
  const listed = await f.manager.listWorkspaces();
  assert.equal(listed.activeWorkspaceId, 'colors');
  assert.deepEqual(listed.workspaces.map(item => item.id), ['default', 'colors']);
  assert.deepEqual(listed.workspaces[1].componentIds, ['palette', 'fx-rules']);
  assert.deepEqual(await f.read('config.json'), config);
  assert.deepEqual(await fs.readdir(f.dataDir), filesBefore);
  assert.deepEqual((await f.read('workspaces/default.json')).componentIds, ['demo', 'palette', 'fx-rules']);
});

test('concurrent rename and composition updates do not overwrite each other', async t => {
  const f = await fixture(t);
  const other = new DockyardManager(f.dataDir);
  await Promise.all([
    f.manager.renameWorkspace('default', '重命名'),
    other.setWorkspaceComponents('default', ['palette']),
  ]);
  const workspace = await f.read('workspaces/default.json');
  assert.equal(workspace.name, '重命名');
  assert.deepEqual(workspace.componentIds, ['palette']);
  assert.equal(workspace.revision, 4); // Demo setup already changed the initial selection once.
});

test('active selection resolves its workspace inside the write lock', async t => {
  const f = await fixture(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'next', name: 'Next' });
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const held = f.manager.store.withWrite(async () => {
    const config = await f.read('config.json');
    entered();
    await gate;
    await f.manager.store.write('config.json', configSchema, { ...config, revision: config.revision + 1, activeWorkspaceId: 'next' });
  });
  await ready;
  const selection = f.manager.setActiveWorkspaceComponents(['palette']);
  release();
  await held;
  assert.equal((await selection).id, 'next');
  assert.deepEqual((await f.read('workspaces/default.json')).componentIds, ['demo', 'palette', 'fx-rules']);
  assert.deepEqual((await f.read('workspaces/next.json')).componentIds, ['palette']);
});

test('invalid target workspace records cannot change the active workspace; combinations can repair dangling refs', async t => {
  const f = await fixture(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'target', name: 'Target', componentIds: ['palette'] });
  const before = await f.read('config.json');
  const palette = await f.read('components/palette.json');
  await f.write('components/palette.json', { ...palette, id: 'wrong' });
  await assert.rejects(f.manager.setActiveWorkspace('target'), errorCode('CONFIG_INVALID'));
  assert.deepEqual(await f.read('config.json'), before);
  await f.write('components/palette.json', palette);
  const target = await f.read('workspaces/target.json');
  await f.write('workspaces/target.json', { ...target, componentIds: ['missing'] });
  await assert.rejects(f.manager.listWorkspaces(), errorCode('CONFIG_INVALID'));
  await f.manager.setWorkspaceComponents('target', ['palette']);
  assert.equal((await f.manager.listWorkspaces()).workspaces[1].componentIds[0], 'palette');
  for (const id of ['../escape', 'UPPER', 'con']) {
    await assert.rejects(f.manager.renameWorkspace(id, 'name'), errorCode('CONFIG_INVALID'));
    await assert.rejects(f.manager.setActiveWorkspace(id), errorCode('CONFIG_INVALID'));
  }
});

test('context summarizes all four component types without paths, resource lists or rule content', async t => {
  const f = await withFolder(t);
  const result = await f.registry.context();
  assert.equal(contextOutputSchema.safeParse(result).success, true);
  assert.deepEqual(Object.keys(result.workspace).sort(), ['id', 'name', 'revision']);
  assert.equal(result.workspace.id, 'default');
  assert.equal(result.total, 4);
  assert.equal(result.truncated, false);
  assert.equal(result.diagnosticTotal, 0);
  assert.deepEqual(result.components.map(item => item.resourceCount), [1, 2, 1, 1]);
  assert.deepEqual(result.components.map(item => item.id), ['demo', 'palette', 'fx-rules', 'folder']);
  assert.equal(result.components[3].index.status, 'ready');
  assert.equal(result.components[3].index.snapshotStatus, 'ready');
  assert.ok(result.components[3].index.builtAt);
  assert.ok(result.components[3].index.lastRefreshAt);
  for (const marker of ['PRIVATE_FILENAME', 'PRIVATE_FILE_CONTENT', 'private-source', 'warm-orange', '#E98C3A', '保持轮廓清晰', 'componentIds', '"source"', '"entries"', '"metadata"', '"content"']) {
    assert.ok(!JSON.stringify(result).includes(marker), marker);
  }
});

test('all three tools share selected/enabled scope, empty workspace behavior and fail-closed configuration', async t => {
  const f = await withFolder(t);
  const palette = await f.read('components/palette.json');
  await f.manager.saveComponent({ ...palette, enabled: false });
  assert.ok(!(await f.registry.context()).components.some(item => item.id === 'palette'));
  assert.equal((await f.registry.search('暖橙色')).total, 0);
  await assert.rejects(f.registry.get('palette::warm-orange'), errorCode('NOT_FOUND'));
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'empty', name: '空白' });
  await f.manager.setActiveWorkspace('empty');
  assert.deepEqual((await f.registry.context()).components, []);
  assert.equal((await f.registry.context()).total, 0);
  assert.equal((await f.registry.search('smoke')).total, 0);
  await assert.rejects(f.registry.get('demo::002511'), errorCode('NOT_FOUND'));
  const workspace = await f.read('workspaces/empty.json');
  for (const invalid of [{ ...workspace, id: 'wrong' }, { ...workspace, componentIds: ['missing'] }]) {
    await f.write('workspaces/empty.json', invalid);
    for (const lookup of [() => f.registry.context(), () => f.registry.search('暖橙色'), () => f.registry.get('demo::002511')]) {
      await assert.rejects(lookup(), errorCode('CONFIG_INVALID'));
    }
  }
  await f.write('workspaces/empty.json', workspace);
  assert.equal((await f.registry.context()).workspace.name, '空白');
});

test('context and search expose consistent index diagnostics and recover without restart', async t => {
  const f = await withFolder(t);
  const original = await f.read('index/folder.json');
  const assertStatus = async (code, status, count) => {
    const context = await f.registry.context();
    const search = await f.registry.search('暖橙色');
    assert.deepEqual(context.diagnostics, search.diagnostics);
    const folder = context.components.find(item => item.id === 'folder');
    assert.equal(folder.index.status, status);
    assert.equal(folder.resourceCount, count);
    assert.equal(context.diagnostics[0]?.code, code);
  };
  await fs.rm(path.join(f.dataDir, 'index/folder.json'));
  await assertStatus('INDEX_NOT_READY', 'not_ready', null);
  await fs.writeFile(path.join(f.dataDir, 'index/folder.json'), '{', 'utf8');
  await assertStatus('INDEX_INVALID', 'invalid', null);
  const partial = structuredClone(original);
  partial.snapshot.status = 'partial';
  partial.lastRefresh.status = 'partial';
  partial.lastRefresh.errors = 1;
  await f.manager.store.write('index/folder.json', folderIndexSchema, partial);
  await assertStatus('INDEX_PARTIAL', 'partial', 1);
  await f.manager.store.write('index/folder.json', folderIndexSchema, original);
  const component = await f.read('components/folder.json');
  await f.write('components/folder.json', { ...component, source: { path: f.source + '-different' } });
  await assertStatus('INDEX_STALE', 'stale', null);
  await f.write('components/folder.json', component);
  await fs.rename(f.source, f.source + '-moved');
  await f.manager.refresh('folder');
  await assertStatus('INDEX_REFRESH_FAILED', 'refresh_failed', 1);
  await fs.rename(f.source + '-moved', f.source);
  await f.manager.refresh('folder');
  await assertStatus(undefined, 'ready', 1);
});

test('context reports failed first indexing without inventing zero resources or exposing paths', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.saveComponent({
    schemaVersion: 1, id: 'absent', type: 'folder', name: 'Unavailable', source: { path: path.join(f.root, 'absent') },
  }), errorCode('INDEX_REFRESH_FAILED'));
  await f.manager.setWorkspaceComponents('default', ['absent']);
  const result = await f.registry.context();
  assert.equal(result.components[0].resourceCount, null);
  assert.equal(result.components[0].index.status, 'not_ready');
  assert.ok(result.components[0].index.lastRefreshAt);
  assert.equal(result.diagnostics[0].code, 'INDEX_NOT_READY');
  assert.equal(result.components[0].index.builtAt, undefined);
});

test('context does no source enumeration, file availability checks or resource projection', async t => {
  const f = await withFolder(t);
  const restore = [];
  for (const method of ['opendir', 'stat', 'lstat', 'open']) {
    const original = fs[method];
    const mocked = t.mock.method(fs, method, async (file, ...args) => {
      assert.ok(!path.resolve(String(file)).startsWith(f.source), 'context must not touch source');
      return original(file, ...args);
    });
    restore.push(() => mocked.mock.restore());
  }
  syncBuiltinESMExports();
  try {
    const before = await fs.readFile(path.join(f.dataDir, 'index/folder.json'), 'utf8');
    const result = await f.registry.context();
    assert.equal(result.components[3].resourceCount, 1);
    assert.equal(f.registry.catalogs.size, 0); // Context must not allocate the resource/search projections.
    assert.equal(await fs.readFile(path.join(f.dataDir, 'index/folder.json'), 'utf8'), before);
  } finally { for (const undo of restore) undo(); syncBuiltinESMExports(); }
});

test('context caps component count, explicitly shortens descriptions, and respects serialized byte bounds', async t => {
  const f = await fixture(t);
  const base = await f.read('components/fx-rules.json');
  const ids = [];
  for (let i = 0; i < 55; i++) {
    const id = 'summary-' + String(i).padStart(2, '0');
    await f.manager.saveComponent({ ...base, id, name: '名称'.repeat(120), description: '😀'.repeat(2048) });
    ids.push(id);
  }
  await f.manager.setWorkspaceComponents('default', ids);
  const result = await f.registry.context();
  assert.equal(contextOutputSchema.safeParse(result).success, true);
  assert.equal(result.total, 55);
  assert.ok(result.components.length > 0 && result.components.length <= 50);
  assert.equal(result.truncated, true);
  assert.equal(result.components[0].descriptionTruncated, true);
  assert.equal(Array.from(result.components[0].description).length, 256);
  assert.ok(!result.components[0].description.includes('\uFFFD'));
  assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }), 'utf8') <= 60 * 1024);
  assert.deepEqual(await f.registry.context(), result);
});

test('context preserves total diagnostic count when the summary list is truncated', async t => {
  const f = await fixture(t);
  const ids = [];
  for (let i = 0; i < 52; i++) {
    const id = 'missing-' + i;
    await assert.rejects(f.manager.saveComponent({
      schemaVersion: 1, id, type: 'folder', name: id, source: { path: path.join(f.root, id) },
    }), errorCode('INDEX_REFRESH_FAILED'));
    ids.push(id);
  }
  await f.manager.setWorkspaceComponents('default', ids);
  const result = await f.registry.context();
  assert.equal(result.total, 52);
  assert.equal(result.diagnosticTotal, 52);
  assert.equal(result.diagnostics.length, 50);
  assert.equal(result.truncated, true);
});

test('workspace listing and context respect configuration locks and recover on release', async t => {
  const f = await fixture(t);
  const lock = path.join(f.dataDir, '.write-lock');
  await fs.writeFile(lock, 'held', 'utf8');
  await assert.rejects(f.manager.listWorkspaces(), errorCode('DATA_BUSY'));
  await assert.rejects(f.registry.context(), errorCode('DATA_BUSY'));
  await fs.rm(lock);
  assert.equal((await f.registry.context()).workspace.id, 'default');
  assert.equal((await f.manager.listWorkspaces()).activeWorkspaceId, 'default');
});


test('workspace pause retains membership, persists across reload and isolates all three query tools', async t => {
  const f = await fixture(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'other', name: '其他', componentIds: ['palette'] });
  const before = await f.read('workspaces/default.json');
  await f.manager.setWorkspaceComponentEnabled('default', 'palette', false);
  const paused = await f.read('workspaces/default.json');
  assert.deepEqual(paused.componentIds, before.componentIds);
  assert.deepEqual(paused.disabledComponentIds, ['palette']);
  assert.equal((await f.read('components/palette.json')).enabled, true);
  assert.equal((await f.registry.context()).components.some(item => item.id === 'palette'), false);
  assert.equal((await f.registry.search('暖橙色')).total, 0);
  await assert.rejects(f.registry.get('palette::warm-orange'), errorCode('NOT_FOUND'));
  const reopened = new DockyardManager(f.dataDir);
  assert.deepEqual((await reopened.listWorkspaces()).workspaces[0].disabledComponentIds, ['palette']);
  assert.deepEqual(await reopened.setWorkspaceComponentEnabled('default', 'palette', false), paused);
  await reopened.setActiveWorkspace('other');
  assert.equal((await f.registry.get('暖橙色')).value, '#E98C3A');
  await reopened.setActiveWorkspace('default');
  await reopened.setWorkspaceComponentEnabled('default', 'palette', true);
  assert.equal((await f.registry.get('暖橙色')).value, '#E98C3A');
  assert.deepEqual((await f.read('workspaces/default.json')).componentIds, before.componentIds);
});

test('membership changes and resource deletion clean paused refs; concurrent changes retain separate pauses', async t => {
  const f = await fixture(t);
  const other = new DockyardManager(f.dataDir);
  await Promise.all([
    f.manager.setWorkspaceComponentEnabled('default', 'demo', false),
    other.setWorkspaceComponentEnabled('default', 'palette', false),
  ]);
  assert.deepEqual(new Set((await f.read('workspaces/default.json')).disabledComponentIds), new Set(['demo', 'palette']));
  await f.manager.setWorkspaceComponents('default', ['palette', 'fx-rules']);
  assert.deepEqual((await f.read('workspaces/default.json')).disabledComponentIds, ['palette']);
  await assert.rejects(f.manager.setWorkspaceComponentEnabled('default', 'demo', false), errorCode('NOT_FOUND'));
  await assert.rejects(f.manager.setWorkspaceComponentEnabled('../escape', 'palette', false), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.manager.saveWorkspace({ schemaVersion: 1, id: 'invalid', name: '无效', componentIds: [], disabledComponentIds: ['palette'] }), errorCode('CONFIG_INVALID'));
  await f.manager.removeComponent('palette');
  assert.deepEqual((await f.read('workspaces/default.json')).disabledComponentIds, []);
  assert.equal((await f.registry.context()).total, 1);
});
