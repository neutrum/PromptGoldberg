/**
 * A player's own keys, sent by the browser with each request (x-pg-text-* and x-pg-mesh-*
 * headers). They live only as long as the request: nothing here stores or logs them.
 */
import type { FastifyRequest } from 'fastify';
import type { ProviderConfig } from '@pg/ai';

export interface PlayerProvider { provider: string; config: ProviderConfig }

const header = (req: FastifyRequest, name: string, max: number): string | undefined => {
  const v = req.headers[name];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, max) : undefined;
};

function from(req: FastifyRequest, kind: 'text' | 'mesh'): PlayerProvider | undefined {
  const provider = header(req, `x-pg-${kind}-provider`, 40);
  if (!provider) return undefined;
  return { provider, config: { key: header(req, `x-pg-${kind}-key`, 400) ?? '', model: header(req, `x-pg-${kind}-model`, 100), url: header(req, `x-pg-${kind}-url`, 300) } };
}

export const playerText = (req: FastifyRequest) => from(req, 'text');
export const playerMesh = (req: FastifyRequest) => from(req, 'mesh');
