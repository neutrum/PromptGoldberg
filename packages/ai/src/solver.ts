import { availableParallelism } from 'node:os';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import {
  checkShot, evaluateGoal, makeRng, optimize, searchPieces, simulate,
  type GoalResult, type Level, type OptimizeResult, type Piece, type PieceSearchResult, type SystemSpec,
} from '@og/shared';

export type SolveTask =
  | { kind: 'optimize'; spec: SystemSpec; budget: number; timeLimitMs: number; seed: number }
  | { kind: 'check'; level: Level; values: number[]; pieces: Piece[] }
  | { kind: 'checkMany'; level: Level; shots: number[][] }
  | { kind: 'searchPieces'; level: Level; values: number[]; count: number; seed: number }
  | { kind: 'evaluate'; spec: SystemSpec };

export type WorkerMessage =
  | { type: 'progress'; evals: number; bestScore: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string };

export type SolverMode = 'worker' | 'inline' | 'auto';

export interface OptimizeJob {
  budget: number;
  timeLimitMs: number;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (p: { evals: number; bestScore: number }) => void;
}

export class SolverError extends Error {}

export interface Solver {
  readonly mode: 'worker' | 'inline';
  optimize(spec: SystemSpec, job: OptimizeJob): Promise<OptimizeResult>;
  /** Simulate one shot of a level; `timeoutMs` is enforced only in worker mode. */
  check(level: Level, values: number[], pieces: Piece[], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<GoalResult>;
  evaluate(spec: SystemSpec, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<GoalResult>;
  /** Many shots of one level in a single task (one worker instead of one per shot). */
  checkMany(level: Level, shots: number[][], opts?: { signal?: AbortSignal }): Promise<GoalResult[]>;
  /** Search placements of `count` parts from the level's bin that clear its goal. */
  searchPieces(level: Level, values: number[], count: number, opts?: { seed?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<PieceSearchResult>;
}

const WORKER_URL = new URL('./solveWorker.ts', import.meta.url);

class WorkerStartError extends Error {}

interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: OptimizeJob['onProgress'];
}

/**
 * A few long-lived worker threads, reused across tasks. Starting and killing a worker per task
 * churned through thousands of threads on a busy run and crashed Node natively, so a worker is
 * only retired when its task times out or is aborted: a synchronous simulation cannot be stopped
 * any other way, and a worker that may still be computing must never be handed the next task.
 * Idle workers are unref'd, so they never keep a process alive.
 */
class WorkerPool {
  private idle: Worker[] = [];
  private proven = new WeakSet<Worker>();
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(private max: number) {}

  private spawn(): Worker {
    const worker = new Worker(WORKER_URL);
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

  async run<T>(task: SolveTask, opts: RunOptions): Promise<T> {
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

/**
 * The optimizer is synchronous; inline mode runs it in small chunks, each restarting
 * from the best point so far, yielding to the event loop in between.
 */
async function optimizeInline(spec: SystemSpec, job: OptimizeJob, chunk = 60): Promise<OptimizeResult> {
  const deadline = Date.now() + job.timeLimitMs;
  let evals = 0;
  let best: OptimizeResult | null = null;
  let current = spec;
  for (let k = 0; ; k++) {
    if (job.signal?.aborted) throw new SolverError('aborted');
    const res = optimize(current, {
      budget: Math.max(1, Math.min(chunk, job.budget - evals)),
      timeLimitMs: Math.max(1, deadline - Date.now()),
      seed: (job.seed ?? 1) + k,
    });
    evals += res.evals;
    if (!best || res.result.score > best.result.score) best = res;
    job.onProgress?.({ evals, bestScore: best.result.score });
    if (best.solved || evals >= job.budget || Date.now() >= deadline) break;
    current = best.spec;
    await yieldToLoop();
  }
  return { ...best!, evals };
}

export function createSolver(mode: SolverMode = 'auto', maxConcurrent = Math.max(1, availableParallelism() - 1)): Solver {
  const pool = new WorkerPool(maxConcurrent);
  let useWorker = mode !== 'inline';

  async function attempt<T>(task: SolveTask, inline: () => T | Promise<T>, opts: RunOptions): Promise<T> {
    if (useWorker) {
      try {
        return await pool.run<T>(task, opts);
      } catch (err) {
        if (!(err instanceof WorkerStartError) || mode === 'worker') throw err;
        // The workers cannot load here: fall back to running in this thread for good.
        useWorker = false;
      }
    }
    return inline();
  }

  return {
    get mode() {
      return useWorker ? 'worker' : 'inline';
    },
    optimize(spec, job) {
      const task: SolveTask = { kind: 'optimize', spec, budget: job.budget, timeLimitMs: job.timeLimitMs, seed: job.seed ?? 1 };
      return attempt(task, () => optimizeInline(spec, job), {
        timeoutMs: job.timeLimitMs + 15_000, signal: job.signal, onProgress: job.onProgress,
      });
    },
    check(level, values, pieces, opts = {}) {
      return attempt({ kind: 'check', level, values, pieces }, () => checkShot(level, values, pieces).goal, {
        timeoutMs: opts.timeoutMs ?? 10_000, signal: opts.signal,
      });
    },
    searchPieces(level, values, count, opts = {}) {
      const seed = opts.seed ?? 1;
      const task: SolveTask = { kind: 'searchPieces', level, values, count, seed };
      return attempt(task, () => searchPieces(level, values, { count, rng: makeRng(seed) }), {
        timeoutMs: opts.timeoutMs ?? 30_000, signal: opts.signal,
      });
    },
    checkMany(level, shots, opts = {}) {
      return attempt({ kind: 'checkMany', level, shots }, () => shots.map((v) => checkShot(level, v).goal), {
        timeoutMs: 10_000 + 2_000 * shots.length, signal: opts.signal,
      });
    },
    evaluate(spec, opts = {}) {
      return attempt({ kind: 'evaluate', spec }, () => evaluateGoal(spec.goal, simulate(spec, { record: false }).trace), {
        timeoutMs: opts.timeoutMs ?? 10_000, signal: opts.signal,
      });
    },
  };
}
