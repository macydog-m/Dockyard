import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, errorCode } from './fixtures.mjs';

async function loadSource(file) {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', write: false, target: 'node24' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('Desktop accepts IPC only from the exact trusted top-level local page', async () => {
  const { trustedSender } = await loadSource('apps/desktop/src/security.ts');
  const page = 'file:///F:/Dockyard/ui/index.html';
  const frame = { url: page };
  const contents = { mainFrame: frame };
  assert.equal(trustedSender({ sender: contents, senderFrame: frame }, contents, page), true);
  for (const event of [
    { sender: {}, senderFrame: frame },
    { sender: contents, senderFrame: null },
    { sender: contents, senderFrame: { url: page } },
    { sender: contents, senderFrame: { url: page + '?untrusted' } },
  ]) assert.equal(trustedSender(event, contents, page), false);
  frame.url = 'https://example.com';
  assert.equal(trustedSender({ sender: contents, senderFrame: frame }, contents, page), false);
});
test('Desktop IPC schemas reject arbitrary commands and malformed management payloads', async t => {
  const { commandSchema } = await loadSource('apps/desktop/src/contracts.ts');
  const f = await fixture(t);
  const file = await f.read('components/demo.json');
  assert.equal(commandSchema.safeParse({ type: 'save', component: file }).success, true);
  assert.equal(commandSchema.safeParse({ type: 'state' }).success, true);
  assert.equal(commandSchema.safeParse({ type: 'enable', id: 'default', componentId: 'demo', enabled: false }).success, true);
  for (const input of [
    { type: 'connectCodex', token: 'a'.repeat(64), replace: true, command: 'outside.exe' },
    { type: 'restoreConnection', id: '../outside' },
    { type: 'connectCodex', token: 'not-reviewed', replace: true },
    { type: 'shell', command: 'anything' }, { type: 'read', path: 'C:/secret' },
    { type: 'state', dataDir: 'C:/other' }, { type: 'refresh', id: '../outside' },
    { type: 'select', id: 'default', componentIds: ['../outside'] },
    { type: 'enable', id: 'default', componentId: '../outside', enabled: true },
    { type: 'enable', id: 'default', componentId: 'demo', enabled: 'false' },
    { type: 'save', component: { ...file, type: 'unknown' } },
    { type: 'createWorkspace', name: ' ' }, { type: 'diagnose', command: 'arbitrary' },
  ]) assert.equal(commandSchema.safeParse(input).success, false);
});
test('management listing includes disabled and unselected components without broadening MCP scope', async t => {
  const f = await fixture(t);
  const palette = await f.read('components/palette.json');
  await f.manager.saveComponent({ ...palette, enabled: false });
  await f.manager.setWorkspaceComponents('default', []);
  const items = await f.manager.listComponents();
  assert.equal(items.length, 3);
  assert.equal(items.find(item => item.id === 'palette').enabled, false);
  assert.equal((await f.registry.context()).total, 0);
  await assert.rejects(f.registry.get('palette::warm-orange'), errorCode('NOT_FOUND'));
  await f.write('components/palette.json', { ...palette, id: 'wrong' });
  await assert.rejects(f.manager.listComponents(), errorCode('CONFIG_INVALID'));
});
test('Folder progress reports counts while the same Core preserves source content and publishes a complete index', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'progress');
  await mkdir(source);
  for (let i = 0; i < 12; i++) {
    const directory = path.join(source, String(i));
    await mkdir(directory);
    await writeFile(path.join(directory, 'resource.txt'), 'KEEP', 'utf8');
  }
  const progress = [];
  await f.manager.saveComponent({ schemaVersion: 1, id: 'progress', name: 'Progress', type: 'folder', source: { path: source } }, value => progress.push(value));
  assert.ok(progress.length >= 2);
  assert.deepEqual(progress.at(-1), { files: 12, directories: 13 });
  assert.equal((await f.read('index/progress.json')).snapshot.entries.length, 12);
  assert.equal(await readFile(path.join(source, '0/resource.txt'), 'utf8'), 'KEEP');
});
