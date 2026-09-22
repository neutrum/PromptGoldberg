/// <reference lib="webworker" />
import { evaluateGoal, generateLevel, parseSpec, simulate, solveLevel } from '@og/shared';
import type { RunData, WorkerRequest, WorkerResponse } from './simClient';

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function runSim(id: number, input: unknown) {
  const parsed = parseSpec(input);
  if (!parsed.ok) {
    post({ id, ok: false, error: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('\n') });
    return;
  }
  const started = performance.now();
  const run = simulate(parsed.spec, { record: true });
  const goal = evaluateGoal(parsed.spec.goal, run.trace);
  const frames = run.frames!;
  const result: RunData = {
    spec: parsed.spec,
    ids: run.ids,
    duration: run.duration,
    frameCount: run.frameCount,
    frameStride: run.frameStride,
    frames,
    events: run.events,
    trace: run.trace,
    goal,
    stats: { steps: run.steps, substeps: run.substeps, ms: performance.now() - started },
  };
  post({ id, ok: true, result }, [frames.buffer]);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.kind) {
      case 'simulate':
        runSim(req.id, req.spec);
        return;
      case 'solve': {
        let lastPost = 0;
        const result = solveLevel(req.level, req.pieces, {
          budget: req.budget,
          timeLimitMs: req.timeLimitMs,
          seed: (Math.random() * 2 ** 31) | 0,
          onEval: (p) => {
            const now = performance.now();
            if (now - lastPost < 50) return;
            lastPost = now;
            post({ id: req.id, progress: { evals: p.evals, bestScore: p.bestScore } });
          },
        });
        post({ id: req.id, ok: true, result });
        return;
      }
      case 'procgen': {
        const result = generateLevel(req.seed, req.difficulty, {
          onProgress: (p) => post({ id: req.id, progress: { evals: p.evals, bestScore: 0, attempt: p.attempt } }),
        });
        post({ id: req.id, ok: true, result });
        return;
      }
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
