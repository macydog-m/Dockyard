import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { componentSchema, workspaceSchema, resolveConfigurationValues, getOutputSchema } from '../packages/shared/dist/index.js';
import { ResourceRegistry, DockyardManager } from '../packages/core/dist/index.js';
import { fixture, errorCode } from './fixtures.mjs';

export const definition = {
  schemaVersion: 1, id: 'animation', name: 'Animation settings', type: 'configuration',
  aiInstructions: 'Use these settings only when requested.',
  items: [
    { key: 'bounce', label: 'Bounce', kind: 'number', control: 'slider', default: 50, min: 0, max: 100, step: 5, description: '0 is rigid; 100 is strongest bounce.' },
    { key: 'reuse', label: 'Reuse bones', kind: 'boolean', control: 'toggle', default: true },
    { key: 'loop', label: 'Loop', kind: 'boolean', control: 'checkbox', default: false },
    { key: 'mode', label: 'Mode', kind: 'select', default: 'idle', options: [{ value: 'idle', label: 'Idle' }, { value: 'walk', label: 'Walk' }] },
    { key: 'duration', label: 'Seconds', kind: 'number', control: 'number', default: 0.3, min: 0.1, step: 0.1 },
    { key: 'output', label: 'Output path', kind: 'text', default: './out' },
  ],
};
async function setup(t) {
  const f = await fixture(t);
  await f.manager.importConfiguration('default', (await f.read('workspaces/default.json')).revision, definition);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'second', name: 'Second', componentIds: ['animation'] });
  return { ...f, change: async (id, action) => f.manager.updateConfiguration(id, 'animation',
    (await f.read('workspaces/' + id + '.json')).revision, (await f.read('components/animation.json')).revision, action) };
}

test('preset components are independent, allow empty panels, validate colors and preserve AI information', async t => {
  const f = await setup(t);
  await f.change('default', { type: 'createPreset', id: 'blank', name: 'Blank', items: [] });
  assert.deepEqual((await f.registry.get('animation::$current')).items, []);
  const items = [{ key: 'accent', label: 'Accent', kind: 'text', control: 'color', default: '#336699', aiInstructions: 'Use as the accent color.' }];
  await f.change('default', { type: 'saveItems', id: 'blank', items });
  await f.change('default', { type: 'saveValues', presetId: 'blank', values: { accent: '#ff9900' } });
  await assert.rejects(f.change('default', { type: 'saveValues', presetId: 'blank', values: { accent: 'red' } }), errorCode('CONFIG_INVALID'));
  assert.equal((await f.registry.get('animation::$current')).items[0].aiInstructions, 'Use as the accent color.');
  await f.change('default', { type: 'createPreset', id: 'copy', name: 'Copy', copyFrom: 'blank' });
  await f.change('default', { type: 'saveItems', id: 'copy', items: [] });
  assert.deepEqual((await f.registry.get('animation::$current')).items, []);
  await f.change('default', { type: 'switchPreset', id: 'blank' });
  assert.equal((await f.registry.get('animation::$current')).items[0].value, '#ff9900');
  await f.manager.saveComponent({ ...(await f.read('components/animation.json')), items: [definition.items[0]] });
  assert.equal((await f.registry.get('animation::$current')).items[0].value, '#ff9900', 'base definition edits preserve independent panels');
  await f.change('default', { type: 'switchPreset', id: 'default' });
  assert.equal((await f.registry.get('animation::$current')).items[0].key, 'bounce');
  assert.equal((await new ResourceRegistry(f.dataDir, { workspaceId: 'second' }).get('animation::$current')).items[0].key, 'bounce');
});

test('preset-only resource references are loaded, filtered, validated and protected from deletion', async t => {
  const f = await setup(t);
  await f.manager.saveComponent({ schemaVersion: 1, id: 'preset-rule', name: 'Rule', type: 'instruction', key: 'rule', content: 'Keep names stable.' });
  await f.change('default', { type: 'createPreset', id: 'blank', name: 'Blank', items: [] });
  const item = { key: 'rule', label: 'Rule', kind: 'resource', target: 'preset-rule', default: true };
  await f.change('default', { type: 'saveItems', id: 'blank', items: [item] });
  assert.equal((await f.registry.get('preset-rule::rule')).content, 'Keep names stable.');
  await assert.rejects(f.manager.removeComponent('preset-rule'), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.change('default', { type: 'saveItems', id: 'blank', items: [{ ...item, target: 'missing' }] }), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.change('default', { type: 'saveItems', id: 'blank', items: [{ ...item, target: 'animation' }] }), errorCode('CONFIG_INVALID'));
  const workspace = await f.read('workspaces/default.json');
  workspace.configurations.animation.presets.find(preset => preset.id === 'blank').items = [{ ...item, target: 'missing' }];
  await assert.rejects(f.manager.saveWorkspace(workspace), errorCode('CONFIG_INVALID'));
  await f.change('default', { type: 'switchPreset', id: 'default' });
  await assert.rejects(f.registry.get('preset-rule::rule'), errorCode('NOT_FOUND'));
  await f.change('default', { type: 'switchPreset', id: 'blank' });
  await f.change('default', { type: 'saveItems', id: 'blank', items: [] });
  await f.manager.removeComponent('preset-rule');
});

test('configuration definitions validate types, keys, defaults, ranges, steps and options without code', () => {
  assert.equal(componentSchema.parse(definition).type, 'configuration');
  const invalid = [
    { ...definition, code: 'alert(1)' },
    { ...definition, items: [...definition.items, definition.items[0]] },
    ...[
      { key: 'constructor' }, { key: '__proto__' }, { default: 101 }, { step: 0 }, { step: -1 },
      { default: 52 }, { min: 110 }, { default: '50' }, { render: 'script' }, { step: 1e20 }, { default: 1e-9, step: 1 },
    ].map(changes => ({ ...definition, items: [{ ...definition.items[0], ...changes }] })),
    { ...definition, items: [{ ...definition.items[3], default: 'missing' }] },
    { ...definition, items: [{ ...definition.items[3], options: [{ value: 'idle', label: 'A' }, { value: 'idle', label: 'B' }] }] },
  ];
  for (const value of invalid) assert.equal(componentSchema.safeParse(value).success, false, JSON.stringify(value));
  for (const values of [{ bounce: 51 }, { bounce: 105 }, { reuse: 'true' }, { mode: 'run' }, { duration: 0.15 }, { unknown: 1 }, { output: 5 }]) {
    assert.throws(() => resolveConfigurationValues(definition.items, values));
  }
  assert.equal(resolveConfigurationValues(definition.items, { duration: 0.3 }).duration, 0.3);
  assert.equal(workspaceSchema.safeParse({ schemaVersion: 1, id: 'old', name: 'Old' }).success, true);
});

test('workspace values and presets are independent, persistent, bounded, and invalidate registry cache', async t => {
  const f = await setup(t);
  const fixed = new ResourceRegistry(f.dataDir, { workspaceId: 'default' });
  assert.equal((await fixed.get('animation::$current')).items.find(item => item.key === 'bounce').value, 50);
  await f.change('default', { type: 'saveValues', presetId: 'default', values: { bounce: 80 } });
  await f.change('second', { type: 'saveValues', presetId: 'default', values: { bounce: 30 } });
  await f.manager.setActiveWorkspace('second');
  assert.equal((await f.registry.get('animation::$current')).items.find(item => item.key === 'bounce').value, 30);
  assert.equal((await fixed.get('animation::$current')).items.find(item => item.key === 'bounce').value, 80);
  await f.manager.setActiveWorkspace('default');
  assert.equal((await f.registry.get('animation::$current')).items.find(item => item.key === 'bounce').value, 80);
  await f.change('default', { type: 'createPreset', id: 'copy', name: 'Export 02', copyFrom: 'default' });
  await f.change('default', { type: 'saveValues', presetId: 'copy', values: { bounce: 15 } });
  await f.change('default', { type: 'renamePreset', id: 'copy', name: 'Walking' });
  assert.equal((await fixed.get('animation::$current')).preset.name, 'Walking');
  await f.change('default', { type: 'switchPreset', id: 'default' });
  assert.equal((await fixed.get('animation::$current')).items.find(item => item.key === 'bounce').value, 80);
  await f.change('default', { type: 'switchPreset', id: 'copy' });
  const restarted = new ResourceRegistry(f.dataDir);
  assert.equal((await restarted.get('animation::$current')).items.find(item => item.key === 'bounce').value, 15);
  await f.change('default', { type: 'deletePreset', id: 'copy' });
  assert.equal((await fixed.get('animation::$current')).items.find(item => item.key === 'bounce').value, 80);
  await assert.rejects(f.change('default', { type: 'deletePreset', id: 'default' }), errorCode('CONFIG_INVALID'));
  await f.change('default', { type: 'createPreset', id: 'fresh', name: 'Fresh' });
  assert.equal((await fixed.get('animation::$current')).items.find(item => item.key === 'bounce').value, 50);
  await assert.rejects(f.change('default', { type: 'createPreset', id: 'fresh2', name: 'Fresh' }), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.change('default', { type: 'switchPreset', id: 'missing' }), errorCode('NOT_FOUND'));
  const component = await f.read('components/animation.json');
  assert.ok(!('configuration' in component)); assert.ok(!('values' in component));
  const snapshot = await f.read('workspaces/default.json');
  const otherManager = new DockyardManager(f.dataDir);
  const results = await Promise.allSettled([f.manager, otherManager].map(manager => manager.updateConfiguration('default', 'animation', snapshot.revision, component.revision, { type: 'renamePreset', id: 'fresh', name: 'Concurrent' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DATA_BUSY');
  await assert.rejects(f.manager.updateConfiguration('default', 'animation', (await f.read('workspaces/default.json')).revision, 999, { type: 'switchPreset', id: 'default' }), errorCode('DATA_BUSY'));
});

test('invalid values, shared definition changes, disabled scope and corrupt data fail closed', async t => {
  const f = await setup(t);
  await f.change('default', { type: 'saveValues', presetId: 'default', values: { bounce: 80 } });
  const before = await f.read('workspaces/default.json');
  await assert.rejects(f.change('default', { type: 'saveValues', presetId: 'default', values: { bounce: 81 } }), errorCode('CONFIG_INVALID'));
  assert.deepEqual(await f.read('workspaces/default.json'), before);
  await assert.rejects(f.manager.saveComponent({ ...definition, items: [{ ...definition.items[0], max: 60 }] }), errorCode('CONFIG_INVALID'));
  await assert.rejects(f.manager.importConfiguration('second', 1, definition), errorCode('CONFIG_INVALID'));
  await f.manager.setWorkspaceComponentEnabled('default', 'animation', false);
  assert.ok(!(await f.registry.context()).components.some(component => component.id === 'animation'));
  await assert.rejects(f.registry.get('animation::$current'), errorCode('NOT_FOUND'));
  await assert.rejects(f.change('default', { type: 'switchPreset', id: 'default' }), errorCode('NOT_FOUND'));
  await f.manager.setWorkspaceComponentEnabled('default', 'animation', true);
  await f.manager.setWorkspaceComponents('default', []);
  await assert.rejects(f.registry.get('animation::$current'), errorCode('NOT_FOUND'));
  await f.manager.setWorkspaceComponents('default', ['animation']);
  assert.equal((await f.registry.get('animation::$current')).items.find(item => item.key === 'bounce').value, 80);
  await f.write('workspaces/default.json', { ...before, configurations: { animation: { activePresetId: 'missing', presets: [] } } });
  await assert.rejects(f.registry.get('animation::$current'), errorCode('CONFIG_INVALID'));
  assert.equal((await new ResourceRegistry(f.dataDir, { workspaceId: 'second' }).get('animation::$current')).items.find(item => item.key === 'bounce').value, 50);
});

test('MCP configuration summaries omit values; get exposes live current values and meanings with stable tools', async t => {
  const f = await setup(t);
  const client = new Client({ name: 'configuration-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../packages/mcp/dist/index.js', import.meta.url)), '--data-dir', f.dataDir, '--workspace-id', 'default'], stderr: 'pipe' }));
  const toolDefinitions = await client.listTools();
  const context = (await client.callTool({ name: 'context', arguments: {} })).structuredContent;
  assert.equal(context.components.find(component => component.id === 'animation').currentRef, 'animation::$current');
  assert.ok(!JSON.stringify(context).includes('bounce'));
  const search = (await client.callTool({ name: 'search', arguments: { query: 'Animation settings' } })).structuredContent;
  assert.equal(search.items[0].ref, 'animation::$current');
  assert.ok(!JSON.stringify(search).includes('bounce'));
  await f.change('default', { type: 'saveValues', presetId: 'default', values: { bounce: 90 } });
  const result = await client.callTool({ name: 'get', arguments: { ref: 'animation::$current' } });
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.resource.items.find(item => item.key === 'bounce').value, 90);
  assert.match(result.structuredContent.resource.items[0].description, /rigid/);
  assert.deepEqual(await client.listTools(), toolDefinitions);
  assert.equal((await client.callTool({ name: 'get', arguments: { ref: 'animation::$current', workspaceId: 'second' } })).isError, true);
});

test('Desktop command boundary permits validated configuration operations only', async () => {
  const bundle = await build({ entryPoints: ['apps/desktop/src/contracts.ts'], platform: 'node', format: 'esm', bundle: true, write: false });
  const { commandSchema } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const command = { type: 'configuration', id: 'default', componentId: 'animation', expectedRevision: 1, definitionRevision: 1, action: { type: 'saveValues', presetId: 'default', values: { bounce: 30 } } };
  assert.ok(commandSchema.safeParse(command).success);
  for (const extra of [{ arbitraryPath: 'anything' }, { sessionId: 'someone' }, { action: { type: 'execute', code: 'anything' } }]) assert.ok(!commandSchema.safeParse({ ...command, ...extra }).success);
});

test('valid component IDs matching Object properties never read inherited configuration state', async t => {
  const f = await setup(t);
  const workspace = await f.read('workspaces/default.json');
  const imported = await f.manager.importConfiguration('default', workspace.revision, { ...definition, id: 'constructor', enabled: false, name: 'Constructor / settings' });
  assert.equal(imported.enabled, true);
  getOutputSchema.parse({ resource: await f.registry.get('constructor::$current') });
  assert.equal((await f.registry.get('constructor::$current')).items.find(item => item.key === 'bounce').value, 50);
  const current = await f.read('workspaces/default.json');
  await f.manager.updateConfiguration('default', 'constructor', current.revision, 1, { type: 'saveValues', presetId: 'default', values: { bounce: 95 } });
  assert.equal((await f.registry.get('constructor::$current')).items.find(item => item.key === 'bounce').value, 95);
  assert.equal((await f.registry.get('animation::$current')).items.find(item => item.key === 'bounce').value, 50);
});
