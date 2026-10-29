import { describe, expect, it } from 'vitest';
import { editProblems, missionProblems, unsupportedRequest } from '../src/machine/intent';
import { parseMachine } from '@og/machine';
import firstShot from '@og/machine/fixtures/levels/first-shot.json' with { type: 'json' };

const parsed = parseMachine(firstShot);
if (!parsed.ok) throw new Error('invalid fixture');
const spec = parsed.spec;

describe('prompt fulfillment', () => {
  it('rejects a physically working route that omits a requested mechanism or ending', () => {
    expect(missionProblems('Use a cannon to land in the bucket', spec)).toEqual([]);
    expect(missionProblems('Use two trampolines to land in the bucket', spec)).toContainEqual(expect.stringContaining('2 trampoline'));
    expect(missionProblems('Ring the bell twice', spec)).toContainEqual(expect.stringContaining('finish is a bell'));
    expect(missionProblems('Get into the bucket without a cannon', spec)).toContain('The request excludes cannon.');
  });
  it('does not accept easier time or parts limits', () => {
    expect(missionProblems('Take at least 10 seconds with only three parts', { ...spec, rules: { minSeconds: 3, maxParts: 4 } })).toEqual([
      'Keep the requested parts limit.', 'Keep the requested minimum duration.',
    ]);
  });
  it('explains hard kit limits before spending model calls', () => {
    expect(unsupportedRequest('Two marbles race to a bucket')).toMatch(/one marble/);
    expect(unsupportedRequest('A machine that lasts 60 seconds')).toMatch(/14 seconds/);
    expect(unsupportedRequest('Ring the bell twice')).toBeNull();
  });
  it('rejects edits that only rewrite the caption or omit an added mechanism', () => {
    expect(editProblems('add a trampoline', spec, { ...spec, caption: 'Now with a trampoline!' })).toContain('Add 1 trampoline to the current build.');
    expect(editProblems('move the ramp', spec, { ...spec, caption: 'Moved it.' })).toContainEqual(expect.stringContaining('did not change'));
    expect(editProblems('ring the bell twice', spec, spec)).toContain('The edited goal must require 2 bell rings.');
  });
  it('accepts appearance edits without changing the physics', () => {
    const painted = { ...spec, parts: spec.parts.map((p) => p.kind === 'ramp' ? { ...p, color: '#ff7f50' } : p) };
    expect(editProblems('paint the ramp coral', spec, painted)).toEqual([]);
  });
});
