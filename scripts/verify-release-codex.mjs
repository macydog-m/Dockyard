import { readJson } from './version.mjs';
const packageVersion = (await readJson('package.json')).version;
// Optional real-model verification; uses per-process overrides, never edits user registration.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isVerifiedContextEvent, isVerifiedGetEvent, isVerifiedSearchEvent } from './verify-codex-mcp.mjs';
const runtime = path.resolve(process.env.DOCKYARD_DESKTOP_EXE || `.local/releases/${packageVersion}/win-unpacked/Dockyard.exe`);
const entry = path.join(path.dirname(runtime), 'resources', 'app', 'mcp.mjs');
await fs.access(runtime);
await fs.access(entry);
const artifacts = path.resolve('output/playwright');
await fs.mkdir(artifacts, { recursive: true });
const overrides = [
  'mcp_servers.dockyard.command=' + JSON.stringify(runtime),
  'mcp_servers.dockyard.args=' + JSON.stringify([entry, '--data-dir', path.resolve('examples/demo-data')]),
  'mcp_servers.dockyard.env.ELECTRON_RUN_AS_NODE="1"',
  'mcp_servers.dockyard.enabled=true',
];
const child = spawn(process.env.DOCKYARD_CODEX_PATH || 'codex', [
  'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
  ...overrides.flatMap(value => ['-c', value]),
  '请先看看我当前的资源工作区和组件数量，然后找出常用暖橙色的色值，最后给我资源 id:002511 的原始路径和可用状态。通过 Dockyard 完成；不要运行 shell、读取素材正文或修改文件。',
], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let context = false, search = false, get = false, timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
child.stderr.on('data', () => {});
createInterface({ input: child.stdout }).on('line', line => {
  let event; try { event = JSON.parse(line); } catch { return; }
  context ||= isVerifiedContextEvent(event);
  search ||= isVerifiedSearchEvent(event);
  get ||= isVerifiedGetEvent(event);
  if (event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' && event.item.server === 'dockyard') console.log(JSON.stringify({ tool: event.item.tool, status: event.item.status, error: event.item.error }));
  if (event.type === 'turn.failed' || event.type === 'error') console.log(JSON.stringify(event));
});
const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); }).finally(() => clearTimeout(timer));
const report = { passed: code === 0 && context && search && get && !timedOut, exitCode: code, runtime, naturalLanguageRequest: true, contextVerified: context, searchVerified: search, getVerified: get, userConfigModified: false, timedOut };
console.log(JSON.stringify(report, null, 2));
await fs.writeFile(path.join(artifacts, 'release-codex-report.json'), JSON.stringify(report, null, 2), 'utf8');
if (!report.passed) process.exitCode = 1;
