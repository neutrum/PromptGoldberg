import { availableParallelism } from 'node:os';
import {
  compileRoute, evaluateMachine, initPhysics, makePuzzleOfKind, nudgeMachine, simulateSync, traceHash,
  type CompileResult, type RouteGraphInput, type Rules, type Stage, type MachineEvent, type MachineResult, type MachineSpec, type Puzzle, type PuzzleKind,
} from '@og/machine';
import { SolverError, WorkerPool, WorkerStartError } from '../solver';
import type { PhysicsTask } from './physicsWorker';

export interface CheckOutcome {
  result: MachineResult;
  events: MachineEvent[];
  /** Trace fingerprint (only when asked for: it needs a recorded run). */
  hash?: string;
}

export interface NudgeOutcome extends CheckOutcome {
  spec: MachineSpec;
  evals: number;
  solved: boolean;
  moved: { id: string; cells: number }[];
}

export interface NudgeJob {
  budget: number;
  timeLimitMs: number;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (p: { evals: number; bestScore: number }) => void;
}

/** Runs machine physics for the pipeline: in worker threads when they load, inline otherwise. */
export interface Physics {
  readonly mode: 'worker' | 'inline';
  check(spec: MachineSpec, opts?: { timeoutMs?: number; signal?: AbortSignal; hash?: boolean }): Promise<CheckOutcome>;
  nudge(spec: MachineSpec, job: NudgeJob): Promise<NudgeOutcome>;
  /** Break a working machine for the player (dozens of short runs; cheap here, slow in a browser). */
  puzzle(spec: MachineSpec, kind: PuzzleKind, seed: number, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Puzzle | null>;
  /** Lay a route graph out by following the ball (a few to a few hundred short runs). */
  compile(graph: RouteGraphInput, opts: { seed: number; flat?: boolean; rules?: Rules; strict?: boolean; stage?: Stage; clutter?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<CompileResult | null>;
}

const WORKER_URL = new URL('./physicsWorker.ts', import.meta.url);

export function createPhysics(mode: 'worker' | 'inline' | 'auto' = 'auto', maxConcurrent = Math.max(1, availableParallelism() - 1)): Physics {
  const pool = new WorkerPool(maxConcurrent, WORKER_URL);
  let useWorker = mode !== 'inline';

  async function attempt<T>(task: PhysicsTask, inline: () => Promise<T>, opts: { timeoutMs: number; signal?: AbortSignal; onProgress?: NudgeJob['onProgress'] }): Promise<T> {
    if (useWorker) {
      try {
        return await pool.run<T>(task, opts);
      } catch (err) {
        if (!(err instanceof WorkerStartError) || mode === 'worker') throw err;
        useWorker = false;
      }
    }
    return inline();
  }

  return {
    get mode() {
      return useWorker ? 'worker' : 'inline';
    },
    check(spec, opts = {}) {
      return attempt({ kind: 'check', spec, hash: opts.hash }, async () => {
        await initPhysics();
        const run = simulateSync(spec, { record: !!opts.hash });
        return { result: evaluateMachine(spec.goal, run), events: run.events, hash: opts.hash ? traceHash(run) : undefined };
      }, { timeoutMs: opts.timeoutMs ?? 15_000, signal: opts.signal });
    },
    nudge(spec, job) {
      const task: PhysicsTask = { kind: 'nudge', spec, budget: job.budget, timeLimitMs: job.timeLimitMs, seed: job.seed ?? 1 };
      return attempt(task, async () => {
        await initPhysics();
        const res = nudgeMachine(spec, { budget: job.budget, timeLimitMs: job.timeLimitMs, seed: job.seed, onProgress: job.onProgress });
        return { spec: res.spec, result: res.result, evals: res.evals, solved: res.solved, moved: res.moved, events: res.run.events };
      }, { timeoutMs: job.timeLimitMs + 20_000, signal: job.signal, onProgress: job.onProgress });
    },
    compile(graph, opts) {
      return attempt({ kind: 'compile', graph, seed: opts.seed, flat: opts.flat, rules: opts.rules, strict: opts.strict, stage: opts.stage, clutter: opts.clutter }, async () => {
        await initPhysics();
        return compileRoute(graph, { seed: opts.seed, flat: opts.flat, rules: opts.rules, strict: opts.strict, stage: opts.stage, clutter: opts.clutter });
      }, { timeoutMs: opts.timeoutMs ?? 30_000, signal: opts.signal });
    },
    puzzle(spec, kind, seed, opts = {}) {
      return attempt({ kind: 'puzzle', spec, puzzleKind: kind, seed }, async () => {
        await initPhysics();
        return makePuzzleOfKind(spec, kind, { seed });
      }, { timeoutMs: opts.timeoutMs ?? 30_000, signal: opts.signal });
    },
  };
}

export { SolverError };
