import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDemo } from './dockyard.mjs';
import { setSmokeLanguage } from './smoke-language.mjs';

const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-language-ui-'));
const dataDir = path.join(root, 'data');
const artifacts = path.resolve('output/playwright/languages');
await fs.mkdir(artifacts, { recursive: true });
await createDemo(dataDir);
await setSmokeLanguage(dataDir, 'en');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const errors = [], checks = [];
let app, page;
async function launch() {
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.workspace-trigger')?.disabled === false);
}
async function settings() {
  if (!await page.locator('.language-setting').isVisible()) await page.locator('.dock-bar > .tool-button').last().click();
  await page.locator('.language-setting select').waitFor();
}
async function language(value, resolved = value) {
  await settings();
  await page.getByLabel('Language / 语言', { exact: true }).selectOption(value);
  await page.waitForFunction(locale => document.documentElement.lang === locale, resolved);
  await page.waitForFunction(() => !document.querySelector('.language-setting select').disabled);
}
async function snapshot(name) {
  await page.screenshot({ path: path.join(artifacts, name + '.png'), animations: 'disabled', omitBackground: true });
}
async function noHorizontalOverflow(selector) {
  const overflow = await page.locator(selector).evaluateAll(elements => elements.flatMap(el => {
    const rect = el.getBoundingClientRect();
    return rect.width && (el.scrollWidth > el.clientWidth + 2 || rect.right > innerWidth + 1) ? [{ text: el.textContent, width: el.clientWidth, content: el.scrollWidth }] : [];
  }));
  assert.deepEqual(overflow, [], selector);
}
try {
  await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByLabel('Note title', { exact: true }).fill('我的笔记 {1}');
  await page.getByLabel('Note body', { exact: true }).fill('保留中文、English、日本語、한국어。');
  await page.getByRole('status').filter({ hasText: 'Autosaved' }).waitFor();
  await language('zh-CN');
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  assert.equal(await page.getByLabel('笔记标题', { exact: true }).inputValue(), '我的笔记 {1}');
  assert.equal(await page.getByLabel('笔记正文', { exact: true }).inputValue(), '保留中文、English、日本語、한국어。');
  await page.getByRole('status').filter({ hasText: '已自动保存' }).waitFor();
  checks.push('Live language switch retains notebook content and localizes existing save status');
  await language('en');
  const before = (await page.evaluate(() => window.dockyard.state())).value;
  const invalid = await page.evaluate(() => window.dockyard.setLanguage('ja'));
  assert.equal(invalid.ok, false);
  assert.equal((await page.evaluate(() => window.dockyard.getLanguage())).value.preference, 'en');
  assert.deepEqual((await page.evaluate(() => window.dockyard.state())).value, before);
  await noHorizontalOverflow('.more-actions button, .toolbar-settings-grid button, .language-setting');
  await snapshot('en-settings');
  await language('zh-CN'); await snapshot('zh-settings');
  await language('en');

  // Verify native dialog titles without opening a blocking OS dialog.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_owner, options) => { globalThis.languageOpenDialog = options; return { canceled: true, filePaths: [] }; };
    dialog.showSaveDialog = async (_owner, options) => { globalThis.languageSaveDialog = options; return { canceled: true }; };
  });
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.getByRole('button', { name: 'Add Assets', exact: true }).click();
  await page.getByRole('button', { name: 'Browse…', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.languageOpenDialog.title), 'Choose an asset folder');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Current color and palettes', exact: true }).click();
  const ocean = page.locator('[data-scheme-id="palette-dockyard-ocean"]');
  await ocean.getByRole('button', { name: 'Preview Palettes: Ocean blue', exact: true }).waitFor();
  await ocean.getByRole('button', { name: 'Copy palette guide: Ocean blue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent.includes('guide copied'));
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copied, 'Please use the palette "Ocean blue" from Dockyard.');
  const config = await fs.readFile(path.join(dataDir, 'components/palette-dockyard-ocean.json'), 'utf8');
  await language('zh-CN');
  await page.getByRole('button', { name: '当前色与色盘', exact: true }).click();
  // Saved resource names are data; language switching must not rename them.
  await ocean.getByRole('button', { name: '复制颜色组合指引：Ocean blue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent.includes('指引已复制'));
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '请使用 Dockyard 中的颜色组合 "Ocean blue"。');
  assert.equal(await fs.readFile(path.join(dataDir, 'components/palette-dockyard-ocean.json'), 'utf8'), config);
  await language('en');
  checks.push('Native file dialog, localized presets and actual AI clipboard text in both languages; persisted resource unchanged');

  // Supply synthetic pixels so capture testing never reads the user's screen.
  await app.evaluate(({ desktopCapturer, screen, nativeImage }) => {
    desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => ({ id: 'screen:' + display.id, name: 'Synthetic', display_id: String(display.id),
      thumbnail: nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 255), { width: 64, height: 64 }) }));
  });
  async function overlay(locale) {
    await page.getByRole('button', { name: locale === 'en' ? 'Capture' : '截图', exact: true }).click();
    await page.waitForTimeout(250);
    let capture;
    for (let attempt = 0; attempt < 100; attempt++) {
      capture = app.windows().find(window => window.url().endsWith('/capture.html'));
      if (capture) break;
      await page.waitForTimeout(50);
    }
    assert.ok(capture);
    await capture.waitForFunction(() => !!document.body.dataset.ready);
    assert.equal(await capture.locator('html').getAttribute('lang'), locale);
    await capture.locator('#hint').filter({ hasText: locale === 'en' ? 'Drag to capture' : '拖动框选截图' }).waitFor();
    return capture;
  }
  let capture = await overlay('en');
  await capture.mouse.move(40, 60); await capture.mouse.down(); await capture.mouse.move(200, 160); await capture.mouse.up();
  await page.getByRole('region', { name: 'Screenshot preview', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save image', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.feedback')?.textContent.includes('cancelled'));
  assert.equal(await app.evaluate(() => globalThis.languageSaveDialog.title), 'Save screenshot');
  assert.equal(await app.evaluate(() => globalThis.languageSaveDialog.filters[0].name), 'PNG image');
  await snapshot('en-capture');
  await language('zh-CN');
  capture = await overlay('zh-CN');
  await capture.keyboard.press('Escape');
  checks.push('Synthetic screenshot capture, English save dialog and Chinese overlay after reusing the same capture window');

  await language('en');
  await page.keyboard.press('Escape');
  await page.getByRole('switch', { name: 'Show tool labels', exact: true }).click();
  await noHorizontalOverflow('.dock-bar');
  const overlaps = await page.locator('.tool-label').evaluateAll(elements => {
    const boxes = elements.filter(el => getComputedStyle(el).display !== 'none').map(el => ({ text: el.textContent, rect: el.getBoundingClientRect() }));
    return boxes.slice(1).filter((box, i) => box.rect.left < boxes[i].rect.right).map(box => box.text);
  });
  assert.deepEqual(overlaps, []);
  await snapshot('en-toolbar');
  await app.close(); app = undefined;
  await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), '我的笔记 {1}');
  await language('system', await app.evaluate(({ app }) => /^zh(?:[-_]|$)/i.test(app.getSystemLocale()) ? 'zh-CN' : 'en'));
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'desktop/language.json'), 'utf8')).language, 'system');
  checks.push('English toolbar layout, restart persistence and explicit system-language preference');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, artifacts }, null, 2));
} finally {
  await app?.close();
  assert.equal(path.dirname(root), tmpdir());
  await fs.rm(root, { recursive: true, force: true });
}
