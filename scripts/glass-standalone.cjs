// Standalone frameless Acrylic sample. No extra backing window or test wallpaper.
const { app, BrowserWindow, nativeTheme, screen } = require('electron');
const path = require('node:path');
app.setPath('userData', path.resolve('.local/glass-standalone'));
let panel;
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  const area = screen.getPrimaryDisplay().workArea;
  panel = new BrowserWindow({
    title: 'Dockyard 独立玻璃测试',
    x: area.x + Math.round((area.width - 520) / 2), y: area.y + 140,
    width: 520, height: 310, frame: false, thickFrame: false,
    transparent: false, backgroundColor: '#00000000', backgroundMaterial: 'acrylic',
    roundedCorners: true, hasShadow: false, alwaysOnTop: true,
    resizable: false, maximizable: false, fullscreenable: false, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await panel.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <html lang="zh-CN"><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent}
    body{font:14px 'Segoe UI','Microsoft YaHei',sans-serif;color:#fff}
    main{height:100%;border:1px solid #ffffff70;border-top-color:#ffffffed;border-left-color:#ffffffa0;border-radius:14px;background:rgba(35,35,35,.01);box-shadow:inset 0 1px 0 #ffffff30;overflow:hidden}
    header{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;-webkit-app-region:drag;border-bottom:1px solid #ffffff25}
    strong{font-weight:500;font-size:16px}button{-webkit-app-region:no-drag;color:white;background:#ffffff15;border:1px solid #ffffff50;border-radius:9px;padding:10px 16px;font:inherit;cursor:pointer}button:hover{background:#ffffff30}
    .close{border:0;background:transparent;font-size:22px;padding:4px 8px}
    section{padding:26px}h1{font-size:25px;font-weight:500;margin:0 0 12px}p{color:#ffffffc9;line-height:1.8;margin:0 0 24px}
    </style><main><header><strong>独立玻璃测试</strong><button class="close" aria-label="关闭" onclick="window.close()">×</button></header>
    <section><h1>观察真实背景透过的效果</h1><p>拖动顶部，将面板移到不同背景上。<br>此面板保持打开，按 Esc 或右上角关闭。</p><button onclick="this.textContent='点击正常'">测试点击</button></section></main></html>`));
  panel.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') app.quit();
  });
  panel.show();
  panel.focus();
  console.log('Standalone Acrylic sample ready; left open for manual inspection.');
});
app.on('window-all-closed', () => app.quit());
