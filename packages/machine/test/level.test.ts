import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handOf, makeLevelPuzzle, parseMachine, withPlacements, type MachineSpec } from '../src';

const load = (name: string): MachineSpec => {
  const parsed = parseMachine(JSON.parse(readFileSync(join(import.meta.dirname, '../src/fixtures', name), 'utf8')));
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join('; '));
  return parsed.spec;
};

describe('a level nobody has run', () => {
  const level: MachineSpec = { ...load('ramp-dominoes-bell.json'), spares: [{ kind: 'trampoline' }, { kind: 'platform', length: 4 }] };

  it('keeps the stage, hands out the route parts and the spares, and runs no physics', () => {
    const puzzle = makeLevelPuzzle(level)!;
    expect(puzzle).not.toBeNull();
    expect(puzzle.verified).toBe(false);
    expect(puzzle.failedAt).toBe(-1);
    expect(puzzle.spec.parts.map((p) => p.id).sort()).toEqual(['ball', 'bell', 'row', 'shelf', 'wall']);
    expect(puzzle.spec.terrain).toEqual(level.terrain);
    expect(puzzle.missing.map((p) => p.id)).toEqual(['ramp', 'cannon']);
    expect(puzzle.spares!.map((p) => `${p.id}:${p.kind}:${p.length ?? ''}`)).toEqual(['spare1:trampoline:', 'spare2:platform:4']);
    expect(handOf(puzzle).map((p) => p.kind)).toEqual(['ramp', 'cannon', 'trampoline', 'platform']);
    // The spares never leak into the specs the physics sees.
    expect(puzzle.spec.spares).toBeUndefined();
    expect(puzzle.solution.spares).toBeUndefined();
  });

  it('is null when there is nothing to hand out', () => {
    const bare: MachineSpec = { ...level, parts: level.parts.filter((p) => ['ball', 'row', 'bell'].includes(p.id)), spares: undefined };
    expect(makeLevelPuzzle(bare)).toBeNull();
  });

  it('plays the hand back into a machine, spares included, with the AI\'s nudges for parts dropped where it had them', () => {
    const puzzle = makeLevelPuzzle({ ...level, parts: level.parts.map((p) => (p.id === 'cannon' ? { ...p, dx: 0.2 } : p)) })!;
    const hand = handOf(puzzle);
    const placed = [{ ...hand[1] }, { ...hand[2], x: 3, y: 0, z: 3 }];
    const spec = withPlacements(puzzle, placed);
    expect(spec.parts.find((p) => p.id === 'cannon')?.dx).toBe(0.2);
    expect(spec.parts.find((p) => p.id === 'spare1')).toMatchObject({ kind: 'trampoline', x: 3, z: 3 });
    expect(parseMachine(spec).ok).toBe(true);
  });
});
