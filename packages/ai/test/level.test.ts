import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMachine, type Physics } from '../src';
import { FakeLlm } from './helpers';

// The full rewrite of an edit; the compact edit operations have their own tests.
process.env.EDIT_OPS = 'off';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../core/src/fixtures/${name}`, import.meta.url), 'utf8'));
const reply = (spec: object) => '```json\n' + JSON.stringify({ ...spec, caption: 'Watch it go.' }) + '\n```';

/** Physics that must never be asked anything. */
const noPhysics: Physics = {
  mode: 'inline',
  check: () => { throw new Error('the physics ran'); },
  nudge: () => { throw new Error('the physics ran'); },
  puzzle: () => { throw new Error('the physics ran'); },
  close: async () => {},
} as unknown as Physics;

describe('a level without an answer sheet', () => {
  it('edits keep the lock and run nothing', async () => {
    const level = fixture('ramp-dominoes-bell.json');
    const moved = { ...level, parts: level.parts.map((p: { id: string }) => (p.id === 'ramp' ? { ...p, x: 6 } : p)) };
    const llm = new FakeLlm([reply(moved)]);
    const res = await createMachine({ machine: level, instruction: 'move the ramp one cell east' }, { llm, physics: noPhysics });
    expect(res.verified).toBe(false);
    expect(res.machine.parts.find((p) => p.id === 'ramp')?.x).toBe(6);
  });
});
