import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMachine, type Physics } from '../src';
import { applyOps } from '../src/machine/editOps';
import { FakeLlm } from './helpers';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../machine/src/fixtures/${name}`, import.meta.url), 'utf8'));
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
    const world = { name: 'British Columbia', sky: '#9ec8e0', ground: '#4e6b3a', land: '#3f7a3a', rock: '#7a7f86', water: '#2f6f9f', foliage: '#1f5a2a', accent: '#c9b27a', features: [{ kind: 'conifers' as const, amount: 'many' as const }], snow: true };
    const { spec, problems } = applyOps(level, { ops: [{ op: 'landscape', ...world }] });
    expect(problems).toEqual([]);
    expect(spec.landscape).toEqual(world);
    expect(spec.parts).toEqual(level.parts);
    expect(applyOps(spec, { ops: [{ op: 'clearLandscape' }] }).spec.landscape).toBeUndefined();
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
    const res = await createMachine({ machine: level, instruction: 'move the wall one cell east', verify: false }, { llm, physics: noPhysics });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].system).toMatch(/EDIT OPERATIONS/);
    expect(res.machine.parts.find((p) => p.id === wall.id)?.x).toBe(wall.x + 1);
    expect(res.machine.parts.find((p) => p.id === 'ramp')?.dx).toBe(0.2);
    expect(res.machine.caption).toBe('Moved the wall.');
  });

  it('sends ops that move the ball back with the reason, then falls back to the full rewrite', async () => {
    const llm = new FakeLlm([reply({ ops: [{ op: 'move', id: 'ball', x: 1 }] }), reply({ ops: [{ op: 'move', id: 'ball', x: 2 }] }), reply(level)]);
    const res = await createMachine({ machine: level, instruction: 'put the ball in the bucket', verify: false }, { llm, physics: noPhysics });
    expect(llm.requests[1].prompt).toMatch(/fixed/);
    expect(llm.requests[2].system).not.toMatch(/EDIT OPERATIONS/);
    expect(res.machine.parts.find((p) => p.id === 'ball')?.x).toBe(level.parts.find((p: { id: string }) => p.id === 'ball').x);
  });
});
