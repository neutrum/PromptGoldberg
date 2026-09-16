import type { GoalResult, Level, Piece, SimEvent, SystemSpec, Trace } from '@og/shared';

export interface RunData {
  spec: SystemSpec;
  ids: string[];
  duration: number;
  frameCount: number;
  frameStride: number;
  /** Per frame: [t, x0, y0, z0, x1, ...] in simulation coordinates. */
  frames: Float32Array;
  events: SimEvent[];
  trace: Trace;
  goal: GoalResult;
  stats: { steps: number; substeps: number; ms: number };
}

export interface SolveResult {
  solved: boolean;
  values: number[];
  goal: GoalResult;
  evals: number;
}

export interface ProcgenResult {
  level: Level;
  attempts: number;
  evals: number;
}

export type WorkerJob =
  | { kind: 'simulate'; spec: unknown }
  | { kind: 'solve'; level: Level; pieces: Piece[]; budget: number; timeLimitMs: number }
  | { kind: 'procgen'; seed: number; difficulty: number };

export type WorkerRequest = { id: number } & WorkerJob;

export type WorkerProgress = { evals: number; bestScore: number; attempt?: number };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: WorkerProgress };

type Pending = { resolve: (r: never) => void; reject: (e: Error) => void; onProgress?: (p: WorkerProgress) => void };

/** A lazily started worker with request/response matching. Separate pools keep long jobs from blocking previews. */
class Pool {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private get(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if ('progress' in msg) {
        p.onProgress?.(msg.progress);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result as never);
      else p.reject(new Error(msg.error));
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'worker failed'));
      this.pending.clear();
    };
    return (this.worker = w);
  }

  run<T>(job: WorkerJob, onProgress?: (p: WorkerProgress) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: never) => void, reject, onProgress });
      this.get().postMessage({ id, ...job } satisfies WorkerRequest);
    });
  }

  /** Kill the worker and fail everything in flight (used to abort a long solve). */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
  }
}

const simPool = new Pool();
const previewPool = new Pool();
export const computePool = new Pool();

/** Validate and simulate a spec off the main thread. */
export function runSimulation(spec: unknown): Promise<RunData> {
  return simPool.run<RunData>({ kind: 'simulate', spec });
}

/** Same as runSimulation but on a dedicated worker, so aim previews never queue behind shots. */
export function runPreview(spec: unknown): Promise<RunData> {
  return previewPool.run<RunData>({ kind: 'simulate', spec });
}

export function solveInWorker(level: Level, pieces: Piece[], onProgress: (p: WorkerProgress) => void, budget = 1500, timeLimitMs = 60_000): Promise<SolveResult> {
  return computePool.run<SolveResult>({ kind: 'solve', level, pieces, budget, timeLimitMs }, onProgress);
}

export function generateInWorker(seed: number, difficulty: number, onProgress?: (p: WorkerProgress) => void): Promise<ProcgenResult> {
  return computePool.run<ProcgenResult>({ kind: 'procgen', seed, difficulty }, onProgress);
}
