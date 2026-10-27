import type { App } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Reply } from './contracts';

const execute = promisify(execFile);

// Use Electron's bundled Node runtime, so direct development launches work too.
export async function rebuildDesktop(appPath: string, runtime = process.execPath) {
  const root = path.resolve(appPath, '..', '..');
  const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  async function run(args: string[], cwd: string) {
    await execute(runtime, args, { cwd, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  }
  for (const workspace of ['packages/shared', 'packages/core', 'packages/mcp']) {
    await run([compiler, '-p', 'tsconfig.json'], path.join(root, workspace));
  }
  await run([compiler, '--noEmit'], appPath);
  await run([path.join(appPath, 'build.mjs')], appPath);
}

export class AppRestarter {
  private task?: Promise<Reply>;
  private preparing = false;

  constructor(
    private readonly app: Pick<App, 'isPackaged' | 'getAppPath' | 'relaunch' | 'quit'>,
    private readonly dataDir: string,
    private readonly drain: () => Promise<void>,
    private readonly build = () => rebuildDesktop(app.getAppPath()),
  ) {}

  get active() { return !!this.task; }
  get busy() { return this.preparing; }

  restart(): Promise<Reply> {
    if (!this.task) {
      this.preparing = true;
      this.task = this.prepare().then(reply => {
        this.preparing = false;
        if (!reply.ok) this.task = undefined;
        return reply;
      });
    }
    return this.task;
  }

  private async prepare(): Promise<Reply> {
    try {
      await this.drain();
      if (!this.app.isPackaged) await this.build();
      this.app.relaunch({ args: [
        ...(this.app.isPackaged ? [] : [this.app.getAppPath()]),
        '--data-dir', this.dataDir,
      ] });
      // Let the IPC success reply reach the renderer before the old process exits.
      setImmediate(() => this.app.quit());
      return { ok: true, value: null };
    } catch (error) {
      console.error('Dockyard restart failed:', error);
      return { ok: false, code: 'APP_RESTART_FAILED', message: this.app.isPackaged
        ? '软件重启失败，请重试。'
        : '开发版构建或重启失败，当前窗口已保留。请查看启动终端的错误，修复后重试。' };
    }
  }
}
