import { parentPort } from 'node:worker_threads';
import { evaluateMachine, initPhysics, makePuzzleOfKind, nudgeMachine, simulateSync, type MachineSpec, type PuzzleKind } from '@og/machine';
import type { WorkerMessage } from '../solver';

export type PhysicsTask =
  | { kind: 'check'; spec: MachineSpec }
  | { kind: 'nudge'; spec: MachineSpec; budget: number; timeLimitMs: number; seed: number }
  | { kind: 'puzzle'; spec: MachineSpec; puzzleKind: PuzzleKind; seed: number };

/** Runs machine simulations off the main thread; stays alive for the next task. */
const ready = initPhysics();
parentPort!.on('message', async (task: PhysicsTask) => {
  const post = (m: WorkerMessage) => parentPort!.postMessage(m);
  try {
    await ready;
    if (task.kind === 'check') {
      const run = simulateSync(task.spec, { record: false });
      post({ type: 'done', result: { result: evaluateMachine(task.spec.goal, run), events: run.events } });
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
