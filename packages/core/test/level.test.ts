import { beforeAll, describe, expect, it } from 'vitest';
import { checkMachine, evaluateMachine, initPhysics, landscapeFromWords, layoutLevel, makeLevelPuzzle, MachineSpec, simulateSync, type RouteGraphInput } from '../src';

beforeAll(() => initPhysics());

const graphs: RouteGraphInput[] = [
  { title: 'Snowball Cave', links: [{ via: 'ramp', turn: 'left' }, { via: 'fan', turn: 'right' }], end: 'bucket', names: { ball: 'snowball', target: 'cave' }, landscape: landscapeFromWords('a snowball in the high tatras')! },
  { title: 'River Bell', links: [{ via: 'cannon', turn: 'right' }], end: 'bell', ground: 'river' },
  { title: 'Domino Hill', start: 'hill', links: [{ via: 'fan', turn: 'left' }], end: 'dominoes', row: 6, ground: 'pit', landscape: landscapeFromWords('a sleeping dragon in a crystal cave')! },
];

describe('levels with no solution laid out', () => {
  it('always gives a valid stage that is not already solved, with a tray and a par, in milliseconds', () => {
    for (const [i, graph] of graphs.entries()) for (const seed of [1, 2, 3, 4, 5]) {
      const started = performance.now();
      const spec = layoutLevel(graph, { seed: seed * 17 + i });
      // Generous: the whole suite runs in parallel. Alone it is a few milliseconds.
      expect(performance.now() - started, graph.title).toBeLessThan(1000);
      expect(MachineSpec.safeParse(spec).success, graph.title).toBe(true);
      expect(checkMachine(spec), graph.title).toEqual([]);
      expect(evaluateMachine(spec.goal, simulateSync(spec, { record: false })).success, `${graph.title} solves itself`).toBe(false);
      expect(spec.spares!.length).toBeGreaterThanOrEqual(2);
      expect(spec.par).toBe(graph.links.length + 1);
      // The puzzle hands over the tray only: the ball, its start ramp and everything else stay.
      const puzzle = makeLevelPuzzle(spec)!;
      expect(puzzle.missing).toEqual([]);
      expect(puzzle.spec.parts).toHaveLength(spec.parts.length);
      expect(puzzle.spares!.length).toBe(spec.spares!.length);
    }
  });

  it('puts the world on the board: its landmark and obstacles, the goal far from the start', () => {
    const spec = layoutLevel(graphs[0], { seed: 7 });
    expect(spec.parts.some((p) => p.prop === 'landmark' && p.label === 'mountain chalet')).toBe(true);
    expect(spec.parts.filter((p) => p.prop && p.prop !== 'landmark').length).toBeGreaterThan(15);
    const ball = spec.parts.find((p) => p.kind === 'ball')!, cave = spec.parts.find((p) => p.kind === 'bucket')!;
    expect(cave.label).toBe('cave');
    expect(Math.hypot(ball.x - cave.x, ball.z - cave.z)).toBeGreaterThan(9);
    const dragon = layoutLevel(graphs[2], { seed: 3 });
    expect(dragon.parts.some((p) => p.prop === 'dragon')).toBe(true);
    expect(dragon.parts.some((p) => p.kind === 'dominoes')).toBe(true);
  });

  it('is the same level for the same seed, and harder means more in the way', () => {
    expect(layoutLevel(graphs[1], { seed: 9 })).toEqual(layoutLevel(graphs[1], { seed: 9 }));
    const count = (d: 'easy' | 'hard') => layoutLevel(graphs[1], { seed: 9, difficulty: d }).parts.filter((p) => p.prop).length;
    expect(count('hard')).toBeGreaterThan(count('easy'));
  });
});

describe('a machine on its own stage', () => {
  it("rejects parts and ground off the stage's edge", () => {
    const spec = layoutLevel(graphs[1], { seed: 3 });
    const far = spec.parts.reduce((a, p) => Math.max(a, p.x, p.z), 0);
    expect(checkMachine({ ...spec, stage: { x: 12, z: 12 } }).some((i) => /off the 12 by 12 stage/.test(i.message))).toBe(far >= 12);
    expect(checkMachine({ ...spec, stage: { x: 12, z: 12 }, parts: spec.parts.map((p) => ({ ...p, x: 0, z: 0 })), terrain: [{ x: 10, z: 0, w: 4, d: 2, h: -1 }] }).some((i) => /runs past the 12 by 12 stage/.test(i.message))).toBe(true);
  });
});
