import { beforeAll, describe, expect, it } from 'vitest';
import { compileRoute, evaluateMachine, finishTime, initPhysics, routeParts, ruleProblems, rulesOf, simulateSync } from '../src';

beforeAll(async () => { await initPhysics(); });

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

  it('compiles a level whose own route keeps the challenge', () => {
    const r = compileRoute({ title: 'Slow', links: [{ via: 'cannon', turn: 'right' }, { via: 'fan', turn: 'left' }], end: 'dominoes', row: 16 }, { seed: 1, rules: { minSeconds: 10, maxParts: 4 } })!;
    expect(r).not.toBeNull();
    const result = evaluateMachine(r.spec.goal, simulateSync(r.spec));
    expect(finishTime(result)!).toBeGreaterThanOrEqual(r.spec.rules!.minSeconds!);
    expect(routeParts(r.spec).length).toBeLessThanOrEqual(r.spec.rules!.maxParts!);
  }, 60_000);
});

describe('new route links', () => {
  it('lays out a seesaw, a ring-twice bell and a long domino chain that all run', () => {
    for (const g of [
      { title: 'Seesaw', links: [{ via: 'cannon' as const, turn: 'left' as const }, { via: 'seesaw' as const }], end: 'bell' as const },
      { title: 'Twice', links: [{ via: 'fan' as const, turn: 'left' as const }], end: 'bell' as const, rings: 2 },
      { title: 'Chain', links: [{ via: 'cannon' as const, turn: 'right' as const }], end: 'dominoes' as const, row: 14 },
    ]) {
      const r = compileRoute(g, { seed: 2 })!;
      expect(r, g.title).not.toBeNull();
      expect(evaluateMachine(r.spec.goal, simulateSync(r.spec)).success).toBe(true);
    }
    const twice = compileRoute({ title: 'Twice', links: [{ via: 'fan', turn: 'left' }], end: 'bell', rings: 2 }, { seed: 2 })!;
    expect(twice.spec.goal.find((g) => g.type === 'bell')).toMatchObject({ times: 2 });
    const chain = compileRoute({ title: 'Chain', links: [{ via: 'cannon', turn: 'right' }], end: 'dominoes', row: 14 }, { seed: 2 })!;
    expect(chain.spec.parts.filter((p) => p.kind === 'dominoes').reduce((n, p) => n + (p.length ?? 5), 0)).toBe(14);
  }, 60_000);
});
