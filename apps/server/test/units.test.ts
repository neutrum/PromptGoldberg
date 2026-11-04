import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DailyCap, RateLimiter } from '../src/rateLimit';
import { parseSse, sseFrame } from '../src/sse';
import { tempDir } from './helpers';

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

  it('daily cap keeps its count through a restart when given a file', async () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'llm-calls.json'), t = Date.UTC(2026, 0, 1, 12);
      const first = new DailyCap(2, () => t, file);
      expect(first.take()).toBe(true);
      await vi.waitFor(() => expect(existsSync(file)).toBe(true));
      const second = new DailyCap(2, () => t, file);
      expect(second.used).toBe(1);
      expect(second.take()).toBe(true);
      expect(second.take()).toBe(false);
      // The next day starts from zero.
      expect(new DailyCap(2, () => t + 86_400_000, file).used).toBe(0);
    } finally { tmp.cleanup(); }
  });
});

