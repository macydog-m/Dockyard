import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, symlink, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DockyardManager, JsonStore, resolveDataDir } from '../packages/core/dist/index.js';
import { componentSchema, configSchema } from '../packages/shared/dist/index.js';
import { fixture, errorCode } from './fixtures.mjs';

test('get resolves three resource types by key, Chinese alias, name, filename and canonical ref', async t => {
  const f = await fixture(t);
  const file = await f.registry.get(' id:002511 ');
  assert.equal(file.ref, 'demo::002511');
  assert.equal(file.type, 'file');
  assert.equal(file.source.path, path.join(f.dataDir, 'files', '002511.txt'));
  assert.equal(file.availability, 'available');
  for (const ref of ['demo::002511', '连接示例', '002511.txt', 'Dockyard 连接验证资源']) {
    assert.deepEqual(await f.registry.get(ref), file);
  }
  for (const ref of ['暖橙色', ' 常用暖橙色 ', 'WARM-ORANGE', 'warm orange', 'PALETTE::WARM-ORANGE']) {
    const color = await f.registry.get(ref);
    assert.equal(color.type, 'color');
    assert.equal(color.value, '#E98C3A');
    assert.equal(color.source, undefined);
  }
  const instruction = await f.registry.get('FX 规则');
  assert.equal(instruction.type, 'instruction');
  assert.match(instruction.content, /轮廓清晰/);
  assert.equal(instruction.value, undefined);
  await assert.rejects(f.registry.get('2511'), errorCode('NOT_FOUND'));
  await assert.rejects(f.registry.get('暖橙'), errorCode('NOT_FOUND'));
});

test('exact key takes priority over aliases; duplicate matches return bounded reusable candidates', async t => {
  const f = await fixture(t);
  const rule = await f.read('components/fx-rules.json');
  await f.manager.saveComponent({ ...rule, aliases: ['warm-orange'] });
  assert.equal((await f.registry.get('warm-orange')).type, 'color');
  const configIds = ['demo', 'palette', 'fx-rules'];
  for (let i = 0; i < 12; i++) {
    const id = 'rule-' + String(i).padStart(2, '0');
    await f.manager.saveComponent({ ...rule, id, key: 'repeated', aliases: ['重复引用'] });
    configIds.push(id);
  }
  await f.manager.setWorkspaceComponents('default', configIds);
  await assert.rejects(f.registry.get('重复引用'), error => {
    assert.equal(error.code, 'AMBIGUOUS_REF');
    assert.equal(error.details.candidates.length, 10);
    assert.equal(error.details.truncated, true);
    assert.deepEqual(Object.keys(error.details.candidates[0]).sort(), ['componentId', 'name', 'ref', 'type']);
    return true;
  });
  assert.equal((await f.registry.get('rule-00::repeated')).type, 'instruction');
});

test('duplicate keys across types never pick an arbitrary resource', async t => {
  const f = await fixture(t);
  const rule = await f.read('components/fx-rules.json');
  await f.manager.saveComponent({ ...rule, key: 'warm-orange' });
  await assert.rejects(f.registry.get('id:warm-orange'), errorCode('AMBIGUOUS_REF'));
  assert.equal((await f.registry.get('palette::warm-orange')).type, 'color');
  assert.equal((await f.registry.get('fx-rules::warm-orange')).type, 'instruction');
});

test('updates are visible without restart; disabled or unselected components cannot be bypassed', async t => {
  const f = await fixture(t);
  const palette = await f.read('components/palette.json');
  await f.manager.saveComponent({ ...palette, entries: [{ ...palette.entries[0], value: '#112233' }] });
  assert.equal((await f.registry.get('暖橙色')).value, '#112233');
  await f.manager.saveComponent({ ...palette, enabled: false });
  await assert.rejects(f.registry.get('palette::warm-orange'), errorCode('NOT_FOUND'));
  await f.manager.saveComponent(palette);
  await f.manager.setWorkspaceComponents('default', ['demo']);
  await assert.rejects(f.registry.get('palette::warm-orange'), errorCode('NOT_FOUND'));
  await f.manager.setWorkspaceComponents('default', []);
  await assert.rejects(f.registry.get('002511'), errorCode('NOT_FOUND'));
});

test('workspace switching and invalid references never fall back to My Dock', async t => {
  const f = await fixture(t);
  await f.manager.saveWorkspace({ schemaVersion: 1, id: 'colors', name: 'Colors', componentIds: ['palette'] });
  await f.manager.setActiveWorkspace('colors');
  assert.equal((await f.registry.get('暖橙色')).type, 'color');
  await assert.rejects(f.registry.get('demo::002511'), errorCode('NOT_FOUND'));
  const workspace = await f.read('workspaces/colors.json');
  await f.write('workspaces/colors.json', { ...workspace, componentIds: ['unknown'] });
  await assert.rejects(f.registry.get('暖橙色'), errorCode('CONFIG_INVALID'));
  await f.write('workspaces/colors.json', { ...workspace, id: 'wrong' });
  await assert.rejects(f.registry.get('暖橙色'), errorCode('CONFIG_INVALID'));
  const config = await f.read('config.json');
  await f.write('config.json', { ...config, activeWorkspaceId: 'unknown' });
  await assert.rejects(f.registry.get('002511'), errorCode('CONFIG_INVALID'));
});

test('get does not read source content; missing and external files have accurate availability', async t => {
  const f = await fixture(t);
  const file = await f.read('components/demo.json');
  const source = path.join(f.root, 'outside.txt');
  await writeFile(source, 'DO_NOT_RETURN_SOURCE_CONTENT', 'utf8');
  await f.manager.saveComponent({ ...file, source: { path: source } });
  const result = await f.registry.get('002511');
  assert.equal(result.availability, 'available');
  assert.equal(result.source.path, source);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_RETURN_SOURCE_CONTENT'));
  assert.equal(await readFile(source, 'utf8'), 'DO_NOT_RETURN_SOURCE_CONTENT');
  await rm(source);
  assert.equal((await f.registry.get('002511')).availability, 'missing');
});

test('failed initial Folder scan keeps its configuration and blocks unscoped uniqueness claims', async t => {
  const f = await fixture(t);
  const absent = path.join(f.root, 'not-scanned');
  await assert.rejects(f.manager.saveComponent({ schemaVersion: 1, id: 'folder', name: 'FX', type: 'folder', source: { path: absent } }), errorCode('INDEX_REFRESH_FAILED'));
  await f.manager.setWorkspaceComponents('default', ['demo', 'palette', 'folder']);
  await assert.rejects(f.registry.get('002511'), errorCode('INDEX_NOT_READY'));
  await assert.rejects(f.registry.get('folder::Smoke/002511.png'), errorCode('INDEX_NOT_READY'));
  assert.equal((await f.registry.get('demo::002511')).availability, 'available');
  await assert.rejects(f.registry.get('unknown::002511'), errorCode('NOT_FOUND'));
});

test('unsafe refs are rejected and configuration IDs cannot name paths or Windows devices', async t => {
  const f = await fixture(t);
  for (const ref of ['', ' ', '../foo', '..\\foo', '/etc/passwd', 'C:\\foo', 'id:../foo',
    'demo::../foo', 'demo::/foo', 'demo::C:/foo', 'demo::foo//bar', 'demo::foo::bar', '\0', 'x'.repeat(1091)]) {
    await assert.rejects(f.registry.get(ref), errorCode('INVALID_REF'));
  }
  for (const id of ['../x', 'con', 'nul', 'UPPER', 'x/y']) {
    await assert.rejects(f.manager.saveComponent({ ...(await f.read('components/demo.json')), id }), errorCode('CONFIG_INVALID'));
  }
});

test('strict union validation rejects wrong payloads, duplicate palette keys and overlong instruction bytes', async t => {
  const f = await fixture(t);
  const palette = await f.read('components/palette.json');
  const instruction = await f.read('components/fx-rules.json');
  const before = await readFile(path.join(f.dataDir, 'components', 'palette.json'), 'utf8');
  for (const invalid of [
    { ...palette, entries: [{ ...palette.entries[0], value: 'orange' }] },
    { ...palette, entries: [palette.entries[0], { ...palette.entries[0], key: 'WARM-ORANGE' }] },
    { ...palette, content: 'wrong payload' },
    { ...instruction, content: '中'.repeat(6000) },
  ]) {
    await assert.rejects(f.manager.saveComponent(invalid), errorCode('CONFIG_INVALID'));
  }
  assert.equal(await readFile(path.join(f.dataDir, 'components', 'palette.json'), 'utf8'), before);
});

test('UTF-8 BOM is accepted; invalid UTF-8, JSON, version and identity recover after repair', async t => {
  const f = await fixture(t);
  const file = path.join(f.dataDir, 'components', 'palette.json');
  const original = await readFile(file, 'utf8');
  await writeFile(file, '\uFEFF' + original, 'utf8');
  assert.equal((await f.registry.get('暖橙色')).value, '#E98C3A');
  for (const invalid of ['{', Buffer.from([0xff]), JSON.stringify({ ...JSON.parse(original), schemaVersion: 2 }),
    JSON.stringify({ ...JSON.parse(original), id: 'wrong' })]) {
    await writeFile(file, invalid, typeof invalid === 'string' ? 'utf8' : undefined);
    await assert.rejects(f.registry.get('暖橙色'), errorCode('CONFIG_INVALID'));
  }
  await writeFile(file, original, 'utf8');
  assert.equal((await f.registry.get('暖橙色')).value, '#E98C3A');
});

test('failed oversized save retains old bytes, clears lock and leaves no temporary files', async t => {
  const f = await fixture(t);
  const file = path.join(f.dataDir, 'components', 'demo.json');
  const original = await readFile(file, 'utf8');
  const component = JSON.parse(original);
  await assert.rejects(f.manager.saveComponent({ ...component, metadata: { huge: 'x'.repeat(1024 * 1024) } }), errorCode('CONFIG_INVALID'));
  assert.equal(await readFile(file, 'utf8'), original);
  assert.ok(!(await readdir(f.dataDir)).includes('.write-lock'));
  assert.ok(!(await readdir(path.dirname(file))).some(name => name.endsWith('.tmp')));
  await f.manager.saveComponent({ ...component, name: '恢复保存' });
  assert.equal((await f.registry.get('002511')).name, '恢复保存');
});

test('metadata directory escapes are rejected for reads and writes without changing external files', async t => {
  const f = await fixture(t);
  const components = path.join(f.dataDir, 'components');
  const saved = path.join(f.dataDir, 'components-saved');
  const outside = path.join(f.root, 'outside-components');
  await mkdir(outside);
  const original = await readFile(path.join(components, 'demo.json'), 'utf8');
  await writeFile(path.join(outside, 'demo.json'), original, 'utf8');
  await rename(components, saved);
  try {
    await symlink(outside, components, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.registry.get('002511'), errorCode('CONFIG_INVALID'));
    await assert.rejects(f.manager.saveComponent(JSON.parse(original)), errorCode('CONFIG_INVALID'));
    assert.equal(await readFile(path.join(outside, 'demo.json'), 'utf8'), original);
    const store = new JsonStore(f.dataDir);
    await assert.rejects(store.write('components/new.json', componentSchema, { ...JSON.parse(original), id: 'new' }), errorCode('CONFIG_INVALID'));
    assert.deepEqual(await readdir(outside), ['demo.json']);
  } finally {
    await rm(components, { recursive: true, force: true });
    await rename(saved, components);
  }
});

test('writer lock blocks mixed reads, serializes managers, and releases after failures', async t => {
  const f = await fixture(t);
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const held = f.manager.store.withWrite(async () => {
    started();
    await new Promise(resolve => { release = resolve; });
  });
  await ready;
  try { await assert.rejects(f.registry.get('002511'), errorCode('DATA_BUSY')); }
  finally { release(); await held; }
  const component = await f.read('components/demo.json');
  const second = new DockyardManager(f.dataDir);
  const results = await Promise.all([
    f.manager.saveComponent({ ...component, name: 'first' }),
    second.saveComponent({ ...component, name: 'second' }),
  ]);
  assert.deepEqual(results.map(value => value.revision).sort((a, b) => a - b), [2, 3]);
  assert.ok(!(await readdir(f.dataDir)).includes('.write-lock'));
  const config = await f.read('config.json');
  assert.equal(config.componentIds.filter(id => id === 'demo').length, 1);
});

test('existing or stale writer lock is surfaced instead of overwritten', async t => {
  const f = await fixture(t);
  const lock = path.join(f.dataDir, '.write-lock');
  await writeFile(lock, 'test writer', 'utf8');
  const component = await f.read('components/demo.json');
  await assert.rejects(f.manager.saveComponent(component), errorCode('DATA_BUSY'));
  await assert.rejects(f.registry.get('002511'), errorCode('DATA_BUSY'));
  assert.equal(await readFile(lock, 'utf8'), 'test writer');
  await rm(lock);
  assert.equal((await f.registry.get('002511')).availability, 'available');
});

test('removing a component updates every workspace and keeps source files intact', async t => {
  const f = await fixture(t);
  await f.manager.saveWorkspace({ schemaVersion: 1, id: 'second', name: 'Second', componentIds: ['demo'] });
  const source = path.join(f.dataDir, 'files', '002511.txt');
  const original = await readFile(source, 'utf8');
  await f.manager.removeComponent('demo');
  await assert.rejects(f.registry.get('demo::002511'), errorCode('NOT_FOUND'));
  assert.deepEqual((await f.read('workspaces/second.json')).componentIds, []);
  assert.ok(!(await f.read('config.json')).componentIds.includes('demo'));
  assert.equal(await readFile(source, 'utf8'), original);
});

test('legacy stores are not read or rewritten; fresh initialization is explicit and idempotent', async t => {
  const f = await fixture(t, { demo: false });
  await assert.rejects(f.registry.get('002511'), errorCode('DATA_UNAVAILABLE'));
  assert.deepEqual(await readdir(f.dataDir), []);
  await mkdir(path.join(f.dataDir, 'assets'));
  await writeFile(path.join(f.dataDir, 'assets', '002511.json'), '{"schemaVersion":1}', 'utf8');
  await assert.rejects(f.registry.get('002511'), errorCode('LEGACY_DATA'));
  await assert.rejects(f.manager.initialize(), errorCode('LEGACY_DATA'));
  assert.deepEqual(await readdir(f.dataDir), ['assets']);
  const fresh = new DockyardManager(path.join(f.root, 'fresh'));
  const initial = await fresh.initialize();
  assert.deepEqual(await fresh.initialize(), initial);
  assert.equal(initial.activeWorkspaceId, 'default');
  assert.deepEqual(initial.componentIds, []);
});

test('data directory resolution honors explicit paths and provides an absolute shared default', () => {
  assert.equal(resolveDataDir('.local/test'), path.resolve('.local/test'));
  assert.equal(path.isAbsolute(resolveDataDir()), true);
});

test('invalid management operations preserve existing configuration', async t => {
  const f = await fixture(t);
  const original = await f.read('config.json');
  await assert.rejects(f.manager.setActiveWorkspace('missing'), errorCode('NOT_FOUND'));
  await assert.rejects(f.manager.setWorkspaceComponents('default', ['missing']), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.manager.setWorkspaceComponents('default', ['demo', 'demo']), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.manager.saveWorkspace({ schemaVersion: 1, id: 'broken', name: 'Broken', componentIds: ['missing'] }), errorCode('CONFIG_INVALID'));
  assert.deepEqual(await f.read('config.json'), original);
  assert.equal(configSchema.safeParse(original).success, true);
});

test('invalid refs fail before filesystem access; file or missing data roots return a stable availability error', async t => {
  const f = await fixture(t, { demo: false });
  const { ResourceRegistry } = await import('../packages/core/dist/index.js');
  const absent = path.join(f.root, 'absent');
  await assert.rejects(new ResourceRegistry(absent).get('../escape'), errorCode('INVALID_REF'));
  await assert.rejects(new ResourceRegistry(absent).get('002511'), errorCode('DATA_UNAVAILABLE'));
  const fileRoot = path.join(f.root, 'not-a-directory');
  await writeFile(fileRoot, 'KEEP', 'utf8');
  await assert.rejects(new ResourceRegistry(fileRoot).get('002511'), errorCode('DATA_UNAVAILABLE'));
  await assert.rejects(new DockyardManager(fileRoot).initialize(), errorCode('DATA_UNAVAILABLE'));
  assert.equal(await readFile(fileRoot, 'utf8'), 'KEEP');
});
