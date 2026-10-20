import type { MachineResult, MachineSpec, MachineStreamEvent } from '@og/machine';
import type { Completion, LlmBackend } from '../llm/client';
import { SolverError } from '../solver';
import type { Validation } from '../llm/design';
import { designMachine, difficultyOf, editMachineDesign, editMachineRequest, pickTwist, redesignMachine, sketchMachine, validateMachineDesign, validateMachineEdit, wantsFlat, type MachineDesign } from './design';
import type { Physics } from './physics';
import { designRoute, routable, routeFromWords } from './route';
import { editByOps } from './editOps';
import type { RouteGraph, RouteGraphInput } from '@og/machine';

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

/** Route graphs are on unless MACHINE_ROUTE=off. */
const routeOn = () => process.env.MACHINE_ROUTE !== 'off';

/**
 * The fast path: a route graph from the AI (or from the mission's words), laid out by the compiler
 * in the physics pool. The level that comes back has been run end to end.
 */
async function routeLevel(deps: Pick<MachinePipelineDeps, 'physics' | 'signal'> & { llm?: LlmBackend }, prompt: string, emit: Emit, opts: { graph?: RouteGraphInput; note?: string } = {}): Promise<MachineEvent> {
  const calls: Completion[] = [];
  emit({ type: 'stage', stage: 'designing', attempt: 1, maxAttempts: 1, message: opts.graph ? 'Building a level from your words.' : 'Sketching the route for your idea.' });
  const graph: RouteGraphInput = opts.graph ?? await designRoute(deps.llm!, prompt, calls);
  const g = graph as RouteGraph;
  emit({ type: 'stage', stage: 'verifying', attempt: 1, maxAttempts: 1, message: `Laying out ${g.links.map((l) => l.via).join(', then ')}, ending in ${g.end === 'dominoes' ? 'dominoes' : `a ${g.end}`}, and running it.` });
  const seed = Math.floor(Math.random() * 1e6);
  const flat = wantsFlat(prompt);
  // The graph as written, then shorter (a third link rarely fits the stage), then from the
  // mission's words with the AI's names and title: each is laid out in a second or two.
  const words = routeFromWords(prompt, seed);
  const tries: RouteGraphInput[] = [graph, graph, ...(g.links.length > 1 ? [{ ...graph, links: g.links.slice(0, g.links.length - 1) }] : []), { ...graph, links: words.links, end: g.end }];
  for (const [k, attempt] of tries.entries()) {
    if (deps.signal?.aborted) throw new SolverError('aborted');
    const res = await deps.physics.compile(attempt, { seed: seed + k, flat, signal: deps.signal });
    if (!res) continue;
    const spec: MachineSpec = opts.note ? { ...res.spec, closest: res.spec.closest ?? opts.note } : res.spec;
    const check = await deps.physics.check(spec, { signal: deps.signal });
    if (!check.result.success) continue;
    emit({ type: 'draft', machine: spec, status: 'solved', attempt: 1, result: check.result });
    return {
      type: 'machine', machine: spec, solved: true, verified: true, attempts: 1, cached: false, result: check.result, moved: [], attempt: 1,
      notes: [`Route graph (${g.links.map((l) => `${l.via} ${l.turn ?? 'straight'}`).join(', ')} -> ${g.end}${res.adapted ? `, adapted to ${res.adapted}` : ''}) laid out in ${res.tries} layout(s), ${res.sims} runs.`],
    };
  }
  throw new SolverError('the route could not be laid out');
}

/** A level with no AI at all: the compiler builds one from the mission's words (the AI is down or out of budget). */
export function wordsMachine(deps: Pick<MachinePipelineDeps, 'physics' | 'signal'>, prompt: string, emit: Emit): Promise<MachineEvent> {
  return routeLevel(deps, prompt, emit, { graph: routeFromWords(prompt, Math.floor(Math.random() * 1000)), note: 'The AI designer is resting, so this level was built straight from your words.' });
}

export async function generateMachine(deps: MachinePipelineDeps, prompt: string, emit: Emit, opts: { verify?: boolean } = {}): Promise<MachineEvent> {
  if (routeOn() && routable(prompt)) {
    try {
      return await routeLevel(deps, prompt, emit);
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      emit({ type: 'stage', stage: 'designing', attempt: 1, maxAttempts: deps.maxAttempts, message: 'That route did not fit the stage; designing it part by part instead.' });
    }
  }
  const twist = pickTwist(prompt);
  const loop = {
    firstStage: 'designing' as const,
    firstMessage: 'Designing a level for your idea.',
    design: (calls: Completion[], onProgress: (textSoFar: string) => void) => designMachine(deps.llm, prompt, calls, onProgress, { twist, bin: opts.verify === false }),
    request: `Design a machine for this request:\n\n${prompt}`,
    validate: (json: unknown) => validateMachineDesign(json, { flat: wantsFlat(prompt), difficulty: difficultyOf(prompt) }),
  };
  return opts.verify === false ? designOnly(deps, emit, loop) : machineLoop(deps, emit, loop);
}

export function editMachine(deps: MachinePipelineDeps, machine: MachineSpec, instruction: string, emit: Emit, opts: { verify?: boolean } = {}): Promise<MachineEvent> {
  const loop = {
    firstStage: 'editing' as const,
    firstMessage: `Applying your change: ${instruction}`,
    // A few ops on a fast model first; the full rewrite when the ops do not make a valid edit.
    design: async (calls: Completion[], onProgress: (textSoFar: string) => void) => {
      if (process.env.EDIT_OPS !== 'off') {
        try {
          return await editByOps(deps.llm, machine, instruction, calls);
        } catch (err) {
          if (deps.signal?.aborted) throw err;
          emit({ type: 'stage', stage: 'editing', attempt: 1, maxAttempts: deps.maxAttempts, message: 'Rewriting the machine for that change.' });
        }
      }
      return editMachineDesign(deps.llm, machine, instruction, calls, onProgress);
    },
    request: editMachineRequest(machine, instruction),
    validate: validateMachineEdit(machine),
  };
  return opts.verify === false ? designOnly(deps, emit, loop) : machineLoop(deps, emit, loop);
}
