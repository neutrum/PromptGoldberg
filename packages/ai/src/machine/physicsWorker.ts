import { parentPort } from 'node:worker_threads';
import { evaluateMachine, initPhysics, localKitRunner, makeConnectPuzzle, makeLevelPuzzle, nudgeMachine, simulateSync, traceHash, type MachineSpec, type Part } from '@pg/core';
import type { WorkerMessage } from './pool';

export type PhysicsTask =
  | { kind: 'check'; spec: MachineSpec; hash?: boolean }
  | { kind: 'nudge'; spec: MachineSpec; budget: number; timeLimitMs: number; seed: number; keep?: string[] }
  | { kind: 'puzzle'; spec: MachineSpec }
  /** Runs for the kit search (see solveWithKit): a batch of builds scored, or one build's full run. */
  | { kind: 'kitScore'; spec: MachineSpec; builds: Part[][] }
  | { kind: 'kitTrace'; spec: MachineSpec; build: Part[] };

/** Runs machine simulations off the main thread; stays alive for the next task. */
const ready = initPhysics();
parentPort!.on('message', async (task: PhysicsTask) => {
  const post = (m: WorkerMessage) => parentPort!.postMessage(m);
  try {
    await ready;
    if (task.kind === 'check') {
      // The trace fingerprint needs the recorded frames; plain checks skip recording.
      const run = simulateSync(task.spec, { record: !!task.hash });
      post({ type: 'done', result: { result: evaluateMachine(task.spec.goal, run), events: run.events, hash: task.hash ? traceHash(run) : undefined } });
    } else if (task.kind === 'kitScore' || task.kind === 'kitTrace') {
      const runner = localKitRunner(makeLevelPuzzle(task.spec)!);
      post({ type: 'done', result: await (task.kind === 'kitScore' ? runner.score(task.builds) : runner.trace(task.build)) });
    } else if (task.kind === 'puzzle') {
      post({ type: 'done', result: makeConnectPuzzle(task.spec) });
    } else {
      let last = 0;
      const res = nudgeMachine(task.spec, {
        budget: task.budget, timeLimitMs: task.timeLimitMs, seed: task.seed, keep: task.keep,
        onProgress: (p) => {
          const now = Date.now();
          if (now - last < 100) return;
          last = now;
          post({ type: 'progress', evals: p.evals, bestScore: p.bestScore });
        },
      });
      // The recorded run is big and the client re-simulates anyway; send what the pipeline needs.
      post({ type: 'done', result: { spec: res.spec, result: res.result, evals: res.evals, solved: res.solved, moved: res.moved, events: res.run.events } });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
