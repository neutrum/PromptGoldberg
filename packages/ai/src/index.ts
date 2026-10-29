/**
 * @og/ai: the AI level designer, independent of any server, UI or renderer.
 *
 *   import { createLevel } from '@og/ai';
 *   const { level, solved } = await createLevel({ prompt: 'a comet crashes into the moon' });
 *   const edited = await createLevel({ level, instruction: 'make it harder' });
 *
 * One call runs the whole loop: the LLM designs a star system, the optimizer searches the
 * launch controls for a winning shot, the LLM redesigns on a miss, and the best attempt is
 * turned into a playable Level (starting sliders that miss, plus the proven solution).
 * The result is plain data; render it however you like. Pass `onEvent` to get playable drafts
 * while it works, so players can start before the proof is done.
 */
import type { Level, LevelStreamEvent } from '@og/shared';
import type { MachineResult, MachineSpec, MachineStreamEvent, Stage } from '@og/machine';
import { editMachine, generateMachine, wordsMachine } from './machine/pipeline';
import { createPhysics, type Physics } from './machine/physics';
import { createLlm, LlmError, type Completion, type LlmBackend, type LlmBackendName } from './llm/client';
import { editLevel, generateLevel } from './pipeline';
import { createSolver, type Solver } from './solver';

export type LevelRequest =
  /** Design a new level from a description. */
  | { prompt: string; stage?: Stage }
  /** Change an existing level ("make the giant heavier"); keeps its player and controls. */
  | { level: Level; instruction: string };

export interface CreateLevelOptions {
  /** LLM to use: a backend object, or 'api' / 'cli'. Default: ANTHROPIC_API_KEY if set, else the local Claude Code CLI (never in production). */
  llm?: LlmBackend | LlmBackendName;
  /** Optimizer runner. Default: one shared worker-thread solver. */
  solver?: Solver;
  /** Designs to try before giving up (default 3). */
  maxAttempts?: number;
  /** Simulated shots per design (default 600). */
  budget?: number;
  /** Optimizer time per design in ms (default 12 000). */
  timeLimitMs?: number;
  /** Total time budget in ms (default 180 000): after it, no new redesign starts and the best level so far is returned. */
  deadlineMs?: number;
  signal?: AbortSignal;
  /**
   * Live progress, so a UI never has to wait for the final result: `draft` events carry a playable
   * level as soon as each design is valid (status 'designed') and again once it is proven
   * ('solved'); plus stages (designing, verifying, redesigning) and optimizer progress.
   */
  onEvent?: (event: LevelStreamEvent) => void;
}

export interface LlmUsage {
  backend: LlmBackendName;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** ms until the first streamed token and the first reply text (API backend). */
  firstTokenMs?: number;
  firstTextMs?: number;
}

export interface CreateLevelResult {
  level: Level;
  /** True when the optimizer proved the level winnable; `level.solution` holds that shot. */
  solved: boolean;
  /** Designs tried. */
  attempts: number;
  /** What happened along the way, for logs. */
  notes: string[];
  /** One entry per LLM call. */
  usage: LlmUsage[];
}

let defaultSolver: Solver | null = null;

function resolveLlm(choice: CreateLevelOptions['llm']): LlmBackend {
  if (typeof choice === 'object') return choice;
  const llm = choice ? createLlm(choice) : createLlm();
  if (!llm) throw new LlmError('No AI backend is configured. Set ANTHROPIC_API_KEY (or LLM_BACKEND=cli for local development).');
  return llm;
}

/** Design (or edit) a level with the LLM and prove it solvable with the optimizer. */
export async function createLevel(request: LevelRequest, options: CreateLevelOptions = {}): Promise<CreateLevelResult> {
  const base = resolveLlm(options.llm);
  const usage: LlmUsage[] = [];
  const llm: LlmBackend = {
    name: base.name,
    async complete(req) {
      const started = Date.now();
      const c: Completion = await base.complete(req);
      usage.push({
        backend: c.backend, ms: Date.now() - started, inputTokens: c.inputTokens, outputTokens: c.outputTokens, costUsd: c.costUsd,
        cacheReadTokens: c.cacheReadTokens, cacheWriteTokens: c.cacheWriteTokens,
        firstTokenMs: c.timing?.firstTokenMs, firstTextMs: c.timing?.firstTextMs,
      });
      return c;
    },
  };
  const deps = {
    llm,
    solver: options.solver ?? (defaultSolver ??= createSolver('auto')),
    maxAttempts: options.maxAttempts ?? 3,
    budget: options.budget ?? 600,
    timeLimitMs: options.timeLimitMs ?? 12_000,
    signal: options.signal,
    deadline: Date.now() + (options.deadlineMs ?? 180_000),
  };
  const emit = options.onEvent ?? (() => {});
  const event = 'prompt' in request
    ? await generateLevel(deps, request.prompt, emit)
    : await editLevel(deps, request.level, request.instruction, emit);
  return { level: event.level, solved: event.solved, attempts: event.attempts, notes: event.notes, usage };
}

// Building blocks for hosts (the server shares the solver and wraps the LLM with its budget cap).
export { createLlm, LlmError, type Completion, type CompletionRequest, type LlmBackend, type LlmBackendName } from './llm/client';
export { createSolver, SolverError, type Solver, type SolverMode } from './solver';

// Smaller AI features that sit next to level creation.
/** Tip for a missed shot: rule-based, optionally phrased by the LLM. */
export { coachTip, controlAdvice, deterministicTip } from './coach';
/** Sandbox (free-form simulator): prompt -> star system, no level wrapping. */
export { designSystem } from './llm/design';

// ---- Prompt Goldberg: plain language -> a Rube Goldberg machine that the physics proved works.

export type MachineRequest = (
  /** Design a new machine from a description. */
  | { prompt: string; stage?: Stage }
  /** Change an existing machine ("swap the fan for a cannon"). */
  | { machine: MachineSpec; instruction: string }
) & {
  /** False: design only, no run, no nudging (puzzle play: the player's build is the first run). Default true. */
  verify?: boolean;
};

export interface CreateMachineOptions {
  llm?: LlmBackend | LlmBackendName;
  /** Physics runner. Default: one shared worker pool. */
  physics?: Physics;
  /** Designs to try before giving up (default 3). */
  maxAttempts?: number;
  /** Nudged variants the optimizer may simulate per design (default 150). */
  budget?: number;
  /** Optimizer time per design in ms (default 10 000). */
  timeLimitMs?: number;
  /** Total time budget in ms (default 120 000). */
  deadlineMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: MachineStreamEvent) => void;
}

export interface CreateMachineResult {
  machine: MachineSpec;
  /** True when the physics proved the goal chain happens; the spec includes the optimizer's nudges. */
  solved: boolean;
  /** False when nothing was run (verify: false). */
  verified: boolean;
  result: MachineResult;
  moved: { id: string; cells: number }[];
  attempts: number;
  notes: string[];
  usage: LlmUsage[];
}

let defaultPhysics: Physics | null = null;

/** Design (or edit) a machine with the LLM and prove it works with the physics engine. */
export async function createMachine(request: MachineRequest, options: CreateMachineOptions = {}): Promise<CreateMachineResult> {
  const base = resolveLlm(options.llm);
  const usage: LlmUsage[] = [];
  const llm: LlmBackend = {
    name: base.name,
    async complete(req) {
      const started = Date.now();
      const c: Completion = await base.complete(req);
      usage.push({
        backend: c.backend, ms: Date.now() - started, inputTokens: c.inputTokens, outputTokens: c.outputTokens, costUsd: c.costUsd,
        cacheReadTokens: c.cacheReadTokens, cacheWriteTokens: c.cacheWriteTokens,
        firstTokenMs: c.timing?.firstTokenMs, firstTextMs: c.timing?.firstTextMs,
      });
      return c;
    },
  };
  const deps = {
    llm,
    physics: options.physics ?? (defaultPhysics ??= createPhysics('auto')),
    maxAttempts: options.maxAttempts ?? 3,
    budget: options.budget ?? 150,
    timeLimitMs: options.timeLimitMs ?? 10_000,
    signal: options.signal,
    deadline: Date.now() + (options.deadlineMs ?? 120_000),
  };
  const emit = options.onEvent ?? (() => {});
  const opts = { verify: request.verify };
  const event = 'prompt' in request
    ? await generateMachine(deps, request.prompt, emit, { ...opts, stage: request.stage })
    : await editMachine(deps, request.machine, request.instruction, emit, opts);
  return { machine: event.machine, solved: event.solved, verified: event.verified !== false, result: event.result, moved: event.moved, attempts: event.attempts, notes: event.notes, usage };
}

export { createPhysics, type Physics } from './machine/physics';

/**
 * A level with no AI call: the route compiler builds it from the mission's words. For when the AI
 * is unavailable or out of budget; the level carries an honest note saying so, and it is verified.
 */
export async function createMachineOffline(prompt: string, options: Pick<CreateMachineOptions, 'physics' | 'signal' | 'onEvent'> & { stage?: Stage } = {}): Promise<CreateMachineResult> {
  const physics = options.physics ?? (defaultPhysics ??= createPhysics('auto'));
  const event = await wordsMachine({ physics, signal: options.signal }, prompt, options.onEvent ?? (() => {}), options.stage);
  return { machine: event.machine, solved: event.solved, verified: true, result: event.result, moved: event.moved, attempts: event.attempts, notes: event.notes, usage: [] };
}
export { routeFromWords, routable } from './machine/route';
