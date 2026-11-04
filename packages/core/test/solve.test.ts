import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateMachine, handOf, initPhysics, makeLevelPuzzle, parseMachine, simulateSync, solveWithKit, withPlacements, type MachineSpec } from '../src';

beforeAll(async () => { await initPhysics(); });

// An AI level ("wake the sleeping dragon in its crystal cave"): ball, gong, landmark, obstacles and a kit of five.
const level = (parseMachine(JSON.parse(readFileSync(new URL('./fixtures/dragon-level.json', import.meta.url), 'utf8'))) as { spec: MachineSpec }).spec;

describe('solving with the player kit', () => {
  it('finds a build from the hand alone that the full run confirms', async () => {
    const puzzle = makeLevelPuzzle(level)!;
    expect(evaluateMachine(puzzle.spec.goal, simulateSync(puzzle.spec, { record: false })).success).toBe(false);
    const found = await solveWithKit(puzzle, { budgetMs: 60_000 });
    expect(found.solved).toBe(true);
    const hand = new Set(handOf(puzzle).map((p) => p.id));
    expect(found.placed.every((p) => hand.has(p.id))).toBe(true);
    expect(evaluateMachine(puzzle.spec.goal, simulateSync(withPlacements(puzzle, found.placed))).success).toBe(true);
  }, 90_000);
});
