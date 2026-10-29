import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LOOK_KINDS, LookKind, type LookKind as Kind } from '@og/machine';
import { readJson, writeFileAtomic } from './files';
import { RateLimiter } from './rateLimit';

export interface LookJob {
  id: string; kind: Kind; prompt: string; status: 'queued' | 'generating' | 'ready' | 'failed';
  progress: number; createdAt: string; error?: string;
  reused?: boolean;
}
interface StoredLook extends LookJob { taskId?: string; cacheKey: string; model: string; credits?: number }
export interface ModelProvider {
  model: string;
  start(prompt: string, signal: AbortSignal): Promise<string>;
  poll(id: string, signal: AbortSignal): Promise<{ status: string; progress: number; url?: string; credits?: number }>;
  download(url: string, signal: AbortSignal): Promise<Buffer>;
}
const MAX_BYTES = 20 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface TripoTask {
  task_id?: string; status?: string; progress?: number; consumed_credit?: number;
  output?: Record<string, string | { url?: string }>;
}

/** Stored assets must be self-contained GLB, with no external texture/buffer requests. */
export function checkGlb(bytes: Buffer): void {
  if (bytes.length < 24 || bytes.length > MAX_BYTES || bytes.toString('ascii', 0, 4) !== 'glTF'
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
      || bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + bytes.readUInt32LE(12) > bytes.length) throw Error('The model file could not be read.');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  if (json.asset?.version !== '2.0' || !json.meshes?.length || json.meshes.length > 128
      || (json.nodes?.length ?? 0) > 512
      || [...(json.buffers ?? []), ...(json.images ?? [])].some((x: { uri?: string }) => x.uri !== undefined)
      || (json.accessors ?? []).some((x: { count: number }) => x.count > 500_000)) {
    throw Error('This model is too complex or needs external files. Try a simpler object.');
  }
}

export class TripoProvider implements ModelProvider {
  constructor(private key: string, public model = 'v3.1-20260211') {}
  private async request(path: string, signal: AbortSignal, body?: object) {
    const response = await fetch(`https://api.tripo3d.ai/v2/openapi${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    const json = await response.json() as { code: number; data?: TripoTask };
    if (!response.ok || json.code !== 0 || !json.data) {
      if (response.status === 401) throw Error('The model service could not sign in. Your machine is unchanged.');
      if (response.status === 429) throw Error('The model service is busy or out of credits. Try again later.');
      throw Error('The model service could not finish this request. Your machine is unchanged.');
    }
    return json.data;
  }
  async start(prompt: string, signal: AbortSignal) {
    const result = await this.request('/task', signal, { type: 'text_to_model', model_version: this.model, prompt,
      face_limit: 5000, texture: true, pbr: true, texture_quality: 'standard', geometry_quality: 'standard', quad: false });
    if (typeof result.task_id !== 'string' || !/^[\w-]{1,100}$/.test(result.task_id)) throw Error('The model service did not return a task.');
    return result.task_id;
  }
  async poll(id: string, signal: AbortSignal) {
    const result = await this.request(`/task/${encodeURIComponent(id)}`, signal);
    const output = result.output ?? {};
    const asset = output.pbr_model ?? output.model ?? output.base_model;
    return { status: String(result.status), progress: Math.max(0, Math.min(100, Number(result.progress) || 0)),
      url: typeof asset === 'string' ? asset : asset?.url, credits: result.consumed_credit as number | undefined };
  }
  async download(source: string, signal: AbortSignal): Promise<Buffer> {
    // Only provider-owned HTTPS downloads; never forward the API credential to storage.
    let url = new URL(source);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (url.protocol !== 'https:' || url.username || url.password
          || !/(^|\.)(tripo3d\.ai|tripo3d\.com|tripo\.ai)$/.test(url.hostname)) throw Error('The model service returned an unsupported download location.');
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel(); url = new URL(response.headers.get('location')!, url); continue;
      }
      if (!response.ok || !response.body) throw Error('The model download failed.');
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw Error('The model is too large for this workshop.'); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > MAX_BYTES) throw Error('The model is too large for this workshop.'); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return Buffer.concat(chunks);
    }
    throw Error('The model download redirected too many times.');
  }
}

const visible = ({ id, kind, prompt, status, progress, createdAt, error }: StoredLook): LookJob => ({ id, kind, prompt, status, progress, createdAt, ...(error ? { error } : {}) });
const modelPrompt = (kind: Kind, prompt: string) => `One ${kind === 'ball' ? 'round marble' : kind === 'dominoes' ? 'single upright rectangular domino tile' : kind} for a whimsical miniature wooden chain-reaction machine. ${prompt}. Warm handcrafted toy style, chunky clean silhouette, wood and brass accents. Single object only, no stand or background, no text. Upright. Preserve the recognizable shape of the ${kind}.`;

export class LookStore {
  private jobs: StoredLook[] = [];
  private running = new Map<string, Promise<void>>();
  private abort = new AbortController();
  private writes: Promise<void> = Promise.resolve();
  private gate: Promise<unknown> = Promise.resolve();
  private constructor(private dir: string, private provider: ModelProvider | null, private dailyCap: number, private pollMs: number) {}
  static async open(dir: string, provider: ModelProvider | null, dailyCap = 5, pollMs = 3000) {
    const store = new LookStore(dir, provider, dailyCap, pollMs);
    await mkdir(dir, { recursive: true });
    store.jobs = await readJson<StoredLook[]>(join(dir, 'jobs.json')) ?? [];
    for (const job of store.jobs.filter(j => j.status === 'queued' || j.status === 'generating')) {
      if (job.taskId && provider && job.model === provider.model) store.launch(job);
      else { job.status = 'failed'; job.error = 'Generation was interrupted. No duplicate request was submitted.'; }
    }
    await store.save(); return store;
  }
  get enabled() { return !!this.provider && this.dailyCap > 0; }
  list() { return this.jobs.filter(j => j.status === 'ready').slice(-30).reverse().map(visible); }
  get(id: string) { const job = this.jobs.find(j => j.id === id); return job ? visible(job) : null; }
  async asset(id: string) {
    if (!ID.test(id) || this.get(id)?.status !== 'ready') return null;
    try { return await readFile(join(this.dir, `${id}.glb`)); } catch { return null; }
  }
  private save() {
    const data = JSON.stringify(this.jobs);
    const write = this.writes.catch(() => {}).then(() => writeFileAtomic(join(this.dir, 'jobs.json'), data));
    this.writes = write; return write;
  }
  create(kind: Kind, prompt: string): Promise<LookJob> {
    // Serialize cache/cap checks so concurrent requests cannot multiply paid submissions.
    const task = this.gate.then(async () => {
      const key = createHash('sha256').update(JSON.stringify([kind, prompt.toLowerCase().trim(), this.provider?.model, 1])).digest('hex');
      const existing = this.jobs.find(j => j.cacheKey === key && j.status !== 'failed');
      if (existing) return { ...visible(existing), reused: true };
      if (!this.enabled) throw Error('Custom looks are unavailable right now.');
      if (this.running.size >= 2) throw Error('Two models are being made. Try again when one finishes.');
      if (this.jobs.filter(j => j.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length >= this.dailyCap) throw Error('Today’s custom-look allowance has been used. Saved looks are still available.');
      const job: StoredLook = { id: randomUUID(), kind, prompt, status: 'queued', progress: 0,
        createdAt: new Date().toISOString(), cacheKey: key, model: this.provider!.model };
      this.jobs.push(job); await this.save(); this.launch(job); return visible(job);
    });
    this.gate = task.catch(() => {}); return task;
  }
  private launch(job: StoredLook) {
    const task = this.generate(job).finally(() => this.running.delete(job.id));
    this.running.set(job.id, task);
  }
  private async generate(job: StoredLook) {
    try {
      const signal = this.abort.signal;
      if (!job.taskId) { job.taskId = await this.provider!.start(modelPrompt(job.kind, job.prompt), signal); await this.save(); }
      job.status = 'generating';
      while (!signal.aborted && Date.now() - Date.parse(job.createdAt) < 20 * 60_000) {
        const result = await this.provider!.poll(job.taskId, signal);
        job.progress = result.progress;
        if (result.status === 'success') {
          if (!result.url) throw Error('The model service returned no model.');
          const bytes = await this.provider!.download(result.url, signal); checkGlb(bytes);
          await writeFile(join(this.dir, `${job.id}.glb`), bytes);
          job.status = 'ready'; job.progress = 100; job.credits = result.credits; await this.save(); return;
        }
        if (!['queued', 'running'].includes(result.status)) throw Error('The model could not be generated. Try a simpler description.');
        await this.save();
        await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, this.pollMs); signal.addEventListener('abort', done, { once: true }); });
      }
      if (!signal.aborted) throw Error('Model generation timed out. Your machine is unchanged.');
    } catch (error) {
      if (!this.abort.signal.aborted) { job.status = 'failed'; job.error = error instanceof Error ? error.message : 'Model generation failed.'; }
      await this.save();
    }
  }
  async close() { this.abort.abort(); await Promise.allSettled(this.running.values()); await this.writes; }
}

export async function registerLooks(app: FastifyInstance, dir: string, provider: ModelProvider | null, dailyCap = 5, pollMs = 3000) {
  const store = await LookStore.open(dir, provider, dailyCap, pollMs);
  const limiter = new RateLimiter(2, 6);
  app.addHook('onClose', () => store.close());
  app.get('/api/looks', () => ({ enabled: store.enabled, kinds: LOOK_KINDS, looks: store.list() }));
  app.post<{ Body: { kind?: unknown; prompt?: unknown } }>('/api/looks', async (req, reply) => {
    const kind = LookKind.safeParse(req.body?.kind);
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!kind.success || prompt.length < 4 || prompt.length > 280) return reply.code(400).send({ error: 'Choose a supported part and describe its look in 4–280 characters.' });
    const limit = limiter.take(req.ip); if (limit) return reply.code(429).send({ error: limit.error });
    try { const job = await store.create(kind.data, prompt); return reply.code(job.status === 'ready' ? 200 : 202).send(job); }
    catch (error) { return reply.code(store.enabled ? 429 : 503).send({ error: error instanceof Error ? error.message : 'Custom looks are unavailable.' }); }
  });
  app.get<{ Params: { id: string } }>('/api/looks/:id', (req, reply) => {
    const job = ID.test(req.params.id) ? store.get(req.params.id) : null;
    return job ?? reply.code(404).send({ error: 'Look not found.' });
  });
  app.get<{ Params: { id: string } }>('/api/looks/:id/model.glb', async (req, reply) => {
    const bytes = await store.asset(req.params.id);
    return bytes ? reply.type('model/gltf-binary').header('Cache-Control', 'public, max-age=31536000, immutable').send(bytes) : reply.code(404).send({ error: 'Model not found.' });
  });
  return store;
}
