import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DockyardManager, ResourceRegistry } from '../packages/core/dist/index.js';
import { setSmokeLanguage } from './smoke-language.mjs';

const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-screenshot-resource-'));
const dataDir = path.join(root, 'data');
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
let app;
try {
  const manager = new DockyardManager(dataDir);
  await manager.initialize();
  await manager.importConfiguration('default', 1, {
    schemaVersion: 1, id: 'settings', name: '截图测试配置', type: 'configuration',
    items: [{ key: 'enabled', label: '开关', kind: 'boolean', default: true }],
  });
  await setSmokeLanguage(dataDir);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], cwd: root, env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Exercise the real renderer, crop, cache, worker and registry using synthetic pixels.
  // No screen pixels or OS clipboard are read or written by this test.
  await app.evaluate(({ desktopCapturer, screen, nativeImage, clipboard }) => {
    desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => {
      const width = display.bounds.width, height = display.bounds.height;
      const pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4, blend = Math.min(1, x / 500);
        pixels[index] = Math.round(185 + (155 - 185) * blend);
        pixels[index + 1] = Math.round(193 + (136 - 193) * blend);
        pixels[index + 2] = Math.round(203 + (123 - 203) * blend);
        pixels[index + 3] = 255;
      }
      return { display_id: String(display.id), thumbnail: nativeImage.createFromBitmap(pixels, { width, height }) };
    });
    globalThis.screenshotSmokeCopies = 0;
    clipboard.write = async () => {
      globalThis.screenshotSmokeCopies++;
      if (globalThis.screenshotSmokeCopyFailure) throw new Error('Simulated clipboard failure');
    };
  });
  async function capture() {
    await page.getByRole('button', { name: '截图', exact: true }).click();
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows()
        .filter(window => window.webContents.getURL().endsWith('/capture.html') && window.isVisible()).length === screen.getAllDisplays().length);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'capture overlay becomes ready');
    const overlay = app.windows().find(window => window.url().endsWith('/capture.html'));
    assert.ok(overlay);
    const hint = await overlay.locator('#hint').evaluate(element => {
      const style = getComputedStyle(element); return { background: style.backgroundColor, blur: style.backdropFilter };
    });
    assert.equal(hint.background, 'rgba(45, 47, 56, 0.84)');
    assert.ok(hint.blur.includes('blur(24px)'));
    await overlay.screenshot({ path: path.join(artifacts, 'morandi-capture-hint.png'), clip: { x: 0, y: 0, width: 480, height: 140 } });
    assert.equal(await overlay.evaluate(() => window.captureTools.select(Number(document.body.dataset.ready),
      { x: 40, y: 40, width: 64, height: 48 })), true);
  }
  await capture();
  await page.getByText('截图已缓存并复制，可直接粘贴或继续标注', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'morandi-screenshot-panel.png') });
  let files = (await manager.listComponents()).filter(component => component.type === 'file');
  assert.equal(files.length, 1);
  const first = files[0];
  assert.ok((await manager.listWorkspaces()).workspaces[0].componentIds.includes(first.id));
  const original = await fs.readFile(first.source.path);
  assert.equal(original.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(original.readUInt32BE(16), 64);
  assert.equal(original.readUInt32BE(20), 48);
  const registry = new ResourceRegistry(dataDir, { workspaceId: 'default' });
  assert.equal((await registry.get(first.id + '::' + first.key)).availability, 'available');
  assert.equal((await registry.get('settings::$current')).items[0].value, true);
  assert.equal((await page.evaluate(() => window.dockyard.screenshotAction('resource'))).ok, true);
  assert.equal((await manager.listComponents()).filter(component => component.type === 'file').length, 1, 'repeat registration reuses the same resource');

  const edited = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(
    Buffer.alloc(64 * 48 * 4).fill(Buffer.from([0x99, 0x66, 0x33, 0xff])), { width: 64, height: 48 }).toDataURL());
  assert.equal((await page.evaluate(dataUrl => window.dockyard.screenshotAction('resource', dataUrl), edited)).ok, true);
  assert.notDeepEqual(await fs.readFile(first.source.path), original, 'annotations update the cached file');
  assert.equal((await manager.listComponents()).filter(component => component.type === 'file').length, 1);

  await app.evaluate(() => { globalThis.screenshotSmokeCopyFailure = true; });
  await capture();
  await page.getByText(/复制失败：/).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="截图"]')?.disabled);
  assert.equal(await page.getByText(/缓存或工作区登记失败：/).count(), 0, 'clipboard failure does not block registration');
  files = (await manager.listComponents()).filter(component => component.type === 'file');
  assert.equal(files.length, 2, 'a new capture gets a new resource');
  for (const file of files) assert.equal((await registry.get(file.id + '::' + file.key)).availability, 'available');
  assert.equal(await app.evaluate(() => globalThis.screenshotSmokeCopies), 2);
  assert.deepEqual(errors, []);
  console.log('PASS: screenshot cache, workspace registration, repeat registration, edited cache and query with a configuration component.');
  console.log('PASS: simulated clipboard failure still registers the screenshot. OS clipboard integration is not tested.');
} finally {
  await app?.close().catch(() => {});
  assert.match(path.relative(path.resolve(tmpdir()), path.resolve(root)), /^dockyard-screenshot-resource-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
