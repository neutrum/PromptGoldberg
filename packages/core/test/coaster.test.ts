import { beforeAll, describe, expect, it } from 'vitest';
import { footprint, initPhysics, simulateSync, type MachineSpec, type Part } from '../src';

beforeAll(async () => { await initPhysics(); });

/** Down, along, round a corner, up a slope to the top track. */
const ride = (lift = true): Part[] => [
  { id: 'ball', kind: 'ball', x: 1, y: 3, z: 8, yaw: 0 },
  { id: 'down', kind: 'descent', x: 1, y: 2, z: 8, yaw: 0 },
  { id: 'flat', kind: 'track', x: 3, y: 2, z: 8, yaw: 0 },
  { id: 'turn', kind: 'curve', x: 4, y: 2, z: 8, yaw: 0 },
  { id: 'north', kind: 'track', x: 4, y: 2, z: 7, yaw: 270 },
  lift ? { id: 'up', kind: 'ascent', x: 4, y: 2, z: 6, yaw: 270 } : { id: 'up', kind: 'ramp', x: 4, y: 2, z: 5, yaw: 90 },
  { id: 'top', kind: 'track', x: 4, y: 3, z: 4, yaw: 270 },
];
// Where the ball lands after the ride is a puzzle for the player (a bucket barely wider than the
// ball), so these tests check the ride itself: every piece in order, and no fall before the end.
const touches = (parts: Part[]) => {
  const run = simulateSync({ title: 'coaster', parts, goal: [], duration: 6 } as unknown as MachineSpec, { record: false });
  const first = new Map<string, number>();
  for (const e of run.events) if (e.type === 'touch' && !first.has(e.part)) first.set(e.part, e.t);
  return { first, fell: run.events.find((e) => e.type === 'fell')?.t ?? Infinity };
};

describe('coaster track', () => {
  // The north track and the lift are only reachable by turning in the curve.
  it('carries the ball down, round a curve and up the chain lift, piece by piece', () => {
    const { first, fell } = touches(ride());
    const order = ['down', 'flat', 'turn', 'north', 'up', 'top'].map((id) => first.get(id) ?? NaN);
    expect(order.every((t, i) => i === 0 || t > order[i - 1])).toBe(true);
    expect(fell).toBeGreaterThan(order[5]);
  });

  it('does not climb without the chain lift', () => {
    expect(touches(ride(false)).first.has('top')).toBe(false);
  });

  it('takes two cells for a slope and one for the rest', () => {
    const at = (kind: Part['kind']) => footprint({ id: 'p', kind, x: 2, y: 0, z: 2, yaw: 90 });
    expect(at('descent')).toEqual([{ x: 2, z: 2 }, { x: 2, z: 3 }]);
    expect(at('ascent')).toHaveLength(2);
    expect(at('track')).toEqual([{ x: 2, z: 2 }]);
    expect(at('curve')).toEqual([{ x: 2, z: 2 }]);
  });
});
