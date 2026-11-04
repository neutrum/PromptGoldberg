/**
 * Solving a level with the player's own kit, by physics alone: no AI call. A beam search places
 * one hand part at a time where the ball actually goes (the cells it rolls or flies through, in all
 * four facings), keeps the few placements that bring it closest to the goal, and goes on from those
 * until the goal happens or the time is up. What it finds, a player can build: the same hand, the
 * same free cells, the same run.
 *
 * The runs themselves go through a runner: in this thread here, or spread over worker threads by
 * the server (each step's candidates are independent runs).
 */
import { evaluateMachine, type MachineResult } from './goal';
import { footprint } from './kit';
import { dropAt, onPosts } from './placement';
import { handOf, withPlacements, type Puzzle } from './puzzle';
import { CELL, GRID, inStage, stageOf, type MachineSpec, type Part, type Yaw } from './schema';
import { simulateSync, type MachineRun } from './sim';

export type Point = [number, number, number];

/** A build's run, scored: goal steps done, then how near the ball came to the last goal part. */
export interface Scored { value: number; success: boolean }
/** A build's full run: its score, the goal check and where the ball went. */
export interface Traced extends Scored { result: MachineResult; path: Point[] }

/** Runs builds of one level (each build is the hand parts placed). */
export interface KitRunner {
  /** Searching: each build's run, stopped early once the ball is gone or everything rests. */
  score(builds: Part[][]): Promise<Scored[]>;
  /** The full run the player would see. */
  trace(build: Part[]): Promise<Traced>;
}

export interface KitSolveOptions {
  /** Time to search in ms (default 20 000). */
  budgetMs?: number;
  /** Placements kept per step (default 3). */
  beam?: number;
  /** Candidate placements tried per kept state (default 160). */
  tries?: number;
  /** Where the runs happen (default: this thread). */
  runner?: KitRunner;
}

export interface KitSolve {
  solved: boolean;
  /** The hand parts placed, best attempt when not solved. */
  placed: Part[];
  result: MachineResult;
  sims: number;
  ms: number;
}

const YAWS: Yaw[] = [0, 90, 180, 270];

function scoreOf(goal: MachineSpec['goal'], run: MachineRun): Scored & { result: MachineResult } {
  const result = evaluateMachine(goal, run);
  const target = goal.at(-1)?.part;
  const d = (target ? run.closest[target]?.d : undefined) ?? Infinity;
  const far = Math.hypot(GRID.x, GRID.y, GRID.z) * CELL;
  return { value: result.score + 0.5 * Math.max(0, 1 - d / far), success: result.success, result };
}

/** Where the ball goes in a recorded run: one point per few frames, until it leaves the stage. */
function pathOf(run: MachineRun): Point[] {
  const ball = run.spec.parts.find((p) => p.kind === 'ball');
  const k = ball ? run.dynamicIds.indexOf(ball.id) : -1;
  if (k < 0) return [];
  const out: Point[] = [];
  for (let f = 0; f < run.frameCount; f += 3) {
    const o = f * run.frameStride + 1 + 7 * k;
    const p: Point = [run.frames[o], run.frames[o + 1], run.frames[o + 2]];
    if (p[1] < -CELL) break;
    out.push(p);
  }
  return out;
}

/** The runs in this thread. */
export function localKitRunner(puzzle: Puzzle): KitRunner {
  const goal = puzzle.spec.goal;
  return {
    score: async (builds) => builds.map((b) => {
      const { value, success } = scoreOf(goal, simulateSync(withPlacements(puzzle, b), { record: false, stopEarly: true }));
      return { value, success };
    }),
    trace: async (build) => {
      const run = simulateSync(withPlacements(puzzle, build), { record: true });
      return { ...scoreOf(goal, run), path: pathOf(run) };
    },
  };
}

/** Hand parts not yet placed, one of each kind (and workbench label): the rest are the same move. */
function unused(hand: Part[], placed: Part[]): Part[] {
  const seen = new Set<string>();
  return hand.filter((h) => {
    if (placed.some((p) => p.id === h.id)) return false;
    const sig = `${h.kind}:${h.label ?? ''}:${h.length ?? ''}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

/** Placements of the unused hand parts along the ball's path, at most `tries`, spread evenly. */
function candidates(puzzle: Puzzle, placed: Part[], path: Point[], hand: Part[], tries: number): Part[] {
  const spec = withPlacements(puzzle, placed);
  const stage = stageOf(spec);
  const free = unused(hand, placed);
  const put = (out: Map<string, Part>, part: Part, x: number, z: number, yaw: Yaw, y: number | undefined, top: number) => {
    if (!inStage(stage, x, z)) return;
    const p = dropAt(spec.parts, { ...part, yaw }, x, z, { y: y === undefined ? undefined : Math.max(0, y), terrain: spec.terrain });
    if (!p || p.y > top || top - p.y > 2) return;
    if (!footprint(p).every((c) => inStage(stage, c.x, c.z))) return;
    out.set(`${p.kind}:${p.label ?? ''}:${p.x},${p.y},${p.z},${p.yaw}`, p);
  };
  const along = new Map<string, Part>();
  for (let i = 0; i < path.length; i++) {
    const [px, py, pz] = path[i];
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL), cy = Math.floor(py / CELL);
    // The cell it is in, and the next one in its direction of travel.
    const next = path[Math.min(path.length - 1, i + 2)];
    for (const [x, z] of [[cx, cz], [Math.floor(next[0] / CELL), Math.floor(next[2] / CELL)]]) {
      for (const part of free) for (const yaw of YAWS) for (const y of onPosts(part.kind) ? [cy - 1, cy] : [undefined]) put(along, part, x, z, yaw, y, cy);
    }
  }
  const all = [...along.values()];
  return all.length <= tries ? all : Array.from({ length: tries }, (_, i) => all[Math.floor((i * all.length) / tries)]);
}

interface State extends Traced { placed: Part[] }

/** Look for a build from the player's hand that reaches the goal. */
export async function solveWithKit(puzzle: Puzzle, opts: KitSolveOptions = {}): Promise<KitSolve> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 20_000);
  const beam = opts.beam ?? 3, tries = opts.tries ?? 160;
  const runner = opts.runner ?? localKitRunner(puzzle);
  const hand = handOf(puzzle);
  let sims = 1;
  const done = (s: State): KitSolve => ({ solved: s.success, placed: s.placed, result: s.result, sims, ms: Date.now() - started });
  let best: State = { placed: [], ...(await runner.trace([])) };
  if (best.success) return done(best);
  let states: State[] = [best];
  for (let depth = 0; depth < hand.length && states.length && Date.now() < deadline; depth++) {
    const builds = states.flatMap((s) => candidates(puzzle, s.placed, s.path, hand, tries)
      .map((part) => [...s.placed.filter((p) => p.id !== part.id), part]));
    // In batches, so the time limit holds while the runs are spread over threads.
    const scored: (Scored & { placed: Part[] })[] = [];
    for (let i = 0; i < builds.length && Date.now() < deadline; i += 96) {
      const batch = builds.slice(i, i + 96);
      const res = await runner.score(batch);
      sims += batch.length;
      res.forEach((r, k) => scored.push({ ...r, placed: batch[k] }));
      // The search's runs stop early: a success is confirmed with the full run the player will see.
      for (const hit of res.map((r, k) => (r.success ? batch[k] : null)).filter((b): b is Part[] => !!b)) {
        const full = await runner.trace(hit);
        sims++;
        if (full.success) return done({ placed: hit, ...full });
      }
    }
    const seen = new Set<string>();
    const kept = scored
      .sort((a, b) => b.value - a.value)
      .filter((c) => { const k = c.placed.map((p) => `${p.kind}${p.x},${p.y},${p.z},${p.yaw}`).sort().join('|'); return !seen.has(k) && !!seen.add(k); })
      .slice(0, beam);
    states = await Promise.all(kept.map(async (c) => ({ placed: c.placed, ...(await runner.trace(c.placed)) })));
    sims += states.length;
    if (states[0] && states[0].value > best.value) best = states[0];
  }
  return done(best);
}
