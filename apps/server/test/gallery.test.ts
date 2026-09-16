import { describe, expect, it } from 'vitest';
import { checkShot, type Level } from '@og/shared';
import { GalleryStore } from '../src/gallery';
import { slingshotLevel, tempDir } from './helpers';

const verify = async (level: Level) => checkShot(level, level.solution!.values, level.solution!.pieces).goal;

describe('gallery store', () => {
  it('publishes verified levels, counts results and persists', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const store = await GalleryStore.open(dir);
      const res = await store.publish(slingshotLevel(), '  Ada\n ', verify, new Date('2026-01-01T00:00:00Z'));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.entry.author).toBe('Ada');
      expect(res.entry.id).toMatch(/^g-/);
      expect(res.entry.level.id).toBe(res.entry.id);

      const second = await store.publish(slingshotLevel(), undefined, verify, new Date('2026-01-02T00:00:00Z'));
      expect(second.ok && second.entry.author).toBe('Anonymous');

      await store.recordResult(res.entry.id, false, 3);
      expect(await store.recordResult(res.entry.id, true, 4)).toMatchObject({ plays: 2, clears: 1, bestShots: 4 });
      await store.recordResult(res.entry.id, true, 2);
      expect(await store.recordResult('nope', true, 1)).toBeUndefined();

      expect(store.list('new').map((i) => i.id)[1]).toBe(res.entry.id);
      expect(store.list('top')[0]).toMatchObject({ id: res.entry.id, plays: 3, clears: 2, bestShots: 2 });
      expect(store.list('top')[0]).not.toHaveProperty('level');

      const reopened = await GalleryStore.open(dir);
      expect(reopened.count).toBe(2);
      expect(reopened.get(res.entry.id)?.bestShots).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('rejects levels without a working solution', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const store = await GalleryStore.open(dir);
      expect(await store.publish({ ...slingshotLevel(), solution: undefined }, 'x', verify)).toMatchObject({ ok: false, status: 400 });

      const wrong = slingshotLevel();
      wrong.solution!.values = [1.5, -40, 0.9];
      const res = await store.publish(wrong, 'x', verify);
      expect(res).toMatchObject({ ok: false, status: 400 });
      expect(!res.ok && res.error).toMatch(/does not clear/);

      expect(await store.publish({ nonsense: true }, 'x', verify)).toMatchObject({ ok: false, status: 400 });
      const huge = slingshotLevel();
      huge.briefing = 'x'.repeat(200_000);
      expect(await store.publish(huge, 'x', verify)).toMatchObject({ ok: false, status: 413 });
      expect(store.count).toBe(0);
    } finally {
      cleanup();
    }
  });
});
