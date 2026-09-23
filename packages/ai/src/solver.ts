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

/** Small FIFO semaphore so parallel requests cannot pin every core. */
class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.queue.push(r));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.free++;
    }
  }
}

class WorkerStartError extends Error {}

function runInWorker<T>(task: SolveTask, opts: { timeoutMs: number; signal?: AbortSignal; onProgress?: OptimizeJob['onProgress'] }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new SolverError('aborted'));
    const worker = new Worker(WORKER_URL);
    let started = false;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(new SolverError('aborted')));
    const timer = setTimeout(() => finish(() => reject(new SolverError('simulation took too long'))), opts.timeoutMs);
    opts.signal?.addEventListener('abort', onAbort);
    worker.on('message', (m: WorkerMessage) => {
      started = true;
      if (m.type === 'progress') opts.onProgress?.(m);
      else if (m.type === 'done') finish(() => resolve(m.result as T));
      else finish(() => reject(new SolverError(m.message)));
    });
    worker.on('error', (err) => finish(() => reject(started ? new SolverError(err.message) : new WorkerStartError(err.message))));
    worker.on('exit', (code) => finish(() => reject(new SolverError(`solver worker exited with code ${code}`))));
    worker.postMessage(task);
  });
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
  const gate = new Semaphore(maxConcurrent);
  let useWorker = mode !== 'inline';

  async function attempt<T>(task: SolveTask, inline: () => T | Promise<T>, opts: Parameters<typeof runInWorker>[1]): Promise<T> {
    return gate.run(async () => {
      if (useWorker) {
        try {
          return await runInWorker<T>(task, opts);
        } catch (err) {
          if (!(err instanceof WorkerStartError) || mode === 'worker') throw err;
          // The worker could not load (e.g. no TypeScript loader): fall back for good.
          useWorker = false;
        }
      }
      return inline();
    });
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
