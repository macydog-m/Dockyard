import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDemo } from './dockyard.mjs';
import { DockyardManager } from '../packages/core/dist/index.js';

// Real Windows acrylic over a synthetic desktop. Never load a personal profile.
// Full-screen thumbnails remain in memory; only the synthetic stage crop is saved.
if (process.platform !== 'win32') throw new Error('Native acrylic screenshots require Windows.');
await fs.mkdir('.local', { recursive: true });
const root = await fs.mkdtemp(path.resolve('.local/readme-'));
const dataDir = path.join(root, 'data');
await createDemo(dataDir);
const english = process.argv.includes('--english');
await setSmokeLanguage(dataDir, english ? 'en' : 'zh-CN');
const manager = new DockyardManager(dataDir);
const workspace = (await manager.listWorkspaces()).workspaces.find(value => value.id === 'default');
await manager.importConfiguration('default', workspace.revision, {
  schemaVersion: 1, id: 'animation', name: english ? 'Animation' : '动画制作', type: 'configuration',
  items: [
    { key: 'rules', label: english ? 'Design rules' : '设计规则', kind: 'resource', target: 'fx-rules', default: true },
    { key: 'loop', label: english ? 'Loop animation' : '循环播放', kind: 'boolean', control: 'toggle', default: true },
    { key: 'bounce', label: english ? 'Bounce strength' : '弹动强度', kind: 'number', control: 'slider', min: 0, max: 100, step: 5, default: 65 },
    { key: 'duration', label: english ? 'Duration (seconds)' : '时长（秒）', kind: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
    { key: 'color', label: english ? 'Accent color' : '主题颜色', kind: 'text', control: 'color', default: '#336699' },
    { key: 'motion', label: english ? 'Animation type' : '动画类型', kind: 'select', default: 'idle', options: [
      { value: 'idle', label: english ? 'Idle' : '待机' }, { value: 'walk', label: english ? 'Walk' : '行走' },
    ] },
  ],
});
if (english) {
  const manager = new DockyardManager(dataDir);
  for (const component of await manager.listComponents()) {
    if (component.type === 'instruction') await manager.saveComponent({ ...component,
      content: 'Keep silhouettes clear and prefer lightweight effects. This text is a demonstration rule.' });
  }
}
const output = path.resolve('docs/images');
await fs.mkdir(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
const shots = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false && document.documentElement.dataset.material);
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'light') {
    await page.getByRole('button', { name: english ? 'Switch to light mode' : '切换到白天模式', exact: true }).click();
  }
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.material), 'acrylic', 'Enable Windows transparency for real glass captures.');
  await app.evaluate(async ({ BrowserWindow, screen, session }) => {
    const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html'));
    const display = screen.getDisplayMatching(main.getBounds());
    const area = display.workArea;
    const board = new BrowserWindow({ ...area, frame: false, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { sandbox: true, session: session.fromPartition('readme-synthetic-backdrop') } });
    await board.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body style="margin:0;background:#c6dce1"></body></html>'));
    board.showInactive();
    globalThis.readmeStage = { main, board, area };
  });
  async function capture(name, hue) {
    const text = await page.locator('body').innerText();
    assert.ok(!/[A-Z]:[\\/]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|github_pat_|sk-proj-/i.test(text), 'Unexpected private data in visible UI.');
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    // Seeded color choices keep regeneration reproducible while varying every scene.
    await app.evaluate(async (_electron, hue) => {
      const { main, board, area } = globalThis.readmeStage;
      const bounds = main.getBounds();
      if (bounds.width + 144 > area.width || bounds.height + 144 > area.height) throw new Error('Display is too small for this screenshot.');
      main.setPosition(area.x + Math.round((area.width - bounds.width) / 2), area.y + Math.round((area.height - bounds.height) / 2));
      const background = `repeating-linear-gradient(125deg,transparent 0 76px,#ffffff22 76px 79px,transparent 79px 155px),radial-gradient(ellipse at 25% 25%,hsl(${hue} 82% 77%),transparent 58%),radial-gradient(ellipse at 75% 70%,hsl(${(hue + 140) % 360} 80% 70%),transparent 58%),linear-gradient(120deg,hsl(${(hue + 65) % 360} 72% 69%),hsl(${(hue + 245) % 360} 82% 83%))`;
      await board.webContents.executeJavaScript('document.body.style.cssText=' + JSON.stringify('margin:0;height:100vh;background:' + background));
      board.moveTop(); main.moveTop(); main.focus();
    }, hue);
    await page.waitForTimeout(650);
    const result = await app.evaluate(async ({ desktopCapturer, screen }) => {
      const { main, board } = globalThis.readmeStage;
      const bounds = main.getBounds(), display = screen.getDisplayMatching(bounds);
      const stage = { x: bounds.x - 72, y: bounds.y - 72, width: bounds.width + 144, height: bounds.height + 144 };
      const boardBounds = board.getBounds();
      if (stage.x < boardBounds.x || stage.y < boardBounds.y || stage.x + stage.width > boardBounds.x + boardBounds.width || stage.y + stage.height > boardBounds.y + boardBounds.height) throw new Error('Capture would extend beyond the synthetic backdrop.');
      const physicalDisplay = screen.dipToScreenRect(null, display.bounds);
      const physicalStage = screen.dipToScreenRect(main, stage);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: physicalDisplay.width, height: physicalDisplay.height } });
      const source = sources.find(item => item.display_id === String(display.id));
      if (!source || source.thumbnail.isEmpty()) throw new Error('Screen capture unavailable.');
      const size = source.thumbnail.getSize();
      const sx = size.width / physicalDisplay.width, sy = size.height / physicalDisplay.height;
      const crop = source.thumbnail.crop({ x: Math.round((physicalStage.x - physicalDisplay.x) * sx), y: Math.round((physicalStage.y - physicalDisplay.y) * sy), width: Math.round(physicalStage.width * sx), height: Math.round(physicalStage.height * sy) });
      return { png: crop.toPNG().toString('base64'), ...crop.getSize() };
    });
    name += english ? '-en' : '';
    await fs.writeFile(path.join(output, name + '.png'), Buffer.from(result.png, 'base64'));
    shots.push({ name, width: result.width, height: result.height });
    console.log(name + ': ' + result.width + ' × ' + result.height);
  }
  await capture('light-toolbar', 186);
  await page.getByRole('toolbar').getByRole('button', { name: english ? 'Configure' : '配置', exact: true }).click();
  await page.getByRole('region', { name: english ? 'Configuration panel' : '配置面板', exact: true }).waitFor();
  await capture('light-configuration', 195);
  await page.getByRole('button', { name: english ? 'Edit component: Design rules' : '编辑组件：设计规则', exact: true }).click();
  await capture('light-rules', 215);
  await page.getByRole('button', { name: english ? 'Close editor' : '关闭编辑', exact: true }).click();
  await page.getByRole('button', { name: english ? 'Current color and palettes' : '当前色与色盘', exact: true }).click();
  await page.getByRole('button', { name: english ? 'Preview Palettes: Forest green' : '预览色彩组合：森林绿', exact: true }).click();
  await capture('light-colors', 165);
  await page.getByRole('button', { name: english ? 'Fonts' : '字体', exact: true }).click();
  await page.getByRole('region', { name: english ? 'Fonts panel' : '字体面板', exact: true }).waitFor();
  await capture('light-fonts', 265);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(root, 'capture-report.json'), JSON.stringify({ language: english ? 'en' : 'zh-CN', theme: 'light', material: 'acrylic', syntheticData: true, shots }, null, 2), 'utf8');
} finally {
  await app.close();
}
