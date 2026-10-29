import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { LookStore, TripoProvider, checkGlb, registerLooks, type ModelProvider } from '../src/looks';
import { tempDir } from './helpers';

const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
function glb(extra: object = {}) {
  const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, ...extra });
  const text = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const data = Buffer.alloc(12 + 8 + text.length + 8 + 36);
  data.write('glTF'); data.writeUInt32LE(2, 4); data.writeUInt32LE(data.length, 8); data.writeUInt32LE(text.length, 12); data.writeUInt32LE(0x4e4f534a, 16); text.copy(data, 20);
  const bin = 20 + text.length; data.writeUInt32LE(36, bin); data.writeUInt32LE(0x004e4942, bin + 4);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((n, i) => data.writeFloatLE(n, bin + 8 + i * 4)); return data;
}
function provider(bytes = glb()): ModelProvider {
  return { model: 'test-v1', start: vi.fn(async () => 'task-one'), poll: vi.fn(async () => ({ status: 'success', progress: 100, url: 'https://cdn.tripo3d.ai/signed-private-url', credits: 20 })), download: vi.fn(async () => bytes) };
}
async function setup(p: ModelProvider | null = provider(), cap = 5) {
  const temp = tempDir(); cleanups.push(temp.cleanup); const app = Fastify();
  const store = await registerLooks(app, join(temp.dir, 'looks'), p, cap, 1); cleanups.push(() => app.close());
  return { app, store, dir: join(temp.dir, 'looks'), p };
}

describe('custom looks', () => {
  it('submits once, stores a self-contained model, and reuses it after restart', async () => {
    const p = provider(), { app, store, dir } = await setup(p);
    const [first, duplicate] = await Promise.all([store.create('bell', 'Brass toy bell'), store.create('bell', 'Brass toy bell')]);
    expect(first.id).toBe(duplicate.id);
    await vi.waitFor(() => expect(store.get(first.id)?.status).toBe('ready'));
    expect(p.start).toHaveBeenCalledTimes(1);
    const model = await app.inject(`/api/looks/${first.id}/model.glb`);
    expect(model.statusCode).toBe(200); expect(model.rawPayload).toEqual(glb());
    const job = (await app.inject(`/api/looks/${first.id}`)).json();
    expect(job).not.toHaveProperty('taskId'); expect(JSON.stringify(job)).not.toContain('signed-private-url');
    await app.close();
    const restarted = await LookStore.open(dir, p); cleanups.push(() => restarted.close());
    expect((await restarted.create('bell', 'Brass toy bell')).id).toBe(first.id);
    expect(p.start).toHaveBeenCalledTimes(1);
  });

  it('persists the paid submission cap across restarts while keeping saved looks usable', async () => {
    const p = provider(), { app, store, dir } = await setup(p, 1);
    const first = await store.create('fan', 'A wooden fan');
    await vi.waitFor(() => expect(store.get(first.id)?.status).toBe('ready'));
    await app.close(); const restarted = await LookStore.open(dir, p, 1); cleanups.push(() => restarted.close());
    await expect(restarted.create('bell', 'Another gold bell')).rejects.toThrow('allowance');
    expect((await restarted.create('fan', 'A wooden fan')).status).toBe('ready');
    expect(p.start).toHaveBeenCalledTimes(1);
  });

  it('resumes an existing provider task after restart without paying for another submission', async () => {
    const p = provider();
    vi.mocked(p.poll).mockResolvedValue({ status: 'running', progress: 42 });
    const { store, app, dir } = await setup(p);
    const job = await store.create('bell', 'A red wooden bell');
    await vi.waitFor(() => expect(store.get(job.id)?.progress).toBe(42));
    await app.close();
    vi.mocked(p.poll).mockResolvedValue({ status: 'success', progress: 100, url: 'https://cdn.tripo3d.ai/resumed.glb' });
    const restarted = await LookStore.open(dir, p, 5, 1); cleanups.push(() => restarted.close());
    await vi.waitFor(() => expect(restarted.get(job.id)?.status).toBe('ready'));
    expect(p.start).toHaveBeenCalledTimes(1);
    expect(p.poll).toHaveBeenLastCalledWith('task-one', expect.any(AbortSignal));
  });

  it('reports provider failures and never serves malformed or external-resource models', async () => {
    const p = provider(glb({ images: [{ uri: 'https://untrusted.example/tracker.png' }] }));
    const { store, app } = await setup(p); const job = await store.create('bell', 'A gold bell');
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe('failed'));
    expect((await app.inject(`/api/looks/${job.id}/model.glb`)).statusCode).toBe(404);
    expect(() => checkGlb(Buffer.from('not a model'))).toThrow();
  });

  it('rejects unsupported shapes and offers a disabled state without an API key', async () => {
    const { app } = await setup(null);
    expect((await app.inject('/api/looks')).json()).toMatchObject({ enabled: false, looks: [] });
    expect((await app.inject({ method: 'POST', url: '/api/looks', payload: { kind: 'ramp', prompt: 'A shiny ramp' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/looks', payload: { kind: 'bell', prompt: 'A shiny bell' } })).statusCode).toBe(503);
  });

  it('does not expose credentials or retry a rejected paid submission', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 1002 }), { status: 401 }));
    const { store } = await setup(new TripoProvider('private-test-key'));
    const job = await store.create('bell', 'A wooden bell');
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe('failed'));
    expect(store.get(job.id)?.error).toMatch('could not sign in');
    expect(JSON.stringify(store.get(job.id))).not.toContain('private-test-key'); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not send API credentials to storage and rejects untrusted download destinations', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(glb())));
    const p = new TripoProvider('private-test-key');
    await p.download('https://cdn.tripo3d.ai/look.glb', new AbortController().signal);
    expect(fetch.mock.calls[0][1]?.headers).toBeUndefined();
    await expect(p.download('https://localhost/private', new AbortController().signal)).rejects.toThrow('unsupported');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
