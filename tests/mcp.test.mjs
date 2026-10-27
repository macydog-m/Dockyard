import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixture } from './fixtures.mjs';
import { DOCKYARD_VERSION } from '../packages/shared/dist/index.js';

const serverPath = fileURLToPath(new URL('../packages/mcp/dist/index.js', import.meta.url));

test('real stdio MCP: unified resources, scope, hot reload and error boundaries', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const clients = [];
  const errors = [];
  let stderr = '';
  async function connect() {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [serverPath, '--data-dir', f.dataDir], cwd: tmpdir(), stderr: 'pipe',
    });
    transport.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    const client = new Client({ name: 'dockyard-tests', version: '0.3.0' });
    client.onerror = error => errors.push(error.message);
    clients.push({ client, transport });
    await client.connect(transport);
    return client;
  }
  t.after(async () => {
    for (const { client, transport } of clients) { await client.close(); await transport.close(); }
  });
  const client = await connect();
  assert.equal(client.getServerVersion().version, DOCKYARD_VERSION);
  const get = (ref, target = client) => target.callTool({ name: 'get', arguments: { ref } });
  const expectError = (result, code) => {
    assert.equal(result.isError, true);
    const error = JSON.parse(result.content[0].text);
    assert.equal(error.code, code);
    assert.equal(result.structuredContent, undefined);
    return error;
  };

  await t.test('exactly three read-only tools are exposed with bounded output schemas', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['get', 'search', 'context']);
    assert.deepEqual(tools[0].inputSchema.required, ['ref']);
    assert.deepEqual(tools[0].outputSchema.required, ['resource']);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    assert.equal(tools[0].annotations.destructiveHint, false);
    assert.deepEqual(tools[1].inputSchema.required, ['query']);
    assert.equal(tools[1].annotations.readOnlyHint, true);
    assert.deepEqual(tools[2].inputSchema.required ?? [], []);
    assert.equal(tools[2].inputSchema.additionalProperties, false);
    assert.ok(tools[2].outputSchema.required.includes('workspace'));
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(tool.annotations.openWorldHint, false);
    }
    assert.match(client.getInstructions(), /Use search/);
    assert.doesNotMatch(client.getInstructions(), /get_asset/);
  });

  await t.test('leading zeros, Chinese aliases and canonical refs produce consistent output without reading file contents', async () => {
    const source = path.join(f.dataDir, 'files', '002511.txt');
    await writeFile(source, 'DO_NOT_INCLUDE_FILE_CONTENT_中文', 'utf8');
    const before = await readFile(path.join(f.dataDir, 'config.json'), 'utf8');
    const result = await get('id:002511');
    assert.ok(!result.isError);
    assert.equal(result.structuredContent.resource.key, '002511');
    assert.equal(result.structuredContent.resource.ref, 'demo::002511');
    assert.equal(result.structuredContent.resource.source.path, source);
    assert.equal(result.structuredContent.resource.availability, 'available');
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.ok(!JSON.stringify(result).includes('DO_NOT_INCLUDE_FILE_CONTENT'));
    assert.deepEqual((await get('demo::002511')).structuredContent, result.structuredContent);
    assert.deepEqual((await get('连接示例')).structuredContent, result.structuredContent);
    assert.equal(await readFile(path.join(f.dataDir, 'config.json'), 'utf8'), before);
    expectError(await get('2511'), 'NOT_FOUND');
  });

  await t.test('colors and instructions pass SDK output validation and contain only their own payloads', async () => {
    const color = await get('暖橙色');
    assert.ok(!color.isError);
    assert.equal(color.structuredContent.resource.type, 'color');
    assert.equal(color.structuredContent.resource.value, '#E98C3A');
    assert.equal(color.structuredContent.resource.source, undefined);
    const instruction = await get('FX 规则');
    assert.ok(!instruction.isError);
    assert.equal(instruction.structuredContent.resource.type, 'instruction');
    assert.match(instruction.structuredContent.resource.content, /轮廓清晰/);
    assert.deepEqual(JSON.parse(instruction.content[0].text), instruction.structuredContent);
  });

  await t.test('invalid arguments and unsafe refs fail while the server remains usable', async () => {
    for (const args of [{}, { ref: 2511 }, { ref: '002511', extra: true }]) {
      assert.equal((await client.callTool({ name: 'get', arguments: args })).isError, true);
    }
    for (const ref of ['', ' ', '../sample', 'C:\\sample', 'demo::../sample', 'a'.repeat(1091)]) {
      expectError(await get(ref), 'INVALID_REF');
    }
    assert.ok(!(await get('002511')).isError);
  });

  await t.test('ambiguous refs return reusable candidates without instruction content', async () => {
    const rule = await f.read('components/fx-rules.json');
    await f.manager.saveComponent({ ...rule, key: 'warm-orange' });
    const error = expectError(await get('warm-orange'), 'AMBIGUOUS_REF');
    assert.equal(error.candidates.length, 2);
    assert.ok(!JSON.stringify(error).includes(rule.content));
    assert.ok(!(await get('palette::warm-orange')).isError);
    assert.ok(!(await get('fx-rules::warm-orange')).isError);
    await f.manager.saveComponent(rule);
  });

  await t.test('running and newly connected processes use the same active workspace and updated config', async () => {
    const second = await connect();
    await f.manager.saveWorkspace({ schemaVersion: 1, id: 'colors', name: 'Colors', componentIds: ['palette'] });
    await f.manager.setActiveWorkspace('colors');
    for (const target of [client, second]) {
      expectError(await get('demo::002511', target), 'NOT_FOUND');
      assert.equal((await get('暖橙色', target)).structuredContent.resource.value, '#E98C3A');
    }
    const palette = await f.read('components/palette.json');
    await f.manager.saveComponent({ ...palette, enabled: false });
    expectError(await get('palette::warm-orange'), 'NOT_FOUND');
    await f.manager.saveComponent(palette);
    await f.manager.setActiveWorkspace('default');
  });

  await t.test('changed source paths report missing without restarting the process', async () => {
    const file = await f.read('components/demo.json');
    await f.manager.saveComponent({ ...file, source: { path: 'missing.txt' } });
    const result = await get('002511');
    assert.equal(result.structuredContent.resource.availability, 'missing');
    assert.equal(result.structuredContent.resource.kind, null);
    await f.manager.saveComponent(file);
  });

  await t.test('bad JSON, missing referenced configuration and UTF-8 BOM recover after repair', async () => {
    const file = path.join(f.dataDir, 'components', 'palette.json');
    const original = await readFile(file, 'utf8');
    await writeFile(file, '{', 'utf8');
    expectError(await get('暖橙色'), 'CONFIG_INVALID');
    await writeFile(file, '\uFEFF' + original, 'utf8');
    assert.equal((await get('暖橙色')).structuredContent.resource.value, '#E98C3A');
    const workspace = await f.read('workspaces/default.json');
    await f.write('workspaces/default.json', { ...workspace, componentIds: ['missing'] });
    expectError(await get('002511'), 'CONFIG_INVALID');
    await f.write('workspaces/default.json', workspace);
  });

  await t.test('record and response limits prevent unbounded results and allow recovery', async () => {
    const file = path.join(f.dataDir, 'components', 'demo.json');
    const original = await readFile(file, 'utf8');
    await writeFile(file, JSON.stringify({ ...JSON.parse(original), metadata: { huge: 'x'.repeat(1024 * 1024) } }), 'utf8');
    expectError(await get('002511'), 'CONFIG_INVALID');
    await writeFile(file, original, 'utf8');
    await f.manager.saveComponent({ ...JSON.parse(original), metadata: { huge: '中'.repeat(16000) } });
    expectError(await get('002511'), 'RESOURCE_TOO_LARGE');
    await f.manager.saveComponent(JSON.parse(original));
    assert.ok(!(await get('002511')).isError);
  });

  await t.test('search validates queries and returns bounded schema-checked candidates without instruction content', async () => {
    const search = query => client.callTool({ name: 'search', arguments: { query } });
    for (const args of [{}, { query: 1 }, { query: 'orange', limit: 100 }]) {
      assert.equal((await client.callTool({ name: 'search', arguments: args })).isError, true);
    }
    for (const query of ['', ' ', 'x'.repeat(257)]) expectError(await search(query), 'INVALID_QUERY');
    const color = await search('常用暖橙色');
    assert.ok(!color.isError);
    assert.equal(color.structuredContent.items[0].value, '#E98C3A');
    assert.deepEqual(JSON.parse(color.content[0].text), color.structuredContent);
    assert.ok(!(await get(color.structuredContent.items[0].ref)).isError);
    const rule = await search('FX 规则');
    assert.equal(rule.structuredContent.items[0].type, 'instruction');
    assert.ok(!JSON.stringify(rule).includes('保持轮廓清晰'));
    assert.ok(Buffer.byteLength(JSON.stringify(rule), 'utf8') < 64 * 1024);
  });

  await t.test('two live MCP processes see Folder refresh, diagnose broken indexes and respect workspace scope', async () => {
    const source = path.join(f.root, 'mcp folder');
    await mkdir(source);
    await writeFile(path.join(source, '000007_二维流烟.png'), 'DO_NOT_READ', 'utf8');
    await f.manager.saveComponent({ schemaVersion: 1, id: 'folder', name: 'Library', type: 'folder', source: { path: source } });
    await f.manager.setWorkspaceComponents('default', ['demo', 'palette', 'fx-rules', 'folder']);
    const second = clients[1].client;
    const search = (target, query) => target.callTool({ name: 'search', arguments: { query } });
    for (const target of [client, second]) {
      const result = await search(target, '流烟');
      assert.ok(!result.isError);
      assert.equal(result.structuredContent.items[0].ref, 'folder::000007_二维流烟.png');
      assert.equal((await get(result.structuredContent.items[0].ref, target)).structuredContent.resource.availability, 'available');
    }
    await writeFile(path.join(source, '000008_流烟.png'), 'NEW', 'utf8');
    assert.equal((await search(client, '流烟')).structuredContent.total, 1);
    await f.manager.refresh('folder');
    for (const target of [client, second]) assert.equal((await search(target, '流烟')).structuredContent.total, 2);
    const indexPath = path.join(f.dataDir, 'index/folder.json');
    const original = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, '{', 'utf8');
    const partial = await search(client, '暖橙色');
    assert.equal(partial.structuredContent.items[0].value, '#E98C3A');
    assert.equal(partial.structuredContent.diagnostics[0].code, 'INDEX_INVALID');
    for (const target of [client, second]) {
      const summary = (await target.callTool({ name: 'context', arguments: {} })).structuredContent;
      assert.equal(summary.components.find(item => item.id === 'folder').index.status, 'invalid');
      assert.equal(summary.diagnostics[0].code, 'INDEX_INVALID');
    }
    expectError(await get('002511'), 'INDEX_INVALID');
    await writeFile(indexPath, original, 'utf8');
    await f.manager.setActiveWorkspace('colors');
    for (const target of [client, second]) assert.equal((await search(target, '流烟')).structuredContent.total, 0);
    await f.manager.setActiveWorkspace('default');
    await f.manager.setWorkspaceComponents('default', ['demo', 'palette', 'fx-rules']);
  });

  await t.test('context validates empty arguments and returns summaries without paths or resource payloads', async () => {
    for (const args of [{ workspaceId: 'default' }, { limit: 100 }]) {
      assert.equal((await client.callTool({ name: 'context', arguments: args })).isError, true);
    }
    const result = await client.callTool({ name: 'context', arguments: {} });
    assert.ok(!result.isError);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(result.structuredContent.workspace.id, 'default');
    assert.equal(result.structuredContent.total, 3);
    assert.deepEqual(result.structuredContent.components.map(item => item.type), ['file', 'palette', 'instruction']);
    for (const marker of ['保持轮廓清晰', '#E98C3A', '"source"', '"entries"', '"content"', '"metadata"']) {
      assert.ok(!JSON.stringify(result.structuredContent).includes(marker), marker);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 64 * 1024);
  });

  await t.test('both MCP processes observe workspace switches, rename, composition and enabled changes across all three tools', async () => {
    const second = clients[1].client;
    const context = target => target.callTool({ name: 'context', arguments: {} });
    const search = (target, query) => target.callTool({ name: 'search', arguments: { query } });
    const original = await f.read('components/fx-rules.json');
    await f.manager.createWorkspace({ schemaVersion: 1, id: 'rules-only', name: '规则', componentIds: ['fx-rules'] });
    await f.manager.setActiveWorkspace('rules-only');
    for (const target of [client, second]) {
      const summary = (await context(target)).structuredContent;
      assert.equal(summary.workspace.id, 'rules-only');
      assert.deepEqual(summary.components.map(item => item.id), ['fx-rules']);
      assert.equal((await search(target, '暖橙色')).structuredContent.total, 0);
      expectError(await get('palette::warm-orange', target), 'NOT_FOUND');
      assert.equal((await get('fx-rules::fx-rules', target)).structuredContent.resource.type, 'instruction');
    }
    await f.manager.renameWorkspace('rules-only', '规则规范');
    await f.manager.saveComponent({ ...original, name: '新设计规则' });
    for (const target of [client, second]) {
      const summary = (await context(target)).structuredContent;
      assert.equal(summary.workspace.name, '规则规范');
      assert.equal(summary.components[0].name, '新设计规则');
      assert.equal((await search(target, '新设计规则')).structuredContent.items[0].ref, 'fx-rules::fx-rules');
      assert.equal((await get('fx-rules::fx-rules', target)).structuredContent.resource.name, '新设计规则');
    }
    await f.manager.saveComponent({ ...original, enabled: false });
    for (const target of [client, second]) {
      assert.equal((await context(target)).structuredContent.total, 0);
      assert.equal((await search(target, 'FX')).structuredContent.total, 0);
      expectError(await get('fx-rules::fx-rules', target), 'NOT_FOUND');
    }
    await f.manager.saveComponent(original);
    await f.manager.setWorkspaceComponents('rules-only', []);
    for (const target of [client, second]) {
      assert.equal((await context(target)).structuredContent.total, 0);
      assert.equal((await search(target, 'FX')).structuredContent.total, 0);
      expectError(await get('fx-rules::fx-rules', target), 'NOT_FOUND');
    }
    const workspace = await f.read('workspaces/rules-only.json');
    await f.write('workspaces/rules-only.json', { ...workspace, componentIds: ['missing'] });
    for (const target of [client, second]) {
      expectError(await context(target), 'CONFIG_INVALID');
      expectError(await search(target, '暖橙色'), 'CONFIG_INVALID');
      expectError(await get('palette::warm-orange', target), 'CONFIG_INVALID');
    }
    await f.manager.setWorkspaceComponents('rules-only', ['fx-rules']);
    assert.equal((await context(client)).structuredContent.total, 1);
    await f.manager.setActiveWorkspace('default');
  });

  await t.test('stdio contains only protocol messages; no process diagnostics leaked', () => {
    assert.deepEqual(errors, []);
    assert.equal(stderr, '');
  });
});
