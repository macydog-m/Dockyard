// Standalone offline verification, executed by the installed Electron runtime in Node mode.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { DockyardManager } from '@dockyard/core';
import { contextOutputSchema } from '@dockyard/shared';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
async function main() {
  const pos = process.argv.indexOf('--data-dir');
  if (pos < 0 || !process.argv[pos + 1]) throw new Error('An explicit --data-dir is required.');
  const dataDir = path.resolve(process.argv[pos + 1]);
  const source = path.join(path.dirname(dataDir), '原始素材 source');
  const file = path.join(source, '000701_安装验证.txt');
  if (process.argv.includes('--seed')) {
    await access(path.join(dataDir, 'config.json')).then(() => { throw new Error('Seed destination already exists.'); }, error => { if (error.code !== 'ENOENT') throw error; });
    await mkdir(source, { recursive: true });
    await writeFile(file, 'ORIGINAL_KEEP', { encoding: 'utf8', flag: 'wx' });
    const manager = new DockyardManager(dataDir);
    await manager.initialize();
    await manager.saveComponent({ schemaVersion: 1, id: 'install-folder', type: 'folder', name: '安装验证素材', source: { path: source } });
    await manager.saveComponent({ schemaVersion: 1, id: 'install-palette', type: 'palette', name: '安装验证色板', entries: [{ key: 'warm-orange', name: '暖橙色', value: '#E98C3A' }] });
    await manager.saveComponent({ schemaVersion: 1, id: 'install-rules', type: 'instruction', name: '安装验证规则', key: 'install-rule', content: '保持原文件不变。' });
    await manager.setWorkspaceComponents('default', ['install-folder', 'install-palette', 'install-rules']);
  }
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, 'mcp.mjs'), '--data-dir', dataDir], env: { ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'dockyard-offline-release-check', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['context', 'get', 'search']);
    const context = await client.callTool({ name: 'context', arguments: {} });
    assert.equal(context.isError, undefined);
    assert.equal(contextOutputSchema.parse(context.structuredContent).total, 3);
    const color = await client.callTool({ name: 'get', arguments: { ref: 'warm-orange' } });
    assert.equal((color.structuredContent as any)?.resource.value, '#E98C3A');
    const found = await client.callTool({ name: 'search', arguments: { query: '安装验证' } });
    assert.equal(found.isError, undefined);
    assert.ok((found.structuredContent as any)?.total >= 1);
    const resource = await client.callTool({ name: 'get', arguments: { ref: '000701' } });
    assert.equal((resource.structuredContent as any)?.resource.availability, 'available');
    assert.equal((resource.structuredContent as any)?.resource.source.path, file);
    assert.equal(await readFile(file, 'utf8'), 'ORIGINAL_KEEP');
    const metadata = JSON.parse(await readFile(path.join(__dirname, 'package.json'), 'utf8'));
    console.log(JSON.stringify({ passed: true, version: metadata.version, runtime: process.execPath, dataDir, source: file, tools: ['get', 'search', 'context'] }));
  } finally { await client.close(); await transport.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
