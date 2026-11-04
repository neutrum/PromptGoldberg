/**
 * @pg/ai: plain language in, a playable level out. Independent of any server, UI or renderer.
 *
 *   import { createMachine } from '@pg/ai';
 *   const { machine } = await createMachine({ prompt: 'a snowball races down the High Tatras into a cave' });
 *   const changed = await createMachine({ machine, instruction: 'make it night' });
 *   const solved = await createMachine({ solve: machine });
 *
 * The AI writes the level's idea (world, start, goal, mechanisms); core lays the stage out and
 * runs the physics. Solving happens only on request. Results are plain data; render them any way.
 */
import type { MachineResult, MachineSpec, MachineStreamEvent, Stage } from '@pg/core';
import { editMachine, generateMachine, solveLevel, wordsMachine } from './machine/pipeline';
import { createPhysics, type Physics } from './machine/physics';
import { createLlm, LlmError, type Completion, type LlmBackend, type LlmBackendName } from './llm/client';

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

function resolveLlm(choice: LlmBackend | LlmBackendName | undefined): LlmBackend {
  if (typeof choice === 'object') return choice;
  const llm = choice ? createLlm(choice) : createLlm();
  if (!llm) throw new LlmError('No AI backend is configured. Set ANTHROPIC_API_KEY (or LLM_BACKEND=cli for local development).');
  return llm;
}


// Building blocks for hosts (the server shares the physics pool and wraps the LLM with its budget cap).
export { createLlm, LlmError, type Completion, type CompletionRequest, type LlmBackend, type LlmBackendName } from './llm/client';
export { SolverError, type SolverMode } from './machine/pool';
export { composeGadget, fixGadget, labTest, type TestedGadget } from './machine/gadget';
export { downloadMesh, listProviders, meshMaker, registerProvider, textBackend, type MeshCheck, type MeshProvider, type Provider, type ProviderConfig, type ProviderInfo, type TextProvider } from './providers';

export type MachineRequest = (
  /** Design a new machine from a description. */
  | { prompt: string; stage?: Stage }
  /** Change an existing machine ("swap the fan for a cannon"). */
  | { machine: MachineSpec; instruction: string }
  /** Only on the player's request: find a way through a level by adding parts. */
  | { solve: MachineSpec }
);

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
  /** False when nothing was run (a new level, a change to one). */
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
      const c: Completion = await base.complete({ signal: options.signal, ...req });
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
  const event = 'prompt' in request
    ? await generateMachine(deps, request.prompt, emit, { stage: request.stage })
    : 'solve' in request
      ? await solveLevel(deps, request.solve, emit)
      : await editMachine(deps, request.machine, request.instruction, emit);
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
export { routeFromWords } from './machine/route';

// The recipe library: composed once by the AI, reviewed, then looked up by words with no AI call.
export { composeRecipes, type ComposeItem } from './machine/recipes';
export { fillLibrary, readBook, RECIPE_FILE, reviewRecipe, writeBook, type FillOptions } from './machine/recipeBook';
