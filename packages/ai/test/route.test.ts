import { describe, expect, it } from 'vitest';
import type { MachineStreamEvent } from '@og/machine';
import { createMachine, createMachineOffline, createPhysics, routable, routeFromWords } from '../src';
import { FakeLlm } from './helpers';

const graph = {
  title: 'Pizza Express', caption: 'Fire the pizza into the oven.', start: 'shelf', links: [{ via: 'cannon', turn: 'right' }], end: 'bucket',
  names: { target: 'oven', scenery: 'guard', ball: 'pizza' }, spares: [{ kind: 'fan' }, { kind: 'trampoline' }],
};
const reply = (o: object) => '```json\n' + JSON.stringify(o) + '\n```';

describe('the route-graph fast path', () => {
  it('asks for a small graph, lays it out and returns a level the physics has run', async () => {
    const llm = new FakeLlm([reply(graph)]);
    const events: MachineStreamEvent[] = [];
    const res = await createMachine({ prompt: 'get the pizza into the oven past the guard wall', verify: false }, { llm, physics: createPhysics('inline'), onEvent: (e) => events.push(e) });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].system).toMatch(/ROUTE GRAPH/);
    expect(res.solved).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.machine.parts.some((p) => p.id === 'oven' && p.kind === 'bucket')).toBe(true);
    expect(res.machine.parts.some((p) => p.id === 'pizza' && p.kind === 'ball')).toBe(true);
    expect(res.machine.spares).toEqual([{ kind: 'fan' }, { kind: 'trampoline' }]);
    expect(events.filter((e) => e.type === 'draft').map((d) => d.status)).toEqual(['solved']);
  }, 30_000);

  it('falls back to the full designer when the graph is not valid twice', async () => {
    const llm = new FakeLlm([reply({ title: 'x' }), reply({ title: 'x' }), 'not json', 'not json', 'not json']);
    await expect(createMachine({ prompt: 'ring the bell' }, { llm, physics: createPhysics('inline'), maxAttempts: 1 })).rejects.toThrow();
    expect(llm.requests.some((r) => /ROUTE GRAPH/.test(r.system))).toBe(true);
    expect(llm.requests.some((r) => !/ROUTE GRAPH/.test(r.system))).toBe(true);
  }, 30_000);

  it('leaves missions the graph cannot say to the full designer', () => {
    expect(routable('a seesaw tips the ball into the bucket')).toBe(false);
    expect(routable('ring the bell twice')).toBe(false);
    expect(routable('get the pizza into the oven')).toBe(true);
  });

  it('builds a level from the mission\'s words with no AI at all, and says so', async () => {
    expect(routeFromWords('a windy alley: blow the ball into the bucket', 1).links[0].via).toBe('fan');
    expect(routeFromWords('ring the church bell across the river', 2).end).toBe('bell');
    const res = await createMachineOffline('knock over the dominoes behind the castle wall', { physics: createPhysics('inline') });
    expect(res.solved).toBe(true);
    expect(res.machine.closest).toMatch(/resting/);
    expect(res.usage).toEqual([]);
  }, 30_000);
});
