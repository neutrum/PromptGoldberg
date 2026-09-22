import { applyTunables, controlValues, mulberry32, type GoalResult, type Level } from '@og/shared';
import { chooseStartValues } from './startValues';

/** Runs several shots of one level (in a single solver task). */
export type BatchCheck = (level: Level, shots: number[][]) => Promise<GoalResult[]>;

/** Share of small nudges around the solution that must still win. */
export const MIN_ROBUSTNESS = 0.5;
/** Share of random shots that may win before a level counts as too easy. */
export const MAX_RANDOM_RATE = 0.25;
/** Nudge size: 0.5% of each control's range, about two fine keyboard steps. */
const NUDGE = 0.005;
const RANDOM_SAMPLES = 24;
/** Loosening tried in order: collision targets grow by these factors, flyby windows by at most 3x. */
const LOOSEN = [1.5, 3, 6, 12];
const MAX_FLYBY_FACTOR = 3;
/** A grown collision target stays below this share of its orbit radius, so it cannot touch its parent. */
const MAX_RADIUS_OF_ORBIT = 0.3;

export interface Forgiveness {
  robustness: number;
  /** Goal-checker notes from nudged shots that missed (for a redesign prompt). */
  missNotes: string[];
}

function nudges(level: Level, solution: number[]): number[][] {
  return level.controls.flatMap((c, i) => [-1, 1].map((sg) => {
    const v = [...solution];
    v[i] += sg * NUDGE * (c.max - c.min);
    return v;
  }));
}

/** Share of ±0.5% moves on each control, away from the solution, that still clear the level. */
export async function measure(level: Level, solution: number[], check: BatchCheck): Promise<Forgiveness> {
  const results = await check(level, nudges(level, solution));
  const misses = results.filter((r) => !r.success);
  return {
    robustness: (results.length - misses.length) / Math.max(1, results.length),
    missNotes: [...new Set(misses.map((r) => r.events.find((e) => !e.satisfied)?.note ?? 'missed'))].slice(0, 4),
  };
}

/** Share of uniformly random control settings that clear the level. */
export async function randomRate(level: Level, check: BatchCheck, samples = RANDOM_SAMPLES): Promise<number> {
  const rand = mulberry32(11);
  const shots = Array.from({ length: samples }, () => level.controls.map((c) => c.min + rand() * (c.max - c.min)));
  return (await check(level, shots)).filter((r) => r.success).length / samples;
}

/** Wider flyby windows and bigger collision targets (never a star); the rest of the level is unchanged. */
export function loosen(level: Level, factor: number): Level {
  const spec = structuredClone(level.spec);
  const grow = new Set<string>();
  for (const g of spec.goal) {
    if (g.type === 'flyby') g.maxDistance *= Math.min(factor, MAX_FLYBY_FACTOR);
    if (g.type === 'collision') grow.add(g.a === level.player ? g.b : g.a);
  }
  for (const b of spec.bodies) {
    if (!grow.has(b.id) || b.type === 'star') continue;
    const cap = b.placement.kind === 'orbit' ? MAX_RADIUS_OF_ORBIT * b.placement.a * (1 - b.placement.e) : Infinity;
    b.radius = Math.max(b.radius, Math.min(b.radius * factor, cap));
  }
  return { ...level, spec };
}

/**
 * Loosens a proven level's goal until small aiming errors stop mattering, without letting random
 * shots win too often. Starting sliders are chosen again so the first shot still misses.
 */
export async function makeForgiving(level: Level, check: BatchCheck, deadline = Infinity): Promise<{ level: Level; note: string } & Forgiveness> {
  const solution = level.solution?.values;
  if (!solution) return { level, note: 'Not solved, so not loosened.', robustness: 0, missNotes: [] };
  const before = await measure(level, solution, check);
  if (before.robustness >= MIN_ROBUSTNESS) {
    return { level, ...before, note: `Forgiving as designed (${pct(before.robustness)} of nudges still win).` };
  }

  let best = { level, ...before, factor: 1 };
  for (const factor of LOOSEN) {
    if (Date.now() > deadline) break;
    const candidate = loosen(level, factor);
    const [sol] = await check(candidate, [solution]);
    if (!sol.success) continue;
    if ((await randomRate(candidate, check)) > MAX_RANDOM_RATE) break;
    const m = await measure(candidate, solution, check);
    if (m.robustness > best.robustness) best = { level: candidate, ...m, factor };
    if (m.robustness >= MIN_ROBUSTNESS) break;
  }
  if (best.factor === 1) {
    return { level, ...before, note: `Fragile: only ${pct(before.robustness)} of nudges win and loosening did not help.` };
  }

  // The looser goal may let the old start succeed: pick starting sliders that miss again.
  const tunables = best.level.controls.map((c) => ({ path: c.path, min: c.min, max: c.max }));
  const one = async (l: Level, v: number[]) => (await check(l, [v]))[0];
  const start = await chooseStartValues(best.level, solution, controlValues(level), one);
  const spec = { ...applyTunables(best.level.spec, tunables, start.values), tunables: [] };
  return {
    level: { ...best.level, spec },
    robustness: best.robustness,
    missNotes: best.missNotes,
    note: `Loosened the goal x${best.factor}: ${pct(before.robustness)} -> ${pct(best.robustness)} of nudges still win.`,
  };
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
