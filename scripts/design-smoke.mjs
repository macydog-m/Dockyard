import { setSmokeLanguage } from './smoke-language.mjs';
import { smokeClipboard } from './smoke-clipboard.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DockyardManager, ResourceRegistry } from '../packages/core/dist/index.js';

const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-design-'));
const dataDir = path.join(root, '中文设计');
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
const manager = new DockyardManager(dataDir);
await manager.initialize();
await setSmokeLanguage(dataDir);
const registry = new ResourceRegistry(dataDir);
const fontFile = path.join(root, '字体.woff2');
await fs.writeFile(fontFile, 'KEEP_FONT_SOURCE', 'utf8');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
let readClipboard;
const checks = [];
const errors = [];
async function launch() {
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
  readClipboard = await smokeClipboard(app);
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '预设工作区', exact: true }).waitFor();
  await ready(page);
  return page;
}
async function ready(page) {
  await page.waitForFunction(() => !document.querySelector('.workspace-trigger')?.disabled);
}
async function library(page, type) {
  const region = page.getByRole('region', { name: (type === '色彩组合' ? '颜色' : type) + '面板', exact: true });
  if (!(await region.count())) {
    await page.getByRole('toolbar').getByRole('button', { name: type === '色彩组合' ? '当前色与色盘' : type, exact: true }).click();
  }
  await region.waitFor();
  return region;
}
async function activeDesign(page) {
  return page.evaluate(async () => {
    const reply = await window.dockyard.state();
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.value.workspaces.find(item => item.id === reply.value.activeWorkspaceId)?.design ?? {};
  });
}
async function savedDefault(page, slot, value) {
  await page.waitForFunction(async ({ slot, value }) => {
    const reply = await window.dockyard.state();
    if (!reply.ok) return false;
    const workspace = reply.value.workspaces.find(item => item.id === reply.value.activeWorkspaceId);
    return workspace?.design?.[slot] === value;
  }, { slot, value });
  await ready(page);
}
async function screenshot(page, name) {
  const close = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await close.count()) await close.click();
  await page.evaluate(() => { document.activeElement?.blur(); });
  await page.screenshot({ path: path.join(artifacts, name) });
}
async function cardLayout(panel) {
  return panel.evaluate(el => ({
    ids: [...el.querySelectorAll('.design-scheme-row')].map(item => item.dataset.schemeId),
    scrollTop: el.querySelector('.design-choice-list').scrollTop,
  }));
}
async function stableLayout(panel, before) {
  assert.deepEqual(await cardLayout(panel), before, 'Using an option must retain card order and scroll position.');
}
async function noOverflow(page) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  const toolbar = page.getByRole('toolbar');
  assert.equal(await toolbar.evaluate(el => {
    const right = el.getBoundingClientRect().right;
    const last = el.lastElementChild.getBoundingClientRect();
    return last.right <= right && el.scrollWidth <= el.clientWidth + 1;
  }), true, 'Every toolbar entry must fit.');
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.equal(await dialog.evaluate(el => {
      const scroll = el.querySelector('.design-editor-scroll');
      const actions = el.querySelector('.dialog-actions');
      if (!scroll || !actions) return true;
      const a = actions.getBoundingClientRect(), s = scroll.getBoundingClientRect(), d = el.getBoundingClientRect();
      return s.bottom <= a.top + 1 && a.bottom <= d.bottom && a.bottom <= innerHeight;
    }), true, 'Editor footer must stay visible below the scroll area.');
  }
}
try {
  let page = await launch();
  let panel = await library(page, '色彩组合');
  assert.equal(await panel.locator('.design-scheme-row').count(), 6);
  assert.equal((await manager.listComponents()).length, 0, 'Presets remain preview choices until used.');
  assert.equal(await panel.getByRole('button', { name: '删除色板', exact: true }).isDisabled(), true);
  await panel.getByRole('button', { name: '预览色彩组合：森林绿', exact: true }).click();
  assert.deepEqual(await activeDesign(page), {});
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.scheme-pick-colors button')).backgroundColor === 'rgb(34, 98, 69)');
  const forestLayout = await cardLayout(panel);
  await panel.getByRole('button', { name: '复制颜色组合指引：森林绿', exact: true }).click();
  await page.getByText('颜色组合指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  assert.equal(await readClipboard(), '请使用 Dockyard 中的颜色组合 "森林绿"。');
  assert.equal((await registry.get('森林绿')).entries.length, 3);
  assert.equal((await activeDesign(page)).paletteId, undefined);
  await stableLayout(panel, forestLayout);
  await panel.getByRole('button', { name: '预览色彩组合：森林绿', exact: true }).dblclick();
  await savedDefault(page, 'paletteId', 'palette-dockyard-forest');
  await stableLayout(panel, forestLayout);
  await page.waitForFunction(() => document.querySelector('input[aria-label="当前色 HEX"]')?.value === '#226245');
  assert.equal(await panel.locator('.design-current').innerText(), '使用中：森林绿');
  assert.equal(await page.getByRole('toolbar').getByRole('button', { name: '色彩组合', exact: true }).count(), 0);
  await panel.getByRole('button', { name: '选取主色 #226245', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="当前色 HEX"]')?.value === '#226245');
  assert.equal(await panel.getByLabel('当前色 HEX', { exact: true }).inputValue(), '#226245');
  await panel.getByLabel('当前色 HEX', { exact: true }).fill('#336699');
  await panel.getByLabel('保存颜色名称', { exact: true }).fill('独立颜色');
  await panel.getByRole('button', { name: '保存到色板', exact: true }).click();
  await page.getByText('颜色已保存到色板', { exact: false }).waitFor();
  const ordinaryPalette = (await manager.listComponents()).find(item => item.name === '我的色板');
  assert.equal(ordinaryPalette.entries[0].value, '#336699');
  assert.equal((await manager.listComponents()).find(item => item.id === 'palette-dockyard-forest').entries.length, 3);
  await panel.getByRole('button', { name: '独立颜色 #336699', exact: true }).click();
  await panel.getByRole('button', { name: '复制给 AI', exact: true }).click();
  await page.getByText('颜色指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  assert.equal(await readClipboard(), '请使用 Dockyard 中的颜色 "独立颜色"。');
  assert.equal((await registry.get('独立颜色')).value, '#336699');
  await panel.getByLabel('当前色 HEX', { exact: true }).fill('#ABCDEF');
  await panel.getByLabel('保存颜色名称', { exact: true }).fill('临时颜色');
  await panel.getByRole('button', { name: '复制给 AI', exact: true }).click();
  await page.getByText('颜色指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  assert.equal(await readClipboard(), '请使用 Dockyard 中的颜色 "临时颜色"。');
  assert.equal((await registry.get('临时颜色')).value, '#ABCDEF');
  await panel.getByLabel('保存颜色名称', { exact: true }).fill('');
  assert.equal(await panel.getByRole('button', { name: '预览色彩组合：森林绿', exact: true }).getAttribute('aria-pressed'), 'true');
  checks.push('One color entry for picker and combinations, direct swatch picking, ordinary color save, double click preserves card order and scroll');

  await panel.getByRole('button', { name: '添加色彩组合', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建色彩组合', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('品牌绿');
  await dialog.getByLabel('简介', { exact: false }).fill('用于官网的配色组合');
  await dialog.getByLabel('主色 HEX', { exact: true }).fill('#226245');
  assert.equal(await dialog.locator('.design-color-row').count(), 2);
  for (let i = 0; i < 7; i++) await dialog.getByRole('button', { name: '添加颜色', exact: true }).click();
  assert.equal(await dialog.locator('.design-color-row').count(), 9);
  assert.equal(await dialog.getByRole('button', { name: '添加颜色', exact: true }).isDisabled(), true);
  for (let i = 9; i >= 4; i--) await dialog.getByRole('button', { name: '移除颜色 ' + i, exact: true }).click();
  await dialog.getByLabel('颜色名称 3', { exact: true }).fill('亮色');
  await dialog.getByLabel('亮色 HEX', { exact: true }).fill('#FFFFFF');
  assert.equal(await dialog.getByLabel('颜色用途 3', { exact: true }).inputValue(), '');
  await noOverflow(page);
  await page.screenshot({ path: path.join(artifacts, 'design-color-editor.png') });
  await dialog.getByRole('tab', { name: '预览', exact: true }).click();
  await dialog.getByRole('button', { name: '主要操作', exact: true }).click();
  await dialog.getByRole('button', { name: '已完成', exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'design-color-preview.png') });
  await dialog.getByRole('button', { name: '保存并使用', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const palette = (await manager.listComponents()).find(value => value.name === '品牌绿');
  await savedDefault(page, 'paletteId', palette.id);
  assert.equal(palette.entries.length, 3);
  await panel.getByRole('button', { name: '选取主色 #226245', exact: true }).click();
  await panel.getByRole('button', { name: '复制给 AI', exact: true }).click();
  await page.getByText('颜色指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  assert.equal(await readClipboard(), '请使用 Dockyard 中的颜色 ' + JSON.stringify(palette.id + '::primary') + '。');
  assert.equal((await registry.get(palette.id + '::primary')).value, '#226245');
  await panel.getByRole('button', { name: '添加色彩组合', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建色彩组合', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('品牌绿');
  await dialog.getByRole('button', { name: '移除辅助色', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: '移除主色', exact: true }).isDisabled(), true);
  await dialog.getByLabel('颜色名称 1', { exact: true }).fill('海蓝');
  await dialog.getByLabel('颜色用途 1', { exact: true }).selectOption('');
  await dialog.getByLabel('海蓝 HEX', { exact: true }).fill('#235EA8');
  await dialog.getByRole('button', { name: '保存并使用', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  let blue = (await manager.listComponents()).find(value => value.name === '品牌绿' && value.id !== palette.id);
  await savedDefault(page, 'paletteId', blue.id);
  assert.equal((await registry.get(blue.id)).entries.length, 1);
  const greenRow = panel.locator('[data-scheme-id="' + palette.id + '"]');
  await greenRow.getByRole('button', { name: '复制颜色组合指引：品牌绿', exact: true }).click();
  await page.getByText('颜色组合指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  assert.equal(await readClipboard(), '请使用 Dockyard 中的颜色组合 ' + JSON.stringify(palette.id) + '。');
  assert.equal((await activeDesign(page)).paletteId, blue.id);
  const blueRow = panel.locator('[data-scheme-id="' + blue.id + '"]');
  await blueRow.locator('.design-scheme-open').click();
  await blueRow.getByRole('button', { name: '编辑方案：品牌绿', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑色彩组合', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('品牌蓝');
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  blue = (await manager.listComponents()).find(value => value.id === blue.id);
  await panel.getByRole('button', { name: '预览色彩组合：品牌绿', exact: true }).press('Enter');
  await savedDefault(page, 'paletteId', palette.id);
  await panel.getByRole('button', { name: '预览色彩组合：品牌蓝', exact: true }).click();
  assert.equal((await activeDesign(page)).paletteId, palette.id);
  const blueLayout = await cardLayout(panel);
  await panel.getByRole('button', { name: '预览色彩组合：品牌蓝', exact: true }).dblclick();
  await savedDefault(page, 'paletteId', blue.id);
  await stableLayout(panel, blueLayout);
  await page.waitForFunction(() => document.querySelector('input[aria-label="当前色 HEX"]')?.value === '#235EA8');
  await panel.getByRole('button', { name: '预览色彩组合：品牌绿', exact: true }).press('Enter');
  await savedDefault(page, 'paletteId', palette.id);
  checks.push('Variable combinations contain 1–9 removable colors with optional roles; minimal copy by name or ID remains queryable and preserves selection');

  panel = await library(page, '字体');
  assert.equal(await page.getByRole('region', { name: '颜色面板', exact: true }).count(), 0);
  assert.equal(await panel.locator('.design-scheme-row').count(), 5);
  const arialLayout = await cardLayout(panel);
  await panel.getByRole('button', { name: '复制字体指引：Arial', exact: true }).click();
  await page.getByText('字体指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  const arialGuide = await readClipboard();
  assert.equal(arialGuide, '请使用 Dockyard 中的字体 "Arial"。');
  assert.equal((await registry.get('Arial')).entries[0].family, 'Arial');
  assert.equal((await activeDesign(page)).fontId, undefined, 'Copying a font makes it accessible without applying it.');
  await stableLayout(panel, arialLayout);
  await panel.getByRole('button', { name: '预览字体：Georgia', exact: true }).click();
  assert.equal((await activeDesign(page)).fontId, undefined);
  const georgiaLayout = await cardLayout(panel);
  await panel.getByRole('button', { name: '预览字体：Georgia', exact: true }).dblclick();
  await savedDefault(page, 'fontId', 'font-dockyard-georgia');
  await stableLayout(panel, georgiaLayout);
  assert.equal((await panel.innerText()).includes('双击'), false);
  assert.equal(await panel.locator('.design-scheme-row').first().evaluate(el => el.getBoundingClientRect().width <= 200 && el.getBoundingClientRect().height <= 120), true);
  assert.equal(await panel.locator('.design-current').innerText(), '使用中：Georgia');
  assert.equal((await activeDesign(page)).paletteId, palette.id);

  await panel.getByRole('button', { name: '添加字体', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建字体', exact: true });
  assert.equal(await dialog.getByLabel('分别设置标题、正文', { exact: true }).isChecked(), false);
  assert.equal(await dialog.getByLabel('标题字体名称', { exact: true }).count(), 0);
  await dialog.getByLabel('正文字体名称', { exact: true }).fill('Unsafe; CSS');
  await dialog.getByRole('button', { name: '保存并使用', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await dialog.getByLabel('正文字体名称', { exact: true }).fill('Trebuchet MS');
  await dialog.getByLabel('正文字体备用字体', { exact: true }).fill('Microsoft YaHei, sans-serif');
  await dialog.getByLabel('正文字体字号', { exact: true }).fill('18');
  await noOverflow(page);
  await page.screenshot({ path: path.join(artifacts, 'design-single-font-editor.png') });
  await dialog.getByRole('tab', { name: '预览', exact: true }).click();
  assert.match(await dialog.locator('.design-preview h2').evaluate(el => getComputedStyle(el).fontFamily), /Trebuchet MS/);
  await dialog.getByRole('button', { name: '保存并使用', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const single = (await manager.listComponents()).find(value => value.name === 'Trebuchet MS');
  assert.equal(single.mode, 'single'); assert.equal(single.entries.length, 1);
  await savedDefault(page, 'fontId', single.id);
  checks.push('Single font by default, automatic display name, font input validation, same family for heading and body');

  await panel.getByRole('button', { name: '添加字体', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建字体', exact: true });
  await dialog.getByLabel('分别设置标题、正文', { exact: true }).check();
  await dialog.getByLabel('名称', { exact: true }).fill('阅读字体');
  await dialog.getByLabel('标题字体名称', { exact: true }).fill('Georgia');
  await dialog.getByLabel('标题字体备用字体', { exact: true }).fill('Microsoft YaHei, serif');
  await dialog.getByLabel('标题字体来源', { exact: true }).selectOption('web');
  await dialog.getByLabel('标题字体样式链接', { exact: true }).fill('https://fonts.example.com/brand.css');
  await dialog.getByLabel('正文字体字号', { exact: true }).fill('18');
  await dialog.getByLabel('正文字体备用字体', { exact: true }).fill('Segoe UI, sans-serif');
  await dialog.getByRole('button', { name: '添加代码字体', exact: true }).click();
  await dialog.getByLabel('代码字体来源', { exact: true }).selectOption('file');
  await app.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, fontFile);
  await dialog.getByRole('button', { name: '浏览…', exact: true }).click();
  await page.waitForFunction(expected => document.querySelector('input[aria-label="代码字体文件路径"]')?.value === expected, fontFile);
  await noOverflow(page);
  await page.screenshot({ path: path.join(artifacts, 'design-font-editor.png') });
  await dialog.getByRole('tab', { name: '预览', exact: true }).click();
  await dialog.getByRole('button', { name: '保存并使用', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const fonts = (await manager.listComponents()).find(value => value.name === '阅读字体');
  assert.equal(fonts.mode, 'pairing');
  await savedDefault(page, 'fontId', fonts.id);
  await panel.getByRole('button', { name: '复制字体指引：阅读字体', exact: true }).click();
  await page.getByText('字体指引已复制，可粘贴给 AI', { exact: true }).waitFor();
  const fontGuide = await readClipboard();
  assert.equal(fontGuide, '请使用 Dockyard 中的字体 "阅读字体"。');
  const namedFonts = await registry.get('阅读字体');
  assert.equal(namedFonts.entries.find(entry => entry.role === 'code').source.path, fontFile);
  const localFont = await registry.get(fonts.id + '::code');
  assert.equal(localFont.source.path, fontFile);
  assert.equal(localFont.availability, 'available');
  assert.equal((await manager.listComponents()).filter(item => item.name === '阅读字体').length, 1);
  checks.push('Font card copies one short sentence; name lookup provides file paths and CSS on demand; copying preserves current selection');

  const context = await registry.context();
  assert.deepEqual(context.workspace.design, { paletteRef: palette.id + '::$scheme', fontRef: fonts.id + '::$scheme' });
  assert.equal((await registry.get(context.workspace.design.paletteRef)).entries.find(entry => entry.role === 'primary').value, '#226245');
  assert.equal((await registry.get(fonts.id + '::body')).size, 18);
  await panel.getByRole('button', { name: '复制 CSS', exact: true }).click();
  await page.getByText('CSS 已复制', { exact: true }).waitFor();
  const css = await readClipboard();
  assert.match(css, /--color-primary: #226245/); assert.match(css, /--font-body-size: 18px/);
  assert.match(css, /@import/); assert.match(css, /@font-face/);
  await noOverflow(page);

  await screenshot(page, 'design-font-library-dark.png');
  await page.getByRole('button', { name: '切换到白天模式', exact: true }).click();
  await page.getByRole('button', { name: '切换到黑夜模式', exact: true }).waitFor();
  await screenshot(page, 'design-font-library-light.png');
  checks.push('Independent applied choices, current-workspace MCP refs, combined CSS clipboard and both app themes');

  panel = await library(page, '色彩组合');
  await panel.getByRole('button', { name: '预览色彩组合：品牌绿', exact: true }).click();
  await panel.getByRole('button', { name: '编辑方案：品牌绿', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑色彩组合', exact: true });
  await dialog.getByLabel('辅助色 HEX', { exact: true }).fill('#445566');
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await registry.get(palette.id + '::secondary')).value, '#445566');
  await panel.getByRole('button', { name: '预览色彩组合：品牌蓝', exact: true }).click();
  await panel.getByRole('button', { name: '删除方案：品牌蓝', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await page.getByRole('dialog', { name: '移除资源', exact: true }).waitFor({ state: 'hidden' });
  await panel.getByLabel('筛选色彩组合', { exact: true }).fill('没有结果');
  assert.equal(await panel.locator('.design-scheme-row').count(), 0);
  assert.equal(await panel.getByRole('button', { name: '添加色彩组合', exact: true }).count(), 1);
  await panel.getByLabel('筛选色彩组合', { exact: true }).fill('');
  await noOverflow(page);

  await screenshot(page, 'design-color-library-light.png');
  checks.push('Editing, removal, searchable options and add remains beside selection');

  // Ordinary swatches can be edited and deleted directly from the same color panel.
  const selectedHex = await panel.getByLabel('当前色 HEX', { exact: true }).inputValue();
  const selectedDesign = await activeDesign(page);
  await panel.getByRole('button', { name: '管理色板', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑色板', exact: true });
  await dialog.getByRole('button', { name: '移除颜色 1', exact: true }).click();
  await dialog.getByRole('button', { name: '保存资源', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await panel.waitFor();
  assert.equal(await panel.getByRole('button', { name: '独立颜色 #336699', exact: true }).count(), 0);
  assert.equal((await registry.get('临时颜色')).value, '#ABCDEF');
  await assert.rejects(registry.get('独立颜色'), { code: 'NOT_FOUND' });
  await panel.getByRole('button', { name: '删除色板', exact: true }).click();
  await page.getByText('色板已删除', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'One click deletes the palette without a confirmation dialog.');
  await panel.waitFor();
  assert.equal(await panel.getByRole('button', { name: '删除色板', exact: true }).isDisabled(), true);
  assert.equal(await panel.getByLabel('已保存色板', { exact: true }).inputValue(), '');
  assert.equal((await manager.listComponents()).some(value => value.id === ordinaryPalette.id), false);
  assert.equal((await manager.listWorkspaces()).workspaces.some(value => value.componentIds.includes(ordinaryPalette.id)), false);
  await assert.rejects(registry.get('临时颜色'), { code: 'NOT_FOUND' });
  assert.deepEqual(await activeDesign(page), selectedDesign);
  assert.equal(await panel.getByLabel('当前色 HEX', { exact: true }).inputValue(), selectedHex);
  await panel.getByLabel('保存颜色名称', { exact: true }).fill('新的单色');
  await panel.getByRole('button', { name: '保存到色板', exact: true }).click();
  await page.getByText('颜色已保存到色板', { exact: false }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '删除色板', exact: true }).isEnabled(), true);
  const recreated = (await manager.listComponents()).find(value => value.type === 'palette' && value.name === '我的色板');
  assert.notEqual(recreated.id, ordinaryPalette.id);
  assert.equal(recreated.entries[0].name, '新的单色');
  assert.equal(recreated.entries[0].value, selectedHex);
  await noOverflow(page);
  await screenshot(page, 'design-color-library-light.png');
  checks.push('One-click swatch-palette deletion without confirmation, individual-color removal and return to the same panel; removes workspace refs and preserves applied combinations; saving works after deletion');

  await page.getByRole('button', { name: '预设工作区', exact: true }).click();
  await page.getByRole('button', { name: '新建工作区', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建工作区', exact: true });
  await dialog.getByLabel('工作区名称', { exact: true }).fill('作品集');
  await dialog.getByRole('button', { name: '保存工作区', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /作品集 0 个资源组件/ }).click();
  await ready(page);
  await page.getByRole('button', { name: '管理资源', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 Georgia', exact: true }).check();
  await page.getByText('已添加到工作区', { exact: true }).waitFor();
  panel = await library(page, '字体');
  assert.deepEqual(await activeDesign(page), {});
  await panel.getByRole('button', { name: '预览字体：Georgia', exact: true }).dblclick();
  await savedDefault(page, 'fontId', 'font-dockyard-georgia');
  await page.getByRole('button', { name: '预设工作区', exact: true }).click();
  await page.getByRole('button', { name: /Default \d+ 个资源组件/ }).click();
  panel = await library(page, '字体');
  assert.deepEqual(await activeDesign(page), { paletteId: palette.id, fontId: fonts.id });
  await panel.getByRole('button', { name: '取消使用', exact: true }).click();
  await savedDefault(page, 'fontId', undefined);
  assert.equal((await activeDesign(page)).paletteId, palette.id);
  await panel.getByRole('button', { name: '预览字体：阅读字体', exact: true }).dblclick();
  await savedDefault(page, 'fontId', fonts.id);
  assert.equal(await page.getByLabel('默认字体方案', { exact: true }).count(), 0);
  const fontCount = await panel.locator('.design-choice-foot>span').innerText();
  await panel.getByRole('checkbox', { name: '启用 阅读字体', exact: true }).uncheck();
  await page.getByText('资源已暂停', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '预览字体：阅读字体', exact: true }).count(), 1);
  assert.equal(await panel.locator('.design-choice-foot>span').innerText(), fontCount);
  assert.equal((await registry.context()).workspace.design.fontRef, undefined);
  await assert.rejects(registry.get(fonts.id + '::$scheme'), { code: 'NOT_FOUND' });
  await app.close(); app = undefined;
  page = await launch();
  panel = await library(page, '字体');
  assert.deepEqual(await activeDesign(page), { paletteId: palette.id, fontId: fonts.id });
  assert.equal(await panel.getByRole('button', { name: '预览字体：阅读字体', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.getByRole('checkbox', { name: '启用 阅读字体', exact: true }).isChecked(), false);
  await panel.getByRole('checkbox', { name: '启用 阅读字体', exact: true }).check();
  await page.getByText('资源已启用', { exact: true }).waitFor();
  assert.equal((await registry.get(fonts.id + '::$scheme')).type, 'font-scheme');
  assert.equal(await page.getByRole('button', { name: '切换到黑夜模式', exact: true }).count(), 1);
  assert.equal(await fs.readFile(fontFile, 'utf8'), 'KEEP_FONT_SOURCE');
  assert.deepEqual(errors, []);
  checks.push('Workspace isolation, clear only one choice, selected mark and defaults restored after restart; sources preserved');
  console.log(JSON.stringify({ ok: true, checks, screenshots: artifacts }, null, 2));
} catch (error) {
  const page = await app?.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: path.join(artifacts, 'design-failure.png') }).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
  assert.match(relative, /^dockyard-design-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true });
}
