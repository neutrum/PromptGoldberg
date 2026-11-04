/**
 * Puzzles: the level keeps the ball, the goal parts, the scenery and the shelves they stand on
 * where they are, and hands the player everything else (ramps, fans, cannons, free shelves...) to
 * build the route with. Any arrangement the physics accepts counts.
 */
import { evaluateMachine } from './goal';
import { footprint } from './kit';
import { targetParts } from './names';
import { dropAt, isSupported, supportsOf } from './placement';
import { isGadget } from './landscape';
import type { MachineSpec, Part, PartKind, Spare } from './schema';
import { simulateSync } from './sim';

export interface Puzzle {
  /** The machine with the puzzle parts removed. Runs, but fails. */
  spec: MachineSpec;
  /** The parts the player gets back, at their original height and facing; the player picks where. */
  missing: Part[];
  /** The complete machine. */
  solution: MachineSpec;
  /** Which goal step the broken machine fails at (-1 when nobody ran it). */
  failedAt: number;
  /** False when the solution is the AI's unproven idea: the player's build is the first run. */
  verified?: boolean;
  /** Extra parts in the hand that the solution does not use. */
  spares?: Part[];
}

/** Everything in the player's hand: the parts of the route, then the spares. */
export function handOf(puzzle: Puzzle): Part[] {
  return [...puzzle.missing, ...(puzzle.spares ?? [])];
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
  // Only the finish counts: "reach the fan" would give the route away and rule out every other build.
  const goal = solution.goal.filter((g) => !(g.type === 'touch' && ids.has(g.part)));
  const spec: MachineSpec = { ...solution, goal, parts: solution.parts.filter((p) => !ids.has(p.id)), spares: undefined };
  const failedAt = fails(spec);
  if (failedAt === null) return null; // Works without them: nothing to connect.
  return { spec, missing: chainOrder(solution, loose), solution: { ...solution, goal, spares: undefined }, failedAt, spares: sparesOf(solution) };
}

/** The designer's spares as hand parts (the player picks where); a workbench part keeps its name and shapes. */
function sparesOf(level: MachineSpec): Part[] {
  return (level.spares ?? []).map((s, i) => partOfSpare(s, `spare${i + 1}`));
}

/** A spare as a part in the hand, not placed yet. */
export function partOfSpare(s: Spare, id: string): Part {
  return { id, kind: s.build ? 'wall' : s.kind, x: 0, y: 0, z: 0, yaw: 0, length: s.length, ...(s.build ? { prop: 'landmark', build: s.build, label: s.label, ...(s.model ? { model: s.model } : {}), ...(s.library ? { library: s.library } : {}) } : {}) };
}

/** A hand part as a spare, the way it travels with a shared or published level. */
export function spareOf(p: Part): Spare {
  return { kind: p.kind as Spare['kind'], ...(p.length ? { length: p.length } : {}), ...(isGadget(p) ? { label: p.label, build: p.build, ...(p.model ? { model: p.model } : {}), ...(p.library ? { library: p.library } : {}) } : {}) };
}

/** The parts of a design's route that a connect puzzle would hand out (no physics: layout only). */
export function routeParts(level: MachineSpec): Part[] {
  const fixed = fixedParts(level);
  return removable(level).filter((p) => !fixed.has(p.id));
}

/** Parts in chain order, so the bin reads like a recipe, with a shelf ahead of whatever stands on it. */
function chainOrder(solution: MachineSpec, loose: Part[]): Part[] {
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
  return loose;
}

/**
 * A level the AI only set up: the stage (ball, targets, scenery, ground) stays, the parts of the
 * AI's route and its spares go to the player, and nobody has run anything. No physics here: the
 * player's first run is the first run. Null when there is nothing to hand out.
 */
export function makeLevelPuzzle(level: MachineSpec): Puzzle | null {
  const fixed = fixedParts(level);
  // A level laid out with no solution (it has a par instead) keeps everything on the board, start ramp included: its tray is all it hands over.
  const loose = level.par ? [] : removable(level).filter((p) => !fixed.has(p.id));
  if (!loose.length && !level.spares?.length) return null;
  const ids = new Set(loose.map((p) => p.id));
  const goal = level.goal.filter((g) => !(g.type === 'touch' && ids.has(g.part)));
  const spec: MachineSpec = { ...level, goal, parts: level.parts.filter((p) => !ids.has(p.id)), spares: undefined };
  const spares = sparesOf(level);
  return { spec, missing: chainOrder(level, loose), solution: { ...level, goal, spares: undefined }, failedAt: -1, verified: false, spares };
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
  // In the solution's order: the physics is sensitive to the order bodies are added, so a build
  // that puts every part back is exactly the machine that was verified.
  const order = new Map(puzzle.solution.parts.map((p, i) => [p.id, i]));
  const all = [...puzzle.spec.parts, ...parts];
  return { ...puzzle.spec, parts: all.map((p, i) => ({ p, k: order.get(p.id) ?? puzzle.solution.parts.length + i })).sort((a, b) => a.k - b.k).map((e) => e.p) };
}
