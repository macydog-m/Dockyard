import { t, setLocale, resolveLocale } from './i18n';
import { readLanguage, writeLanguage, isLanguagePreference } from './language';
import { app, BrowserWindow, ipcMain, dialog, session, Menu, screen, clipboard, nativeTheme } from 'electron';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveDataDir, isInside } from '@dockyard/core';
import { commandSchema } from './contracts';
import { DesktopService } from './desktop-service';
import { AppRestarter } from './app-restart';
import { trustedSender } from './security';
import { installScreenTools } from './screen-tools';
import type { DockState } from './contracts';
import { getWindowMaterialBackend, installWindowMaterial } from './window-material';
import { readTheme, writeTheme } from './theme';

const args = process.argv.slice(app.isPackaged ? 1 : 2);
const pos = args.indexOf('--data-dir');
const dataDir = resolveDataDir(pos >= 0 ? args[pos + 1] : undefined);
setLocale(readLanguage(path.join(dataDir, 'desktop'), Intl.DateTimeFormat().resolvedOptions().locale).locale);
if (pos >= 0 && !args[pos + 1]?.trim()) throw new Error('--data-dir requires a directory.');
if (app.isPackaged && isInside(path.dirname(process.execPath), dataDir)) {
  dialog.showErrorBox(t("数据目录不可用"), t("资源数据目录必须位于安装目录之外，以便升级和卸载时保留数据。"));
  app.exit(1);
}
app.setName('Dockyard');
// Keep Chromium state separate from resource metadata, including in isolated tests.
app.setPath('userData', path.join(dataDir, 'desktop'));
const lock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let service: DesktopService;
let restarter: AppRestarter;
let closing = false;
const pagePath = path.join(__dirname, 'ui', 'index.html');
const pageUrl = pathToFileURL(pagePath).href;
const call = (command: unknown) => restarter?.active
  ? Promise.resolve({ ok: false as const, code: 'APP_RESTARTING', message: t("软件正在重启，请稍后重试。") })
  : service.call(command);
if (!lock) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    let selectedLanguage = readLanguage(app.getPath('userData'), app.getSystemLocale());
    setLocale(selectedLanguage.locale);
    let selectedTheme = readTheme(app.getPath('userData'));
    // Both visual modes use smoked glass and light foregrounds; keep native
    // controls/backdrops dark while CSS supplies the day/night tint strength.
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const assetDirectory = path.join(__dirname, 'ui', 'assets', 'notebook');
    const allowed = new Set([
      ...['index.html', 'app.js', 'style.css', 'capture.html', 'capture.js', 'capture.css'].map(file => pathToFileURL(path.join(__dirname, 'ui', file)).href),
      pathToFileURL(path.join(__dirname, 'assets', 'icon.png')).href,
      ...readdirSync(assetDirectory).filter(file => /^[a-zA-Z0-9]+\.svg$/.test(file)).map(file => pathToFileURL(path.join(assetDirectory, file)).href),
    ]);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed.has(details.url) }));
    service = new DesktopService(path.join(__dirname, 'worker.cjs'), {
      dataDir, runtime: process.execPath, mcpEntry: path.join(__dirname, 'mcp.mjs'),
    }, progress => {
      if (!window?.isDestroyed()) window?.webContents.send('dockyard:progress', progress);
    });
    restarter = new AppRestarter(app, dataDir, () => service.drain());
    const materialBackend = getWindowMaterialBackend();
    window = new BrowserWindow({
      icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      title: app.isPackaged ? 'Dockyard' : 'Dockyard · DEV', width: 711, height: 62, frame: false, thickFrame: false, transparent: materialBackend !== 'system',
      resizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, hasShadow: false,
      backgroundColor: '#00000000', backgroundMaterial: materialBackend === 'system' ? 'acrylic' : 'none', roundedCorners: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), additionalArguments: app.isPackaged ? [] : ['--dockyard-development'], contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.on('closed', () => { window = null; });
    const authorize = (event: Electron.IpcMainInvokeEvent) => window && trustedSender(event, window.webContents, pageUrl);
    const dock = window;
    ipcMain.handle('dockyard:language:get', event => {
      if (!authorize(event)) return { ok: false, code: 'FORBIDDEN', message: t('拒绝来源不明的请求。') };
      return { ok: true, value: selectedLanguage };
    });
    ipcMain.handle('dockyard:language', (event, language) => {
      if (!authorize(event) || !isLanguagePreference(language)) {
        return { ok: false, code: 'FORBIDDEN', message: t('无效的语言设置。') };
      }
      try {
        writeLanguage(app.getPath('userData'), language);
        selectedLanguage = { preference: language, locale: language === 'system' ? resolveLocale(app.getSystemLocale()) : language };
        setLocale(selectedLanguage.locale);
        return { ok: true, value: selectedLanguage };
      } catch { return { ok: false, code: 'LANGUAGE_SAVE_FAILED', message: t('无法保存语言设置，请重试。') }; }
    });
    ipcMain.handle('dockyard:restart-app', event => {
      if (!authorize(event)) return { ok: false, code: 'FORBIDDEN', message: t("拒绝来源不明的请求。") };
      if (closing) return { ok: false, code: 'WORKER_UNAVAILABLE', message: t("Dockyard 正在退出。") };
      return restarter.restart();
    });
    ipcMain.handle('dockyard:theme:get', event => {
      if (!authorize(event)) return { ok: false, code: 'FORBIDDEN', message: t("拒绝来源不明的请求。") };
      return { ok: true, value: selectedTheme };
    });
    ipcMain.handle('dockyard:theme', (event, theme) => {
      if (!authorize(event) || (theme !== 'light' && theme !== 'dark')) {
        return { ok: false, code: 'FORBIDDEN', message: t("无效的主题设置。") };
      }
      try {
        writeTheme(app.getPath('userData'), theme);
        selectedTheme = theme;
        return { ok: true, value: theme };
      } catch {
        return { ok: false, code: 'THEME_SAVE_FAILED', message: t("主题未保存，请稍后重试。") };
      }
    });
    const updateSurfaces = installWindowMaterial(dock, materialBackend);
    ipcMain.handle('dockyard:surfaces', (event, surfaces) => {
      if (!authorize(event)) return 'solid';
      return updateSurfaces(surfaces);
    });
    const tools = installScreenTools(dock, dataDir, async (file, id) => {
      const saved = await call({ type: 'save', component: {
        schemaVersion: 1, revision: 1, id: 'capture-' + id, type: 'file', name: path.basename(file, '.png'),
        enabled: true, key: 'capture-' + id, aliases: [], tags: ['截图'], metadata: {}, source: { path: file },
      } });
      if (!saved.ok) return saved;
      const state = await call({ type: 'state' });
      if (!state.ok) return state;
      const data = state.value as DockState;
      const workspace = data.workspaces.find(item => item.id === data.activeWorkspaceId)!;
      return call({ type: 'select', id: workspace.id, componentIds: [...new Set([...workspace.componentIds, 'capture-' + id])] });
    });
    let collapsedPosition: { x: number; y: number } | undefined;
    const area = screen.getPrimaryDisplay().workArea;
    dock.setPosition(Math.round(area.x + (area.width - 711) / 2), area.y + 24);
    dock.on('blur', () => { setTimeout(() => {
      if (!tools.active && !dock.isDestroyed() && !dock.isFocused()) dock.webContents.send('dockyard:blur');
    }, 180); });
    let isCollapsed = true;
    ipcMain.handle('dockyard:resize', (event, height, width = 711, collapsed = height <= 94) => {
      if (!authorize(event) || !Number.isInteger(height) || height < 62 || height > 1200 || !Number.isInteger(width) || width < 320 || width > 1100 || typeof collapsed !== 'boolean' || tools.active) return;
      const bounds = dock.getBounds();
      if (!collapsed && isCollapsed) collapsedPosition = { x: bounds.x, y: bounds.y };
      const position = collapsed && collapsedPosition ? collapsedPosition : bounds;
      const area = screen.getDisplayMatching({ ...bounds, ...position }).workArea;
      const actualHeight = Math.min(height, area.height);
      const actualWidth = Math.min(width, area.width);
      dock.setBounds({ width: actualWidth, height: actualHeight,
        x: Math.max(area.x, Math.min(position.x, area.x + area.width - actualWidth)),
        y: Math.max(area.y, Math.min(position.y, area.y + area.height - actualHeight)) });
      isCollapsed = collapsed;
      if (collapsed) collapsedPosition = undefined;
    });
    ipcMain.handle('dockyard:close', event => { if (authorize(event)) dock.close(); });
    ipcMain.handle('dockyard:capture', (event, mode) => {
      if (!authorize(event) || !['color', 'screenshot'].includes(mode)) return { ok: false, code: 'FORBIDDEN', message: t("无效的屏幕操作。") };
      return tools.capture(mode);
    });
    ipcMain.handle('dockyard:screenshot', (event, action, dataUrl) => {
      if (!authorize(event) || !['copy', 'save', 'resource'].includes(action)) return { ok: false, code: 'FORBIDDEN', message: t("无效的截图操作。") };
      return tools.screenshotAction(action, dataUrl);
    });
    ipcMain.handle('dockyard:copy-text', async (event, text) => {
      if (!authorize(event) || typeof text !== 'string' || text.length > 32768) return { ok: false, code: 'FORBIDDEN', message: t("无法复制。") };
      try { await clipboard.writeText(text); return { ok: true, value: null }; }
      catch { return { ok: false, code: 'COPY_FAILED', message: t("剪贴板暂不可用，请重试。") }; }
    });
    ipcMain.handle('dockyard:command', (event, input) => {
      if (!authorize(event)) return { ok: false, code: 'FORBIDDEN', message: t("拒绝来源不明的请求。") };
      if (JSON.stringify(input ?? null).length > 1024 * 1024) return { ok: false, code: 'CONFIG_INVALID', message: t("配置内容过大。") };
      const parsed = commandSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: 'CONFIG_INVALID', message: t("请检查名称、路径、颜色格式和必填字段。") };
      return call(parsed.data);
    });
    ipcMain.handle('dockyard:pick', async (event, kind) => {
      if (!authorize(event) || !['folder', 'file'].includes(kind)) return { ok: false, code: 'FORBIDDEN', message: t("无效的文件选择请求。") };
      const result = await dialog.showOpenDialog(window!, {
        title: kind === 'folder' ? t("选择素材文件夹") : t("选择文件"),
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      });
      return { ok: true, value: result.canceled ? null : result.filePaths[0] };
    });
    await window.loadFile(pagePath);
    window.show();
  }).catch(error => { dialog.showErrorBox(t("Dockyard 无法启动"), String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if ((service?.busy || restarter?.busy) && !closing) {
      event.preventDefault();
      closing = true;
      window?.hide();
      const waitForWrites = setInterval(() => {
        if (!service.busy && !restarter.busy) { clearInterval(waitForWrites); app.quit(); }
      }, 100);
    } else if (!service?.busy && !restarter?.busy) void service?.stop();
    else event.preventDefault();
  });
}
