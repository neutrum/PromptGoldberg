import { decorFromWords, isSolidShape, libraryNamed, heroFromWords, landscapeFromWords, layoutLevel, partNames, skinsFromWords, routeParts, type Difficulty, ruleProblems, rulesOf, type Rules, type Stage, type MachineResult, type MachineSpec, type MachineStreamEvent } from '@pg/core';
import type { Completion, LlmBackend } from '../llm/client';
import { SolverError } from './pool';
import type { Validation } from '../llm/request';
import { editMachineDesign, editMachineRequest, redesignMachine, sketchMachine, validateMachineEdit, wantsFlat, type MachineDesign } from './design';
import type { Physics } from './physics';
import { designRoute, routeFromWords } from './route';
import { editByOps } from './editOps';
import { missionProblems, unsupportedRequest } from './intent';
import type { RouteGraph, RouteGraphInput } from '@pg/core';

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
  rules?: Rules;
  mission?: string;
  requirements?: (spec: MachineSpec) => string[];
  /** Parts the optimizer never moves. */
  keep?: string[];
}): Promise<MachineEvent> {
  const { maxAttempts, signal } = deps;
  const calls: Completion[] = [];
  const notes: string[] = [];
  let best: (Attempt & { attempt: number }) | null = null;
  let last: Attempt | null = null;
  let attempts = 0;
  const complete = (a: Pick<Attempt, 'spec' | 'result'>) => a.result.success
    && !ruleProblems(a.spec.rules, a.result, routeParts(a.spec).length).length
    && (!loop.mission || !missionProblems(loop.mission, a.spec).length)
    && !loop.requirements?.(a.spec).length;
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
          request: `${loop.request}\nRequirements still unmet: ${[...ruleProblems(prev.spec.rules, prev.result, routeParts(prev.spec).length), ...(loop.mission ? missionProblems(loop.mission, prev.spec) : []), ...(loop.requirements?.(prev.spec) ?? [])].join(' ')}`, previous: prev.spec, result: prev.result, events: prev.events, evals: prev.evals,
        }, calls, sketcher(attempt), loop.validate);
      } catch (err) {
        if (signal?.aborted) throw err;
        notes.push(`Redesign ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    attempts = attempt;
    const spec = loop.rules ? { ...design.spec, rules: loop.rules } : design.spec;
    emit({ type: 'draft', machine: spec, status: 'designed', attempt });

    emit({ type: 'stage', stage: 'verifying', attempt, maxAttempts, message: 'Running the machine.' });
    const first = await deps.physics.check(spec, { signal });
    let current: Attempt = { design, spec, result: first.result, moved: [], evals: 1, events: first.events };
    if (complete(current)) {
      notes.push(`Design ${attempt}: worked on the first run.`);
    } else if (!first.result.success) {
      const goalLength = spec.goal.length;
      emit({ type: 'stage', stage: 'nudging', attempt, maxAttempts, message: `Almost: ${first.result.steps.find((s) => !s.satisfied)?.note ?? 'goal missed'}. Nudging parts.` });
      emit({ type: 'progress', attempt, evals: 1, bestScore: first.result.score, goalLength });
      const nudged = await deps.physics.nudge(spec, {
        budget: deps.budget, timeLimitMs: deps.timeLimitMs, seed: attempt, signal, keep: loop.keep,
        onProgress: (p) => emit({ type: 'progress', attempt, evals: p.evals, bestScore: p.bestScore, goalLength }),
      });
      emit({ type: 'progress', attempt, evals: nudged.evals, bestScore: nudged.result.score, goalLength });
      current = { design, spec: nudged.spec, result: nudged.result, moved: nudged.moved, evals: nudged.evals, events: nudged.events };
      notes.push(nudged.solved
        ? `Design ${attempt}: works after nudging ${nudged.moved.length} part(s) (${nudged.evals} runs).`
        : `Design ${attempt}: still fails after ${nudged.evals} runs; ${nudged.result.steps.find((s) => !s.satisfied)?.note ?? 'goal missed'}.`);
    }
    last = current;
    if (!best || complete(current) || current.result.score > best.result.score) best = { ...current, attempt };
    if (complete(current)) {
      emit({ type: 'draft', machine: current.spec, status: 'solved', attempt, result: current.result });
      break;
    }
  }
  if (!best) throw new SolverError('no design to build a machine from');
  return {
    type: 'machine', machine: best.spec, solved: complete(best), verified: complete(best), attempts, notes, cached: false,
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

/** How hard the level is: hard, crowded or maze-like missions get more obstacles, easy ones one. */
export function tierOf(prompt: string): Difficulty {
  if (/\b(easy|simple|beginner|first|tutorial)\b/i.test(prompt)) return 'easy';
  if (/\b(hard|harder|maze|crowded|clutter\w*|obstacles?|tricky|dense|chaos|chaotic|forest|jungle)\b/i.test(prompt)) return 'hard';
  return 'normal';
}


/**
 * The fast path: a route graph from the AI (or from the mission's words), laid out by the compiler
 * in the physics pool. The level that comes back has been run end to end.
 */
async function routeLevel(deps: Pick<MachinePipelineDeps, 'physics' | 'signal'> & { llm?: LlmBackend }, prompt: string, emit: Emit, opts: { graph?: RouteGraphInput; note?: string; stage?: Stage } = {}): Promise<MachineEvent> {
  const calls: Completion[] = [];
  const seed = Math.floor(Math.random() * 1e6);
  emit({ type: 'stage', stage: 'designing', attempt: 1, maxAttempts: 1, message: opts.graph ? 'Building a level from your words.' : 'Reading your idea.' });
  // The AI's idea of the level; when the AI cannot be reached, the mission's own words.
  let note = opts.note;
  let graph: RouteGraphInput;
  try {
    graph = opts.graph ?? await designRoute(deps.llm!, prompt, calls);
  } catch (err) {
    if (deps.signal?.aborted) throw err;
    graph = routeFromWords(prompt, seed);
    note = 'The AI could not be reached, so this level was set from the words in your request.';
  }
  const g = graph as RouteGraph;
  // The world and its centrepiece: the AI's, else the mission's words.
  const world = g.landscape ?? landscapeFromWords(prompt) ?? undefined;
  const hero = world && (world.hero ?? heroFromWords(prompt) ?? undefined);
  if (world) {
    // What the words name and the AI left out: the library's looks and things (a train always gets its wagons).
    const skins = world.skins?.length ? world.skins : skinsFromWords(prompt);
    // A thing the library has a reviewed recipe for is drawn from the library, whatever the AI composed for it live;
    // things the words name that the AI left out are added from it.
    const fromLibrary = <T extends { name: string; shapes: unknown[] }>(d: T): T => { const r = libraryNamed(d.name); return r ? { ...d, shapes: r.shapes } : d; };
    const composed = (world.decor ?? []).map(fromLibrary);
    const have = new Set(composed.map((d) => d.name.toLowerCase()));
    const decor = [...composed, ...decorFromWords(prompt).filter((d) => !have.has(d.name.toLowerCase()))].slice(0, 4);
    const landmark = world.landmark && libraryNamed(world.landmark.name)?.shapes.some(isSolidShape) ? fromLibrary(world.landmark) : world.landmark;
    g.landscape = { ...world, ...(landmark ? { landmark } : {}), ...(hero && !world.landmark ? { hero } : {}), ...(skins.length ? { skins } : {}), ...(decor.length ? { decor } : {}) };
  }
  if (g.landscape) emit({ type: 'world', landscape: g.landscape, title: g.title });
  emit({ type: 'stage', stage: 'verifying', attempt: 1, maxAttempts: 1, message: 'Setting the stage: the start, the goal and what stands between them.' });
  // The stage only: the player builds the way. Each layout must not solve itself (one run with
  // nothing placed), and a search with the player's own kit must find a way through it. The first
  // layout gets the whole physics pool; only when it is not proven are two more tried side by side.
  // The first one proven is kept and the other searches stop. The search's build is not shown: it
  // only proves the level fair.
  const rules = rulesOf(prompt);
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  deps.signal?.addEventListener('abort', onAbort);
  emit({ type: 'stage', stage: 'verifying', attempt: 1, maxAttempts: 1, message: 'Checking a way through exists with the player\'s parts.' });
  const tryLayout = async (k: number) => {
    const laid = layoutLevel(graph, { seed: seed + k, stage: opts.stage, difficulty: tierOf(prompt), flat: wantsFlat(prompt) });
    const level: MachineSpec = { ...laid, ...(rules ? { rules } : {}), closest: [note, laid.closest].filter(Boolean).join(' ') || undefined };
    // A run that cannot finish (too long, the pool busy) is no reason to lose the level: it is kept unrun.
    const check = await deps.physics.check(level, { signal: stop.signal }).catch(() => ({ result: UNRUN }));
    if (check.result.success) return { level, result: check.result, proof: null, selfSolving: true };
    const proof = await deps.physics.kitSolve(level, { budgetMs: FAIR_MS, signal: stop.signal }).catch(() => null);
    if (proof?.solved) stop.abort();
    return { level, result: check.result, proof, selfSolving: false };
  };
  const layouts = [await tryLayout(0)];
  try {
    if (!layouts[0].proof?.solved && !deps.signal?.aborted) {
      emit({ type: 'stage', stage: 'verifying', attempt: 2, maxAttempts: 2, message: 'No sure way through there: trying the stage another way.' });
      layouts.push(...await Promise.all(Array.from({ length: LAYOUTS - 1 }, (_, k) => tryLayout(k + 1))));
    }
  } finally {
    deps.signal?.removeEventListener('abort', onAbort);
  }
  if (deps.signal?.aborted) throw new SolverError('aborted');
  // Kept: one proven fair, else the one the search got furthest in, else (all solve themselves) the first.
  const playable = layouts.filter((l) => !l.selfSolving);
  const best = playable.find((l) => l.proof?.solved)
    ?? playable.reduce<(typeof layouts)[number] | null>((a, b) => (!a || (b.proof?.result.score ?? -1) > (a.proof?.result.score ?? -1) ? b : a), null)
    ?? layouts[0];
  const { level: spec, result, proof } = best;
  emit({ type: 'draft', machine: spec, status: 'designed', attempt: 1 });
  return {
    type: 'machine', machine: spec, solved: false, verified: false, attempts: layouts.length, cached: false, result, moved: [], attempt: 1,
    notes: [
      `Level set from the idea (${g.links.map((l) => l.via).join(', ')} -> ${g.end}); the player builds the way.`,
      proof?.solved ? `Fair: a build from the kit with ${proof.placed.length} part${proof.placed.length === 1 ? '' : 's'} reaches the goal (found in ${(proof.ms / 1000).toFixed(1)} s).` : 'Not proven: no build from the kit was found in time.',
    ],
  };
}

/** Layouts tried side by side for one level, and the time the kit search has for them. */
const LAYOUTS = 3;
const FAIR_MS = 12_000;

/** A level with no AI at all: the compiler builds one from the mission's words (the AI is down or out of budget). */
export function wordsMachine(deps: Pick<MachinePipelineDeps, 'physics' | 'signal'>, prompt: string, emit: Emit, stage?: Stage): Promise<MachineEvent> {
  const unsupported = unsupportedRequest(prompt);
  if (unsupported) return Promise.reject(new SolverError(unsupported));
  return routeLevel(deps, prompt, emit, { stage, graph: routeFromWords(prompt, Math.floor(Math.random() * 1000)), note: 'Offline builder: AI is unavailable. This level is set from the mechanisms and keywords in your request.' });
}

/** A new level: the AI's idea of it (or the mission's words) laid out on the stage. Nothing is solved. */
export async function generateMachine(deps: MachinePipelineDeps, prompt: string, emit: Emit, opts: { stage?: Stage } = {}): Promise<MachineEvent> {
  const unsupported = unsupportedRequest(prompt);
  if (unsupported) throw new SolverError(unsupported);
  return routeLevel(deps, prompt, emit, { stage: opts.stage });
}

/** Kinds the AI may add when it solves a level: the mechanisms, never scenery or goals. */
const SOLVE_KINDS = ['ramp', 'platform', 'fan', 'trampoline', 'cannon', 'seesaw', 'wall'];

/** What a solution changed that it must not: the level's own parts stay exactly as they are. */
export function solveProblems(level: MachineSpec, spec: MachineSpec): string[] {
  const problems: string[] = [];
  for (const p of level.parts) {
    const q = spec.parts.find((r) => r.id === p.id);
    if (!q) problems.push(`Keep "${p.id}": only add parts, never remove the level's.`);
    else if (q.kind !== p.kind || q.x !== p.x || q.y !== p.y || q.z !== p.z || q.yaw !== p.yaw || (q.length ?? null) !== (p.length ?? null)) problems.push(`Leave "${p.id}" exactly where it is (x ${p.x}, y ${p.y}, z ${p.z}, yaw ${p.yaw}).`);
  }
  const added = spec.parts.filter((p) => !level.parts.some((q) => q.id === p.id));
  if (!added.length) problems.push('Add the parts that get the ball to the goal.');
  for (const p of added) if (!SOLVE_KINDS.includes(p.kind) || p.fixed || p.prop) problems.push(`"${p.id}" is a ${p.kind}: add only ramps, shelves, fans, trampolines, cannons, seesaws or walls.`);
  if (added.length > 8) problems.push('Use at most 8 added parts.');
  if (JSON.stringify(spec.goal) !== JSON.stringify(level.goal)) problems.push('Keep the goal exactly as it is.');
  return problems;
}

/**
 * Only when the player asks: the AI looks for a way through a level by adding parts, and the
 * physics checks it (nudging only the added parts). An honest miss when it finds none.
 */
export function solveLevel(deps: MachinePipelineDeps, level: MachineSpec, emit: Emit): Promise<MachineEvent> {
  const names = partNames(level.parts);
  const ball = level.parts.find((p) => p.kind === 'ball');
  const target = level.parts.find((p) => p.id === level.goal.at(-1)?.part);
  const instruction = `Solve this level: add parts so the ${ball ? names.get(ball.id) : 'ball'} reaches the ${target ? names.get(target.id) : 'goal'} and the goal happens. Only ADD new parts (ramps, shelves, fans, trampolines, cannons, seesaws, walls) on free cells, each with a new id; never move, remove or change any part already there, and keep the goal as it is.`;
  // The player is waiting: at most two designs, short nudging, under a minute in all.
  const quick: MachinePipelineDeps = { ...deps, maxAttempts: Math.min(deps.maxAttempts, 2), budget: Math.min(deps.budget, 80), timeLimitMs: Math.min(deps.timeLimitMs, 6000), deadline: Math.min(deps.deadline ?? Infinity, Date.now() + 45_000) };
  return machineLoop(quick, emit, {
    firstStage: 'editing',
    firstMessage: 'The AI is looking for a way through.',
    design: async (calls: Completion[], onProgress: (textSoFar: string) => void) => {
      try {
        return await editByOps(deps.llm, level, instruction, calls);
      } catch (err) {
        if (deps.signal?.aborted) throw err;
        return editMachineDesign(deps.llm, level, instruction, calls, onProgress);
      }
    },
    request: editMachineRequest(level, instruction),
    rules: level.rules,
    requirements: (spec) => solveProblems(level, spec),
    validate: validateMachineEdit(level),
    keep: level.parts.map((p) => p.id),
  });
}

/** A change to a level in words: it comes back as the AI wrote it, unrun (the player's build is the first run). */
export function editMachine(deps: MachinePipelineDeps, machine: MachineSpec, instruction: string, emit: Emit): Promise<MachineEvent> {
  const loop = {
    firstStage: 'editing' as const,
    firstMessage: `Applying your change: ${instruction}`,
    // A few ops on a fast model. The full rewrite of a level takes longer than a change may wait, so only on request.
    design: (calls: Completion[], onProgress: (textSoFar: string) => void) =>
      process.env.EDIT_OPS === 'off' ? editMachineDesign(deps.llm, machine, instruction, calls, onProgress) : editByOps(deps.llm, machine, instruction, calls),
  };
  return designOnly(deps, emit, loop);
}
