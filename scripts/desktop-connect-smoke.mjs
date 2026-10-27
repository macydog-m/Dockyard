import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createDemo } from './dockyard.mjs';
const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-connection-ui-'));
const dataDir = path.join(root, '中文 data');
const codexHome = path.join(root, 'Codex 设置');
const config = path.join(codexHome, 'config.toml');
const cli = process.env.DOCKYARD_CODEX_PATH || execFileSync('where.exe', ['codex'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).find(name => name.endsWith('.exe'));
assert.ok(cli, 'Codex executable is required for this real integration check.');
const executablePath = process.env.DOCKYARD_DESKTOP_EXE ? path.resolve(process.env.DOCKYARD_DESKTOP_EXE) : undefined;
const args = [...(executablePath ? [] : [path.resolve('apps/desktop')]), '--data-dir', dataDir];
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
let app;
try {
  await createDemo(dataDir);
  await setSmokeLanguage(dataDir);
  await fs.mkdir(codexHome);
  const original = '# UTF-8 中文注释\n[mcp_servers.dockyard]\ncommand = "old-runtime.exe"\nargs = ["old-entry"]\n\n[mcp_servers.unrelated]\ncommand = "keep-this.exe"\n';
  await fs.writeFile(config, original, 'utf8');
  const env = { ...process.env, CODEX_HOME: codexHome, DOCKYARD_CODEX_PATH: cli };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = [env.SystemRoot, path.join(env.SystemRoot, 'System32')].join(path.delimiter);
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, cwd: root, env });
  let page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('toolbar', { name: 'Dockyard 小组件' }).waitFor();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '连接 Agent', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '连接 Agent' });
  await dialog.getByText('发现同名 Dockyard 配置，请核对差异后再替换。', { exact: true }).waitFor();
  assert.equal(await fs.readFile(config, 'utf8'), original);
  await page.screenshot({ path: path.join(artifacts, 'codex-connection-conflict.png') });
  await dialog.getByRole('button', { name: '备份并替换配置' }).click();
  await dialog.getByText(/最近本地自检：通过/).waitFor();
  assert.match(await fs.readFile(config, 'utf8'), /keep-this.exe/);
  const connected = await fs.readFile(config, 'utf8');
  await dialog.getByRole('button', { name: '保留配置并自检' }).click();
  // The global toast is hidden behind the modal. Wait for its own busy state
  // to finish instead of depending on a transient background notification.
  await dialog.getByRole('button', { name: '保留配置并自检', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '保留配置并自检', exact: true }).isEnabled(), true);
  await dialog.getByText(/最近本地自检：通过/).waitFor();
  assert.equal(await fs.readFile(config, 'utf8'), connected);
  await page.screenshot({ path: path.join(artifacts, 'codex-connection-ready.png') });
  await dialog.getByRole('button', { name: '恢复连接前的配置' }).click();
  await dialog.getByRole('button', { name: '备份并替换配置' }).waitFor();
  assert.equal(await fs.readFile(config, 'utf8'), original);
  await dialog.getByRole('button', { name: '备份并替换配置' }).click();
  await dialog.getByText(/最近本地自检：通过/).waitFor();
  await fs.appendFile(config, '\n# newer user change\n', 'utf8');
  const changed = await fs.readFile(config, 'utf8');
  await dialog.getByRole('button', { name: '恢复连接前的配置' }).click();
  await dialog.getByRole('alert').getByText(/连接后 Codex 配置已有其他修改/).waitFor();
  assert.equal(await fs.readFile(config, 'utf8'), changed);
  await app.close(); app = undefined;

  // Explicitly missing executable exercises the honest manual fallback, even on developer machines.
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, cwd: root, env: { ...env, DOCKYARD_CODEX_PATH: path.join(root, 'missing-cli.exe') } });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '连接 Agent', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 Agent' });
  await dialog.getByText(/未找到可直接运行的 Codex CLI/).waitFor();
  assert.match(await dialog.getByLabel('可复制的 Codex 配置').inputValue(), /ELECTRON_RUN_AS_NODE/);
  assert.equal(await dialog.getByRole('button', { name: '备份并替换配置' }).count(), 0);
  assert.equal(await fs.readFile(config, 'utf8'), changed);
  await page.screenshot({ path: path.join(artifacts, 'codex-connection-manual.png') });
  console.log(JSON.stringify({ passed: true, executablePath, realCodexCli: true, isolatedConfig: true, checks: ['conflict preview before mutation', 'backup and replace via real CLI', 'stdio self-test with bundled runtime', 'idempotence', 'byte-exact restore', 'subsequent change protection', 'missing CLI manual fallback'] }, null, 2));
  await fs.writeFile(path.join(artifacts, 'connection-report.json'), JSON.stringify({ passed: true, realCodexCli: true, isolatedConfig: true }), 'utf8');
} catch (error) {
  if (app) {
    const page = await app.firstWindow().catch(() => undefined);
    if (page) { await page.screenshot({ path: path.join(artifacts, 'connection-failure.png') }); console.error(await page.locator('body').innerText()); }
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  assert.match(path.relative(tmpdir(), root), /^dockyard-connection-ui-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
}
