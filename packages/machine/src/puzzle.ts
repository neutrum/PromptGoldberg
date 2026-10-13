/**
 * Fix-it puzzles: take a machine that works and break it for the player to repair.
 * The proven machine is the solution, so a puzzle is always solvable and a hint is free.
 *
 * Kinds: 'connect' keeps the ball, the goal parts and the shelves they stand on where they are and
 * hands the player everything else (ramps, fans, cannons, free shelves...) to build the route with,
 * The Incredible Machine's frame; 'missing' pulls
 * one part out, 'missing2' pulls two, 'moved' leaves every part in but shifts one to a nearby
 * wrong cell, so the player has to spot which one.
 */
import { evaluateMachine } from './goal';
import { footprint } from './kit';
import { targetParts } from './names';
import { dropAt, isSupported, supportsOf } from './placement';
import type { MachineSpec, Part, PartKind } from './schema';
import { simulateSync } from './sim';

export type PuzzleKind = 'connect' | 'missing' | 'missing2' | 'moved';

export const PUZZLE_KINDS: PuzzleKind[] = ['connect', 'missing', 'missing2', 'moved'];

export interface Puzzle {
  kind: PuzzleKind;
  /** The machine with the puzzle parts removed. Runs, but fails. */
  spec: MachineSpec;
  /** The parts the player gets back, at their original height and facing; the player picks where. */
  missing: Part[];
  /** Where those parts start out: empty for a missing part, the wrong cell for a moved one. */
  start: Part[];
  /** The complete machine. */
  solution: MachineSpec;
  /** Which goal step the broken machine fails at. */
  failedAt: number;
}

/** Parts worth removing, best first: the ones whose absence is visible and makes a satisfying fix. */
const REMOVAL_ORDER: PartKind[] = ['cannon', 'fan', 'trampoline', 'seesaw', 'dominoes', 'bucket', 'bell', 'ramp', 'wall', 'platform'];

const fails = (spec: MachineSpec) => {
  const r = evaluateMachine(spec.goal, simulateSync(spec, { record: false }));
  return r.success || r.failedAt === null ? null : r.failedAt;
};

/**
 * Hand-placeable parts of a working machine, best to remove first: the ones that stand on the
 * floor or a shelf, where a hand-placed part can go back. The player gets them centred in their
 * cell; dropping one back in its own cell restores the optimizer's fine offsets (see withPlacements).
 */
function removable(solution: MachineSpec, avoid: string[] = []): Part[] {
  const out: Part[] = [];
  for (const p of solution.parts) {
    if (p.kind === 'ball' || p.fixed || avoid.includes(p.id) || !isSupported(solution.parts, p, solution.terrain)) continue;
    const clean = dropAt(solution.parts, p, p.x, p.z, { y: p.y, terrain: solution.terrain });
    if (clean) out.push(clean);
  }
  return out.sort((a, b) => REMOVAL_ORDER.indexOf(a.kind) - REMOVAL_ORDER.indexOf(b.kind));
}

/**
 * Remove `count` parts (default 1) so the machine fails as late as possible: most of the chain
 * still plays, then it breaks where the part is missing. Only parts that stand on the floor or a
 * platform are taken, since that is where a hand-placed part can go back. Returns null when nothing
 * can be removed without the machine still working. Call after initPhysics().
 */
export function makePuzzle(solution: MachineSpec, count = 1, opts: { avoid?: string[] } = {}): Puzzle | null {
  if (fails(solution) !== null) return null;
  const candidates = removable(solution, opts.avoid);
  let spec = solution;
  const missing: Part[] = [];
  let failedAt = -1;
  for (let k = 0; k < count; k++) {
    let best: { part: Part; spec: MachineSpec; failedAt: number; score: number } | null = null;
    for (const part of candidates) {
      if (missing.includes(part)) continue;
      const trial: MachineSpec = { ...spec, parts: spec.parts.filter((p) => p.id !== part.id) };
      const at = fails(trial);
      if (at === null) continue;
      // Prefer failing late in the chain and, within that, a part the removal order likes.
      const score = at * 10 - REMOVAL_ORDER.indexOf(part.kind) * 0.1;
      if (!best || score > best.score) best = { part, spec: trial, failedAt: at, score };
    }
    if (!best) break;
    missing.push(best.part);
    spec = best.spec;
    failedAt = best.failedAt;
  }
  if (missing.length < count) return null;
  return { kind: count > 1 ? 'missing2' : 'missing', spec, missing, start: [], solution, failedAt };
}

/** Small deterministic generator, so the same machine and seed give the same puzzle. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shift one part to a nearby cell where the machine stops working, and hand the player that
 * part to move back. Nearby means 1 to 3 cells, so the machine looks almost right.
 */
export function makeMovedPuzzle(solution: MachineSpec, opts: { seed?: number; avoid?: string[] } = {}): Puzzle | null {
  if (fails(solution) !== null) return null;
  const random = rng(opts.seed ?? 1);
  const candidates = removable(solution, opts.avoid);
  let best: { puzzle: Puzzle; score: number } | null = null;
  for (const part of candidates) {
    const without: MachineSpec = { ...solution, parts: solution.parts.filter((p) => p.id !== part.id) };
    if (fails(without) === null) continue; // Not load-bearing: moving it changes nothing.
    const offsets: { dx: number; dz: number }[] = [];
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (dx || dz) offsets.push({ dx, dz });
    offsets.sort(() => random() - 0.5);
    for (const { dx, dz } of offsets.slice(0, 12)) {
      const moved = dropAt(without.parts, part, part.x + dx, part.z + dz, { terrain: solution.terrain });
      if (!moved) continue;
      const at = fails({ ...without, parts: [...without.parts, moved] });
      if (at === null) continue;
      // Late failure and a short move both make it sneakier.
      const score = at * 10 - (Math.abs(dx) + Math.abs(dz)) - REMOVAL_ORDER.indexOf(part.kind) * 0.1;
      if (!best || score > best.score) {
        best = { puzzle: { kind: 'moved', spec: without, missing: [part], start: [moved], solution, failedAt: at }, score };
      }
    }
    if (best && best.score >= 10) break; // Good enough: fails past the first step.
  }
  return best?.puzzle ?? null;
}

/**
 * The parts a connect puzzle leaves on the stage: the ball, the targets (bucket, bell, dominoes),
 * the scenery (fixed walls and ledges), the shelves the targets stand on, and the shelf under the
 * ball's column (the start is a place, not a point in the air). A part the ball only has to touch
 * on the way stays a checklist step, but the player places it.
 */
export function fixedParts(solution: MachineSpec): Set<string> {
  const fixed = targetParts(solution);
  for (const p of solution.parts) if (p.fixed) fixed.add(p.id);
  for (const id of [...fixed]) {
    const part = solution.parts.find((p) => p.id === id);
    if (!part) continue;
    for (const shelf of supportsOf(solution.parts, part)) fixed.add(shelf.id);
    if (part.kind === 'ball') {
      const under = solution.parts
        .filter((p) => p.kind === 'platform' && p.y < part.y && footprint(p).some((c) => c.x === part.x && c.z === part.z))
        .sort((a, b) => b.y - a.y)[0];
      if (under) fixed.add(under.id);
    }
  }
  return fixed;
}

/**
 * The ball and the targets (and what they stand on) stay; everything that connects them, free
 * shelves and touch-goal parts included, goes to the player. Any arrangement the physics accepts
 * counts, so the AI's layout is one solution among many.
 */
export function makeConnectPuzzle(solution: MachineSpec): Puzzle | null {
  if (fails(solution) !== null) return null;
  const fixed = fixedParts(solution);
  const loose = removable(solution).filter((p) => !fixed.has(p.id));
  if (!loose.length) return null;
  const ids = new Set(loose.map((p) => p.id));
  const spec: MachineSpec = { ...solution, parts: solution.parts.filter((p) => !ids.has(p.id)) };
  const failedAt = fails(spec);
  if (failedAt === null) return null; // Works without them: nothing to connect.
  // Hand the parts out in chain order, so the bin reads like a recipe, with a shelf ahead of whatever stands on it.
  const order = new Map(solution.parts.map((p, i) => [p.id, i]));
  loose.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  for (const shelf of loose.filter((p) => p.kind === 'platform')) {
    const first = loose.findIndex((p) => supportsOf(solution.parts, p).some((q) => q.id === shelf.id));
    const at = loose.indexOf(shelf);
    if (first >= 0 && first < at) {
      loose.splice(at, 1);
      loose.splice(first, 0, shelf);
    }
  }
  return { kind: 'connect', spec, missing: loose, start: [], solution, failedAt };
}

/** A puzzle of the given kind, or null when the machine cannot be broken that way. */
export function makePuzzleOfKind(solution: MachineSpec, kind: PuzzleKind, opts: { seed?: number } = {}): Puzzle | null {
  switch (kind) {
    case 'connect': return makeConnectPuzzle(solution);
    case 'missing': return makePuzzle(solution, 1);
    case 'missing2': return makePuzzle(solution, 2);
    case 'moved': return makeMovedPuzzle(solution, opts);
  }
}

/**
 * The puzzle with the player's placements added back in. A part dropped in the cell the solution
 * has it in, facing the same way, takes the solution's fine offsets (the optimizer's nudges), so
 * the AI's own layout always counts; anywhere else it sits in the middle of its cell.
 */
export function withPlacements(puzzle: Puzzle, placed: Part[]): MachineSpec {
  const parts = placed.map((p) => {
    const s = puzzle.solution.parts.find((q) => q.id === p.id);
    return s && s.x === p.x && s.y === p.y && s.z === p.z && s.yaw === p.yaw ? { ...p, dx: s.dx, dz: s.dz } : p;
  });
  return { ...puzzle.spec, parts: [...puzzle.spec.parts, ...parts] };
}
