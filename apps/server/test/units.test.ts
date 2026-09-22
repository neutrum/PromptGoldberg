import { describe, expect, it } from 'vitest';
import { cacheKey, LevelCache, normalizePrompt } from '../src/cache';
import { DailyCap, RateLimiter } from '../src/rateLimit';
import { parseSse, sseFrame } from '../src/sse';
import { slingshotLevel, tempDir } from './helpers';

describe('sse', () => {
  it('frames an event with event and data lines and a blank line', () => {
    const frame = sseFrame({ type: 'error', error: 'boom' });
    expect(frame).toBe('event: error\ndata: {"type":"error","error":"boom"}\n\n');
    expect(parseSse(frame + sseFrame({ type: 'error', error: 'two' }))).toEqual([
      { type: 'error', error: 'boom' },
      { type: 'error', error: 'two' },
    ]);
  });
});

describe('rate limiter', () => {
  it('enforces per-minute and per-day windows per key', () => {
    let t = 0;
    const rl = new RateLimiter(2, 3, () => t);
    expect(rl.take('a')).toBeNull();
    expect(rl.take('a')).toBeNull();
    expect(rl.take('a')?.error).toMatch(/per minute/);
    expect(rl.take('b')).toBeNull();
    t = 61_000;
    expect(rl.take('a')).toBeNull();
    expect(rl.take('a')?.error).toMatch(/Daily limit/);
    t = 86_400_001;
    expect(rl.take('a')).toBeNull();
  });

  it('daily cap resets on a new UTC day', () => {
    let t = Date.UTC(2026, 0, 1, 23, 0);
    const cap = new DailyCap(1, () => t);
    expect(cap.take()).toBe(true);
    expect(cap.take()).toBe(false);
    t = Date.UTC(2026, 0, 2, 0, 1);
    expect(cap.used).toBe(0);
    expect(cap.take()).toBe(true);
  });
});

describe('level cache', () => {
  it('normalizes prompts before hashing', () => {
    expect(normalizePrompt('  A Comet   hits the MOON!! ')).toBe('a comet hits the moon');
    expect(cacheKey('A comet hits the moon.')).toBe(cacheKey('a  comet hits the moon'));
    expect(cacheKey('a comet hits the moon')).not.toBe(cacheKey('a comet hits the sun'));
  });

  it('round-trips a level event', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const cache = new LevelCache(dir);
      expect(await cache.get('x')).toBeUndefined();
      const level = slingshotLevel();
      await cache.put('Hello there', { type: 'level', level, solved: true, attempts: 1, notes: [] });
      expect((await cache.get('hello there!'))?.level.id).toBe(level.id);
    } finally {
      cleanup();
    }
  });
});
