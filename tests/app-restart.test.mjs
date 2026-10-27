import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const bundle = await build({
  entryPoints: ['apps/desktop/src/app-restart.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, target: 'node24',
});
const { AppRestarter, rebuildDesktop } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeApp(events, isPackaged = false) {
  return { isPackaged, getAppPath: () => 'F:/中文 project/apps/desktop',
    relaunch: options => events.push(['relaunch', options]),
    quit: () => events.push(['quit']) };
}

test('development restart waits for writes, builds once and relaunches with the same data directory', async () => {
  const events = [];
  let drained;
  const waiting = new Promise(resolve => { drained = resolve; });
  const restarter = new AppRestarter(fakeApp(events), 'F:/中文 data', () => waiting, async () => { events.push(['build']); });
  const pending = restarter.restart();
  assert.equal(restarter.restart(), pending);
  assert.equal(restarter.active, true);
  assert.equal(restarter.busy, true);
  assert.deepEqual(events, []);
  drained();
  assert.equal((await pending).ok, true);
  assert.equal(restarter.busy, false);
  assert.deepEqual(events, [
    ['build'], ['relaunch', { args: ['F:/中文 project/apps/desktop', '--data-dir', 'F:/中文 data'] }],
  ]);
  await tick();
  assert.deepEqual(events.at(-1), ['quit']);
  assert.equal(restarter.restart(), pending);
});

test('a failed development build preserves the app and permits another restart', async t => {
  t.mock.method(console, 'error', () => {});
  const events = [];
  let attempts = 0;
  const restarter = new AppRestarter(fakeApp(events), 'F:/data', async () => {}, async () => {
    if (++attempts === 1) throw Error('compile failed');
  });
  const failed = await restarter.restart();
  assert.equal(failed.code, 'APP_RESTART_FAILED');
  assert.equal(restarter.active, false);
  assert.equal(restarter.busy, false);
  await tick();
  assert.deepEqual(events, []);
  assert.equal((await restarter.restart()).ok, true);
  await tick();
  assert.equal(attempts, 2);
  assert.equal(events[0][0], 'relaunch');
  assert.equal(events[1][0], 'quit');
});

test('installed application restart skips building and retains the data directory', async () => {
  const events = [];
  const restarter = new AppRestarter(fakeApp(events, true), 'F:/data', async () => {},
    async () => assert.fail('installed apps must not compile source'));
  assert.equal((await restarter.restart()).ok, true);
  await tick();
  assert.deepEqual(events, [['relaunch', { args: ['--data-dir', 'F:/data'] }], ['quit']]);
});

test('development rebuild compiles dependencies in order and stops on a compiler failure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'dockyard-rebuild-'));
  t.after(async () => {
    assert.match(path.relative(path.resolve(tmpdir()), path.resolve(root)), /^dockyard-rebuild-[^/\\]+$/);
    await rm(root, { recursive: true, force: true });
  });
  const appPath = path.join(root, 'apps/desktop');
  const compilerDir = path.join(root, 'node_modules/typescript/bin');
  for (const directory of [compilerDir, appPath, ...['shared', 'core', 'mcp'].map(name => path.join(root, 'packages', name))]) {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(path.join(compilerDir, 'tsc'), `
    const fs = require('node:fs'), path = require('node:path');
    const root = path.resolve(__dirname, '../../..');
    if (process.env.ELECTRON_RUN_AS_NODE !== '1') throw Error('missing Node mode');
    fs.appendFileSync(path.join(root, 'order.txt'), path.relative(root, process.cwd()).replaceAll('\\\\', '/') + '\\n', 'utf8');
    if (fs.existsSync(path.join(root, 'fail'))) process.exit(1);
  `, 'utf8');
  await writeFile(path.join(appPath, 'build.mjs'), `
    import fs from 'node:fs';
    if (process.env.ELECTRON_RUN_AS_NODE !== '1') throw Error('missing Node mode');
    fs.appendFileSync('../../order.txt', 'bundle\\n', 'utf8');
  `, 'utf8');
  await rebuildDesktop(appPath);
  assert.equal(await readFile(path.join(root, 'order.txt'), 'utf8'),
    'packages/shared\npackages/core\npackages/mcp\napps/desktop\nbundle\n');
  await writeFile(path.join(root, 'order.txt'), '', 'utf8');
  await writeFile(path.join(root, 'fail'), '', 'utf8');
  await assert.rejects(rebuildDesktop(appPath));
  assert.equal(await readFile(path.join(root, 'order.txt'), 'utf8'), 'packages/shared\n');
});
