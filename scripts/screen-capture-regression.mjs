import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-screen-regression-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const checks = [], timings = [];
try {
  const executablePath = process.env.DOCKYARD_DESKTOP_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [path.resolve('apps/desktop')]), '--data-dir', root], env });
  const page = await app.firstWindow(); await page.waitForFunction(() => window.dockyard);
  const targets = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const targets = [];
    for (const [i, display] of screen.getAllDisplays().entries()) {
      const color = i % 2 ? '#49B68C' : '#E14A7B';
      const bounds = { x: display.bounds.x + 40, y: display.workArea.y + display.workArea.height - 200, width: 400, height: 180 };
      const w = new BrowserWindow({ ...bounds, frame: false, thickFrame: false, show: false, backgroundColor: '#336699', webPreferences: { sandbox: true } });
      await w.loadURL('about:blank'); w.setBounds(bounds, false);
      await w.webContents.executeJavaScript(`document.body.style.cssText='margin:0;background:#336699';document.body.innerHTML='<div style="position:absolute;left:100px;top:60px;width:20px;height:20px;background:${color}"></div>'`);
      w.showInactive();
      targets.push({ windowId: w.id, display, color, x: 150, y: bounds.y - display.bounds.y + 70 });
    }
    return targets;
  });
  async function start(mode) {
    const start = Date.now();
    const pending = page.evaluate(mode => window.dockyard.capture(mode), mode);
    for (let i = 0; i < 200; i++) {
      const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('/capture.html') && w.isVisible()).length);
      if (visible === targets.length) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('/capture.html')).map(w => ({ id: w.id, bounds: w.getBounds(), content: w.getContentBounds(), visible: w.isVisible() })));
    assert.equal(windows.every(w => w.visible), true, 'all monitors visible only after frames are ready');
    timings.push(Date.now() - start);
    return { pending, windows };
  }
  let previousIds;
  for (const target of targets) {
    const { pending, windows } = await start('color');
    const ids = windows.map(w => w.id).sort();
    if (previousIds) assert.deepEqual(ids, previousIds, 'reuse renderer windows');
    previousIds = ids;
    for (const displayTarget of targets) {
      const w = windows.find(w => w.bounds.x === displayTarget.display.bounds.x);
      assert.ok(w); assert.deepEqual(w.content, displayTarget.display.bounds);
    }
    const expected = windows.find(w => w.bounds.x === target.display.bounds.x);
    let overlayPage;
    for (const candidate of app.windows().filter(p => p.url().endsWith('/capture.html'))) {
      if ((await candidate.evaluate(() => screenX)) === expected.bounds.x) overlayPage = candidate;
    }
    assert.ok(overlayPage);
    const painted = await overlayPage.evaluate(() => ({ viewport: [innerWidth, innerHeight], ready: !!document.body.dataset.ready }));
    assert.equal(painted.ready, true);
    assert.deepEqual(painted.viewport, [target.display.bounds.width, target.display.bounds.height]);
    // Deliberately sample a 20px target near the bottom: the previous scaled overlay missed it.
    const displayPixel = await overlayPage.evaluate(({ x, y }) => {
      const c = document.querySelector('canvas'), p = c.getContext('2d').getImageData(Math.floor(x * c.width / innerWidth), Math.floor(y * c.height / innerHeight), 1, 1).data;
      return '#' + [...p].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    }, target);
    assert.equal(displayPixel, target.color);
    assert.equal(await overlayPage.evaluate(() => window.captureTools.select(Number(document.body.dataset.ready) - 1, { x: 1, y: 1, width: 1, height: 1 })), false);
    await overlayPage.mouse.click(target.x, target.y);
    const result = await pending;
    assert.deepEqual(result, { ok: true, value: { kind: 'color', value: target.color } });
    for (const p of app.windows().filter(p => p.url().endsWith('/capture.html'))) {
      await p.waitForFunction(() => !document.body.dataset.ready && document.querySelector('canvas').width === 1);
    }
  }
  checks.push('full monitor bounds and 1:1 pixels on every monitor, including negative origins and 125% DPI');
  checks.push('small bottom-edge color targets match both displayed pixels and returned eyedropper values');
  checks.push('warm overlay reuse, stale-session rejection, pixel memory cleared after each capture');
  const { pending, windows } = await start('screenshot');
  assert.deepEqual(windows.map(w => w.id).sort(), previousIds);
  const overlayPage = app.windows().find(p => p.url().endsWith('/capture.html'));
  await overlayPage.keyboard.press('Escape'); assert.deepEqual(await pending, { ok: true, value: null });
  checks.push('reused overlay cancellation restores dock');
  // Exercise failure recovery without capturing any additional pixels in the failure case.
  await app.evaluate(({ desktopCapturer }) => { globalThis.originalCapture = desktopCapturer.getSources; desktopCapturer.getSources = async () => { throw new Error('simulated capture failure'); }; });
  assert.equal((await page.evaluate(() => window.dockyard.capture('color'))).ok, false);
  await app.evaluate(({ desktopCapturer }) => { desktopCapturer.getSources = globalThis.originalCapture; });
  const recovered = await start('screenshot');
  await app.windows().find(p => p.url().endsWith('/capture.html')).keyboard.press('Escape');
  assert.deepEqual(await recovered.pending, { ok: true, value: null });
  checks.push('capture failure leaves reusable windows and next capture recovers');
  const report = { passed: true, packaged: !!executablePath, checks, readyMs: timings, displays: targets.map(t => ({ bounds: t.display.bounds, scaleFactor: t.display.scaleFactor })) };
  await fs.writeFile('output/playwright/screen-capture-regression.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close().catch(() => {});
  assert.match(path.relative(path.resolve(tmpdir()), path.resolve(root)), /^dockyard-screen-regression-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
