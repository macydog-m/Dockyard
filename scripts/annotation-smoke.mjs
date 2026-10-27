import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DockyardManager } from '../packages/core/dist/index.js';
import { setSmokeLanguage } from './smoke-language.mjs';

const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-annotations-'));
const dataDir = path.join(root, 'data'), artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
try {
  const manager = new DockyardManager(dataDir);
  await manager.initialize(); await setSmokeLanguage(dataDir);
  // Repeated getImageData checks can switch Chromium from GPU to CPU rasterization.
  // Use one backend throughout so antialiasing is comparable across canvas remounts.
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--disable-accelerated-2d-canvas', '--data-dir', dataDir], cwd: root, env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true });
  // All screenshot pixels, clipboard writes and file dialogs are isolated fixtures.
  await app.evaluate(({ desktopCapturer, screen, nativeImage, clipboard, dialog }, savePath) => {
    desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => {
      const { width, height } = display.bounds;
      const bytes = Buffer.alloc(width * height * 4, 255);
      return { display_id: String(display.id), thumbnail: nativeImage.createFromBitmap(bytes, { width, height }) };
    });
    clipboard.write = async items => {
      const blob = await items[0].getType('image/png');
      globalThis.annotationClipboard = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).toDataURL();
    };
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath });
  }, path.join(root, 'annotated.png'));
  async function capture() {
    await button('截图').click();
    let capturePage;
    for (let attempt = 0; attempt < 100; attempt++) {
      capturePage = app.windows().find(window => window.url().endsWith('/capture.html'));
      if (capturePage) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(capturePage);
    await capturePage.waitForFunction(() => !!document.body.dataset.ready);
    let visible = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      visible = await app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows()
        .filter(window => window.webContents.getURL().endsWith('/capture.html') && window.isVisible()).length === screen.getAllDisplays().length);
      if (visible) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(visible, true, 'all capture overlays are selectable');
    assert.equal(await capturePage.evaluate(() => window.captureTools.select(Number(document.body.dataset.ready),
      { x: 10, y: 10, width: 800, height: 400 })), true);
    await page.getByText('截图已缓存并复制，可直接粘贴或继续标注', { exact: true }).waitFor();
    await page.getByLabel('截图标注画布').waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="截图标注画布"]')?.dataset.ready === 'true');
  }
  await capture();
  if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('.dock-brand').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const drawing = page.getByLabel('截图标注画布');
  async function position(x, y) {
    await drawing.scrollIntoViewIfNeeded();
    const bounds = await drawing.boundingBox();
    const size = await drawing.evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    return { x: bounds.x + x * bounds.width / size.width, y: bounds.y + y * bounds.height / size.height };
  }
  async function drag(x, y, endX, endY) {
    const start = await position(x, y), end = await position(endX, endY);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
  }
  async function select(x, y) {
    await button('选择标注').click(); const p = await position(x, y); await page.mouse.click(p.x, p.y);
  }
  const pixels = () => drawing.evaluate(canvas => canvas.toDataURL());
  async function colorAt(x, y) {
    return drawing.evaluate((canvas, p) => [...canvas.getContext('2d').getImageData(p.x, p.y, 1, 1).data].slice(0, 3), { x, y });
  }
  async function assertColor(x, y, expected) { assert.deepEqual(await colorAt(x, y), expected); }
  async function custom(color) {
    await button('更多颜色').click(); await page.getByLabel('标注颜色 HEX', { exact: true }).fill(color); await button('应用颜色').click();
  }
  await button('蓝色 #3B82F6').click(); await button('粗').click(); await drag(60, 60, 260, 180);
  await assertColor(100, 60, [59, 130, 246]);
  await button('箭头').click(); await button('绿色 #22C55E').click(); await button('细').click(); await drag(400, 80, 600, 220);
  await assertColor(400, 80, [34, 197, 94]);
  await button('矩形框').click();
  assert.equal(await button('蓝色 #3B82F6').getAttribute('aria-pressed'), 'true');
  assert.equal(await button('粗').getAttribute('aria-pressed'), 'true');
  await select(150, 120); await button('紫色 #A855F7').click();
  await assertColor(100, 60, [168, 85, 247]); await assertColor(400, 80, [34, 197, 94]);
  await button('撤销').click(); await assertColor(100, 60, [59, 130, 246]);
  await button('重做').click(); await assertColor(100, 60, [168, 85, 247]);
  await select(150, 120); await drag(150, 120, 190, 150);
  await assertColor(140, 90, [168, 85, 247]); await assertColor(100, 60, [255, 255, 255]);
  await drag(100, 90, 80, 70); await assertColor(140, 70, [168, 85, 247]);
  await select(400, 80); await custom('#2468ac');
  await assertColor(400, 80, [36, 104, 172]);
  await drag(600, 220, 660, 250);
  const resized = await pixels();
  await page.keyboard.press('Control+z'); assert.notEqual(await pixels(), resized);
  await page.keyboard.press('Control+Shift+z'); assert.equal(await pixels(), resized);
  // Selecting alone must never alter exported pixels or add an undo entry.
  await select(150, 120); assert.equal(await pixels(), resized);
  await page.keyboard.press('Delete'); await assertColor(140, 70, [255, 255, 255]);
  await button('撤销').click(); assert.equal(await pixels(), resized);
  await button('清空标注').click(); await assertColor(400, 80, [255, 255, 255]);
  await button('撤销').click(); assert.equal(await pixels(), resized);
  // Escape cancels a partially drawn annotation without closing the editor.
  await button('矩形框').click();
  const start = await position(350, 300), end = await position(450, 350);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await pixels(), resized);
  assert.equal(await page.getByRole('region', { name: '截图预览' }).isVisible(), true);
  // Invalid HEX is not committed; recent colors are unique and capped at six.
  await button('更多颜色').click(); await page.getByLabel('标注颜色 HEX', { exact: true }).fill('#zzzzzz');
  assert.equal(await button('应用颜色').isDisabled(), true); await button('取消').click();
  for (const color of ['#123451', '#123452', '#123453', '#123454', '#123455', '#123456', '#123457']) await custom(color);
  const recent = page.getByRole('group', { name: '最近使用的标注颜色', exact: true });
  assert.equal(await recent.getByRole('button').count(), 6);
  assert.equal(await recent.getByRole('button').first().getAttribute('aria-label'), '自定义颜色 #123457');
  assert.equal(await pixels(), resized, 'changing drawing defaults does not recolor existing marks');
  await button('蓝色 #3B82F6').click();
  // Native color dialogs can blur the window; this must not discard the editing session.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).webContents.send('dockyard:blur'));
  assert.equal(await page.getByRole('region', { name: '截图预览' }).isVisible(), true);
  await select(150, 120);
  await page.screenshot({ path: path.join(artifacts, 'annotation-tools-dark.png') });
  const expected = await pixels();
  await button('复制图片').click(); await page.getByText('截图已复制', { exact: true }).waitFor();
  const clipboard = await app.evaluate(() => globalThis.annotationClipboard);
  const identical = await app.evaluate(({ nativeImage }, { expected, clipboard }) =>
    nativeImage.createFromDataURL(expected).toBitmap().equals(nativeImage.createFromDataURL(clipboard).toBitmap()), { expected, clipboard });
  assert.equal(identical, true, 'clipboard includes edited pixels but no selection handles');
  await button('保存图片').click(); await page.getByText(path.join(root, 'annotated.png'), { exact: true }).waitFor();
  const saved = await fs.readFile(path.join(root, 'annotated.png'));
  await button('加入当前工作区').click(); await page.getByText('截图已加入当前工作区', { exact: true }).waitFor();
  const components = (await manager.listComponents()).filter(component => component.type === 'file');
  assert.equal(components.length, 1);
  assert.deepEqual(await fs.readFile(components[0].source.path), saved, 'all three export actions use the same rendered image');
  // Closing/reopening the panel keeps the editable marks and undo history.
  await button('更多').click(); await page.getByRole('button', { name: /最近截图/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="截图标注画布"]')?.dataset.ready === 'true');
  const reopened = await pixels();
  const delta = await app.evaluate(({ nativeImage }, { expected, reopened }) => {
    const a = nativeImage.createFromDataURL(expected).toBitmap(), b = nativeImage.createFromDataURL(reopened).toBitmap();
    let count = 0, first = -1, maximum = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { count++; if (first < 0) first = i; maximum = Math.max(maximum, Math.abs(a[i] - b[i])); }
    return { count, first, maximum, before: [...a.subarray(first, first + 12)], after: [...b.subarray(first, first + 12)] };
  }, { expected, reopened });
  assert.equal(delta.count, 0, JSON.stringify(delta));
  assert.equal(await button('撤销').isDisabled(), false);
  await capture();
  assert.equal(await button('撤销').isDisabled(), true);
  assert.equal(await button('重做').isDisabled(), true);
  assert.equal(await button('蓝色 #3B82F6').getAttribute('aria-pressed'), 'true');
  assert.equal(await button('粗').getAttribute('aria-pressed'), 'true');
  await button('箭头').click();
  assert.equal(await button('绿色 #22C55E').getAttribute('aria-pressed'), 'true');
  assert.equal(await button('细').getAttribute('aria-pressed'), 'true');
  await page.reload(); await capture();
  assert.equal(await button('蓝色 #3B82F6').getAttribute('aria-pressed'), 'true');
  assert.equal(await recent.getByRole('button').count(), 6);
  if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.locator('.dock-brand').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const beforeColorPanel = await drawing.boundingBox();
  await button('更多颜色').click();
  const afterColorPanel = await drawing.boundingBox();
  assert.deepEqual(afterColorPanel, beforeColorPanel, 'color popup does not move or resize the canvas');
  await drag(100, 120, 300, 260);
  await assertColor(150, 120, [59, 130, 246]);
  await assertColor(150, 260, [59, 130, 246]);
  assert.equal(await page.getByRole('group', { name: '自定义标注颜色', exact: true }).isVisible(), true, 'drawing does not shift the canvas by collapsing the color panel');
  await page.screenshot({ path: path.join(artifacts, 'annotation-tools-light.png') });
  await button('取消').click();
  await button('更多').click();
  await page.locator('.language-setting select').selectOption('en');
  await page.getByRole('button', { name: /Recent capture/ }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Screenshot annotation canvas"]')?.dataset.ready === 'true');
  await page.screenshot({ path: path.join(artifacts, 'annotation-tools-english.png') });
  assert.equal(await page.locator('.annotation-style').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: independent colors/weights, HEX/recent persistence, scaled selection/move/resize, undo/redo/delete/clear, gesture cancellation, isolated exports, session retention, fresh captures, reload, light/dark and English UI.');
} catch (error) {
  if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(artifacts, 'annotation-failure.png'), timeout: 5000 }).catch(() => {}); }
  if (error.code === 'ERR_ASSERTION' && typeof error.actual === 'string' && error.actual.startsWith('data:')) {
    throw new Error('Rendered image mismatch: ' + error.stack?.split('\n').filter(line => line.includes(' at ')).join('\n'));
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  assert.match(path.relative(path.resolve(tmpdir()), path.resolve(root)), /^dockyard-annotations-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
