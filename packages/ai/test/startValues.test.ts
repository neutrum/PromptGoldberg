import { describe, expect, it } from 'vitest';
import { checkShot, type Level } from '@og/shared';
import { chooseStartValues, nudgeCandidates, roundForControl } from '../src/startValues';
import { slingshotLevel } from './helpers';

const check = (l: Level, v: number[]) => checkShot(l, v).goal;

describe('start values', () => {
  it('rounds to about a thousandth of the range', () => {
    expect(roundForControl({ path: 'x', label: 'x', min: 1.5, max: 3.5 }, 2.123456)).toBe(2.123);
    expect(roundForControl({ path: 'x', label: 'x', min: -40, max: 40 }, 20.0333)).toBe(20.03);
    expect(roundForControl({ path: 'x', label: 'x', min: 0, max: 1 }, 5)).toBe(1);
  });

  it('nudges away from the solution until the shot misses', async () => {
    const level = slingshotLevel();
    const solution = level.solution!.values;
    expect(check(level, solution).success).toBe(true);
    // The guess equals the solution, so it has to nudge.
    const start = await chooseStartValues(level, solution, solution, check);
    expect(start.source).toBe('nudge');
    expect(check(level, start.values).success).toBe(false);
    start.values.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(level.controls[i].min);
      expect(v).toBeLessThanOrEqual(level.controls[i].max);
    });
  });

  it('keeps a guess that misses', async () => {
    const level = slingshotLevel();
    const guess = [2, 0, 0.5];
    expect(await chooseStartValues(level, level.solution!.values, guess, check)).toEqual({ values: guess, source: 'guess' });
    expect(nudgeCandidates(level.controls, level.solution!.values).length).toBeGreaterThan(4);
  });
});
