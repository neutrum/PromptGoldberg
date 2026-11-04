import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateMachine, initPhysics, landscapeFromWords, layoutLevel, simulateSync, traceHash, type MachineSpec, type MachineStreamEvent } from '@pg/core';
import { createGame, type GamePorts } from '../src';

beforeAll(() => initPhysics());

/** A game with no browser and no server: physics in-process, a fake server that sets a level from a graph. */
function headless(level: MachineSpec, solve?: (machine: MachineSpec) => MachineSpec) {
  const saved = new Map<string, string>();
  const calls: string[] = [];
  const ports: GamePorts = {
    api: {
      async streamMachine(path, body, onEvent) {
        calls.push(path);
        if (path === '/machine/solve' && solve) {
          onEvent({ type: 'machine', machine: solve((body as { machine: MachineSpec }).machine), solved: true, verified: true, attempts: 1, notes: [], cached: false, result: { success: true, satisfiedCount: 1, score: 1, progress: 1, failedAt: null, steps: [] }, moved: [] });
          return;
        }
        onEvent({ type: 'world', landscape: level.landscape!, title: level.title } as MachineStreamEvent);
        onEvent({ type: 'machine', machine: level, solved: false, verified: false, attempts: 1, notes: [], cached: false, result: { success: false, satisfiedCount: 0, score: 0, progress: 0, failedAt: 0, steps: [] }, moved: [] });
      },
      makePuzzle: async () => null,
      verifyOnServer: async () => null,
      getDailyMachine: async () => { throw new Error('no daily here'); },
      publishMachine: async () => { throw new Error('no gallery here'); },
      playedMachine: async () => undefined,
      clearMachine: async () => ({ board: [], rank: 1 }),
      submitDaily: async () => ({ board: [], rank: 1, date: '' }),
      logPlay: () => {},
    },
    physics: {
      async simulate(spec) {
        const run = simulateSync(spec, { record: true });
        return { run, result: evaluateMachine(spec.goal, run), hash: traceHash(run) };
      },
    },
    storage: { get: (k) => saved.get(k) ?? null, set: (k, v) => void saved.set(k, v) },
  };
  return { game: createGame(ports), calls, saved };
}

describe('the game, headless', () => {
  const level = layoutLevel({ title: 'Snowball Cave', links: [{ via: 'ramp', turn: 'left' }, { via: 'fan', turn: 'right' }], end: 'bucket', names: { ball: 'snowball', target: 'cave' }, landscape: landscapeFromWords('a snowball in the high tatras')! }, { seed: 4 });

  it('makes a level from a sentence and opens it as the player’s puzzle', async () => {
    const { game, calls } = headless(level);
    await game.getState().create('a snowball races down the high tatras into a cave');
    const s = game.getState();
    expect(calls).toEqual(['/machine']);
    expect(s.mode).toBe('fix');
    expect(s.fix!.puzzle.verified).toBe(false);
    expect(s.fix!.hand.length).toBeGreaterThanOrEqual(3);
    // Nothing runs by itself.
    expect(s.phase).toBe('idle');
  });

  it('builds with words, changes the level with words, and runs the result', async () => {
    const { game } = headless(level);
    await game.getState().create('a snowball races down the high tatras into a cave');
    // A new level opens for its designer; parts are the player's.
    expect(game.getState().role).toBe('design');
    game.getState().setRole('play');
    expect(game.getState().buildByWords('add a fan next to the snowball')).toBe(true);
    expect(game.getState().buildByWords('add a fan 3 cells south of the snowball')).toBe(true);
    expect(game.getState().fix!.placed.filter((p) => p.kind === 'fan')).toHaveLength(2);
    game.getState().setRole('design');
    await game.getState().changeLevel('build a fence around the cave');
    expect(game.getState().fix!.puzzle.spec.parts.filter((p) => p.prop === 'fence').length).toBeGreaterThan(3);
    await game.getState().runFix();
    const s = game.getState();
    expect(s.fix!.tries).toBe(1);
    expect(s.result).not.toBeNull();
    expect(s.fix!.solved).toBe(false);
  });

  it('asks for a solution with the player’s kit and shows it from the hand', async () => {
    let sent: MachineSpec | null = null;
    // The server's answer: one kit part placed, under the id its own copy of the level gave it.
    const { game } = headless(level, (machine) => {
      sent = machine;
      const ramp = machine.spares!.find((s) => s.kind === 'ramp')!;
      return { ...machine, parts: [...machine.parts, { id: 'server-ramp', kind: ramp.kind, x: 5, y: 0, z: 5, yaw: 0 }] };
    });
    await game.getState().create('a snowball races down the high tatras into a cave');
    game.getState().setRole('play');
    const hand = game.getState().fix!.hand.map((p) => p.id);
    await game.getState().solveForMe();
    const s = game.getState();
    expect(sent!.spares!.map((p) => p.kind).sort()).toEqual(s.fix!.puzzle.spares!.map((p) => p.kind).sort());
    expect(s.fix!.hand.map((p) => p.id)).toEqual(hand);
    expect(hand).toContain(s.fix!.placed[0].id);
    expect(s.notice).toMatch(/your own parts/);
  });

  it('gives no hints or solving in the game’s own levels, and keeps them everywhere else', async () => {
    const { game, calls } = headless(level);
    const open = (builtIn: boolean) => game.getState().playLevel({ slug: builtIn ? 'domino-rally' : 'handbook-x', emoji: '', name: 'x', mission: 'x', order: 1, spec: level, verified: false, builtIn });
    await open(true);
    expect(game.getState().noHelp()).toBe(true);
    await game.getState().solveForMe();
    expect(game.getState().notice).toMatch(/No solutions in the levels/);
    expect(calls).not.toContain('/machine/solve');
    game.getState().showHint();
    expect(game.getState().fix!.hint).toBe(false);
    // An example from Prompt ideas, like any level that is not one of the game's own, keeps its help.
    await open(false);
    expect(game.getState().noHelp()).toBe(false);
  });

  it('keeps each game to itself', async () => {
    const a = headless(level), b = headless(level);
    await a.game.getState().create('one');
    expect(b.game.getState().fix).toBeNull();
  });
});
