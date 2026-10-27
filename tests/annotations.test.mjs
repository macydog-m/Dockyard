import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['apps/desktop/src/renderer/annotations.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const rect = { id: 'rectangle', kind: 'rect', x: 80, y: 100, endX: 20, endY: 30, color: '#EF3038', weight: 'medium' };

test('annotation preferences recover from damaged storage and normalize distinct recent custom colors', () => {
  for (const input of [null, '{', 'null', 'false', '12', '[]']) {
    assert.deepEqual(model.readAnnotationPreferences(input), { rect: model.defaultStyle, arrow: model.defaultStyle, recent: [] });
  }
  const prefs = model.readAnnotationPreferences(JSON.stringify({
    rect: { color: '#aabbcc', weight: 'thick' }, arrow: { color: 'invalid', weight: 'huge' },
    recent: [12, '#aabbcc', '#AABBCC', '#EF3038', '#123456', null, '#ffffff', '#abcdef', '#111112', '#111113', '#111114', '#111115'],
  }));
  assert.deepEqual(prefs.rect, { color: '#AABBCC', weight: 'thick' });
  assert.deepEqual(prefs.arrow, model.defaultStyle);
  assert.deepEqual(prefs.recent, ['#AABBCC', '#123456', '#ABCDEF', '#111112', '#111113', '#111114']);
  assert.equal(model.normalizeColor(' abcdef '), '#ABCDEF');
  assert.equal(model.normalizeColor('#abc'), null);
});

test('undo and redo restore color, geometry, deletions and clear; a new edit discards the redo branch', () => {
  let history = model.commitAnnotations(model.createAnnotationHistory(), [rect]);
  history = model.commitAnnotations(history, [{ ...rect, color: '#3B82F6', x: 90 }]);
  const edited = history.present;
  history = model.commitAnnotations(history, []);
  history = model.undoAnnotations(history);
  assert.deepEqual(history.present, edited);
  history = model.undoAnnotations(history);
  assert.deepEqual(history.present, [rect]);
  history = model.redoAnnotations(history);
  assert.deepEqual(history.present, edited);
  assert.equal(model.commitAnnotations(history, [...edited]), history, 'no-op clicks do not consume undo history');
  history = model.commitAnnotations(history, [{ ...rect, weight: 'thin' }]);
  assert.deepEqual(history.future, []);
  assert.equal(model.redoAnnotations(history), history);
  assert.deepEqual(rect.color, '#EF3038', 'earlier snapshots remain immutable');
});

test('reversed rectangles move within bounds without shrinking and resize across their opposite corner', () => {
  const moved = model.moveAnnotation(rect, { x: -200, y: 300 }, 200, 180);
  assert.deepEqual([moved.x, moved.y, moved.endX, moved.endY], [60, 180, 0, 110]);
  assert.equal(model.hitAnnotation(rect, { x: 50, y: 60 }, 5, 200, 180), true);
  assert.equal(model.hitAnnotation(rect, { x: 150, y: 60 }, 5, 200, 180), false);
  const resized = model.resizeAnnotation(rect, 0, { x: 5, y: 10 });
  assert.deepEqual([resized.x, resized.y, resized.endX, resized.endY], [5, 10, 20, 30]);
  assert.equal(model.validAnnotation(resized), true);
  assert.equal(model.validAnnotation({ ...rect, endX: rect.x }), false);
});

test('arrow endpoints resize independently and selection includes the arrowhead on a scaled preview', () => {
  const arrow = { ...rect, kind: 'arrow', x: 20, y: 20, endX: 160, endY: 80, weight: 'thick' };
  const resized = model.resizeAnnotation(arrow, 1, { x: 180, y: 120 });
  assert.deepEqual([resized.x, resized.y, resized.endX, resized.endY], [20, 20, 180, 120]);
  const head = model.arrowHead(arrow, 200, 180);
  assert.equal(model.hitAnnotation(arrow, head[1], 12, 200, 180), true);
  assert.equal(model.hitAnnotation(arrow, { x: 20, y: 150 }, 12, 200, 180), false);
  assert.equal(model.validAnnotation({ ...arrow, endX: 20, endY: 20 }), false);
});
