import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDemo } from './dockyard.mjs';
import { ResourceRegistry } from '../packages/core/dist/index.js';
const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-widget-'));
const dataDir = path.join(root, 'data');
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
await createDemo(dataDir);
await setSmokeLanguage(dataDir);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const checks = [];
try {
  const executablePath = process.env.DOCKYARD_DESKTOP_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [path.resolve('apps/desktop')]), '--data-dir', dataDir], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: '预设工作区', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.workspace-trigger')?.disabled);
  // Native window dimensions can round by up to 2 DIP at fractional Windows scaling.
  await page.waitForFunction(() => Math.abs(innerHeight - 62) <= 2);
  assert.equal(await page.locator('.dock-bar').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  for (const name of ['素材', '文件', '规则']) assert.equal(await page.getByRole('toolbar').getByRole('button', { name, exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, 'widget-collapsed.png') });
  checks.push('Compact native collapsed surface (606 × 62 DIP target, fractional-DPI rounding), 46px strip, unified configuration entry');
  await page.getByRole('button', { name: '预设工作区', exact: true }).click();
  await page.getByRole('heading', { name: '预设工作区' }).waitFor();
  await page.waitForFunction(() => innerHeight >= 400 && innerHeight <= 432);
  await page.locator('.workspace-popover').screenshot({ path: path.join(artifacts, 'widget-workspace-panel.png') });
  await page.screenshot({ path: path.join(artifacts, 'widget-workspaces.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '当前色与色盘' }).click();
  await page.getByLabel('当前色 HEX', { exact: true }).fill('#123456');
  await page.getByRole('button', { name: '复制色值', exact: false }).click();
  assert.equal(await app.evaluate(async ({ clipboard }) => await clipboard.readText()), '#123456');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.current-color code')?.textContent === '#123456');
  await page.getByRole('button', { name: '当前色与色盘' }).click();
  await page.getByLabel('保存颜色名称').fill('截图测试蓝');
  await page.getByRole('button', { name: '保存到色板', exact: true }).click();
  await page.getByText('颜色已保存到色板', { exact: false }).waitFor();
  const registry = new ResourceRegistry(dataDir);
  assert.equal((await registry.get('截图测试蓝')).value, '#123456');
  await page.screenshot({ path: path.join(artifacts, 'widget-color.png') });
  checks.push('HEX editing, persistent workspace color, native clipboard, palette save and real MCP resource lookup');
  await page.keyboard.press('Escape');
  // A controlled native window gives a deterministic real desktop target.
  const sampleId = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const display = screen.getPrimaryDisplay();
    const w = new BrowserWindow({ x: display.bounds.x, y: display.bounds.y, width: 480, height: 360,
      frame: false, show: false, backgroundColor: '#336699', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await w.loadURL('about:blank');
    await w.webContents.executeJavaScript("document.body.style.cssText='margin:0;background:#336699';document.documentElement.style.background='#336699'");
    w.showInactive(); return w.id;
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).focus());
  async function overlay(mode) {

    await page.getByRole('button', { name: mode === 'color' ? '屏幕吸色器' : '截图', exact: true }).click();
    let capturePage;
    for (let i = 0; i < 100; i++) {
      capturePage = app.windows().find(w => w.url().endsWith('/capture.html'));
      if (capturePage) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(capturePage, 'native screen overlay opened');
    await capturePage.waitForFunction(() => !!document.body.dataset.ready);
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/capture.html') && w.isVisible()))) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return capturePage;
  }
  let capturePage = await overlay('color');
  await capturePage.mouse.click(80, 120);
  await page.waitForFunction(() => document.querySelector('.current-color code')?.textContent === '#336699');
  checks.push('actual desktop eyedropper sampled controlled RGB(51,102,153) target');
  await page.keyboard.press('Escape');
  capturePage = await overlay('screenshot');
  await capturePage.mouse.move(40, 100); await capturePage.mouse.down();
  await capturePage.mouse.move(200, 220); await capturePage.mouse.up();
  await page.getByText('截图已缓存并复制，可直接粘贴或继续标注', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '截图预览' }).count(), 1);
  assert.equal(await app.evaluate(async ({ clipboard }) => await clipboard.has('image/png')), true);
  const cachedFiles = await fs.readdir(path.join(dataDir, 'captures'));
  assert.equal(cachedFiles.length, 1);
  const cachedBytes = await fs.readFile(path.join(dataDir, 'captures', cachedFiles[0]));
  assert.equal(cachedBytes.subarray(1, 4).toString(), 'PNG');
  const capturedResources = (await registry.search('截图')).items.filter(item => item.ref.startsWith('capture-'));
  assert.equal(capturedResources.length, 1);
  const cachedResource = await registry.get(capturedResources[0].ref);
  assert.equal(cachedResource.availability, 'available');
  assert.deepEqual(await fs.readFile(cachedResource.source.path), cachedBytes);
  const screenshotTool = page.getByRole('button', { name: '截图', exact: true });
  assert.equal(await screenshotTool.getAttribute('aria-expanded'), 'true');
  await screenshotTool.click();
  assert.equal(await page.getByRole('region', { name: '截图预览' }).count(), 0);
  assert.equal(await screenshotTool.getAttribute('aria-expanded'), 'false');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('/capture.html') && w.isVisible())), false, 'collapse must not start a new capture');
  await page.waitForFunction(() => window.innerHeight < 200);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: /最近截图/ }).click();
  await page.getByRole('button', { name: '关闭截图面板', exact: true }).click();
  await page.waitForFunction(() => window.innerHeight < 200);
  checks.push('Screenshot toolbar toggles preview closed without a new capture; explicit close collapses the native window; recent capture remains available');
  const samplePage = app.windows().find(w => w.url() === 'about:blank');
  await samplePage.evaluate(() => {
    document.body.innerHTML = '<div contenteditable="true" style="height:250px">Paste target</div>';
    document.addEventListener('paste', async event => {
      event.preventDefault();
      const file = event.clipboardData.files[0];
      window.pastedImage = file ? { type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) } : null;
    });
  });
  await app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.fromId(id); w.show(); w.focus(); }, sampleId);
  await samplePage.locator('[contenteditable]').click();
  await samplePage.keyboard.press('Control+V');
  await samplePage.waitForFunction(() => !!window.pastedImage);
  const pasted = await samplePage.evaluate(() => window.pastedImage);
  assert.equal(pasted.type, 'image/png');
  // Clipboard PNG encoding can differ; decoded dimensions must match the cached crop.
  const dimensions = await app.evaluate(({ nativeImage }, { pasted, cached }) => ({
    pasted: nativeImage.createFromBuffer(Buffer.from(pasted)).getSize(),
    cached: nativeImage.createFromBuffer(Buffer.from(cached)).getSize(),
  }), { pasted: pasted.bytes, cached: Array.from(cachedBytes) });
  assert.deepEqual(dimensions.pasted, dimensions.cached);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).focus());
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: /最近截图/ }).click();
  await page.getByRole('region', { name: '截图预览' }).waitFor();
  const size = await page.getByLabel('截图标注画布').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
  assert.ok(size.width >= 160 && size.height >= 120);
  const invalidEdit = await page.evaluate(async () => {
    const wrongSize = document.createElement('canvas'); wrongSize.width = 1; wrongSize.height = 1;
    return window.dockyard.screenshotAction('copy', wrongSize.toDataURL());
  });
  assert.equal(invalidEdit.ok, false);
  assert.equal(invalidEdit.code, 'INVALID_IMAGE');
  const drawing = page.getByLabel('截图标注画布');
  await page.waitForFunction(() => document.querySelector('.capture-preview canvas')?.dataset.ready === 'true');
  const bounds = await drawing.boundingBox();
  async function draw(x, y, endX, endY) {
    await page.mouse.move(bounds.x + x, bounds.y + y); await page.mouse.down();
    await page.mouse.move(bounds.x + endX, bounds.y + endY); await page.mouse.up();
  }
  await draw(15, 15, 80, 60);
  await page.getByRole('button', { name: '箭头', exact: true }).click();
  await draw(90, 25, 140, 80);
  const annotatedPreview = await drawing.evaluate(canvas => canvas.toDataURL());
  await screenshotTool.click();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: /最近截图/ }).click();
  await page.waitForFunction(() => document.querySelector('.capture-preview canvas')?.dataset.ready === 'true');
  assert.equal(await drawing.evaluate(canvas => canvas.toDataURL()), annotatedPreview, 'closing preserves unsaved annotations');
  checks.push('Closing and reopening the screenshot retains unsaved annotations');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '清空标注', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), false, 'clearing annotations can be undone');
  await page.getByRole('button', { name: '矩形框', exact: true }).click();
  await draw(15, 15, 80, 60);
  await page.getByRole('button', { name: '箭头', exact: true }).click();
  await draw(90, 25, 140, 80);
  await page.getByRole('button', { name: '复制图片', exact: true }).click();
  await page.getByText('截图已复制', { exact: true }).waitFor();
  assert.equal(await app.evaluate(async ({ clipboard }) => await clipboard.has('image/png')), true);
  const markedBytes = await fs.readFile(cachedResource.source.path);
  assert.notDeepEqual(markedBytes, cachedBytes);
  const redPixels = await app.evaluate(({ nativeImage }, bytes) => {
    const bitmap = nativeImage.createFromBuffer(Buffer.from(bytes)).toBitmap();
    let red = 0; for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i + 2] > 200 && bitmap[i + 1] < 100 && bitmap[i] < 100) red++;
    return red;
  }, Array.from(markedBytes));
  assert.ok(redPixels > 200, 'red rectangle and arrow persisted to PNG');
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), sampleId);
  await samplePage.evaluate(() => { window.pastedImage = null; });
  await samplePage.locator('[contenteditable]').click(); await samplePage.keyboard.press('Control+V');
  await samplePage.waitForFunction(() => !!window.pastedImage);
  const pastedMarked = await samplePage.evaluate(() => window.pastedImage);
  const identicalPixels = await app.evaluate(({ nativeImage }, { cached, pasted }) =>
    nativeImage.createFromBuffer(Buffer.from(cached)).toBitmap().equals(nativeImage.createFromBuffer(Buffer.from(pasted)).toBitmap()),
    { cached: Array.from(markedBytes), pasted: pastedMarked.bytes });
  assert.equal(identicalPixels, true, 'pasted image includes exact annotated pixels');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).focus());
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: /最近截图/ }).click();
  const pngPath = path.join(root, 'selected-crop.png');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, pngPath);
  await page.getByRole('button', { name: '保存图片', exact: true }).click();
  await page.getByText(pngPath, { exact: true }).waitFor();
  assert.equal((await fs.readFile(pngPath)).subarray(1, 4).toString(), 'PNG');
  await page.getByRole('button', { name: '加入当前工作区', exact: true }).click();
  await page.getByText('截图已加入当前工作区', { exact: true }).waitFor();
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'captures')), cachedFiles);
  assert.deepEqual((await registry.search('截图')).items.filter(item => item.ref.startsWith('capture-')), capturedResources);
  await page.screenshot({ path: path.join(artifacts, 'widget-screenshot.png') });
  checks.push('automatic PNG cache and workspace lookup, actual Ctrl+V image paste, automatic preview, red rectangle/arrow, undo/clear, annotated Ctrl+V pixels match cache, save and repeat registration');
  await page.keyboard.press('Escape');
  capturePage = await overlay('screenshot');
  await capturePage.keyboard.press('Escape').catch(error => { if (!error.message.includes('closed')) throw error; });
  await page.waitForFunction(() => Math.abs(innerHeight - 62) <= 2);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).isVisible()), true);
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'captures')), cachedFiles);
  assert.equal(await app.evaluate(async ({ clipboard }) => await clipboard.has('image/png')), true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), sampleId);
  checks.push('capture cancellation restores dock without losing cached image');
  if (!process.argv.includes('--screenshot-only')) {
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await page.getByRole('button', { name: '管理资源', exact: true }).click();
  await page.getByRole('button', { name: /^添加素材(?:\s|$)/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^添加素材(?:\s|$)/ }).count(), 1);
  await page.getByRole('button', { name: /^添加文件(?:\s|$)/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^添加文件(?:\s|$)/ }).count(), 1);
  await page.getByRole('button', { name: /^添加规则(?:\s|$)/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^添加规则(?:\s|$)/ }).count(), 1);
  await page.locator('.resource-button').filter({ hasText: 'FX Design Rules' }).click();
  await page.getByRole('complementary', { name: '预览' }).getByRole('heading', { name: 'FX Design Rules' }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'widget-resources.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Math.abs(innerHeight - 62) <= 2);
  checks.push('capture cancellation restores dock; configuration opens the legacy resource library');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, 'widget-report.json'), JSON.stringify({ passed: true, checks, errors }, null, 2), 'utf8');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(await page.locator('body').innerText());
    await page.screenshot({ path: path.join(artifacts, 'widget-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  assert.match(path.relative(path.resolve(tmpdir()), path.resolve(root)), /^dockyard-widget-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
