import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron, chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemo } from './dockyard.mjs';

// Keep source changes, rebuilt files and user data inside an isolated development copy.
await fs.mkdir(path.resolve('.local'), { recursive: true });
const root = await fs.mkdtemp(path.resolve('.local/restart-check-'));
const appPath = path.join(root, 'apps/desktop');
const dataDir = path.join(root, '中文 data');
const artifacts = path.resolve('output/playwright');
let app, browser;
async function connect(port) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { return await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 1000 }); }
    catch { await delay(200); }
  }
  throw Error('Relaunched application did not expose its test browser.');
}
try {
  await fs.mkdir(artifacts, { recursive: true });
  await fs.mkdir(path.join(root, 'apps'), { recursive: true });
  await fs.cp(path.resolve('apps/desktop'), appPath, { recursive: true });
  await fs.cp(path.resolve('packages'), path.join(root, 'packages'), { recursive: true });
  await fs.copyFile('tsconfig.base.json', path.join(root, 'tsconfig.base.json'));
  await fs.copyFile('package.json', path.join(root, 'package.json'));
  await fs.cp(path.resolve('scripts'), path.join(root, 'scripts'), { recursive: true });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await fs.copyFile(name, path.join(root, name));
  await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await createDemo(dataDir);
  await setSmokeLanguage(dataDir);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [appPath, '--data-dir', dataDir], env });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false);
  await page.locator('.dock-brand').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  const before = await page.evaluate(async () => {
    window.__restartMarker = 'old process';
    const state = (await window.dockyard.state()).value;
    const renamed = await window.dockyard.renameWorkspace(state.activeWorkspaceId, '重启后保留的组合');
    if (!renamed.ok) throw Error(renamed.message);
    return (await window.dockyard.state()).value;
  });
  const source = path.join(appPath, 'src/renderer/index.html');
  const html = await fs.readFile(source, 'utf8');
  await fs.writeFile(source, html.replace('<title>Dockyard</title>', '<title>Dockyard restart verified</title>'), 'utf8');
  assert.equal(await page.title(), 'Dockyard');
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  await app.evaluate(({ app }, port) => {
    const relaunch = app.relaunch.bind(app);
    app.relaunch = options => relaunch({ ...options, args: [...options.args, '--remote-debugging-port=' + port] });
  }, port);
  const closed = app.waitForEvent('close', { timeout: 60000 });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '重启软件', exact: true }).click();
  console.log('Clicked restart in isolated development copy; waiting for compilation and native relaunch.');
  await closed; app = undefined;
  browser = await connect(port);
  const context = browser.contexts()[0];
  page = context.pages().find(page => page.url().endsWith('/ui/index.html')) ?? await context.waitForEvent('page');
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false, null, { timeout: 30000 });
  assert.equal(await page.title(), 'Dockyard restart verified');
  assert.equal(await page.evaluate(() => window.__restartMarker), undefined);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.deepEqual(await page.evaluate(async () => (await window.dockyard.state()).value), before);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '重启软件', exact: true }).isEnabled(), true);
  await page.screenshot({ path: path.join(artifacts, 'dockyard-app-restarted.png'), fullPage: true });
  await page.evaluate(() => window.dockyard.close()).catch(() => {});
  await browser.close(); browser = undefined;
  await delay(500);
  console.log(JSON.stringify({ passed: true, checks: [
    'old Electron process exits and a new application window starts',
    'source changes are rebuilt and loaded by the new process',
    'data directory, workspace, resource configuration and light theme persist',
    'restart button is usable again in the new application',
  ] }, null, 2));
} finally {
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) await page.evaluate(() => window.dockyard?.close()).catch(() => {});
  }
  await browser?.close().catch(() => {});
  await app?.close().catch(() => {});
  assert.match(path.relative(path.resolve('.local'), path.resolve(root)), /^restart-check-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
