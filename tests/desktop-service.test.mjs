import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const bundle = await build({
  entryPoints: ['apps/desktop/src/desktop-service.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, target: 'node24',
});
const { DesktopService } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  const fs = require('node:fs/promises');
  const { setTimeout: delay } = require('node:timers/promises');
  let queue = Promise.resolve();
  parentPort.on('message', ({ id, command }) => {
    queue = queue.then(async () => {
      if (command.type === 'crash') throw Error('simulated worker crash');
      if (command.type === 'write') {
        parentPort.postMessage({ progress: { files: 1, directories: 0 } });
        await delay(80);
        await fs.writeFile(workerData.file, command.content, 'utf8');
      }
      parentPort.postMessage({ id, reply: { ok: true, value: null } });
    });
  });
`;

async function serviceFixture(t, progress = () => {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dockyard-restart-'));
  const entry = path.join(root, 'worker.cjs');
  const file = path.join(root, '保存的数据.txt');
  await writeFile(entry, workerSource, 'utf8');
  const service = new DesktopService(entry, { file }, progress);
  t.after(async () => {
    await service.stop();
    assert.match(path.relative(path.resolve(tmpdir()), path.resolve(root)), /^dockyard-restart-[^/\\]+$/);
    await rm(root, { recursive: true, force: true });
  });
  return { service, file };
}

test('application shutdown drains submitted worker writes before terminating', { timeout: 10000 }, async t => {
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const { service, file } = await serviceFixture(t, started);
  const content = '重启时保留配置与换行。\n🎨';
  const save = service.call({ type: 'write', content });
  await writing;
  assert.equal(service.busy, true);
  await service.drain();
  assert.equal((await save).ok, true);
  assert.equal(await readFile(file, 'utf8'), content);
  assert.equal(service.busy, false);
});

test('a crashed worker resolves pending commands and does not block application restart', { timeout: 10000 }, async t => {
  const { service } = await serviceFixture(t);
  assert.equal((await service.call({ type: 'crash' })).code, 'WORKER_UNAVAILABLE');
  await service.drain();
  assert.equal(service.busy, false);
  assert.equal((await service.call({ type: 'state' })).code, 'WORKER_UNAVAILABLE');
});
