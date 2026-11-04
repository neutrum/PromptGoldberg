import { describe, expect, it } from 'vitest';
import type { MachineStreamEvent } from '@pg/core';
import { createMachine, createMachineOffline, createPhysics, routeFromWords } from '../src';
import { FakeLlm } from './helpers';

const graph = {
  title: 'Pizza Express', caption: 'Fire the pizza into the oven.', start: 'shelf', links: [{ via: 'cannon', turn: 'right' }], end: 'bucket',
  names: { target: 'oven', scenery: 'guard', ball: 'pizza' }, spares: [{ kind: 'fan' }, { kind: 'trampoline' }],
};
const reply = (o: object) => '```json\n' + JSON.stringify(o) + '\n```';

describe('the route-graph fast path', () => {
  it('asks for a small graph and sets the stage from it, solving nothing', async () => {
    const llm = new FakeLlm([reply(graph)]);
    const events: MachineStreamEvent[] = [];
    const leave = new AbortController();
    const res = await createMachine({ prompt: 'get the pizza into the oven past the guard wall' }, { llm, physics: createPhysics('inline'), signal: leave.signal, onEvent: (e) => events.push(e) });
    expect(llm.requests).toHaveLength(1);
    // The player leaving stops the AI call too: nobody pays for a level no one waits for.
    expect(llm.requests[0].signal).toBe(leave.signal);
    expect(llm.requests[0].system).toMatch(/ROUTE GRAPH/);
    expect(res.solved).toBe(false);
    expect(res.verified).toBe(false);
    // The one run is with nothing placed: the level must not solve itself.
    expect(res.result.success).toBe(false);
    expect(res.machine.parts.some((p) => p.id === 'oven' && p.kind === 'bucket')).toBe(true);
    expect(res.machine.parts.some((p) => p.id === 'pizza' && p.kind === 'ball')).toBe(true);
    // The tray: the idea's mechanisms, a ramp, the spares; the idea's length is the par.
    expect(res.machine.spares).toEqual([{ kind: 'cannon' }, { kind: 'ramp' }, { kind: 'fan' }, { kind: 'trampoline' }]);
    expect(res.machine.par).toBe(2);
    expect(res.machine.parts.some((p) => p.kind === 'cannon' || p.kind === 'fan')).toBe(false);
    expect(events.filter((e) => e.type === 'draft').map((d) => d.status)).toEqual(['designed']);
  }, 90_000); // includes the fairness search with the kit, in one thread here

  it('sets the level from the words when the graph is not valid twice, and says so', async () => {
    const llm = new FakeLlm([reply({ title: 'x' }), reply({ title: 'x' })]);
    const res = await createMachine({ prompt: 'ring the bell' }, { llm, physics: createPhysics('inline'), maxAttempts: 1 });
    expect(llm.requests.every((r) => /ROUTE GRAPH/.test(r.system))).toBe(true);
    expect(res.machine.goal.some((g) => g.type === 'bell')).toBe(true);
    expect(res.machine.closest).toMatch(/set from the words/);
  }, 30_000);

  it('reads seesaws, rings and long chains from the words', () => {
    const g = routeFromWords('a seesaw tips the ball onto the bell, ring it twice', 1);
    expect(g.links.some((l) => l.via === 'seesaw')).toBe(true);
    expect(g.rings).toBe(2);
    expect(routeFromWords('a long domino chain across the hall', 1)).toMatchObject({ end: 'dominoes', row: 14 });
  });

  it('keeps a challenge for the player to meet, and refuses one the kit cannot run', async () => {
    const few = await createMachineOffline('use only three parts to ring the bell round the corner', { physics: createPhysics('inline') });
    expect(few.machine.rules?.maxParts).toBe(3);
    const slow = await createMachineOffline('make it take longer than 14 seconds to knock the dominoes over', { physics: createPhysics('inline') });
    expect(slow.machine.rules?.minSeconds).toBe(14);
    await expect(createMachineOffline('make it take 40 seconds to knock the dominoes over', { physics: createPhysics('inline') })).rejects.toThrow(/14 seconds/);
  }, 60_000);

  it('builds a level from the mission\'s words with no AI at all, and says so', async () => {
    expect(routeFromWords('a windy alley: blow the ball into the bucket', 1).links[0].via).toBe('fan');
    expect(routeFromWords('ring the church bell across the river', 2).end).toBe('bell');
    const res = await createMachineOffline('knock over the dominoes behind the castle wall', { physics: createPhysics('inline') });
    expect(res.solved).toBe(false);
    expect(res.machine.closest).toMatch(/Offline builder: AI is unavailable/);
    expect(res.usage).toEqual([]);
  }, 30_000);
});
