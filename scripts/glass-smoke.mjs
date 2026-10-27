import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDemo } from './dockyard.mjs';

// Isolated renderer/window checks. This does not capture the desktop or use screen tools.
await fs.mkdir(path.resolve('.local'), { recursive: true });
const root = await fs.mkdtemp(path.resolve('.local/glass-check-'));
const dataDir = path.join(root, 'data');
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
await createDemo(dataDir);
await setSmokeLanguage(dataDir);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const checks = [];
try {
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '预设工作区', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.workspace-trigger').disabled && document.documentElement.dataset.material);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    const setShape = win.setShape.bind(win);
    win.setShape = regions => { win.glassRegions = regions; setShape(regions); };
  });
  const material = await page.evaluate(() => document.documentElement.dataset.material);
  assert.ok(['solid', 'translucent', 'acrylic'].includes(material));
  assert.equal(await page.locator('.dock-bar').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: path.join(artifacts, 'glass-toolbar.png'), omitBackground: true });
  await page.getByRole('button', { name: '素材', exact: true }).click();
  await page.locator('.empty-add').waitFor();
  assert.equal(await page.getByRole('complementary', { name: '资源详情' }).count(), 0);
  assert.ok((await page.locator('.popover').boundingBox()).height < 380);
  await page.screenshot({ path: path.join(artifacts, 'glass-empty.png'), omitBackground: true });
  checks.push('empty categories hide the detail column and use a compact panel');

  await page.getByRole('button', { name: '规则', exact: true }).click();
  const top = (await page.locator('.popover').boundingBox()).y;
  await page.getByRole('checkbox', { name: '选择 FX Design Rules', exact: true }).uncheck();
  await page.getByText('组合已更新', { exact: true }).waitFor();
  assert.equal((await page.locator('.popover').boundingBox()).y, top);
  await page.waitForFunction(() => {
    const panel = document.querySelector('.popover').getBoundingClientRect();
    return document.querySelector('.feedback').getBoundingClientRect().top >= panel.bottom;
  });
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'glass-resources.png'), omitBackground: true });
  checks.push('membership changes do not move the panel; feedback sits below its content');

  const nativeState = await app.evaluate(({ BrowserWindow, BaseWindow }) => {
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    return { shaped: !!main.glassRegions, backings: BaseWindow.getAllWindows().filter(w => w.getTitle() === 'Dockyard glass').length };
  });
  assert.deepEqual(nativeState, { shaped:false, backings:0 });
  await page.evaluate(() => window.dockyard.setSurfaces([{ x:-1, y:0, width:999999, height:999999, radius:0 }]));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.material), material);
  checks.push('single content window owns material; no HWND clipping or separate glass backing windows');

  await page.getByRole('button', { name: '编辑资源', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await page.locator('.popover').isVisible(), false);
  assert.equal(await dialog.locator('input').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(56, 58, 57)');
  assert.equal(await dialog.evaluate(el => {
    const fields = el.querySelector('fieldset').getBoundingClientRect();
    const actions = el.querySelector('.dialog-actions').getBoundingClientRect();
    return fields.bottom <= actions.top && actions.bottom <= innerHeight - 8;
  }), true, 'form fields scroll above a permanently visible action bar');
  await page.screenshot({ path: path.join(artifacts, 'glass-editor.png'), omitBackground: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  checks.push('modal hides the underlying panel, with readable opaque fields');

  await page.getByRole('button', { name: '当前色与色盘', exact: true }).click();
  await page.getByLabel('当前色 HEX', { exact: true }).fill('#123456');
  await page.getByLabel('保存颜色名称').fill('玻璃界面颜色');
  await page.getByRole('button', { name: '保存到色板', exact: true }).click();
  await page.getByText('颜色已保存到色板', { exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  assert.equal(await page.locator('.large-swatch').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)');
  assert.equal(await page.locator('.popover').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: path.join(artifacts, 'glass-color.png'), omitBackground: true });
  checks.push('color samples stay opaque and HEX editing/palette saving still work');

  await page.getByRole('button', { name: '预设工作区', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'glass-workspaces.png'), omitBackground: true });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'glass-more.png'), omitBackground: true });
  await page.getByRole('button', { name: '我的资源', exact: true }).click();
  for (let i = 0; i < 18; i++) {
    await page.evaluate(i => window.dockyard.save({schemaVersion:1, revision:1, id:'glass-rule-'+i, type:'instruction', name:'很长的中文资源名称用于检查省略和滚动 '+i, enabled:true, key:'glass-'+i, aliases:[], tags:[], metadata:{}, content:'测试规则'}), i);
  }
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await page.getByText('已重新载入', { exact: true }).waitFor();
  await page.getByRole('button', { name: '规则', exact: true }).click();
  assert.equal(await page.locator('.list-add').isVisible(), true);
  assert.equal(await page.locator('.resource-list').evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth), true);
  const add = await page.locator('.list-add').boundingBox();
  assert.ok(add.y + add.height < await page.evaluate(() => innerHeight));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.popover').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => innerHeight === 64);
  assert.deepEqual(errors, []);
  checks.push('long names/lists, persistent add action, reduced motion, Escape and collapsed size');
  console.log(JSON.stringify({ passed:true, material, checks }, null, 2));
  await fs.writeFile(path.join(artifacts, 'glass-report.json'), JSON.stringify({ passed:true, material, checks }, null, 2)+'\n', 'utf8');
  if (process.argv.includes('--preview')) {
    await page.getByRole('button', { name: '规则', exact: true }).click();
    console.log('Preview ready');
    await new Promise(resolve => app.on('close', resolve));
  }
} finally {
  await app?.close();
  // Keep isolated fixture data with the visual audit so the preview is reproducible.
}
