import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateMachine, initPhysics, nudgeMachine, parseMachine, simulateSync, traceHash, type MachineSpec } from '../src';

const FIXTURES = join(import.meta.dirname, '../src/fixtures');
const load = (name: string): MachineSpec => {
  const parsed = parseMachine(JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')));
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  return parsed.spec;
};

beforeAll(() => initPhysics());

describe('simulation', () => {
  it('is deterministic across runs and threads', async () => {
    const spec = load('ramp-dominoes-bell.json');
    const a = traceHash(simulateSync(spec));
    const b = traceHash(simulateSync(spec));
    expect(a).toBe(b);
    // A fresh engine instance in another thread must agree too.
    const hash = await new Promise<string>((resolve, reject) => {
      const w = new Worker(new URL('./hashWorker.ts', import.meta.url), { workerData: spec, execArgv: ['--import', 'tsx'] });
      w.on('message', resolve);
      w.on('error', reject);
    });
    expect(hash).toBe(a);
  });

  it('every fixture machine works, or the optimizer makes it work', () => {
    for (const file of readdirSync(FIXTURES)) {
      const spec = load(file);
      const result = evaluateMachine(spec.goal, simulateSync(spec, { record: false }));
      if (result.success) continue;
      const nudged = nudgeMachine(spec, { budget: 150, timeLimitMs: 20_000 });
      expect(nudged.solved, `${file}: ${nudged.result.steps.map((s) => s.note).join('; ')}`).toBe(true);
    }
  });

  it('rejects machines without exactly one ball or with bad goal references', () => {
    const spec = load('ramp-dominoes-bell.json');
    expect(parseMachine({ ...spec, parts: spec.parts.filter((p) => p.kind !== 'ball') }).ok).toBe(false);
    expect(parseMachine({ ...spec, goal: [{ type: 'bucket', part: 'bell' }] }).ok).toBe(false);
  });
});

describe('fix-it puzzles', () => {
  it('removes a part so the machine fails, and the solution still works', async () => {
    const { makePuzzle, withPlacements } = await import('../src/puzzle');
    const spec = load('ramp-dominoes-bell.json');
    const puzzle = makePuzzle(spec);
    expect(puzzle).not.toBeNull();
    expect(puzzle!.missing).toHaveLength(1);
    expect(evaluateMachine(puzzle!.spec.goal, simulateSync(puzzle!.spec, { record: false })).success).toBe(false);
    expect(evaluateMachine(spec.goal, simulateSync(withPlacements(puzzle!, puzzle!.missing), { record: false })).success).toBe(true);
  });
});
