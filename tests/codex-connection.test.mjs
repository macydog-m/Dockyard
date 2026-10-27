import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const result = await build({ entryPoints: ['apps/desktop/src/codex-connection.ts'], bundle: true, platform: 'node', format: 'esm', write: false, target: 'node24' });
const { CodexConnection, connectionMatches } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const cli = process.env.DOCKYARD_CODEX_PATH || (() => {
  try { return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).find(name => process.platform !== 'win32' || name.endsWith('.exe')); } catch { return undefined; }
})();
async function setup(t, content = '# 中文配置，必须原样恢复\nmodel = "gpt-6-sol"\n') {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'dockyard-connect-'));
  t.after(async () => {
    assert.match(path.relative(tmpdir(), root), /^dockyard-connect-[^/\\]+$/);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const home = path.join(root, 'Codex 配置');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'config.toml'), content, 'utf8');
  const options = { runtime: path.resolve('node_modules/electron/dist/electron.exe'), mcpEntry: path.join(root, '应用 mcp.mjs'), dataDir: path.join(root, '资源 data'), codexHome: home, env: { ...process.env, DOCKYARD_CODEX_PATH: cli ?? path.join(root, 'missing.exe') } };
  return { root, home, service: new CodexConnection(options), options, read: () => fs.readFile(path.join(home, 'config.toml'), 'utf8') };
}
test('connection comparison requires runtime, arguments, environment and all three tools', () => {
  const desired = { command: path.resolve('Dockyard.exe'), args: ['a.mjs', '--data-dir', '中文'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const entry = { enabled: true, transport: { type: 'stdio', ...desired } };
  assert.equal(connectionMatches(entry, desired), true);
  for (const changed of [
    { ...entry, enabled: false },
    { ...entry, transport: { ...entry.transport, env: {} } },
    { ...entry, transport: { ...entry.transport, command: 'Dockyard.exe' } },
    { ...entry, transport: { ...entry.transport, args: ['wrong'] } },
    { ...entry, disabled_tools: ['get'] },
    { ...entry, enabled_tools: ['get'] },
    { ...entry, transport: { ...entry.transport, env_vars: ['EXTERNAL'] } },
  ]) assert.equal(connectionMatches(changed, desired), false);
});
test('missing CLI provides copyable configuration and cannot write', async t => {
  const f = await setup(t);
  const service = new CodexConnection({ ...f.options, env: { DOCKYARD_CODEX_PATH: path.join(f.root, 'not-installed.exe') } });
  const plan = await service.inspect();
  assert.equal(plan.status, 'unavailable');
  assert.match(plan.manualConfig, /ELECTRON_RUN_AS_NODE/);
  await assert.rejects(service.connect(plan.token, false), { code: 'CODEX_UNAVAILABLE' });
  assert.match(await f.read(), /中文配置/);
});
test('real Codex CLI adds isolated registration idempotently and restores exact prior bytes', { skip: !cli }, async t => {
  const f = await setup(t, '# 中文注释\nmodel = "gpt-6-sol"\n\n[mcp_servers.unrelated]\ncommand = "keep-me"\nargs = ["SAFE"]\n');
  const original = await f.read();
  const plan = await f.service.inspect();
  assert.equal(plan.status, 'missing', plan.message);
  const added = await f.service.connect(plan.token, false);
  assert.equal(added.changed, true);
  assert.equal(added.plan.status, 'matching');
  assert.equal(added.plan.backup.restorable, true);
  assert.match(await f.read(), /keep-me/);
  const after = await f.read();
  assert.equal((await f.service.connect(added.plan.token, false)).changed, false);
  assert.equal(await f.read(), after);
  await f.service.restore(added.plan.backup.id);
  assert.equal(await f.read(), original);
});
test('real conflicting registration requires replacement and stale confirmation cannot overwrite', { skip: !cli }, async t => {
  const f = await setup(t, '# preserve all details\n[mcp_servers.dockyard]\ncommand = "old.exe"\nargs = ["old"]\nenabled = false\n[mcp_servers.dockyard.env]\nSECRET_EXAMPLE = "not-for-renderer"\n');
  const original = await f.read();
  const plan = await f.service.inspect();
  assert.equal(plan.status, 'conflict');
  assert.equal(JSON.stringify(plan).includes('not-for-renderer'), false);
  await assert.rejects(f.service.connect(plan.token, false), { code: 'CODEX_CONFLICT' });
  assert.equal(await f.read(), original);
  await fs.appendFile(path.join(f.home, 'config.toml'), '\n# concurrent edit\n', 'utf8');
  await assert.rejects(f.service.connect(plan.token, true), { code: 'CODEX_CHANGED' });
  const next = await f.service.inspect();
  const updated = await f.service.connect(next.token, true);
  assert.equal(updated.plan.status, 'matching');
  await f.service.restore(updated.plan.backup.id);
  assert.equal(await f.read(), original + '\n# concurrent edit\n');
});
test('restoration refuses to overwrite subsequent unrelated Codex changes', { skip: !cli }, async t => {
  const f = await setup(t);
  const plan = await f.service.inspect();
  const added = await f.service.connect(plan.token, false);
  await fs.appendFile(path.join(f.home, 'config.toml'), '\n# user changed settings later\n', 'utf8');
  const latest = await f.read();
  await assert.rejects(f.service.restore(added.plan.backup.id), { code: 'CODEX_CHANGED' });
  assert.equal(await f.read(), latest);
  assert.equal((await f.service.inspect()).backup.restorable, false);
  await assert.rejects(f.service.restore('../outside'), { code: 'CODEX_BACKUP_INVALID' });
});
test('malformed configuration is unavailable and remains untouched', async t => {
  const f = await setup(t, 'invalid = [');
  const plan = await f.service.inspect();
  assert.equal(plan.status, 'unavailable');
  await assert.rejects(f.service.connect(plan.token, true), { code: 'CODEX_UNAVAILABLE' });
  assert.equal(await f.read(), 'invalid = [');
});

test('first-use Codex home without a directory is inspected and registered safely', { skip: !cli }, async t => {
  const f = await setup(t);
  const service = new CodexConnection({ ...f.options, codexHome: path.join(f.root, 'new-codex-home') });
  const plan = await service.inspect();
  assert.equal(plan.status, 'missing', plan.message);
  const result = await service.connect(plan.token, false);
  assert.equal(result.plan.status, 'matching');
});
test('a configuration change after CLI inspection is rejected before backup and replacement', { skip: !cli }, async t => {
  const f = await setup(t);
  let mutate = false;
  class RacingConnection extends CodexConnection {
    async inspect() {
      const result = await super.inspect();
      if (mutate) { mutate = false; await fs.appendFile(path.join(f.home, 'config.toml'), '\n# changed during review\n', 'utf8'); }
      return result;
    }
  }
  const service = new RacingConnection(f.options);
  const plan = await service.inspect();
  mutate = true;
  await assert.rejects(service.connect(plan.token, false), { code: 'CODEX_CHANGED' });
  assert.match(await f.read(), /changed during review/);
  assert.equal((await f.service.inspect()).status, 'missing');
});