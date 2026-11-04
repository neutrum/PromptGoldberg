import { describe, expect, it } from 'vitest';
import { footprint, type Part } from '@pg/core';
import { readSceneMove } from '../src/words/scene';

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

  it('builds the thing named before the place, never the place itself', () => {
    const station: Part = { id: 'scene-train-station-1', kind: 'wall', fixed: true, prop: 'landmark', label: 'train station', x: 6, y: 0, z: 16, yaw: 0, build: [{ shape: 'box', at: [0, 0, 0], size: [2, 1, 2], color: '#c9a36b' }] };
    const move = readSceneMove('build a fence around the station', { ...ctx, parts: [...ctx.parts, station] }) as { parts: Part[]; what: string };
    expect(move.parts.length).toBeGreaterThan(3);
    expect(move.parts.every((p) => p.prop === 'fence')).toBe(true);
    expect(move.what).toMatch(/fence panels around the train station/);
    expect((readSceneMove('put a rock next to the fence', { ...ctx, parts: [...ctx.parts, { ...station, label: 'fence', build: undefined, prop: 'fence' }] }) as { parts: Part[] }).parts[0].prop).toBe('rock');
  });

  it('puts a thing from the library on the board whole, beside what was named', () => {
    const move = readSceneMove('put a statue of liberty next to the tomb', ctx) as { parts: Part[]; what: string };
    expect(move.parts).toHaveLength(1);
    const statue = move.parts[0];
    expect(statue).toMatchObject({ kind: 'wall', fixed: true, prop: 'landmark', label: 'Statue of Liberty' });
    const cells = footprint(statue);
    expect(cells.length).toBeGreaterThan(4);
    for (const p of ctx.parts) for (const c of footprint(p)) expect(cells.some((d) => d.x === c.x && d.z === c.z)).toBe(false);
    expect(move.what).toBe('The Statue of Liberty next to the vampire tomb');
  });

  it('puts a thing with no place said on the way from the ball to the goal, and leaves other changes to the AI', () => {
    // Ball (2, 4) and tomb (12, 10): halfway is (7, 7).
    const near = (p: Part) => Math.hypot(p.x - 7, p.z - 7) <= 3;
    const fence = readSceneMove('add a fence', ctx) as { parts: Part[]; what: string };
    expect(fence.parts.length).toBeGreaterThan(0);
    expect(fence.parts.every(near)).toBe(true);
    expect(fence.what).toMatch(/on the way to the goal/);
    expect(readSceneMove('fence around the dragon', ctx)).toMatchObject({ error: expect.stringContaining('dragon') });
    expect(readSceneMove('make it night', ctx)).toBeNull();
  });

  it('places the worlds centrepieces and plain names by word (user: "add a ship and there is no ship")', () => {
    const ship = readSceneMove('add a ship', ctx) as { parts: Part[]; what: string };
    expect(ship.parts[0]).toMatchObject({ kind: 'wall', fixed: true, prop: 'ship' });
    expect(Math.hypot(ship.parts[0].x - 7, ship.parts[0].z - 7)).toBeLessThanOrEqual(4);
    expect((readSceneMove('put a dragon next to the tomb', ctx) as { parts: Part[] }).parts[0].prop).toBe('dragon');
    expect((readSceneMove('add a boat', ctx) as { parts: Part[] }).parts[0].label).toBe('sailboat');
    // The library's own named thing wins over the plain word.
    expect((readSceneMove('add a pirate ship', ctx) as { parts: Part[] }).parts[0]).toMatchObject({ prop: 'landmark', label: 'pirate ship' });
    expect(readSceneMove('dig a river across the middle', ctx)).toBeNull();
  });
});
