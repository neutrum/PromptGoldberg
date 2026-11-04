import { describe, expect, it } from 'vitest';
import { createPhysics } from '@pg/ai';
import { makeLevel, playLevel, readLevel } from '../src/commands';

describe('the command line', () => {
  it('makes a level from a sentence with no AI, and plays it with words, headless', async () => {
    const level = await makeLevel('roll the marble into the bucket past the castle, a hard maze', { offline: true, physics: createPhysics('inline') });
    expect(level.parts.some((p) => p.kind === 'ball')).toBe(true);
    expect(readLevel(JSON.stringify(level)).title).toBe(level.title);
    const report = await playLevel(level, ['level: build a fence around the bucket', 'add a fan next to the ball', 'put a ramp 3 cells south of the ball']);
    expect(report.log).toHaveLength(3);
    expect(report.log[0]).toMatch(/fence panels around/);
    expect(report.level.parts.filter((p) => p.prop === 'fence').length).toBeGreaterThan(3);
    expect(report.placed.map((p) => p.kind).sort()).toEqual(['fan', 'ramp']);
    expect(typeof report.solved).toBe('boolean');
  }, 90_000); // includes the fairness search with the kit, in one thread here

  it('refuses a file that is not a level, saying why', () => {
    expect(() => readLevel('{"title":"x"}')).toThrow(/Not a valid level/);
  });
});
