import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app';
import type { SolverMode } from './game/solver';
import { createLlm } from './llm/client';

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
});
app.log.info(`LLM backend: ${llm?.name ?? 'none'}; data dir: ${DATA_DIR}`);

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'));
}

await app.listen({ port: PORT, host: '0.0.0.0' });
