import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groundAt, Landscape, MachineSpec } from '@pg/core';
import { createMachine, type Physics } from '../src';
import { applyOps } from '../src/machine/editOps';
import { FakeLlm } from './helpers';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../core/src/fixtures/${name}`, import.meta.url), 'utf8'));
const reply = (o: object) => '```json\n' + JSON.stringify(o) + '\n```';
const noPhysics = { mode: 'inline', check: () => { throw new Error('ran'); }, nudge: () => { throw new Error('ran'); }, puzzle: () => { throw new Error('ran'); }, compile: () => { throw new Error('ran'); } } as unknown as Physics;

describe('edits as diff ops', () => {
  const level = { ...fixture('ramp-dominoes-bell.json'), parts: fixture('ramp-dominoes-bell.json').parts.map((p: { id: string }) => (p.id === 'ramp' ? { ...p, dx: 0.2 } : p)) };

  it('applies ops in order and reports unknown ids', () => {
    const { spec, problems } = applyOps(level, { ops: [{ op: 'rotate', id: 'ramp', yaw: 90 }, { op: 'remove', id: 'nope' }] });
    expect(spec.parts.find((p) => p.id === 'ramp')?.yaw).toBe(90);
    expect(problems).toEqual(['remove: no part "nope"']);
  });
  it('reshapes the ground and resizes the stage, with parts on the ground following it', () => {
    const free = level.parts.find((p: { kind: string; y: number }) => p.kind !== 'ball' && p.kind !== 'platform' && p.y === 0 && !level.goal.some((g: { part: string }) => g.part === (p as unknown as { id: string }).id));
    const { spec, problems } = applyOps(level, { ops: [
      { op: 'ground', name: 'hill', x: free.x, z: free.z, w: 1, d: 1, h: 1 },
      { op: 'stage', x: 28, z: 20 },
    ] });
    expect(problems).toEqual([]);
    expect(spec.terrain?.at(-1)).toEqual({ name: 'hill', x: free.x, z: free.z, w: 1, d: 1, h: 1 });
    expect(spec.parts.find((p) => p.id === free.id)?.y).toBe(1);
    expect(spec.stage).toEqual({ x: 28, z: 20 });
    const flat = applyOps(spec, { ops: [{ op: 'flatten', name: 'hill' }, { op: 'stage', x: 24, z: 24 }] });
    expect(flat.problems).toEqual([]);
    expect(flat.spec.parts.find((p) => p.id === free.id)?.y).toBe(0);
    expect(flat.spec.stage).toBeUndefined();
    expect(applyOps(level, { ops: [{ op: 'flatten', name: 'volcano' }] }).problems[0]).toMatch(/no ground named "volcano"/);
  });
  it('dresses the world around the board without moving a part, and clears it again', () => {
    const world = { name: 'British Columbia', setting: 'outdoor' as const, sky: '#9ec8e0', ground: '#4e6b3a', land: '#3f7a3a', rock: '#7a7f86', water: '#2f6f9f', foliage: '#1f5a2a', accent: '#c9b27a', features: [{ kind: 'conifers' as const, amount: 'many' as const }], snow: true };
    const { spec, problems } = applyOps(level, { ops: [{ op: 'landscape', ...world }] });
    expect(problems).toEqual([]);
    expect(spec.landscape).toEqual(world);
    expect(spec.parts).toEqual(level.parts);
    expect(applyOps(spec, { ops: [{ op: 'clearLandscape' }] }).spec.landscape).toBeUndefined();
  });
  it('stands a thing the player names on the board, composed from shapes, as a solid obstacle', () => {
    const shapes = [{ shape: 'box' as const, at: [0, 0, 0] as [number, number, number], size: [2, 1, 2] as [number, number, number], color: '#b5a789' }, { shape: 'frustum' as const, at: [0, 1, 0] as [number, number, number], size: [1, 3, 0.5] as [number, number, number], color: '#5fa89a' }];
    const { spec, problems } = applyOps(level, { ops: [{ op: 'object', id: 'liberty', x: 18, z: 18, yaw: 0, name: 'Statue of Liberty', shapes }] });
    expect(problems).toEqual([]);
    expect(spec.parts.find((p) => p.id === 'liberty')).toMatchObject({ kind: 'wall', fixed: true, prop: 'landmark', label: 'Statue of Liberty', build: shapes });
  });

  it('changes appearance without losing placement or optimizer offsets', () => {
    const { spec, problems } = applyOps(level, { ops: [{ op: 'set', id: 'ramp', color: '#ff7f50', label: 'Pizza slide' }] });
    expect(problems).toEqual([]);
    expect(spec.parts.find((p) => p.id === 'ramp')).toEqual({ ...level.parts.find((p: { id: string }) => p.id === 'ramp'), color: '#ff7f50', label: 'Pizza slide' });
    expect(spec.goal).toEqual(level.goal);
  });

  it('answers an edit with a short ops reply on the fast model, keeping untouched parts and their nudges', async () => {
    const wall = level.parts.find((p: { kind: string; fixed?: boolean }) => p.kind === 'wall');
    const llm = new FakeLlm([reply({ ops: [{ op: 'move', id: wall.id, x: wall.x + 1 }], caption: 'Moved the wall.' })]);
    const res = await createMachine({ machine: level, instruction: 'move the wall one cell east' }, { llm, physics: noPhysics });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].system).toMatch(/EDIT OPERATIONS/);
    expect(res.machine.parts.find((p) => p.id === wall.id)?.x).toBe(wall.x + 1);
    expect(res.machine.parts.find((p) => p.id === 'ramp')?.dx).toBe(0.2);
    expect(res.machine.caption).toBe('Moved the wall.');
  });

  it('sends ops that move the ball back with the reason, and gives up after three tries without the slow full rewrite', async () => {
    const bad = reply({ ops: [{ op: 'move', id: 'ball', x: 1 }] });
    const llm = new FakeLlm([bad, bad, bad, reply(level)]);
    await expect(createMachine({ machine: level, instruction: 'put the ball in the bucket' }, { llm, physics: noPhysics })).rejects.toThrow(/Could not get a valid design/);
    expect(llm.requests[1].prompt).toMatch(/fixed/);
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests.every((r) => /EDIT OPERATIONS/.test(r.system))).toBe(true);
  });

  it('lays a road as flat ground and takes world colours written without the #', () => {
    const { spec, problems } = applyOps(level, { ops: [{ op: 'ground', name: 'road', x: 2, z: 2, w: 10, d: 2, h: 0 }] });
    expect(problems).toEqual([]);
    expect(spec.parts).toEqual(level.parts);
    const carpet = applyOps(level, { ops: [{ op: 'ground', name: 'red carpet', x: 2, z: 5, w: 8, d: 1, h: 0, color: 'c0392b' }] });
    expect(carpet.problems).toEqual([]);
    expect(carpet.spec.parts).toEqual(level.parts);
    expect(MachineSpec.parse(carpet.spec).terrain?.at(-1)?.color).toBe('#c0392b');
    const world = Landscape.parse({ name: 'Night', setting: 'outdoor', sky: '0b1026', ground: '#4a4a52', land: '3b3f4a', rock: '5c5f6b', water: '1f3b5c', foliage: '1e3a2a', accent: 'ffb347', features: [{ kind: 'houses', amount: 'some' }] });
    expect([world.sky, world.ground]).toEqual(['#0b1026', '#4a4a52']);
  });
});
