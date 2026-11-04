import { availableParallelism } from 'node:os';
import {
  evaluateMachine, initPhysics, localKitRunner, makeConnectPuzzle, makeLevelPuzzle, nudgeMachine, simulateSync, solveWithKit, traceHash,
  type KitRunner, type KitSolve, type MachineEvent, type MachineResult, type MachineSpec, type Puzzle,
} from '@pg/core';
import { SolverError, WorkerPool, WorkerStartError } from './pool';
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
  /** Parts never moved. */
  keep?: string[];
  signal?: AbortSignal;
  onProgress?: (p: { evals: number; bestScore: number }) => void;
}

/** Runs machine physics for the pipeline: in worker threads when they load, inline otherwise. */
export interface Physics {
  readonly mode: 'worker' | 'inline';
  check(spec: MachineSpec, opts?: { timeoutMs?: number; signal?: AbortSignal; hash?: boolean }): Promise<CheckOutcome>;
  nudge(spec: MachineSpec, job: NudgeJob): Promise<NudgeOutcome>;
  /** The level's puzzle: its route parts go to the player's hand. */
  puzzle(spec: MachineSpec, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Puzzle | null>;
  /** A build from the level's own kit (its spares) that reaches the goal, by physics search; null when the level has no kit. */
  kitSolve(spec: MachineSpec, opts?: { budgetMs?: number; signal?: AbortSignal }): Promise<KitSolve | null>;
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
        // Every run from here on blocks the main thread: say so, loudly, once.
        console.warn(`Physics workers cannot start (${err.message}); running physics inline from now on.`);
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
      const task: PhysicsTask = { kind: 'nudge', spec, budget: job.budget, timeLimitMs: job.timeLimitMs, seed: job.seed ?? 1, keep: job.keep };
      return attempt(task, async () => {
        await initPhysics();
        const res = nudgeMachine(spec, { budget: job.budget, timeLimitMs: job.timeLimitMs, seed: job.seed, keep: job.keep, onProgress: job.onProgress });
        return { spec: res.spec, result: res.result, evals: res.evals, solved: res.solved, moved: res.moved, events: res.run.events };
      }, { timeoutMs: job.timeLimitMs + 20_000, signal: job.signal, onProgress: job.onProgress });
    },
    puzzle(spec, opts = {}) {
      return attempt({ kind: 'puzzle', spec }, async () => {
        await initPhysics();
        return makeConnectPuzzle(spec);
      }, { timeoutMs: opts.timeoutMs ?? 30_000, signal: opts.signal });
    },
    async kitSolve(spec, opts = {}) {
      const puzzle = makeLevelPuzzle(spec);
      if (!puzzle) return null;
      await initPhysics();
      // One search here; its runs spread over the workers, each step's candidates in chunks side by side.
      const local = localKitRunner(puzzle);
      const run = <T,>(task: PhysicsTask, inline: () => Promise<T>) => attempt(task, inline, { timeoutMs: 30_000, signal: opts.signal });
      const runner: KitRunner = {
        score: async (builds) => {
          const n = Math.min(maxConcurrent, Math.ceil(builds.length / 8));
          const size = Math.ceil(builds.length / n);
          const chunks = Array.from({ length: n }, (_, i) => builds.slice(i * size, (i + 1) * size));
          return (await Promise.all(chunks.map((c) => run({ kind: 'kitScore', spec, builds: c }, () => local.score(c))))).flat();
        },
        trace: (build) => run({ kind: 'kitTrace', spec, build }, () => local.trace(build)),
      };
      return solveWithKit(puzzle, { budgetMs: opts.budgetMs ?? 20_000, runner });
    },
  };
}

export { SolverError };
