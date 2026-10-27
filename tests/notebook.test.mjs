import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';

const bundle = await build({ entryPoints: ['apps/desktop/src/notebook-model.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { notebookSchema, emptyNotebook } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const note = () => ({ id: randomUUID(), title: '中文笔记', body: '多行\n想法', x: 64, y: 172, updatedAt: new Date().toISOString() });

test('notebooks accept independent empty and Unicode documents', () => {
  const a = emptyNotebook(), b = emptyNotebook(); a.notes.push(note());
  assert.equal(b.notes.length, 0);
  assert.equal(notebookSchema.parse(a).notes[0].body, '多行\n想法');
});

test('notebooks reject duplicate notes, orphaned, self and duplicate relationships', () => {
  const first = note(), second = note();
  const link = { id: randomUUID(), source: first.id, target: second.id, label: '来自反馈' };
  const valid = { version: 1, notes: [first, second], links: [link] };
  assert.equal(notebookSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, notes: [first, first] },
    { ...valid, links: [{ ...link, target: randomUUID() }] },
    { ...valid, links: [{ ...link, target: first.id }] },
    { ...valid, links: [link, { ...link, id: randomUUID(), source: second.id, target: first.id }] },
  ]) assert.equal(notebookSchema.safeParse(invalid).success, false);
});

test('notebooks reject invalid coordinates and oversized payloads before saving', () => {
  for (const x of [NaN, Infinity, 100001]) assert.equal(notebookSchema.safeParse({ version: 1, notes: [{ ...note(), x }], links: [] }).success, false);
  assert.equal(notebookSchema.safeParse({ version: 1, notes: [{ ...note(), body: '字'.repeat(10001) }], links: [] }).success, false);
  assert.equal(notebookSchema.safeParse({ version: 1, notes: Array.from({ length: 100 }, () => ({ ...note(), body: '字'.repeat(9000) })), links: [] }).success, false);
});
