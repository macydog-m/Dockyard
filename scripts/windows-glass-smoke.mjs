import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir, release } from 'node:os';
import { createDemo } from './dockyard.mjs';

// DWM verification against a synthetic background. Save only the app's crop;
// the transient screen thumbnail is never written to disk.
if (process.platform !== 'win32' || Number(release().split('.')[2]) < 17763) {
  throw new Error('Native glass verification requires Windows 10 1809 or newer.');
}
const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-native-glass-'));
const dataDir = path.join(root, 'data');
await createDemo(dataDir);
await setSmokeLanguage(dataDir);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DOCKYARD_DESKTOP_EXE;
const app = await electron.launch({
  ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}),
  args: [...(executablePath ? [] : [path.resolve('apps/desktop')]), '--data-dir', dataDir], env,
});
const screenshots = [];
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '预设工作区', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.workspace-trigger').disabled && document.documentElement.dataset.material);
  // Measure live backdrop changes in the lighter tint, then check dark corners
  // separately: the dark theme intentionally covers 82% of the backdrop.
  await page.getByRole('button', { name: '切换到白天模式', exact: true }).click();
  const state = await app.evaluate(async ({ app, BrowserWindow, nativeTheme, screen, session }) => {
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    const area = screen.getPrimaryDisplay().workArea;
    const x = area.x + Math.round((area.width - 676) / 2), y = area.y + 50;
    const board = new BrowserWindow({
      title: 'Dockyard synthetic glass backdrop', x: area.x, y: area.y, width: area.width, height: area.height,
      frame: false, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { sandbox: true, session: session.fromPartition('glass-verification') },
    });
    await board.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body style="margin:0;background:repeating-linear-gradient(90deg,#f5f5f5 0 4px,#151515 4px 8px)"><div style="height:100vh;background:linear-gradient(180deg,transparent 0 20%,#e45955aa 45%,#619bd7aa 85%)"></div></body></html>'));
    board.showInactive();
    main.setPosition(x + 20, y + 20);
    main.moveTop(); main.focus();
    globalThis.glassVerification = { main, board };
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + (app.isPackaged ? '/main.cjs' : '/dist/main.cjs'));
    return { packaged: app.isPackaged, appPath: app.getAppPath(), koffiPath: require.resolve('koffi'),
      build: process.getBuiltinModule('os').release(), electron: process.versions.electron,
      reduced: nativeTheme.prefersReducedTransparency, contrast: nativeTheme.shouldUseHighContrastColors };
  });
  if (state.packaged) assert.ok(state.koffiPath.startsWith(path.join(state.appPath, 'node_modules') + path.sep), 'packaged native module must resolve inside the distributed app');
  if (state.reduced || state.contrast) throw new Error('Enable system transparency and turn off high contrast before checking native glass.');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.material), 'acrylic', 'native material must be active, rather than a fallback');
  const capture = async name => {
    await new Promise(resolve => setTimeout(resolve, 350));
    const image = await app.evaluate(async ({ desktopCapturer, screen }) => {
      const { main } = globalThis.glassVerification;
      const display = screen.getDisplayMatching(main.getBounds());
      const area = screen.dipToScreenRect(null, display.bounds);
      const bounds = screen.dipToScreenRect(main, main.getBounds());
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: area.width, height: area.height } });
      const source = sources.find(s => s.display_id === String(display.id));
      if (!source || source.thumbnail.isEmpty()) throw new Error('DWM screen capture unavailable.');
      const size = source.thumbnail.getSize();
      const scaleX = size.width / area.width, scaleY = size.height / area.height;
      const rect = { x: Math.round((bounds.x - area.x) * scaleX), y: Math.round((bounds.y - area.y) * scaleY),
        width: Math.round(bounds.width * scaleX), height: Math.round(bounds.height * scaleY) };
      return { png: source.thumbnail.crop(rect).toPNG().toString('base64'), dipWidth: main.getBounds().width };
    });
    const file = path.join(root, name + '.png');
    const bytes = Buffer.from(image.png, 'base64');
    await fs.writeFile(file, bytes);
    screenshots.push(file);
    return { bytes, dipWidth: image.dipWidth };
  };
  const setBackdrop = async color => {
    await app.evaluate(async (_electron, color) => {
      const { board } = globalThis.glassVerification;
      await board.webContents.executeJavaScript('document.body.innerHTML="";document.body.style.background=' + JSON.stringify(color));
    }, color);
    return capture(color === '#e45955' ? 'red-backdrop' : 'blue-backdrop');
  };
  const cornerChecks = [];
  const verifyCorners = async (snapshot, color, name) => {
    const result = await app.evaluate(({ nativeImage }, { png, color }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      const { width, height } = image.getSize(), bytes = image.toBitmap();
      const expected = color.match(/[0-9a-f]{2}/gi).map(part => parseInt(part, 16));
      const pixels = [[1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2]].map(([x, y]) => {
        const index = (y * width + x) * 4;
        return [bytes[index + 2], bytes[index + 1], bytes[index]];
      });
      return { pixels, expected };
    }, { png: snapshot.bytes.toString('base64'), color });
    assert.ok(result.pixels.every(pixel => pixel.every((channel, index) => Math.abs(channel - result.expected[index]) <= 3)),
      `${name}: all four corners must show the unmodified real backdrop; pixels=${JSON.stringify(result.pixels)}`);
    cornerChecks.push({ name, ...result });
  };
  const toolbar = await capture('toolbar');
  // Windows DPI rounding can make the viewport differ from the requested DIP height.
  // Closing the editor must restore that viewport within one DIP of rounding.
  const collapsedHeight = await page.evaluate(() => innerHeight);
  const blur = await app.evaluate(({ nativeImage }, { png, dipWidth }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
    const { width, height } = image.getSize(), data = image.toBitmap();
    const scale = width / dipWidth;
    const y = Math.min(height - 2, Math.round(60 * scale));
    const values = [];
    for (let x = Math.round(20 * scale); x < width - Math.round(20 * scale); x++) {
      const offset = (y * width + x) * 4;
      values.push((data[offset] + data[offset + 1] + data[offset + 2]) / 3);
    }
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    return { width, height, scanlineAverage: average,
      scanlineDeviation: Math.sqrt(values.reduce((a, b) => a + (b - average) ** 2, 0) / values.length) };
  }, { png: toolbar.bytes.toString('base64'), dipWidth: toolbar.dipWidth });
  assert.ok(blur.scanlineAverage > 25 && blur.scanlineAverage < 225, 'blurred backdrop should have visible midtones');
  assert.ok(blur.scanlineDeviation < 28, 'native blur should smooth the high-frequency background stripes');
  await verifyCorners(await setBackdrop('#e45955'), '#e45955', 'collapsed');
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await page.locator('.popover').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.material), 'acrylic');
  await verifyCorners(await capture('expanded'), '#e45955', 'expanded');
  await page.getByText('FX Design Rules', { exact: true }).click();
  await page.getByRole('button', { name: '编辑资源', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await verifyCorners(await capture('editor'), '#e45955', 'editor');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(height => !document.querySelector('.popover') && Math.abs(innerHeight - height) <= 1, collapsedHeight);
  await app.evaluate(() => {
    const { main, board } = globalThis.glassVerification;
    const bounds = main.getBounds(); main.setPosition(bounds.x + 12, bounds.y + 12);
    board.focus(); main.moveTop();
  });
  await verifyCorners(await capture('moved-unfocused'), '#e45955', 'moved-unfocused');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.material), 'acrylic');
  const red = await setBackdrop('#e45955'), blue = await setBackdrop('#619bd7');
  await verifyCorners(red, '#e45955', 'red-backdrop');
  await verifyCorners(blue, '#619bd7', 'blue-backdrop');
  const change = await app.evaluate(({ nativeImage }, { red, blue }) => {
    const average = png => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      const { width, height } = image.getSize(), bitmap = image.toBitmap();
      const y = Math.min(height - 2, Math.round(height * .92));
      let r = 0, b = 0, count = 0;
      for (let x = 25; x < width - 25; x++) { const i = (y * width + x) * 4; b += bitmap[i]; r += bitmap[i + 2]; count++; }
      return { r: r / count, b: b / count };
    };
    return { red: average(red), blue: average(blue) };
  }, { red: red.bytes.toString('base64'), blue: blue.bytes.toString('base64') });
  assert.ok(change.red.r - change.blue.r > 25 && change.blue.b - change.red.b > 25, 'changing the real backdrop must change the material pixels');
  await app.evaluate(({ nativeTheme }) => {
    Object.defineProperty(nativeTheme, 'prefersReducedTransparency', { configurable: true, value: true });
    nativeTheme.emit('updated');
  });
  await page.waitForFunction(() => document.documentElement.dataset.material === 'solid');
  await verifyCorners(await capture('native-solid'), '#619bd7', 'native-solid');
  await app.evaluate(({ nativeTheme }) => {
    delete nativeTheme.prefersReducedTransparency;
    nativeTheme.emit('updated');
  });
  await page.waitForFunction(() => document.documentElement.dataset.material === 'acrylic');
  const restored = await capture('native-restored');
  await verifyCorners(restored, '#619bd7', 'native-restored');
  await page.getByRole('button', { name: '切换到黑夜模式', exact: true }).click();
  await verifyCorners(await capture('dark-corners'), '#619bd7', 'dark-corners');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.shell')).backgroundColor === 'rgb(23, 26, 24)');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await cdp.detach();
  const report = { passed: true, ...state, material: await page.evaluate(() => document.documentElement.dataset.material), blur, backdropChange: change, cornerChecks,
    checks: ['all four corners show the unmodified backdrop after layout and movement', 'native DWM blur smooths synthetic stripes', 'material pixels follow live backdrop changes', 'expanded panel and editor keep glass', 'movement and loss of focus keep glass', 'native reduced-transparency disables and restores glass', 'reduced-transparency CSS remains opaque'], screenshots };
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); }
