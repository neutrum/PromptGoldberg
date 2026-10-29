import { parentPort } from 'node:worker_threads';
import { compileRoute, evaluateMachine, initPhysics, makePuzzleOfKind, nudgeMachine, simulateSync, traceHash, type MachineSpec, type PuzzleKind, type RouteGraphInput, type Rules, type Stage } from '@og/machine';
import type { WorkerMessage } from '../solver';

export type PhysicsTask =
  | { kind: 'check'; spec: MachineSpec; hash?: boolean }
  | { kind: 'nudge'; spec: MachineSpec; budget: number; timeLimitMs: number; seed: number }
  | { kind: 'puzzle'; spec: MachineSpec; puzzleKind: PuzzleKind; seed: number }
  | { kind: 'compile'; graph: RouteGraphInput; seed: number; flat?: boolean; rules?: Rules; strict?: boolean; stage?: Stage; clutter?: number };

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
    } else if (task.kind === 'compile') {
      post({ type: 'done', result: compileRoute(task.graph, { seed: task.seed, flat: task.flat, rules: task.rules, strict: task.strict, stage: task.stage, clutter: task.clutter }) });
    } else if (task.kind === 'puzzle') {
      post({ type: 'done', result: makePuzzleOfKind(task.spec, task.puzzleKind, { seed: task.seed }) });
    } else {
      let last = 0;
      const res = nudgeMachine(task.spec, {
        budget: task.budget, timeLimitMs: task.timeLimitMs, seed: task.seed,
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
