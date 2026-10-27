import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ResourceRegistry } from '../packages/core/dist/index.js';
import { componentSchema, workspaceSchema, getOutputSchema, contextOutputSchema, searchOutputSchema, designCss, fontAiGuide, paletteAiGuide, colorAiGuide } from '../packages/shared/dist/index.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixture, errorCode } from './fixtures.mjs';

function palette(id = 'brand') {
  const roles = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'onPrimary'];
  const values = ['#E98C3A', '#556C60', '#B75B32', '#F7F8F6', '#FFFFFF', '#222A24', '#626D64', '#D9DED8', '#241F18'];
  return { schemaVersion: 1, id, name: '品牌配色', type: 'palette', mode: 'design', entries: roles.map((role, i) => ({
    key: role, name: role === 'primary' ? '主色' : role, role, value: values[i],
  })) };
}
function fonts(id = 'reading') {
  return { schemaVersion: 1, id, name: '阅读字体', type: 'font', entries: [
    { key: 'heading', name: '标题字体', role: 'heading', family: 'Microsoft YaHei', weight: 600, fallbacks: ['sans-serif'], size: 30 },
    { key: 'body', name: '正文字体', role: 'body', family: 'Segoe UI', weight: 400, fallbacks: ['Microsoft YaHei', 'sans-serif'], size: 16, lineHeight: 1.7 },
  ] };
}
async function setup(t) {
  const f = await fixture(t);
  await f.manager.saveComponent(palette());
  await f.manager.saveComponent(fonts());
  await f.manager.setWorkspaceDesign('default', { paletteId: 'brand', fontId: 'reading' });
  return f;
}

test('font color persists through resources and CSS while old fonts remain valid', async t => {
  const f = await fixture(t);
  const value = fonts();
  value.entries[1] = { ...value.entries[1], size: 28, weight: 700, color: '#1a5276' };
  await f.manager.saveComponent(value);
  await f.manager.setWorkspaceDesign('default', { fontId: value.id });
  const registry = new ResourceRegistry(f.dataDir);
  const body = await registry.get('reading::body');
  assert.equal(body.color, '#1a5276');
  assert.equal(body.size, 28);
  assert.equal(body.weight, 700);
  const scheme = await registry.get('reading::$scheme');
  assert.match(scheme.css, /--font-body-color: #1A5276;/);
  assert.match(scheme.css, /--font-body-size: 28px;/);
  const single = componentSchema.parse({ ...value, mode: 'single', entries: [value.entries[1]] });
  assert.match(designCss(undefined, single), /--font-heading-color: #1A5276;/);
  assert.equal(componentSchema.safeParse(fonts()).success, true);
  for (const color of ['red', '#123', '#123456;display:none']) {
    assert.equal(componentSchema.safeParse({ ...single, entries: [{ ...single.entries[0], color }] }).success, false);
  }
});
test('design schemas preserve legacy data and reject empty, oversized, duplicated or unsafe design configuration', () => {
  assert.equal(componentSchema.safeParse({ schemaVersion: 1, id: 'old', name: '色板', type: 'palette', entries: [{ key: 'orange', name: '橙', value: '#E98C3A' }] }).success, true);
  assert.equal(workspaceSchema.parse({ schemaVersion: 1, id: 'old', name: '旧工作区' }).design, undefined);
  for (const component of [
    { ...palette(), entries: [] },
    { ...palette(), entries: [{ ...palette().entries[0] }, { ...palette().entries[0], key: 'duplicate' }] },
    { ...palette(), entries: [...palette().entries, { key: 'extra', name: '多余', value: '#000000' }] },
    { ...palette(), entries: palette().entries.map((entry, i) => i === 0 ? { ...entry, key: '$SCHEME' } : entry) },
    { ...fonts(), entries: [fonts().entries[0]] },
    { ...fonts(), entries: fonts().entries.map(entry => ({ ...entry, family: 'Arial; color: red' })) },
    { ...fonts(), entries: fonts().entries.map(entry => ({ ...entry, source: { type: 'web', url: 'file:///private/font.css' } })) },
    { ...fonts(), entries: fonts().entries.map(entry => ({ ...entry, source: { type: 'web', url: 'https://user:password@example.com/font.css' } })) },
  ]) assert.equal(componentSchema.safeParse(component).success, false);
  assert.equal(workspaceSchema.safeParse({ schemaVersion: 1, id: 'test', name: 'Test', componentIds: [], design: { paletteId: 'brand' } }).success, false);
});
test('design defaults join selected components, expose bounded refs, and support complete and individual resource retrieval', async t => {
  const f = await setup(t);
  const context = await new ResourceRegistry(f.dataDir).context();
  assert.equal(contextOutputSchema.safeParse(context).success, true);
  assert.deepEqual(context.workspace.design, { paletteRef: 'brand::$scheme', fontRef: 'reading::$scheme' });
  assert.equal(context.components.find(value => value.id === 'brand').resourceCount, 9);
  assert.equal(context.components.find(value => value.id === 'reading').resourceCount, 2);
  assert.equal(JSON.stringify(context).includes('#E98C3A'), false);
  assert.equal(JSON.stringify(context).includes('Microsoft YaHei'), false);
  const brand = await f.registry.get(context.workspace.design.paletteRef);
  assert.equal(getOutputSchema.safeParse({ resource: brand }).success, true);
  assert.equal(brand.type, 'palette');
  assert.equal(brand.entries.length, 9);
  assert.match(brand.css, /--color-on-primary: #241F18/);
  assert.equal((await f.registry.get('brand')).ref, brand.ref);
  assert.equal((await f.registry.get('品牌配色')).ref, brand.ref);
  const color = await f.registry.get('brand::primary');
  assert.equal(color.role, 'primary'); assert.equal(color.value, '#E98C3A');
  const body = await f.registry.get('正文字体');
  assert.equal(body.type, 'font'); assert.equal(body.size, 16); assert.equal(body.lineHeight, 1.7);
  assert.deepEqual(body.source, { type: 'system' });
  const typography = await f.registry.get('reading::$scheme');
  assert.equal(getOutputSchema.safeParse({ resource: typography }).success, true);
  assert.match(typography.css, /--font-body: "Segoe UI", "Microsoft YaHei", sans-serif/);
  const found = await f.registry.search('Segoe UI');
  assert.equal(searchOutputSchema.safeParse(found).success, true);
  assert.equal(found.items.some(value => value.ref === 'reading::body'), true);
  assert.equal((await f.registry.search('阅读字体')).items.some(value => value.type === 'font-scheme'), true);
});
test('workspaces retain independent defaults across rename, switches and reloads; deselection clears only removed defaults', async t => {
  const f = await setup(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'other', name: '另一网页' });
  await f.manager.setWorkspaceDesign('other', { fontId: 'reading' });
  await f.manager.renameWorkspace('other', '作品集');
  await f.manager.setActiveWorkspace('other');
  assert.deepEqual((await f.registry.context()).workspace.design, { fontRef: 'reading::$scheme' });
  await assert.rejects(f.registry.get('brand::$scheme'), errorCode('NOT_FOUND'));
  await f.manager.setActiveWorkspace('default');
  await f.manager.setWorkspaceComponents('default', ['brand']);
  assert.deepEqual((await f.registry.context()).workspace.design, { paletteRef: 'brand::$scheme' });
  assert.deepEqual((await f.read('workspaces/other.json')).design, { fontId: 'reading' });
});
test('invalid default choices are rejected before writes and disabling, retyping and removal clean every workspace default', async t => {
  const f = await setup(t);
  const before = await f.read('workspaces/default.json');
  for (const design of [{ paletteId: 'reading' }, { paletteId: 'palette' }, { fontId: 'brand' }, { fontId: 'not-registered' }]) {
    await assert.rejects(f.manager.setWorkspaceDesign('default', design), errorCode('CONFIG_INVALID'));
    assert.deepEqual(await f.read('workspaces/default.json'), before);
  }
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'other', name: '其他' });
  await f.manager.setWorkspaceDesign('other', { paletteId: 'brand', fontId: 'reading' });
  await f.manager.saveComponent({ ...fonts(), enabled: false });
  for (const id of ['default', 'other']) assert.deepEqual((await f.read('workspaces/' + id + '.json')).design, { paletteId: 'brand' });
  await assert.rejects(f.manager.setWorkspaceDesign('default', { fontId: 'reading' }), errorCode('CONFIG_INVALID'));
  await f.manager.saveComponent({ ...palette(), mode: 'swatches' });
  assert.deepEqual((await f.read('workspaces/default.json')).design, {});
  await f.manager.saveComponent(palette());
  await f.manager.setWorkspaceDesign('default', { paletteId: 'brand' });
  await f.manager.setWorkspaceDesign('other', { paletteId: 'brand' });
  await f.manager.removeComponent('brand');
  for (const id of ['default', 'other']) {
    const workspace = await f.read('workspaces/' + id + '.json');
    assert.deepEqual(workspace.design, {}); assert.equal(workspace.componentIds.includes('brand'), false);
  }
  assert.equal((await f.read('components/brand.json')).name, '品牌配色');
});
test('font loading details preserve source paths without reading font contents and CSS describes required assets', async t => {
  const f = await setup(t);
  const filename = path.join(f.dataDir, '中文字体.woff2');
  await writeFile(filename, 'DO_NOT_RETURN_FONT_CONTENT', 'utf8');
  const value = fonts();
  value.entries[0].source = { type: 'file', path: '中文字体.woff2' };
  value.entries[1].source = { type: 'web', url: 'https://fonts.example.com/reading.css' };
  await f.manager.saveComponent(value);
  const heading = await f.registry.get('reading::heading');
  assert.equal(heading.source.path, filename); assert.equal(heading.availability, 'available');
  assert.equal(JSON.stringify(heading).includes('DO_NOT_RETURN_FONT_CONTENT'), false);
  const scheme = await f.registry.get('reading::$scheme');
  assert.match(scheme.css, /^@import url\("https:\/\/fonts.example.com\/reading.css"\)/);
  assert.match(scheme.css, /@font-face/); assert.match(scheme.css, /font-display: swap/);
  assert.ok(scheme.css.includes('heading-' + encodeURIComponent('中文字体.woff2')));
  const missing = fonts(); missing.entries[0].source = { type: 'file', path: 'missing.woff2' };
  await f.manager.saveComponent(missing);
  assert.equal((await f.registry.get('reading::heading')).availability, 'missing');
  const parsed = componentSchema.parse(value);
  const css = designCss(palette(), parsed);
  assert.match(css, /--color-primary: #E98C3A/);
  assert.match(css, /--font-body-size: 16px/);
  assert.match(css, /--font-body-line-height: 1.7/);
});
test('stdio MCP exposes default refs and schema-valid whole design resources using the existing three tools', async t => {
  const f = await setup(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('packages/mcp/dist/index.js'), '--data-dir', f.dataDir], stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'design-check', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(value => value.name).sort(), ['context', 'get', 'search']);
    const context = await client.callTool({ name: 'context', arguments: {} });
    const ref = context.structuredContent.workspace.design.fontRef;
    const result = await client.callTool({ name: 'get', arguments: { ref } });
    assert.equal(result.isError, undefined);
    assert.equal(getOutputSchema.safeParse(result.structuredContent).success, true);
    assert.equal(result.structuredContent.resource.type, 'font-scheme');
    assert.match(client.getInstructions(), /default design scheme refs/);
  } finally { await client.close(); await transport.close(); }
});

test('oversized retyping cannot clear existing design defaults or replace the saved component', async t => {
  const f = await setup(t);
  const before = await f.read('workspaces/default.json');
  const old = await f.read('components/brand.json');
  const candidate = { ...palette(), mode: 'swatches', entries: Array.from({ length: 400 }, (_, i) => ({
    key: 'custom-' + i, name: '自定义颜色 ' + i, value: '#123456', description: '说明'.repeat(2048),
  })) };
  await assert.rejects(f.manager.saveComponent(candidate), errorCode('CONFIG_INVALID'));
  assert.deepEqual(await f.read('workspaces/default.json'), before);
  assert.deepEqual(await f.read('components/brand.json'), old);
});

test('CSS uses distinct role paths for font sources with identical filenames', () => {
  const value = fonts();
  value.entries[0].source = { type: 'file', path: 'C:/Serif/Regular.woff2' };
  value.entries[1].source = { type: 'file', path: 'C:/Sans/Regular.woff2' };
  const css = designCss(undefined, componentSchema.parse(value));
  assert.match(css, /fonts\/heading-Regular.woff2/);
  assert.match(css, /fonts\/body-Regular.woff2/);
});

test('single-font resources keep one body entry and derive matching heading CSS without duplicate font loads', async t => {
  const f = await fixture(t);
  const single = { ...fonts('single'), mode: 'single', entries: [fonts().entries[1]] };
  single.entries[0].source = { type: 'file', path: 'Single.woff2' };
  assert.equal(componentSchema.safeParse(single).success, true);
  assert.equal(componentSchema.safeParse({ ...single, entries: fonts().entries }).success, false);
  assert.equal(componentSchema.safeParse({ ...single, mode: 'pairing' }).success, false);
  assert.equal(componentSchema.safeParse({ ...single, mode: undefined }).success, false);
  await f.manager.saveComponent(single);
  await f.manager.setWorkspaceDesign('default', { fontId: 'single' });
  assert.deepEqual((await f.registry.context()).workspace.design, { fontRef: 'single::$scheme' });
  const result = await f.registry.get('single::$scheme');
  assert.equal(getOutputSchema.safeParse({ resource: result }).success, true);
  assert.equal(result.entries.length, 1);
  assert.match(result.css, /--font-heading: "Segoe UI", "Microsoft YaHei", sans-serif/);
  assert.match(result.css, /--font-heading-weight: 600/);
  assert.equal(result.css.match(/@font-face/g).length, 1);
  assert.equal((await f.registry.get('single::body')).family, 'Segoe UI');
  await assert.rejects(f.registry.get('single::heading'), errorCode('NOT_FOUND'));
});

test('minimal font AI text identifies a named scheme whose details remain queryable on demand', async t => {
  const f = await fixture(t);
  const filename = path.join(f.dataDir, '字体文件.woff2');
  await writeFile(filename, 'FONT_SOURCE', 'utf8');
  const value = fonts();
  value.entries[0] = { ...value.entries[0], key: 'display-regular', source: { type: 'file', path: filename } };
  value.entries[1].source = { type: 'web', url: 'https://fonts.example.com/body.css' };
  await f.manager.saveComponent(value);
  await f.manager.setWorkspaceComponents('default', ['reading']);
  const guide = fontAiGuide(value);
  assert.equal(guide, '请使用 Dockyard 中的字体 "阅读字体"。');
  const scheme = await f.registry.get(value.name);
  assert.equal(scheme.ref, 'reading::$scheme');
  assert.equal(scheme.entries.find(entry => entry.key === 'display-regular').source.path, filename);
  assert.equal(scheme.entries.find(entry => entry.role === 'body').source.url, value.entries[1].source.url);
  assert.match(scheme.css, /@font-face/);
  const local = await f.registry.get(scheme.componentId + '::display-regular');
  assert.equal(local.availability, 'available');
});

test('color combinations allow one to nine arbitrary colors and minimal copied names or IDs resolve on demand', async t => {
  const f = await fixture(t);
  const entries = Array.from({ length: 9 }, (_, i) => ({ key: 'color-' + i, name: '自定义颜色 ' + i, value: '#123456' }));
  for (const count of [1, 3, 9]) {
    const value = { ...palette('flexible-' + count), name: '自由组合 ' + count, entries: entries.slice(0, count) };
    assert.equal(componentSchema.safeParse(value).success, true);
    await f.manager.saveComponent(value);
    await f.manager.setWorkspaceDesign('default', { paletteId: value.id });
    const result = await f.registry.get(value.name);
    assert.equal(getOutputSchema.safeParse({ resource: result }).success, true);
    assert.equal(result.entries.length, count);
    assert.equal(result.entries.some(entry => entry.role !== undefined), false);
    assert.equal(paletteAiGuide(value), '请使用 Dockyard 中的颜色组合 ' + JSON.stringify(value.name) + '。');
    assert.equal((await f.registry.get(value.id)).ref, result.ref);
  }
  const first = { ...palette('named-a'), name: '同名组合', entries: [entries[0]] };
  const second = { ...first, id: 'named-b' };
  await f.manager.saveComponent(first); await f.manager.saveComponent(second);
  await f.manager.setWorkspaceComponents('default', ['named-a', 'named-b']);
  await assert.rejects(f.registry.get('同名组合'), errorCode('AMBIGUOUS_REF'));
  assert.equal(paletteAiGuide(second, second.id), '请使用 Dockyard 中的颜色组合 "named-b"。');
  assert.equal((await f.registry.get(second.id)).componentId, second.id);
  assert.equal(colorAiGuide(entries[0]), '请使用 Dockyard 中的颜色 "自定义颜色 0"。');
  const ref = second.id + '::' + entries[0].key;
  assert.equal(colorAiGuide(entries[0], ref), '请使用 Dockyard 中的颜色 ' + JSON.stringify(ref) + '。');
  assert.equal((await f.registry.get(ref)).value, '#123456');
  await assert.rejects(f.manager.saveComponent({ ...first, entries: [] }), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.manager.saveComponent({ ...first, entries: [...entries, { key: 'tenth', name: '第十个', value: '#000000' }] }), errorCode('CONFIG_INVALID'));
  assert.equal((await f.read('components/named-a.json')).entries.length, 1);
});


test('pausing a design preserves its default and remains paused when the other default changes', async t => {
  const f = await setup(t);
  await f.manager.setWorkspaceComponentEnabled('default', 'brand', false);
  assert.deepEqual((await f.registry.context()).workspace.design, { fontRef: 'reading::$scheme' });
  await assert.rejects(f.registry.get('brand::$scheme'), errorCode('NOT_FOUND'));
  await f.manager.saveComponent(fonts('other-font'));
  await f.manager.setWorkspaceDesign('default', { paletteId: 'brand', fontId: 'other-font' });
  assert.deepEqual((await f.read('workspaces/default.json')).disabledComponentIds, ['brand']);
  assert.deepEqual((await f.registry.context()).workspace.design, { fontRef: 'other-font::$scheme' });
  assert.deepEqual((await f.read('workspaces/default.json')).design, { paletteId: 'brand', fontId: 'other-font' });
  await f.manager.setWorkspaceComponentEnabled('default', 'brand', true);
  assert.deepEqual((await f.registry.context()).workspace.design, { paletteRef: 'brand::$scheme', fontRef: 'other-font::$scheme' });
});
