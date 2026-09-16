import { describe, expect, it } from 'vitest';
import { checkShot, controlValues, dailySeed, endlessDifficulty, generateLevel, parseLevel } from '../src';

const LIMIT = 60_000; // generous: tests must not depend on wall clock

describe('procgen', () => {
  it('is deterministic for (seed, difficulty)', () => {
    const a = generateLevel(12345, 5, { timeLimitMs: LIMIT });
    const b = generateLevel(12345, 5, { timeLimitMs: LIMIT });
    expect(JSON.stringify(a.level)).toBe(JSON.stringify(b.level));
    expect(a.attempts).toBe(b.attempts);
    expect(a.evals).toBe(b.evals);
  }, 20_000);

  it('does not depend on the time limit when generation fits in it', () => {
    const a = generateLevel(777, 3);
    const b = generateLevel(777, 3, { timeLimitMs: LIMIT });
    expect(JSON.stringify(a.level)).toBe(JSON.stringify(b.level));
  }, 20_000);

  it('different seeds give different systems', () => {
    const a = generateLevel(1, 2, { timeLimitMs: LIMIT }).level;
    const b = generateLevel(2, 2, { timeLimitMs: LIMIT }).level;
    expect(JSON.stringify(a.spec.bodies)).not.toBe(JSON.stringify(b.spec.bodies));
  }, 20_000);

  it('dailySeed is stable per UTC date', () => {
    const s = dailySeed(new Date('2026-09-16T00:00:01Z'));
    expect(dailySeed(new Date('2026-09-16T23:59:59Z'))).toBe(s);
    expect(dailySeed(new Date('2026-09-17T00:00:00Z'))).not.toBe(s);
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    expect(s).toBe(dailySeed(new Date(Date.UTC(2026, 8, 16, 12))));
  });

  it('endlessDifficulty ramps from 1 to 10', () => {
    expect(endlessDifficulty(1)).toBe(1);
    const ds = Array.from({ length: 30 }, (_, i) => endlessDifficulty(i + 1));
    ds.slice(1).forEach((d, i) => expect(d).toBeGreaterThanOrEqual(ds[i]));
    expect(ds[29]).toBe(10);
  });

  const cases: [number, number][] = [
    [1, 1], [7, 2], [3, 3], [11, 4], [5, 5], [21, 6], [8, 7], [42, 8], [9, 9], [99, 10],
  ];
  for (const [seed, difficulty] of cases) {
    it(`seed ${seed} difficulty ${difficulty}: valid, solvable, starts on a miss`, () => {
      const { level } = generateLevel(seed, difficulty, { timeLimitMs: LIMIT });
      const parsed = parseLevel(JSON.parse(JSON.stringify(level)));
      expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues)).toBe(true);

      expect(level.solution?.values.length).toBe(level.controls.length);
      const sol = checkShot(level, level.solution!.values);
      expect(sol.goal.success, sol.goal.events.map((e) => e.note).join('; ')).toBe(true);
      expect(checkShot(level, controlValues(level)).goal.success).toBe(false);

      expect(level.title.length).toBeGreaterThan(3);
      expect(level.briefing.length).toBeGreaterThan(10);
      expect(level.tip).toBeTruthy();
      expect(level.par).toBeGreaterThanOrEqual(2);
      expect(level.par).toBeLessThanOrEqual(5);
      expect(level.controls.map((c) => c.label)).toEqual(difficulty >= 3 ? ['Aim', 'Power', 'Launch time'] : ['Aim', 'Power']);
      expect(level.spec.goal.length).toBe(difficulty <= 4 ? 1 : difficulty <= 8 ? 2 : 3);

      // Layout sanity: system fits, bodies do not start inside each other, moons well inside Hill spheres.
      const byId = new Map(level.spec.bodies.map((b) => [b.id, b]));
      for (const b of level.spec.bodies) {
        if (b.placement.kind !== 'orbit') continue;
        const parent = byId.get(b.placement.parent)!;
        if (b.type === 'planet') expect(b.placement.a).toBeLessThanOrEqual(15);
        expect(b.placement.a).toBeGreaterThan(10 * (b.radius + parent.radius));
        if (b.type === 'moon' && parent.placement.kind === 'orbit') {
          const star = byId.get(parent.placement.parent)!;
          const hill = parent.placement.a * Math.cbrt(parent.mass / (3 * star.mass));
          expect(b.placement.a).toBeLessThanOrEqual(hill / 3);
        }
      }
      for (const g of level.spec.goal) {
        if (g.type === 'flyby') expect(g.maxDistance).toBeLessThanOrEqual(0.4);
      }
    }, 20_000);
  }
});
