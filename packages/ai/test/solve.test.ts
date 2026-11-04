import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMachine, type MachineSpec } from '@pg/core';
import { createMachine, createPhysics } from '../src';
import { solveProblems } from '../src/machine/pipeline';
import { FakeLlm } from './helpers';

const fixture = (name: string): MachineSpec => {
  const parsed = parseMachine(JSON.parse(readFileSync(new URL(`../../core/src/fixtures/${name}`, import.meta.url), 'utf8')));
  if (!parsed.ok) throw new Error('invalid fixture');
  return parsed.spec;
};
const level = fixture('ramp-dominoes-bell.json');
const ball = level.parts.find((p) => p.kind === 'ball')!;
const reply = (spec: object) => JSON.stringify(spec);
const ramp = { id: 'added-ramp', kind: 'ramp' as const, x: 1, y: 0, z: 1, yaw: 0 as const };

describe('solving a level on request', () => {
  it('lets the AI only add mechanisms, never move, drop or change the level’s own parts', () => {
    expect(solveProblems(level, { ...level, parts: [...level.parts, ramp] })).toEqual([]);
    const moved = { ...level, parts: [...level.parts.map((p) => (p.id === ball.id ? { ...p, x: p.x + 1 } : p)), ramp] };
    expect(solveProblems(level, moved).join(' ')).toMatch(new RegExp(`Leave "${ball.id}"`));
    expect(solveProblems(level, { ...level, parts: [...level.parts.filter((p) => p.id !== ball.id), ramp] }).join(' ')).toMatch(/only add parts/);
    expect(solveProblems(level, { ...level, parts: [...level.parts, { ...ramp, kind: 'bucket' }] }).join(' ')).toMatch(/add only/);
    expect(solveProblems(level, level).join(' ')).toMatch(/Add the parts/);
  });

  it('never reports a level solved when the AI adds nothing, even if the run happens to work', async () => {
    // This level already runs on its own: only the "add parts" rule stops an empty answer counting.
    const llm = new FakeLlm([() => reply(level)]);
    const res = await createMachine({ solve: level }, { llm, physics: createPhysics('inline'), maxAttempts: 1, timeLimitMs: 500, budget: 5 });
    expect(res.result.success).toBe(true);
    expect(res.solved).toBe(false);
  }, 60_000);

  it('refuses an answer that moves the ball', async () => {
    const cheat = { ...level, parts: [...level.parts.map((p) => (p.id === ball.id ? { ...p, x: p.x + 1 } : p)), ramp] };
    const llm = new FakeLlm([() => reply(cheat)]);
    await expect(createMachine({ solve: level }, { llm, physics: createPhysics('inline'), maxAttempts: 1 })).rejects.toThrow(/fixed but was changed/);
  }, 60_000);
});
