import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Level, type LevelStreamEvent } from '@og/shared';
import { readJson, writeFileAtomic } from './files';

/** Bump when the level prompt or pipeline changes enough to invalidate cached levels. */
export const CACHE_VERSION = 1;

/** Case, whitespace and trailing punctuation do not change the level. */
export function normalizePrompt(prompt: string): string {
  return prompt.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.!?…]+$/u, '');
}

export function cacheKey(prompt: string): string {
  return createHash('sha256').update(`v${CACHE_VERSION}\n${normalizePrompt(prompt)}`).digest('hex');
}

export type CachedLevel = Omit<Extract<LevelStreamEvent, { type: 'level' }>, 'cached'>;

/** Level responses stored as one JSON file per prompt hash. */
export class LevelCache {
  constructor(private dir: string) {}

  async get(prompt: string): Promise<CachedLevel | undefined> {
    try {
      const hit = await readJson<CachedLevel>(join(this.dir, `${cacheKey(prompt)}.json`));
      if (!hit || hit.type !== 'level' || !Level.safeParse(hit.level).success) return undefined;
      return hit;
    } catch {
      return undefined;
    }
  }

  async put(prompt: string, event: CachedLevel): Promise<void> {
    await writeFileAtomic(join(this.dir, `${cacheKey(prompt)}.json`), JSON.stringify({ ...event, prompt: normalizePrompt(prompt) }));
  }
}
