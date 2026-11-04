import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type Limits } from '../src/app';
import type { LlmBackend } from '@pg/ai';
import { parseSse } from '../src/sse';
import { tempDir } from './helpers';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(llm: LlmBackend | null, limits: Partial<Limits> = {}) {
  const tmp = tempDir();
  const app = await buildApp({
    llm, dataDir: tmp.dir, solver: 'inline',
    limits: { perMinute: 50, perDay: 100, ...limits },
  });
  cleanups.push(() => app.close(), tmp.cleanup);
  return app;
}

describe('POST /api/machine/puzzle', () => {
  it('turns a working machine into a level to build, without the LLM', async () => {
    const sample = (await import('@pg/core/fixtures/ramp-dominoes-bell.json', { with: { type: 'json' } })).default;
    const app = await setup(null);
    const res = await app.inject({ method: 'POST', url: '/api/machine/puzzle', payload: { machine: sample } });
    expect(res.statusCode).toBe(200);
    const { puzzle } = res.json();
    expect(puzzle.missing.length).toBeGreaterThan(0);
    expect(puzzle.spec.parts.length + puzzle.missing.length).toBe(sample.parts.length);

    const bad = await app.inject({ method: 'POST', url: '/api/machine/puzzle', payload: { machine: { ...sample, goal: [] } } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('POST /api/machine/verify', () => {
  it('runs a build and returns its trace hash, the same as a local run', async () => {
    const { initPhysics, simulateSync, traceHash, parseMachine } = await import('@pg/core');
    const sample = (await import('@pg/core/fixtures/ramp-dominoes-bell.json', { with: { type: 'json' } })).default;
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
    const events = parseSse(res.body) as { type: string; solved?: boolean; notes?: string[]; machine?: { closest?: string } }[];
    const done = events.find((e) => e.type === 'machine');
    expect(done?.solved).toBe(false);
    expect(done?.machine?.closest).toMatch(/Offline builder: AI is unavailable/);
    // Checked for fairness with the player's kit (up to three layouts, a few seconds each).
    expect(done?.notes?.join(' ')).toMatch(/Fair: a build from the kit|Not proven/);
  }, 120_000);
});

describe('machine levels: gallery, clears, daily board, play log', () => {
  it('publishes a solved level, counts a clear only for a build the server runs', async () => {
    const { initPhysics, makeConnectPuzzle, parseMachine } = await import('@pg/core');
    const sample = (await import('@pg/core/fixtures/levels/first-shot.json', { with: { type: 'json' } })).default;
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

  it('hands out one level a day and counts only a build that works', async () => {
    const { makeLevelPuzzle, initPhysics } = await import('@pg/core');
    await initPhysics();
    const app = await setup(null);
    const daily = (await app.inject({ method: 'GET', url: '/api/machine/daily' })).json();
    // Played like any new level: something to build with, nothing solved yet.
    expect(makeLevelPuzzle(daily.machine)).not.toBeNull();
    const res = await app.inject({ method: 'POST', url: '/api/machine/daily/score', payload: { date: daily.date, name: 'Ada', tries: 1, placed: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Not counted/);
    expect((await app.inject({ method: 'GET', url: '/api/machine/daily/scores' })).json().board).toHaveLength(0);
  }, 90_000);
});
