import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDemo } from './dockyard.mjs';

// Exercise the actual Electron theme bridge in an isolated resource/profile directory.
await fs.mkdir(path.resolve('.local'), { recursive: true });
const root = await fs.mkdtemp(path.resolve('.local/theme-check-'));
const dataDir = path.join(root, 'data');
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
await createDemo(dataDir);
await setSmokeLanguage(dataDir);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const entry = path.resolve(process.env.DOCKYARD_DESKTOP_APP || 'apps/desktop');
const errors = [], checks = [];
let app, page;
const themeFile = path.join(dataDir, 'desktop', 'theme.json');
async function launch() {
  app = await electron.launch({ args: [entry, '--data-dir', dataDir], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false && document.documentElement.dataset.material);
}
async function expectTheme(theme) {
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  assert.equal((await page.evaluate(() => window.dockyard.getTheme())).value, theme);
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  await page.getByRole('button', { name: theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式', exact: true }).waitFor();
}
async function toggle(theme) {
  await page.locator('.dock-brand').click();
  await expectTheme(theme);
}
async function snapshot(name) {
  await page.screenshot({ path: path.join(artifacts, 'theme-' + name + '.png'), animations: 'disabled', omitBackground: true });
}
try {
  await launch();
  await expectTheme('light');
  await toggle('dark');
  const startBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.deepEqual(await page.evaluate(() => ({
    drag: getComputedStyle(document.querySelector('.drag-handle')).getPropertyValue('-webkit-app-region'),
    brand: getComputedStyle(document.querySelector('.dock-brand')).getPropertyValue('-webkit-app-region'),
  })), { drag: 'drag', brand: 'no-drag' });
  await snapshot('dark-toolbar');
  await toggle('light');
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), startBounds);
  assert.equal(JSON.parse(await fs.readFile(themeFile, 'utf8')).theme, 'light');
  await snapshot('light-toolbar');
  await page.locator('.dock-brand').focus();
  await page.keyboard.press('Enter');
  await expectTheme('dark');
  await page.keyboard.press('Space');
  await expectTheme('light');
  checks.push('default light; mouse, Enter and Space toggle; separate native drag region; no window movement');

  await page.getByRole('button', { name: '当前色与色盘', exact: true }).click();
  await page.getByLabel('当前色 HEX', { exact: true }).fill('#123456');
  await page.getByLabel('保存颜色名称').fill('保留未保存的颜色名称');
  await toggle('dark');
  assert.equal(await page.getByLabel('保存颜色名称').inputValue(), '保留未保存的颜色名称');
  assert.equal(await page.getByLabel('当前色 HEX', { exact: true }).inputValue(), '#123456');
  assert.equal(await page.locator('.large-swatch').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)');
  await snapshot('dark-color');
  await toggle('light');
  await snapshot('light-color');
  checks.push('expanded color panel, unsaved name, HEX value and actual swatch color survive switching');

  await page.getByRole('button', { name: '配置', exact: true }).click();
  await page.getByRole('button', { name: '管理资源', exact: true }).click();
  await page.getByRole('searchbox', { name: '筛选资源' }).fill('FX');
  await toggle('dark');
  assert.equal(await page.getByRole('searchbox', { name: '筛选资源' }).inputValue(), 'FX');
  await snapshot('dark-resources');
  await toggle('light');
  await snapshot('light-resources');
  await page.locator('.resource-button').first().click();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await toggle('dark');
    await page.getByRole('button', { name: '编辑资源', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const colors = await dialog.locator('input').first().evaluate(el => {
      const css = getComputedStyle(el);
      return { text: css.color, background: css.backgroundColor, blur: css.backdropFilter,
        base: getComputedStyle(document.documentElement).getPropertyValue('--solid-dialog').trim() };
    });
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const rgba = colors.background.match(/[\d.]+/g).map(Number);
    assert.ok(rgba[3] > 0 && rgba[3] < 1, 'fields have translucent fills');
    assert.ok(colors.blur.includes('blur('), 'fields use backdrop blur');
    const base = colors.base.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16));
    const composed = rgba.slice(0, 3).map((value, index) => value * rgba[3] + base[index] * (1 - rgba[3]));
    const a = luminance(colors.text), b = luminance('rgb(' + composed.join(',') + ')');
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, theme + ' input contrast');
    await snapshot(theme + '-editor');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  checks.push('resource search and selection survive switching; translucent blurred fields retain contrast over the theme base');

  await toggle('light');
  await page.getByRole('button', { name: '预设工作区', exact: true }).click();
  await snapshot('light-workspaces');
  await page.getByRole('button', { name: '新建工作区', exact: true }).click();
  await page.getByLabel('工作区名称', { exact: true }).fill('主题验证');
  await page.getByRole('button', { name: '保存工作区', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.workspace-row').filter({ hasText: '主题验证' }).click();
  await page.waitForFunction(() => document.querySelector('.workspace-trigger').textContent.includes('主题验证'));
  await expectTheme('light');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await snapshot('light-more');
  await toggle('dark');
  await snapshot('dark-more');
  await toggle('light');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false);
  await expectTheme('light');
  checks.push('theme is global across workspaces; renderer reload starts with the saved theme');

  const rejected = await page.evaluate(() => window.dockyard.setTheme('invalid'));
  assert.equal(rejected.ok, false);
  await expectTheme('light');
  await fs.mkdir(themeFile + '.tmp');
  await page.locator('.dock-brand').click();
  await page.getByRole('alert').filter({ hasText: '主题未保存' }).waitFor();
  await expectTheme('light');
  assert.equal(JSON.parse(await fs.readFile(themeFile, 'utf8')).theme, 'light');
  await fs.rmdir(themeFile + '.tmp');
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  checks.push('invalid IPC and persistence failure preserve the previous theme');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await toggle('dark');
    const style = await page.locator('.shell').evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      transition: getComputedStyle(el).transitionDuration,
      glow: getComputedStyle(el, '::before').display,
    }));
    assert.equal(style.background, theme === 'light' ? 'rgb(53, 55, 53)' : 'rgb(23, 26, 24)');
    assert.equal(style.transition, '0s');
    assert.equal(style.glow, 'none');
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await toggle('light');
  checks.push('both themes use opaque surfaces with reduced transparency and no motion when requested');

  await app.close(); app = undefined;
  await launch();
  await expectTheme('light');
  await toggle('dark');
  await app.close(); app = undefined;
  await launch();
  await expectTheme('dark');
  checks.push('full application restarts restore both light and dark preferences');
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, entry, dataDir };
  await fs.writeFile(path.join(artifacts, 'theme-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'theme-failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
}
