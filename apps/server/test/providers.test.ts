import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProvider, type Completion } from '@pg/ai';
import { buildApp } from '../src/app';
import { tempDir } from './helpers';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const c of cleanups.splice(0)) await c();
});

async function setup() {
  const tmp = tempDir();
  // No AI of the server's own: only what the player brings.
  const app = await buildApp({ llm: null, dataDir: tmp.dir, solver: 'inline', limits: { perMinute: 50, perDay: 100, dailyLlmCalls: 0 } });
  cleanups.push(() => app.close(), tmp.cleanup);
  return app;
}

// A provider a host adds at start-up: it answers the workbench with a fixed part and remembers the key it got.
const keys: string[] = [], prompts: string[] = [];
registerProvider({
  id: 'fake', name: 'Fake', kind: 'text', keyUrl: 'https://example.test', keyHint: 'k-...',
  create: ({ key }) => ({
    name: 'fake',
    complete: async (req): Promise<Completion> => {
      keys.push(key);
      prompts.push(req.prompt);
      return { text: JSON.stringify({ name: 'fake chute', shapes: SLOPE }), backend: 'fake' };
    },
  }),
});
// A tilted plank with rails, which the test lab passes, and a flat one it does not.
const SLOPE = [
  { shape: 'box', at: [0, 0.4, 0], size: [3, 0.1, 1], color: '#ff0000', tilt: 14 },
  { shape: 'box', at: [0, 0.45, -0.45], size: [3, 0.4, 0.1], color: '#333333', tilt: 14 },
  { shape: 'box', at: [0, 0.45, 0.45], size: [3, 0.4, 0.1], color: '#333333', tilt: 14 },
];
const FLAT = [{ shape: 'box', at: [0, 0, 0], size: [2, 0.2, 1], color: '#ff0000' }];
// A provider whose parts pass the lab only once `flaky.good` is set.
const flaky = { good: false, calls: 0 };
registerProvider({
  id: 'flaky', name: 'Flaky', kind: 'text', keyUrl: 'https://example.test', keyHint: 'k-...',
  create: () => ({ name: 'flaky', complete: async (): Promise<Completion> => { flaky.calls++; return { text: JSON.stringify({ name: 'wobbly ramp', shapes: flaky.good ? SLOPE : FLAT }), backend: 'flaky' }; } }),
});
registerProvider({
  id: 'fake-mesh', name: 'Fake mesh', kind: 'mesh', keyUrl: 'https://example.test', keyHint: 'm-...', downloadHosts: /^models\.example\.test$/,
  create: () => ({ start: async () => 'task-1', check: async (task) => (task === 'task-1' ? { status: 'done', url: 'https://models.example.test/a.glb' } : { status: 'failed', error: 'no' }) }),
});

describe('players’ own providers', () => {
  it('lists the built-in providers and any a host registers, without their code', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/providers' });
    const ids = (res.json().providers as { id: string; create?: unknown }[]).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['anthropic', 'openai', 'openai-compatible', 'tripo', 'meshy', 'fake', 'fake-mesh']));
    expect(JSON.stringify(res.json())).not.toContain('create');
    expect(res.json().server).toBeNull();
  });

  it('runs the AI on the player’s key, outside the server’s spent budget', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/workbench', payload: { text: 'a chute' }, headers: { 'x-pg-text-provider': 'fake', 'x-pg-text-key': 'player-key' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().gadget.name).toBe('fake chute');
    expect(keys.at(-1)).toBe('player-key');
    // Without the key a new ask gets the part known by word, with no AI call.
    const plain = await app.inject({ method: 'POST', url: '/api/workbench', payload: { text: 'a ski jump' } });
    expect(plain.json().gadget.name).toBe('ski jump');
  });

  it('says what is wrong with an unknown provider or a missing key', async () => {
    const app = await setup();
    const unknown = await app.inject({ method: 'POST', url: '/api/workbench', payload: { text: 'a chute' }, headers: { 'x-pg-text-provider': 'nope', 'x-pg-text-key': 'k' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toMatch(/Unknown AI provider/);
    const keyless = await app.inject({ method: 'POST', url: '/api/workbench', payload: { text: 'a chute' }, headers: { 'x-pg-text-provider': 'fake' } });
    expect(keyless.json().error).toMatch(/Add your key/);
  });

  it('keeps every part made in the workbench library: asked again, it comes back with its look and no AI call', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([...new TextEncoder().encode('glTF'), 2, 0, 0, 0])));
    const app = await setup();
    const own = { 'x-pg-text-provider': 'fake', 'x-pg-text-key': 'k1', 'x-pg-mesh-provider': 'fake-mesh', 'x-pg-mesh-key': 'm' };
    const made = (await app.inject({ method: 'POST', url: '/api/workbench', payload: { text: 'A chute!' }, headers: own })).json().gadget;
    expect(made.library).toMatch(/^[a-f0-9]{12}$/);
    const look = (await app.inject({ method: 'GET', url: `/api/mesh/task-1?part=${made.library}`, headers: own })).json().model;
    const calls = keys.length;
    // Anyone, without a key, by the words it was asked with or by its name.
    for (const text of ['a chute', 'Fake chute']) {
      const again = (await app.inject({ method: 'POST', url: '/api/workbench', payload: { text } })).json().gadget;
      expect(again).toMatchObject({ name: 'fake chute', library: made.library, model: look });
    }
    expect(keys.length).toBe(calls);
    const list = (await app.inject({ method: 'GET', url: '/api/workbench/parts' })).json().items;
    expect(list).toEqual([expect.objectContaining({ library: made.library, name: 'fake chute', model: look })]);
  });

  it('makes a 3D look on the player’s mesh provider and keeps the model here', async () => {
    const glb = new Uint8Array([...new TextEncoder().encode('glTF'), 2, 0, 0, 0]);
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: URL | string, init?: RequestInit) => {
      fetched.push(String(url));
      expect(JSON.stringify(init?.headers ?? {})).not.toContain('player-mesh-key');
      return new Response(glb);
    });
    const app = await setup();
    const headers = { 'x-pg-mesh-provider': 'fake-mesh', 'x-pg-mesh-key': 'player-mesh-key' };
    const start = await app.inject({ method: 'POST', url: '/api/mesh', payload: { prompt: 'a chute' }, headers });
    expect(start.json()).toEqual({ task: 'task-1' });
    const done = await app.inject({ method: 'GET', url: '/api/mesh/task-1', headers });
    expect(done.json().status).toBe('done');
    expect(done.json().model).toMatch(/^\/api\/meshes\/[a-f0-9]{32}\.glb$/);
    expect(fetched).toEqual(['https://models.example.test/a.glb']);
    const file = await app.inject({ method: 'GET', url: done.json().model });
    expect(file.headers['content-type']).toBe('model/gltf-binary');
    expect(new Uint8Array(file.rawPayload)).toEqual(glb);
    expect((await app.inject({ method: 'GET', url: '/api/meshes/..%2F..%2Fsecret.glb' })).statusCode).toBe(404);
  });

  it('makes 3D looks on the server’s own key for players without one, up to its daily cap', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([...new TextEncoder().encode('glTF'), 2, 0, 0, 0])));
    const tmp = tempDir();
    const app = await buildApp({ llm: null, dataDir: tmp.dir, solver: 'inline', mesh: { provider: 'fake-mesh', key: 'server-key' }, limits: { perMinute: 50, perDay: 100, dailyLlmCalls: 0, dailyMeshes: 1 } });
    cleanups.push(() => app.close(), tmp.cleanup);
    expect((await app.inject({ method: 'GET', url: '/api/providers' })).json().mesh).toEqual({ left: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/mesh', payload: { prompt: 'a chute' } })).json()).toEqual({ task: 'task-1' });
    expect((await app.inject({ method: 'GET', url: '/api/mesh/task-1' })).json().status).toBe('done');
    const over = await app.inject({ method: 'POST', url: '/api/mesh', payload: { prompt: 'a ski jump' } });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toMatch(/used up/);
    expect((await app.inject({ method: 'GET', url: '/api/providers' })).json().mesh).toEqual({ left: 0 });
    // A player's own key still works past the server's cap.
    const own = await app.inject({ method: 'POST', url: '/api/mesh', payload: { prompt: 'a gate' }, headers: { 'x-pg-mesh-provider': 'fake-mesh', 'x-pg-mesh-key': 'mine' } });
    expect(own.json()).toEqual({ task: 'task-1' });
  });

  it('without a server key, a player needs their own', async () => {
    const app = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/providers' })).json().mesh).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/api/mesh', payload: { prompt: 'a chute' } })).statusCode).toBe(400);
  });
});

// An AI that never answers until it is cancelled.
registerProvider({
  id: 'slow', name: 'Slow', kind: 'text', keyUrl: 'https://example.test', keyHint: 's-...',
  create: () => ({ name: 'slow', complete: ({ signal }) => new Promise<Completion>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Cancelled.')), { once: true })) }),
});

describe('a change to a level that takes too long', () => {
  it('stops at the limit and says nothing changed', async () => {
    const tmp = tempDir();
    const app = await buildApp({ llm: null, dataDir: tmp.dir, solver: 'inline', limits: { perMinute: 50, perDay: 100, dailyLlmCalls: 0, editDeadlineMs: 300 } });
    cleanups.push(() => app.close(), tmp.cleanup);
    const machine = (await import('@pg/core/fixtures/levels/first-shot.json', { with: { type: 'json' } })).default;
    const started = Date.now();
    const res = await app.inject({ method: 'POST', url: '/api/machine/edit', payload: { machine, instruction: 'put a castle by the river' }, headers: { 'x-pg-text-provider': 'slow', 'x-pg-text-key': 'k' } });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.body).toContain('That change took too long. Nothing changed');
  });
});

describe('the workbench test lab', () => {
  it('tests a part with no AI and says where the ball stops', async () => {
    const tmp = tempDir();
    const app = await buildApp({ llm: null, dataDir: tmp.dir, solver: 'inline', limits: { perMinute: 50, perDay: 100, dailyLlmCalls: 0 } });
    cleanups.push(() => app.close(), tmp.cleanup);
    const chute = (await import('../../../packages/core/test/fixtures/spiral-chute.json', { with: { type: 'json' } })).default as { name: string; shapes: unknown[] };
    const res = await app.inject({ method: 'POST', url: '/api/workbench/test', payload: { name: chute.name, shapes: chute.shapes } });
    expect(res.statusCode).toBe(200);
    expect(res.json().test).toMatchObject({ verdict: 'stops' });
    expect((await app.inject({ method: 'POST', url: '/api/workbench/test', payload: { name: 'x', shapes: [] } })).statusCode).toBe(400);
    // Fixing needs an AI; without one the server says so.
    expect((await app.inject({ method: 'POST', url: '/api/workbench/fix', payload: { name: 'x', shapes: chute.shapes, change: 'tilt it' } })).json().error).toMatch(/needs the AI/);
  });
});

describe('workbench parts the ball does not get through', () => {
  const ask = (app: Awaited<ReturnType<typeof setup>>, text: string, provider?: string) =>
    app.inject({ method: 'POST', url: '/api/workbench', payload: { text }, headers: provider ? { 'x-pg-text-provider': provider, 'x-pg-text-key': 'k' } : {} }).then((r) => r.json().gadget);

  it('a kept part that fails the lab is made again when the AI can, and the better one takes its place', async () => {
    const app = await setup();
    flaky.good = false;
    const bad = await ask(app, 'a wobbly ramp', 'flaky');
    expect(bad.test.verdict).not.toBe('through');
    // Without the AI the kept part still comes back, with its test.
    expect(await ask(app, 'a wobbly ramp')).toMatchObject({ library: bad.library, test: { verdict: bad.test.verdict } });
    flaky.good = true;
    const calls = flaky.calls;
    const good = await ask(app, 'a wobbly ramp', 'flaky');
    expect(flaky.calls).toBeGreaterThan(calls);
    expect(good).toMatchObject({ library: bad.library, test: { verdict: 'through' } });
    expect(await ask(app, 'a wobbly ramp')).toMatchObject({ library: bad.library, test: { verdict: 'through' } });
  });

  it('when both of the AI’s tries fail, a known part of that kind that works comes back instead', async () => {
    const app = await setup();
    flaky.good = false;
    const part = await ask(app, 'a curly spiral slide', 'flaky');
    expect(part).toMatchObject({ name: 'spiral chute', test: { verdict: 'through' } });
    expect(part.closest).toMatch(/did not let the ball through/);
  });
});

describe('fixing a part from the shared workbench library', () => {
  it('starts from the library’s own copy, never from shapes the request sends', async () => {
    const app = await setup();
    const own = { 'x-pg-text-provider': 'fake', 'x-pg-text-key': 'k' };
    const made = (await app.inject({ method: 'POST', url: '/api/workbench', payload: { text: 'a library chute' }, headers: own })).json().gadget;
    const evil = [{ shape: 'box', at: [0, 0, 0], size: [3, 3, 3], color: '#000000' }];
    const res = await app.inject({ method: 'POST', url: '/api/workbench/fix', payload: { library: made.library, name: 'evil', shapes: evil, change: 'tilt it' }, headers: own });
    expect(res.statusCode).toBe(200);
    expect(prompts.at(-1)).toContain('fake chute');
    expect(prompts.at(-1)).not.toContain('evil');
  });
});
