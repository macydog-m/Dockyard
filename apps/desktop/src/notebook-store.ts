import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { configIdSchema } from '@dockyard/shared';
import { ResourceError } from '@dockyard/core';
import { notebookSchema, emptyNotebook, type Notebook } from './notebook-model';

export class NotebookStore {
  constructor(private readonly dataDir: string) {}
  private file(workspaceId: string) {
    return path.join(this.dataDir, 'notebooks', configIdSchema.parse(workspaceId) + '.json');
  }
  async read(workspaceId: string): Promise<Notebook> {
    try { return notebookSchema.parse(JSON.parse(await readFile(this.file(workspaceId), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyNotebook();
      throw new ResourceError('DATA_UNAVAILABLE', '无法读取记事本，原文件已保留。请检查数据文件或目录权限。');
    }
  }
  async save(workspaceId: string, value: Notebook): Promise<void> {
    const data = notebookSchema.parse(value);
    // Never replace an unreadable existing notebook with an empty editor state.
    await this.read(workspaceId);
    const file = this.file(workspaceId), temporary = file + '.' + randomUUID() + '.tmp';
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', flush: true });
      await rename(temporary, file);
    } catch {
      throw new ResourceError('DATA_UNAVAILABLE', '笔记尚未保存，请检查磁盘空间或目录权限后重试。');
    } finally { await unlink(temporary).catch(() => {}); }
  }
}
