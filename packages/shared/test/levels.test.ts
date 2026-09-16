import { describe, expect, it } from 'vitest';
import { checkShot, controlValues, parseLevel } from '../src';
import { CAMPAIGN } from '../src/levels';

/** Placement nudges a player clicking in space could plausibly make: r by 3%, angle by 3 degrees. */
const NUDGES: [number, number][] = [
  [0.03, 3], [0.03, -3], [-0.03, 3], [-0.03, -3],
  [0.03, 0], [-0.03, 0], [0, 3], [0, -3],
];

describe('campaign', () => {
  it('has ten levels with unique ids and rising par', () => {
    expect(CAMPAIGN).toHaveLength(10);
    expect(new Set(CAMPAIGN.map((l) => l.id)).size).toBe(CAMPAIGN.length);
    CAMPAIGN.forEach((l, i) => {
      if (i > 0) expect(l.par).toBeGreaterThanOrEqual(CAMPAIGN[i - 1].par);
    });
  });

  it('introduces pieces early and brings them back', () => {
    const pieceLevels = CAMPAIGN.map((l, i) => (l.pieces ? i : -1)).filter((i) => i >= 0);
    expect(pieceLevels[0]).toBeLessThanOrEqual(3);
    expect(pieceLevels.length).toBeGreaterThanOrEqual(3);
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
      expect(values).toHaveLength(level.controls.length);
      values.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(level.controls[i].min);
        expect(v).toBeLessThanOrEqual(level.controls[i].max);
      });
      const r = checkShot(level, values, pieces);
      expect(r.goal.events.filter((e) => !e.satisfied).map((e) => e.note)).toEqual([]);
      expect(r.goal.success).toBe(true);
    });

    if (!level.controls.length) {
      it('is a build puzzle: has pieces to place', () => {
        expect(level.pieces).toBeDefined();
      });
    }

    if (level.pieces) {
      it('needs its pieces', () => {
        const { values, pieces } = level.solution!;
        expect(pieces.length).toBeGreaterThan(0);
        expect(pieces.length).toBeLessThanOrEqual(level.pieces!.max);
        pieces.forEach((p) => expect(level.pieces!.kinds).toContain(p.kind));
        expect(checkShot(level, values, []).goal.success).toBe(false);
      });

      // Pure build levels must be forgiving; levels that also have controls get a looser check.
      it('solution pieces tolerate a slightly off click', () => {
        const { values, pieces } = level.solution!;
        const ok = NUDGES.filter(([dr, da]) =>
          checkShot(level, values, pieces.map((p) => ({ ...p, r: p.r * (1 + dr), angle: p.angle + da }))).goal.success).length;
        expect(ok).toBeGreaterThanOrEqual(level.controls.length ? 1 : 2);
      });
    }
  });
});
