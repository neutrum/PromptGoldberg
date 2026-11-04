import { describe, expect, it } from 'vitest';
import type { Part } from '@pg/core';
import { cellsAround, readBuildMove, yawToward } from '../src/words/build';

const ball: Part = { id: 'ball', kind: 'ball', label: 'snowball', x: 2, y: 3, z: 4, yaw: 0 };
const cave: Part = { id: 'cave', kind: 'bucket', label: 'cave', x: 18, y: 0, z: 6, yaw: 0 };
const rock: Part = { id: 'rock1', kind: 'wall', fixed: true, prop: 'rock', x: 9, y: 0, z: 9, yaw: 0 };
const ramp: Part = { id: 'r1', kind: 'ramp', x: 0, y: 0, z: 0, yaw: 0 };
const fan: Part = { id: 'f1', kind: 'fan', x: 0, y: 0, z: 0, yaw: 0 };
const ctx = (placed: Part[] = []) => ({ parts: [ball, cave, rock, ...placed], hand: [ramp, fan], placed: new Set(placed.map((p) => p.id)) });

describe('building by words', () => {
  it('finds a workbench part by its own name, not by the kit word in it', () => {
    const chute: Part = { id: 'kit1', kind: 'wall', prop: 'landmark', label: 'Spiral Chute', build: [], x: 0, y: 0, z: 0, yaw: 0 };
    const withChute = { ...ctx(), hand: [ramp, fan, chute] };
    expect(readBuildMove('put the spiral chute 4 cells east of the snowball', withChute)).toMatchObject({ action: 'place', index: 2, kind: 'wall', at: { x: 6, z: 4 }, what: 'spiral chute' });
    // A plain chute is still the ramp, and a wall is never the workbench part.
    expect(readBuildMove('put a chute under the snowball', withChute)).toMatchObject({ index: 0, kind: 'ramp' });
    expect(readBuildMove('add a wall next to the rock', withChute)).toMatchObject({ index: -1, kind: 'wall' });
  });


  it('places a tray part under or beside something named on the board, facing what was said', () => {
    expect(readBuildMove('put a ramp under the snowball facing the cave', ctx())).toEqual({ action: 'place', index: 0, kind: 'ramp', at: { x: 2, z: 4 }, near: false, yaw: 0, what: 'ramp' });
    expect(readBuildMove('add a fan next to the rock facing north', ctx())).toMatchObject({ action: 'place', index: 1, at: { x: 9, z: 9 }, near: true, yaw: 270 });
    expect(readBuildMove('place the ramp 3 cells east of the ball', ctx())).toMatchObject({ action: 'place', index: 0, at: { x: 5, z: 4 } });
    expect(readBuildMove('put the fan at 7,8', ctx())).toMatchObject({ action: 'place', index: 1, at: { x: 7, z: 8 } });
    // No place named: the part goes in hand for a click.
    expect(readBuildMove('add a ramp', ctx())).toEqual({ action: 'place', index: 0, kind: 'ramp', what: 'ramp' });
    // Adding always adds: with the tray's ramp already down, or a kind the tray never had, it is a new one.
    expect(readBuildMove('add a ramp', ctx([{ ...ramp, x: 4, z: 4 }]))).toMatchObject({ action: 'place', index: -1, kind: 'ramp' });
    expect(readBuildMove('add a cannon next to the rock', ctx())).toMatchObject({ action: 'place', index: -1, kind: 'cannon', at: { x: 9, z: 9 } });
    // Coaster track by its names; a ramp is still a ramp, and "corner" names a place, not a curve.
    expect(readBuildMove('add a coaster track 3 cells east of the ball', ctx())).toMatchObject({ action: 'place', kind: 'track', at: { x: 5, z: 4 } });
    expect(readBuildMove('add a curved track', ctx())).toMatchObject({ kind: 'curve' });
    expect(readBuildMove('put a chain lift next to the ball', ctx())).toMatchObject({ kind: 'ascent' });
    expect(readBuildMove('add a descent', ctx())).toMatchObject({ kind: 'descent' });
    expect(readBuildMove('move the ramp to the corner', ctx([{ ...ramp, x: 4, z: 4 }]))).not.toMatchObject({ kind: 'curve' });
  });

  it('moves, turns and removes parts already down', () => {
    const down: Part = { ...ramp, x: 4, z: 4 };
    expect(readBuildMove('move the ramp 2 cells south', ctx([down]))).toMatchObject({ action: 'place', index: 0, at: { x: 4, z: 6 } });
    expect(readBuildMove('turn the ramp west', ctx([down]))).toEqual({ action: 'turn', index: 0, yaw: 180, what: 'ramp' });
    expect(readBuildMove('rotate the ramp towards the cave', ctx([down]))).toMatchObject({ action: 'turn', yaw: 0 });
    expect(readBuildMove('remove the ramp', ctx([down]))).toEqual({ action: 'remove', index: 0, what: 'ramp' });
  });

  it('says plainly what it cannot find, and leaves other wishes to the AI', () => {
    expect(readBuildMove('move the cannon 2 cells east', ctx())).toMatchObject({ action: 'error' });
    expect(readBuildMove('put a ramp under the dragon', ctx())).toMatchObject({ action: 'error' });
    expect(readBuildMove('make it snowy', ctx())).toBeNull();
    expect(readBuildMove('paint the sky pink', ctx())).toBeNull();
  });

  it('points toward a cell and tries the nearest cells first', () => {
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: -5 })).toBe(270);
    expect(cellsAround({ x: 5, z: 5 }, false)[0]).toEqual({ x: 5, z: 5 });
    expect(cellsAround({ x: 5, z: 5 }, true)[0]).not.toEqual({ x: 5, z: 5 });
  });
});
