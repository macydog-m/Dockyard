import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fontAiGuide, paletteAiGuide, colorAiGuide } from '../packages/shared/dist/index.js';

async function load(file) {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const i18n = await load('apps/desktop/src/i18n/index.ts');
const { english } = await load('apps/desktop/src/i18n/en.ts');
const preferences = await load('apps/desktop/src/language.ts');

test('both dictionaries cover the same messages and preserve placeholder values verbatim', () => {
  for (const [key, value] of Object.entries(english)) {
    assert.ok(value.trim(), key);
    assert.deepEqual(key.match(/\{\d+\}/g), value.match(/\{\d+\}/g), key);
    i18n.setLocale('en'); assert.equal(i18n.t(key), value);
    i18n.setLocale('zh-CN'); assert.equal(i18n.t(key), key);
  }
  i18n.setLocale('en');
  assert.equal(i18n.t('已选中「{0}」 · 双击卡片编辑', ['我的 {1} 笔记']), 'Selected “我的 {1} 笔记” · Double-click to edit');
  assert.equal(i18n.translateMessage('无法读取记事本，原文件已保留。请检查数据文件或目录权限。'), english['无法读取记事本，原文件已保留。请检查数据文件或目录权限。']);
  assert.equal(i18n.translateMessage('Unknown diagnostic with a file path'), 'Unknown diagnostic with a file path');
  assert.equal(i18n.translateMessage('constructor'), 'constructor');
});

test('language preferences survive reload, reject invalid writes and recover from invalid files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dockyard-language-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const system of ['zh-CN', 'zh-TW', 'zh_HK']) assert.equal(preferences.readLanguage(directory, system).locale, 'zh-CN');
  for (const system of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', '']) assert.equal(preferences.readLanguage(directory, system).locale, 'en');
  preferences.writeLanguage(directory, 'en');
  assert.deepEqual(preferences.readLanguage(directory, 'zh-CN'), { preference: 'en', locale: 'en' });
  preferences.writeLanguage(directory, 'zh-CN');
  assert.equal(preferences.readLanguage(directory, 'en-US').locale, 'zh-CN');
  const before = await readFile(path.join(directory, 'language.json'), 'utf8');
  for (const value of ['ja', '', null, {}, '../en', 'constructor']) {
    assert.equal(preferences.isLanguagePreference(value), false);
    assert.throws(() => preferences.writeLanguage(directory, value));
  }
  assert.equal(await readFile(path.join(directory, 'language.json'), 'utf8'), before);
  for (const content of ['{', '{"language":"ja"}', 'null']) {
    await writeFile(path.join(directory, 'language.json'), content, 'utf8');
    assert.deepEqual(preferences.readLanguage(directory, 'en-GB'), { preference: 'system', locale: 'en' });
  }
  preferences.writeLanguage(directory, 'system');
  assert.equal(preferences.readLanguage(directory, 'zh-CN').locale, 'zh-CN');
});

test('AI guides localize only intent and preserve exact resource names and refs', () => {
  const resource = { name: '海岸蓝 "A" {1}' };
  assert.equal(fontAiGuide(resource, 'en'), 'Please use the font ' + JSON.stringify(resource.name) + ' from Dockyard.');
  assert.equal(paletteAiGuide(resource, undefined, 'en'), 'Please use the palette ' + JSON.stringify(resource.name) + ' from Dockyard.');
  assert.equal(colorAiGuide(resource, 'palette::000101', 'en'), 'Please use the color "palette::000101" from Dockyard.');
  assert.equal(paletteAiGuide(resource, 'palette-id', 'en'), 'Please use the palette "palette-id" from Dockyard.');
  assert.equal(fontAiGuide(resource), '请使用 Dockyard 中的字体 ' + JSON.stringify(resource.name) + '。');
});
