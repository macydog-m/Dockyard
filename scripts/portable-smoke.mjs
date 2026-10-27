import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { checkVersion, root } from './version.mjs';

const version = await checkVersion();
const folder = 'Dockyard-Portable-' + version + '-x64';
const archive = path.join(root, '.local/portable-releases', version, folder + '.zip');
const temporary = await fs.mkdtemp(path.join(root, '.local/p-'));
const artifacts = path.join(root, 'output/playwright/portable');
await fs.mkdir(artifacts, { recursive: true });
const inside = target => {
  const relative = path.relative(temporary, path.resolve(target));
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
const move = async (from, to) => { inside(from); inside(to); await fs.rename(from, to); };
const env = {
  ...process.env, ELECTRON_RUN_AS_NODE: '1',
  LOCALAPPDATA: path.join(temporary, 'local'), APPDATA: path.join(temporary, 'roaming'),
  CODEX_HOME: path.join(temporary, 'codex'), DOCKYARD_CODEX_PATH: path.join(temporary, 'missing-cli.exe'),
  PATH: [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32')].join(path.delimiter),
};
const cwd = path.join(temporary, 'unrelated-cwd');
await fs.mkdir(cwd);
let app, page, passed = false;
const errors = [], checks = [];
let directory = path.join(temporary, '中文 & portable');
async function launch() {
  app = await electron.launch({ executablePath: path.join(directory, 'Dockyard.exe'), args: [], cwd, env, timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false);
  const state = await page.evaluate(() => window.dockyard.state());
  assert.ok(state.ok);
  assert.equal(state.value.dataDir, path.join(directory, 'Data'));
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), path.join(directory, 'Data/desktop'));
  assert.equal(await app.evaluate(() => process.env.ELECTRON_RUN_AS_NODE), undefined);
  const plan = await page.evaluate(() => window.dockyard.connectionPlan());
  assert.ok(plan.ok);
  assert.equal(plan.value.desired.command, path.join(directory, 'App/Dockyard.exe'));
  assert.equal(plan.value.desired.args.at(-1), path.join(directory, 'Data'));
  return state.value;
}
try {
  await promisify(execFile)(await getPath7za(), ['x', '-y', '-o' + temporary, archive], { windowsHide: true });
  await move(path.join(temporary, folder), directory);
  assert.deepEqual(await fs.readdir(path.join(directory, 'Data')), []);
  const state = await launch();
  assert.equal(state.components.length, 0);
  assert.ok((await page.evaluate(() => window.dockyard.setLanguage('en'))).ok);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('.workspace-trigger')?.disabled === false);
  const saved = await page.evaluate(() => window.dockyard.save({
    schemaVersion: 1, id: 'portable-rule', type: 'instruction', name: '随包规则', key: 'portable-rule-key', content: 'Move this data with the package. / 随包移动。',
  }));
  assert.ok(saved.ok);
  assert.ok((await page.evaluate(() => window.dockyard.select('default', ['portable-rule']))).ok);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByLabel('Note title', { exact: true }).fill('绿色版随包笔记');
  await page.getByLabel('Note body', { exact: true }).fill('Portable data: 中文 & English.');
  await page.getByRole('status').filter({ hasText: 'Autosaved' }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'before-move.png') });
  await app.close(); app = undefined;
  checks.push('Clean extraction; root EXE launches with Chinese, spaces and ampersand in path; no global Node; inherited Node mode cleared; Data-only profile and agent paths');
  const moved = path.join(temporary, '移动后 & portable');
  await move(directory, moved); directory = moved;
  const restored = await launch();
  assert.ok(restored.components.some(info => info.component.id === 'portable-rule'));
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), '绿色版随包笔记');
  assert.equal(await page.getByLabel('Note body', { exact: true }).inputValue(), 'Portable data: 中文 & English.');
  const diagnosis = await page.evaluate(() => window.dockyard.diagnose());
  assert.ok(diagnosis.ok); assert.equal(diagnosis.value.selfTest, 'passed');
  await page.screenshot({ path: path.join(artifacts, 'after-move.png') });
  await app.close(); app = undefined;
  checks.push('Whole-folder relocation preserves rule, note and language; agent paths regenerate at the new location; bundled MCP self-test passes');
  const transport = new StdioClientTransport({
    command: path.join(directory, 'App/Dockyard.exe'),
    args: [path.join(directory, 'App/resources/app/mcp.mjs'), '--data-dir', path.join(directory, 'Data')],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, cwd, stderr: 'pipe',
  });
  const client = new Client({ name: 'dockyard-portable-check', version });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['context', 'get', 'search']);
    const result = await client.callTool({ name: 'get', arguments: { ref: 'portable-rule-key' } });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(result.structuredContent.resource.content, 'Move this data with the package. / 随包移动。');
  } finally { await client.close(); await transport.close(); }
  for (const base of [env.LOCALAPPDATA, env.APPDATA]) assert.equal(await fs.access(path.join(base, 'Dockyard')).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(env.CODEX_HOME, 'config.toml')).then(() => true, () => false), false);
  assert.deepEqual(errors, []);
  checks.push('MCP works after the UI closes; no default Dockyard data or host registration created');
  passed = true;
  const report = { passed, version, checks, errors };
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close().catch(() => {});
  if (passed) {
    assert.match(path.relative(path.join(root, '.local'), temporary), /^p-[^/\\]+$/);
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5 });
  } else console.error('Portable test diagnostic directory:', temporary);
}
