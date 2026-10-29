import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MachineSpec } from '@og/machine';
import { createMachine, createPhysics } from '../src';
import { FakeLlm } from './helpers';

// These cover the full designer; the route-graph fast path has its own tests.
process.env.MACHINE_ROUTE = 'off';
process.env.EDIT_OPS = 'off';

const fixture = (name: string): MachineSpec => JSON.parse(readFileSync(new URL(`../../machine/src/fixtures/${name}`, import.meta.url), 'utf8'));
const reply = (spec: object) => '```json\n' + JSON.stringify({ ...spec, caption: 'Watch it go.' }) + '\n```';

describe('editing a machine keeps the ball and the goal parts fixed', () => {
  const machine = fixture('ramp-dominoes-bell.json');
  // The cheat: the ball starts right over the bell.
  const cheat = { ...machine, parts: machine.parts.map((p) => (p.id === 'ball' ? { ...p, x: 11, y: 3 } : p)) };
  // A fair change leaves the proven geometry intact.
  const fair = { ...machine, title: 'Coral slide', parts: machine.parts.map((p) => (p.id === 'ramp' ? { ...p, color: '#ff7f50' } : p)) };

  it('tells the model what is fixed, and sends a reply that moves the ball back with the reason', async () => {
    const llm = new FakeLlm([reply(cheat), reply(machine)]);
    const res = await createMachine({ machine, instruction: 'move the ball above the bell' }, { llm, physics: createPhysics('inline'), maxAttempts: 1 });
    // Returning the unchanged original respects the lock, but does not fulfill the edit.
    expect(res.solved).toBe(false);
    expect(res.verified).toBe(false);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0].prompt).toMatch(/FIXED PARTS/);
    expect(llm.requests[0].prompt).toMatch(/dominoes = "row"/);
    expect(llm.requests[1].prompt).toMatch(/"ball" \(the ball\) is fixed but was changed/);
    expect(res.machine.parts.find((p) => p.id === 'ball')).toMatchObject({ x: 5, y: 6 });
  });

  it('fails rather than deliver a machine that breaks the lock', async () => {
    const llm = new FakeLlm([reply(cheat)]);
    await expect(createMachine({ machine, instruction: 'move the ball above the bell' }, { llm, physics: createPhysics('inline') })).rejects.toThrow(/valid/);
    // The first reply and two retries, each told why; then it gives up rather than cheat.
    expect(llm.requests).toHaveLength(3);
  });

  it('accepts a change to the mechanism when the ball keeps its fixed cell', async () => {
    const llm = new FakeLlm([reply(fair)]);
    const res = await createMachine({ machine, instruction: 'paint the ramp coral' }, { llm, physics: createPhysics('inline') });
    expect(llm.requests).toHaveLength(1);
    expect(res.machine.title).toBe('Coral slide');
    expect(res.machine.parts.find((p) => p.id === 'ramp')?.color).toBe('#ff7f50');
    expect(res.solved).toBe(true);
  }, 30_000);
});
