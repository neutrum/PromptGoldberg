import { beforeAll, describe, expect, it } from 'vitest';
import {
  dropAt, evaluateMachine, groundAt, groundRuns, initPhysics, isSupported, layoutProblems, lockProblems, lowestGround, nudgeMachine, parseMachine,
  restingHeight, simulateSync, terrainInBox, type MachineSpec, type Terrain,
} from '../src';

beforeAll(() => initPhysics());

const parse = (input: unknown): MachineSpec => {
  const r = parseMachine(input);
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  return r.spec;
};

describe('ground map', () => {
  const river: Terrain = { name: 'river', x: 0, z: 10, w: 24, d: 2, h: -1 };
  const hill: Terrain = { name: 'hill', x: 2, z: 2, w: 4, d: 4, h: 2 };

  it('is flat where nothing is shaped, and later blocks cover earlier ones', () => {
    expect(groundAt(undefined, 5, 5)).toBe(0);
    expect(groundAt([river, hill], 3, 3)).toBe(2);
    expect(groundAt([river, hill], 3, 11)).toBe(-1);
    expect(groundAt([river, hill], 20, 20)).toBe(0);
    expect(groundAt([hill, { x: 3, z: 3, w: 1, d: 1, h: 3 }], 3, 3)).toBe(3);
    expect(lowestGround([river, hill])).toBe(-1);
    expect(lowestGround([hill])).toBe(0);
  });

  it('comes out as merged rectangles above the lowest level', () => {
    expect(groundRuns(undefined)).toEqual([]);
    const runs = groundRuns([river, hill]);
    // The flat floor above the river splits into the rows north and south of it, plus the hill on top.
    expect(runs).toEqual(expect.arrayContaining([
      { x0: 0, z0: 0, w: 24, d: 2, h: 0 },
      { x0: 0, z0: 12, w: 24, d: 12, h: 0 },
      { x0: 2, z0: 2, w: 4, d: 4, h: 2 },
    ]));
    expect(runs.every((r) => r.h !== -1)).toBe(true);
    // Only the hill stands out of flat ground.
    expect(groundRuns([hill])).toEqual([{ x0: 2, z0: 2, w: 4, d: 4, h: 2 }]);
    expect(terrainInBox([river, hill], 10, 20, 0, 23)).toEqual([river]);
    expect(terrainInBox([river, hill], 10, 20, 0, 9)).toEqual([]);
  });
});

describe('placing on shaped ground', () => {
  const terrain: Terrain[] = [{ name: 'pit', x: 8, z: 8, w: 2, d: 2, h: -2 }, { name: 'bank', x: 0, z: 0, w: 4, d: 4, h: 1 }];
  const bell = { id: 'bell', kind: 'bell' as const, x: 0, y: 0, z: 0, yaw: 0 as const };

  it('rests parts on the bank, at the bottom of the pit, or on a shelf above either', () => {
    expect(restingHeight([], 1, 1, undefined, terrain)).toBe(1);
    expect(restingHeight([], 8, 9, undefined, terrain)).toBe(-2);
    const shelf = { id: 'shelf', kind: 'platform' as const, x: 8, y: 1, z: 8, yaw: 0 as const, length: 2 };
    expect(restingHeight([shelf], 9, 8, undefined, terrain)).toBe(1);
    expect(dropAt([], bell, 1, 1, { terrain })?.y).toBe(1);
    expect(dropAt([], bell, 8, 8, { terrain })?.y).toBe(-2);
    expect(dropAt([shelf], bell, 9, 8, { terrain })?.y).toBe(1);
    // A shelf cannot go into the ground.
    expect(dropAt([], shelf, 1, 1, { y: 0, terrain })?.y).toBe(1);
    expect(isSupported([], { ...bell, x: 1, z: 1, y: 1 }, terrain)).toBe(true);
    expect(isSupported([], { ...bell, x: 1, z: 1, y: 0 }, terrain)).toBe(false);
  });
});

/** A ball on a 2-cell bank rolls down a ramp into a cannon that fires it over a ditch into a bucket on the flat floor. */
const bankLevel = {
  title: 'Off the bank',
  terrain: [{ name: 'bank', x: 0, z: 0, w: 8, d: 24, h: 2 }, { name: 'ditch', x: 10, z: 0, w: 2, d: 24, h: -1 }],
  parts: [
    { id: 'ball', kind: 'ball', x: 2, y: 3, z: 10 },
    { id: 'ramp', kind: 'ramp', x: 2, y: 2, z: 10, yaw: 0 },
    { id: 'cannon', kind: 'cannon', x: 7, y: 2, z: 10, yaw: 0 },
    { id: 'bucket', kind: 'bucket', x: 15, y: 0, z: 10 },
  ],
  goal: [{ type: 'touch', part: 'cannon' }, { type: 'bucket', part: 'bucket' }],
  duration: 10,
};

describe('simulating shaped ground', () => {
  it('a ball rolling into a ditch stays there, below the floor, without falling off the stage', () => {
    const spec = parse({ ...bankLevel, parts: bankLevel.parts.filter((p) => p.id !== 'cannon'), goal: [{ type: 'bucket', part: 'bucket' }] });
    const run = simulateSync(spec);
    expect(run.events.some((e) => e.type === 'fell')).toBe(false);
    expect(run.ballEnd[1]).toBeLessThan(0);
    expect(run.ballEnd[1]).toBeGreaterThan(-0.5);
    expect(evaluateMachine(spec.goal, run).success).toBe(false);
  });

  it('a ball rolling on a bank rolls off its edge and drops', () => {
    const spec = parse({ ...bankLevel, terrain: bankLevel.terrain.slice(0, 1), parts: bankLevel.parts.filter((p) => p.id !== 'cannon'), goal: [{ type: 'bucket', part: 'bucket' }] });
    const run = simulateSync(spec);
    // It leaves the bank at x 8 (4 m) and ends on the floor somewhere past it.
    expect(run.ballEnd[0]).toBeGreaterThan(4);
    expect(run.ballEnd[1]).toBeLessThan(0.5);
    expect(run.ballEnd[1]).toBeGreaterThan(0);
  });

  it('a cannon on the bank fires the ball over the ditch into the bucket, with the optimizer tuning the landing', () => {
    const spec = parse(bankLevel);
    const nudged = nudgeMachine(spec, { budget: 120, timeLimitMs: 20_000 });
    expect(nudged.solved, nudged.result.steps.map((s) => s.note).join('; ')).toBe(true);
    // The ground itself is never nudged.
    expect(nudged.spec.terrain).toEqual(spec.terrain);
  });

  it('a level without shaped ground is identical to the flat stage', () => {
    const flat = parse({ ...bankLevel, terrain: undefined, parts: bankLevel.parts.map((p) => ({ ...p, y: p.id === 'ball' ? 1 : 0 })) });
    const run = simulateSync(flat);
    expect(run.events.some((e) => e.type === 'fell')).toBe(false);
  });
});

describe('level rules for the ground', () => {
  const spec = parse(bankLevel);
  it('asks for shaped ground unless the request wants it flat, and keeps the ball out of the ditch', () => {
    const flat = parse({ ...bankLevel, terrain: undefined, parts: bankLevel.parts.map((p) => ({ ...p, y: p.id === 'ball' ? 1 : 0 })) });
    expect(layoutProblems(flat).some((p) => /ground is flat/.test(p))).toBe(true);
    expect(layoutProblems(flat, { flat: true }).some((p) => /ground is flat/.test(p))).toBe(false);
    const sunk = parse({ ...bankLevel, terrain: [{ x: 0, z: 0, w: 24, d: 24, h: -1 }], parts: bankLevel.parts.map((p) => ({ ...p, y: p.id === 'ball' ? 0 : -1 })) });
    expect(layoutProblems(sunk).some((p) => /starts in a ditch/.test(p))).toBe(true);
    const buried = parse({ ...bankLevel, parts: bankLevel.parts.map((p) => (p.id === 'ball' ? { ...p, y: 0 } : p)) });
    expect(layoutProblems(buried).some((p) => /inside the ground/.test(p))).toBe(true);
    // Parts have to stand on the shaped ground, not on the flat level under a hill.
    const sunkenRamp = parse({ ...bankLevel, parts: bankLevel.parts.map((p) => (p.id === 'ramp' ? { ...p, y: 0 } : p)) });
    expect(layoutProblems(sunkenRamp).some((p) => /"ramp" .* would rest at y 2/.test(p))).toBe(true);
  });

  it('edits may not reshape the ground', () => {
    const filled = { ...spec, terrain: spec.terrain!.slice(0, 1) };
    expect(lockProblems(spec, filled)).toEqual([expect.stringMatching(/ground .* was changed/)]);
    const reordered = { ...spec, terrain: [...spec.terrain!].reverse() };
    expect(lockProblems(spec, reordered)).toEqual([]);
  });
});
