import { describe, expect, it } from 'vitest';
import { Landscape, landscapeFromWords, MachineSpec, scatterLandscape } from '../src';

describe('landscapes', () => {
  const bc = landscapeFromWords('Create a terrain that looks like forests and hills in british columbia')!;

  it('finds a world in the words, and none in a plain mission', () => {
    expect(bc.features.map((f) => f.kind)).toContain('conifers');
    expect(bc.snow).toBe(true);
    expect(landscapeFromWords('a cactus desert in arizona')!.features.map((f) => f.kind)).toContain('cacti');
    expect(landscapeFromWords('get the ball into the bucket')).toBeNull();
  });

  it('scatters the same world every time, never on the board, with tall things behind it', () => {
    const W = 12, D = 10;
    const props = scatterLandscape(bc, W, D);
    expect(props.length).toBeGreaterThan(40);
    expect(scatterLandscape(bc, W, D)).toEqual(props);
    for (const p of props) expect(p.x > -0.35 && p.x < W + 0.35 && p.z > -0.35 && p.z < D + 0.35, `${p.kind} at ${p.x},${p.z}`).toBe(false);
    // The camera looks from the south-east: nothing tall stands east of or south of the board.
    for (const p of props.filter((q) => ['conifers', 'mountains', 'hills', 'lake', 'boulders', 'birches'].includes(q.kind))) expect(p.x > W || p.z > D, p.kind).toBe(false);
  });

  it('is part of a machine and checked like the rest', () => {
    const spec = { title: 't', parts: [{ id: 'ball', kind: 'ball', x: 1, y: 0, z: 1 }], goal: [{ type: 'touch', part: 'ball' }] };
    expect(MachineSpec.parse({ ...spec, landscape: bc }).landscape?.name).toBe(bc.name);
    expect(Landscape.safeParse({ ...bc, sky: 'blue' }).success).toBe(false);
    expect(Landscape.safeParse({ ...bc, features: [{ kind: 'dragons' }] }).success).toBe(false);
  });
});
