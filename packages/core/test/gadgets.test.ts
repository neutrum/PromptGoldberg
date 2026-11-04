import { beforeAll, describe, expect, it } from 'vitest';
import { assemblePart, gadgetFromWords, GADGET_PRESETS, initPhysics, makeLevelPuzzle, parseMachine, partOfSpare, simulateSync, spareOf, type MachineSpec, type Part } from '../src';

beforeAll(async () => { await initPhysics(); });

const chute = gadgetFromWords('a chute with rails')!;
const gadget = (over: Partial<Part> = {}): Part => ({ id: 'chute', kind: 'wall', x: 4, y: 0, z: 8, yaw: 0, prop: 'landmark', label: chute.name, build: chute.shapes, ...over });

describe('workbench parts', () => {
  it('knows a few parts by word', () => {
    expect(gadgetFromWords('make me a ski jump')?.name).toBe('ski jump');
    expect(gadgetFromWords('a round bumper')?.name).toBe('bumper');
    expect(gadgetFromWords('a teapot')).toBeNull();
  });

  it('collides with its tilted boxes too, every preset', () => {
    for (const { gadget: g } of GADGET_PRESETS) {
      const bodies = assemblePart(gadget({ label: g.name, build: g.shapes })).bodies;
      expect(bodies.length).toBe(g.shapes.filter((s) => s.shape === 'box' || !s.tilt).length);
    }
  });

  it('carries a ball down its slope toward its facing', () => {
    // The ball drops on the high end (the chute's first cell); a wall past its low end stops it.
    const parts: Part[] = [{ id: 'ball', kind: 'ball', x: 4, y: 2, z: 8, yaw: 0 }, gadget(), { id: 'stop', kind: 'wall', x: 8, y: 0, z: 8, yaw: 0 }];
    const run = simulateSync({ title: 'chute', parts, goal: [], duration: 5 } as unknown as MachineSpec, { record: false });
    expect(run.events.some((e) => e.type === 'touch' && e.part === 'chute')).toBe(true);
    expect(run.events.some((e) => e.type === 'touch' && e.part === 'stop')).toBe(true);
  });

  it('is a valid part for the player and travels as a spare with its shapes', () => {
    const level = { title: 't', parts: [{ id: 'ball', kind: 'ball', x: 1, y: 0, z: 1, yaw: 0 }, { id: 'goal', kind: 'bucket', x: 10, y: 0, z: 10, yaw: 0 }, gadget()], goal: [{ type: 'bucket', part: 'goal' }], par: 1 };
    expect(parseMachine(level).ok).toBe(true);
    const spare = spareOf(gadget());
    expect(spare).toMatchObject({ kind: 'wall', label: 'chute', build: chute.shapes });
    const withKit = parseMachine({ ...level, parts: level.parts.slice(0, 2), spares: [spare, { kind: 'ramp' }] });
    expect(withKit.ok).toBe(true);
    const hand = makeLevelPuzzle((withKit as { spec: MachineSpec }).spec)!.spares!;
    expect(hand[0]).toMatchObject({ kind: 'wall', prop: 'landmark', label: 'chute' });
    expect(partOfSpare({ kind: 'ramp' }, 'r').prop).toBeUndefined();
  });

  it('turns a spinning shape in the physics and records it for the replay', () => {
    const spinner = gadgetFromWords('a spinning sweeper')!;
    expect(spinner.name).toBe('spinner');
    const parts: Part[] = [{ id: 'ball', kind: 'ball', x: 1, y: 0, z: 1, yaw: 0 }, gadget({ id: 's', label: spinner.name, build: spinner.shapes })];
    const run = simulateSync({ title: 'spin', parts, goal: [], duration: 1 } as unknown as MachineSpec);
    const arms = run.dynamicIds.filter((id) => id.startsWith('s'));
    expect(arms.length).toBe(2);
    // Half a turn a second: after a second the arm points the other way, so its quaternion's y has moved by a lot.
    const qy = (f: number) => run.frames[f * run.frameStride + 1 + run.dynamicIds.indexOf(arms[0]) * 7 + 4];
    expect(Math.abs(qy(run.frameCount - 1) - qy(0))).toBeGreaterThan(0.5);
  });
});
