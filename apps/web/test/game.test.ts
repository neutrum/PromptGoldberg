import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMachine, type MachineStreamEvent, type Puzzle } from '@pg/core';
import firstShot from '@pg/core/fixtures/levels/first-shot.json' with { type: 'json' };

vi.hoisted(() => { Object.defineProperty(globalThis, 'window', { value: {}, configurable: true }); });
vi.mock('../src/platform/audio', () => ({ sfx: { success: vi.fn(), miss: vi.fn(), place: vi.fn() } }));
vi.mock('../src/app/api', () => ({
  streamMachine: vi.fn(), simulateInWorker: vi.fn(), makePuzzle: vi.fn(), logPlay: vi.fn(), verifyOnServer: vi.fn(),
  getDailyMachine: vi.fn(), playedMachine: vi.fn(), publishMachine: vi.fn(), clearMachine: vi.fn(), submitDaily: vi.fn(),
}));
import { getDailyMachine, makePuzzle, simulateInWorker, streamMachine, verifyOnServer } from '../src/app/api';
import { useMachine } from '../src/app/game';

const parsed = parseMachine(firstShot);
if (!parsed.ok) throw new Error('invalid fixture');
const machine = parsed.spec;
const ramp = machine.parts.find((p) => p.kind === 'ramp')!;
const puzzle: Puzzle = { solution: machine, spec: { ...machine, parts: machine.parts.filter((p) => p.id !== ramp.id) }, missing: [ramp], failedAt: 0 };
const result = { success: true, score: 2, progress: 1, satisfiedCount: 2, failedAt: null, steps: [] };
const done: MachineStreamEvent = { type: 'machine', machine, solved: true, verified: true, attempts: 1, notes: [], cached: false, result, moved: [] };
const initial = useMachine.getState();

beforeEach(() => {
  useMachine.getState().stopAi();
  useMachine.setState({ ...initial, machine, proven: true, phase: 'idle' }, true);
  vi.resetAllMocks();
  vi.mocked(simulateInWorker).mockResolvedValue({ result, hash: 'hash', run: { spec: machine, events: [], frames: new Float32Array(), stats: { ms: 1 } } } as never);
  vi.mocked(makePuzzle).mockResolvedValue(puzzle);
});

describe('making a level and playing it', () => {
  it('never blocks a new level on the AI’s own check: an unproven one opens as a level nobody has solved yet', async () => {
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit({ ...done, solved: false, verified: false }); });
    await useMachine.getState().create('ring the bell');
    const s = useMachine.getState();
    expect(s.ai.error).toBeNull();
    expect(s).toMatchObject({ mode: 'fix', phase: 'idle', role: 'design' });
    expect(s.fix!.puzzle.verified).toBe(false);
  });

  it('opens a new level for its designer, building it up part by part', async () => {
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit(done); });
    await useMachine.getState().create('new mission');
    expect(vi.mocked(streamMachine).mock.calls[0].slice(0, 2)).toEqual(['/machine', { prompt: 'new mission' }]);
    const s = useMachine.getState();
    expect(s).toMatchObject({ mode: 'fix', role: 'design', promptMode: 'edit', prompt: 'new mission', proven: true });
    // The designer shapes the level; parts are the player's.
    expect(s.fix!.picking).toBeNull();
    expect(s.placeAt(1, 1)).toBe(false);
    // The opening run waits for the pop-in; every part on the board has its moment.
    expect(s.phase).toBe('idle');
    expect(s.fix!.puzzle.spec.parts.every((p) => s.appear[p.id] > 0)).toBe(true);
  });

  it('lets the designer move and turn a level thing with the mouse and the keys', async () => {
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit(done); });
    await useMachine.getState().create('new mission');
    const thing = useMachine.getState().fix!.puzzle.spec.parts.find((p) => p.kind === 'ball')!;
    const at = () => useMachine.getState().fix!.puzzle.spec.parts.find((p) => p.id === thing.id)!;
    useMachine.getState().grabLevelPart(thing.id);
    // Dropped on a free cell (the stage corner): it lands there and stays selected.
    expect(useMachine.getState().placeAt(0, 0)).toBe(true);
    expect(at()).toMatchObject({ x: 0, z: 0 });
    expect(useMachine.getState().fix).toMatchObject({ selected: thing.id, carrying: false, edited: true });
    expect(useMachine.getState().shiftLevelPart({ dx: 1 })).toBe(true);
    expect(at().x).toBe(1);
    // Off the stage it stays put.
    expect(useMachine.getState().shiftLevelPart({ dz: -1 })).toBe(false);
    expect(useMachine.getState().shiftLevelPart({ turn: true })).toBe(true);
    expect(at().yaw).toBe((thing.yaw + 90) % 360);
    useMachine.getState().pick(null);
    expect(useMachine.getState().fix!.selected).toBeNull();
  });

  it('solves it only when asked, with no stars for that run', async () => {
    vi.mocked(verifyOnServer).mockResolvedValue(null);
    await useMachine.getState().startFix();
    expect(useMachine.getState().phase).toBe('idle');
    expect(useMachine.getState().buildByWords('solve it for me')).toBe(true);
    await vi.waitFor(() => expect(useMachine.getState().fix!.placed.length).toBe(useMachine.getState().fix!.puzzle.missing.length));
    expect(useMachine.getState().fix!.assisted).toBe(true);
  });

  it('builds with words during play: a tray part goes where the sentence says; the level stays locked', async () => {
    await useMachine.getState().startFix();
    const fix = useMachine.getState().fix!;
    const kind = fix.hand[0].kind === 'platform' ? 'shelf' : fix.hand[0].kind;
    const ball = fix.puzzle.spec.parts.find((p) => p.kind === 'ball')!;
    expect(useMachine.getState().buildByWords(`put the ${kind} 3 cells south of the ball`)).toBe(true);
    const placed = useMachine.getState().fix!.placed;
    expect(placed).toHaveLength(1);
    expect(Math.abs(placed[0].z - (ball.z + 3)) + Math.abs(placed[0].x - ball.x)).toBeLessThanOrEqual(4);
    // Not a building move: a player is told the level is its designer's; nothing is sent.
    expect(useMachine.getState().buildByWords('make the sky purple')).toBe(true);
    expect(useMachine.getState().notice).toMatch(/level itself/);
    expect(streamMachine).not.toHaveBeenCalled();
  });

  it('applies a looks-only change to the level in play, keeping tries', async () => {
    await useMachine.getState().startFix();
    useMachine.setState({ fix: { ...useMachine.getState().fix!, tries: 2 } });
    const world = { name: 'Pine forest', sky: '#a9cbe0', ground: '#8b9a5b', land: '#5f7f45', rock: '#7d8086', water: '#3f7fa8', foliage: '#2f5b3a', accent: '#d9c27a', features: [{ kind: 'conifers' as const, amount: 'many' as const }] };
    const ball = machine.parts.find((p) => p.kind === 'ball')!;
    vi.mocked(streamMachine).mockImplementation(async (_path, body, emit) => {
      const seen = (body as { machine: typeof machine }).machine;
      emit({ ...done, machine: { ...seen, landscape: world, parts: seen.parts.map((p) => (p.id === ball.id ? { ...p, color: '#ff7f50', label: 'pizza' } : p)) } });
    });
    await useMachine.getState().changeLevel('paint the ball coral, call it pizza and make it a pine forest');
    const s = useMachine.getState();
    expect(s.fix).toMatchObject({ tries: 2, solved: false });
    expect(s.fix!.puzzle.spec.parts.find((p) => p.id === ball.id)).toMatchObject({ color: '#ff7f50', label: 'pizza', x: ball.x });
    expect(s.fix!.puzzle.solution.parts.find((p) => p.id === ball.id)?.label).toBe('pizza');
    expect(s.fix!.puzzle.spec.landscape?.name).toBe('Pine forest');
  });

  it('changes the level in play right away: scenery from the words, the rest through the AI, the player’s parts kept', async () => {
    await useMachine.getState().startFix();
    const before = useMachine.getState().fix!.puzzle.spec;
    // Scenery the words name: straight onto the board, fixed, no AI call.
    await useMachine.getState().changeLevel('build a fence around the ball');
    const fenced = useMachine.getState().fix!;
    const fences = fenced.puzzle.spec.parts.filter((p) => p.prop === 'fence');
    expect(fences.length).toBeGreaterThan(3);
    expect(fences.every((p) => p.fixed && p.kind === 'wall')).toBe(true);
    expect(fenced.edited).toBe(true);
    expect(vi.mocked(streamMachine)).not.toHaveBeenCalled();
    // Anything else: the AI changes the level and it applies in place.
    const placed = { ...ramp, x: ramp.x, z: ramp.z };
    useMachine.setState({ fix: { ...fenced, placed: [placed] } });
    const pond = { ...fenced.puzzle.spec, terrain: [{ name: 'pond', x: 0, z: 0, w: 2, d: 2, h: -1 }] };
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit({ ...done, solved: false, verified: false, machine: pond }); });
    await useMachine.getState().changeLevel('dig a pond in the corner');
    expect(vi.mocked(streamMachine).mock.calls[0][1]).toMatchObject({ machine: { parts: fenced.puzzle.spec.parts } });
    const s = useMachine.getState();
    expect(s.fix!.puzzle.spec.terrain).toEqual(pond.terrain);
    expect(s.fix!.placed).toEqual([placed]);
    expect(before.parts.length).toBeLessThan(s.fix!.puzzle.spec.parts.length);
  });

  it('plays today’s level like any new one, for a player', async () => {
    vi.mocked(getDailyMachine).mockResolvedValue({ date: '2026-10-30', prompt: 'ring the bell', machine: { ...machine, par: 2, spares: [{ kind: 'fan' }] }, generated: true });
    await useMachine.getState().playDaily();
    const s = useMachine.getState();
    expect(s).toMatchObject({ mode: 'fix', role: 'play', daily: { date: '2026-10-30' } });
    expect(s.ownLevel()).toBe(false);
    expect(s.fix!.hand.length).toBeGreaterThan(0);
  });

  it('ignores a cancelled request even if its final event arrives late', async () => {
    let emitLate: ((event: MachineStreamEvent) => void) | undefined;
    let finish: (() => void) | undefined;
    vi.mocked(streamMachine).mockImplementation((_path, _body, emit) => {
      emitLate = emit;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const pending = useMachine.getState().create('old request');
    useMachine.getState().stopAi();
    emitLate?.(done);
    finish?.();
    await pending;
    expect(useMachine.getState().machine).toBe(machine);
    expect(useMachine.getState().fix).toBeNull();
  });
});
