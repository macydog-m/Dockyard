import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ResourceRegistry } from '../packages/core/dist/index.js';
import { componentSchema, getOutputSchema, contextOutputSchema, searchOutputSchema } from '../packages/shared/dist/index.js';
import { fixture, errorCode } from './fixtures.mjs';

const resourceItem = (key, target, enabled = true) => ({ key, label: key, kind: 'resource', target, default: enabled });
const configuration = (items, id = 'config-a') => ({ schemaVersion: 1, id, name: id, type: 'configuration', items });
async function add(f, definition, id = 'default') {
  return f.manager.importConfiguration(id, (await f.read('workspaces/' + id + '.json')).revision, definition);
}
async function change(f, values, id = 'default', componentId = 'config-a') {
  return f.manager.updateConfiguration(id, componentId, (await f.read('workspaces/' + id + '.json')).revision,
    (await f.read('components/' + componentId + '.json')).revision, { type: 'saveValues', presetId: 'default', values });
}
async function hidden(registry, ref, query) {
  await assert.rejects(registry.get(ref), errorCode('NOT_FOUND'));
  assert.equal((await registry.search(query)).total, 0);
}

test('resource switches override legacy membership and expose references without duplicating definitions or workspace state', async t => {
  const f = await fixture(t);
  const original = await f.read('components/fx-rules.json');
  await add(f, configuration([resourceItem('rules', 'fx-rules', false), resourceItem('asset', 'demo::002511', false)]));
  assert.ok((await f.read('workspaces/default.json')).componentIds.includes('fx-rules'));
  await hidden(f.registry, 'fx-rules::fx-rules', 'FX Design Rules');
  await hidden(f.registry, 'demo::002511', '002511');
  assert.ok(!(await f.registry.context()).components.some(component => ['fx-rules', 'demo'].includes(component.id)));
  assert.deepEqual((await f.registry.get('config-a::$current')).items, []);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'other', name: 'Other', componentIds: ['config-a'] });
  await change(f, { rules: true }, 'other');
  const fixed = new ResourceRegistry(f.dataDir, { workspaceId: 'other' });
  assert.equal((await fixed.get('fx-rules')).type, 'instruction');
  await hidden(f.registry, 'fx-rules', 'FX Design Rules');
  assert.deepEqual(await f.read('components/fx-rules.json'), original, 'Workspace changes never mutate the shared resource enabled flag');
  await f.manager.setActiveWorkspace('other');
  assert.equal((await f.registry.get('fx-rules')).type, 'instruction');
  await f.manager.setActiveWorkspace('default');
  await hidden(f.registry, 'fx-rules', 'FX Design Rules');
  await change(f, { rules: true, asset: true });
  const current = await f.registry.get('config-a::$current');
  assert.deepEqual(current.items.map(item => item.target), ['fx-rules', 'demo::002511']);
  assert.ok(!JSON.stringify(current).includes(original.content));
  getOutputSchema.parse({ resource: current });
  contextOutputSchema.parse(await f.registry.context());
  searchOutputSchema.parse(await f.registry.search('FX'));
});

test('resource-select exposes only the selected exact ref and invalidates cached get, search, context and default design refs', async t => {
  const f = await fixture(t);
  const palette = await f.read('components/palette.json');
  await f.manager.saveComponent({ ...palette, mode: 'design' });
  await f.manager.setWorkspaceDesign('default', { paletteId: 'palette' });
  await add(f, configuration([{ key: 'style', label: 'Style', kind: 'resource-select', default: 'warm', options: [
    { value: 'warm', label: 'Warm', target: 'palette::warm-orange' },
    { value: 'cream', label: 'Cream', target: 'palette::cream' },
    { value: 'scheme', label: 'Complete scheme', target: 'palette::$scheme' },
  ] }]));
  assert.equal((await f.registry.get('palette::warm-orange')).value, '#E98C3A');
  await hidden(f.registry, 'palette::cream', 'Cream');
  await assert.rejects(f.registry.get('palette::$scheme'), errorCode('NOT_FOUND'));
  let context = await f.registry.context();
  assert.equal(context.components.find(component => component.id === 'palette').resourceCount, 1);
  assert.ok(!context.workspace.design?.paletteRef);
  await change(f, { style: 'cream' });
  await hidden(f.registry, 'palette::warm-orange', 'Warm Orange');
  assert.equal((await f.registry.get('palette::cream')).value, '#FFF4DD');
  const selected = (await f.registry.get('config-a::$current')).items[0];
  assert.equal(selected.target, 'palette::cream');
  assert.ok(!('options' in selected));
  await change(f, { style: 'scheme' });
  assert.equal((await f.registry.get('palette::$scheme')).entries.length, 2);
  assert.equal((await f.registry.context()).workspace.design.paletteRef, 'palette::$scheme');
  await hidden(f.registry, 'palette::cream', 'Cream');
  await change(f, { style: null });
  assert.ok(!(await f.registry.context()).components.some(component => component.id === 'palette'));
  assert.deepEqual((await f.registry.get('config-a::$current')).items, []);
});

test('multiple configurations union enabled refs; paused containers keep ownership, while resource pause is a hard limit', async t => {
  const f = await fixture(t);
  await add(f, configuration([resourceItem('partial', 'palette::cream'), resourceItem('rules', 'fx-rules', false)]));
  await add(f, configuration([resourceItem('all', 'palette'), resourceItem('rules', 'fx-rules')], 'config-b'));
  assert.equal((await f.registry.get('palette::warm-orange')).type, 'color');
  await f.manager.setWorkspaceComponentEnabled('default', 'config-b', false);
  await hidden(f.registry, 'palette::warm-orange', 'Warm Orange');
  await hidden(f.registry, 'fx-rules', 'FX Design Rules');
  assert.equal((await f.registry.get('palette::cream')).type, 'color');
  await f.manager.setWorkspaceComponentEnabled('default', 'config-a', false);
  await hidden(f.registry, 'palette::cream', 'Cream');
  await f.manager.setWorkspaceComponentEnabled('default', 'config-b', true);
  assert.equal((await f.registry.get('palette::cream')).type, 'color');
  await f.manager.setWorkspaceComponentEnabled('default', 'palette', false);
  await hidden(f.registry, 'palette::cream', 'Cream');
  assert.ok(!(await f.registry.get('config-b::$current')).items.some(item => item.target === 'palette'));
  await f.manager.setWorkspaceComponentEnabled('default', 'palette', true);
  assert.equal((await f.registry.get('palette::cream')).type, 'color');
  const rule = await f.read('components/fx-rules.json');
  await f.manager.saveComponent({ ...rule, enabled: false });
  await hidden(f.registry, 'fx-rules', 'FX Design Rules');
  assert.ok(!(await f.registry.get('config-b::$current')).items.some(item => item.target === 'fx-rules'));
  const second = await f.read('components/config-b.json');
  await f.manager.saveComponent({ ...second, enabled: false });
  await hidden(f.registry, 'palette::cream', 'Cream');
  await f.manager.setWorkspaceComponents('default', ['palette']);
  assert.equal((await f.registry.get('palette::warm-orange')).type, 'color', 'Removing the containers restores legacy direct membership');
});

test('folder references filter index results and counts and only active targets trigger index diagnostics', async t => {
  const f = await fixture(t);
  const folder = path.join(f.root, 'assets');
  await mkdir(folder);
  await writeFile(path.join(folder, 'keep.txt'), 'keep', 'utf8');
  await writeFile(path.join(folder, 'hidden.txt'), 'hidden', 'utf8');
  await f.manager.saveComponent({ schemaVersion: 1, id: 'assets', name: 'Assets', type: 'folder', source: { path: folder } });
  await add(f, configuration([resourceItem('one', 'assets::keep.txt'), resourceItem('all', 'assets', false)]));
  assert.equal((await f.registry.get('assets::keep.txt')).type, 'file');
  await hidden(f.registry, 'assets::hidden.txt', 'hidden');
  assert.equal((await f.registry.context()).components.find(component => component.id === 'assets').resourceCount, 1);
  await change(f, { one: false, all: true });
  assert.equal((await f.registry.get('assets::hidden.txt')).type, 'file');
  assert.equal((await f.registry.context()).components.find(component => component.id === 'assets').resourceCount, 2);
  await change(f, { one: false, all: false });
  const stored = await f.read('components/assets.json');
  await f.write('components/assets.json', { ...stored, source: { path: folder + '-moved' } });
  assert.deepEqual((await f.registry.context()).diagnostics, []);
  await change(f, { one: true, all: false });
  assert.equal((await f.registry.context()).diagnostics[0].code, 'INDEX_STALE');
});

test('invalid or nested targets, deletion and key changes cannot silently broaden or break the visible scope', async t => {
  const f = await fixture(t);
  const before = await f.read('config.json');
  for (const target of ['missing', 'demo::missing', 'palette::$scheme', 'demo::002511/../secret', 'C:/secret', 'FX Design Rules']) {
    await assert.rejects(add(f, configuration([resourceItem('bad', target)])), errorCode('CONFIG_INVALID'));
    assert.deepEqual(await f.read('config.json'), before);
  }
  await assert.rejects(add(f, configuration([resourceItem('self', 'config-a')])), errorCode('CONFIG_INVALID'));
  await add(f, configuration([resourceItem('rule', 'fx-rules::fx-rules'), { key: 'speed', label: 'Speed', kind: 'number', default: 1 }]));
  await assert.rejects(add(f, configuration([resourceItem('nested', 'config-a')], 'nested')), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.manager.removeComponent('fx-rules'), errorCode('CONFIG_INVALID'));
  const rule = await f.read('components/fx-rules.json');
  await assert.rejects(f.manager.saveComponent({ ...rule, key: 'renamed' }), errorCode('CONFIG_INVALID'));
  assert.deepEqual(await f.read('components/fx-rules.json'), rule);
  await change(f, { rule: true, speed: 3 });
  const stored = await f.read('components/config-a.json');
  await f.manager.saveComponent({ ...stored, items: stored.items.filter(item => item.key !== 'rule') });
  const values = (await f.read('workspaces/default.json')).configurations['config-a'].presets[0].values;
  assert.deepEqual(values, { speed: 3 }, 'Removing an item prunes just that saved value');
  await assert.rejects(f.manager.saveComponent(stored), errorCode('DATA_BUSY'), 'Stale shared definitions are rejected');
  await f.manager.removeComponent('fx-rules');
  const current = await f.read('components/config-a.json');
  await f.write('components/config-a.json', { ...current, items: [resourceItem('broken', 'fx-rules'), ...current.items] });
  for (const action of [() => f.registry.context(), () => f.registry.search('Warm Orange'), () => f.registry.get('demo::002511')]) {
    await assert.rejects(action(), errorCode('CONFIG_INVALID'));
  }
});

test('resource item schema rejects wrong controls, ambiguous targets and invalid options', () => {
  assert.ok(componentSchema.safeParse(configuration([resourceItem('asset', 'demo')])).success);
  for (const item of [
    { ...resourceItem('asset', 'demo'), control: 'slider' },
    { ...resourceItem('asset', 'demo'), default: 'true' },
    { key: 'select', label: 'Select', kind: 'resource-select', default: 'no', options: [{ value: 'one', label: 'One', target: 'demo' }] },
    { key: 'select', label: 'Select', kind: 'resource-select', default: null, options: [{ value: 'one', label: 'One', target: 'demo' }, { value: 'one', label: 'Two', target: 'palette' }] },
    { key: 'slider', label: 'Slider', kind: 'number', control: 'slider', default: 1 },
  ]) assert.equal(componentSchema.safeParse(configuration([item])).success, false);
});
