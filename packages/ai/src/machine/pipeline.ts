import type { MachineResult, MachineSpec, MachineStreamEvent } from '@og/machine';
import type { Completion, LlmBackend } from '../llm/client';
import { SolverError } from '../solver';
import type { Validation } from '../llm/design';
import { designMachine, editMachineDesign, editMachineRequest, pickTwist, redesignMachine, sketchMachine, validateMachineDesign, validateMachineEdit, wantsFlat, type MachineDesign } from './design';
import type { Physics } from './physics';

export type MachineEvent = Extract<MachineStreamEvent, { type: 'machine' }>;
export type Emit = (event: MachineStreamEvent) => void;

export interface MachinePipelineDeps {
  llm: LlmBackend;
  physics: Physics;
  maxAttempts: number;
  /** Nudged variants per design. */
  budget: number;
  timeLimitMs: number;
  signal?: AbortSignal;
  deadline?: number;
}

interface Attempt {
  design: MachineDesign;
  spec: MachineSpec;
  result: MachineResult;
  moved: { id: string; cells: number }[];
  evals: number;
  events: Parameters<typeof redesignMachine>[1]['events'];
}

/**
 * Design -> run it -> nudge parts until it works -> redesign with the run's story when it
 * cannot, then return the best machine. Drafts stream out as soon as they exist.
 */
async function machineLoop(deps: MachinePipelineDeps, emit: Emit, loop: {
  firstStage: 'designing' | 'editing';
  firstMessage: string;
  design: (calls: Completion[], onProgress: (textSoFar: string) => void) => Promise<MachineDesign>;
  request: string;
  /** What every reply must satisfy, redesigns included (edits keep the ball and goal parts fixed). */
  validate?: (json: unknown) => Validation<MachineDesign>;
}): Promise<MachineEvent> {
  const { maxAttempts, signal } = deps;
  const calls: Completion[] = [];
  const notes: string[] = [];
  let best: (Attempt & { attempt: number }) | null = null;
  let last: Attempt | null = null;
  let attempts = 0;
  const outOfTime = () => deps.deadline !== undefined && Date.now() > deps.deadline;
  const sketcher = (attempt: number) => {
    let sent = -1;
    return (text: string) => {
      const sketch = sketchMachine(text);
      const drawn = sketch.parts.length + sketch.terrain.length;
      if (drawn === sent) return;
      sent = drawn;
      emit({ type: 'sketch', attempt, ...sketch });
    };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new SolverError('aborted');
    if (attempt > 1 && outOfTime()) {
      notes.push(`Stopped before design ${attempt}: out of time.`);
      break;
    }
    let design: MachineDesign;
    if (attempt === 1) {
      emit({ type: 'stage', stage: loop.firstStage, attempt, maxAttempts, message: loop.firstMessage });
      design = await loop.design(calls, sketcher(attempt));
    } else {
      const prev = last!;
      const failed = prev.result.steps.find((s) => !s.satisfied);
      emit({ type: 'stage', stage: 'redesigning', attempt, maxAttempts, message: `Not working yet (${failed?.note ?? 'goal missed'}). Asking for a fix.` });
      try {
        design = await redesignMachine(deps.llm, {
          request: loop.request, previous: prev.spec, result: prev.result, events: prev.events, evals: prev.evals,
        }, calls, sketcher(attempt), loop.validate);
      } catch (err) {
        if (signal?.aborted) throw err;
        notes.push(`Redesign ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    attempts = attempt;
    const spec = design.spec;
    emit({ type: 'draft', machine: spec, status: 'designed', attempt });

    emit({ type: 'stage', stage: 'verifying', attempt, maxAttempts, message: 'Running the machine.' });
    const first = await deps.physics.check(spec, { signal });
    let current: Attempt = { design, spec, result: first.result, moved: [], evals: 1, events: first.events };
    if (first.result.success) {
      notes.push(`Design ${attempt}: worked on the first run.`);
    } else {
      const goalLength = spec.goal.length;
      emit({ type: 'stage', stage: 'nudging', attempt, maxAttempts, message: `Almost: ${first.result.steps.find((s) => !s.satisfied)?.note ?? 'goal missed'}. Nudging parts.` });
      emit({ type: 'progress', attempt, evals: 1, bestScore: first.result.score, goalLength });
      const nudged = await deps.physics.nudge(spec, {
        budget: deps.budget, timeLimitMs: deps.timeLimitMs, seed: attempt, signal,
        onProgress: (p) => emit({ type: 'progress', attempt, evals: p.evals, bestScore: p.bestScore, goalLength }),
      });
      emit({ type: 'progress', attempt, evals: nudged.evals, bestScore: nudged.result.score, goalLength });
      current = { design, spec: nudged.spec, result: nudged.result, moved: nudged.moved, evals: nudged.evals, events: nudged.events };
      notes.push(nudged.solved
        ? `Design ${attempt}: works after nudging ${nudged.moved.length} part(s) (${nudged.evals} runs).`
        : `Design ${attempt}: still fails after ${nudged.evals} runs; ${nudged.result.steps.find((s) => !s.satisfied)?.note ?? 'goal missed'}.`);
    }
    last = current;
    if (!best || current.result.score > best.result.score) best = { ...current, attempt };
    if (current.result.success) {
      emit({ type: 'draft', machine: current.spec, status: 'solved', attempt, result: current.result });
      break;
    }
  }
  if (!best) throw new SolverError('no design to build a machine from');
  return {
    type: 'machine', machine: best.spec, solved: best.result.success, attempts, notes, cached: false,
    result: best.result, moved: best.moved, attempt: best.attempt,
  };
}

/** A result for a machine nobody has run. */
const UNRUN: MachineResult = { success: false, satisfiedCount: 0, score: 0, progress: 0, failedAt: null, steps: [] };

/**
 * Design only: the level comes back as the AI wrote it, with no run, no nudging and no redesign.
 * Puzzle play wants this: the player's build is the first thing the physics ever runs, so the
 * level has no answer sheet, only the AI's idea of one (the bin).
 */
async function designOnly(deps: MachinePipelineDeps, emit: Emit, loop: {
  firstStage: 'designing' | 'editing';
  firstMessage: string;
  design: (calls: Completion[], onProgress: (textSoFar: string) => void) => Promise<MachineDesign>;
}): Promise<MachineEvent> {
  const calls: Completion[] = [];
  let sent = -1;
  emit({ type: 'stage', stage: loop.firstStage, attempt: 1, maxAttempts: 1, message: loop.firstMessage });
  const design = await loop.design(calls, (text) => {
    const sketch = sketchMachine(text);
    const drawn = sketch.parts.length + sketch.terrain.length;
    if (drawn === sent) return;
    sent = drawn;
    emit({ type: 'sketch', attempt: 1, ...sketch });
  });
  emit({ type: 'draft', machine: design.spec, status: 'designed', attempt: 1 });
  return { type: 'machine', machine: design.spec, solved: false, verified: false, attempts: 1, notes: ['Level set up; nobody has run it.'], cached: false, result: UNRUN, moved: [], attempt: 1 };
}

export function generateMachine(deps: MachinePipelineDeps, prompt: string, emit: Emit, opts: { verify?: boolean } = {}): Promise<MachineEvent> {
  const twist = pickTwist(prompt);
  const loop = {
    firstStage: 'designing' as const,
    firstMessage: 'Designing a level for your idea.',
    design: (calls: Completion[], onProgress: (textSoFar: string) => void) => designMachine(deps.llm, prompt, calls, onProgress, { twist }),
    request: `Design a machine for this request:\n\n${prompt}`,
    validate: (json: unknown) => validateMachineDesign(json, { flat: wantsFlat(prompt) }),
  };
  return opts.verify === false ? designOnly(deps, emit, loop) : machineLoop(deps, emit, loop);
}

export function editMachine(deps: MachinePipelineDeps, machine: MachineSpec, instruction: string, emit: Emit, opts: { verify?: boolean } = {}): Promise<MachineEvent> {
  const loop = {
    firstStage: 'editing' as const,
    firstMessage: `Applying your change: ${instruction}`,
    design: (calls: Completion[], onProgress: (textSoFar: string) => void) => editMachineDesign(deps.llm, machine, instruction, calls, onProgress),
    request: editMachineRequest(machine, instruction),
    validate: validateMachineEdit(machine),
  };
  return opts.verify === false ? designOnly(deps, emit, loop) : machineLoop(deps, emit, loop);
}
