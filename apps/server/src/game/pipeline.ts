import { randomBytes } from 'node:crypto';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import {
  Level, applyTunables, checkShot, controlValues, levelFromSpec,
  type LevelStage, type LevelStreamEvent, type OptimizeResult,
} from '@og/shared';
import type { Completion, LlmBackend } from '../llm/client';
import { designLevel, editLevelDesign, editRequest, redesignLevel, type LevelDesign } from '../llm/level';
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
}

interface Attempt {
  design: LevelDesign;
  tuned: OptimizeResult;
}

const progressOf = (r: OptimizeResult) => (r.solved ? Infinity : r.result.progress);

export const newLevelId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;

interface LoopSpec {
  firstStage: LevelStage;
  firstMessage: string;
  design: (calls: Completion[]) => Promise<LevelDesign>;
  /** Request text given to redesigns. */
  request: string;
  keep?: { player: string; paths: string[] };
  level: { id: string; par?: number; briefing?: string; tip?: string; player?: string };
}

/** Design -> verify with the optimizer -> redesign on a miss, then build the playable level. */
async function repairLoop(deps: PipelineDeps, emit: Emit, loop: LoopSpec): Promise<LevelEvent> {
  const { maxAttempts, signal } = deps;
  const calls: Completion[] = [];
  const notes: string[] = [];
  let best: Attempt | null = null;
  let last: Attempt | null = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new SolverError('aborted');
    let design: LevelDesign;
    if (attempt === 1) {
      emit({ type: 'stage', stage: loop.firstStage, attempt, maxAttempts, message: loop.firstMessage });
      design = await loop.design(calls);
    } else {
      const prev = last!;
      emit({
        type: 'stage', stage: 'redesigning', attempt, maxAttempts,
        message: `No solution found (best ${prev.tuned.result.satisfiedCount}/${prev.tuned.spec.goal.length} steps). Asking for a new design.`,
      });
      try {
        design = await redesignLevel(deps.llm, {
          request: loop.request,
          previous: prev.tuned.spec,
          goalNotes: prev.tuned.result.events.map((e) => e.note),
          bestScore: prev.tuned.result.score,
          evals: prev.tuned.evals,
          keep: loop.keep,
        }, calls);
      } catch (err) {
        if (signal?.aborted) throw err;
        notes.push(`Redesign ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    attempts = attempt;
    notes.push(...design.notes.map((n) => `Design ${attempt}: ${n}`));

    emit({
      type: 'stage', stage: 'verifying', attempt, maxAttempts,
      message: `Searching ${design.spec.tunables.length} launch settings for a shot that clears the goal.`,
    });
    const goalLength = design.spec.goal.length;
    emit({ type: 'progress', attempt, evals: 0, bestScore: 0, goalLength });
    const tuned = await deps.solver.optimize(design.spec, {
      budget: deps.budget,
      timeLimitMs: deps.timeLimitMs,
      seed: attempt,
      signal,
      onProgress: (p) => emit({ type: 'progress', attempt, evals: p.evals, bestScore: p.bestScore, goalLength }),
    });
    emit({ type: 'progress', attempt, evals: tuned.evals, bestScore: tuned.result.score, goalLength });
    notes.push(tuned.solved
      ? `Design ${attempt}: solved after ${tuned.evals} simulated shots.`
      : `Design ${attempt}: unsolved after ${tuned.evals} shots; ${tuned.result.events.find((e) => !e.satisfied)?.note ?? 'goal missed'}.`);

    last = { design, tuned };
    if (!best || progressOf(tuned) > progressOf(best.tuned)) best = last;
    if (tuned.solved) break;
  }

  if (!best) throw new SolverError('no design to build a level from');
  const level = await buildLevel(best, loop.level);
  return { type: 'level', level, solved: !!level.solution, attempts, notes, cached: false };
}

/** Level from the best attempt: solution = tuned values, starting sliders = a sensible miss. */
export async function buildLevel(best: Attempt, meta: LoopSpec['level']): Promise<Level> {
  const { design, tuned } = best;
  const base = levelFromSpec(tuned.spec, {
    id: meta.id,
    briefing: meta.briefing ?? design.briefing,
    player: meta.player ?? design.player,
    par: meta.par,
  });
  const solution = controlValues(base);
  const check = async (level: Level, values: number[]) => {
    await yieldToLoop();
    return checkShot(level, values).goal;
  };
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
    design: (calls) => designLevel(deps.llm, prompt, calls),
    request: `Design a level for this description:\n\n${prompt}`,
    level: { id: newLevelId('ai') },
  });
}

export function editLevel(deps: PipelineDeps, level: Level, instruction: string, emit: Emit): Promise<LevelEvent> {
  const keep = { player: level.player, paths: level.controls.map((c) => c.path) };
  return repairLoop(deps, emit, {
    firstStage: 'editing',
    firstMessage: `Applying your change: ${instruction}`,
    design: (calls) => editLevelDesign(deps.llm, level, instruction, calls),
    request: editRequest(level, instruction),
    keep,
    level: { id: newLevelId('edit'), par: level.par, player: level.player },
  });
}
