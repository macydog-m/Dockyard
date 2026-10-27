import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DockyardManager, ResourceRegistry } from '../packages/core/dist/index.js';
import { createDemo } from '../scripts/dockyard.mjs';

export async function fixture(t, { demo = true } = {}) {
  // Windows runners can expose TEMP through an 8.3 alias (e.g. RUNNER~1).
  // Match the canonical paths used by storage and scanning, including mocks.
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, 'dockyard-core-'));
  t.after(async () => {
    assert.match(path.relative(temporaryRoot, path.resolve(root)), /^dockyard-core-[^/\\]+$/);
    await rm(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, '中文 data');
  if (demo) await createDemo(dataDir);
  else await mkdir(dataDir);
  return {
    root, dataDir, manager: new DockyardManager(dataDir), registry: new ResourceRegistry(dataDir),
    read: async name => JSON.parse(await readFile(path.join(dataDir, name), 'utf8')),
    write: (name, value) => writeFile(path.join(dataDir, name), JSON.stringify(value), 'utf8'),
  };
}
export function errorCode(code) {
  return error => { assert.equal(error.code, code); return true; };
}
