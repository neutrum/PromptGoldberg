import { beforeAll, describe, expect, it } from 'vitest';
import { compileRoute, evaluateMachine, initPhysics, layoutProblems, makeConnectPuzzle, simulateSync } from '../src';

beforeAll(() => initPhysics());

describe('compileRoute', () => {
  it('does not weaken a strict challenge or drop an incompatible requested link', () => {
    const impossibleTime = compileRoute({ title: 'Slow', links: [{ via: 'cannon', turn: 'right' }], end: 'bucket' }, { seed: 2, attempts: 2, strict: true, rules: { minSeconds: 14 } });
    expect(impossibleTime).toBeNull();
    const droppedLink = compileRoute({ title: 'Fan then bounce', links: [{ via: 'fan', turn: 'right' }, { via: 'trampoline' }], end: 'bell' }, { strict: true });
    expect(droppedLink).toBeNull();
  });

  it('lays a route graph out into a level that runs, passes the level rules and leaves a bin', () => {
    for (const graph of [
      { title: 'Over the river', links: [{ via: 'cannon' as const, turn: 'right' as const }], end: 'bucket' as const },
      { title: 'Windy alley', links: [{ via: 'fan' as const, turn: 'left' as const }], end: 'dominoes' as const, names: { target: 'gong', scenery: 'fence' } },
    ]) {
      const r = compileRoute(graph, { seed: 2 });
      expect(r, graph.title).not.toBeNull();
      const spec = r!.spec;
      expect(evaluateMachine(spec.goal, simulateSync(spec, { record: false })).success).toBe(true);
      expect(layoutProblems(spec)).toEqual([]);
      expect(makeConnectPuzzle(spec)!.missing.length).toBeGreaterThanOrEqual(2);
      expect(spec.spares?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('is deterministic for a seed and uses the mission\'s names', () => {
    const graph = { title: 'Gong', links: [{ via: 'fan' as const, turn: 'left' as const }], end: 'bell' as const, names: { target: 'gong', scenery: 'fence' } };
    const a = compileRoute(graph, { seed: 5 })!.spec;
    const b = compileRoute(graph, { seed: 5 })!.spec;
    expect(a).toEqual(b);
    expect(a.parts.some((p) => p.id === 'gong' && p.kind === 'bell')).toBe(true);
    expect(a.parts.some((p) => p.id === 'fence' && p.kind === 'wall' && p.fixed)).toBe(true);
  });

  it('keeps flat ground flat when asked', () => {
    const r = compileRoute({ title: 'Flat', links: [{ via: 'cannon', turn: 'left' }], end: 'bell' }, { seed: 1, flat: true })!;
    expect((r.spec.terrain ?? []).every((t) => t.h === 0)).toBe(true);
  });
});
