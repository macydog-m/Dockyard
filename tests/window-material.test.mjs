import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { EventEmitter } from 'node:events';

const bundle = await build({
  entryPoints: ['apps/desktop/src/window-material.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'native-material-double', setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    build.onResolve({ filter: /win32-accent$/ }, () => ({ path: 'accent', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'accent' ? `
      export function setWindowsAccent(window, enabled) { window.setAccent(enabled); }
      export function updateWindowsGlassBounds(window) { window.boundsUpdates++; if (window.failBounds) throw Error("bounds unavailable"); }
      export function disposeWindowsGlass(window) { window.disposed++; }
    ` : `
      import { EventEmitter } from 'node:events';
      export const nativeTheme = globalThis.glassTestTheme = Object.assign(new EventEmitter(), {
        prefersReducedTransparency: false, shouldUseHighContrastColors: false, shouldUseDarkColors: true,
      });
    `, loader: 'js' }));
  } }],
});
const { roundedRegions, surfacesSchema, getWindowMaterialBackend, installWindowMaterial } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const theme = globalThis.glassTestTheme;
const surfaces = [{ x: 8, y: 8, width: 620, height: 48, radius: 16 }];
const fakeWindow = () => Object.assign(new EventEmitter(), {
  isDestroyed: () => false,
  setShape: () => assert.fail('material must stay on the single unclipped content window'),
  materials: [], accents: [], messages: [], hooks: new Map(), boundsUpdates: 0, disposed: 0,
  setBackgroundMaterial(mode) { this.materials.push(mode); },
  setAccent(enabled) { this.accents.push(enabled); },
  hookWindowMessage(message, callback) { this.hooks.set(message, callback); },
  webContents: { send: () => {} },
});

test('native surface regions leave the desktop gap and rounded corners outside the hit area', () => {
  const regions = roundedRegions([
    { x: 8, y: 8, width: 620, height: 48, radius: 16 },
    { x: 258, y: 64, width: 370, height: 526, radius: 16 },
  ], 636, 680);
  const contains = (x, y) => regions.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  assert.equal(contains(300, 30), true);
  assert.equal(contains(400, 100), true);
  for (const [x, y] of [[0, 0], [8, 8], [300, 60], [100, 100], [400, 610]]) assert.equal(contains(x, y), false);
  assert.ok(regions.length < 100, 'adjacent native scanlines are coalesced');
});

test('native region geometry clips to smaller monitors and rejects malformed IPC', () => {
  const clipped = roundedRegions([{ x: 8, y: 64, width: 620, height: 600, radius: 16 }], 500, 420);
  assert.ok(clipped.length);
  assert.ok(clipped.every(r => r.x >= 0 && r.y >= 0 && r.x + r.width <= 500 && r.y + r.height <= 420));
  assert.equal(surfacesSchema.safeParse(surfaces).success, true);
  for (const payload of [[], Array(5).fill(surfaces[0]), [{ ...surfaces[0], x: -1 }], [{ ...surfaces[0], height: 100000 }], [{ ...surfaces[0], width: NaN }], [{ ...surfaces[0], radius: 25 }], [{ ...surfaces[0], x: .5 }], [{ ...surfaces[0], extra: true }]]) {
    assert.equal(surfacesSchema.safeParse(payload).success, false);
  }
});

test('Windows 10 and Windows 11 select clipped glass for transparent outer corners', () => {
  assert.equal(getWindowMaterialBackend('win32', '10.0.17134'), 'transparent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.17763'), 'accent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.19045'), 'accent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.22000'), 'accent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.22621'), 'accent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.26100'), 'accent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.26200'), 'accent');
  assert.equal(getWindowMaterialBackend('win32', '10.0.10240'), 'transparent');
  assert.equal(getWindowMaterialBackend('linux', '6.8.19045'), 'transparent');
  assert.equal(getWindowMaterialBackend('darwin', '24.0.0'), 'transparent');
  assert.equal(getWindowMaterialBackend('win32', 'unknown'), 'transparent');
});

test('Windows 10 maintains clipped glass through layout, DPI and composition changes', () => {
  const win = fakeWindow();
  const sync = installWindowMaterial(win, 'accent');
  assert.equal(sync(surfaces), 'acrylic');
  sync([{ ...surfaces[0], height: 400 }]);
  assert.deepEqual(win.accents, [true]);
  assert.deepEqual(win.materials, []);
  assert.equal(sync(null), 'acrylic');
  assert.deepEqual(win.accents, [true]);
  const updates = win.boundsUpdates;
  win.emit('resize');
  win.hooks.get(0x02e0)();
  assert.equal(win.boundsUpdates, updates + 2);
  assert.deepEqual(win.accents, [true]);
  win.hooks.get(0x031e)();
  win.emit('show');
  assert.deepEqual(win.accents, [true, true, true]);
  win.emit('closed');
  assert.equal(theme.listenerCount('updated'), 0);
  assert.equal(win.disposed, 1);
});

test('explicit system backend keeps Electron Acrylic isolated from composition glass', () => {
  const win = fakeWindow();
  const sync = installWindowMaterial(win, 'system');
  assert.equal(sync(surfaces), 'acrylic');
  assert.deepEqual(win.materials, ['acrylic']);
  assert.deepEqual(win.accents, []);
  win.emit('closed');
});

test('native API failures keep readable fallbacks and do not retry on every layout', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const [backend, expected] of [['accent', 'translucent'], ['system', 'solid']]) {
      const win = fakeWindow();
      let attempts = 0;
      win.setAccent = win.setBackgroundMaterial = () => { attempts++; throw Error('unsupported'); };
      const sync = installWindowMaterial(win, backend);
      assert.equal(sync(surfaces), expected);
      assert.equal(sync(null), expected);
      win.emit('show');
      assert.equal(attempts, 1);
      win.emit('closed');
    }
  } finally { console.warn = warn; }
});

test('reduced transparency and high contrast disable and restore native materials', () => {
  for (const backend of ['accent', 'system', 'transparent']) {
    const win = fakeWindow();
    win.webContents.send = (_channel, mode) => win.messages.push(mode);
    const sync = installWindowMaterial(win, backend);
    try {
      theme.prefersReducedTransparency = true;
      theme.emit('updated');
      assert.equal(sync(surfaces), 'solid');
      theme.prefersReducedTransparency = false;
      theme.shouldUseHighContrastColors = true;
      theme.emit('updated');
      assert.equal(sync(surfaces), 'solid');
      theme.shouldUseHighContrastColors = false;
      theme.emit('updated');
      assert.equal(sync(surfaces), backend === 'transparent' ? 'translucent' : 'acrylic');
      if (backend === 'accent') assert.deepEqual(win.accents, [true, false, true]);
      if (backend === 'system') assert.deepEqual(win.materials, ['acrylic', 'none', 'acrylic']);
      assert.deepEqual(win.messages.slice(-2), ['solid', backend === 'transparent' ? 'translucent' : 'acrylic']);
    } finally {
      theme.prefersReducedTransparency = theme.shouldUseHighContrastColors = false;
      win.emit('closed');
    }
  }
});

test('a native bounds failure clears glass and keeps a stable translucent fallback', () => {
  const warn = console.warn;
  console.warn = () => {};
  const win = fakeWindow();
  try {
    const sync = installWindowMaterial(win, 'accent');
    win.failBounds = true;
    win.emit('resize');
    assert.equal(sync(surfaces), 'translucent');
    assert.deepEqual(win.accents, [true, false]);
    win.emit('show');
    assert.deepEqual(win.accents, [true, false]);
  } finally {
    win.emit('closed');
    assert.equal(win.disposed, 1);
    console.warn = warn;
  }
});

test('theme changes refresh native glass once without remounting or repeating on layout', () => {
  for (const backend of ['accent', 'system']) {
    const win = fakeWindow();
    const sync = installWindowMaterial(win, backend);
    const calls = backend === 'accent' ? win.accents : win.materials;
    try {
      assert.equal(calls.length, 1);
      theme.shouldUseDarkColors = false;
      theme.emit('updated');
      assert.equal(calls.length, 2);
      sync(surfaces);
      theme.emit('updated');
      win.emit('resize');
      assert.equal(calls.length, 2);
      theme.shouldUseDarkColors = true;
      theme.emit('updated');
      assert.equal(calls.length, 3);
    } finally {
      theme.shouldUseDarkColors = true;
      win.emit('closed');
    }
  }
});
