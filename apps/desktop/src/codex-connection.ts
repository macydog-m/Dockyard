import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile, lstat, readdir, open, rename, unlink } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';

type Entry = Record<string, any>;
export type DesiredConnection = { command: string; args: string[]; env: Record<string, string> };
export type ConnectionPlan = {
  status: 'missing' | 'matching' | 'conflict' | 'unavailable';
  token: string; configToken?: string; cliPath?: string; configPath: string; message: string;
  desired: DesiredConnection; manualConfig: string;
  current?: { command?: string; args?: string[]; url?: string; enabled: boolean; envKeys: string[] };
  backup?: { id: string; path: string; restorable: boolean };
};
export class ConnectionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))
  : value ?? null);
const stablePath = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

export function connectionMatches(entry: Entry | undefined, desired: DesiredConnection) {
  if (!entry || entry.enabled === false) return false;
  const transport = entry.transport ?? entry;
  if (transport.type && transport.type !== 'stdio') return false;
  if (typeof transport.command !== 'string' || !path.isAbsolute(transport.command)
    || stablePath(transport.command) !== stablePath(desired.command)) return false;
  if (canonical(transport.args ?? []) !== canonical(desired.args) || canonical(transport.env ?? {}) !== canonical(desired.env)) return false;
  if (transport.cwd || transport.env_vars?.length || entry.disabled_tools?.length) return false;
  if (entry.enabled_tools && !['get', 'search', 'context'].every(name => entry.enabled_tools.includes(name))) return false;
  return true;
}

export class CodexConnection {
  readonly home: string;
  readonly configPath: string;
  readonly desired: DesiredConnection;
  private readonly backups: string;
  private readonly env: NodeJS.ProcessEnv;
  constructor(options: { runtime: string; mcpEntry: string; dataDir: string; env?: NodeJS.ProcessEnv; codexHome?: string }) {
    this.env = options.env ?? process.env;
    this.home = path.resolve(options.codexHome ?? this.env.CODEX_HOME ?? path.join(homedir(), '.codex'));
    this.configPath = path.join(this.home, 'config.toml');
    this.backups = path.join(this.home, 'dockyard-backups');
    this.desired = { command: path.resolve(options.runtime), args: [path.resolve(options.mcpEntry), '--data-dir', path.resolve(options.dataDir)], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  private async readConfig() {
    try {
      const info = await lstat(this.configPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('unsafe config');
      const bytes = await readFile(this.configPath);
      const value = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')) as Entry;
      return { bytes, value, token: hash(bytes), exists: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: Buffer.alloc(0), value: {} as Entry, token: hash(''), exists: false };
      throw new ConnectionError('CODEX_CONFIG_INVALID', '无法安全读取 Codex 配置。请修复文件格式或权限后重试。');
    }
  }
  private async cli(): Promise<string | undefined> {
    const explicit = this.env.DOCKYARD_CODEX_PATH;
    const candidates = explicit ? [explicit] : (this.env.PATH ?? this.env.Path ?? '').split(path.delimiter).filter(Boolean).flatMap(directory => {
      const base = directory.replace(/^"|"$/g, '');
      return [path.join(base, process.platform === 'win32' ? 'codex.exe' : 'codex'),
        path.join(base, 'node_modules', '@openai', 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe')];
    });
    // Desktop distributions may not add the CLI to a newly installed app's PATH.
    if (!explicit && this.env.LOCALAPPDATA) {
      const base = path.join(this.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
      for (const name of (await readdir(base).catch(() => [])).sort().reverse()) candidates.push(path.join(base, name, 'codex.exe'));
    }
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate) || (process.platform === 'win32' && !candidate.toLowerCase().endsWith('.exe'))) continue;
      if (await lstat(candidate).then(info => info.isFile(), () => false)) return path.resolve(candidate);
    }
    return undefined;
  }
  private async run(cli: string, args: string[]) {
    await mkdir(this.home, { recursive: true });
    return promisify(execFile)(cli, args, {
      env: { ...this.env, CODEX_HOME: this.home }, cwd: this.home,
      windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    });
  }
  private async latestBackup(configToken: string) {
    const names = (await readdir(this.backups).catch(() => [])).filter(name => /^\d+-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse();
    if (!names.length) return undefined;
    try {
      const name = names[0];
      const record = JSON.parse(await readFile(path.join(this.backups, name), 'utf8'));
      return { id: name.slice(0, -5), path: path.join(this.backups, name), restorable: record.afterToken === configToken && record.home === this.home && !record.restored };
    } catch { return undefined; }
  }
  async inspect(): Promise<ConnectionPlan> {
    const desired = this.desired;
    const manualConfig = stringify({ mcp_servers: { dockyard: desired } });
    const base = { desired, manualConfig, configPath: this.configPath };
    let config;
    try { config = await this.readConfig(); }
    catch (error) { return { ...base, status: 'unavailable', token: hash('unreadable'), message: (error as Error).message }; }
    const cliPath = await this.cli();
    const backup = await this.latestBackup(config.token);
    let entry: Entry | undefined;
    let status: ConnectionPlan['status'] = 'unavailable';
    let message = '未找到可直接运行的 Codex CLI。安装 Codex 后重试，或将下方配置合并到 Codex 配置文件。';
    if (cliPath) {
      try {
        const { stdout } = await this.run(cliPath, ['mcp', 'get', 'dockyard', '--json']);
        entry = JSON.parse(stdout);
        status = connectionMatches(entry, desired) ? 'matching' : 'conflict';
        message = status === 'matching' ? '启动程序、参数与运行环境一致，无需重复配置。' : '发现同名 Dockyard 配置，请核对差异后再替换。';
      } catch (error) {
        const stderr = String((error as { stderr?: string }).stderr ?? '');
        if (/No MCP server named ['"]?dockyard['"]? found/i.test(stderr) && !config.value.mcp_servers?.dockyard) {
          status = 'missing'; message = '尚未注册 Dockyard，可以添加当前资源服务。';
        } else message = '无法确认 Codex 当前配置，请检查 CLI 和配置文件后重试。';
      }
    }
    const transport = entry?.transport ?? entry;
    const token = hash(config.token + canonical(entry) + canonical(desired) + (cliPath ?? ''));
    return { ...base, token, configToken: config.token, status, cliPath, message, backup,
      ...(transport ? { current: {
        command: typeof transport.command === 'string' ? transport.command : undefined,
        args: Array.isArray(transport.args) ? transport.args : undefined,
        url: typeof transport.url === 'string' ? transport.url : undefined,
        enabled: entry?.enabled !== false, envKeys: Object.keys(transport.env ?? {}),
      } } : {}),
    };
  }
  private async lock<T>(action: () => Promise<T>) {
    await mkdir(this.home, { recursive: true });
    const lockPath = path.join(this.home, '.dockyard-connect.lock');
    let handle;
    try { handle = await open(lockPath, 'wx'); }
    catch { throw new ConnectionError('CODEX_BUSY', '另一个 Dockyard 正在更新连接，请稍后重试。'); }
    try { return await action(); }
    finally { await handle.close(); await unlink(lockPath); }
  }
  async connect(token: string, replace: boolean) {
    return this.lock(async () => {
      const plan = await this.inspect();
      if (plan.token !== token) throw new ConnectionError('CODEX_CHANGED', 'Codex 配置已经变化，请重新检查后确认。');
      if (plan.status === 'matching') return { changed: false, plan };
      if (!plan.cliPath || plan.status === 'unavailable') throw new ConnectionError('CODEX_UNAVAILABLE', plan.message);
      if (plan.status === 'conflict' && !replace) throw new ConnectionError('CODEX_CONFLICT', '存在同名配置，请先核对并确认替换。');
      const before = await this.readConfig();
      if (before.token !== plan.configToken) throw new ConnectionError('CODEX_CHANGED', '配置在检查后发生变化，请重新确认。');
      await mkdir(this.backups, { recursive: true, mode: 0o700 });
      const backupInfo = await lstat(this.backups);
      if (backupInfo.isSymbolicLink()) throw new ConnectionError('CODEX_BACKUP_UNSAFE', '备份目录不能是链接。');
      const id = Date.now() + '-' + randomUUID();
      const filename = path.join(this.backups, id + '.json');
      const record = { home: this.home, createdAt: new Date().toISOString(), before: before.bytes.toString('base64'), existed: before.exists, afterToken: '', restored: false };
      await writeFile(filename, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      if ((await this.readConfig()).token !== before.token) throw new ConnectionError('CODEX_CHANGED', '配置在备份时发生变化，未写入连接。');
      try {
        await this.run(plan.cliPath, ['mcp', 'add', 'dockyard', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', this.desired.command, ...this.desired.args]);
      } catch {
        throw new ConnectionError('CODEX_WRITE_FAILED', 'Codex 未确认配置写入成功。原配置已备份，请重新检查；不会自动覆盖可能并发修改的配置。');
      }
      const after = await this.readConfig();
      record.afterToken = after.token;
      await writeFile(filename, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      const result = await this.inspect();
      if (result.status !== 'matching') throw new ConnectionError('CODEX_VERIFY_FAILED', '写入后配置未匹配预期。备份已保留，可恢复后重试。');
      return { changed: true, plan: result };
    });
  }
  async restore(id: string) {
    if (!/^\d+-[a-f0-9-]{36}$/.test(id)) throw new ConnectionError('CODEX_BACKUP_INVALID', '备份编号无效。');
    return this.lock(async () => {
      const filename = path.join(this.backups, id + '.json');
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 12 * 1024 * 1024) throw new ConnectionError('CODEX_BACKUP_INVALID', '备份文件无效。');
      const record = JSON.parse(await readFile(filename, 'utf8'));
      const current = await this.readConfig();
      if (record.home !== this.home || !record.afterToken || record.afterToken !== current.token || record.restored) {
        throw new ConnectionError('CODEX_CHANGED', '连接后 Codex 配置已有其他修改，已阻止自动恢复。请根据备份手动合并，保留新修改。');
      }
      const bytes = Buffer.from(record.before, 'base64');
      parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
      const temp = this.configPath + '.' + randomUUID() + '.tmp';
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      try {
        if ((await this.readConfig()).token !== current.token) throw new ConnectionError('CODEX_CHANGED', '配置刚发生变化，已停止恢复。');
        // Empty original files are restored as empty TOML, rather than deleting a configuration path.
        await rename(temp, this.configPath);
      } finally { await unlink(temp).catch(() => {}); }
      record.restored = true;
      await writeFile(filename, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      return this.inspect();
    });
  }
}
