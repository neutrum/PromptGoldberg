import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMachine } from '@pg/core';

// The handbook's example levels are saved AI output: a rule tightened later must not break one a judge clicks.
const examples = JSON.parse(readFileSync(new URL('../public/handbook/examples.json', import.meta.url), 'utf8')) as { id: string; spec: unknown }[];

describe('handbook examples', () => {
  it.each(examples.map((e) => [e.id, e.spec]))('%s is a valid level', (_id, spec) => {
    const r = parseMachine(spec);
    expect(r.ok ? [] : (r as { issues: unknown[] }).issues).toEqual([]);
  });
});
