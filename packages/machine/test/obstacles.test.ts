import { beforeAll, describe, expect, it } from 'vitest';
import { CELL, compileRoute, evaluateMachine, initPhysics, landscapeFromWords, makeConnectPuzzle, simulateSync } from '../src';

beforeAll(() => initPhysics());

describe('obstacles in the way', () => {
  const graphs = [
    { title: 'Windy alley', links: [{ via: 'fan' as const, turn: 'left' as const }], end: 'bell' as const },
    { title: 'Over the river', links: [{ via: 'cannon' as const, turn: 'right' as const }], end: 'bucket' as const },
    { title: 'Ramp corner', links: [{ via: 'ramp' as const, turn: 'right' as const }], end: 'dominoes' as const },
  ];

  it('stands obstacles off the ball\'s way, keeps the level solvable and the puzzle real', () => {
    let total = 0;
    for (const [i, graph] of graphs.entries()) {
      const r = compileRoute(graph, { seed: 5 + i, clutter: 6 });
      expect(r, graph.title).not.toBeNull();
      const props = r!.spec.parts.filter((p) => p.prop);
      total += props.length;
      const run = simulateSync(r!.spec, { record: true });
      expect(evaluateMachine(r!.spec.goal, run).success, graph.title).toBe(true);
      const ball = run.dynamicIds.indexOf(r!.spec.parts.find((p) => p.kind === 'ball')!.id);
      const visited = new Set<string>();
      for (let f = 0; f < run.frameCount; f++) {
        const b = f * run.frameStride + 1 + ball * 7;
        visited.add(`${Math.floor(run.frames[b] / CELL)},${Math.floor(run.frames[b + 2] / CELL)}`);
      }
      for (const p of props) expect(visited.has(`${p.x},${p.z}`), `${p.id} on the ball's way`).toBe(false);
      expect(makeConnectPuzzle(r!.spec), graph.title).not.toBeNull();
    }
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it('tries lazy builds and blocks the shortcuts it finds, harder blocking more', () => {
    const normal = compileRoute(graphs[0], { seed: 3, difficulty: 'normal' })!;
    const hard = compileRoute(graphs[0], { seed: 3, difficulty: 'hard' })!;
    expect(hard.shortcuts!.found).toBeGreaterThan(0);
    expect(hard.shortcuts!.blocked).toBeGreaterThan(0);
    expect(hard.shortcuts!.blocked).toBeGreaterThanOrEqual(normal.shortcuts!.blocked);
    expect(compileRoute(graphs[0], { seed: 3, difficulty: 'easy' })!.shortcuts!.found).toBe(0);
  });

  it('suits the world and can be switched off', () => {
    const forest = compileRoute({ ...graphs[0], landscape: landscapeFromWords('forests in british columbia')! }, { seed: 5, clutter: 6 })!;
    expect(forest.spec.parts.filter((p) => p.prop).every((p) => p.prop === 'tree' || p.prop === 'stump' || p.prop === 'rock')).toBe(true);
    expect(forest.spec.parts.some((p) => p.prop === 'tree')).toBe(true);
    const bare = compileRoute(graphs[0], { seed: 5, clutter: 0 })!;
    expect(bare.spec.parts.some((p) => p.prop)).toBe(false);
  });
});
