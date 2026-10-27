import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { checkVersion, readJson, root } from './version.mjs';

const execute = promisify(execFile);
export async function prepareRelease(kind = 'releases') {
  if (!['releases', 'directory-packages'].includes(kind)) throw new Error('Unknown package kind.');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Desktop packages currently require Windows x64.');
  if (process.env.DOCKYARD_BUILD_VERSION) throw new Error('Use npm run version:set -- <version>; per-build version overrides are no longer supported.');
  const version = await checkVersion();
  const pkg = await readJson('package.json');
  const output = path.join(root, '.local', kind, version);
  await mkdir(path.dirname(output), { recursive: true });
  // A version may be built once per output folder; never overwrite reviewed artifacts.
  await mkdir(output);
  const stagingRoot = path.join(root, '.local/builds');
  await mkdir(stagingRoot, { recursive: true });
  const appDir = await mkdtemp(path.join(stagingRoot, 'desktop-'));
  const desktop = path.join(root, 'apps/desktop');
  const env = { ...process.env, DOCKYARD_BUILD_DIR: appDir };
  await execute(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: desktop, env, windowsHide: true });
  const result = await execute(process.execPath, ['build.mjs'], { cwd: desktop, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  return { version, output, appDir, electronVersion: pkg.devDependencies.electron };
}
export async function writeChecksums(directory, files) {
  const lines = [];
  for (const file of [...new Set(files)].sort()) {
    const full = path.resolve(file);
    if (path.dirname(full) !== path.resolve(directory)) throw new Error('Release asset is outside its output directory.');
    const hash = createHash('sha256').update(await readFile(full)).digest('hex');
    lines.push(hash + '  ' + path.basename(full));
  }
  if (!lines.length) throw new Error('No release assets to checksum.');
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
}
