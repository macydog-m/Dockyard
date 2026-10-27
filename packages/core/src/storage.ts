import { mkdir, open, realpath, lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { configIdSchema } from '@dockyard/shared';
import { ResourceError } from './errors.js';

export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_INDEX_BYTES = 64 * 1024 * 1024;
type Schema<T> = { parse(value: unknown): T };
export type JsonRecord<T> = { value: T; token: string };
const writers = new Map<string, Promise<unknown>>();

export function resolveDataDir(explicit?: string): string {
  if (explicit !== undefined) {
    if (!explicit.trim()) throw new ResourceError('CONFIG_INVALID', 'Data directory must not be empty.');
    return path.resolve(explicit);
  }
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'Dockyard');
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Dockyard');
  return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'dockyard');
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export function recordName(kind: 'components' | 'workspaces' | 'index', id: string): string {
  if (!configIdSchema.safeParse(id).success) throw new ResourceError('CONFIG_INVALID', 'Invalid configuration ID.');
  return kind + '/' + id + '.json';
}

export class JsonStore {
  readonly dataDir: string;
  constructor(dataDir?: string) { this.dataDir = resolveDataDir(dataDir); }

  private validateName(name: string): void {
    if (name === 'config.json') return;
    const match = /^(components|workspaces|index)\/(.+)\.json$/.exec(name);
    if (!match || !configIdSchema.safeParse(match[2]).success) {
      throw new ResourceError('CONFIG_INVALID', 'Invalid configuration filename.');
    }
  }

  private async root(): Promise<string> {
    try {
      const root = await realpath(this.dataDir);
      if (!(await lstat(root)).isDirectory()) throw new Error('Not a directory.');
      return root;
    }
    catch { throw new ResourceError('DATA_UNAVAILABLE', 'Dockyard data directory is unavailable. Initialize it first.'); }
  }

  async exists(name: 'config.json' | 'assets'): Promise<boolean> {
    try { await lstat(path.join(await this.root(), name)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DATA_UNAVAILABLE', 'Cannot inspect the data directory.');
    }
  }

  async isWriting(): Promise<boolean> {
    try { await lstat(path.join(await this.root(), '.write-lock')); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DATA_UNAVAILABLE', 'Cannot inspect the data directory.');
    }
  }

  async identity(name: string): Promise<string | null> {
    this.validateName(name);
    try {
      const root = await this.root();
      const file = await realpath(path.join(root, name));
      if (!isInside(root, file)) throw new ResourceError('CONFIG_INVALID', 'Record escapes the data directory.');
      const info = await lstat(file, { bigint: true });
      if (!info.isFile()) throw new ResourceError('CONFIG_INVALID', 'Record must be a regular file.');
      return [file, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DATA_UNAVAILABLE', 'Cannot inspect record identity.');
    }
  }

  async read<T>(name: string, schema: Schema<T>): Promise<JsonRecord<T>> {
    this.validateName(name);
    try {
      const root = await this.root();
      const requested = path.join(root, name);
      const file = await realpath(requested);
      if (!isInside(root, file)) throw new ResourceError('CONFIG_INVALID', 'Configuration escapes the data directory.');
      const handle = await open(file, 'r');
      let bytes: Buffer;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > (name.startsWith('index/') ? MAX_INDEX_BYTES : MAX_JSON_BYTES)) {
          throw new ResourceError('CONFIG_INVALID', 'JSON record exceeds its size limit or is not a regular file.');
        }
        const buffer = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const chunk = await handle.read(buffer, length, buffer.length - length, length);
          if (!chunk.bytesRead) break;
          length += chunk.bytesRead;
        }
        if (length !== info.size) throw new ResourceError('DATA_BUSY', 'Configuration changed while reading; retry.');
        bytes = buffer.subarray(0, length);
      } finally { await handle.close(); }
      try {
        const value = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        return { value, token: createHash('sha256').update(bytes).digest('hex') };
      } catch {
        throw new ResourceError('CONFIG_INVALID', 'Invalid UTF-8, JSON or schema in ' + name + '.');
      }
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ResourceError('CONFIG_INVALID', 'Missing configuration record: ' + name + '.');
      }
      throw new ResourceError('DATA_UNAVAILABLE', 'Cannot read configuration: ' + name + '.');
    }
  }

  async write<T>(name: string, schema: Schema<T>, input: unknown): Promise<T> {
    this.validateName(name);
    let value: T;
    let text: string;
    try {
      value = schema.parse(input);
      text = JSON.stringify(value, null, 2) + '\n';
    } catch { throw new ResourceError('CONFIG_INVALID', 'Configuration does not match its schema or cannot be serialized.'); }
    if (Buffer.byteLength(text, 'utf8') > (name.startsWith('index/') ? MAX_INDEX_BYTES : MAX_JSON_BYTES)) throw new ResourceError('CONFIG_INVALID', 'JSON record exceeds its size limit.');
    const root = await this.root();
    const requested = path.join(root, name);
    let temporary: string | undefined;
    try {
      await mkdir(path.dirname(requested), { recursive: true });
      const parent = await realpath(path.dirname(requested));
      if (!isInside(root, parent)) throw new ResourceError('CONFIG_INVALID', 'Configuration directory escapes the data directory.');
      const target = path.join(parent, path.basename(requested));
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new ResourceError('CONFIG_INVALID', 'Configuration target must be a regular file.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      temporary = path.join(parent, '.' + path.basename(target) + '.' + randomUUID() + '.tmp');
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, target);
      temporary = undefined;
      return value;
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DATA_UNAVAILABLE', 'Cannot save configuration; the previous file has been retained.');
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }

  // One queue per data directory plus an exclusive on-disk lock for other writers.
  async withWrite<T>(operation: () => Promise<T>, indexId?: string): Promise<T> {
    if (indexId !== undefined && !configIdSchema.safeParse(indexId).success) {
      throw new ResourceError('CONFIG_INVALID', 'Invalid index lock ID.');
    }
    try { await mkdir(this.dataDir, { recursive: true }); }
    catch { throw new ResourceError('DATA_UNAVAILABLE', 'Cannot create the data directory.'); }
    const root = await this.root();
    const queueKey = root + '/' + (indexId === undefined ? 'config' : 'index/' + indexId);
    const previous = writers.get(queueKey) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const lock = path.join(root, indexId === undefined ? '.write-lock' : '.refresh-' + indexId + '.lock');
      let handle;
      try { handle = await open(lock, 'wx', 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ResourceError('DATA_BUSY', 'Another writer holds the write/refresh lock; retry. After a crash, remove the stale lock only when no writer is running.');
        }
        throw new ResourceError('DATA_UNAVAILABLE', 'Cannot lock the data directory.');
      }
      try { return await operation(); }
      finally { await handle.close(); await unlink(lock); }
    });
    writers.set(queueKey, pending);
    try { return await pending; }
    finally { if (writers.get(queueKey) === pending) writers.delete(queueKey); }
  }
}
