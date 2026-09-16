import { evaluateGoal, type GoalResult } from './goal';
import type { SystemSpec, Tunable } from './schema';
import { simulate } from './sim';
import { applyTunables, getTunable, isValidTunable } from './tunables';

export interface OptimizeOptions {
  /** Maximum simulations. */
  budget?: number;
  /** Wall-clock cap in ms. */
  timeLimitMs?: number;
  seed?: number;
  onProgress?: (p: { evals: number; bestScore: number; bestValues: number[] }) => void;
}

export interface OptimizeResult {
  spec: SystemSpec;
  values: number[];
  result: GoalResult;
  evals: number;
  solved: boolean;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tune numeric parameters to maximise goal progress: random scouting, then
 * Nelder–Mead restarts from the best points, all in the unit cube.
 */
export function optimize(spec: SystemSpec, opts: OptimizeOptions = {}): OptimizeResult {
  const budget = opts.budget ?? 250;
  const deadline = Date.now() + (opts.timeLimitMs ?? 10_000);
  const rand = mulberry32(opts.seed ?? 1);
  const tunables: Tunable[] = spec.tunables.filter((t) => isValidTunable(spec, t) && t.max > t.min);
  const goalLen = spec.goal.length;
  const dim = tunables.length;

  const toValues = (u: number[]) => u.map((x, i) => tunables[i].min + Math.min(1, Math.max(0, x)) * (tunables[i].max - tunables[i].min));
  let evals = 0;
  let best: { u: number[]; score: number; result: GoalResult } | null = null;

  const evaluate = (u: number[]): number => {
    const clamped = u.map((x) => Math.min(1, Math.max(0, x)));
    const candidate = applyTunables(spec, tunables, toValues(clamped));
    const result = evaluateGoal(candidate.goal, simulate(candidate, { record: false }).trace);
    evals++;
    if (!best || result.score > best.score) {
      best = { u: clamped, score: result.score, result };
      opts.onProgress?.({ evals, bestScore: result.score, bestValues: toValues(clamped) });
    }
    return result.score;
  };
  const done = () => evals >= budget || Date.now() > deadline || (best !== null && best.result.success);

  const start = tunables.map((t) => {
    const v = getTunable(spec, t.path)!;
    return (v - t.min) / (t.max - t.min);
  });
  evaluate(start);

  if (dim > 0) {
    const scouts: { u: number[]; score: number }[] = [{ u: start, score: best!.score }];
    const scoutCount = Math.floor(budget * 0.3);
    for (let k = 0; k < scoutCount && !done(); k++) {
      const u = start.map(() => rand());
      scouts.push({ u, score: evaluate(u) });
    }
    scouts.sort((a, b) => b.score - a.score);

    for (let r = 0; !done(); r++) {
      const seed = r < scouts.length ? scouts[r].u : best!.u.map((x) => x + (rand() - 0.5) * 0.2);
      nelderMead(evaluate, seed, done, r === 0 ? 0.1 : 0.05);
    }
  }

  const b = best!;
  const values = toValues(b.u);
  return {
    spec: applyTunables(spec, tunables, values),
    values,
    result: b.result,
    evals,
    solved: b.result.success && goalLen > 0,
  };
}

/** Maximise f starting from x0 with an axis-aligned initial simplex of size `step`. */
function nelderMead(f: (x: number[]) => number, x0: number[], done: () => boolean, step: number): void {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((x, j) => (i === j ? x + (x + step <= 1 ? step : -step) : x)))]
    .map((x) => ({ x, v: f(x) }));
  let stall = 0;
  while (!done() && stall < 6 * n + 10) {
    simplex.sort((a, b) => b.v - a.v);
    const bestV = simplex[0].v;
    const worst = simplex[n];
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const along = (k: number) => centroid.map((c, j) => c + k * (c - worst.x[j]));

    const reflected = { x: along(1), v: 0 };
    reflected.v = f(reflected.x);
    if (reflected.v > simplex[0].v) {
      const expanded = { x: along(2), v: 0 };
      expanded.v = done() ? -Infinity : f(expanded.x);
      simplex[n] = expanded.v > reflected.v ? expanded : reflected;
    } else if (reflected.v > simplex[n - 1].v) {
      simplex[n] = reflected;
    } else {
      const contracted = { x: along(-0.5), v: 0 };
      contracted.v = done() ? -Infinity : f(contracted.x);
      if (contracted.v > worst.v) {
        simplex[n] = contracted;
      } else {
        const b = simplex[0];
        simplex = simplex.map((p, i) => {
          if (i === 0 || done()) return p;
          const x = p.x.map((xj, j) => b.x[j] + 0.5 * (xj - b.x[j]));
          return { x, v: f(x) };
        });
      }
    }
    simplex.sort((a, b) => b.v - a.v);
    stall = simplex[0].v > bestV + 1e-6 ? 0 : stall + 1;
    const size = Math.max(...simplex.map((p) => Math.max(...p.x.map((xj, j) => Math.abs(xj - simplex[0].x[j])))));
    if (size < 1e-4) break;
  }
}
