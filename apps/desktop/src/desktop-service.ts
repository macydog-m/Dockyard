import { Worker } from 'node:worker_threads';
import type { Progress, Reply } from './contracts';

const unavailable: Reply = { ok: false, code: 'WORKER_UNAVAILABLE', message: '后台服务已停止，请在“更多”中点击“重启软件”。' };

export class DesktopService {
  private worker!: Worker;
  private stopped = true;
  private nextId = 0;
  private readonly pending = new Map<number, { reply: Promise<Reply>; resolve: (reply: Reply) => void }>();

  constructor(private readonly entry: string, private readonly data: Record<string, unknown>, private readonly progress: (value: Progress) => void) {
    this.start();
  }

  get busy() { return this.pending.size > 0; }

  private start() {
    const worker = new Worker(this.entry, { workerData: this.data });
    this.worker = worker;
    this.stopped = false;
    worker.on('message', ({ id, reply, progress }) => {
      if (worker !== this.worker || this.stopped) return;
      if (progress) { this.progress(progress); return; }
      const request = this.pending.get(id);
      if (request) { this.pending.delete(id); request.resolve(reply); }
    });
    worker.on('error', () => this.failPending(worker));
    worker.on('exit', () => this.failPending(worker));
  }

  private failPending(worker: Worker) {
    if (worker !== this.worker) return;
    this.stopped = true;
    for (const request of this.pending.values()) request.resolve(unavailable);
    this.pending.clear();
  }

  private send(command: unknown): Promise<Reply> {
    if (this.stopped) return Promise.resolve(unavailable);
    const id = ++this.nextId;
    let resolve!: (reply: Reply) => void;
    const reply = new Promise<Reply>(done => { resolve = done; });
    this.pending.set(id, { reply, resolve });
    try { this.worker.postMessage({ id, command }); }
    catch { this.failPending(this.worker); }
    return reply;
  }

  call(command: unknown): Promise<Reply> { return this.send(command); }

  async drain(): Promise<void> {
    await Promise.all([...this.pending.values()].map(request => request.reply));
  }

  stop() { return this.worker.terminate(); }
}
