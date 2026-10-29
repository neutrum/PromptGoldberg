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
  it('keeps the exact physics trace when cosmetic models are attached', () => {
    const spec = load('ramp-dominoes-bell.json');
    const styled = { ...spec, parts: spec.parts.map(p => p.kind === 'bell' ? { ...p, look: { assetId: 'a4bb4165-c0ef-4da1-bbfa-85f66d319224' } } : p) };
    expect(traceHash(simulateSync(styled))).toBe(traceHash(simulateSync(spec)));
  });
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
    const files = [...readdirSync(FIXTURES).filter((f) => f.endsWith('.json')), ...readdirSync(join(FIXTURES, 'levels')).map((f) => `levels/${f}`)];
    for (const file of files) {
      const spec = load(file);
      const result = evaluateMachine(spec.goal, simulateSync(spec, { record: false }));
      if (result.success) continue;
      const nudged = nudgeMachine(spec, { budget: 250, timeLimitMs: 20_000 });
      expect(nudged.solved, `${file}: ${nudged.result.steps.map((s) => s.note).join('; ')}`).toBe(true);
    }
  }, 30000);

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

  it('only takes parts a player can put back by dropping them on a column', async () => {
    const { makePuzzle } = await import('../src/puzzle');
    const { dropAt, isSupported } = await import('../src/placement');
    const spec = load('seesaw-cannon-bell.json');
    const puzzle = makePuzzle(spec, 2);
    expect(puzzle).not.toBeNull();
    expect(puzzle!.kind).toBe('missing2');
    expect(puzzle!.missing).toHaveLength(2);
    for (const m of puzzle!.missing) {
      expect(isSupported(spec.parts, m)).toBe(true);
      // Dropping it back on its own column lands it at the original height (a shelf at the height the player picks).
      const back = dropAt(puzzle!.spec.parts, m, m.x, m.z, m.kind === 'platform' ? { y: m.y } : {});
      expect(back?.y).toBe(m.y);
    }
  });

  it('can move a part to a nearby wrong cell instead', async () => {
    const { makeMovedPuzzle, withPlacements } = await import('../src/puzzle');
    const spec = load('ramp-dominoes-bell.json');
    const puzzle = makeMovedPuzzle(spec, { seed: 7 });
    expect(puzzle).not.toBeNull();
    expect(puzzle!.kind).toBe('moved');
    expect(puzzle!.start).toHaveLength(1);
    const [wrong] = puzzle!.start, [right] = puzzle!.missing;
    expect(wrong.id).toBe(right.id);
    expect(wrong.x !== right.x || wrong.z !== right.z).toBe(true);
    expect(evaluateMachine(spec.goal, simulateSync(withPlacements(puzzle!, puzzle!.start), { record: false })).success).toBe(false);
    expect(evaluateMachine(spec.goal, simulateSync(withPlacements(puzzle!, puzzle!.missing), { record: false })).success).toBe(true);
  });
});

describe('connect puzzles', () => {
  it('keeps the ball, the goal parts and their shelves, and hands out the rest, free shelves included', async () => {
    const { makeConnectPuzzle, withPlacements } = await import('../src/puzzle');
    const spec = load('seesaw-cannon-bell.json');
    const puzzle = makeConnectPuzzle(spec);
    expect(puzzle).not.toBeNull();
    expect(puzzle!.kind).toBe('connect');
    // Targets (the bell) and their shelves stay, as does the shelf under the ball; touch-goal parts and free shelves go to the player.
    expect(puzzle!.spec.parts.map((p) => p.id).sort()).toEqual(['ball', 'bell', 'shelf', 'shelfA']);
    // Chain order, except that shelfB comes before the seesaw that stands on it.
    expect(puzzle!.missing.map((m) => m.id)).toEqual(['ramp', 'shelfB', 'seesaw', 'cannon']);
    expect(puzzle!.missing.find((m) => m.id === 'shelfB')!.y).toBe(2);
    expect(evaluateMachine(spec.goal, simulateSync(puzzle!.spec, { record: false })).success).toBe(false);
    expect(evaluateMachine(spec.goal, simulateSync(withPlacements(puzzle!, puzzle!.missing), { record: false })).success).toBe(true);
  });

  it('is a level on the sample: ball on its shelf, a wall in the way, targets round the corner, ramp and cannon in hand', async () => {
    const { makeConnectPuzzle } = await import('../src/puzzle');
    const { layoutProblems, spread } = await import('../src/names');
    const spec = load('ramp-dominoes-bell.json');
    expect(spread(spec)).toBeGreaterThanOrEqual(10);
    expect(layoutProblems(spec)).toEqual([]);
    const puzzle = makeConnectPuzzle(spec);
    expect(puzzle).not.toBeNull();
    // The fixed wall is scenery: it stays, and the route has to clear it; the cannon turns the corner, so it is the player's.
    expect(puzzle!.spec.parts.map((p) => p.id).sort()).toEqual(['ball', 'bell', 'row', 'shelf', 'wall']);
    expect(puzzle!.missing.map((m) => m.id)).toEqual(['ramp', 'cannon']);
  });
});

describe('placement', () => {
  it('lands parts on the floor or the highest platform in the column, never in a taken cell', async () => {
    const { dropAt, restingHeight } = await import('../src/placement');
    const { parseMachine } = await import('../src/schema');
    const parsed = parseMachine({
      title: 't', duration: 5, goal: [{ type: 'bell', part: 'bell' }],
      parts: [
        { id: 'ball', kind: 'ball', x: 2, y: 4, z: 2 },
        { id: 'shelf', kind: 'platform', x: 2, y: 3, z: 2, yaw: 0, length: 4 },
        { id: 'bell', kind: 'bell', x: 4, y: 3, z: 2 },
      ],
    });
    expect(parsed.ok).toBe(true);
    const parts = parsed.ok ? parsed.spec.parts : [];
    expect(restingHeight(parts, 3, 2)).toBe(3);
    expect(restingHeight(parts, 3, 5)).toBe(0);
    const fan = { id: 'fan', kind: 'fan', x: 0, y: 0, z: 0, yaw: 0 } as const;
    expect(dropAt(parts, fan, 3, 2)?.y).toBe(3);
    expect(dropAt(parts, fan, 4, 2)).toBeNull(); // the bell is there
    expect(dropAt(parts, fan, 3, 5)?.y).toBe(0);
    // A shelf goes at the height the player chooses, even through a cell where something stands on it.
    const plank = { id: 'plank', kind: 'platform', x: 0, y: 0, z: 0, yaw: 0, length: 2 } as const;
    expect(dropAt(parts, plank, 6, 2)?.y).toBe(0);
    expect(dropAt(parts, plank, 6, 2, { y: 5 })?.y).toBe(5);
    expect(dropAt(parts, plank, 4, 2, { y: 3 })?.y).toBe(3);
    expect(dropAt(parts, plank, 6, 2, { y: 99 })?.y).toBe(15);
  });
});
