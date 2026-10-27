import { DOCKYARD_VERSION } from '@dockyard/shared';
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { stringify } from 'smol-toml';
import { CodexConnection, ConnectionError } from './codex-connection';
import { NotebookStore } from './notebook-store';

import { DockyardManager, FolderIndexReader, ResourceError } from '@dockyard/core';
import { contextOutputSchema } from '@dockyard/shared';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { commandSchema, type Command, type DockState, type ComponentInfo, type Diagnosis } from './contracts';

const { dataDir, runtime, mcpEntry } = workerData as { dataDir: string; runtime: string; mcpEntry: string };
const manager = new DockyardManager(dataDir);
const notebooks = new NotebookStore(dataDir);
const connection = new CodexConnection({ dataDir, runtime, mcpEntry });
const indexes = new FolderIndexReader(manager.store);
let initialized = false;
async function initialize() {
  if (!initialized) { await manager.initialize(); initialized = true; }
}
let lastProgress = 0;
function progress(value: { files: number; directories: number }) {
  if (Date.now() - lastProgress > 100) { parentPort!.postMessage({ progress: value }); lastProgress = Date.now(); }
}
async function state(): Promise<DockState> {
  const workspaces = await manager.listWorkspaces();
  const components = await manager.listComponents();
  indexes.retain(new Set(components.map(item => item.id)));
  const summaries: ComponentInfo[] = [];
  for (const component of components) {
    if (component.type === 'folder') {
      const loaded = await indexes.load(component);
      summaries.push({
        component, count: loaded.index?.snapshot?.entries.length ?? null,
        status: loaded.diagnostic?.code ?? 'ready', message: loaded.diagnostic?.message,
        builtAt: loaded.index?.snapshot?.builtAt,
        errors: loaded.index?.lastRefresh.errors, skipped: loaded.index?.lastRefresh.skipped,
      });
    } else if (component.type === 'file') {
      let status = 'available';
      try { const info = await stat(path.resolve(dataDir, component.source.path)); if (!info.isFile()) status = 'not_file'; }
      catch (error) { status = ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'inaccessible'; }
      summaries.push({ component, count: 1, status });
    } else summaries.push({ component, count: component.type === 'palette' || component.type === 'font' ? component.entries.length : 1, status: 'ready' });
  }
  return { dataDir, ...workspaces, components: summaries };
}
async function diagnose(): Promise<Diagnosis> {
  const plan = await connection.inspect();
  const registration: Diagnosis['registration'] = plan.status === 'conflict' ? 'other' : plan.status;
  const transport = new StdioClientTransport({
    command: runtime, args: [mcpEntry, '--data-dir', dataDir],
    env: { ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe',
  });
  // Drain diagnostics without exposing arbitrary subprocess output.
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'dockyard-desktop-check', version: DOCKYARD_VERSION });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('自检超时')), 15000);
      timer.unref();
    });
    await Promise.race([(async () => {
      await client.connect(transport);
      const { tools } = await client.listTools();
      if (tools.map(tool => tool.name).sort().join(',') !== 'context,get,search') throw new Error('工具列表不完整');
      const result = await client.callTool({ name: 'context', arguments: {} });
      if (result.isError || !contextOutputSchema.safeParse(result.structuredContent).success) throw new Error('当前配置无法通过查询验证');
    })(), timeout]);
    return { checkedAt: new Date().toISOString(), registration, selfTest: 'passed', message: '独立查询进程已完成本地自检。请在所选 Agent 中确认实际工具调用。' };
  } catch {
    return { checkedAt: new Date().toISOString(), registration, selfTest: 'failed', message: '本地自检未通过，请检查资源配置和查询入口后重试。' };
  } finally { clearTimeout(timer); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}
async function execute(command: Command) {
  await initialize();
  switch (command.type) {
    case 'state': return state();
    case 'bindingConfig': {
      const { workspaces } = await manager.listWorkspaces();
      if (!workspaces.some(workspace => workspace.id === command.id)) throw new ResourceError('NOT_FOUND', 'Workspace not found.');
      return stringify({ mcp_servers: { dockyard: { ...connection.desired, args: [...connection.desired.args, '--workspace-id', command.id] } } });
    }
    case 'configuration': return manager.updateConfiguration(command.id, command.componentId, command.expectedRevision, command.definitionRevision, command.action);
    case 'importConfiguration': return manager.importConfiguration(command.id, command.expectedRevision, command.component);
    case 'notebook':
    case 'saveNotebook': {
      const { workspaces } = await manager.listWorkspaces();
      if (!workspaces.some(workspace => workspace.id === command.id)) throw new ResourceError('CONFIG_INVALID', '工作区不存在。');
      return command.type === 'notebook' ? notebooks.read(command.id) : notebooks.save(command.id, command.notebook);
    }
    case 'save': return manager.saveComponent(command.component, progress);
    case 'remove': return manager.removeComponent(command.id);
    case 'refresh': return (await manager.refresh(command.id, progress)).lastRefresh;
    case 'createWorkspace': return manager.createWorkspace({ schemaVersion: 1, id: 'workspace-' + randomUUID().slice(0, 8), name: command.name });
    case 'renameWorkspace': return manager.renameWorkspace(command.id, command.name);
    case 'switchWorkspace': return manager.setActiveWorkspace(command.id);
    case 'select': return manager.setWorkspaceComponents(command.id, command.componentIds);
    case 'enable': return manager.setWorkspaceComponentEnabled(command.id, command.componentId, command.enabled);
    case 'design': return manager.setWorkspaceDesign(command.id, command.design);
    case 'diagnose': return diagnose();
    case 'connectionPlan': return connection.inspect();
    case 'connectCodex': {
      const result = await connection.connect(command.token, command.replace);
      return { ...result, diagnosis: await diagnose() };
    }
    case 'restoreConnection': return connection.restore(command.id);
  }
}
let queue = Promise.resolve();
parentPort!.on('message', ({ id, command }) => {
  queue = queue.then(async () => {
    try {
      const parsed = commandSchema.safeParse(command);
      if (!parsed.success) throw new ResourceError('CONFIG_INVALID', '请检查名称、路径、颜色格式和必填字段。');
      const value = await execute(parsed.data);
      parentPort!.postMessage({ id, reply: { ok: true, value } });
    } catch (error) {
      parentPort!.postMessage({ id, reply: {
        ok: false, code: (error instanceof ResourceError || error instanceof ConnectionError) ? error.code : 'INTERNAL_ERROR',
        message: (error instanceof ResourceError || error instanceof ConnectionError) ? error.message : '操作失败，请重试。',
      } });
    }
  });
});
