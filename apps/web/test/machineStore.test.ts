import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMachine, type MachineStreamEvent, type Puzzle } from '@og/machine';
import firstShot from '@og/machine/fixtures/levels/first-shot.json' with { type: 'json' };

vi.hoisted(() => { Object.defineProperty(globalThis, 'window', { value: {}, configurable: true }); });
vi.mock('../src/game/audio', () => ({ sfx: { success: vi.fn(), miss: vi.fn(), place: vi.fn() } }));
vi.mock('../src/machine/machineClient', () => ({
  streamMachine: vi.fn(), simulateInWorker: vi.fn(), makePuzzle: vi.fn(), logPlay: vi.fn(), verifyOnServer: vi.fn(),
  getDailyMachine: vi.fn(), playedMachine: vi.fn(), publishMachine: vi.fn(), clearMachine: vi.fn(), submitDaily: vi.fn(),
}));
import { makePuzzle, simulateInWorker, streamMachine } from '../src/machine/machineClient';
import { useMachine } from '../src/machine/machineStore';

const parsed = parseMachine(firstShot);
if (!parsed.ok) throw new Error('invalid fixture');
const machine = parsed.spec;
const ramp = machine.parts.find((p) => p.kind === 'ramp')!;
const puzzle: Puzzle = { kind: 'missing', solution: machine, spec: { ...machine, parts: machine.parts.filter((p) => p.id !== ramp.id) }, missing: [ramp], start: [], failedAt: 0 };
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

describe('a dependable creation and editing flow', () => {
  it('applies a cosmetic model to the same machine without changing physics or auto-playing, and supports Undo', () => {
    const ball = machine.parts.find(p => p.kind === 'ball')!;
    const assetId = 'a4bb4165-c0ef-4da1-bbfa-85f66d319224';
    expect(useMachine.getState().applyLook(ball.id, assetId, machine)).toBe(true);
    const current = useMachine.getState().machine!;
    expect(current.parts.find(p => p.id === ball.id)).toEqual({ ...ball, look: { assetId } });
    expect(current.goal).toBe(machine.goal); expect(current.title).toBe(machine.title);
    expect(useMachine.getState()).toMatchObject({ phase: 'idle', time: 0, proven: true });
    expect(simulateInWorker).not.toHaveBeenCalled(); expect(streamMachine).not.toHaveBeenCalled();
    useMachine.getState().undoEdit(); expect(useMachine.getState().machine).toBe(machine);
  });

  it('rejects a stale model result, an unsupported part, or an arbitrary asset URL', () => {
    const ball = machine.parts.find(p => p.kind === 'ball')!;
    const assetId = 'a4bb4165-c0ef-4da1-bbfa-85f66d319224';
    expect(useMachine.getState().applyLook(ball.id, assetId, { ...machine })).toBe(false);
    expect(useMachine.getState().applyLook(ramp.id, assetId, machine)).toBe(false);
    expect(useMachine.getState().applyLook(ball.id, 'https://untrusted.example/model.glb', machine)).toBe(false);
    expect(useMachine.getState().machine).toBe(machine);
  });

  it('preserves an applied look through a geometry edit and drops invented asset IDs from the designer', async () => {
    const ball = machine.parts.find(p => p.kind === 'ball')!;
    const assetId = 'a4bb4165-c0ef-4da1-bbfa-85f66d319224';
    useMachine.getState().applyLook(ball.id, assetId, machine);
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit(done); });
    await useMachine.getState().edit('move a ramp');
    expect(useMachine.getState().machine?.parts.find(p => p.id === ball.id)?.look).toEqual({ assetId });
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit({ ...done, machine: { ...machine, parts: machine.parts.map(p => p.kind === 'ball' ? { ...p, look: { assetId } } : p) } }); });
    await useMachine.getState().create('a new machine');
    expect(useMachine.getState().machine?.parts.some(p => p.look)).toBe(false);
  });
  it('opens an existing machine ready for the player to run and change it', async () => {
    await useMachine.getState().load(machine, { proven: true });
    expect(useMachine.getState()).toMatchObject({ phase: 'idle', promptMode: 'edit', time: 0 });
  });

  it('adds a fan to the current scene without invoking the level generator, even in New mode', async () => {
    useMachine.setState({ promptMode: 'create', draft: 'add a fan' });
    await useMachine.getState().submitPrompt('add a fan');
    expect(streamMachine).not.toHaveBeenCalled();
    expect(useMachine.getState().machine).toBe(machine);
    expect(useMachine.getState()).toMatchObject({ pendingPart: { kind: 'fan' }, phase: 'idle', promptMode: 'edit' });
    expect(useMachine.getState().placePending(1, 1)).toBe(true);
    const current = useMachine.getState().machine!;
    expect(current.parts).toHaveLength(machine.parts.length + 1);
    expect(current.parts.slice(0, -1)).toEqual(machine.parts);
    expect(current.parts.at(-1)).toMatchObject({ kind: 'fan', x: 1, z: 1 });
    expect(current.goal).toEqual(machine.goal);
    expect(current.title).toEqual(machine.title);
    expect(useMachine.getState()).toMatchObject({ phase: 'idle', proven: false });
    useMachine.getState().undoEdit();
    expect(useMachine.getState().machine).toBe(machine);
  });

  it('cancels placement without changing the current machine', () => {
    useMachine.getState().addPart('fan');
    useMachine.getState().rotatePicked();
    expect(useMachine.getState().pendingPart?.yaw).toBe(90);
    useMachine.getState().cancelPlacement();
    expect(useMachine.getState().machine).toBe(machine);
    expect(useMachine.getState().pendingPart).toBeNull();
  });

  it('moves an added part in the same machine, preserving identity, looks and order, and undoes the move', () => {
    const s = () => useMachine.getState();
    s().addPart('fan'); expect(s().placePending(1, 1)).toBe(true);
    const added = s().machine!, fan = added.parts.at(-1)!;
    expect(s().movePart(fan.id)).toBe(true);
    expect(s().machine).toBe(added);
    s().rotatePicked(); expect(s().placePending(2, 1)).toBe(true);
    expect(s().machine!.parts).toHaveLength(added.parts.length);
    expect(s().machine!.parts.at(-1)).toMatchObject({ id: fan.id, x: 2, z: 1, yaw: 90 });
    expect(s().machine!.parts.slice(0, -1)).toEqual(machine.parts);
    expect(s().machine!.title).toBe(machine.title); expect(s().machine!.goal).toBe(machine.goal);
    expect(s().phase).toBe('idle'); expect(streamMachine).not.toHaveBeenCalled();
    s().undoEdit(); expect(s().machine).toBe(added);
  });

  it('leaves an existing part intact after an invalid drop or cancelled move', () => {
    const s = () => useMachine.getState();
    s().addPart('fan'); s().placePending(1, 1);
    const before = s().machine!, fan = before.parts.at(-1)!;
    s().movePart(fan.id);
    expect(s().placePending(-1, 1)).toBe(false);
    expect(s().machine).toBe(before);
    useMachine.setState({ dragging: true }); s().cancelPlacement();
    expect(s()).toMatchObject({ pendingPart: null, dragging: false });
    expect(s().machine).toBe(before);
    expect(s().movePart(fan.id)).toBe(true); expect(s().placePending(fan.x, fan.z)).toBe(true);
    expect(s().machine!.parts.filter(p => p.id === fan.id)).toHaveLength(1);
  });

  it('keeps starting marbles, goal parts and busy machines out of manual moves', () => {
    const s = () => useMachine.getState();
    expect(s().movePart(machine.parts.find(p => p.kind === 'ball')!.id)).toBe(false);
    expect(s().movePart(machine.goal.find(g => g.type !== 'touch')!.part)).toBe(false);
    s().addPart('fan'); s().placePending(1, 1); const id = s().machine!.parts.at(-1)!.id;
    useMachine.setState({ phase: 'playing' }); expect(s().movePart(id)).toBe(false);
    useMachine.setState({ phase: 'idle', ai: { ...s().ai, busy: true } }); expect(s().movePart(id)).toBe(false);
  });

  it('routes obvious change instructions to the current machine, never a new level', async () => {
    useMachine.setState({ promptMode: 'create' });
    vi.mocked(streamMachine).mockResolvedValue();
    await useMachine.getState().submitPrompt('paint the ramp pink');
    expect(vi.mocked(streamMachine).mock.calls[0][0]).toBe('/machine/edit');
    expect((vi.mocked(streamMachine).mock.calls[0][1] as { machine: typeof machine }).machine).toBe(machine);
  });

  it('keeps the machine name and waits for Run after a verified AI edit', async () => {
    const changed = { ...machine, title: 'Some other level', parts: machine.parts.map((p) => p.id === ramp.id ? { ...p, color: '#ff7f50' } : p) };
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit({ ...done, machine: changed }); });
    await useMachine.getState().submitPrompt('paint the ramp coral');
    expect(useMachine.getState().machine?.title).toBe(machine.title);
    expect(useMachine.getState()).toMatchObject({ phase: 'idle', lastEdit: machine });
  });
  it('keeps the current build and prompt when a result is not verified', async () => {
    useMachine.setState({ draft: 'my unfinished request' });
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit({ ...done, solved: false, verified: false }); });
    await useMachine.getState().create('ring the bell');
    expect(useMachine.getState().machine).toBe(machine);
    expect(useMachine.getState().draft).toBe('my unfinished request');
    expect(useMachine.getState().ai.error).toMatch(/verify/);
    expect(simulateInWorker).not.toHaveBeenCalled();
  });

  it('always requests verification and opens a new level as the player’s puzzle, building it up part by part', async () => {
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit(done); });
    await useMachine.getState().create('new mission');
    expect(vi.mocked(streamMachine).mock.calls[0].slice(0, 2)).toEqual(['/machine', { prompt: 'new mission', verify: true }]);
    expect(vi.mocked(makePuzzle).mock.calls.at(-1)?.[1]).toBe('connect');
    const s = useMachine.getState();
    expect(s).toMatchObject({ mode: 'fix', puzzle: true, promptMode: 'edit', prompt: 'new mission', proven: true });
    // The opening run waits for the pop-in; every part on the board has its moment.
    expect(s.phase).toBe('idle');
    expect(s.fix!.puzzle.spec.parts.every((p) => s.appear[p.id] > 0)).toBe(true);
  });

  it('builds with words during play: a tray part goes where the sentence says', async () => {
    await useMachine.getState().startFix('missing');
    const fix = useMachine.getState().fix!;
    const kind = fix.hand[0].kind === 'platform' ? 'shelf' : fix.hand[0].kind;
    const ball = fix.puzzle.spec.parts.find((p) => p.kind === 'ball')!;
    expect(useMachine.getState().buildByWords(`put the ${kind} 3 cells south of the ball`)).toBe(true);
    const placed = useMachine.getState().fix!.placed;
    expect(placed).toHaveLength(1);
    expect(Math.abs(placed[0].z - (ball.z + 3)) + Math.abs(placed[0].x - ball.x)).toBeLessThanOrEqual(4);
    expect(useMachine.getState().buildByWords('make the sky purple')).toBe(false);
  });

  it('edits the player’s visible placements rather than the hidden solution', async () => {
    await useMachine.getState().startFix('missing');
    const moved = { ...ramp, x: ramp.x + 1 };
    useMachine.setState({ fix: { ...useMachine.getState().fix!, placed: [moved], solved: true } });
    vi.mocked(streamMachine).mockResolvedValue();
    await useMachine.getState().edit('change the ramp');
    const body = vi.mocked(streamMachine).mock.calls[0][1] as { machine: typeof machine; verify: boolean };
    expect(body.machine.parts.find((p) => p.id === ramp.id)?.x).toBe(moved.x);
    expect(body.verify).toBe(true);
  });

  it('applies a looks-only edit to the puzzle in play, keeping tries and the scored run', async () => {
    await useMachine.getState().startFix('missing');
    useMachine.setState({ fix: { ...useMachine.getState().fix!, tries: 2 } });
    const world = { name: 'Pine forest', sky: '#a9cbe0', ground: '#8b9a5b', land: '#5f7f45', rock: '#7d8086', water: '#3f7fa8', foliage: '#2f5b3a', accent: '#d9c27a', features: [{ kind: 'conifers' as const, amount: 'many' as const }] };
    const ball = machine.parts.find((p) => p.kind === 'ball')!;
    // The edit reads the visible build (the ramp is still in hand) and paints what is on the stage.
    vi.mocked(streamMachine).mockImplementation(async (_path, body, emit) => {
      const seen = (body as { machine: typeof machine }).machine;
      emit({ ...done, machine: { ...seen, landscape: world, parts: seen.parts.map((p) => (p.id === ball.id ? { ...p, color: '#ff7f50', label: 'pizza' } : p)) } });
    });
    await useMachine.getState().edit('paint the ball coral, call it pizza and make it a pine forest');
    const s = useMachine.getState();
    expect(s.fix).toMatchObject({ tries: 2, solved: false, kind: 'missing' });
    expect(s.fix!.puzzle.spec.parts.find((p) => p.id === ball.id)).toMatchObject({ color: '#ff7f50', label: 'pizza', x: ball.x });
    expect(s.fix!.puzzle.solution.parts.find((p) => p.id === ball.id)?.label).toBe('pizza');
    expect(s.fix!.puzzle.spec.landscape?.name).toBe('Pine forest');
    expect(s.remix).toBeNull();
  });

  it('holds an edit that reshapes the puzzle until the player makes it their own copy', async () => {
    await useMachine.getState().startFix('missing');
    const reshaped = { ...machine, terrain: [{ name: 'pond', x: 0, z: 0, w: 2, d: 2, h: -1 }] };
    vi.mocked(streamMachine).mockImplementation(async (_path, _body, emit) => { emit({ ...done, machine: reshaped }); });
    await useMachine.getState().edit('dig a pond');
    expect(useMachine.getState().fix).not.toBeNull();
    expect(useMachine.getState().remix?.spec.terrain).toEqual(reshaped.terrain);
    useMachine.getState().declineRemix();
    expect(useMachine.getState()).toMatchObject({ remix: null, mode: 'fix' });
    await useMachine.getState().edit('dig a pond');
    await useMachine.getState().acceptRemix();
    const s = useMachine.getState();
    expect(s.fix).toBeNull();
    expect(s.remix).toBeNull();
    expect(s.machine?.terrain).toEqual(reshaped.terrain);
    expect(s.machine?.title).toMatch(/\(remix\)$/);
  });

  it('switches to replay and resumes puzzle placements, charging a solution reveal once', async () => {
    await useMachine.getState().startFix('missing');
    useMachine.setState({ fix: { ...useMachine.getState().fix!, placed: [ramp], tries: 1 }, phase: 'done' });
    useMachine.getState().setPuzzle(false);
    expect(useMachine.getState()).toMatchObject({ mode: 'build', fix: null, suspendedFix: { placed: [ramp], tries: 3 } });
    await vi.waitFor(() => expect(useMachine.getState().phase).toBe('playing'));
    useMachine.getState().setPuzzle(true);
    expect(useMachine.getState()).toMatchObject({ mode: 'fix', fix: { placed: [ramp], tries: 3, hint: true } });
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
    expect(useMachine.getState().builds).toBe(0);
  });
});
