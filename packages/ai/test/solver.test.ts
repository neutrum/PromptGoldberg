import { describe, expect, it } from 'vitest';
import { CAMPAIGN, controlValues } from '@og/shared';
import { createSolver, SolverError } from '../src';

const level = CAMPAIGN[4];
const values = controlValues(level);

describe('solver', () => {
  it('runs many tasks through one solver, in parallel and in sequence', async () => {
    // Workers cannot load TypeScript under vitest, so this exercises the fallback path too.
    const solver = createSolver('auto', 4);
    const parallel = await Promise.all(Array.from({ length: 24 }, () => solver.check(level, values, [])));
    expect(parallel).toHaveLength(24);
    parallel.forEach((r) => expect(typeof r.success).toBe('boolean'));
    for (let i = 0; i < 10; i++) expect(await solver.evaluate(level.spec)).toBeDefined();
    expect(['worker', 'inline']).toContain(solver.mode);
  });

  it('refuses a task whose signal is already aborted', async () => {
    const solver = createSolver('auto', 2);
    const ac = new AbortController();
    ac.abort();
    await expect(solver.check(level, values, [], { signal: ac.signal })).rejects.toBeInstanceOf(SolverError);
  });
});
