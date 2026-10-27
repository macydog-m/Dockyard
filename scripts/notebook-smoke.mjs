import { setSmokeLanguage } from './smoke-language.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDemo } from './dockyard.mjs';

await fs.mkdir(path.resolve('.local'), { recursive: true });
const root = await fs.mkdtemp(path.resolve('.local/notebook-check-'));
const dataDir = path.join(root, 'data');
await createDemo(dataDir);
await setSmokeLanguage(dataDir);
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !document.querySelector('.workspace-trigger')?.disabled);
  const bar = await page.locator('.dock-bar').evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth, items: [...el.children].map(item => [item.className, item.getBoundingClientRect().width]) }));
  assert.ok(bar.scroll <= bar.width, 'toolbar still fits with notebook entry: ' + JSON.stringify(bar));
  const workspaceId = await page.evaluate(async () => (await window.dockyard.state()).value.activeWorkspaceId);
  const file = path.join(dataDir, 'notebooks', workspaceId + '.json');
  const saved = async () => { await page.getByRole('status').filter({ hasText: '已自动保存' }).waitFor(); };
  // Read through the worker queue so earlier UI saves finish before assertions.
  const read = async () => {
    const reply = await page.evaluate(id => window.dockyard.notebook(id), workspaceId);
    assert.ok(reply.ok); return reply.value;
  };
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  await page.getByRole('button', { name: '新建笔记', exact: true }).waitFor();
  // Windows fractional display scaling can round a requested DIP by one pixel.
  await page.waitForFunction(() => Math.abs(innerHeight - 659) <= 1);
  assert.equal(await page.locator('.notebook-quick').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return Math.abs(rect.left - 8) <= 1 && Math.abs(rect.right - (innerWidth - 8)) <= 1;
  }), true, 'quick notes fill the window between its outer margins');
  const width = await page.evaluate(() => innerWidth);
  await page.mouse.click(width - 24, 250);
  assert.equal(await page.locator('.notebook-quick').isVisible(), true, 'right side of notes does not dismiss the panel');
  await page.mouse.click(width - 2, 250);
  assert.equal(await page.locator('.notebook-quick').isVisible(), true, 'outer window margin does not dismiss notes');
  for (const [title, body] of [
    ['工具栏的小想法', '默认只显示图标，保持轻巧。\n需要时再打开标签，不打断手边的工作。'],
    ['今天听到的反馈', '新用户不容易认出所有图标。\n第一次悬停时，给一个简短的功能提示。'],
    ['下次试试看', '找两位第一次使用的朋友，\n看看能否直接找到记事本入口。'],
  ]) {
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByLabel('笔记标题', { exact: true }).fill(title);
    await page.getByLabel('笔记正文', { exact: true }).fill(body);
    await saved();
  }
  let data = await read(); assert.equal(data.notes.length, 3);
  const [first, second, third] = data.notes;
  await page.locator('.note-list-item').filter({ hasText: first.title }).click();
  await page.screenshot({ path: path.join(artifacts, 'notebook-quick.png') });
  await page.getByRole('tab', { name: '连线画布', exact: true }).click();
  await page.waitForFunction(() => Math.abs(innerWidth - 1096) <= 1 && Math.abs(innerHeight - 718) <= 1);
  const card = id => page.locator(`[data-note-id="${id}"]`);
  const port = await card(first.id).locator('.note-port.right').boundingBox();
  const target = await card(second.id).boundingBox();
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down(); await page.mouse.move(target.x + 2, target.y + 95, { steps: 12 }); await page.mouse.up();
  await page.getByLabel('关系说明', { exact: true }).fill('来自反馈'); await saved();
  assert.equal((await read()).links.length, 1);
  await card(first.id).getByRole('button', { name: '连线', exact: true }).click();
  await card(third.id).click({ position: { x: 80, y: 70 } });
  await page.getByLabel('关系说明', { exact: true }).fill('接下来尝试'); await saved();
  assert.equal((await read()).links.length, 2);
  // Real pointer movement must persist the position independently of view switches.
  const origin = await card(first.id).boundingBox();
  await page.mouse.move(origin.x + 70, origin.y + 35); await page.mouse.down();
  await page.mouse.move(origin.x + 100, origin.y + 55, { steps: 8 }); await page.mouse.up(); await saved();
  data = await read(); assert.equal(Math.round(data.notes[0].x), first.x + 30); assert.equal(Math.round(data.notes[0].y), first.y + 20);
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  assert.equal(await page.getByLabel('画布缩放').textContent(), '90%');
  await page.getByRole('button', { name: '放大画布', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.getByRole('button', { name: '重置画布视图', exact: true }).click();
  await card(first.id).click({ position: { x: 50, y: 60 } });
  await page.screenshot({ path: path.join(artifacts, 'notebook-canvas.png') });
  const images = await page.locator('.notebook-panel img').evaluateAll(elements => elements.map(el => ({ source: el.getAttribute('src'), valid: el.complete && el.naturalWidth > 0, width: el.getBoundingClientRect().width, natural: el.naturalWidth })));
  assert.ok(images.length > 0 && images.every(image => image.valid && image.width > 0), 'all notebook assets load locally: ' + JSON.stringify(images.filter(image => !image.valid || image.width <= 0)));
  assert.ok(images.filter(image => !image.source.includes('canvasimg3')).every(image => Math.abs(image.width - image.natural) < 1), 'icons preserve their design dimensions');
  await card(first.id).getByRole('button', { name: '笔记操作', exact: true }).click();
  await page.getByRole('button', { name: '删除笔记', exact: true }).click(); await saved();
  assert.equal((await read()).links.length, 0);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click(); await saved();
  assert.equal((await read()).links.length, 2);
  await card(first.id).dblclick({ position: { x: 90, y: 65 } });
  await page.getByLabel('笔记正文', { exact: true }).fill('关闭前的最后一次修改，UTF-8 中文。');
  await page.getByRole('button', { name: '关闭记事本', exact: true }).click();
  await page.waitForFunction(() => innerHeight <= 96 && Math.abs(innerWidth - 711) <= 1);
  await page.getByRole('button', { name: '记事本', exact: true }).click(); await saved();
  assert.match(await page.getByLabel('笔记正文').inputValue(), /最后一次修改/);
  // A failed write stays visibly unsaved and retains recovery data instead of replacing the file.
  const valid = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, '{broken', 'utf8');
  await page.getByLabel('笔记正文').fill('保存失败后重试的内容');
  await page.getByRole('alert').filter({ hasText: '无法读取记事本' }).waitFor();
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.writeFile(file, valid, 'utf8');
  await page.getByRole('button', { name: '重试', exact: true }).click(); await saved();
  assert.equal((await read()).notes.find(note => note.id === first.id).body, '保存失败后重试的内容');
  const secondWorkspace = await page.evaluate(async () => {
    await window.dockyard.createWorkspace('笔记隔离测试');
    const state = (await window.dockyard.state()).value;
    const id = state.workspaces.find(workspace => workspace.name === '笔记隔离测试').id;
    await window.dockyard.switchWorkspace(id); return id;
  });
  await page.reload(); await page.waitForFunction(() => !document.querySelector('.workspace-trigger')?.disabled);
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  await page.getByText('记下第一个想法，再用连线整理它们。', { exact: true }).waitFor();
  assert.equal(await page.locator('.note-list-item').count(), 0);
  const invalid = await page.evaluate(async ({ id, note }) => window.dockyard.saveNotebook(id, { version: 1, notes: [note], links: [{ id: crypto.randomUUID(), source: note.id, target: note.id, label: '' }] }), { id: secondWorkspace, note: first });
  assert.equal(invalid.ok, false);
  await page.evaluate(async id => window.dockyard.switchWorkspace(id), workspaceId);
  await app.close(); app = undefined;
  app = await electron.launch({ args: [path.resolve('apps/desktop'), '--data-dir', dataDir], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => !document.querySelector('.workspace-trigger')?.disabled);
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  await page.locator('.note-list-item').filter({ hasText: first.title }).click();
  assert.equal(await page.getByLabel('笔记正文').inputValue(), '保存失败后重试的内容');
  assert.equal((await read()).links.length, 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['UTF-8 autosave and restart', 'shared notes/canvas state', 'pointer drag, links and labels', 'zoom and fit', 'delete with linked-note undo', 'failed save recovery', 'workspace isolation and invalid-link rejection', 'local notebook asset geometry', 'toolbar and canvas native sizes'], artifacts }, null, 2));
} finally { await app?.close(); }
