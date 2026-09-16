import { describe, expect, it } from 'vitest';
import { checkShot, controlValues, parseLevel } from '../src';
import { CAMPAIGN } from '../src/levels';

describe('campaign', () => {
  it('has eight levels with unique ids and rising par', () => {
    expect(CAMPAIGN).toHaveLength(8);
    expect(new Set(CAMPAIGN.map((l) => l.id)).size).toBe(CAMPAIGN.length);
    CAMPAIGN.forEach((l, i) => {
      if (i > 0) expect(l.par).toBeGreaterThanOrEqual(CAMPAIGN[i - 1].par);
    });
  });

  describe.each(CAMPAIGN.map((l) => [l.id, l] as const))('%s', (_, level) => {
    it('parses', () => {
      const r = parseLevel(level);
      expect(r.ok ? [] : r.issues).toEqual([]);
    });

    it('starting values do not reach the goal', () => {
      expect(checkShot(level, controlValues(level)).goal.success).toBe(false);
    });

    it('stored solution reaches the goal, inside the control ranges', () => {
      expect(level.solution).toBeDefined();
      const { values, pieces } = level.solution!;
      values.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(level.controls[i].min);
        expect(v).toBeLessThanOrEqual(level.controls[i].max);
      });
      const r = checkShot(level, values, pieces);
      expect(r.goal.events.filter((e) => !e.satisfied).map((e) => e.note)).toEqual([]);
      expect(r.goal.success).toBe(true);
    });

    if (level.pieces) {
      it('needs its pieces', () => {
        expect(level.solution!.pieces.length).toBeGreaterThan(0);
        expect(checkShot(level, level.solution!.values, []).goal.success).toBe(false);
      });
    }
  });
});
