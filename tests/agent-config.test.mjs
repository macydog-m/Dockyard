import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { tmpdir } from 'node:os';
import electronPath from 'electron';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixture } from './fixtures.mjs';

const result = await build({ entryPoints: ['apps/desktop/src/agent-config.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { agentClients, createAgentConfig } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

test('manual agent configurations launch the real bundled runtime and serve all three MCP tools', async t => {
  const f = await fixture(t);
  const desired = {
    // Electron resolves and installs its runtime on first import after a clean npm ci.
    command: electronPath,
    args: [path.resolve('packages/mcp/dist/index.js'), '--data-dir', f.dataDir],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
  for (const agent of agentClients.filter(agent => agent.id !== 'codex')) {
    await t.test(agent.name, async () => {
      const config = JSON.parse(createAgentConfig(agent.id, desired));
      assert.deepEqual(Object.keys(config.mcpServers), ['dockyard']);
      const { type, ...launch } = config.mcpServers.dockyard;
      assert.equal(type, agent.id === 'claude-code' ? 'stdio' : undefined);
      assert.deepEqual(launch, desired);
      const transport = new StdioClientTransport({ ...launch, cwd: tmpdir(), stderr: 'pipe' });
      transport.stderr.on('data', () => {});
      const client = new Client({ name: 'dockyard-agent-config-check', version: '1.0.0' });
      try {
        await client.connect(transport);
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['context', 'get', 'search']);
        const context = await client.callTool({ name: 'context', arguments: {} });
        assert.ok(!context.isError);
        assert.equal(context.structuredContent.workspace.id, 'default');
        const search = await client.callTool({ name: 'search', arguments: { query: '暖橙色' } });
        assert.ok(!search.isError);
        assert.equal(search.structuredContent.items[0].value, '#E98C3A');
        const get = await client.callTool({ name: 'get', arguments: { ref: 'demo::002511' } });
        assert.ok(!get.isError);
        assert.equal(get.structuredContent.resource.key, '002511');
        assert.equal(get.structuredContent.resource.source.path, path.join(f.dataDir, 'files/002511.txt'));
      } finally {
        await client.close();
        await transport.close();
      }
    });
  }
});
