import { describe, expect, it } from 'vitest';
import { SolverError, WorkerPool, WorkerStartError } from '../src/machine/pool';

const worker = (name: string) => new URL(`./workers/${name}.mjs`, import.meta.url);

describe('the physics worker pool', () => {
  it('treats a first task that runs too long as too slow, not as workers that cannot start', async () => {
    const pool = new WorkerPool(1, worker('slow'));
    const err = await pool.run(2_000, { timeoutMs: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SolverError);
    expect(err).not.toBeInstanceOf(WorkerStartError);
    // The slow worker was retired; a fresh one takes the next task.
    await expect(pool.run(10, { timeoutMs: 5_000 })).resolves.toBe(10);
  });

  it('says so when a worker cannot load at all, so physics can run inline instead', async () => {
    const pool = new WorkerPool(1, worker('broken'));
    await expect(pool.run(1, { timeoutMs: 5_000 })).rejects.toBeInstanceOf(WorkerStartError);
  });
});
