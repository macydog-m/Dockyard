import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDemo } from './dockyard.mjs';
import { setSmokeLanguage } from './smoke-language.mjs';

const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-agent-settings-'));
const dataDir = path.join(root, '中文 data');
const artifacts = path.resolve('output/playwright/agent-settings');
const env = { ...process.env, CODEX_HOME: path.join(root, 'codex'), DOCKYARD_CODEX_PATH: path.join(root, 'missing-cli.exe') };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [], checks = [];
try {
  await fs.mkdir(artifacts, { recursive: true });
  await createDemo(dataDir);
  await setSmokeLanguage(dataDir, 'en');
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const settings = page.locator('.more-popover');
  assert.equal(await settings.getByRole('button', { name: /^(My resources|Reload|Colors|Fonts)$/ }).count(), 0);
  await settings.getByRole('button', { name: 'Restart app', exact: true }).waitFor();
  const assets = page.getByRole('switch', { name: 'Show Assets', exact: true });
  const trackColor = locator => locator.locator('.switch-track').evaluate(el => getComputedStyle(el).backgroundColor);
  const accentColor = () => page.evaluate(() => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return 'rgb(' + [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ') + ')';
  });
  assert.equal(await trackColor(assets), 'rgb(78, 175, 117)');
  await assets.click();
  assert.equal(await assets.getAttribute('aria-checked'), 'false');
  assert.equal(await trackColor(assets), await accentColor());
  assert.equal(await page.getByRole('button', { name: 'Assets', exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, 'settings-en-dark.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  assert.equal(await trackColor(assets), await accentColor());
  await page.screenshot({ path: path.join(artifacts, 'settings-en-light.png'), animations: 'disabled' });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  assert.equal(await assets.getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  assert.equal(await assets.getAttribute('aria-checked'), 'true');
  const labels = page.getByRole('switch', { name: 'Show tool labels', exact: true });
  await labels.click();
  assert.equal(await trackColor(labels), 'rgb(78, 175, 117)');
  await labels.click();
  checks.push('Removed settings shortcuts; both themes and label switch colors; hidden tool persistence and restoration');

  await page.getByRole('button', { name: 'Connect agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect agent' });
  await dialog.getByText(/Codex CLI was not found/).waitFor();
  for (const id of ['claude-code', 'claude-desktop', 'antigravity', 'cursor']) {
    await dialog.getByLabel('Choose agent', { exact: true }).selectOption(id);
    const text = await dialog.getByLabel('Copyable agent configuration', { exact: true }).inputValue();
    const server = JSON.parse(text).mcpServers.dockyard;
    assert.equal(server.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(server.args.at(-1), dataDir);
    assert.equal(server.type, id === 'claude-code' ? 'stdio' : undefined);
    assert.equal(await dialog.getByText(/Codex CLI was not found/).count(), 0);
    await dialog.getByRole('button', { name: 'Copy configuration', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.dialog-actions .primary').disabled);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), text);
    await page.screenshot({ path: path.join(artifacts, id + '.png'), animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: 'Local self-test', exact: true }).click();
  await dialog.getByText(/Latest local self-test: Passed/).waitFor();
  assert.equal(await fs.stat(path.join(env.CODEX_HOME, 'config.toml')).then(() => true, () => false), false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  checks.push('Four client instructions and actual clipboard JSON; missing Codex fallback; real local MCP self-test without changing host configuration');

  await page.getByLabel('Language / 语言', { exact: true }).selectOption('zh-CN');
  await page.getByRole('button', { name: '连接 Agent', exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'settings-zh.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '预设工作区', exact: true }).click();
  await page.getByRole('button', { name: '管理资源', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 My Palette', exact: true }).waitFor();
  checks.push('Chinese labels and library access through Workspaces → Manage resources');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  assert.match(path.relative(tmpdir(), path.resolve(root)), /^dockyard-agent-settings-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
}
