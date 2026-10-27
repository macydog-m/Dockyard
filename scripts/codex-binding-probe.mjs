// Optional, offline host probe. Uses a synthetic local Responses endpoint and isolated
// CODEX_HOME/projects; never loads credentials, user settings, or private resources.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify } from 'smol-toml';
import assert from 'node:assert/strict';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-host-probe-'));
const home = path.join(root, 'home'), project = path.join(root, 'project');
const cli = process.env.DOCKYARD_CODEX_PATH || 'codex';
const env = { ...process.env, CODEX_HOME: home };
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CODEX_THREAD_ID|CODEX_SESSION_ID/.test(key)) delete env[key];
const report = { version: '', projectOverride: false, commandOverride: false, modelRequests: 0, toolNames: [], events: [], sessionStart: false, preToolUse: false, mcpCalls: [] };
let child;
const server = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { response.writeHead(400).end(); return; }
  report.modelRequests++;
  const names = (body.tools ?? []).map(tool => tool.name ?? tool.function?.name).filter(Boolean);
  report.toolNames = names;
  const group = (body.tools ?? []).find(tool => tool.name === 'mcp__dockyard');
  const name = names.find(name => /dockyard.*context/.test(name)) ?? (group ? 'context' : undefined);
  const id = 'response-' + report.modelRequests;
  const item = report.modelRequests === 1 && name ? { type: 'function_call', id: 'fc-1', call_id: 'call-1', name, ...(group ? { namespace: 'mcp__dockyard' } : {}), arguments: '{}' }
    : { type: 'message', id: 'msg-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Offline host probe complete.', annotations: [] }] };
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const send = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  send('response.created', { response: { id, status: 'in_progress', output: [] } });
  send('response.output_item.added', { output_index: 0, item });
  send('response.output_item.done', { output_index: 0, item });
  send('response.completed', { response: { id, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  response.end();
});
try {
  await fs.mkdir(home); await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.mkdir(path.join(project, '.git'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const probe = path.join(root, 'mcp.cjs');
  const hook = path.join(root, 'hook.cjs');
  const hooksLog = path.join(root, 'hooks.jsonl'), callsLog = path.join(root, 'calls.jsonl');
  await fs.writeFile(probe, `const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const r=JSON.parse(line); if(r.id===undefined)return; let result={};
    if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'dockyard-probe',version:'1'}};
    if(r.method==='tools/list')result={tools:[{name:'context',description:'Read synthetic test workspace',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},inputSchema:{type:'object',properties:{session_id:{type:'string'}},additionalProperties:false}}]};
    if(r.method==='tools/call'){fs.appendFileSync(${JSON.stringify(callsLog)},JSON.stringify({params:r.params,workspace:process.argv[2]})+'\\n','utf8');result={content:[{type:'text',text:JSON.stringify({workspace:process.argv[2]})}]};}
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
  });`, 'utf8');
  await fs.writeFile(hook, `const fs=require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
    const e=JSON.parse(input);fs.appendFileSync(${JSON.stringify(hooksLog)},JSON.stringify({event:e.hook_event_name,session_id:e.session_id,source:e.source,tool_name:e.tool_name})+'\\n','utf8');
    if(e.hook_event_name==='PreToolUse'&&/dockyard.*context/.test(e.tool_name))process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{...e.tool_input,session_id:e.session_id}}}));
  });`, 'utf8');
  const base = { model: 'offline-probe', model_provider: 'offline', approval_policy: 'never', sandbox_mode: 'read-only',
    features: { hooks: true, plugins: false, apps: false },
    model_providers: { offline: { name: 'Offline test', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false } },
    projects: { [project]: { trust_level: 'trusted' } },
    mcp_servers: { dockyard: { command: process.execPath, args: [probe, 'global'], tools: { context: { approval_mode: 'approve' } } } } };
  await fs.writeFile(path.join(home, 'config.toml'), stringify(base), 'utf8');
  await fs.writeFile(path.join(project, '.codex/config.toml'), stringify({ mcp_servers: { dockyard: { args: [probe, 'project-a'] } } }), 'utf8');
  const hooks = { hooks: Object.fromEntries(['SessionStart', 'PreToolUse'].map(event => [event, [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${hook}"`, timeout: 10 }] }]])) };
  await fs.writeFile(path.join(home, 'hooks.json'), JSON.stringify(hooks), 'utf8');
  const run = args => promisify(execFile)(cli, args, { cwd: project, env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  report.version = (await run(['--version'])).stdout.trim();
  const effective = JSON.parse((await run(['mcp', 'get', 'dockyard', '--json'])).stdout);
  report.projectOverride = effective.transport.args.at(-1) === 'project-a' && effective.transport.command === process.execPath;
  const overridden = JSON.parse((await run(['-c', `mcp_servers.dockyard.args=${JSON.stringify([probe, 'task-b'])}`, 'mcp', 'get', 'dockyard', '--json'])).stdout);
  report.commandOverride = overridden.transport.args.at(-1) === 'task-b';
  assert.ok(report.projectOverride && report.commandOverride);
  let stdout = '', stderr = '';
  child = spawn(cli, ['--no-daemon', 'exec', '--dangerously-bypass-hook-trust', '--json', '--skip-git-repo-check', '--ephemeral', 'Call the dockyard context tool once.'], { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 45000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  clearTimeout(timer);
  report.exitCode = code;
  report.events = stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line).type]; } catch { return []; } });
  const readLines = async file => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const observedHooks = await readLines(hooksLog);
  report.sessionStart = observedHooks.some(event => event.event === 'SessionStart' && typeof event.session_id === 'string');
  report.preToolUse = observedHooks.some(event => event.event === 'PreToolUse' && typeof event.session_id === 'string');
  report.mcpCalls = (await readLines(callsLog)).map(call => ({ workspace: call.workspace, argumentKeys: Object.keys(call.params.arguments ?? {}), metaTypes: Object.fromEntries(Object.entries(call.params._meta ?? {}).map(([key, value]) => [key, value === null ? 'null' : typeof value])), injectedSessionMatches: observedHooks.some(event => event.event === 'PreToolUse' && event.session_id === call.params.arguments?.session_id) }));
  if (!report.mcpCalls.length) report.diagnostic = stderr.slice(-2500).replaceAll(root, '<test-root>');
  console.log(JSON.stringify(report, null, 2));
  assert.equal(code, 0);
  assert.equal(report.mcpCalls.length, 1, 'Actual host MCP invocation was not verified.');
  assert.equal(report.mcpCalls[0].workspace, 'project-a');
} finally {
  child?.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.match(path.relative(path.resolve(os.tmpdir()), path.resolve(root)), /^dockyard-host-probe-[^/\\]+$/);
  await fs.rm(root, { recursive: true, force: true });
}
