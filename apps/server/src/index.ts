import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app';
import { createLlm, type SolverMode } from '@pg/ai';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = resolve(import.meta.dirname, '../../web/dist');
const DATA_DIR = resolve(process.env.DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));

const llm = createLlm();
const app = await buildApp({
  llm,
  dataDir: DATA_DIR,
  solver: (process.env.SOLVER_MODE as SolverMode | undefined) ?? 'auto',
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  // 3D looks for players without a key of their own, under MESH_DAILY_CAP a day.
  mesh: process.env.TRIPO_API_KEY ? { provider: 'tripo', key: process.env.TRIPO_API_KEY } : null,
});
app.log.info(`LLM backend: ${llm?.name ?? 'none'}; 3D looks: ${process.env.TRIPO_API_KEY ? 'server key' : 'players’ keys only'}; data dir: ${DATA_DIR}`);

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  // The project, its architecture and its API on one page.
  app.get('/docs', (_req, reply) => reply.sendFile('docs.html'));
  // A tribute to the man the game is named after.
  app.get('/rube', (_req, reply) => reply.sendFile('rube.html'));
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'));
}

await app.listen({ port: PORT, host: '0.0.0.0' });
