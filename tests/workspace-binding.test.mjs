import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ResourceRegistry } from '../packages/core/dist/index.js';
import { fixture, errorCode } from './fixtures.mjs';

test('fixed and global registries isolate workspaces, including shared components and broken bindings', async t => {
  const f = await fixture(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'colors', name: 'Colors', componentIds: ['palette'] });
  const fixed = new ResourceRegistry(f.dataDir, { workspaceId: 'default' });
  await f.manager.setActiveWorkspace('colors');
  assert.equal((await fixed.context()).workspace.id, 'default');
  assert.equal((await f.registry.context()).workspace.id, 'colors');
  assert.equal((await fixed.get('fx-rules::fx-rules')).type, 'instruction');
  await assert.rejects(f.registry.get('fx-rules::fx-rules'), errorCode('NOT_FOUND'));
  assert.deepEqual(await fixed.get('palette::warm-orange'), await f.registry.get('palette::warm-orange'));
  assert.equal((await f.registry.search('FX')).total, 0);
  await f.manager.setActiveWorkspace('default');
  assert.equal((await f.registry.get('fx-rules::fx-rules')).type, 'instruction');
  const broken = new ResourceRegistry(f.dataDir, { workspaceId: 'missing' });
  for (const call of [() => broken.context(), () => broken.get('palette::warm-orange'), () => broken.search('orange')]) {
    await assert.rejects(call(), errorCode('NOT_FOUND'));
  }
  await assert.rejects(new ResourceRegistry(f.dataDir, { workspaceId: '../default' }).context(), errorCode('CONFIG_INVALID'));
  await f.manager.setActiveWorkspace('colors');
  await writeFile(path.join(f.dataDir, 'workspaces/default.json'), '{', 'utf8');
  await assert.rejects(fixed.context());
  assert.equal((await f.registry.context()).workspace.id, 'colors');
  await rm(path.join(f.dataDir, 'workspaces/default.json'));
  await assert.rejects(fixed.get('palette::warm-orange'));
});

test('three live stdio processes retain independent scopes after global switching', async t => {
  const f = await fixture(t);
  await f.manager.createWorkspace({ schemaVersion: 1, id: 'colors', name: 'Colors', componentIds: ['palette'] });
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close(); });
  for (const workspaceId of [undefined, 'default', 'colors']) {
    const client = new Client({ name: 'binding-test', version: '1' });
    clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../packages/mcp/dist/index.js', import.meta.url)),
        ...(workspaceId ? ['--workspace-id', workspaceId] : []), '--data-dir', f.dataDir], stderr: 'pipe' }));
  }
  await f.manager.setActiveWorkspace('colors');
  for (const [i, client] of clients.entries()) {
    const context = await client.callTool({ name: 'context', arguments: {} });
    assert.equal(context.structuredContent.workspace.id, i === 1 ? 'default' : 'colors');
    const get = await client.callTool({ name: 'get', arguments: { ref: 'fx-rules::fx-rules' } });
    assert.equal(!!get.isError, i !== 1);
    const search = await client.callTool({ name: 'search', arguments: { query: 'FX' } });
    assert.equal(search.structuredContent.total, i === 1 ? 1 : 0);
  }
  await writeFile(path.join(f.dataDir, 'workspaces/default.json'), '{', 'utf8');
  for (const name of ['context', 'get', 'search']) {
    const result = await clients[1].callTool({ name, arguments: name === 'get' ? { ref: 'palette::warm-orange' } : name === 'search' ? { query: 'orange' } : {} });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
  }
});
