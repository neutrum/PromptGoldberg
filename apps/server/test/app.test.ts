import { afterEach, describe, expect, it } from 'vitest';
import { checkShot, controlValues, type Level, type LevelStreamEvent } from '@og/shared';
import slingshot from '@og/shared/fixtures/slingshot.json' with { type: 'json' };
import { buildApp, type Limits } from '../src/app';
import type { LlmBackend } from '@og/ai';
import { parseSse } from '../src/sse';
import { FakeLlm, clone, impossibleSpec, levelReply, slingshotLevel, tempDir } from './helpers';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(llm: LlmBackend | null, limits: Partial<Limits> = {}) {
  const tmp = tempDir();
  const app = await buildApp({
    llm, dataDir: tmp.dir, solver: 'inline',
    limits: { solveBudget: 80, solveTimeMs: 5000, perMinute: 50, perDay: 100, ...limits },
  });
  cleanups.push(() => app.close(), tmp.cleanup);
  return app;
}

const levelOf = (events: LevelStreamEvent[]) => events.find((e) => e.type === 'level') as Extract<LevelStreamEvent, { type: 'level' }> | undefined;

describe('POST /api/level', () => {
  it('designs, verifies, streams progress and returns a solved level with a missing start', async () => {
    const llm = new FakeLlm([levelReply()]);
    const app = await setup(llm);
    const res = await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'A probe tours the giants' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSse(res.body);
    expect(events.filter((e) => e.type === 'stage').map((e) => e.type === 'stage' && e.stage)).toEqual(['designing', 'verifying']);
    expect(events.some((e) => e.type === 'progress')).toBe(true);
    expect(events.at(-1)?.type).toBe('level');

    const done = levelOf(events)!;
    expect(done).toMatchObject({ solved: true, attempts: 1, cached: false });
    const level: Level = done.level;
    expect(level.player).toBe('probe');
    expect(level.briefing).toBe('Swing past Jove and reach Rime.');
    expect(level.tip).toBe('Lead your target.');
    expect(level.controls.map((c) => c.label)).toEqual(['Power', 'Aim', 'Launch time']);
    expect(checkShot(level, level.solution!.values).goal.success).toBe(true);
    expect(checkShot(level, controlValues(level)).goal.success).toBe(false);
    expect(llm.requests).toHaveLength(1);

    // Same prompt modulo case and punctuation: served from the cache without the LLM.
    const again = await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'a probe tours the giants!' } });
    const cached = parseSse(again.body);
    expect(cached).toHaveLength(1);
    expect(levelOf(cached)).toMatchObject({ cached: true, solved: true });
    expect(llm.requests).toHaveLength(1);
  });

  it('redesigns when the first design cannot be solved', async () => {
    const llm = new FakeLlm([levelReply(impossibleSpec()), levelReply()]);
    const app = await setup(llm, { solveBudget: 30 });
    const events = parseSse((await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'hit rime fast' } })).body);
    const stages = events.flatMap((e) => (e.type === 'stage' ? [e.stage] : []));
    expect(stages).toEqual(['designing', 'verifying', 'redesigning', 'verifying']);
    expect(llm.requests[1].prompt).toMatch(/could not be solved/);
    expect(levelOf(events)).toMatchObject({ solved: true, attempts: 2 });
  });

  it('returns the best unsolved level after max attempts', async () => {
    const llm = new FakeLlm([levelReply(impossibleSpec())]);
    const app = await setup(llm, { solveBudget: 10, maxAttempts: 2 });
    const events = parseSse((await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'impossible' } })).body);
    const done = levelOf(events)!;
    expect(done).toMatchObject({ solved: false, attempts: 2 });
    expect(done.level.solution).toBeUndefined();
  });

  it('retries once on an invalid reply and streams errors', async () => {
    const llm = new FakeLlm(['not json at all', levelReply()]);
    const app = await setup(llm);
    const events = parseSse((await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'retry me' } })).body);
    expect(levelOf(events)?.solved).toBe(true);

    const broken = await setup(new FakeLlm(['nope']));
    const failed = parseSse((await broken.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'broken' } })).body);
    expect(failed.at(-1)).toMatchObject({ type: 'error' });

    const empty = await broken.inject({ method: 'POST', url: '/api/level', payload: { prompt: '   ' } });
    expect(empty.statusCode).toBe(400);
    expect(parseSse(empty.body)[0].type).toBe('error');
    const long = await broken.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'x'.repeat(2000) } });
    expect(parseSse(long.body)[0]).toMatchObject({ type: 'error' });
  });

  it('rate limits per IP, caps daily LLM calls and reports a missing backend', async () => {
    const app = await setup(new FakeLlm([levelReply()]), { perMinute: 1 });
    await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'one' } });
    const limited = await app.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'two' } });
    expect(limited.statusCode).toBe(429);
    expect(parseSse(limited.body)[0]).toMatchObject({ type: 'error' });

    const capped = await setup(new FakeLlm([levelReply()]), { dailyLlmCalls: 1 });
    await capped.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'one' } });
    const over = await capped.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'two' } });
    expect(over.statusCode).toBe(503);
    expect((parseSse(over.body)[0] as { error: string }).error).toMatch(/daily AI budget/);

    const none = await setup(null);
    const res = await none.inject({ method: 'POST', url: '/api/level', payload: { prompt: 'hello' } });
    expect(res.statusCode).toBe(503);
    const health = await none.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toMatchObject({ ok: true, llm: null, gallery: 0 });
  });
});

describe('POST /api/edit', () => {
  it('applies an edit and keeps the player and controls', async () => {
    const heavier = clone(slingshot);
    heavier.bodies.find((b) => b.id === 'jove')!.mass *= 1.5;
    heavier.tunables = []; // the reply dropped the tunables; the controls must come back
    const llm = new FakeLlm([levelReply(heavier, { briefing: undefined })]);
    const app = await setup(llm, { solveBudget: 300, solveTimeMs: 20_000 });
    const level = slingshotLevel();
    const res = await app.inject({ method: 'POST', url: '/api/edit', payload: { level, instruction: 'make the gas giant heavier' } });
    const events = parseSse(res.body);
    expect(events[0]).toMatchObject({ type: 'stage', stage: 'editing' });
    expect(llm.requests[0].prompt).toMatch(/make the gas giant heavier/);
    const done = levelOf(events)!;
    expect(done).toBeDefined();
    expect(done.level.player).toBe('probe');
    expect(done.level.par).toBe(level.par);
    expect(done.level.controls.map((c) => c.path)).toEqual(level.controls.map((c) => c.path));
    expect(done.level.spec.bodies.find((b) => b.id === 'jove')!.mass).toBeCloseTo(0.000955 * 1.5);
    if (done.solved) expect(checkShot(done.level, done.level.solution!.values).goal.success).toBe(true);

    const bad = await app.inject({ method: 'POST', url: '/api/edit', payload: { level: { id: 'x' }, instruction: 'hi' } });
    expect(bad.statusCode).toBe(400);
  }, 60_000);
});

describe('POST /api/coach', () => {
  it('returns a tip, falling back to rules when the LLM fails', async () => {
    const level = slingshotLevel();
    const values = [2, 20, 0.05];
    const { goal } = checkShot(level, values);
    const payload = { level, values, pieces: [], shots: 1, goal, events: [] };

    const failing = await setup(new FakeLlm([new Error('down')]));
    const res = await failing.inject({ method: 'POST', url: '/api/coach', payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().tip).toMatch(/more power/);

    const vivid = await setup(new FakeLlm(['More oomph, captain!']));
    expect((await vivid.inject({ method: 'POST', url: '/api/coach', payload })).json()).toEqual({ tip: 'More oomph, captain!' });

    expect((await vivid.inject({ method: 'POST', url: '/api/coach', payload: { level } })).statusCode).toBe(400);
  });
});

describe('gallery endpoints', () => {
  it('publishes, lists, fetches and records results', async () => {
    const app = await setup(null);
    const published = await app.inject({ method: 'POST', url: '/api/gallery', payload: { level: slingshotLevel(), author: 'Ada' } });
    expect(published.statusCode).toBe(201);
    const id = published.json().id as string;

    const unsolved = await app.inject({ method: 'POST', url: '/api/gallery', payload: { level: { ...slingshotLevel(), solution: undefined } } });
    expect(unsolved.statusCode).toBe(400);

    const list = (await app.inject({ method: 'GET', url: '/api/gallery?sort=top' })).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id, author: 'Ada', plays: 0, clears: 0, title: 'Grand Tour' });

    const entry = (await app.inject({ method: 'GET', url: `/api/gallery/${id}` })).json();
    expect(entry.level.id).toBe(id);
    expect((await app.inject({ method: 'GET', url: '/api/gallery/missing' })).statusCode).toBe(404);

    const result = await app.inject({ method: 'POST', url: `/api/gallery/${id}/result`, payload: { cleared: true, shots: 3 } });
    expect(result.json()).toMatchObject({ plays: 1, clears: 1, bestShots: 3 });
    expect((await app.inject({ method: 'POST', url: `/api/gallery/${id}/result`, payload: { cleared: 'yes' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().gallery).toBe(1);
  });
});

describe('POST /api/machine/puzzle', () => {
  it('breaks a working machine into a fix-it puzzle without the LLM', async () => {
    const sample = (await import('@og/machine/fixtures/ramp-dominoes-bell.json', { with: { type: 'json' } })).default;
    const app = await setup(null);
    const res = await app.inject({ method: 'POST', url: '/api/machine/puzzle', payload: { machine: sample, kind: 'connect', seed: 7 } });
    expect(res.statusCode).toBe(200);
    const { puzzle } = res.json();
    expect(puzzle.kind).toBe('connect');
    expect(puzzle.missing.length).toBeGreaterThan(0);
    expect(puzzle.spec.parts.length + puzzle.missing.length).toBe(sample.parts.length);

    const bad = await app.inject({ method: 'POST', url: '/api/machine/puzzle', payload: { machine: sample, kind: 'nope' } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('POST /api/machine/verify', () => {
  it('runs a build and returns its trace hash, the same as a local run', async () => {
    const { initPhysics, simulateSync, traceHash, parseMachine } = await import('@og/machine');
    const sample = (await import('@og/machine/fixtures/ramp-dominoes-bell.json', { with: { type: 'json' } })).default;
    const app = await setup(null);
    const res = await app.inject({ method: 'POST', url: '/api/machine/verify', payload: { machine: sample } });
    expect(res.statusCode).toBe(200);
    await initPhysics();
    const local = parseMachine(sample);
    if (!local.ok) throw new Error('fixture');
    expect(res.json()).toEqual({ success: true, failedAt: null, hash: traceHash(simulateSync(local.spec)) });
  });
});

describe('POST /api/machine without an AI', () => {
  it('still builds a verified level from the mission\'s words, and says so', async () => {
    const app = await setup(null);
    const res = await app.inject({ method: 'POST', url: '/api/machine', payload: { prompt: 'ring the church bell across the river', verify: false } });
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body) as { type: string; solved?: boolean; machine?: { closest?: string } }[];
    const done = events.find((e) => e.type === 'machine');
    expect(done?.solved).toBe(true);
    expect(done?.machine?.closest).toMatch(/Offline builder: AI is unavailable/);
  }, 30_000);
});

describe('machine levels: gallery, clears, daily board, play log', () => {
  it('publishes a solved level, counts a clear only for a build the server runs', async () => {
    const { initPhysics, makeConnectPuzzle, parseMachine } = await import('@og/machine');
    const sample = (await import('@og/machine/fixtures/levels/first-shot.json', { with: { type: 'json' } })).default;
    await initPhysics();
    const spec = parseMachine(sample);
    if (!spec.ok) throw new Error('fixture');
    const app = await setup(null);
    const pub = await app.inject({ method: 'POST', url: '/api/machines', payload: { machine: spec.spec, mission: 'fire it in', author: 'Ada', tries: 2, parts: 2 } });
    expect(pub.statusCode).toBe(201);
    const id = pub.json().id as string;
    expect(pub.json().board[0]).toMatchObject({ name: 'Ada', tries: 2 });
    const broken = { ...spec.spec, parts: spec.spec.parts.filter((p) => !p.fixed && p.kind !== 'cannon') };
    expect((await app.inject({ method: 'POST', url: '/api/machines', payload: { machine: broken } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/machines' })).json().items.map((i: { id: string }) => i.id)).toContain(id);
    expect((await app.inject({ method: 'POST', url: `/api/machines/${id}/play` })).statusCode).toBe(200);

    const puzzle = makeConnectPuzzle(spec.spec)!;
    const clear = await app.inject({ method: 'POST', url: `/api/machines/${id}/clear`, payload: { placed: puzzle.missing, tries: 1, name: 'Bo' } });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().rank).toBe(1);
    const cheat = await app.inject({ method: 'POST', url: `/api/machines/${id}/clear`, payload: { placed: [{ id: 'extra', kind: 'cannon', x: 1, y: 0, z: 1, yaw: 0 }], tries: 1, name: 'Cy' } });
    expect(cheat.statusCode).toBe(400);
    const none = await app.inject({ method: 'POST', url: `/api/machines/${id}/clear`, payload: { placed: [], tries: 1, name: 'Cy' } });
    expect(none.statusCode).toBe(400);
    const entry = (await app.inject({ method: 'GET', url: `/api/machines/${id}` })).json();
    expect(entry).toMatchObject({ plays: 1, clears: 1 });
    expect(entry.board.map((b: { name: string }) => b.name)).toEqual(expect.arrayContaining(['Ada', 'Bo']));
  }, 60_000);

  it('logs how plays end and sums them per level', async () => {
    const app = await setup(null);
    for (const event of ['start', 'start', 'giveup', 'solve', 'hint']) {
      expect((await app.inject({ method: 'POST', url: '/api/machine/event', payload: { level: 'first-shot', event, tries: 4, placed: 2 } })).statusCode).toBe(204);
    }
    expect((await app.inject({ method: 'POST', url: '/api/machine/event', payload: { level: 'x', event: 'cheer' } })).statusCode).toBe(400);
    const stats = (await app.inject({ method: 'GET', url: '/api/machine/stats' })).json();
    expect(stats.levels[0]).toMatchObject({ level: 'first-shot', starts: 2, giveups: 1, solves: 1, hints: 1, giveupRate: 0.5, medianGiveupTries: 4 });
  });

  it('puts a daily on the board only with a build for every stage', async () => {
    const { DAILY_LADDER, dailySeed, makePuzzleOfKind, initPhysics } = await import('@og/machine');
    await initPhysics();
    const app = await setup(null);
    const daily = (await app.inject({ method: 'GET', url: '/api/machine/daily' })).json();
    const builds = [];
    for (const kind of DAILY_LADDER) {
      const p = makePuzzleOfKind(daily.machine, kind, { seed: dailySeed(daily.date) });
      if (p) builds.push(p.missing);
    }
    const res = await app.inject({ method: 'POST', url: '/api/machine/daily/score', payload: { date: daily.date, name: 'Ada', tries: 5, builds } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rank: 1 });
    const short = await app.inject({ method: 'POST', url: '/api/machine/daily/score', payload: { date: daily.date, name: 'Bo', tries: 1, builds: builds.slice(1) } });
    expect(short.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/machine/daily/scores' })).json().board).toHaveLength(1);
  }, 90_000);
});
