import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MachineStreamEvent } from '@og/machine';
import { createMachine, type Physics } from '../src';
import { difficultyOf, pickTwist, TWISTS, validateMachineDesign } from '../src/machine/design';
import { FakeLlm } from './helpers';

// These cover the full designer; the route-graph fast path has its own tests.
process.env.MACHINE_ROUTE = 'off';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../machine/src/fixtures/${name}`, import.meta.url), 'utf8'));
/** The sample with the spares a normal level needs. */
const withSpares = (spec: object) => ({ ...spec, spares: [{ kind: 'trampoline' }, { kind: 'fan' }] });
const reply = (spec: object) => '```json\n' + JSON.stringify({ ...spec, caption: 'Watch it go.' }) + '\n```';

/** Physics that must never be asked anything. */
const noPhysics: Physics = {
  mode: 'inline',
  check: () => { throw new Error('the physics ran'); },
  nudge: () => { throw new Error('the physics ran'); },
  puzzle: () => { throw new Error('the physics ran'); },
  close: async () => {},
} as unknown as Physics;

describe('a level without an answer sheet (verify: false)', () => {
  it('designs once, runs nothing and says so', async () => {
    const level = withSpares(fixture('ramp-dominoes-bell.json'));
    const llm = new FakeLlm([reply(level)]);
    const events: MachineStreamEvent[] = [];
    const res = await createMachine({ prompt: 'ring the bell across the river', verify: false }, { llm, physics: noPhysics, onEvent: (e) => events.push(e) });
    expect(res.verified).toBe(false);
    expect(res.solved).toBe(false);
    expect(res.attempts).toBe(1);
    expect(res.machine.spares).toEqual([{ kind: 'trampoline' }, { kind: 'fan' }]);
    expect(llm.requests).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['stage', 'sketch', 'draft']));
    expect(events.filter((e) => e.type === 'draft').map((d) => d.status)).toEqual(['designed']);
    const final = events.find((e) => e.type === 'machine');
    expect(final).toBeUndefined(); // the caller sends the final event; createMachine returns it
  });

  it('still rejects a level that breaks the layout rules, with the reason, before handing it over', async () => {
    const level = withSpares(fixture('ramp-dominoes-bell.json'));
    const flat = { ...level, terrain: [] };
    const llm = new FakeLlm([reply(flat), reply(level)]);
    const res = await createMachine({ prompt: 'ring the bell', verify: false }, { llm, physics: noPhysics });
    expect(res.verified).toBe(false);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].prompt).toMatch(/ground is flat/);
  });

  it('edits keep the lock and run nothing either', async () => {
    const level = fixture('ramp-dominoes-bell.json');
    const moved = { ...level, parts: level.parts.map((p: { id: string }) => (p.id === 'ramp' ? { ...p, x: 6 } : p)) };
    const llm = new FakeLlm([reply(moved)]);
    const res = await createMachine({ machine: level, instruction: 'move the ramp one cell east', verify: false }, { llm, physics: noPhysics });
    expect(res.verified).toBe(false);
    expect(res.machine.parts.find((p) => p.id === 'ramp')?.x).toBe(6);
  });

  it('hands a twist to missions that name no mechanism, and the mission\'s own words otherwise', () => {
    expect(TWISTS.length).toBeGreaterThan(5);
    expect(pickTwist('ring the bell behind the castle wall', 3)).toBe(TWISTS[3]);
    expect(pickTwist('a fan blows the ball into the bucket')).toBeUndefined();
    expect(pickTwist('keep the ground flat')).toBeUndefined();
    expect(pickTwist('a seesaw drops the ball into the moat')).toBeUndefined();
  });

  it('puts the twist in the design request', async () => {
    const llm = new FakeLlm([reply(withSpares(fixture('ramp-dominoes-bell.json')))]);
    await createMachine({ prompt: 'wake the cat in the attic', verify: false }, { llm, physics: noPhysics });
    expect(llm.requests[0].prompt).toMatch(/This level's twist, use it: /);
    expect(llm.requests[0].prompt).toMatch(/Design a level for this mission/);
  });

  it('sends a thin bin back with the reason, and maps difficulty words to enforced rules', async () => {
    const level = fixture('ramp-dominoes-bell.json');
    const llm = new FakeLlm([reply({ ...level, spares: [] }), reply(withSpares(level))]);
    await createMachine({ prompt: 'ring the bell across the river', verify: false }, { llm, physics: noPhysics });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].prompt).toMatch(/"spares"/);
    expect(llm.requests[0].prompt).toMatch(/Difficulty: NORMAL/);
    expect(difficultyOf('an easy one for my kids')).toBe('easy');
    expect(difficultyOf('make it fiendish')).toBe('hard');
    expect(difficultyOf('ring the bell')).toBe('normal');
    // A hard level wants a longer route than the sample has.
    const hard = validateMachineDesign(withSpares(level), { difficulty: 'hard', bin: true });
    expect(hard.ok).toBe(false);
    expect(validateMachineDesign(withSpares(level), { difficulty: 'normal', bin: true }).ok).toBe(true);
  });

  it('keeps an honest "closest" note when the kit cannot do what was asked', async () => {
    const llm = new FakeLlm([reply(withSpares({ ...fixture('ramp-dominoes-bell.json'), closest: 'No elephants in the kit, so the ball plays the elephant.' }))]);
    const res = await createMachine({ prompt: 'an elephant rings the bell', verify: false }, { llm, physics: noPhysics });
    expect(res.machine.closest).toMatch(/elephant/);
  });
});
