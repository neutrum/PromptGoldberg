import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import {
  evaluateGoal, parseLevel, parseSpec, simulate,
  type CoachRequest, type GallerySort, type Level, type LevelStreamEvent,
} from '@og/shared';
import { LevelCache } from './cache';
import { DailyStore, todayUtc } from './daily';
import { checkBuild, DailyBoard, MachineGallery, PLAY_EVENTS, playerName, PlayLog, type PlayEvent } from './machines';
import { GalleryStore } from './gallery';
import { DAILY_LADDER, dailySeed, GRID, parseMachine, PUZZLE_KINDS, Stage, STAGE_MAX, STAGE_MIN, type MachineStreamEvent, type PuzzleKind } from '@og/machine';
import {
  coachTip, createLevel, createMachine, createMachineOffline, createPhysics, createSolver, designSystem, LlmError, SolverError,
  type CreateLevelResult, type CreateMachineResult, type LevelRequest, type LlmBackend, type MachineRequest, type Physics, type Solver, type SolverMode,
} from '@og/ai';
import { DailyCap, RateLimiter } from './rateLimit';
import { openSse } from './sse';
import { registerLooks, TripoProvider, type ModelProvider } from './looks';

export interface Limits {
  /** Per-IP requests to LLM endpoints (/api/level, /api/edit, /api/design). */
  perMinute: number;
  perDay: number;
  /** Per-IP coach requests that may use the LLM; beyond this the rule-based tip is returned. */
  coachPerMinute: number;
  publishPerMinute: number;
  publishPerDay: number;
  resultsPerMinute: number;
  /** Global LLM calls per UTC day. */
  dailyLlmCalls: number;
  maxPromptChars: number;
  maxInstructionChars: number;
  maxAttempts: number;
  solveBudget: number;
  solveTimeMs: number;
  /** Total time for one AI level request before the best level so far is returned. */
  levelDeadlineMs: number;
  galleryMaxEntries: number;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
};

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Limits {
  return {
    perMinute: num(env.RATE_LIMIT_PER_MIN, 6),
    perDay: num(env.RATE_LIMIT_PER_DAY, 40),
    coachPerMinute: num(env.COACH_RATE_LIMIT_PER_MIN, 12),
    publishPerMinute: num(env.PUBLISH_RATE_LIMIT_PER_MIN, 4),
    publishPerDay: num(env.PUBLISH_RATE_LIMIT_PER_DAY, 30),
    resultsPerMinute: num(env.RESULT_RATE_LIMIT_PER_MIN, 30),
    dailyLlmCalls: num(env.DAILY_LLM_CALL_CAP, 1000),
    maxPromptChars: num(env.MAX_PROMPT_CHARS, 500),
    maxInstructionChars: num(env.MAX_INSTRUCTION_CHARS, 300),
    maxAttempts: num(env.LEVEL_MAX_ATTEMPTS, 3),
    solveBudget: num(env.SOLVE_BUDGET, 600),
    solveTimeMs: num(env.SOLVE_TIME_MS, 12_000),
    levelDeadlineMs: num(env.LEVEL_DEADLINE_MS, 150_000),
    galleryMaxEntries: num(env.GALLERY_MAX_ENTRIES, 1000),
  };
}

export interface AppOptions {
  llm: LlmBackend | null;
  dataDir: string;
  solver?: Solver | SolverMode;
  physics?: Physics;
  limits?: Partial<Limits>;
  logger?: FastifyServerOptions['logger'];
  trustProxy?: boolean;
  models?: ModelProvider | null;
  modelDailyCap?: number;
}

const LLM_UNAVAILABLE = 'No AI backend is configured on this server. Set ANTHROPIC_API_KEY (or LLM_BACKEND=cli for local development).';

export async function buildApp(opts: AppOptions) {
  const limits: Limits = { ...limitsFromEnv(), ...opts.limits };
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false, bodyLimit: 512 * 1024 });
  const models = opts.models !== undefined ? opts.models : process.env.TRIPO_API_KEY?.trim() ? new TripoProvider(process.env.TRIPO_API_KEY.trim(), process.env.TRIPO_MODEL_VERSION || undefined) : null;
  await registerLooks(app, join(opts.dataDir, 'looks'), models, opts.modelDailyCap ?? Math.max(0, Math.floor(num(process.env.TRIPO_DAILY_MODEL_CAP, 5))));
  const solver = typeof opts.solver === 'object' ? opts.solver : createSolver(opts.solver ?? 'auto');
  const physics = opts.physics ?? createPhysics(typeof opts.solver === 'string' ? opts.solver : 'auto');
  const gallery = await GalleryStore.open(opts.dataDir, limits.galleryMaxEntries);
  const cache = new LevelCache(join(opts.dataDir, 'cache'));
  const daily = new DailyStore(
    join(opts.dataDir, 'daily'),
    opts.llm && ((request) => createMachine(request, { llm: llm!, physics, maxAttempts: limits.maxAttempts, deadlineMs: limits.levelDeadlineMs })),
    // Every stage of the day's ladder must be a puzzle this machine can make, with the day's seed.
    async (machine, date) => {
      for (const kind of DAILY_LADDER) if ((await physics.puzzle(machine, kind, dailySeed(date))) === null) return false;
      return true;
    },
    (prompt) => createMachineOffline(prompt, { physics }),
  );
  const machines = await MachineGallery.open(opts.dataDir);
  const dailyBoard = await DailyBoard.open(opts.dataDir);
  const plays = new PlayLog(join(opts.dataDir, 'plays'));
  const llmLimiter = new RateLimiter(limits.perMinute, limits.perDay);
  const coachLimiter = new RateLimiter(limits.coachPerMinute, limits.coachPerMinute * 60 * 24);
  const publishLimiter = new RateLimiter(limits.publishPerMinute, limits.publishPerDay);
  const resultLimiter = new RateLimiter(limits.resultsPerMinute, limits.resultsPerMinute * 60 * 24);
  const cap = new DailyCap(limits.dailyLlmCalls);

  const capExhausted = () => cap.used >= cap.cap;
  const CAP_MESSAGE = 'The AI level designer is resting: the demo has used its daily AI budget. Try the campaign or the community gallery, and come back tomorrow.';
  // Every LLM call counts against the global daily cap.
  const llm: LlmBackend | null = opts.llm && {
    name: opts.llm.name,
    complete: (req) => {
      if (!cap.take()) return Promise.reject(new LlmError(CAP_MESSAGE, true));
      return opts.llm!.complete(req);
    },
  };

  const errorMessage = (err: unknown): string => {
    if (err instanceof LlmError) return `AI design failed: ${err.message}`;
    if (err instanceof SolverError) return `Verification failed: ${err.message}`;
    return 'Something went wrong while building the level. Please try again.';
  };

  /** The whole AI side is one call; the server only adds limits, streaming and caching. */
  const runAi = async (request: LevelRequest, emit: (e: LevelStreamEvent) => void, signal: AbortSignal): Promise<Extract<LevelStreamEvent, { type: 'level' }>> => {
    const res: CreateLevelResult = await createLevel(request, {
      llm: llm!, solver, signal, onEvent: emit,
      maxAttempts: limits.maxAttempts, budget: limits.solveBudget, timeLimitMs: limits.solveTimeMs,
      deadlineMs: limits.levelDeadlineMs,
    });
    return { type: 'level', level: res.level, solved: res.solved, attempts: res.attempts, notes: res.notes, cached: false };
  };

  /** Prompt Goldberg: the whole AI side is one call too. */
  const runMachineAi = async (request: MachineRequest, emit: (e: MachineStreamEvent) => void, signal: AbortSignal): Promise<Extract<MachineStreamEvent, { type: 'machine' }>> => {
    const res: CreateMachineResult = await createMachine(request, {
      llm: llm!, physics, signal, onEvent: emit,
      maxAttempts: limits.maxAttempts, deadlineMs: limits.levelDeadlineMs,
    });
    return { type: 'machine', machine: res.machine, solved: res.solved, verified: res.verified, attempts: res.attempts, notes: res.notes, cached: false, result: res.result, moved: res.moved };
  };

  const runMachineOffline = async (prompt: string, emit: (e: MachineStreamEvent) => void, signal: AbortSignal, stage?: Stage): Promise<Extract<MachineStreamEvent, { type: 'machine' }>> => {
    const res = await createMachineOffline(prompt, { physics, signal, onEvent: emit, stage });
    return { type: 'machine', machine: res.machine, solved: res.solved, verified: true, attempts: res.attempts, notes: res.notes, cached: false, result: res.result, moved: res.moved };
  };

  /** Reply with a single-error SSE stream (status still reflects the failure). */
  const sseError = (reply: FastifyReply, status: number, error: string) => {
    const stream = openSse(reply, status);
    stream.send({ type: 'error', error });
    stream.close();
  };

  const guardLlm = (req: FastifyRequest): { status: number; error: string } | null => {
    if (!llm) return { status: 503, error: LLM_UNAVAILABLE };
    if (capExhausted()) return { status: 503, error: CAP_MESSAGE };
    const limited = llmLimiter.take(req.ip);
    return limited ? { status: 429, error: limited.error } : null;
  };

  async function streamPipeline(req: FastifyRequest, reply: FastifyReply, run: (emit: (e: LevelStreamEvent) => void, signal: AbortSignal) => Promise<Extract<LevelStreamEvent, { type: 'level' }>>) {
    const stream = openSse(reply);
    const started = Date.now();
    try {
      const event = await run(stream.send, stream.signal);
      stream.send(event);
      req.log.info({ ms: Date.now() - started, solved: event.solved, attempts: event.attempts }, 'level stream done');
    } catch (err) {
      if (stream.signal.aborted) {
        req.log.info('client disconnected during level stream');
      } else {
        req.log.error({ err }, 'level stream failed');
        stream.send({ type: 'error', error: errorMessage(err) });
      }
    } finally {
      stream.close();
    }
  }

  app.get('/api/health', async () => ({
    ok: true,
    llm: opts.llm?.name ?? null,
    solver: solver.mode,
    gallery: gallery.count,
    llmCallsToday: cap.used,
    dailyLlmCallCap: cap.cap,
  }));

  /** Headless check of a system: validates, simulates and scores the goal. */
  app.post<{ Body: { spec: unknown } }>('/api/check', async (req, reply) => {
    const parsed = parseSpec(req.body?.spec);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid system', issues: parsed.issues });
    const run = simulate(parsed.spec, { record: false });
    return { events: run.events, goal: evaluateGoal(parsed.spec.goal, run.trace) };
  });

  /** Sandbox: prompt -> designed system, plus a quick optimizer pass when the design misses its goal. */
  app.post<{ Body: { prompt?: string } }>('/api/design', async (req, reply) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return reply.code(400).send({ error: 'prompt is required' });
    if (prompt.length > 1000) return reply.code(400).send({ error: 'prompt is too long (max 1000 characters)' });
    const blocked = guardLlm(req);
    if (blocked) return reply.code(blocked.status).send({ error: blocked.error });

    try {
      const started = Date.now();
      const design = await designSystem(llm!, prompt);
      const designMs = Date.now() - started;
      const initial = await solver.evaluate(design.spec);
      const tuned = initial.success ? null : await solver.optimize(design.spec, { budget: 400, timeLimitMs: 8000 });
      req.log.info({ designMs, tuneEvals: tuned?.evals, solved: tuned?.solved ?? initial.success }, 'design done');
      return {
        spec: design.spec,
        goal: initial,
        tuned: tuned && tuned.result.score > initial.score
          ? { spec: tuned.spec, goal: tuned.result, evals: tuned.evals }
          : null,
        notes: design.notes,
        usage: design.calls.map(({ backend, costUsd, inputTokens, outputTokens }) => ({ backend, costUsd, inputTokens, outputTokens })),
      };
    } catch (err) {
      if (err instanceof LlmError) return reply.code(err.retryable ? 503 : 502).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Body: { prompt?: unknown } }>('/api/level', async (req, reply) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return sseError(reply, 400, 'Describe the level you want, e.g. "a comet swings past the gas giant and crashes into its moon".');
    if (prompt.length > limits.maxPromptChars) return sseError(reply, 400, `That description is too long: keep it under ${limits.maxPromptChars} characters.`);

    const hit = await cache.get(prompt);
    if (hit) {
      const stream = openSse(reply);
      stream.send({ ...hit, cached: true });
      stream.close();
      return;
    }
    const blocked = guardLlm(req);
    if (blocked) return sseError(reply, blocked.status, blocked.error);

    await streamPipeline(req, reply, async (emit, signal) => {
      const event = await runAi({ prompt }, emit, signal);
      if (event.solved) {
        const { cached: _cached, ...rest } = event;
        await cache.put(prompt, rest).catch((err) => req.log.warn({ err }, 'could not write level cache'));
      }
      return event;
    });
  });

  app.post<{ Body: { level?: unknown; instruction?: unknown } }>('/api/edit', async (req, reply) => {
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
    if (!instruction) return sseError(reply, 400, 'Say what to change, e.g. "make the gas giant heavier".');
    if (instruction.length > limits.maxInstructionChars) return sseError(reply, 400, `That change is too long: keep it under ${limits.maxInstructionChars} characters.`);
    const parsed = parseLevel(req.body?.level);
    if (!parsed.ok) return sseError(reply, 400, `The level to edit is invalid: ${parsed.issues.slice(0, 3).join('; ')}`);
    const blocked = guardLlm(req);
    if (blocked) return sseError(reply, blocked.status, blocked.error);

    await streamPipeline(req, reply, (emit, signal) => runAi({ level: parsed.level, instruction }, emit, signal));
  });

  app.post<{ Body: { prompt?: unknown; verify?: unknown; stage?: unknown } }>('/api/machine', async (req, reply) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    // The default 24 by 24 stage is sent as no stage, so existing levels and caches stay the same.
    const staged = req.body?.stage === undefined ? undefined : Stage.safeParse(req.body.stage);
    if (staged && !staged.success) return sseError(reply, 400, `The stage must be ${STAGE_MIN} to ${STAGE_MAX} cells each way.`);
    const stage = staged?.data && (staged.data.x !== GRID.x || staged.data.z !== GRID.z) ? staged.data : undefined;
    const verify = true;
    if (!prompt) return sseError(reply, 400, 'Describe the machine you want, e.g. "get the ball into the bucket using dominoes and a fan".');
    if (prompt.length > limits.maxPromptChars) return sseError(reply, 400, `That description is too long: keep it under ${limits.maxPromptChars} characters.`);
    const blocked = guardLlm(req);
    // No AI (none configured, or the day's budget is spent): the route compiler still builds a level from the words.
    const offline = blocked?.status === 503;
    if (blocked && !offline) return sseError(reply, blocked.status, blocked.error);
    const stream = openSse<MachineStreamEvent>(reply);
    const started = Date.now();
    try {
      const event = offline
        ? await runMachineOffline(prompt, stream.send, stream.signal, stage)
        : await runMachineAi({ prompt, verify, stage }, stream.send, stream.signal);
      stream.send(event);
      req.log.info({ ms: Date.now() - started, solved: event.solved, verified: event.verified !== false, attempts: event.attempts }, 'machine stream done');
    } catch (err) {
      if (stream.signal.aborted) req.log.info('client disconnected during machine stream');
      else {
        req.log.error({ err }, 'machine stream failed');
        stream.send({ type: 'error', error: errorMessage(err) });
      }
    } finally {
      stream.close();
    }
  });

  /** Today's machine, generated once per UTC day for everyone (the client makes the fix-it puzzle). */
  app.get('/api/machine/daily', async (req) => {
    const started = Date.now();
    const result = await daily.get();
    if (Date.now() - started > 1000) req.log.info({ ms: Date.now() - started, generated: result.generated }, 'daily machine generated');
    return result;
  });

  /** Break a working machine for fix-it play. Pure physics, no LLM; dozens of short runs in the worker pool. */
  /**
   * Run a machine (a player's build) on the server: whether the goal chain happens and the trace's
   * fingerprint, which a browser run of the same build must match. Pure physics, no LLM.
   */
  app.post<{ Body: { machine?: unknown } }>('/api/machine/verify', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const parsed = parseMachine(req.body?.machine, { allowMissingGoalParts: true });
    if (!parsed.ok) return reply.code(400).send({ error: `The machine is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}` });
    const { result, hash } = await physics.check(parsed.spec, { hash: true });
    return { success: result.success, failedAt: result.failedAt, hash };
  });

  app.post<{ Body: { machine?: unknown; kind?: unknown; seed?: unknown } }>('/api/machine/puzzle', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const kind = req.body?.kind;
    if (!PUZZLE_KINDS.includes(kind as PuzzleKind)) return reply.code(400).send({ error: `kind must be one of ${PUZZLE_KINDS.join(', ')}` });
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return reply.code(400).send({ error: `The machine is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}` });
    const seed = Number.isFinite(Number(req.body?.seed)) ? Math.floor(Number(req.body?.seed)) : 1;
    const started = Date.now();
    const puzzle = await physics.puzzle(parsed.spec, kind as PuzzleKind, seed);
    req.log.info({ ms: Date.now() - started, kind, physics: physics.mode, found: !!puzzle }, 'puzzle generated');
    return { puzzle };
  });

  /** Only when the player asks: the AI looks for a way through their level by adding parts. */
  app.post<{ Body: { machine?: unknown } }>('/api/machine/solve', async (req, reply) => {
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return sseError(reply, 400, `The level is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
    const blocked = guardLlm(req);
    if (blocked) return sseError(reply, blocked.status, blocked.error);
    const stream = openSse<MachineStreamEvent>(reply);
    const started = Date.now();
    try {
      const event = await runMachineAi({ solve: parsed.spec }, stream.send, stream.signal);
      stream.send(event);
      req.log.info({ ms: Date.now() - started, solved: event.solved }, 'level solve done');
    } catch (err) {
      if (stream.signal.aborted) req.log.info('client disconnected during solve');
      else {
        req.log.error({ err }, 'level solve failed');
        stream.send({ type: 'error', error: errorMessage(err) });
      }
    } finally {
      stream.close();
    }
  });

  app.post<{ Body: { machine?: unknown; instruction?: unknown; verify?: unknown } }>('/api/machine/edit', async (req, reply) => {
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
    if (!instruction) return sseError(reply, 400, 'Say what to change, e.g. "swap the fan for a cannon".');
    if (instruction.length > limits.maxInstructionChars) return sseError(reply, 400, `That change is too long: keep it under ${limits.maxInstructionChars} characters.`);
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return sseError(reply, 400, `The machine to edit is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
    const blocked = guardLlm(req);
    if (blocked) return sseError(reply, blocked.status, blocked.error);
    const stream = openSse<MachineStreamEvent>(reply);
    try {
      // verify: false for a change to a level in play: the player builds the way, nothing needs to work yet.
      const event = await runMachineAi({ machine: parsed.spec, instruction, verify: req.body?.verify !== false }, stream.send, stream.signal);
      stream.send(event);
    } catch (err) {
      if (stream.signal.aborted) req.log.info('client disconnected during machine stream');
      else {
        req.log.error({ err }, 'machine edit failed');
        stream.send({ type: 'error', error: errorMessage(err) });
      }
    } finally {
      stream.close();
    }
  });

  app.post<{ Body: Partial<CoachRequest> }>('/api/coach', async (req, reply) => {
    const body = req.body ?? {};
    const parsed = parseLevel(body.level);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid level', issues: parsed.issues.slice(0, 10) });
    const goal = body.goal;
    if (!goal || typeof goal !== 'object' || !Array.isArray(goal.events) || typeof goal.success !== 'boolean') {
      return reply.code(400).send({ error: 'goal result is required' });
    }
    const values = Array.isArray(body.values) ? body.values.map(Number) : [];
    const request: CoachRequest = {
      level: parsed.level,
      values: parsed.level.controls.map((c, i) => (Number.isFinite(values[i]) ? values[i] : (c.min + c.max) / 2)),
      pieces: Array.isArray(body.pieces) ? body.pieces : [],
      shots: Number.isFinite(Number(body.shots)) ? Number(body.shots) : 1,
      goal,
      events: Array.isArray(body.events) ? body.events.slice(0, 200) : [],
    };
    const useLlm = !!llm && !capExhausted() && !coachLimiter.take(req.ip);
    const { tip } = await coachTip(request, llm, { useLlm });
    return { tip };
  });

  app.get<{ Querystring: { sort?: string; limit?: string } }>('/api/gallery', async (req) => {
    const sort: GallerySort = req.query.sort === 'top' ? 'top' : 'new';
    return { items: gallery.list(sort, num(req.query.limit, 50)) };
  });

  app.get<{ Params: { id: string } }>('/api/gallery/:id', async (req, reply) => {
    const entry = gallery.get(req.params.id);
    return entry ?? reply.code(404).send({ error: 'level not found' });
  });

  app.post<{ Body: { level?: unknown; author?: unknown } }>('/api/gallery', async (req, reply) => {
    const limited = publishLimiter.take(req.ip);
    if (limited) return reply.code(429).header('retry-after', limited.retryAfterS).send({ error: limited.error });
    const verify = (level: Level) => solver.check(level, level.solution!.values, level.solution!.pieces, { timeoutMs: 8000 });
    const result = await gallery.publish(req.body?.level, req.body?.author, verify);
    if (!result.ok) return reply.code(result.status).send({ error: result.error, issues: result.issues });
    req.log.info({ id: result.entry.id }, 'gallery level published');
    return reply.code(201).send(result.entry);
  });

  app.post<{ Params: { id: string }; Body: { cleared?: unknown; shots?: unknown } }>('/api/gallery/:id/result', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const shots = Number(req.body?.shots);
    if (typeof req.body?.cleared !== 'boolean' || !Number.isFinite(shots) || shots < 0) {
      return reply.code(400).send({ error: 'expected { cleared: boolean, shots: number }' });
    }
    const item = await gallery.recordResult(req.params.id, req.body.cleared, shots);
    return item ?? reply.code(404).send({ error: 'level not found' });
  });

  // Community levels: published with a build that solves them (the server runs it), played as
  // "build the route" puzzles, and each clear is a build the server runs too.
  const MACHINE_INVALID = (issues: { message: string }[]) => `The level is invalid: ${issues.slice(0, 3).map((i) => i.message).join('; ')}`;

  app.get<{ Querystring: { sort?: string; limit?: string } }>('/api/machines', async (req) => ({
    items: machines.list(req.query.sort === 'new' ? 'new' : 'top', num(req.query.limit, 24)),
  }));

  app.get<{ Params: { id: string } }>('/api/machines/:id', async (req, reply) => {
    const e = machines.get(req.params.id);
    return e ?? reply.code(404).send({ error: 'level not found' });
  });

  app.post<{ Body: { machine?: unknown; mission?: unknown; author?: unknown; tries?: unknown; parts?: unknown } }>('/api/machines', async (req, reply) => {
    const limited = publishLimiter.take(req.ip);
    if (limited) return reply.code(429).header('retry-after', limited.retryAfterS).send({ error: limited.error });
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return reply.code(400).send({ error: MACHINE_INVALID(parsed.issues) });
    const { result } = await physics.check(parsed.spec);
    if (!result.success) return reply.code(400).send({ error: 'the level does not work as sent: publish the build that solved it' });
    if (!(await physics.puzzle(parsed.spec, 'connect', 1))) return reply.code(400).send({ error: 'the level has nothing for a player to build' });
    const tries = Math.max(1, Math.min(99, Math.round(Number(req.body?.tries) || 1)));
    const parts = Math.max(1, Math.min(12, Math.round(Number(req.body?.parts) || 1)));
    const item = await machines.publish(parsed.spec, req.body?.mission, req.body?.author, { parts, tries });
    req.log.info({ id: item.id }, 'machine level published');
    return reply.code(201).send(item);
  });

  app.post<{ Params: { id: string } }>('/api/machines/:id/play', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    return (await machines.played(req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'level not found' });
  });

  app.post<{ Params: { id: string }; Body: { placed?: unknown; tries?: unknown; name?: unknown } }>('/api/machines/:id/clear', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const entry = machines.get(req.params.id);
    if (!entry) return reply.code(404).send({ error: 'level not found' });
    const puzzle = await physics.puzzle(entry.machine, 'connect', 1);
    if (!puzzle) return reply.code(409).send({ error: 'this level cannot be played any more' });
    const checked = await checkBuild(physics, puzzle, req.body?.placed);
    if (!checked.ok) return reply.code(400).send({ error: `Not counted: ${checked.error}.` });
    const tries = Math.max(1, Math.min(99, Math.round(Number(req.body?.tries) || 1)));
    return machines.cleared(entry.id, { name: playerName(req.body?.name), parts: checked.parts, tries });
  });

  // The daily leaderboard: every stage's build is re-run on the server against the day's puzzles.
  app.get<{ Querystring: { date?: string } }>('/api/machine/daily/scores', async (req) => {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayUtc();
    return { date, board: dailyBoard.top(date) };
  });

  app.post<{ Body: { date?: unknown; name?: unknown; tries?: unknown; builds?: unknown } }>('/api/machine/daily/score', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const date = req.body?.date;
    if (date !== todayUtc()) return reply.code(400).send({ error: "Only today's daily counts." });
    const builds = req.body?.builds;
    if (!Array.isArray(builds)) return reply.code(400).send({ error: 'expected { date, name, tries, builds: placed parts per stage }' });
    const today = await daily.get(date);
    let stage = 0;
    let parts = 0;
    for (const kind of DAILY_LADDER) {
      const puzzle = await physics.puzzle(today.machine, kind, dailySeed(date));
      if (!puzzle) continue; // The client skips a stage the machine cannot offer, and so does the board.
      const checked = await checkBuild(physics, puzzle, builds[stage]);
      if (!checked.ok) return reply.code(400).send({ error: `Stage ${stage + 1} not counted: ${checked.error}.` });
      parts += checked.parts;
      stage++;
    }
    if (builds.length !== stage) return reply.code(400).send({ error: `expected ${stage} stage builds` });
    const tries = Math.max(stage, Math.min(999, Math.round(Number(req.body?.tries) || stage)));
    return { date, ...(await dailyBoard.add(date, { name: playerName(req.body?.name), tries, parts })) };
  });

  // Where players give up: start, solve, give-up and hint events per level, nothing about the player.
  app.post<{ Body: { level?: unknown; event?: unknown; tries?: unknown; placed?: unknown } }>('/api/machine/event', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const level = typeof req.body?.level === 'string' ? req.body.level.replace(/[^\w:. -]/g, '').slice(0, 60) : '';
    const event = req.body?.event as PlayEvent;
    if (!level || !PLAY_EVENTS.includes(event)) return reply.code(400).send({ error: `expected { level, event: ${PLAY_EVENTS.join('|')} }` });
    const n = (v: unknown) => Math.max(0, Math.min(999, Math.round(Number(v) || 0)));
    await plays.add({ level, event, tries: n(req.body?.tries), placed: n(req.body?.placed) });
    return reply.code(204).send();
  });

  app.get<{ Querystring: { days?: string } }>('/api/machine/stats', async (req) => ({
    levels: await plays.stats(Math.max(1, Math.min(30, num(req.query.days, 7)))),
  }));

  return app;
}
