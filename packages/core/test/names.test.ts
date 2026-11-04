import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutProblems, lockedParts, lockProblems, obstacles, parseMachine, partNames, type MachineSpec } from '../src';

const load = (name: string): MachineSpec => {
  const parsed = parseMachine(JSON.parse(readFileSync(join(import.meta.dirname, '../src/fixtures', name), 'utf8')));
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join('; '));
  return parsed.spec;
};

describe('part names', () => {
  it('names parts by kind, numbered only when there is more than one', () => {
    const spec = load('ramp-dominoes-bell.json');
    const names = partNames(spec.parts);
    expect(names.get('row')).toBe('dominoes');
    expect(names.get('bell')).toBe('bell');
    const two = [...spec.parts, { ...spec.parts.find((p) => p.id === 'row')!, id: 'row2', x: 14 }];
    const numbered = partNames(two);
    expect(numbered.get('row')).toBe('dominoes #1');
    expect(numbered.get('row2')).toBe('dominoes #2');
    expect(numbered.get('ball')).toBe('ball');
  });
});

describe('the edit lock', () => {
  const spec = load('ramp-dominoes-bell.json');
  const edit = (f: (s: MachineSpec) => MachineSpec) => f(JSON.parse(JSON.stringify(spec)) as MachineSpec);

  it('locks the ball and every goal part', () => {
    expect([...lockedParts(spec)].sort()).toEqual(['ball', 'bell', 'row']);
  });

  it('refuses a moved or removed ball or goal part, and a goal made easier', () => {
    const movedBall = edit((s) => ({ ...s, parts: s.parts.map((p) => (p.id === 'ball' ? { ...p, x: 11, y: 2 } : p)) }));
    expect(lockProblems(spec, movedBall)).toEqual([expect.stringMatching(/"ball" .*fixed but was changed/)]);
    const noBell = edit((s) => ({ ...s, parts: s.parts.filter((p) => p.id !== 'bell'), goal: s.goal.filter((g) => g.part !== 'bell') }));
    expect(lockProblems(spec, noBell)).toEqual([expect.stringMatching(/"bell" .*removed/), expect.stringMatching(/goal step "bell bell" was dropped/)]);
    const turned = edit((s) => ({ ...s, parts: s.parts.map((p) => (p.id === 'row' ? { ...p, yaw: 180 as const } : p)) }));
    expect(lockProblems(spec, turned)).toHaveLength(1);
    const shorter = edit((s) => ({ ...s, parts: s.parts.map((p) => (p.id === 'row' ? { ...p, length: 3 } : p)) }));
    expect(lockProblems(spec, shorter)).toHaveLength(1);
  });

  it('allows changes to the mechanism, extra goal steps, more rings and the optimizer\'s offsets', () => {
    const fair = edit((s) => ({
      ...s,
      parts: [...s.parts.map((p) => (p.id === 'ramp' ? { ...p, x: 4 } : p.id === 'ball' ? { ...p, dx: 0.2 } : p)), { id: 'fan', kind: 'fan', x: 7, y: 1, z: 11, yaw: 0 }],
      goal: [{ type: 'touch', part: 'fan' }, ...s.goal.map((g) => (g.type === 'bell' ? { ...g, times: 2 } : g))],
    }));
    expect(lockProblems(spec, fair)).toEqual([]);
    const fewerRings = edit((s) => ({ ...s, goal: s.goal.map((g) => (g.type === 'bell' ? { ...g, times: 2 } : g)) }));
    expect(lockProblems(fewerRings, spec)).toEqual([expect.stringMatching(/may not ring fewer/)]);
  });
});

describe('scenery', () => {
  const spec = load('ramp-dominoes-bell.json');
  const edit = (f: (s: MachineSpec) => MachineSpec) => f(JSON.parse(JSON.stringify(spec)) as MachineSpec);

  it('only walls and platforms can be fixed', () => {
    const r = parseMachine({ ...spec, parts: spec.parts.map((p) => (p.id === 'bell' ? { ...p, fixed: true } : p)) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/only walls and platforms/);
  });

  it('a level needs a fixed wall in the way between the ball and the farthest target', () => {
    expect(obstacles(spec).map((p) => p.id)).toEqual(['wall']);
    expect(layoutProblems(spec)).toEqual([]);
    // Without the wall the river still counts as scenery in the way; without both there is none.
    const noWall = edit((s) => ({ ...s, parts: s.parts.filter((p) => p.id !== 'wall') }));
    expect(layoutProblems(noWall)).toEqual([]);
    const open = edit((s) => ({ ...s, terrain: [], parts: s.parts.filter((p) => p.id !== 'wall') }));
    expect(layoutProblems(open, { flat: true })).toEqual([expect.stringMatching(/no scenery in the way/)]);
    // A wall off to the side of the route does not count.
    const aside = edit((s) => ({ ...s, parts: s.parts.map((p) => (p.id === 'wall' ? { ...p, z: 3 } : p)) }));
    expect(obstacles(aside)).toEqual([]);
    // A loose wall (bin part) does not count either.
    const loose = edit((s) => ({ ...s, parts: s.parts.map((p) => (p.id === 'wall' ? { ...p, fixed: undefined } : p)) }));
    expect(obstacles(loose)).toEqual([]);
  });
});
