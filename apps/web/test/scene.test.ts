import { describe, expect, it } from 'vitest';
import type { Part } from '@og/machine';
import { readSceneMove } from '../src/machine/scene';

const ball: Part = { id: 'ball', kind: 'ball', label: 'garlic bulb', x: 2, y: 3, z: 4, yaw: 0 };
const tomb: Part = { id: 'vampiretomb', kind: 'bucket', label: 'vampire tomb', x: 12, y: 0, z: 10, yaw: 0 };
const rock: Part = { id: 'rock-f1', kind: 'wall', fixed: true, prop: 'rock', x: 13, y: 0, z: 9, yaw: 0 };
const ctx = { parts: [ball, tomb, rock], stage: { x: 24, z: 24 } };

describe('changing the level in words', () => {
  it('builds a fence round the thing named, as fixed scenery, never on a taken cell', () => {
    const move = readSceneMove('build a fence around the tomb', ctx);
    expect(move && 'parts' in move).toBe(true);
    const parts = (move as { parts: Part[] }).parts;
    // The 3 by 3 ring round the tomb, less the rock's cell.
    expect(parts).toHaveLength(7);
    expect(parts.every((p) => p.kind === 'wall' && p.fixed && p.prop === 'fence')).toBe(true);
    expect(parts.some((p) => p.x === 13 && p.z === 9)).toBe(false);
    // Panels run along each side: north and south sides turned across.
    expect(parts.find((p) => p.x === 12 && p.z === 9)?.yaw).toBe(90);
    expect(parts.find((p) => p.x === 11 && p.z === 10)?.yaw).toBe(0);
    expect((move as { what: string }).what).toMatch(/fence panels around the vampire tomb/);
  });

  it('puts rocks, trees and walls next to, in front of or between things', () => {
    expect((readSceneMove('put three rocks next to the ball', ctx) as { parts: Part[] }).parts).toHaveLength(3);
    const wall = readSceneMove('a wall between the ball and the tomb', ctx) as { parts: Part[] };
    expect(wall.parts.length).toBeGreaterThanOrEqual(3);
    expect(wall.parts.every((p) => p.kind === 'wall' && !p.prop && p.x === 7)).toBe(true);
    expect((readSceneMove('plant a tree in front of the tomb', ctx) as { parts: Part[] }).parts[0].prop).toBe('tree');
  });

  it('asks where when it is not said, and leaves other changes to the AI', () => {
    expect(readSceneMove('add a fence', ctx)).toMatchObject({ error: expect.stringContaining('Say where') });
    expect(readSceneMove('fence around the dragon', ctx)).toMatchObject({ error: expect.stringContaining('dragon') });
    expect(readSceneMove('make it night', ctx)).toBeNull();
    expect(readSceneMove('dig a river across the middle', ctx)).toBeNull();
  });
});
