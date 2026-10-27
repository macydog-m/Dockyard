// Optional: one real model request using existing Codex auth and MCP registration.
import { searchOutputSchema, contextOutputSchema } from '../packages/shared/dist/index.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedPath = fileURLToPath(new URL('../examples/demo-data/files/002511.txt', import.meta.url));

export function isVerifiedGetEvent(event) {
  const item = event?.item;
  const result = item?.result;
  const resource = (result?.structured_content ?? result?.structuredContent)?.resource;
  return event?.type === 'item.completed' && item?.type === 'mcp_tool_call'
    && item.server === 'dockyard' && item.tool === 'get' && item.status === 'completed'
    && !item.error && !result?.isError && !result?.is_error
    && resource?.key === '002511' && resource.ref === 'demo::002511'
    && resource.type === 'file' && resource.availability === 'available'
    && resource.kind === 'file' && resource.metadata?.demo === true
    && typeof resource.source?.path === 'string'
    && path.isAbsolute(resource.source.path) && path.normalize(resource.source.path) === path.normalize(expectedPath);
}

export function isVerifiedSearchEvent(event) {
  const item = event?.item;
  const result = item?.result;
  const parsed = searchOutputSchema.safeParse(result?.structured_content ?? result?.structuredContent);
  return event?.type === 'item.completed' && item?.type === 'mcp_tool_call'
    && item.server === 'dockyard' && item.tool === 'search' && item.status === 'completed'
    && !item.error && !result?.isError && !result?.is_error && parsed.success
    && parsed.data.diagnostics.length === 0
    && parsed.data.items.some(entry => entry.ref === 'palette::warm-orange' && entry.key === 'warm-orange'
      && entry.type === 'color' && entry.value === '#E98C3A');
}

export function isVerifiedContextEvent(event) {
  const item = event?.item;
  const result = item?.result;
  const parsed = contextOutputSchema.safeParse(result?.structured_content ?? result?.structuredContent);
  if (event?.type !== 'item.completed' || item?.type !== 'mcp_tool_call'
    || item.server !== 'dockyard' || item.tool !== 'context' || item.status !== 'completed'
    || item.error || result?.isError || result?.is_error || !parsed.success) return false;
  const context = parsed.data;
  const expected = [['demo', 'file', 1], ['palette', 'palette', 2], ['fx-rules', 'instruction', 1]];
  return context.workspace.id === 'default' && context.workspace.name === 'Demo'
    && context.total === 3 && context.components.length === 3 && !context.truncated
    && context.diagnostics.length === 0 && context.diagnosticTotal === 0
    && expected.every(([id, type, count]) => context.components.some(component =>
      component.id === id && component.type === type && component.resourceCount === count));
}

export function verifyCodexMcp({ search = false, context = false } = {}) {
  search = search || context;
  const child = spawn(process.env.DOCKYARD_CODEX_PATH || 'codex', [
    'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    (context ? '先通过 Dockyard context 查看当前 Workspace 和组件摘要，报告 Workspace 名称与组件数量；接着 ' : '') + (search ? '先通过 Dockyard search 搜索常用暖橙色，报告返回 ref 和 value；然后 ' : '') + '读取我的资源 id:002511。这是 Dockyard MCP 接入验收：请通过 Dockyard 的 get 查询，报告 resource.key、source.path 和 availability。不要使用 shell、读取素材文件或修改文件。若工具不可用请直接说明，不要猜测结果。',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let found = false;
  let searchFound = false;
  let contextFound = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error('Codex verification timed out.');
    child.kill();
  }, 120000);
  child.stderr.on('data', () => {});
  child.on('error', error => {
    clearTimeout(timer);
    console.error(error.message);
    process.exitCode = 1;
  });
  createInterface({ input: child.stdout }).on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    const item = event.item;
    if (item?.type === 'mcp_tool_call' && item.server === 'dockyard') {
      console.log(JSON.stringify({
        event: event.type, server: item.server, tool: item.tool, status: item.status,
        result: item.result, error: item.error,
      }));
    }
    if (isVerifiedGetEvent(event)) found = true;
    if (isVerifiedSearchEvent(event)) searchFound = true;
    if (isVerifiedContextEvent(event)) contextFound = true;
    if (item?.type === 'agent_message' && event.type === 'item.completed') console.log(item.text);
    if (event.type === 'error' || event.type === 'turn.failed') console.log(JSON.stringify(event));
  });
  child.on('close', code => {
    clearTimeout(timer);
    const verified = code === 0 && found && (!search || searchFound) && (!context || contextFound) && !timedOut;
    console.log(JSON.stringify({ exitCode: code, dockyardToolCallVerified: verified, ...(search ? { searchVerified: searchFound, getVerified: found } : {}), ...(context ? { contextVerified: contextFound } : {}) }));
    if (!verified) {
      console.error('Verification not confirmed. Check Codex MCP settings and demo data; unrelated stderr omitted.');
      process.exitCode = 1;
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && !['--search', '--all'].includes(process.argv[2]))) {
    console.error('Usage: node scripts/verify-codex-mcp.mjs [--search|--all]');
    process.exitCode = 1;
  } else verifyCodexMcp({ search: process.argv[2] === '--search', context: process.argv[2] === '--all' });
}
