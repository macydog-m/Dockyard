import { t, getLocale } from './i18n';
import { nativeImage, BrowserWindow, desktopCapturer, screen, ipcMain, clipboard, ClipboardItem, dialog, type NativeImage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { trustedSender } from './security';
import type { CaptureResult, Reply } from './contracts';

type Overlay = {
  window: BrowserWindow; display: Electron.Display; loaded: Promise<void>; image?: NativeImage;
  ready?: () => void; rejectReady?: (error: Error) => void; session: number;
  viewport?: { width: number; height: number };
};

// Warm only the UI. Screen pixels are acquired exclusively after an explicit capture request,
// and cleared from both processes when that request finishes.
export function installScreenTools(owner: BrowserWindow, dataDir: string, saveResource: (file: string, id: string) => Promise<Reply>) {
  const overlayPath = path.join(__dirname, 'ui', 'capture.html');
  const overlayUrl = pathToFileURL(overlayPath).href;
  const overlays = new Map<number, Overlay>();
  let preparing: Promise<Overlay[]> | undefined;
  let disposed = false;
  let mode: 'color' | 'screenshot' = 'screenshot';
  let active = false;
  let selectable = false;
  let generation = 0;
  let result: ((reply: Reply<CaptureResult | null>) => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let cropped: NativeImage | undefined;
  let cachedCapture: { file: string; id: string } | undefined;
  let actionBusy = false;

  function finish(reply: Reply<CaptureResult | null>) {
    if (!active) return;
    active = false; selectable = false;
    clearTimeout(timer);
    for (const item of overlays.values()) {
      item.rejectReady?.(new Error('Capture ended')); item.ready = undefined; item.rejectReady = undefined;
      item.image = undefined; item.viewport = undefined;
      if (!item.window.isDestroyed()) {
        item.window.hide();
        item.window.webContents.send('dockyard:capture-reset');
      }
    }
    if (!disposed && !owner.isDestroyed()) { owner.show(); owner.focus(); }
    result?.(reply); result = undefined;
  }
  function destroyPool() {
    const previous = [...overlays.values()]; overlays.clear();
    for (const item of previous) if (!item.window.isDestroyed()) item.window.destroy();
  }
  function prepare(): Promise<Overlay[]> {
    if (preparing) return preparing;
    preparing = (async () => {
      if (disposed) return [];
      const displays = screen.getAllDisplays();
      for (const display of displays) {
        if ([...overlays.values()].some(item => item.display.id === display.id && !item.window.isDestroyed())) continue;
        const overlay = new BrowserWindow({ ...display.bounds, frame: false, thickFrame: false,
          resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
          skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, backgroundColor: '#111111',
          webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), contextIsolation: true,
            sandbox: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false },
        });
        // Windows constrains constructor bounds to the work area (excluding the taskbar).
        // Apply full monitor bounds after creation, with no native thick frame or animation.
        overlay.setBounds(display.bounds, false);
        overlay.setAlwaysOnTop(true, 'screen-saver');
        overlay.setMenuBarVisibility(false);
        overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        overlay.webContents.on('will-navigate', e => e.preventDefault());
        const item: Overlay = { window: overlay, display, loaded: Promise.resolve(), session: 0 };
        overlays.set(overlay.webContents.id, item);
        const id = overlay.webContents.id;
        const failed = () => {
          overlays.delete(id);
          item.rejectReady?.(new Error('Screen overlay closed'));
          if (active) finish({ ok: false, code: 'CAPTURE_FAILED', message: t("屏幕工具已中断，请重试。") });
        };
        overlay.webContents.on('render-process-gone', () => { failed(); if (!overlay.isDestroyed()) overlay.destroy(); });
        overlay.on('closed', failed);
        item.loaded = overlay.loadFile(overlayPath).then(() => {
          if (disposed || overlay.isDestroyed()) return;
          overlay.setBounds(display.bounds, false);
          overlay.webContents.setZoomFactor(1);
        }).catch(error => { overlays.delete(id); if (!overlay.isDestroyed()) overlay.destroy(); throw error; });
      }
      const items = [...overlays.values()];
      await Promise.all(items.map(item => item.loaded));
      return disposed ? [] : items;
    })().finally(() => { preparing = undefined; });
    return preparing;
  }
  function entry(event: Electron.IpcMainInvokeEvent, session: unknown) {
    const item = overlays.get(event.sender.id);
    return active && item && session === generation && item.session === generation
      && trustedSender(event, item.window.webContents, overlayUrl) ? item : undefined;
  }
  ipcMain.handle('dockyard:capture-ready', (event, session, viewport) => {
    const item = entry(event, session);
    if (!item?.ready) return;
    const expected = item.display.bounds;
    if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
      || Math.abs(viewport.width - expected.width) > 1 || Math.abs(viewport.height - expected.height) > 1) {
      item.rejectReady?.(new Error('Screen viewport mismatch')); return;
    }
    item.viewport = { width: viewport.width, height: viewport.height };
    item.ready(); item.ready = undefined; item.rejectReady = undefined;
  });
  ipcMain.handle('dockyard:capture-cancel', (event, session) => { if (entry(event, session)) finish({ ok: true, value: null }); });
  ipcMain.handle('dockyard:capture-select', (event, session, rect: unknown) => {
    const item = entry(event, session);
    if (!selectable || !item?.image || !item.viewport || !rect || typeof rect !== 'object') return false;
    const r = rect as Record<string, number>;
    const { width: dw, height: dh } = item.viewport;
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > dw + 1 || r.y + r.height > dh + 1) return false;
    const size = item.image.getSize();
    const x = Math.min(size.width - 1, Math.floor(r.x * size.width / dw));
    const y = Math.min(size.height - 1, Math.floor(r.y * size.height / dh));
    try {
      if (mode === 'color') {
        const pixel = item.image.crop({ x, y, width: 1, height: 1 }).toBitmap();
        const value = '#' + [pixel[2], pixel[1], pixel[0]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        finish({ ok: true, value: { kind: 'color', value } });
      } else {
        const width = Math.max(1, Math.min(size.width - x, Math.round(r.width * size.width / dw)));
        const height = Math.max(1, Math.min(size.height - y, Math.round(r.height * size.height / dh)));
        cropped = item.image.crop({ x, y, width, height });
        cachedCapture = undefined;
        finish({ ok: true, value: { kind: 'screenshot', dataUrl: cropped.toDataURL(), width, height } });
      }
      return true;
    } catch { finish({ ok: false, code: 'CAPTURE_FAILED', message: t("无法读取所选屏幕区域，请重新截图。") }); return false; }
  });
  owner.once('show', () => { void prepare().catch(() => {}); });
  owner.on('closed', () => { disposed = true; finish({ ok: true, value: null }); destroyPool(); cropped = undefined; cachedCapture = undefined; });
  const changedDisplays = () => {
    if (disposed) return;
    if (active) finish({ ok: true, value: null });
    destroyPool();
    // A topology change invalidates warm windows as well as their DPI mapping.
    void (preparing ?? Promise.resolve()).catch(() => {}).then(() => prepare()).catch(() => {});
  };
  screen.on('display-removed', changedDisplays);
  screen.on('display-added', changedDisplays);
  screen.on('display-metrics-changed', changedDisplays);
  return {
    get active() { return active; },
    async capture(requested: 'color' | 'screenshot'): Promise<Reply<CaptureResult | null>> {
      if (active || actionBusy || disposed) return { ok: false, code: 'BUSY', message: t("请先完成当前屏幕操作。") };
      active = true; selectable = false; mode = requested;
      const session = ++generation;
      const done = new Promise<Reply<CaptureResult | null>>(resolve => { result = resolve; });
      timer = setTimeout(() => finish({ ok: false, code: 'CAPTURE_TIMEOUT', message: t("屏幕操作已超时，请重试。") }), 120000);
      owner.hide();
      try {
        const displays = screen.getAllDisplays();
        // Two compositor frames instead of a fixed 200ms; cold UI setup overlaps capture.
        const [items, sources] = await Promise.all([prepare(), (async () => {
          await new Promise(resolve => setTimeout(resolve, 32));
          return desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
            width: Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor))),
            height: Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor))),
          } });
        })()]);
        if (!active || generation !== session) return done;
        if (!items.length) throw new Error('No screens');
        const painted = items.map(async item => {
          const source = sources.find(s => s.display_id === String(item.display.id));
          if (!source || source.thumbnail.isEmpty()) throw new Error(t("屏幕图像不可用"));
          item.image = source.thumbnail; item.session = session;
          const size = item.image.getSize();
          // Raw BGRA avoids two full-screen PNG encodes, Base64 copies and image decodes.
          const pixels = item.image.toBitmap();
          await new Promise<void>((resolve, reject) => {
            item.ready = resolve; item.rejectReady = reject;
            item.window.webContents.send('dockyard:capture-frame', { session, mode, locale: getLocale(), pixels, width: size.width, height: size.height });
          });
        });
        await Promise.all(painted);
        if (!active || generation !== session) return done;
        selectable = true;
        // Every monitor has painted before any overlay becomes visible: no black/old frames.
        for (const item of items) item.window.showInactive();
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        (items.find(item => item.display.id === display.id) ?? items[0]).window.focus();
      } catch {
        if (generation === session) finish({ ok: false, code: 'CAPTURE_FAILED', message: t("无法获取屏幕图像。请检查屏幕录制权限或稍后重试。") });
      }
      return done;
    },
    async screenshotAction(action: 'copy' | 'save' | 'resource', dataUrl?: string): Promise<Reply<string | null>> {
      if (!cropped || active || actionBusy) return { ok: false, code: 'NO_CAPTURE', message: t("请先完成一次截图。") };
      actionBusy = true;
      try {
        if (dataUrl !== undefined) {
          if (typeof dataUrl !== 'string' || dataUrl.length > 96 * 1024 * 1024 || !dataUrl.startsWith('data:image/png;base64,'))
            return { ok: false, code: 'INVALID_IMAGE', message: t("无效的标注图片。") };
          const bytes = Buffer.from(dataUrl.slice(22), 'base64');
          const size = cropped.getSize();
          if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== size.width || bytes.readUInt32BE(20) !== size.height)
            return { ok: false, code: 'INVALID_IMAGE', message: t("标注图片尺寸与截图不一致。") };
          const edited = nativeImage.createFromBuffer(bytes);
          if (edited.isEmpty()) return { ok: false, code: 'INVALID_IMAGE', message: t("无法读取标注图片。") };
          if (cachedCapture) await writeFile(cachedCapture.file, edited.toPNG());
          cropped = edited;
        }
        if (action === 'copy') { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(cropped.toPNG())], { type: 'image/png' }) })]); return { ok: true, value: t("截图已复制") }; }
        const id = action === 'resource' && cachedCapture ? cachedCapture.id : randomUUID();
        const name = t("截图-") + new Date().toISOString().replace(/[:.]/g, '-');
        let file: string;
        if (action === 'save') {
          const selected = await dialog.showSaveDialog(owner, { title: t("保存截图"), defaultPath: name + '.png', filters: [{ name: t("PNG 图片"), extensions: ['png'] }] });
          if (selected.canceled || !selected.filePath) return { ok: true, value: null };
          file = selected.filePath;
        } else if (cachedCapture) {
          file = cachedCapture.file;
        } else {
          const folder = path.join(dataDir, 'captures'); await mkdir(folder, { recursive: true });
          file = path.join(folder, name + '-' + id.slice(0, 8) + '.png');
        }
        if (action === 'save' || !cachedCapture) await writeFile(file, cropped.toPNG());
        if (action === 'resource') {
          cachedCapture = { file, id };
          const reply = await saveResource(file, id);
          if (!reply.ok) return reply;
          return { ok: true, value: t("截图已加入当前工作区") };
        }
        return { ok: true, value: file };
      } catch { return { ok: false, code: 'CAPTURE_SAVE_FAILED', message: t("截图保存失败，请检查目标目录或重试。") }; }
      finally { actionBusy = false; }
    },
  };
}
