import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import {
  evaluateGoal, parseLevel, parseSpec, simulate,
  type CoachRequest, type GallerySort, type Level, type LevelStreamEvent,
} from '@og/shared';
import { LevelCache } from './cache';
import { GalleryStore } from './gallery';
import { parseMachine, type MachineStreamEvent } from '@og/machine';
import {
  coachTip, createLevel, createMachine, createPhysics, createSolver, designSystem, LlmError, SolverError,
  type CreateLevelResult, type CreateMachineResult, type LevelRequest, type LlmBackend, type MachineRequest, type Physics, type Solver, type SolverMode,
} from '@og/ai';
import { DailyCap, RateLimiter } from './rateLimit';
import { openSse } from './sse';

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
}

const LLM_UNAVAILABLE = 'No AI backend is configured on this server. Set ANTHROPIC_API_KEY (or LLM_BACKEND=cli for local development).';

export async function buildApp(opts: AppOptions) {
  const limits: Limits = { ...limitsFromEnv(), ...opts.limits };
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false, bodyLimit: 512 * 1024 });
  const solver = typeof opts.solver === 'object' ? opts.solver : createSolver(opts.solver ?? 'auto');
  const physics = opts.physics ?? createPhysics(typeof opts.solver === 'string' ? opts.solver : 'auto');
  const gallery = await GalleryStore.open(opts.dataDir, limits.galleryMaxEntries);
  const cache = new LevelCache(join(opts.dataDir, 'cache'));
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
    return { type: 'machine', machine: res.machine, solved: res.solved, attempts: res.attempts, notes: res.notes, cached: false, result: res.result, moved: res.moved };
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

  app.post<{ Body: { prompt?: unknown } }>('/api/machine', async (req, reply) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return sseError(reply, 400, 'Describe the machine you want, e.g. "get the ball into the bucket using dominoes and a fan".');
    if (prompt.length > limits.maxPromptChars) return sseError(reply, 400, `That description is too long: keep it under ${limits.maxPromptChars} characters.`);
    const blocked = guardLlm(req);
    if (blocked) return sseError(reply, blocked.status, blocked.error);
    const stream = openSse<MachineStreamEvent>(reply);
    const started = Date.now();
    try {
      const event = await runMachineAi({ prompt }, stream.send, stream.signal);
      stream.send(event);
      req.log.info({ ms: Date.now() - started, solved: event.solved, attempts: event.attempts }, 'machine stream done');
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

  app.post<{ Body: { machine?: unknown; instruction?: unknown } }>('/api/machine/edit', async (req, reply) => {
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
    if (!instruction) return sseError(reply, 400, 'Say what to change, e.g. "swap the fan for a cannon".');
    if (instruction.length > limits.maxInstructionChars) return sseError(reply, 400, `That change is too long: keep it under ${limits.maxInstructionChars} characters.`);
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return sseError(reply, 400, `The machine to edit is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
    const blocked = guardLlm(req);
    if (blocked) return sseError(reply, blocked.status, blocked.error);
    const stream = openSse<MachineStreamEvent>(reply);
    try {
      const event = await runMachineAi({ machine: parsed.spec, instruction }, stream.send, stream.signal);
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

  return app;
}
