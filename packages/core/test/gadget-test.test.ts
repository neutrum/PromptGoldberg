import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { gadgetFromWords, initPhysics, landmarkSize, testGadget, type LandmarkShape } from '../src';

const chute = JSON.parse(readFileSync(new URL('./fixtures/spiral-chute.json', import.meta.url), 'utf8')) as { shapes: LandmarkShape[] };
const plank = (along: number, up: number, color: string): LandmarkShape[] => [
  { shape: 'box', at: [along, up, 0], size: [1.6, 0.1, 1], color, tilt: 15 },
  { shape: 'box', at: [along, up, -0.55], size: [1.6, 0.35, 0.1], color: '#333333', tilt: 15 },
  { shape: 'box', at: [along, up, 0.55], size: [1.6, 0.35, 0.1], color: '#333333', tilt: 15 },
];
const slide: LandmarkShape[] = [...plank(-0.8, 1.2, '#e2603f'), ...plank(0.7, 0.4, '#f0b33e'), { shape: 'cylinder', at: [-0.8, 0, 0], size: [0.3, 1.2, 0.3], color: '#555555' }];

describe('the workbench test lab', () => {
  beforeAll(() => initPhysics());

  it('finds where the live Spiral Chute fails: the ball stops on its flat landing', () => {
    const r = testGadget(chute.shapes, 'spiral chute');
    expect(r.verdict).toBe('stops');
    expect(r.message).toMatch(/flat surface/);
    expect(r.suggestion).toMatch(/tilt the flat landing/);
    expect(r.path.length).toBeGreaterThan(20);
  });

  it('passes a part the ball runs all the way through', () => {
    expect(testGadget(slide, 'two-step slide').verdict).toBe('through');
  });

  it('turns the ball: the spiral chute takes it three quarters round its post and out of its low end', () => {
    const spiral = gadgetFromWords('a spiral chute')!;
    const r = testGadget(spiral.shapes, spiral.name);
    expect(r.verdict).toBe('through');
    // Round the post clockwise seen from above: the right side, the back, the left side, then out along the front.
    const visits = (along: number, across: number) => r.path.some(([a, , c]) => Math.abs(a - along) < 0.5 && Math.abs(c - across) < 0.5);
    expect([visits(1, 0.9), visits(-1, 0.9), visits(-1, -0.9)]).toEqual([true, true, true]);
    expect(landmarkSize(spiral.shapes)).toEqual([3, 3]);
  });

  it('a turned plank slopes toward where it points: turned a quarter right, the ball leaves by the right side', () => {
    const r = testGadget([{ shape: 'box', at: [0, 1, 0], size: [2, 0.1, 1], color: '#e2603f', tilt: 15, turn: 90 }], 'turned plank');
    expect(r.verdict).toBe('falls-off');
    expect(r.message).toMatch(/right side/);
  });

  it('rolls the ball into a spinning part: the sweeper bats it aside, a paddle wheel sends it on or back', () => {
    const sweeper = gadgetFromWords('a sweeper')!;
    expect(testGadget(sweeper.shapes, sweeper.name).verdict).toBe('through');
    const wheel = (spin: number): LandmarkShape[] => [
      { shape: 'box', at: [0, 0.2, 0], size: [0.25, 1.6, 0.9], color: '#f2c230', spin, axis: 'across' },
      { shape: 'cylinder', at: [0, 0, 0.7], size: [0.3, 1.2, 0.3], color: '#555555' },
    ];
    expect(testGadget(wheel(0.5), 'paddle wheel')).toMatchObject({ verdict: 'through', message: expect.stringMatching(/far end/) });
    expect(testGadget(wheel(-1), 'paddle wheel')).toMatchObject({ verdict: 'falls-off', suggestion: expect.stringMatching(/other way/) });
    // Up in the air, it never reaches a rolling ball.
    expect(testGadget(wheel(0.5).map((s) => ({ ...s, at: [s.at[0], s.at[1] + 1.5, s.at[2]] as [number, number, number] })), 'paddle wheel').verdict).toBe('misses');
  });

  it('says when a part has nothing to roll on', () => {
    expect(testGadget([{ shape: 'cone', at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }]).verdict).toBe('misses');
  });
});
