import { describe, expect, it } from 'vitest';
import { partNames, partsNamed, readBuildMove, readSceneMove, type Part } from '@pg/core';

const ball: Part = { id: 'ball', kind: 'ball', label: 'marble', x: 2, y: 3, z: 4, yaw: 0 };
const bell: Part = { id: 'bell', kind: 'bell', label: 'departure bell', x: 14, y: 0, z: 10, yaw: 0 };
const station = (id: string, x: number): Part => ({ id, kind: 'wall', fixed: true, prop: 'landmark', label: 'train station', x, y: 0, z: 18, yaw: 0, build: [{ shape: 'box', at: [0, 0, 0], size: [2, 1, 2], color: '#c9a36b' }] });
const rock = (id: string, x: number): Part => ({ id, kind: 'wall', fixed: true, prop: 'rock', x, y: 0, z: 2, yaw: 0 });
const parts = [ball, bell, station('s1', 4), station('s2', 12), rock('r1', 8), rock('r2', 10), rock('r3', 20)];
const ctx = { parts, stage: { x: 24, z: 24 } };

describe('names a click puts in the prompt', () => {
  it('numbers things that share a name, obstacles by what they are', () => {
    const names = partNames(parts);
    expect(names.get('s2')).toBe('train station #2');
    expect(names.get('r1')).toBe('rock #1');
    expect(names.get('bell')).toBe('departure bell');
  });

  it('finds exactly the numbered thing, never #1 inside #12', () => {
    expect(partsNamed('build a fence around train station #2', parts).map((p) => p.id)).toEqual(['s2']);
    const many = Array.from({ length: 12 }, (_, i) => rock(`k${i + 1}`, i));
    expect(partsNamed('remove rock #12', many).map((p) => p.id)).toEqual(['k12']);
  });

  it('builds round the station clicked', () => {
    const move = readSceneMove('build a fence around train station #2', ctx) as { parts: Part[]; what: string };
    expect(move.what).toMatch(/around the train station/);
    expect(move.parts.every((p) => Math.abs(p.x - 12.5) <= 2)).toBe(true);
  });

  it('leaves a thing it does not know to the AI, never building a place named after from or to', () => {
    expect(readSceneMove('add road from beach hut to hut', ctx)).toBeNull();
    expect(readSceneMove('add a red carpet from the station to the bell', ctx)).toBeNull();
    expect(readSceneMove('add a road that connects start with house #1 and house #3', ctx)).toBeNull();
    expect(readSceneMove('build a path to the station', ctx)).toBeNull();
  });
});

describe('removing scenery in words, no AI', () => {
  it('removes the one clicked', () => {
    expect(readSceneMove('remove train station #1', ctx)).toEqual({ remove: ['s1'], what: 'The train station #1' });
  });
  it('removes every one when the words say so, and asks which when they do not', () => {
    expect((readSceneMove('remove the rocks', ctx) as { remove: string[] }).remove).toEqual(['r1', 'r2', 'r3']);
    expect(readSceneMove('remove the rock', ctx)).toMatchObject({ error: expect.stringMatching(/click one/) });
  });
  it('never removes the ball or the goal', () => {
    expect(readSceneMove('remove the departure bell', ctx)).toMatchObject({ error: expect.stringMatching(/not scenery/) });
  });
});

describe('building moves on the numbered part', () => {
  it('moves the ramp named, not the last one put down', () => {
    const r1: Part = { id: 'h1', kind: 'ramp', x: 5, y: 0, z: 5, yaw: 0 };
    const r2: Part = { id: 'h2', kind: 'ramp', x: 9, y: 0, z: 9, yaw: 0 };
    const move = readBuildMove('move ramp #1 2 cells east', { parts: [...parts, r1, r2], hand: [r1, r2], placed: new Set(['h1', 'h2']) });
    expect(move).toMatchObject({ action: 'place', index: 0, at: { x: 7, z: 5 } });
  });
});
