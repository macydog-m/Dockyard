import type { DesiredConnection } from './codex-connection';
import type { MessageKey } from './i18n';

export const agentClients = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'claude-desktop', name: 'Claude Desktop' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'cursor', name: 'Cursor' },
] as const;
export type AgentClientId = typeof agentClients[number]['id'];
export type ManualAgentId = Exclude<AgentClientId, 'codex'>;

export const agentInstructions: Record<ManualAgentId, MessageKey> = {
  'claude-code': '将配置合并到项目根目录的 .mcp.json，在 Claude Code 中批准服务后，用 /mcp 检查。',
  'claude-desktop': '打开 Claude Desktop 的 Settings → Developer → Edit Config，合并配置后完全退出并重新打开。',
  antigravity: '在 Antigravity 中打开 MCP Servers → Manage MCP Servers → View raw config，合并配置后刷新服务。',
  cursor: '将配置合并到 ~/.cursor/mcp.json（全局）或项目的 .cursor/mcp.json，然后在 Cursor 的 MCP 设置中启用 dockyard。',
};

// Preserve argument boundaries, absolute paths and the bundled Electron runtime's
// Node mode for each host. JSON serialization also handles Unicode and backslashes.
export function createAgentConfig(agent: ManualAgentId, desired: DesiredConnection): string {
  return JSON.stringify({ mcpServers: { dockyard: {
    ...(agent === 'claude-code' ? { type: 'stdio' } : {}),
    command: desired.command, args: desired.args, env: desired.env,
  } } }, null, 2);
}
