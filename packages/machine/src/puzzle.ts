/**
 * Fix-it puzzles: take a machine that works and break it for the player to repair.
 * The proven machine is the solution, so a puzzle is always solvable and a hint is free.
 *
 * Kinds: 'connect' keeps the ball, the shelves and the goal parts where they are and hands the
 * player every connecting part (ramps, fans, cannons...) to build the chain with; 'missing' pulls
 * one part out, 'missing2' pulls two, 'moved' leaves every part in but shifts one to a nearby
 * wrong cell, so the player has to spot which one.
 */
import { evaluateMachine } from './goal';
import { dropAt, isSupported } from './placement';
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
 * Hand-placeable parts of a working machine, best to remove first. A hand-placed part sits in the
 * middle of its cell, so a part the optimizer nudged off-centre only counts when the machine still
 * works with it centred; the centred version is what the player gets back.
 */
function removable(solution: MachineSpec, avoid: string[] = []): Part[] {
  const out: Part[] = [];
  for (const p of solution.parts) {
    if (p.kind === 'ball' || avoid.includes(p.id) || !isSupported(solution.parts, p)) continue;
    const clean = dropAt(solution.parts, p, p.x, p.z);
    if (!clean) continue;
    if ((p.dx || p.dz) && fails({ ...solution, parts: solution.parts.map((q) => (q.id === p.id ? clean : q)) }) !== null) continue;
    out.push(clean);
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
      const moved = dropAt(without.parts, part, part.x + dx, part.z + dz);
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
 * The goal parts and the shelves stay; everything that connects them goes to the player. Any
 * arrangement the physics accepts counts, so the AI's layout is one solution among many.
 */
export function makeConnectPuzzle(solution: MachineSpec): Puzzle | null {
  if (fails(solution) !== null) return null;
  const goalIds = new Set(solution.goal.map((g) => g.part));
  const loose = removable(solution).filter((p) => p.kind !== 'platform' && !goalIds.has(p.id));
  if (!loose.length) return null;
  const ids = new Set(loose.map((p) => p.id));
  const spec: MachineSpec = { ...solution, parts: solution.parts.filter((p) => !ids.has(p.id)) };
  const failedAt = fails(spec);
  if (failedAt === null) return null; // Works without them: nothing to connect.
  // Hand the parts out in chain order, so the bin reads like a recipe.
  const order = new Map(solution.parts.map((p, i) => [p.id, i]));
  loose.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
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

/** The puzzle with the player's placements added back in. */
export function withPlacements(puzzle: Puzzle, placed: Part[]): MachineSpec {
  return { ...puzzle.spec, parts: [...puzzle.spec.parts, ...placed] };
}
