import { beforeAll, describe, expect, it } from 'vitest';
import { checkMachine, compileRoute, MachineSpec, evaluateMachine, initPhysics, layoutProblems, makeConnectPuzzle, simulateSync } from '../src';

beforeAll(() => initPhysics());

describe('compileRoute', () => {
  it('does not weaken a strict challenge or drop an incompatible requested link', () => {
    const impossibleTime = compileRoute({ title: 'Slow', links: [{ via: 'cannon', turn: 'right' }], end: 'bucket' }, { seed: 2, attempts: 2, strict: true, rules: { minSeconds: 14 } });
    expect(impossibleTime).toBeNull();
    const droppedLink = compileRoute({ title: 'Fan then bounce', links: [{ via: 'fan', turn: 'right' }, { via: 'trampoline' }], end: 'bell' }, { strict: true });
    expect(droppedLink).toBeNull();
  });

  it('keeps a long domino route to at most four goal steps, and valid', () => {
    for (const seed of [1]) {
      const r = compileRoute({ title: 'Long desk run', links: [{ via: 'ramp', turn: 'right' }, { via: 'fan', turn: 'left' }], end: 'dominoes', row: 14 }, { seed });
      if (!r) continue;
      expect(r.spec.goal.length).toBeLessThanOrEqual(4);
      expect(MachineSpec.safeParse(r.spec).success).toBe(true);
      expect(r.spec.goal.at(-1)?.type).toBe('bell');
    }
  }, 60_000);

  it('lays a route out on a smaller or larger stage, inside its bounds', () => {
    for (const stage of [{ x: 16, z: 16 }, { x: 32, z: 28 }]) {
      const r = compileRoute({ title: 'Sized', links: [{ via: 'fan', turn: 'left' }], end: 'bell' }, { seed: 3, stage });
      expect(r, `${stage.x}x${stage.z}`).not.toBeNull();
      expect(r!.spec.stage).toEqual(stage);
      expect(checkMachine(r!.spec)).toEqual([]);
      expect(evaluateMachine(r!.spec.goal, simulateSync(r!.spec)).success).toBe(true);
    }
  });

  it("rejects parts and ground off a machine's own stage", () => {
    const r = compileRoute({ title: 'Big', links: [{ via: 'fan', turn: 'left' }], end: 'bell' }, { seed: 3 })!;
    const far = r.spec.parts.reduce((a, p) => Math.max(a, p.x, p.z), 0);
    expect(checkMachine({ ...r.spec, stage: { x: 12, z: 12 } }).some((i) => /off the 12 by 12 stage/.test(i.message))).toBe(far >= 12);
    expect(checkMachine({ ...r.spec, stage: { x: 12, z: 12 }, parts: r.spec.parts.map((p) => ({ ...p, x: 0, z: 0 })), terrain: [{ x: 10, z: 0, w: 4, d: 2, h: -1 }] }).some((i) => /runs past the 12 by 12 stage/.test(i.message))).toBe(true);
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
