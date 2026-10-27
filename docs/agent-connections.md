# Agent connections

Dockyard serves `get`, `search` and `context` over local Stdio MCP. Open **Settings → Connect agent**, select a client, and use its setup instructions. Generated configurations use absolute paths to the current runtime, MCP entry and resource data, including `ELECTRON_RUN_AS_NODE=1` so the bundled Electron executable runs as Node.js. Installed builds need no separate Node.js installation. Generate the configuration again if you move the application or change the data directory.

| Client | Setup | Check in the client |
| --- | --- | --- |
| Codex | Review and apply the existing automatic setup, or merge the TOML shown in the dialog | Restart MCP or start a new session |
| Claude Code | Merge the JSON into `.mcp.json` at the project root and approve the service when prompted | Run `/mcp` and check `dockyard` |
| Claude Desktop | Settings → Developer → Edit Config; merge into `claude_desktop_config.json` | Fully quit and reopen Claude, then inspect the server's tools |
| Antigravity | MCP Servers → Manage MCP Servers → View raw config; merge into the configuration opened by the app | Refresh the servers and check `dockyard` |
| Cursor | Merge into `~/.cursor/mcp.json` globally or `.cursor/mcp.json` in the project | Enable `dockyard` in MCP settings and inspect its tools |

For JSON clients, merge the `dockyard` entry into the existing `mcpServers` object, preserving other services. Replace an existing `dockyard` entry rather than creating duplicates. The **Copy configuration** button copies the full JSON block for this purpose. Claude Code uses project scope here; its CLI can also register user-scoped servers. Antigravity's raw-config action locates the correct configuration for the installed version.

After setup, confirm all three tools appear, then ask the agent to look up a resource you enabled in the current workspace. `#Dock` shorthand additionally needs the [Dock skill](../.agents/skills/dock/SKILL.md), or equivalent instructions in that client; MCP setup alone does not install the skill. Unbound local clients follow Dockyard's active workspace. A server started with `--workspace-id <id>` stays in that workspace. See [workspace bindings and configurations](workspace-configuration.md) for project configuration and the limits of session detection.

## Verification boundary

The generated JSON configurations are tested by launching the real Electron runtime through the MCP SDK, listing all three tools, querying context, searching a color, and retrieving a file reference from isolated demo data. The desktop self-test also uses an independent MCP process. These checks verify the launch configuration and protocol; they do not establish that a particular agent's current session has loaded or called the tools. Claude, Antigravity and Cursor still require acceptance testing in their actual clients. The automatic configuration writer and backup/restore flow remain specific to Codex.

## Official references

- [Claude Code local MCP servers and configuration scopes](https://code.claude.com/docs/en/mcp)
- [Claude Desktop local server setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Antigravity MCP configuration](https://antigravity.google/docs/mcp)
- [Cursor MCP configuration](https://cursor.com/docs/mcp)
