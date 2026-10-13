/**
 * The optimizer for machines: keeps the design, nudges parts within their cells (and by a cell
 * when that is not enough) until the goal chain fires. Hill climbing over one part at a time:
 * contraptions are local, so the part the chain breaks at is where to look.
 */
import { evaluateMachine, type MachineResult } from './goal';
import { GRID, TERRAIN_MIN, type MachineSpec, type Part } from './schema';
import { simulateSync, type MachineRun } from './sim';

export interface NudgeOptions {
  /** Maximum simulations (default 150). */
  budget?: number;
  timeLimitMs?: number;
  seed?: number;
  onProgress?: (p: { evals: number; bestScore: number }) => void;
}

export interface NudgeResult {
  spec: MachineSpec;
  result: MachineResult;
  run: MachineRun;
  evals: number;
  solved: boolean;
  /** Parts the optimizer moved, with how far (cells). */
  moved: { id: string; cells: number }[];
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Parts most likely to fix the chain: the failed step's part, the parts touched last, then the rest. */
function suspects(spec: MachineSpec, run: MachineRun, result: MachineResult): string[] {
  const order: string[] = [];
  const push = (id: string | undefined) => { if (id && !order.includes(id)) order.push(id); };
  if (result.failedAt !== null) push(spec.goal[result.failedAt].part);
  const touches = run.events.filter((e) => e.type === 'touch') as { part: string }[];
  for (const e of touches.slice(-3).reverse()) push(e.part);
  push(spec.parts.find((p) => p.kind === 'ball')?.id);
  for (const p of spec.parts) push(p.id);
  // Scenery is the level: it is never nudged.
  const scenery = new Set(spec.parts.filter((p) => p.fixed).map((p) => p.id));
  return order.filter((id) => !scenery.has(id));
}

/**
 * Fine offsets (within the cell) and, less often, a whole-cell move or a height change. A shelf
 * only shifts within its cell: a whole-cell move would pull the floor from under what stands on it.
 */
function perturb(p: Part, rand: () => number, scale: number): Part {
  const r = p.kind === 'platform' ? 0 : rand();
  if (r < 0.7) {
    return { ...p, dx: clamp((p.dx ?? 0) + (rand() - 0.5) * scale, -0.5, 0.5), dz: clamp((p.dz ?? 0) + (rand() - 0.5) * scale, -0.5, 0.5) };
  }
  if (r < 0.9) {
    const axis = rand() < 0.5 ? 'x' : 'z';
    const step = rand() < 0.5 ? -1 : 1;
    return { ...p, [axis]: clamp(p[axis] + step, 0, GRID[axis] - 1) };
  }
  return { ...p, y: clamp(p.y + (rand() < 0.5 ? -1 : 1), TERRAIN_MIN, GRID.y - 1) };
}

/** Nudge parts until the machine works. Call after initPhysics(). */
export function nudgeMachine(spec: MachineSpec, opts: NudgeOptions = {}): NudgeResult {
  const budget = opts.budget ?? 150;
  const deadline = Date.now() + (opts.timeLimitMs ?? 10_000);
  const rand = mulberry32(opts.seed ?? 1);
  let evals = 0;
  const evaluate = (s: MachineSpec) => {
    const run = simulateSync(s, { record: false });
    evals++;
    return { spec: s, run, result: evaluateMachine(s.goal, run) };
  };
  let best = evaluate(spec);
  opts.onProgress?.({ evals, bestScore: best.result.score });
  const done = () => best.result.success || evals >= budget || Date.now() > deadline;

  let stale = 0;
  while (!done()) {
    const order = suspects(best.spec, best.run, best.result);
    // Mostly the prime suspects; sometimes anything, so a wrong guess cannot trap the search.
    const pick = stale > 8 && rand() < 0.5 ? Math.floor(rand() * order.length) : Math.min(order.length - 1, Math.floor(Math.pow(rand(), 2) * order.length));
    const id = order[pick];
    const scale = stale > 12 ? 1 : 0.5;
    const candidate: MachineSpec = { ...best.spec, parts: best.spec.parts.map((p) => (p.id === id ? perturb(p, rand, scale) : p)) };
    const trial = evaluate(candidate);
    if (trial.result.score > best.result.score + 1e-9) {
      best = trial;
      stale = 0;
      opts.onProgress?.({ evals, bestScore: best.result.score });
    } else {
      stale++;
    }
  }

  const moved = spec.parts.flatMap((p) => {
    const q = best.spec.parts.find((b) => b.id === p.id)!;
    const cells = Math.hypot(q.x + (q.dx ?? 0) - p.x - (p.dx ?? 0), q.y - p.y, q.z + (q.dz ?? 0) - p.z - (p.dz ?? 0));
    return cells > 1e-6 ? [{ id: p.id, cells: Math.round(cells * 100) / 100 }] : [];
  });
  // The final run is recorded, so callers can play it back.
  const run = simulateSync(best.spec, { record: true });
  return { spec: best.spec, result: evaluateMachine(best.spec.goal, run), run, evals, solved: best.result.success, moved };
}
