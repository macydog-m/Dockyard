import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { manifests, root } from '../scripts/version.mjs';
import { writeChecksums } from '../scripts/release-build.mjs';

const execute = promisify(execFile);
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dockyard-release-tests-'));
  t.after(async () => {
    assert.match(path.relative(path.resolve(tmpdir()), path.resolve(directory)), /^dockyard-release-tests-[^/\\]+$/);
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
test('version changes synchronize workspaces, lockfile and runtime without touching the real repository', async t => {
  const directory = await temporary(t);
  for (const file of [...manifests, 'package-lock.json', 'scripts/version.mjs', 'packages/shared/src/version.ts']) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(directory, file));
  }
  const run = value => execute(process.execPath, ['scripts/version.mjs', value], { cwd: directory, windowsHide: true });
  await run('0.2.0-beta.1');
  await run('--check');
  const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
  for (const file of manifests) {
    const value = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    assert.equal(value.version, '0.2.0-beta.1');
    const key = file === 'package.json' ? '' : path.posix.dirname(file);
    assert.equal(lock.packages[key].version, value.version);
    for (const [name, version] of Object.entries(value.dependencies ?? {})) if (name.startsWith('@dockyard/')) assert.equal(version, value.version);
  }
  const before = await readFile(path.join(directory, 'package.json'), 'utf8');
  await assert.rejects(run('0.2.0-beta.01'));
  assert.equal(await readFile(path.join(directory, 'package.json'), 'utf8'), before);
  await writeFile(path.join(directory, 'packages/shared/src/version.ts'), 'stale', 'utf8');
  await assert.rejects(run('--check'));
});
test('release checksums describe the actual assets and reject files outside the output folder', async t => {
  const directory = await temporary(t);
  const asset = path.join(directory, 'Dockyard-test.zip');
  await writeFile(asset, 'new build bytes', 'utf8');
  await writeChecksums(directory, [asset, asset]);
  const expected = createHash('sha256').update('new build bytes').digest('hex');
  assert.equal(await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), `${expected}  Dockyard-test.zip\n`);
  await assert.rejects(writeChecksums(directory, [path.join(directory, '../outside.zip')]));
  await assert.rejects(writeChecksums(directory, []));
});
