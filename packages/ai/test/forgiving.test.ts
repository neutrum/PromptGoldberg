import { describe, expect, it } from 'vitest';
import { checkShot, controlValues, type Level } from '@og/shared';
import { loosen, makeForgiving, measure } from '../src/forgiving';
import { slingshotLevel } from './helpers';

const check = async (l: Level, shots: number[][]) => shots.map((v) => checkShot(l, v).goal);
const one = async (l: Level, v: number[]) => checkShot(l, v).goal;

/** The slingshot level with flyby windows just wider than its solution's passes (0.06 and 0.34 AU). */
function fragileLevel(): Level {
  const level = slingshotLevel();
  const spec = structuredClone(level.spec);
  spec.goal = [
    { type: 'flyby', body: 'probe', target: 'jove', maxDistance: 0.062 },
    { type: 'flyby', body: 'probe', target: 'rime', maxDistance: 0.345 },
  ];
  return { ...level, spec };
}

describe('forgiving levels', () => {
  it('loosens flyby windows and grows collision targets, never the star', () => {
    const level = slingshotLevel();
    level.spec.goal = [{ type: 'collision', a: 'probe', b: 'rime' }, { type: 'flyby', body: 'probe', target: 'jove', maxDistance: 0.2 }];
    const out = loosen(level, 2);
    expect(out.spec.goal[1]).toMatchObject({ maxDistance: 0.4 });
    const radius = (l: Level, id: string) => l.spec.bodies.find((b) => b.id === id)!.radius;
    expect(radius(out, 'rime')).toBeCloseTo(2 * radius(level, 'rime'));
    expect(radius(out, 'jove')).toBe(radius(level, 'jove'));
    expect(level.spec.goal[1]).toMatchObject({ maxDistance: 0.2 });
  });

  it('makes a fragile level forgiving while its first shot still misses', async () => {
    const level = fragileLevel();
    const solution = level.solution!.values;
    const before = (await measure(level, solution, check)).robustness;
    const { level: out, note } = await makeForgiving(level, check);
    const after = (await measure(out, solution, check)).robustness;
    expect(note).toMatch(/Loosened/);
    expect(after).toBeGreaterThan(before);
    expect((await one(out, solution)).success).toBe(true);
    expect((await one(out, controlValues(out))).success).toBe(false);
  });
});
