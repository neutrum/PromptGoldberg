/**
 * Fix-it puzzles: take a machine that works, pull a part out, and let the player put it back.
 * The proven machine is the solution, so a puzzle is always solvable and a hint is free.
 */
import { evaluateMachine } from './goal';
import type { MachineSpec, Part, PartKind } from './schema';
import { simulateSync } from './sim';

export interface Puzzle {
  /** The machine with the missing parts removed. Runs, but fails. */
  spec: MachineSpec;
  /** The parts the player gets back, at their original height and facing; the player picks where. */
  missing: Part[];
  /** The complete machine. */
  solution: MachineSpec;
  /** Which goal step the broken machine fails at. */
  failedAt: number;
}

/** Parts worth removing, best first: the ones whose absence is visible and makes a satisfying fix. */
const REMOVAL_ORDER: PartKind[] = ['cannon', 'fan', 'trampoline', 'seesaw', 'dominoes', 'bucket', 'bell', 'ramp', 'wall', 'platform'];

/**
 * Remove `count` parts (default 1) so the machine fails as late as possible: most of the chain
 * still plays, then it breaks where the part is missing. Returns null when nothing can be
 * removed without the machine still working (every part is load-bearing or none is).
 * Call after initPhysics().
 */
export function makePuzzle(solution: MachineSpec, count = 1, opts: { avoid?: string[] } = {}): Puzzle | null {
  const solved = evaluateMachine(solution.goal, simulateSync(solution, { record: false }));
  if (!solved.success) return null;
  const candidates = solution.parts
    .filter((p) => p.kind !== 'ball' && !opts.avoid?.includes(p.id))
    .sort((a, b) => REMOVAL_ORDER.indexOf(a.kind) - REMOVAL_ORDER.indexOf(b.kind));

  let spec = solution;
  const missing: Part[] = [];
  let failedAt = -1;
  for (let k = 0; k < count; k++) {
    let best: { part: Part; spec: MachineSpec; failedAt: number; score: number } | null = null;
    for (const part of candidates) {
      if (missing.includes(part)) continue;
      const trial: MachineSpec = { ...spec, parts: spec.parts.filter((p) => p.id !== part.id) };
      const result = evaluateMachine(trial.goal, simulateSync(trial, { record: false }));
      if (result.success || result.failedAt === null) continue;
      // Prefer failing late in the chain and, within that, a part the removal order likes.
      const score = result.failedAt * 10 - REMOVAL_ORDER.indexOf(part.kind) * 0.1;
      if (!best || score > best.score) best = { part, spec: trial, failedAt: result.failedAt, score };
    }
    if (!best) break;
    missing.push(best.part);
    spec = best.spec;
    failedAt = best.failedAt;
  }
  if (!missing.length) return null;
  return { spec, missing, solution, failedAt };
}

/** The puzzle with the player's placements added back in. */
export function withPlacements(puzzle: Puzzle, placed: Part[]): MachineSpec {
  return { ...puzzle.spec, parts: [...puzzle.spec.parts, ...placed] };
}
