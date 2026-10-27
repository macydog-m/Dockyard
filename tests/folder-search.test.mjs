import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { ResourceRegistry } from '../packages/core/dist/index.js';
import { folderIndexSchema, searchOutputSchema } from '../packages/shared/dist/index.js';
import { fixture, errorCode } from './fixtures.mjs';

async function folderFixture(t, files = ['002511_soft-smoke.png', '无编号.txt'], options = {}) {
  const f = await fixture(t);
  const source = path.join(f.root, '素材 source');
  await fs.mkdir(source);
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await fs.writeFile(path.join(source, file), 'DO_NOT_READ_SOURCE_CONTENT', 'utf8');
  }
  const component = {
    schemaVersion: 1, type: 'folder', id: 'fx', name: 'Effects',
    source: { path: source }, ...options,
  };
  await f.manager.saveComponent(component);
  await f.manager.setWorkspaceComponents('default', ['fx', 'palette', 'fx-rules']);
  return { ...f, source, component };
}
function mockFs(t, method, implementation) {
  const mocked = t.mock.method(fs, method, implementation);
  syncBuiltinESMExports();
  return () => { mocked.mock.restore(); syncBuiltinESMExports(); };
}

test('Folder add enumerates paths, preserves IDs, handles duplicates and uses optional Chinese aliases', async t => {
  const f = await folderFixture(t, [
    '002511_soft-smoke.png', 'duplicate/002511_dark.png', '2511.png', '002512.png',
    '002513x.png', 'notes/plain.txt', '无编号.txt', '.hidden.png',
  ], { overrides: [{ relativePath: '002511_soft-smoke.png', aliases: ['轻烟雾'], tags: ['二维', '烟雾'] }] });
  const index = await f.read('index/fx.json');
  assert.equal(index.lastRefresh.status, 'ready');
  assert.equal(index.snapshot.entries.length, 8);
  assert.equal(index.snapshot.entries.find(item => item.name === '002513x.png').key, '002513x.png');
  await assert.rejects(f.registry.get('id:002511'), error => {
    assert.equal(error.code, 'AMBIGUOUS_REF');
    assert.deepEqual(error.details.candidates.map(item => item.ref), ['fx::002511_soft-smoke.png', 'fx::duplicate/002511_dark.png']);
    return true;
  });
  assert.equal((await f.registry.get('id:2511')).ref, 'fx::2511.png');
  assert.equal((await f.registry.get('id:002512')).key, '002512');
  assert.equal((await f.registry.get('plain.txt')).ref, 'fx::notes/plain.txt');
  assert.equal((await f.registry.get('fx::notes/plain.txt')).availability, 'available');
  assert.equal((await f.registry.get('轻烟雾')).ref, 'fx::002511_soft-smoke.png');
  assert.equal((await f.registry.search('二维 烟雾')).items[0].ref, 'fx::002511_soft-smoke.png');
  assert.ok((await f.registry.search('hidden')).items.some(item => item.ref === 'fx::.hidden.png'));
  assert.ok(!JSON.stringify(index).includes('DO_NOT_READ_SOURCE_CONTENT'));
  for (const item of (await f.registry.search('smoke')).items) assert.equal((await f.registry.get(item.ref)).ref, item.ref);
});

test('scanner skips symlinks, junctions, excluded directories and its own data; ordinary hidden files remain', async t => {
  const f = await fixture(t);
  for (const file of ['.git/secret.txt', 'node_modules/secret.txt', '.hidden/visible.txt', '素材.txt']) {
    await fs.mkdir(path.dirname(path.join(f.root, file)), { recursive: true });
    await fs.writeFile(path.join(f.root, file), 'KEEP', 'utf8');
  }
  await fs.symlink(f.root, path.join(f.root, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  await f.manager.saveComponent({ schemaVersion: 1, id: 'tree', name: 'Tree', type: 'folder', source: { path: f.root } });
  const index = await f.read('index/tree.json');
  assert.deepEqual(index.snapshot.entries.map(item => item.relativePath), ['.hidden/visible.txt', '素材.txt']);
  assert.equal(index.lastRefresh.skipped, 4);
  assert.equal(index.lastRefresh.status, 'ready');
});

test('search ranking, exact matches, truncation and output fields are deterministic across resource types', async t => {
  const f = await folderFixture(t, [
    ...Array.from({ length: 14 }, (_, i) => String(i).padStart(6, '0') + '_soft-smoke.png'),
    'soft-smoke.png', 'warm-orange.png',
  ], { overrides: [{ relativePath: 'soft-smoke.png', aliases: ['soft smoke'], tags: ['烟雾'] }] });
  const color = await f.registry.search('常用暖橙色');
  assert.equal(color.items[0].value, '#E98C3A');
  assert.ok(color.items[0].reasons.includes('exact_alias'));
  const results = await f.registry.search('SOFT__SMOKE');
  assert.equal(results.total, 15);
  assert.equal(results.items.length, 10);
  assert.equal(results.truncated, true);
  assert.deepEqual(results, await f.registry.search(' soft--smoke '));
  const alias = await f.registry.search('soft smoke');
  assert.equal(alias.items[0].ref, 'fx::soft-smoke.png');
  assert.ok(alias.items[0].reasons.includes('exact_alias'));
  assert.equal((await f.registry.search('000003')).items[0].ref, 'fx::000003_soft-smoke.png');
  assert.equal((await f.registry.search('fx::soft-smoke.png')).items[0].ref, 'fx::soft-smoke.png');
  assert.equal((await f.registry.search('warm-orange')).items[0].type, 'color');
  assert.equal((await f.registry.search('烟雾')).total, 1); // No invented translation for English filenames.
  const instruction = await f.registry.search('FX 规则');
  assert.equal(instruction.items[0].type, 'instruction');
  for (const result of [results, color, instruction]) {
    assert.equal(searchOutputSchema.safeParse(result).success, true);
    assert.ok(!JSON.stringify(result).includes('DO_NOT_READ'));
    for (const item of result.items) for (const field of ['metadata', 'content', 'source']) assert.equal(item[field], undefined);
  }
  assert.deepEqual((await f.registry.search('no-match-zzzz')).items, []);
  for (const query of ['', '  ', 'x'.repeat(257), '---']) await assert.rejects(f.registry.search(query), errorCode('INVALID_QUERY'));
});

test('search does no source I/O and refresh defines visibility; get checks current file availability', async t => {
  const f = await folderFixture(t);
  const second = new ResourceRegistry(f.dataDir);
  await second.search('smoke');
  await fs.writeFile(path.join(f.source, 'new-smoke.png'), 'NEW', 'utf8');
  await fs.rm(path.join(f.source, '002511_soft-smoke.png'));
  const originalOpen = fs.open;
  const restoreOpen = mockFs(t, 'open', async (file, ...args) => {
    assert.ok(!path.resolve(String(file)).startsWith(f.source + path.sep), 'source contents must not be opened');
    return originalOpen(file, ...args);
  });
  const restoreOpendir = mockFs(t, 'opendir', () => { throw new Error('Queries must not enumerate directories'); });
  try {
    const before = await f.registry.search('smoke');
    assert.deepEqual(before.items.map(item => item.ref), ['fx::002511_soft-smoke.png']);
    assert.equal((await f.registry.get(before.items[0].ref)).availability, 'missing');
  } finally { restoreOpen(); restoreOpendir(); }
  await f.manager.refresh('fx');
  for (const registry of [f.registry, second]) {
    assert.deepEqual((await registry.search('smoke')).items.map(item => item.ref), ['fx::new-smoke.png']);
    await assert.rejects(registry.get('fx::002511_soft-smoke.png'), errorCode('NOT_FOUND'));
  }
});

test('failed root refresh retains the old snapshot and diagnostics; changed source cannot reuse it', async t => {
  const f = await folderFixture(t);
  const before = await f.read('index/fx.json');
  await fs.rename(f.source, f.source + '-moved');
  const failed = await f.manager.refresh('fx');
  assert.equal(failed.lastRefresh.status, 'failed');
  assert.deepEqual(failed.snapshot, before.snapshot);
  const results = await f.registry.search('smoke');
  assert.equal(results.items.length, 1);
  assert.equal(results.diagnostics[0].code, 'INDEX_REFRESH_FAILED');
  assert.equal((await f.registry.get(results.items[0].ref)).availability, 'missing');
  await assert.rejects(f.registry.get('暖橙色'), errorCode('INDEX_REFRESH_FAILED'));
  assert.equal((await f.registry.get('palette::warm-orange')).value, '#E98C3A');
  const component = await f.read('components/fx.json');
  await f.write('components/fx.json', { ...component, source: { path: f.source + '-moved' } });
  await assert.rejects(f.registry.get('fx::002511_soft-smoke.png'), errorCode('INDEX_STALE'));
  const healthy = await f.registry.search('暖橙色');
  assert.equal(healthy.items[0].value, '#E98C3A');
  assert.equal(healthy.diagnostics[0].code, 'INDEX_STALE');
  assert.equal((await f.registry.search('smoke')).items.length, 0);
  await f.manager.refresh('fx');
  assert.equal((await f.registry.get('002511')).availability, 'available');
});

test('partial directory errors and root permission errors never masquerade as complete empty indexes', async t => {
  const f = await folderFixture(t, ['ok.png', 'locked/hidden.png']);
  const original = fs.opendir;
  const restore = mockFs(t, 'opendir', async (directory, ...args) => {
    if (String(directory) === path.join(f.source, 'locked')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return original(directory, ...args);
  });
  try {
    const partial = await f.manager.refresh('fx');
    assert.equal(partial.lastRefresh.status, 'partial');
    assert.equal(partial.lastRefresh.errors, 1);
    assert.equal(partial.lastRefresh.skipped, 1);
    assert.deepEqual(partial.snapshot.entries.map(entry => entry.name), ['ok.png']);
    assert.equal((await f.registry.search('png')).diagnostics[0].code, 'INDEX_PARTIAL');
    await assert.rejects(f.registry.get('ok.png'), errorCode('INDEX_PARTIAL'));
    assert.equal((await f.registry.get('fx::ok.png')).availability, 'available');
  } finally { restore(); }
  await f.manager.refresh('fx');
  const complete = (await f.read('index/fx.json')).snapshot;
  const restoreRoot = mockFs(t, 'opendir', async (directory, ...args) => {
    if (String(directory) === f.source) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return original(directory, ...args);
  });
  try {
    const failed = await f.manager.refresh('fx');
    assert.equal(failed.lastRefresh.status, 'failed');
    assert.deepEqual(failed.snapshot, complete);
  } finally { restoreRoot(); }
});

test('queries use the complete old index during refresh and the new index after atomic publication', async t => {
  const f = await folderFixture(t, ['old.png']);
  await fs.writeFile(path.join(f.source, 'new.png'), 'NEW', 'utf8');
  const old = await fs.readFile(path.join(f.dataDir, 'index/fx.json'), 'utf8');
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = fs.opendir;
  const restore = mockFs(t, 'opendir', async (directory, ...args) => {
    if (String(directory) === f.source) { entered(); await gate; }
    return original(directory, ...args);
  });
  const refresh = f.manager.refresh('fx');
  try {
    await ready;
    assert.equal((await f.registry.search('png')).total, 1);
    assert.equal((await f.registry.get('old.png')).availability, 'available');
    assert.equal(await fs.readFile(path.join(f.dataDir, 'index/fx.json'), 'utf8'), old);
  } finally { release(); restore(); await refresh; }
  assert.equal((await f.registry.search('png')).total, 2);
  assert.ok(!(await fs.readdir(path.join(f.dataDir, 'index'))).some(name => name.endsWith('.tmp')));
});

test('source changes during a scan discard that scan instead of publishing records for a different root', async t => {
  const f = await folderFixture(t);
  const previous = await fs.readFile(path.join(f.dataDir, 'index/fx.json'), 'utf8');
  const other = path.join(f.root, 'other');
  await fs.mkdir(other);
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = fs.opendir;
  const restore = mockFs(t, 'opendir', async (directory, ...args) => {
    if (String(directory) === f.source) { entered(); await gate; }
    return original(directory, ...args);
  });
  const refresh = f.manager.refresh('fx');
  const rejected = assert.rejects(refresh, errorCode('INDEX_STALE'));
  try {
    await ready;
    await f.write('components/fx.json', { ...(await f.read('components/fx.json')), source: { path: other } });
  } finally { release(); restore(); }
  await rejected;
  assert.equal(await fs.readFile(path.join(f.dataDir, 'index/fx.json'), 'utf8'), previous);
  assert.equal((await f.registry.search('smoke')).diagnostics[0].code, 'INDEX_STALE');
});

test('get rechecks real source boundaries after an indexed directory is replaced by a junction', async t => {
  const f = await folderFixture(t, ['sub/secret.txt']);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'PRIVATE', 'utf8');
  await fs.rename(path.join(f.source, 'sub'), path.join(f.source, 'sub-saved'));
  await fs.symlink(outside, path.join(f.source, 'sub'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await f.registry.get('fx::sub/secret.txt');
  assert.equal(result.availability, 'inaccessible');
  assert.equal(result.kind, null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('invalid or escaped index records fail with diagnostics; repair is visible without restart', async t => {
  const f = await folderFixture(t);
  await f.registry.search('smoke'); // Warm cache must not conceal corruption.
  const file = path.join(f.dataDir, 'index/fx.json');
  const original = await fs.readFile(file, 'utf8');
  for (const invalid of ['{', Buffer.from([0xff]), JSON.stringify({ ...JSON.parse(original), schemaVersion: 99 })]) {
    await fs.writeFile(file, invalid, typeof invalid === 'string' ? 'utf8' : undefined);
    assert.equal((await f.registry.search('暖橙色')).diagnostics[0].code, 'INDEX_INVALID');
    await assert.rejects(f.registry.get('002511'), errorCode('INDEX_INVALID'));
  }
  await fs.writeFile(file, '\uFEFF' + original, 'utf8');
  assert.equal((await f.registry.search('smoke')).total, 1);
  const bad = JSON.parse(original);
  bad.snapshot.entries[0].relativePath = '../escape.txt';
  await assert.rejects(f.manager.store.write('index/fx.json', folderIndexSchema, bad), errorCode('CONFIG_INVALID'));
  assert.equal(await fs.readFile(file, 'utf8'), '\uFEFF' + original);
  const indexDir = path.join(f.dataDir, 'index');
  const saved = path.join(f.root, 'external-index');
  await fs.rename(indexDir, saved);
  await fs.symlink(saved, indexDir, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await f.registry.search('smoke')).diagnostics[0].code, 'INDEX_INVALID');
  await assert.rejects(f.manager.refresh('fx'), errorCode('CONFIG_INVALID'));
  assert.equal(await fs.readFile(path.join(saved, 'fx.json'), 'utf8'), '\uFEFF' + original);
});

test('search respects workspace selection, enabled flags, and invalid configuration', async t => {
  const f = await folderFixture(t);
  await f.registry.search('smoke');
  await f.manager.saveComponent({ ...(await f.read('components/fx.json')), enabled: false });
  assert.equal((await f.registry.search('smoke')).total, 0);
  await f.manager.saveWorkspace({ schemaVersion: 1, id: 'empty', name: 'Empty' });
  await f.manager.setActiveWorkspace('empty');
  assert.deepEqual(await f.registry.search('暖橙色'), { items: [], total: 0, truncated: false, diagnostics: [] });
  await f.write('workspaces/empty.json', { schemaVersion: 1, id: 'empty', name: 'Empty', componentIds: ['absent'] });
  await assert.rejects(f.registry.search('暖橙色'), errorCode('CONFIG_INVALID'));
});

test('search trims long Unicode candidates to the actual serialized MCP response bound', async t => {
  const f = await folderFixture(t, []);
  const index = await f.read('index/fx.json');
  index.snapshot.entries = Array.from({ length: 10 }, (_, i) => {
    const name = 'bounded-' + i + '.png';
    const relativePath = ('段'.repeat(90) + '/').repeat(10) + name;
    return { name, relativePath, key: relativePath, extension: '.png' };
  });
  index.lastRefresh.files = 10;
  await f.manager.store.write('index/fx.json', folderIndexSchema, index);
  const result = await f.registry.search('bounded');
  assert.equal(result.total, 10);
  assert.ok(result.items.length > 0 && result.items.length < 10);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result,
  }), 'utf8') <= 60 * 1024);
});

test('callers cannot mutate cached get results and alter later lookup or search', async t => {
  const f = await fixture(t);
  const color = await f.registry.get('暖橙色');
  color.value = '#000000';
  color.aliases.push('injected');
  assert.equal((await f.registry.get('暖橙色')).value, '#E98C3A');
  await assert.rejects(f.registry.get('injected'), errorCode('NOT_FOUND'));
  assert.equal((await f.registry.search('injected')).total, 0);
});
