/**
 * Long-lived worker threads for physics jobs, shared by every request (see WorkerPool).
 */
import { Worker } from 'node:worker_threads';

export type WorkerMessage =
  | { type: 'progress'; evals: number; bestScore: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string };

export type SolverMode = 'worker' | 'inline' | 'auto';

/** A physics job was aborted or failed. */
export class SolverError extends Error {}

export class WorkerStartError extends Error {}

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (p: { evals: number; bestScore: number }) => void;
}

/**
 * A few long-lived worker threads, reused across tasks. Starting and killing a worker per task
 * churned through thousands of threads on a busy run and crashed Node natively, so a worker is
 * only retired when its task times out or is aborted: a synchronous simulation cannot be stopped
 * any other way, and a worker that may still be computing must never be handed the next task.
 * Idle workers are unref'd, so they never keep a process alive.
 */
export class WorkerPool {
  private idle: Worker[] = [];
  private proven = new WeakSet<Worker>();
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(private max: number, private url: URL) {}

  private spawn(): Worker {
    const worker = new Worker(this.url);
    worker.unref();
    worker.on('exit', () => {
      const i = this.idle.indexOf(worker);
      if (i >= 0) this.idle.splice(i, 1);
    });
    return worker;
  }

  private async slot(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
  }

  private freeSlot(): void {
    this.running--;
    this.waiting.shift()?.();
  }

  async run<T>(task: unknown, opts: RunOptions): Promise<T> {
    if (opts.signal?.aborted) throw new SolverError('aborted');
    await this.slot();
    const worker = this.idle.pop() ?? this.spawn();
    worker.ref();
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        // The signal may have fired while this task waited for a free worker.
        if (opts.signal?.aborted) {
          worker.unref();
          this.idle.push(worker);
          reject(new SolverError('aborted'));
          return;
        }
        const finish = (fn: () => void, reusable: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
          opts.signal?.removeEventListener('abort', onAbort);
          if (reusable) {
            worker.unref();
            this.idle.push(worker);
          } else {
            void worker.terminate();
          }
          fn();
        };
        const onMessage = (m: WorkerMessage) => {
          if (m.type === 'progress') opts.onProgress?.(m);
          else if (m.type === 'done') {
            this.proven.add(worker);
            finish(() => resolve(m.result as T), true);
          } else finish(() => reject(new SolverError(m.message)), false);
        };
        // A worker that never completed a task probably cannot load (e.g. no TypeScript loader).
        const onError = (err: Error) => finish(() => reject(this.proven.has(worker) ? new SolverError(err.message) : new WorkerStartError(err.message)), false);
        const onExit = (code: number) => finish(() => reject(new SolverError(`solver worker exited with code ${code}`)), false);
        const onAbort = () => finish(() => reject(new SolverError('aborted')), false);
        // Too slow is only too slow: a busy machine can take long over a new worker's first task, and
        // that is no reason to give up on workers (only an 'error' from one that never loaded is).
        const timer = setTimeout(() => finish(() => reject(new SolverError('simulation took too long')), false), opts.timeoutMs);
        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);
        opts.signal?.addEventListener('abort', onAbort);
        worker.postMessage(task);
      });
    } finally {
      this.freeSlot();
    }
  }
}
