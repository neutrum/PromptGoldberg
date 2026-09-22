import { parentPort } from 'node:worker_threads';
import { checkShot, optimize, simulate, evaluateGoal } from '@og/shared';
import type { SolveTask, WorkerMessage } from './solver';

/** Runs optimizer and check tasks off the main thread. One task per worker. */
parentPort!.once('message', (task: SolveTask) => {
  const post = (m: WorkerMessage) => parentPort!.postMessage(m);
  try {
    if (task.kind === 'optimize') {
      let last = 0;
      const res = optimize(task.spec, {
        budget: task.budget,
        timeLimitMs: task.timeLimitMs,
        seed: task.seed,
        onProgress: (p) => {
          const now = Date.now();
          if (now - last < 100) return;
          last = now;
          post({ type: 'progress', evals: p.evals, bestScore: p.bestScore });
        },
      });
      post({ type: 'done', result: res });
    } else if (task.kind === 'check') {
      post({ type: 'done', result: checkShot(task.level, task.values, task.pieces).goal });
    } else if (task.kind === 'checkMany') {
      post({ type: 'done', result: task.shots.map((v) => checkShot(task.level, v).goal) });
    } else {
      post({ type: 'done', result: evaluateGoal(task.spec.goal, simulate(task.spec, { record: false }).trace) });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
