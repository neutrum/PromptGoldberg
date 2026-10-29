/** One-off asset production. Resume recorded tasks; never repeat an uncertain paid submission. */
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TripoProvider, checkGlb } from '../apps/server/src/looks';

const root = resolve('data/model-kit');
const output = resolve('apps/web/public/models/kit-v1');
await mkdir(root, { recursive: true }); await mkdir(output, { recursive: true });
const key = process.env.TRIPO_API_KEY?.trim();
if (!key) throw Error('Set TRIPO_API_KEY in the local environment.');
const provider = new TripoProvider(key);
const signal = new AbortController().signal;
const refine = process.argv.includes('--refine');
const config = JSON.parse(await readFile(refine ? 'docs/model-kit.refinements.json' : 'docs/model-kit.prompts.json', 'utf8')) as { style: string; models: { id: string; title: string; prompt: string }[] };
interface Record { provider: string; model: string; kind: string; prompt: string; status: string; requestedAt: string; taskId?: string; completedAt?: string; bytes?: number; credits?: number; progress?: number }
const read = async (path: string): Promise<Record | null> => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
const save = async (path: string, value: unknown) => { await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n'); await rename(`${path}.tmp`, path); };
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// The existing bell is already paid for. Reuse its exact bytes and provenance.
const bell = await read(resolve('data/workshop-check/tripo/bell.json'));
if (!bell || bell.status !== 'downloaded') throw Error('Existing verified bell is required; do not submit another.');
checkGlb(await readFile('data/workshop-check/tripo/bell.glb'));
await copyFile('data/workshop-check/tripo/bell.glb', resolve(output, 'bell.glb'));
await save(resolve(root, 'bell.json'), bell);

const requested = process.argv.slice(2).filter(arg => arg !== '--refine');
const queue = config.models.filter(m => !requested.length || requested.includes(m.id));
if (queue.length > 12 || config.models.some(m => (config.style + ' ' + m.prompt).length > 1024)) throw Error('Invalid bounded batch or prompt.');
const balanceResponse = await fetch('https://api.tripo3d.ai/v2/openapi/user/balance', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
const balance = await balanceResponse.json();
if (!balanceResponse.ok || balance.code !== 0) throw Error(`Tripo authentication/balance check failed: HTTP ${balanceResponse.status}`);
console.log(JSON.stringify({ authenticated: true, balance: balance.data, scheduled: queue.map(m => m.id), reused: ['bell'] }));
let failed = 0;
async function generate(item: typeof config.models[number]) {
  const path = resolve(root, `${item.id}.json`);
  let record = await read(path);
  if (record?.status === 'downloaded') { checkGlb(await readFile(resolve(output, `${item.id}.glb`))); console.log(`${item.id}: reused`); return; }
  if (record && !record.taskId) throw Error(`${item.id}: submission outcome uncertain; refusing duplicate`);
  if (!record) {
    record = { provider: 'tripo', model: provider.model, kind: item.id, prompt: `${config.style} ${item.prompt}`, requestedAt: new Date().toISOString(), status: 'submitting' };
    await save(path, record);
    record.taskId = await provider.start(record.prompt, signal);
    record.status = 'queued'; await save(path, record);
    console.log(`${item.id}: submitted ${record.taskId}`);
  }
  const deadline = Date.now() + 20 * 60_000;
  let failures = 0, lastProgress = -1;
  while (Date.now() < deadline) {
    let result;
    try { result = await provider.poll(record.taskId!, signal); failures = 0; }
    catch (error) { if (++failures > 4) throw error; await delay(5000 * failures); continue; }
    record.progress = result.progress; record.status = result.status; await save(path, record);
    if (result.progress !== lastProgress) { console.log(`${item.id}: ${result.status} ${result.progress}%`); lastProgress = result.progress; }
    if (result.status === 'success') {
      if (!result.url) throw Error(`${item.id}: missing output`);
      const bytes = await provider.download(result.url, signal); checkGlb(bytes);
      await writeFile(resolve(output, `${item.id}.glb`), bytes);
      record.status = 'downloaded'; record.bytes = bytes.length; record.credits = result.credits; record.completedAt = new Date().toISOString(); await save(path, record);
      console.log(`${item.id}: saved ${bytes.length} bytes, ${result.credits} credits`); return;
    }
    if (!['queued', 'running'].includes(result.status)) throw Error(`${item.id}: provider status ${result.status}`);
    await delay(5000);
  }
  throw Error(`${item.id}: timed out; task recorded for resumption`);
}
// Two in flight; this bounded developer batch is separate from visitors' daily generation allowance.
await Promise.all([0, 1].map(async () => { while (queue.length) { const item = queue.shift()!; try { await generate(item); } catch (e) { failed++; console.error(e instanceof Error ? e.message : 'Generation failed'); } } }));
const records = await Promise.all((await readdir(root)).filter(name => name.endsWith('.json') && name !== 'inspection.json').map(name => read(resolve(root, name))));
await save(resolve(output, 'provenance.json'), { provider: 'Tripo', model: provider.model, generatedAt: new Date().toISOString(), assets: records.filter(r => r?.status === 'downloaded') });
console.log(JSON.stringify({ complete: records.filter(r => r?.status === 'downloaded').length, failed, totalCredits: records.reduce((sum, r) => sum + (r?.credits ?? 0), 0) }));
if (failed) process.exitCode = 1;
