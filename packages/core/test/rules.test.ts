import { describe, expect, it } from 'vitest';
import { ruleProblems, rulesOf } from '../src';

describe('challenge rules', () => {
  it('reads parts limits and time bars from a mission', () => {
    expect(rulesOf('use only three parts to ring the bell')).toEqual({ maxParts: 3 });
    expect(rulesOf('make it take longer than 10 seconds')).toEqual({ minSeconds: 10 });
    expect(rulesOf('the slowest machine ever')).toEqual({ minSeconds: 6 });
    expect(rulesOf('ring the bell')).toBeUndefined();
  });

  it('says what a solved run breaks', () => {
    const result = { success: true, satisfiedCount: 1, score: 1, progress: 1, failedAt: null, steps: [{ index: 0, satisfied: true, t: 3.2, partial: 1, note: '' }] };
    expect(ruleProblems({ maxParts: 2, minSeconds: 5 }, result, 3)).toHaveLength(2);
    expect(ruleProblems({ maxParts: 3 }, result, 3)).toEqual([]);
  });
});
