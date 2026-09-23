import { randomBytes } from 'node:crypto';
import {
  Level, applyTunables, controlValues, levelFromSpec,
  type GoalResult, type LevelStage, type LevelStreamEvent, type OptimizeResult,
} from '@og/shared';
import type { Completion, LlmBackend } from './llm/client';
import { designLevel, editLevelDesign, editRequest, redesignLevel, type LevelDesign } from './llm/level';
import { makeForgiving, MIN_ROBUSTNESS } from './forgiving';
import { sketchFrom } from './llm/sketch';
import { SolverError, type Solver } from './solver';
import { chooseStartValues, roundForControl, valuesFromSpec } from './startValues';

export type LevelEvent = Extract<LevelStreamEvent, { type: 'level' }>;
export type Emit = (event: LevelStreamEvent) => void;

export interface PipelineDeps {
  llm: LlmBackend;
  solver: Solver;
  maxAttempts: number;
  budget: number;
  timeLimitMs: number;
  signal?: AbortSignal;
  /** Epoch ms after which no new redesign starts and loosening stops early. */
  deadline?: number;
}

interface Attempt {
  design: LevelDesign;
  tuned: OptimizeResult;
}

const progressOf = (r: OptimizeResult) => (r.solved ? Infinity : r.result.progress);

const TOO_SLOW_NOTE = 'the system was too slow to simulate (very tight or fast orbits, or a long run): use wider orbits, fewer close encounters and a shorter sim.duration';

/** Goal result for a shot that could not be simulated in time: a plain miss. */
function tooSlow(goalLength: number): GoalResult {
  return {
    success: false, satisfiedCount: 0, score: 0, progress: 0, failedAt: 0,
    events: Array.from({ length: goalLength }, (_, index) => ({ index, satisfied: false, partial: 0, note: TOO_SLOW_NOTE })),
  };
}

/** Runs one shot in the solver (worker, with a timeout); a shot too slow to simulate counts as a miss. */
function shotChecker(solver: Solver, signal?: AbortSignal) {
  return async (level: Level, values: number[]): Promise<GoalResult> => {
    try {
      return await solver.check(level, values, [], { timeoutMs: 10_000, signal });
    } catch (err) {
      if (signal?.aborted || !(err instanceof SolverError)) throw err;
      return tooSlow(level.spec.goal.length);
    }
  };
}

export const newLevelId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;

interface LoopSpec {
  firstStage: LevelStage;
  firstMessage: string;
  design: (calls: Completion[], onProgress: (textSoFar: string) => void) => Promise<LevelDesign>;
  /** Request text given to redesigns. */
  request: string;
  keep?: { player: string; paths: string[] };
  level: { id: string; par?: number; briefing?: string; tip?: string; player?: string };
}

/** A solved attempt turned into a level, with how forgiving it is. */
interface Built {
  level: Level;
  robustness: number;
  missNotes: string[];
}

/**
 * Design -> verify with the optimizer -> redesign on a miss or when the only winning shots are
 * knife-edge, then return the best playable level.
 */
async function repairLoop(deps: PipelineDeps, emit: Emit, loop: LoopSpec): Promise<LevelEvent> {
  const { maxAttempts, signal } = deps;
  const calls: Completion[] = [];
  const notes: string[] = [];
  let best: Attempt | null = null;
  let last: Attempt | null = null;
  let lastBuilt: Built | null = null;
  let bestBuilt: (Built & { attempt: number }) | null = null;
  let attempts = 0;
  let bestAttempt = 1;
  let fallback: Level | null = null;
  const check = (level: Level, shots: number[][]) => deps.solver.checkMany(level, shots, { signal });
  /** Sends the bodies written so far whenever another one is complete. */
  const sketcher = (attempt: number) => {
    let sent = -1;
    let title: string | undefined;
    return (text: string) => {
      const sketch = sketchFrom(text);
      if (sketch.bodies.length === sent && sketch.title === title) return;
      sent = sketch.bodies.length;
      title = sketch.title;
      emit({ type: 'sketch', attempt, ...sketch });
    };
  };

  const outOfTime = () => deps.deadline !== undefined && Date.now() > deps.deadline;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new SolverError('aborted');
    if (attempt > 1 && outOfTime()) {
      notes.push(`Stopped before design ${attempt}: out of time.`);
      break;
    }
    let design: LevelDesign;
    if (attempt === 1) {
      emit({ type: 'stage', stage: loop.firstStage, attempt, maxAttempts, message: loop.firstMessage });
      design = await loop.design(calls, sketcher(attempt));
    } else {
      const prev = last!;
      const fragile = prev.tuned.solved && lastBuilt ? lastBuilt : null;
      emit({
        type: 'stage', stage: 'redesigning', attempt, maxAttempts,
        message: fragile
          ? `Solvable, but only just (${Math.round(100 * fragile.robustness)}% of near misses still win). Asking for a more forgiving design.`
          : `No solution found (best ${prev.tuned.result.satisfiedCount}/${prev.tuned.spec.goal.length} steps). Asking for a new design.`,
      });
      try {
        design = await redesignLevel(deps.llm, {
          request: loop.request,
          previous: prev.tuned.spec,
          goalNotes: fragile ? fragile.missNotes : prev.tuned.result.events.map((e) => e.note),
          bestScore: prev.tuned.result.score,
          evals: prev.tuned.evals,
          keep: loop.keep,
          fragile: fragile ? { robustness: fragile.robustness } : undefined,
        }, calls, sketcher(attempt));
      } catch (err) {
        if (signal?.aborted) throw err;
        notes.push(`Redesign ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    attempts = attempt;
    notes.push(...design.notes.map((n) => `Design ${attempt}: ${n}`));
    // Playable right away; the proof follows. (Build puzzles emit their own draft below.)
    if (!design.pieces) emit({ type: 'draft', level: draftLevel(design, loop.level), status: 'designed', attempt });

    if (design.pieces) {
      // Build puzzle: the shot is fixed and the player drops parts in, so search placements.
      emit({ type: 'stage', stage: 'verifying', attempt, maxAttempts, message: `Trying placements of the ${design.pieces.kinds.join(' and ')} the player will get.` });
      emit({ type: 'draft', level: withBin(draftLevel(design, loop.level), design), status: 'designed', attempt });
      const { built, note } = await verifyBuild(deps, design, loop.level, attempt);
      notes.push(note);
      // Even an unproven build puzzle is playable, so keep the latest as a fallback.
      fallback = withBin(draftLevel(design, loop.level), design);
      last = { design, tuned: { spec: design.spec, values: [], result: tooSlow(design.spec.goal.length), evals: 0, solved: !!built } };
      lastBuilt = built;
      if (built) {
        emit({ type: 'draft', level: built.level, status: 'solved', attempt });
        if (!bestBuilt || built.robustness > bestBuilt.robustness) bestBuilt = { ...built, attempt };
        if (built.robustness >= MIN_ROBUSTNESS) break;
      }
      continue;
    }

    emit({
      type: 'stage', stage: 'verifying', attempt, maxAttempts,
      message: `Searching ${design.spec.tunables.length} launch settings for a shot that clears the goal.`,
    });
    const goalLength = design.spec.goal.length;
    emit({ type: 'progress', attempt, evals: 0, bestScore: 0, goalLength });
    let tuned: OptimizeResult;
    try {
      tuned = await deps.solver.optimize(design.spec, {
        budget: deps.budget,
        timeLimitMs: deps.timeLimitMs,
        seed: attempt,
        signal,
        onProgress: (p) => emit({ type: 'progress', attempt, evals: p.evals, bestScore: p.bestScore, goalLength }),
      });
    } catch (err) {
      // A design whose shots take too long to simulate is redesigned, not a failed request.
      if (signal?.aborted || !(err instanceof SolverError)) throw err;
      tuned = { spec: design.spec, values: [], result: tooSlow(goalLength), evals: 0, solved: false };
    }
    emit({ type: 'progress', attempt, evals: tuned.evals, bestScore: tuned.result.score, goalLength });
    notes.push(tuned.solved
      ? `Design ${attempt}: solved after ${tuned.evals} simulated shots.`
      : `Design ${attempt}: unsolved after ${tuned.evals} shots; ${tuned.result.events.find((e) => !e.satisfied)?.note ?? 'goal missed'}.`);

    last = { design, tuned };
    lastBuilt = null;
    if (!best || progressOf(tuned) > progressOf(best.tuned)) {
      best = last;
      bestAttempt = attempt;
    }
    if (!tuned.solved) continue;

    // A proven shot is not enough: players need some slack around it.
    const level = await buildLevel(last, loop.level, shotChecker(deps.solver, signal));
    if (!level.solution) continue;
    emit({ type: 'draft', level, status: 'solved', attempt });
    const forgiving = await makeForgiving(level, check, deps.deadline);
    notes.push(`Design ${attempt}: ${forgiving.note}`);
    lastBuilt = { level: forgiving.level, robustness: forgiving.robustness, missNotes: forgiving.missNotes };
    if (!bestBuilt || lastBuilt.robustness > bestBuilt.robustness) bestBuilt = { ...lastBuilt, attempt };
    if (lastBuilt.robustness >= MIN_ROBUSTNESS) break;
  }

  if (bestBuilt) return { type: 'level', level: bestBuilt.level, solved: true, attempts, notes, cached: false, attempt: bestBuilt.attempt };
  if (!best) {
    if (fallback) return { type: 'level', level: fallback, solved: false, attempts, notes, cached: false, attempt: attempts };
    throw new SolverError('no design to build a level from');
  }
  const level = await buildLevel(best, loop.level, shotChecker(deps.solver, signal));
  return { type: 'level', level, solved: !!level.solution, attempts, notes, cached: false, attempt: bestAttempt };
}

/** A build puzzle's level: fixed shot, plus the bin of parts the player may drop in. */
function withBin(level: Level, design: LevelDesign): Level {
  return Level.parse({ ...level, controls: [], pieces: design.pieces });
}

/**
 * Verify a build puzzle: the bare shot must miss, then search placements of the player's parts
 * for one that wins and still wins when the drop is a little off.
 */
async function verifyBuild(deps: PipelineDeps, design: LevelDesign, meta: LoopSpec['level'], attempt: number): Promise<{ built: Built | null; note: string }> {
  const level = withBin(draftLevel(design, meta), design);
  const bare = await deps.solver.check(level, [], [], { signal: deps.signal });
  if (bare.success) {
    return { built: null, note: `Design ${attempt}: the fixed shot already wins with no parts placed; the puzzle needs a shot that misses.` };
  }
  const found = await deps.solver.searchPieces(level, [], design.pieces!.max, { seed: attempt, signal: deps.signal });
  if (!found.success) {
    const miss = bare.events.find((e) => !e.satisfied)?.note ?? 'goal missed';
    return { built: null, note: `Design ${attempt}: no placement of the parts wins after ${found.evals} tries; ${miss}.` };
  }
  const solved = Level.parse({ ...level, solution: { values: [], pieces: found.pieces } });
  const pct = Math.round(100 * found.robustness);
  return {
    built: {
      level: solved,
      robustness: found.robustness,
      missNotes: [`only ${pct}% of slightly off drops still win`],
    },
    note: `Design ${attempt}: solved by placing ${found.pieces.length} part(s) after ${found.evals} tries; ${pct}% of slightly off drops still win.`,
  };
}

/** The design as a playable level before any proof: the AI's own slider guesses, no solution. */
function draftLevel(design: LevelDesign, meta: LoopSpec['level']): Level {
  const level = levelFromSpec(design.spec, {
    id: meta.id,
    briefing: meta.briefing ?? design.briefing,
    player: meta.player ?? design.player,
    par: meta.par,
  });
  return Level.parse({ ...level, tip: meta.tip ?? design.tip });
}

/** Level from the best attempt: solution = tuned values, starting sliders = a sensible miss. */
export async function buildLevel(best: Attempt, meta: LoopSpec['level'], check: (level: Level, values: number[]) => Promise<GoalResult>): Promise<Level> {
  const { design, tuned } = best;
  const base = levelFromSpec(tuned.spec, {
    id: meta.id,
    briefing: meta.briefing ?? design.briefing,
    player: meta.player ?? design.player,
    par: meta.par,
  });
  const solution = controlValues(base);
  const solved = tuned.solved && (await check(base, solution)).success;
  const guess = valuesFromSpec(design.spec, base.controls);

  const start = solved
    ? (await chooseStartValues(base, solution, guess, check)).values
    : (guess ?? solution).map((v, i) => roundForControl(base.controls[i], v));
  const tunables = base.controls.map((c) => ({ path: c.path, min: c.min, max: c.max }));
  const spec = { ...applyTunables(base.spec, tunables, start), tunables: [] };

  return Level.parse({
    ...base,
    spec,
    tip: meta.tip ?? design.tip,
    solution: solved ? { values: solution, pieces: [] } : undefined,
  });
}

export function generateLevel(deps: PipelineDeps, prompt: string, emit: Emit): Promise<LevelEvent> {
  return repairLoop(deps, emit, {
    firstStage: 'designing',
    firstMessage: 'Designing a star system for your idea.',
    design: (calls, onProgress) => designLevel(deps.llm, prompt, calls, onProgress),
    request: `Design a level for this description:\n\n${prompt}`,
    level: { id: newLevelId('ai') },
  });
}

export function editLevel(deps: PipelineDeps, level: Level, instruction: string, emit: Emit): Promise<LevelEvent> {
  const keep = { player: level.player, paths: level.controls.map((c) => c.path) };
  return repairLoop(deps, emit, {
    firstStage: 'editing',
    firstMessage: `Applying your change: ${instruction}`,
    design: (calls, onProgress) => editLevelDesign(deps.llm, level, instruction, calls, onProgress),
    request: editRequest(level, instruction),
    keep,
    level: { id: newLevelId('edit'), par: level.par, player: level.player },
  });
}
