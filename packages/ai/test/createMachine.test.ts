import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MachineStreamEvent } from '@og/machine';
import { createMachine, createPhysics } from '../src';
import { FakeLlm } from './helpers';

// These cover the full designer; the route-graph fast path has its own tests.
process.env.MACHINE_ROUTE = 'off';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../machine/src/fixtures/${name}`, import.meta.url), 'utf8'));
const reply = (spec: object) => '```json\n' + JSON.stringify({ ...spec, caption: 'Watch it go.' }) + '\n```';

describe('createMachine', () => {
  it('runs a working design once and streams drafts', async () => {
    const llm = new FakeLlm([reply(fixture('ramp-dominoes-bell.json'))]);
    const events: MachineStreamEvent[] = [];
    const res = await createMachine({ prompt: 'dominoes and a bell' }, { llm, physics: createPhysics('inline'), onEvent: (e) => events.push(e) });
    expect(res.solved).toBe(true);
    expect(res.attempts).toBe(1);
    expect(res.machine.caption).toBe('Watch it go.');
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['stage', 'sketch', 'draft']));
    const drafts = events.filter((e) => e.type === 'draft');
    expect(drafts.map((d) => d.status)).toEqual(['designed', 'solved']);
    expect(llm.requests).toHaveLength(1);
  });

  it('nudges a design that almost works, and asks for a redesign with the run story when it cannot', async () => {
    const level = fixture('ramp-dominoes-bell.json');
    // The sample with its cannon two cells past the wall instead of one: the ball just misses it until nudged.
    const broken = { ...level, parts: level.parts.map((p: { id: string }) => (p.id === 'cannon' ? { ...p, x: 15 } : p)) };
    // A hopeless design first (the bell nowhere near the dominoes), then the one the optimizer can fix.
    const hopeless = { ...level, parts: level.parts.map((p: { id: string }) => (p.id === 'bell' ? { ...p, x: 22, z: 2 } : p)) };
    const llm = new FakeLlm([reply(hopeless), reply(broken)]);
    const res = await createMachine({ prompt: 'over the wall and round the corner' }, { llm, physics: createPhysics('inline'), budget: 250, timeLimitMs: 40_000 });
    expect(res.solved).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.moved.length).toBeGreaterThan(0);
    expect(llm.requests[1].prompt).toMatch(/did not work/);
    expect(llm.requests[1].prompt).toMatch(/touch (ramp|shelf|wall|cannon)/);
  }, 60_000);

  it('retries once when the reply is not a valid machine', async () => {
    const llm = new FakeLlm(['```json\n{"title":"x","parts":[],"goal":[]}\n```', reply(fixture('ramp-dominoes-bell.json'))]);
    const res = await createMachine({ prompt: 'anything' }, { llm, physics: createPhysics('inline') });
    expect(res.solved).toBe(true);
    expect(llm.requests[1].prompt).toMatch(/failed validation/);
  });
});
