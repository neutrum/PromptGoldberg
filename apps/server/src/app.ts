import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { DailyStore, todayUtc } from './daily';
import { checkBuild, DailyBoard, MachineGallery, PLAY_EVENTS, playerName, PlayLog, type PlayEvent } from './machines';
import { GRID, LandmarkShape, makeLevelPuzzle, parseMachine, Stage, STAGE_MAX, STAGE_MIN, type MachineStreamEvent } from '@pg/core';
import { z } from 'zod';
import {
  composeGadget, fixGadget, labTest, createMachine, createMachineOffline, createPhysics, downloadMesh, listProviders, LlmError, meshMaker, SolverError, textBackend,
  type CreateMachineResult, type LlmBackend, type MachineRequest, type Physics, type SolverMode,
} from '@pg/ai';
import { DailyCap, RateLimiter } from './rateLimit';
import { openSse } from './sse';
import { registerRecipes } from './recipes';
import { playerMesh, playerText } from './byok';
import { PartLibrary } from './parts';
import { shrinkGlb } from './shrinkMesh';

export interface Limits {
  /** Per-IP requests to the AI endpoints (/api/machine, /api/machine/edit, /api/machine/solve). */
  perMinute: number;
  perDay: number;
  publishPerMinute: number;
  publishPerDay: number;
  resultsPerMinute: number;
  /** Global LLM calls per UTC day. */
  dailyLlmCalls: number;
  /** 3D models made on the server's own key per UTC day (players' own keys do not count). */
  dailyMeshes: number;
  maxPromptChars: number;
  maxInstructionChars: number;
  maxAttempts: number;
  /** Total time for one AI level request before the best level so far is returned. */
  levelDeadlineMs: number;
  /** How long a change to a level may take: past that the player gets the level back as it was. */
  editDeadlineMs: number;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
};

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Limits {
  return {
    perMinute: num(env.RATE_LIMIT_PER_MIN, 6),
    perDay: num(env.RATE_LIMIT_PER_DAY, 40),
    publishPerMinute: num(env.PUBLISH_RATE_LIMIT_PER_MIN, 4),
    publishPerDay: num(env.PUBLISH_RATE_LIMIT_PER_DAY, 30),
    resultsPerMinute: num(env.RESULT_RATE_LIMIT_PER_MIN, 30),
    dailyLlmCalls: num(env.DAILY_LLM_CALL_CAP, 1000),
    dailyMeshes: num(env.MESH_DAILY_CAP, 15),
    maxPromptChars: num(env.MAX_PROMPT_CHARS, 500),
    maxInstructionChars: num(env.MAX_INSTRUCTION_CHARS, 300),
    maxAttempts: num(env.LEVEL_MAX_ATTEMPTS, 3),
    levelDeadlineMs: num(env.LEVEL_DEADLINE_MS, 150_000),
    editDeadlineMs: num(env.EDIT_DEADLINE_MS, 25_000),
  };
}

export interface AppOptions {
  llm: LlmBackend | null;
  dataDir: string;
  solver?: SolverMode;
  physics?: Physics;
  limits?: Partial<Limits>;
  logger?: FastifyServerOptions['logger'];
  trustProxy?: boolean;
  /** The server's own 3D model provider, for players without a key of their own. */
  mesh?: { provider: string; key: string } | null;
  /** The recipe library file the review page writes (tests use a copy). */
  recipeFile?: string;
}

/** How long the workbench waits for the AI before handing over the closest known part. */
const WORKBENCH_MS = 60_000;

const LLM_UNAVAILABLE = 'No AI backend is configured on this server. Set ANTHROPIC_API_KEY (or LLM_BACKEND=cli for local development).';

export async function buildApp(opts: AppOptions) {
  const limits: Limits = { ...limitsFromEnv(), ...opts.limits };
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false, bodyLimit: 512 * 1024 });
  registerRecipes(app, opts.llm, opts.recipeFile);
  const physics = opts.physics ?? createPhysics(opts.solver ?? 'auto');
  const daily = new DailyStore(
    join(opts.dataDir, 'daily'),
    opts.llm && ((request) => createMachine(request, { llm: llm!, physics, maxAttempts: limits.maxAttempts, deadlineMs: limits.levelDeadlineMs })),
    (prompt) => createMachineOffline(prompt, { physics }),
  );
  const machines = await MachineGallery.open(opts.dataDir);
  const dailyBoard = await DailyBoard.open(opts.dataDir);
  const kept = await PartLibrary.open(opts.dataDir);
  const plays = new PlayLog(join(opts.dataDir, 'plays'));
  const llmLimiter = new RateLimiter(limits.perMinute, limits.perDay);
  const publishLimiter = new RateLimiter(limits.publishPerMinute, limits.publishPerDay);
  const resultLimiter = new RateLimiter(limits.resultsPerMinute, limits.resultsPerMinute * 60 * 24);
  const cap = new DailyCap(limits.dailyLlmCalls, Date.now, join(opts.dataDir, 'llm-calls.json'));
  const meshCap = new DailyCap(limits.dailyMeshes, Date.now, join(opts.dataDir, 'mesh-calls.json'));

  const capExhausted = () => cap.used >= cap.cap;
  /** How long the physics search looks for a build from the player's kit. */
  const KIT_SOLVE_MS = 20_000;
  const CAP_MESSAGE = 'The AI level designer is resting: the demo has used its daily AI budget. Try the puzzles or the community levels, and come back tomorrow.';
  // Every LLM call counts against the global daily cap.
  const llm: LlmBackend | null = opts.llm && {
    name: opts.llm.name,
    complete: (req) => {
      if (!cap.take()) return Promise.reject(new LlmError(CAP_MESSAGE, true));
      return opts.llm!.complete(req);
    },
  };

  const errorMessage = (err: unknown): string => {
    // The AI's answers never made a valid design: say so plainly; the details are in the server log.
    if (err instanceof LlmError && err.message.startsWith('Could not get a valid design')) return 'The AI could not make that work this time. Nothing changed: try again, or say it another way.';
    if (err instanceof LlmError) return `AI design failed: ${err.message}`;
    if (err instanceof SolverError) return `Verification failed: ${err.message}`;
    return 'Something went wrong while building the level. Please try again.';
  };

  /** Prompt Goldberg: the whole AI side is one call too. */
  const runMachineAi = async (request: MachineRequest, emit: (e: MachineStreamEvent) => void, signal: AbortSignal, ai: LlmBackend): Promise<Extract<MachineStreamEvent, { type: 'machine' }>> => {
    const res: CreateMachineResult = await createMachine(request, {
      llm: ai, physics, signal, onEvent: emit,
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

  type Refused = { status: number; error: string };
  /**
   * The AI for a request: the player's own provider and key when they sent one (outside the
   * server's daily budget), else the server's. A 503 means no AI today: callers fall back to words.
   */
  const aiFor = (req: FastifyRequest): { llm: LlmBackend } | Refused => {
    const own = playerText(req);
    let ai: LlmBackend | null = llm;
    if (own) {
      try { ai = textBackend(own.provider, own.config); } catch (err) { return { status: 400, error: err instanceof Error ? err.message : String(err) }; }
    } else {
      if (!llm) return { status: 503, error: LLM_UNAVAILABLE };
      if (capExhausted()) return { status: 503, error: CAP_MESSAGE };
    }
    const limited = llmLimiter.take(req.ip);
    return limited ? { status: 429, error: limited.error } : { llm: ai! };
  };
  const refused = (r: object): r is Refused => 'status' in r;

  app.get('/api/health', async () => ({
    ok: true,
    llm: opts.llm?.name ?? null,
    solver: physics.mode,
    llmCallsToday: cap.used,
    dailyLlmCallCap: cap.cap,
  }));

  app.post<{ Body: { prompt?: unknown; stage?: unknown } }>('/api/machine', async (req, reply) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    // The default 24 by 24 stage is sent as no stage, so existing levels and caches stay the same.
    const staged = req.body?.stage === undefined ? undefined : Stage.safeParse(req.body.stage);
    if (staged && !staged.success) return sseError(reply, 400, `The stage must be ${STAGE_MIN} to ${STAGE_MAX} cells each way.`);
    const stage = staged?.data && (staged.data.x !== GRID.x || staged.data.z !== GRID.z) ? staged.data : undefined;
    if (!prompt) return sseError(reply, 400, 'Describe the machine you want, e.g. "get the ball into the bucket using dominoes and a fan".');
    if (prompt.length > limits.maxPromptChars) return sseError(reply, 400, `That description is too long: keep it under ${limits.maxPromptChars} characters.`);
    const ai = aiFor(req);
    // No AI (none configured, or the day's budget is spent): the route compiler still builds a level from the words.
    const offline = refused(ai) && ai.status === 503;
    if (refused(ai) && !offline) return sseError(reply, ai.status, ai.error);
    const stream = openSse<MachineStreamEvent>(reply);
    const started = Date.now();
    try {
      const event = refused(ai)
        ? await runMachineOffline(prompt, stream.send, stream.signal, stage)
        : await runMachineAi({ prompt, stage }, stream.send, stream.signal, ai.llm);
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

  /** Today's level, generated once per UTC day for everyone. */
  app.get('/api/machine/daily', async (req) => {
    const started = Date.now();
    const result = await daily.get();
    if (Date.now() - started > 1000) req.log.info({ ms: Date.now() - started, generated: result.generated }, 'daily machine generated');
    return result;
  });

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

  /** A working machine as a level: its route parts go to the player's hand. */
  app.post<{ Body: { machine?: unknown } }>('/api/machine/puzzle', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return reply.code(400).send({ error: `The machine is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}` });
    const started = Date.now();
    const puzzle = await physics.puzzle(parsed.spec);
    req.log.info({ ms: Date.now() - started, physics: physics.mode, found: !!puzzle }, 'puzzle generated');
    return { puzzle };
  });

  /**
   * Only when the player asks: a way through their level. First with the player's own kit, by
   * physics search (no AI call); otherwise the AI looks for one by adding parts.
   */
  app.post<{ Body: { machine?: unknown } }>('/api/machine/solve', async (req, reply) => {
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return sseError(reply, 400, `The level is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
    const spares = parsed.spec.spares;
    if (spares?.length) {
      const limited = resultLimiter.take(req.ip);
      if (limited) return sseError(reply, 429, limited.error);
      const stream = openSse<MachineStreamEvent>(reply);
      const started = Date.now();
      try {
        stream.send({ type: 'stage', stage: 'editing', attempt: 1, maxAttempts: 1, message: 'Trying your parts in the places the ball goes.' });
        // A level sent with its kit has no hidden route (it has a par instead): the kit is the whole hand.
        const kit = await physics.kitSolve({ ...parsed.spec, par: parsed.spec.par ?? spares.length }, { budgetMs: KIT_SOLVE_MS, signal: stream.signal });
        req.log.info({ ms: Date.now() - started, solved: !!kit?.solved, sims: kit?.sims }, 'kit solve done');
        if (kit?.solved) {
          stream.send({ type: 'machine', machine: { ...parsed.spec, parts: [...parsed.spec.parts, ...kit.placed] }, solved: true, verified: true, attempts: 1, cached: false, result: kit.result, moved: [],
            notes: [`Found with your own parts after ${kit.sims} test runs.`] });
          return;
        }
        // Not with the kit: the AI may still find a way with other parts, when it is available.
        const ai = aiFor(req);
        if (refused(ai) || !kit) {
          stream.send({ type: 'machine', machine: parsed.spec, solved: false, verified: true, attempts: 1, cached: false, result: kit?.result ?? { success: false, satisfiedCount: 0, score: 0, progress: 0, failedAt: 0, steps: [] }, moved: [], notes: [] });
          return;
        }
        stream.send(await runMachineAi({ solve: parsed.spec }, stream.send, stream.signal, ai.llm));
      } catch (err) {
        if (!stream.signal.aborted) { req.log.error({ err }, 'level solve failed'); stream.send({ type: 'error', error: errorMessage(err) }); }
      } finally {
        stream.close();
      }
      return;
    }
    const ai = aiFor(req);
    if (refused(ai)) return sseError(reply, ai.status, ai.error);
    const stream = openSse<MachineStreamEvent>(reply);
    const started = Date.now();
    try {
      const event = await runMachineAi({ solve: parsed.spec }, stream.send, stream.signal, ai.llm);
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

  app.post<{ Body: { machine?: unknown; instruction?: unknown } }>('/api/machine/edit', async (req, reply) => {
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
    if (!instruction) return sseError(reply, 400, 'Say what to change, e.g. "swap the fan for a cannon".');
    if (instruction.length > limits.maxInstructionChars) return sseError(reply, 400, `That change is too long: keep it under ${limits.maxInstructionChars} characters.`);
    const parsed = parseMachine(req.body?.machine);
    if (!parsed.ok) return sseError(reply, 400, `The machine to edit is invalid: ${parsed.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
    const ai = aiFor(req);
    if (refused(ai)) return sseError(reply, ai.status, ai.error);
    const stream = openSse<MachineStreamEvent>(reply);
    const late = AbortSignal.timeout(limits.editDeadlineMs);
    try {
      // A change to a level in play: the player builds the way, nothing needs to work yet.
      const event = await runMachineAi({ machine: parsed.spec, instruction }, stream.send, AbortSignal.any([stream.signal, late]), ai.llm);
      stream.send(event);
    } catch (err) {
      if (stream.signal.aborted) req.log.info('client disconnected during machine stream');
      else if (late.aborted) {
        req.log.warn({ instruction: instruction.slice(0, 80) }, 'machine edit took too long');
        stream.send({ type: 'error', error: 'That change took too long. Nothing changed: try again, or say it in fewer words.' });
      }
      else {
        req.log.error({ err }, 'machine edit failed');
        stream.send({ type: 'error', error: errorMessage(err) });
      }
    } finally {
      stream.close();
    }
  });

  // The workbench: the level designer describes a new part for the player. Without an AI the known ones are made by word.
  app.post<{ Body: { text?: unknown } }>('/api/workbench', async (req, reply) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return reply.code(400).send({ error: 'Say what part to make, e.g. "a chute with rails".' });
    if (text.length > limits.maxInstructionChars) return reply.code(400).send({ error: `Keep it under ${limits.maxInstructionChars} characters.` });
    // A part made before, by its name or the words it was asked with: the kept one, no AI. One the ball does not
    // get through is made again when the AI can.
    const known = kept.find(text), knownTest = known && await labTest(known);
    const fromLibrary = known && { gadget: { name: known.name, shapes: known.shapes, library: known.id, ...(known.model ? { model: known.model } : {}), closest: `“${known.name}” came from the workbench library.`, test: knownTest } };
    if (fromLibrary && knownTest?.verdict === 'through') return fromLibrary;
    const ai = aiFor(req);
    if (refused(ai) && ai.status === 503) return fromLibrary || { gadget: await composeGadget(null, text) };
    if (refused(ai)) return reply.code(ai.status).send({ error: ai.error });
    try {
      // A minute at most: past that the designer gets the closest known part and can ask again.
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('workbench took over a minute')), WORKBENCH_MS); });
      let made;
      // An AI call takes up to about half a minute, so no retry starts in the last 30 s.
      try { made = await Promise.race([composeGadget(ai.llm, text, [], { retryUntil: Date.now() + WORKBENCH_MS - 30_000 }), late]); } finally { clearTimeout(timer); }
      // A new part the ball gets through takes the place of a kept one by the same name that it does not.
      const old = made.test?.verdict === 'through' ? kept.find(made.name) : undefined;
      if (old && (await labTest(old)).verdict !== 'through') await kept.reshape(old.id, made);
      const part = await kept.add(made, text);
      return { gadget: { name: part.name, shapes: part.shapes, library: part.id, ...(part.model ? { model: part.model } : {}), ...(made.test ? { test: made.test } : {}), ...(made.closest ? { closest: made.closest } : {}) } };
    } catch (err) {
      req.log.error({ err }, 'workbench failed');
      // Never a dead end: the part known by word, or a chute, with what happened.
      return { gadget: { ...await composeGadget(null, text), closest: `The AI could not build “${text.slice(0, 60)}”, so here is the closest known part.` } };
    }
  });

  // The test lab: a ball dropped on a part's high end in the physics, and what became of it. No AI.
  const LabPart = z.object({ name: z.string().min(1).max(40), shapes: z.array(LandmarkShape).min(1).max(10) });
  app.post<{ Body: unknown }>('/api/workbench/test', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const part = LabPart.safeParse(req.body);
    if (!part.success) return reply.code(400).send({ error: 'Send the part: { name, shapes }.' });
    return { test: await labTest(part.data) };
  });

  // A part changed in words ("tilt the landing"), tested again; a kept part in the library takes the new shape when the ball gets through.
  app.post<{ Body: { name?: unknown; shapes?: unknown; change?: unknown; library?: unknown } }>('/api/workbench/fix', async (req, reply) => {
    const change = typeof req.body?.change === 'string' ? req.body.change.trim().slice(0, limits.maxInstructionChars) : '';
    // A part from the shared library is changed from the library's own copy, never from shapes the request sends.
    const kept_ = typeof req.body?.library === 'string' ? kept.get(req.body.library) : undefined;
    const part = kept_ ? LabPart.safeParse({ name: kept_.name, shapes: kept_.shapes }) : LabPart.safeParse(req.body);
    if (!part.success || !change) return reply.code(400).send({ error: 'Say what to change, e.g. "tilt the landing".' });
    const ai = aiFor(req);
    if (refused(ai)) return reply.code(ai.status).send({ error: ai.status === 503 ? 'Fixing a part needs the AI, and this server has none.' : ai.error });
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('the fix took over a minute')), WORKBENCH_MS); });
    try {
      const fixed = await Promise.race([fixGadget(ai.llm, part.data, await labTest(part.data), change), late]);
      if (kept_ && fixed.test?.verdict === 'through') await kept.reshape(kept_.id, fixed);
      return { gadget: { ...fixed, ...(kept_ ? { library: kept_.id } : {}) } };
    } catch (err) {
      req.log.error({ err }, 'workbench fix failed');
      return reply.code(502).send({ error: 'The AI could not make that change this time. Nothing changed: try again, or say it another way.' });
    } finally { clearTimeout(timer); }
  });

  // Every part made on the workbench, newest first, for the designer to hand out again.
  app.get('/api/workbench/parts', async () => ({ items: kept.list().map(({ id, name, shapes, model }) => ({ library: id, name, shapes, ...(model ? { model } : {}) })) }));

  // Providers a player can bring a key for; the settings screen lists them from here.
  app.get('/api/providers', async () => ({ server: opts.llm ? 'claude' : null, mesh: opts.mesh ? { left: Math.max(0, meshCap.cap - meshCap.used) } : null, providers: listProviders() }));

  // A tiny call on the player's own text provider, so Settings can say whether the key works.
  app.post('/api/providers/test', async (req, reply) => {
    const own = playerText(req);
    if (!own) return reply.code(400).send({ error: 'Pick a provider and add your key first.' });
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const started = Date.now();
    try {
      const answer = await textBackend(own.provider, own.config).complete({ system: 'Reply with JSON only.', prompt: 'Reply with {"ok": true}.', maxTokens: 200, thinking: 'off', signal: AbortSignal.timeout(30_000) });
      return { ok: /"ok"\s*:\s*true/.test(answer.text), ms: Date.now() - started };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // A 3D look for a workbench part, on the player's own mesh provider or else the server's: start, then poll
  // until it is done. The finished model is kept here under its hash, so levels that use it can be shared.
  const meshDir = join(opts.dataDir, 'meshes');
  const MESH_TASK = /^[\w:.-]{1,160}$/;
  const meshFor = (req: FastifyRequest) => {
    const own = playerMesh(req);
    if (own) return meshMaker(own.provider, own.config);
    if (opts.mesh) return meshMaker(opts.mesh.provider, { key: opts.mesh.key });
    throw new LlmError('Pick a 3D model provider in Settings first.');
  };
  app.post<{ Body: { prompt?: unknown } }>('/api/mesh', async (req, reply) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 300) : '';
    if (!prompt) return reply.code(400).send({ error: 'Say what to model.' });
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    // A model on the server's key costs its credits: the AI limit per player and a daily cap of its own.
    if (!playerMesh(req) && opts.mesh) {
      const each = llmLimiter.take(req.ip);
      if (each) return reply.code(429).send({ error: each.error });
      if (!meshCap.take()) return reply.code(429).send({ error: 'Today’s free 3D looks are used up; the part keeps its shapes. Add your own 3D model key in Settings, or come back tomorrow.' });
    }
    try {
      return { task: await meshFor(req).start(prompt) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get<{ Params: { task: string }; Querystring: { part?: string } }>('/api/mesh/:task', async (req, reply) => {
    if (!MESH_TASK.test(req.params.task)) return reply.code(400).send({ error: 'bad task id' });
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    try {
      const maker = meshFor(req);
      const check = await maker.check(req.params.task);
      if (check.status !== 'done') return check;
      const bytes = shrinkGlb(await downloadMesh(maker.provider, check.url));
      const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.glb`;
      await mkdir(meshDir, { recursive: true });
      await writeFile(join(meshDir, name), bytes);
      req.log.info({ provider: maker.provider.id, bytes: bytes.length }, 'mesh kept');
      const model = `/api/meshes/${name}`;
      // The look of a part in the workbench library goes with it from now on.
      if (typeof req.query.part === 'string') await kept.look(req.query.part, model);
      return { status: 'done', model };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get<{ Params: { file: string } }>('/api/meshes/:file', async (req, reply) => {
    if (!/^[a-f0-9]{32}\.glb$/.test(req.params.file)) return reply.code(404).send({ error: 'not found' });
    const bytes = await readFile(join(meshDir, req.params.file)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: 'not found' });
    return reply.type('model/gltf-binary').header('cache-control', 'public, max-age=31536000, immutable').send(bytes);
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
    if (!(await physics.puzzle(parsed.spec))) return reply.code(400).send({ error: 'the level has nothing for a player to build' });
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
    const puzzle = await physics.puzzle(entry.machine);
    if (!puzzle) return reply.code(409).send({ error: 'this level cannot be played any more' });
    const checked = await checkBuild(physics, puzzle, req.body?.placed);
    if (!checked.ok) return reply.code(400).send({ error: `Not counted: ${checked.error}.` });
    const tries = Math.max(1, Math.min(99, Math.round(Number(req.body?.tries) || 1)));
    return machines.cleared(entry.id, { name: playerName(req.body?.name), parts: checked.parts, tries });
  });

  // The daily leaderboard: the build is re-run on the server against today's level.
  app.get<{ Querystring: { date?: string } }>('/api/machine/daily/scores', async (req) => {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayUtc();
    return { date, board: dailyBoard.top(date) };
  });

  app.post<{ Body: { date?: unknown; name?: unknown; tries?: unknown; placed?: unknown } }>('/api/machine/daily/score', async (req, reply) => {
    const limited = resultLimiter.take(req.ip);
    if (limited) return reply.code(429).send({ error: limited.error });
    const date = req.body?.date;
    if (date !== todayUtc()) return reply.code(400).send({ error: "Only today's level counts." });
    const today = await daily.get(date);
    const puzzle = makeLevelPuzzle(today.machine);
    if (!puzzle) return reply.code(409).send({ error: "today's level has nothing to build" });
    const checked = await checkBuild(physics, puzzle, req.body?.placed);
    if (!checked.ok) return reply.code(400).send({ error: `Not counted: ${checked.error}.` });
    const tries = Math.max(1, Math.min(999, Math.round(Number(req.body?.tries) || 1)));
    return { date, ...(await dailyBoard.add(date, { name: playerName(req.body?.name), tries, parts: checked.parts })) };
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
