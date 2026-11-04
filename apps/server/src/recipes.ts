/**
 * The recipe review page's API: list the library, keep or reject a recipe, redo one with a note.
 * A development tool: it writes the library file in the repo, so it is off in production unless RECIPE_REVIEW=1.
 */
import type { FastifyInstance } from 'fastify';
import { libraryItems, replaceRecipes } from '@pg/core';
import { fillLibrary, readBook, reviewRecipe, type LlmBackend } from '@pg/ai';
import { z } from 'zod';

export function registerRecipes(app: FastifyInstance, llm: LlmBackend | null, file?: string) {
  const enabled = process.env.NODE_ENV !== 'production' || process.env.RECIPE_REVIEW === '1';
  const fresh = () => { const book = readBook(file); replaceRecipes(book); return book; };
  const itemOf = (id: string) => libraryItems(fresh()).find((i) => i.id === id) ?? null;

  app.get('/api/recipes', async () => ({ enabled, ai: !!llm, items: libraryItems(enabled ? fresh() : undefined) }));
  if (!enabled) return;

  app.post<{ Params: { id: string }; Body: { status?: unknown; note?: unknown } }>('/api/recipes/:id/review', async (req, reply) => {
    const status = z.enum(['new', 'good', 'bad']).safeParse(req.body?.status);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : undefined;
    if (!status.success) return reply.code(400).send({ error: 'status is new, good or bad' });
    if (!reviewRecipe(req.params.id, status.data, note, file)) return reply.code(404).send({ error: 'no recipe yet' });
    return { item: itemOf(req.params.id) };
  });

  // Compose (or compose again) one thing, with the reviewer's note; about half a minute.
  app.post<{ Params: { id: string }; Body: { note?: unknown } }>('/api/recipes/:id/redo', async (req, reply) => {
    if (!llm) return reply.code(503).send({ error: 'No AI backend on this server.' });
    if (!itemOf(req.params.id)) return reply.code(404).send({ error: 'not in the library' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) || undefined : undefined;
    const res = await fillLibrary(llm, { ids: [req.params.id], note, batch: 1, jobs: 1, file });
    if (!res.composed) return reply.code(502).send({ error: 'The AI did not return a usable recipe. Try again.' });
    return { item: itemOf(req.params.id) };
  });

  // Composing many at once, in the background: the review page starts it, watches it and can stop it.
  let job: { running: boolean; total: number; done: number; failed: string[]; started: number; error?: string; stop: AbortController } | null = null;
  const jobView = () => job && { running: job.running, total: job.total, done: job.done, failed: job.failed, seconds: Math.round((Date.now() - job.started) / 1000), error: job.error };
  app.get('/api/recipes/fill', async () => ({ job: jobView() }));
  app.post<{ Body: { bad?: unknown } }>('/api/recipes/fill', async (req, reply) => {
    if (!llm) return reply.code(503).send({ error: 'No AI backend on this server.' });
    if (job?.running) return { job: jobView() };
    const run: NonNullable<typeof job> = { running: true, total: 0, done: 0, failed: [], started: Date.now(), stop: new AbortController() };
    job = run;
    void fillLibrary(llm, {
      bad: req.body?.bad === true, jobs: 4, batch: 5, file, signal: run.stop.signal,
      onStart: (n) => { run.total = n; },
      onBatch: (b) => { run.done += b.ids.length; if (b.error) run.error = b.error.slice(0, 200); },
    }).then((res) => { run.failed = res.failed; }, (err) => { run.error = err instanceof Error ? err.message : String(err); })
      .finally(() => { run.running = false; fresh(); });
    return { job: jobView() };
  });
  app.post('/api/recipes/fill/stop', async () => { job?.stop.abort(); return { job: jobView() }; });
}
