import {
  DAILY_LADDER, dailySeed, dropAt, footprint, GRID, inStage, stageOf, handOf, isSupported, lockedParts, makeLevelPuzzle, parseMachine, partNames, PUZZLE_KINDS, routeParts, ruleProblems, samePlace, supportsOf, withPlacements,
  type MachineResult, type MachineRun, type MachineSpec, type MachineStreamEvent, type Part, type Puzzle, type PuzzleKind, type Terrain,
} from '@og/machine';
import { create } from 'zustand';
import { requestedStage } from './settings';
import { LOOK_KINDS, LookRef } from '@og/machine';
import { sfx } from '../game/audio';
import { clearMachine, getDailyMachine, logPlay, makePuzzle, playedMachine, publishMachine, simulateInWorker, streamMachine, submitDaily, verifyOnServer, type MachineItem, type Score } from './machineClient';
import type { Level, SharedLevel } from './levels';
import firstShot from '@og/machine/fixtures/levels/first-shot.json' with { type: 'json' };
import { addedPart, isEditInstruction } from './commands';

export interface MachineAiLog {
  busy: boolean;
  lines: string[];
  progress: number;
  error: string | null;
  /** Parts (and the shape of the ground) Claude has written so far for the design in progress. */
  sketch: { attempt: number; title?: string; parts: Part[]; terrain?: Terrain[] } | null;
}

/** How far the machine on screen got: 0 = designed, not proven; 1 = proven by the physics; 2 = final. */
export type MachineRank = 0 | 1 | 2;

export type PlayPhase = 'idle' | 'simulating' | 'playing' | 'paused' | 'done';

/** Build: the AI makes machines and you watch or change them. Fix: a part is missing and you put it back. */
export type Mode = 'build' | 'fix';

export interface FixState {
  puzzle: Puzzle;
  kind: PuzzleKind;
  /** The parts in the player's hand: the puzzle's missing parts, with the facing the player gave them. */
  hand: Part[];
  /** The parts the player has put down (same ids as the hand). */
  placed: Part[];
  /** Index into puzzle.missing of the part being placed, or null. */
  picking: number | null;
  /** Height (cells) a shelf in hand goes at; other parts land where they rest. */
  lift: number;
  tries: number;
  solved: boolean;
  hint: boolean;
  /** Stars for a solved puzzle (1 to 3), or 0. */
  stars: number;
  /** The server's re-run of the solved build: 'agrees' when its trace hash matches the browser's. */
  server?: 'checking' | 'agrees' | 'differs' | 'offline';
  /** The last run met the goal but broke the level's challenge rules (too many parts, too quick). */
  broke?: string[];
}

/** What a hint costs, in tries. */
export const HINT_COST = 2;

/** The AI's route length: use as few parts as it did (or fewer) for the parts star. */
export const parOf = (puzzle: Puzzle) => puzzle.missing.length;

/** One star for solving, one for using no more parts than par, one for 3 tries or fewer (hints count). */
export function starsFor(fix: Pick<FixState, 'puzzle' | 'placed' | 'tries'>): number {
  return 1 + (fix.placed.length <= parOf(fix.puzzle) ? 1 : 0) + (fix.tries <= 3 ? 1 : 0);
}

interface MachineState {
  prompt: string;
  promptMode: 'create' | 'edit';
  setPromptMode: (mode: 'create' | 'edit') => void;
  tutorial: boolean;
  startTutorial: () => Promise<void>;
  suspendedFix: FixState | null;
  /** What the player is typing in the prompt bar; parts clicked on the stage are added here. */
  draft: string;
  pendingPart: Part | null;
  notice: string | null;
  lastEdit: MachineSpec | null;
  submitPrompt: (text: string) => Promise<void>;
  addPart: (kind: Exclude<Part['kind'], 'ball'>) => void;
  movePart: (id: string) => boolean;
  placePending: (x: number, z: number) => boolean;
  cancelPlacement: () => void;
  undoEdit: () => void;
  applyLook: (partId: string, assetId: string | null, expectedMachine: MachineSpec) => boolean;
  /** Bumped when the draft wants the caret (after a click on the stage). */
  draftFocus: number;
  machine: MachineSpec | null;
  rank: MachineRank;
  /** Versions are still arriving from the AI. */
  working: boolean;
  proven: boolean;
  moved: { id: string; cells: number }[];
  ai: MachineAiLog;

  mode: Mode;
  fix: FixState | null;
  /** A verified edit that would reshape the puzzle being played, held until the player decides. */
  remix: { spec: MachineSpec; original: MachineSpec; moved: { id: string; cells: number }[] } | null;
  /** Make the held edit the player's own copy; the scored run ends. */
  acceptRemix(): Promise<void>;
  /** Drop the held edit and keep playing. */
  declineRemix(): void;
  /** Machines the AI has delivered this session, for the first-time coach. */
  builds: number;
  edits: number;
  /** Puzzle play: a built machine arrives with a part held back for the player to place. Off = just watch it. */
  puzzle: boolean;
  /** The machine is being broken for the player: do not draw it, it is the solution. */
  veiled: boolean;
  /** A placed part is being dragged to a new cell (the camera holds still meanwhile). */
  dragging: boolean;
  setPuzzle: (on: boolean) => void;

  run: MachineRun | null;
  result: MachineResult | null;
  hash: string | null;
  phase: PlayPhase;
  /** Playback time in seconds. */
  time: number;
  /** When playback should stop (a beat after the last event). */
  endTime: number;
  /** Goal steps already celebrated during this playback. */
  celebrated: number;
  error: string | null;

  setPrompt: (p: string) => void;
  setDraft: (d: string) => void;
  /** Put a part's name ("dominoes #2") into the draft, so "move " + a click reads "move dominoes #2". */
  insertPart: (id: string) => void;
  create: (prompt: string) => Promise<void>;
  edit: (instruction: string) => Promise<void>;
  load: (machine: MachineSpec, meta?: { rank?: MachineRank; proven?: boolean; moved?: { id: string; cells: number }[] }) => Promise<void>;
  play: () => void;
  setTime: (t: number) => void;
  celebrate: (step: number) => void;
  finish: () => void;
  stopAi: () => void;

  /** The example level being played, if any (its mission sentence is shown as what to type). */
  level: Level | null;
  playLevel: (level: Level) => Promise<void>;
  /** Best stars per example level (slug -> 1..3). */
  stars: Record<string, number>;
  /** The score of whoever shared the level being played, if it came from a link. */
  sharedScore: SharedLevel['score'] | null;
  /** The level on screen as a link payload (with the player's score once solved), or null. */
  shareable: () => SharedLevel | null;
  /** Today's shared fix-it ladder: the same machine broken three ways, tries add up. builds: the winning parts per stage, for the board. */
  daily: { date: string; loading: boolean; best: Record<string, number>; stage: number; tries: number; builds: Part[][] };
  /** The name that goes on boards (kept in the browser). */
  playerName: string;
  setPlayerName: (name: string) => void;
  /** The board for what was just solved: a community level's best builds, or today's daily. */
  board: { kind: 'level' | 'daily'; rows: Score[]; rank?: number; error?: string; busy?: boolean } | null;
  /** Put today's daily result on the board (every stage's build is re-run on the server). */
  postDaily: () => Promise<void>;
  /** Publish the solved level to the community gallery with the build that solved it. */
  publish: () => Promise<MachineItem>;
  playDaily: () => Promise<void>;
  /** After a daily stage is solved: break the machine the next way. */
  nextDailyStage: () => Promise<void>;
  /** Break the proven machine and hand the player the parts. Resolves false when it cannot be broken that way. */
  startFix: (kind?: PuzzleKind) => Promise<boolean>;
  /** A level nobody has run: the stage stays, the AI's route parts and spares go to the hand. */
  startLevel: (level: MachineSpec) => Promise<boolean>;
  pick: (index: number | null) => void;
  /** Drop the picked part on a column; false when something is in the way. */
  placeAt: (x: number, z: number) => boolean;
  /** Lift a placed part back into the hand (and whatever stood on it, if it is a shelf). */
  pickPlaced: (id: string) => void;
  /** Raise or lower the shelf in hand by `by` cells (a placed shelf is lifted first). */
  liftBy: (by: number) => void;
  /** Turn the part in hand a quarter turn (or a placed part, which is lifted first). */
  rotatePicked: () => void;
  clearPlaced: () => void;
  runFix: () => Promise<void>;
  showHint: () => void;
  leaveFix: () => void;
}

const idleAi: MachineAiLog = { busy: false, lines: [], progress: 0, error: null, sketch: null };

const BEST_KEY = 'pg.daily.best';
const STARS_KEY = 'pg.level.stars';
function loadStars(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(STARS_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
const PUZZLE_KEY = 'pg.puzzle';
const NAME_KEY = 'pg.name';
function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export { DAILY_LADDER };
function loadPuzzleMode(): boolean {
  return false;
}
function loadBest(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
let aiAbort: AbortController | null = null;
let loadSeq = 0;

/** Same parts in the same cells (the optimizer's fine offsets aside). */
function unchanged(a: MachineSpec, b: MachineSpec): boolean {
  return JSON.stringify(a.goal) === JSON.stringify(b.goal) && a.caption === b.caption && a.parts.length === b.parts.length
    && a.parts.every((p) => { const q = b.parts.find((x) => x.id === p.id); return !!q && samePlace(p, q) && p.color === q.color && p.label === q.label; });
}

/** The same puzzle: every part, the ground, the stage, the goal and the rules alike; only looks may differ. */
export function sameShape(a: MachineSpec, b: MachineSpec): boolean {
  const key = (s: MachineSpec) => JSON.stringify({
    parts: [...s.parts].sort((p, q) => p.id.localeCompare(q.id)).map((p) => [p.id, p.kind, p.x, p.y, p.z, p.yaw ?? 0, p.length ?? null, !!p.fixed, p.prop ?? null]),
    terrain: s.terrain ?? [], stage: s.stage ?? null, goal: s.goal.map((g) => [g.type, g.part, g.type === 'bell' ? g.times ?? 1 : null]), rules: s.rules ?? null,
  });
  return key(a) === key(b);
}

/** A looks-only edit carried onto the puzzle in play: colours, names and the world, nothing else. */
export function withLooks(s: Pick<MachineState, 'fix' | 'machine'>, edited: MachineSpec): Pick<MachineState, 'fix' | 'machine'> {
  const dress = (ps: Part[]) => ps.map((p) => {
    const q = edited.parts.find((r) => r.id === p.id && r.kind === p.kind);
    return q ? { ...p, color: q.color, label: q.label } : p;
  });
  const world = (spec: MachineSpec): MachineSpec => ({ ...spec, parts: dress(spec.parts), landscape: edited.landscape });
  const fix = s.fix && { ...s.fix, hand: dress(s.fix.hand), placed: dress(s.fix.placed),
    puzzle: { ...s.fix.puzzle, spec: world(s.fix.puzzle.spec), solution: world(s.fix.puzzle.solution), missing: dress(s.fix.puzzle.missing), start: dress(s.fix.puzzle.start) } };
  return { fix, machine: s.machine && world(s.machine) };
}

/** Where to stop: a beat after the last goal step or the ball leaving, else the whole run. */
function playbackEnd(run: MachineRun, result: MachineResult): number {
  const times = result.steps.flatMap((s) => (s.t !== undefined ? [s.t] : []));
  if (result.success && times.length) return Math.min(run.spec.duration, Math.max(...times) + 2);
  const fell = run.events.find((e) => e.type === 'fell');
  const last = run.events.length ? run.events[run.events.length - 1].t : 0;
  if (fell) return Math.min(run.spec.duration, fell.t + 1.5);
  return Math.min(run.spec.duration, Math.max(last + 3, 4));
}

export const useMachine = create<MachineState>((set, get) => {
  /** Simulate and play a machine without changing which machine is "the" machine. */
  const simulate = async (spec: MachineSpec, autoplay = true): Promise<MachineResult | null> => {
    const seq = ++loadSeq;
    set({ phase: 'simulating', error: null, run: null, result: null, time: 0, celebrated: 0 });
    try {
      const { run, result, hash } = await simulateInWorker(spec);
      if (seq !== loadSeq) return null;
      set({ run, result, hash, phase: autoplay ? 'playing' : 'idle', time: 0, celebrated: 0, endTime: playbackEnd(run, result) });
      return result;
    } catch (err) {
      if (seq !== loadSeq) return null;
      set({ phase: 'idle', error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  /** What a play is called in the play log: a built-in slug, a community id, the daily stage, or an AI level. */
  const playKey = (): string => {
    const { level, daily, fix } = get();
    if (daily.date) return `daily:${daily.date}:${daily.stage}`;
    if (level) return level.slug === 'shared' ? 'shared' : level.slug;
    return fix?.puzzle.verified === false ? 'ai:unrun' : 'ai';
  };
  /** Leaving a puzzle that was tried but never solved counts as giving up on it. */
  const abandon = () => {
    const { fix } = get();
    if (fix && !fix.solved && fix.tries > 0) {
      logPlay(playKey(), 'giveup', fix.tries, fix.placed.length);
    }
  };

  // Only a final, verified result replaces the current build. Failed requests leave it playable.
  const aiStream = async (path: '/machine' | '/machine/edit', body: unknown) => {
    aiAbort?.abort();
    const controller = new AbortController();
    aiAbort = controller;
    set({ ai: { ...idleAi, busy: true }, working: true, notice: null, pendingPart: null });
    const current = () => aiAbort === controller && !controller.signal.aborted;
    const log = (line: string) => set((s) => ({ ai: { ...s.ai, lines: [...s.ai.lines, line].slice(-8) } }));
    let candidate: Extract<MachineStreamEvent, { type: 'machine' }> | null = null;
    try {
      await streamMachine(path, body, (e: MachineStreamEvent) => {
        if (!current()) return;
        switch (e.type) {
          case 'stage': log(e.message || `${e.stage}…`); break;
          case 'progress': set((s) => ({ ai: { ...s.ai, progress: e.goalLength ? e.bestScore / e.goalLength : 0 } })); break;
          case 'sketch': set((s) => ({ ai: { ...s.ai, sketch: { attempt: e.attempt, title: e.title, parts: e.parts, terrain: e.terrain } } })); break;
          case 'draft': log(e.status === 'solved' ? 'Physics check passed.' : 'Testing the design…'); break;
          case 'machine': candidate = e; break;
          case 'error': throw new Error(e.error);
        }
      }, controller.signal);
      if (!current()) return;
      // Assignment happens inside the stream callback.
      const result = candidate as Extract<MachineStreamEvent, { type: 'machine' }> | null;
      if (!result?.solved || result.verified === false) {
        throw new Error('I couldn’t verify a working version of that request. Try a simpler route or a different mechanism. Your previous build is still here.');
      }
      const parsed = parseMachine(result.machine);
      if (!parsed.ok) throw new Error('The designer returned an invalid machine. Try another description.');
      // Appearance IDs come from the asset workflow, never from the language model.
      parsed.spec.parts = parsed.spec.parts.map(p => {
        const { look: _invented, ...part } = p;
        const original = path === '/machine/edit' ? (body as { machine: MachineSpec }).machine.parts.find(q => q.id === p.id && q.kind === p.kind) : undefined;
        return original?.look && original.color === p.color ? { ...part, look: original.look } : part;
      });
      if (path === '/machine/edit') parsed.spec.title = (body as { machine: MachineSpec }).machine.title;
      // During a puzzle the level is not the player's to change: looks apply in place, and anything
      // else waits until the player chooses to make it their own copy (which ends the scored run).
      const playing = get().fix;
      if (path === '/machine/edit' && playing && !playing.solved) {
        const original = (body as { machine: MachineSpec }).machine;
        if (sameShape(original, parsed.spec)) {
          set({ ...withLooks(get(), parsed.spec), notice: 'Looks changed. Your puzzle, tries and score are untouched.', draft: '' });
          log('Looks only: the puzzle is unchanged.');
          return;
        }
        set({ remix: { spec: parsed.spec, original, moved: result.moved }, notice: null });
        log('That change reshapes the puzzle itself.');
        return;
      }
      await adopt(path, body, parsed.spec, result.moved);
    } catch (err) {
      if (current()) set((s) => ({ ai: { ...s.ai, error: err instanceof Error ? err.message : String(err) } }));
    } finally {
      if (current()) set((s) => ({ ai: { ...s.ai, busy: false }, working: false }));
    }
  };
  /** A verified result becomes the current machine; any puzzle or daily run in progress ends. */
  const adopt = async (path: '/machine' | '/machine/edit', body: unknown, spec: MachineSpec, moved: { id: string; cells: number }[]) => {
    const log = (line: string) => set((s) => ({ ai: { ...s.ai, lines: [...s.ai.lines, line].slice(-8) } }));
    if (path === '/machine/edit' && get().machine && unchanged(get().machine!, spec)) {
      log('The layout stayed the same. The ball and targets are fixed; try changing a ramp, fan, or cannon.');
    } else log('Ready. The full route passed its physics check.');
    abandon();
    set((s) => ({
      lastEdit: path === '/machine/edit' ? (body as { machine: MachineSpec }).machine : null,
      notice: path === '/machine/edit' ? 'Change applied. Press Run to try it, or Undo to go back.' : 'Your machine is ready. Press Run to see what happens.',
      tutorial: false, suspendedFix: null, puzzle: false, level: null, board: null, remix: null,
      daily: { ...s.daily, date: '', stage: 0, tries: 0, builds: [] },
      prompt: path === '/machine' ? (body as { prompt: string }).prompt : s.prompt,
      promptMode: 'edit', draft: '',
      builds: s.builds + (path === '/machine' ? 1 : 0), edits: s.edits + (path === '/machine/edit' ? 1 : 0),
    }));
    await get().load(spec, { rank: 2, proven: true, moved });
  };

  return {
    remix: null,
    async acceptRemix() {
      const r = get().remix;
      if (!r) return;
      await adopt('/machine/edit', { machine: r.original }, { ...r.spec, title: `${r.original.title} (remix)` }, r.moved);
      set({ notice: 'This is your own copy now; the scored run has ended. Press Run to try it, or Undo to go back.' });
    },
    declineRemix() {
      set({ remix: null, notice: 'Kept the puzzle as it was. Changes to looks (colours, names, the world) work while you play.' });
    },
    prompt: '',
    promptMode: 'edit',
    setPromptMode: (promptMode) => set((s) => ({ promptMode, draft: '', draftFocus: s.draftFocus + 1 })),
    tutorial: false,
    suspendedFix: null,
    async startTutorial() {
      aiAbort?.abort();
      const parsed = parseMachine(firstShot);
      if (!parsed.ok) return;
      const solution = parsed.spec;
      const ramp = solution.parts.find((p) => p.kind === 'ramp')!;
      const puzzle: Puzzle = { kind: 'missing', solution, spec: { ...solution, parts: solution.parts.filter((p) => p.id !== ramp.id) }, missing: [ramp], start: [], failedAt: 0, verified: true };
      set((s) => ({
        tutorial: true, puzzle: true, suspendedFix: null, mode: 'fix', machine: solution, proven: true, rank: 2, veiled: false,
        level: null, board: null, ai: idleAi, working: false, promptMode: 'edit', pendingPart: null, notice: null, lastEdit: null,
        daily: { ...s.daily, date: '', stage: 0, tries: 0 },
        fix: { puzzle, kind: 'missing', hand: [ramp], placed: [], picking: 0, lift: 1, tries: 0, solved: false, hint: true, stars: 0 },
      }));
      await simulate(puzzle.spec, false);
    },
    draft: '',
    pendingPart: null,
    notice: null,
    lastEdit: null,
    async submitPrompt(text) {
      if (get().ai.busy || !text.trim()) return;
      const kind = addedPart(text);
      if (kind && get().machine) { get().addPart(kind); return; }
      if (get().machine && (get().promptMode === 'edit' || isEditInstruction(text))) {
        set({ promptMode: 'edit' });
        await get().edit(text);
      } else await get().create(text);
    },
    addPart(kind) {
      const { machine, fix } = get();
      if (!machine || get().ai.busy) return;
      const parts = fix ? withPlacements(fix.puzzle, fix.placed).parts : machine.parts;
      if (parts.length >= 40) { set({ notice: 'This machine has enough parts for now. Try changing one of them.' }); return; }
      let suffix = 1;
      while (parts.some((p) => p.id === `added_${kind}_${suffix}`)) suffix++;
      loadSeq++;
      set({ pendingPart: { id: `added_${kind}_${suffix}`, kind, x: 0, y: 0, z: 0, yaw: 0 }, promptMode: 'edit', draft: '', ai: idleAi,
        notice: `${kind === 'platform' ? 'Shelf' : kind[0].toUpperCase() + kind.slice(1)} ready. Click the stage to place it. R turns it; Escape cancels.`,
        run: null, result: null, phase: 'idle', time: 0, celebrated: 0 });
    },
    placePending(x, z) {
      const { pendingPart, machine, fix } = get();
      if (!pendingPart || !machine) return false;
      const visible = fix ? withPlacements(fix.puzzle, fix.placed) : machine;
      const moving = visible.parts.some(p => p.id === pendingPart.id);
      const part = dropAt(visible.parts, pendingPart, x, z, { terrain: visible.terrain, ...(moving && pendingPart.kind === 'platform' ? { y: pendingPart.y } : {}) });
      if (!part || footprint(part).some(c => !inStage(stageOf(visible), c.x, c.z))) { set({ notice: 'Choose a clear spot inside the stage.' }); return false; }
      const changed = { ...visible, parts: moving ? visible.parts.map(p => p.id === part.id ? part : p) : [...visible.parts, part] };
      set((s) => ({ machine: changed, lastEdit: visible, fix: null, suspendedFix: null, mode: 'build', puzzle: false, tutorial: false,
        level: null, board: null, daily: { ...s.daily, date: '', stage: 0, tries: 0, builds: [] },
        pendingPart: null, dragging: false, proven: false, moved: [], rank: 0, run: null, result: null, phase: 'idle',
        notice: `${part.kind === 'platform' ? 'Shelf' : part.kind[0].toUpperCase() + part.kind.slice(1)} ${moving ? 'moved' : 'added'}. Drag it to move it again; press Run to try the machine.` }));
      return true;
    },
    movePart(id) {
      const s = get(), machine = s.machine;
      if (!machine || s.fix || s.ai.busy || s.pendingPart || ['playing', 'simulating'].includes(s.phase)) return false;
      const part = machine.parts.find(p => p.id === id);
      if (!part || part.fixed || lockedParts(machine).has(id)) return false;
      if (part.kind === 'platform' && machine.parts.some(p => supportsOf(machine.parts, p).some(support => support.id === id))) {
        set({ notice: 'Move the parts standing on this shelf first.' }); return false;
      }
      loadSeq++;
      set({ pendingPart: { ...part }, run: null, result: null, phase: 'idle', time: 0, celebrated: 0,
        notice: 'Move to a clear spot and release, or tap a new spot. R turns; Escape cancels.' });
      return true;
    },
    cancelPlacement() { set({ pendingPart: null, dragging: false, notice: null }); },
    applyLook(partId, assetId, expectedMachine) {
      const s = get(), machine = s.machine;
      if (!machine || machine !== expectedMachine || s.fix || s.ai.busy || s.pendingPart || ['playing', 'simulating'].includes(s.phase)) return false;
      const part = machine.parts.find(p => p.id === partId);
      if (!part || !(LOOK_KINDS as readonly string[]).includes(part.kind) || (assetId && !LookRef.safeParse({ assetId }).success)) return false;
      const changed = { ...machine, parts: machine.parts.map(p => {
        if (p.id !== partId) return p;
        const { look: _previous, ...base } = p;
        return assetId ? { ...base, look: { assetId } } : base;
      }) };
      // The physics trace is still valid: only presentation metadata changed.
      loadSeq++;
      set({ machine: changed, lastEdit: machine, run: s.run ? { ...s.run, spec: changed } : null,
        phase: 'idle', time: 0, celebrated: 0, notice: assetId ? 'New look applied. Same part, same behavior. Press Run to try it, or Undo.' : 'Original look restored. Press Run when you’re ready.' });
      return true;
    },
    undoEdit() {
      const previous = get().lastEdit;
      if (!previous || get().ai.busy) return;
      loadSeq++;
      set({ machine: previous, lastEdit: null, pendingPart: null, fix: null, mode: 'build', puzzle: false, proven: false, run: null, result: null, phase: 'idle', time: 0, celebrated: 0, notice: 'Undone. Your previous machine is back.' });
    },
    draftFocus: 0,
    machine: null,
    rank: 0,
    working: false,
    proven: false,
    moved: [],
    ai: idleAi,
    mode: 'build',
    fix: null,
    builds: 0,
    edits: 0,
    puzzle: loadPuzzleMode(),
    veiled: false,
    dragging: false,
    setPuzzle(on) {
      if (get().ai.busy || get().phase === 'simulating') return;
      set({ puzzle: on });
      try { localStorage.setItem(PUZZLE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
      if (!on && get().fix) get().leaveFix();
      else if (on && !get().fix && get().proven) {
        const saved = get().suspendedFix;
        if (saved) {
          set({ fix: saved, mode: 'fix', suspendedFix: null });
          void simulate(withPlacements(saved.puzzle, saved.placed));
        } else void get().startFix('connect');
      }
    },
    level: null,
    stars: loadStars(),
    sharedScore: null,
    async playLevel(level) {
      abandon();
      aiAbort?.abort();
      if (level.gallery) void playedMachine(level.slug);
      set({ board: null, tutorial: false, suspendedFix: null, puzzle: true, promptMode: 'edit', prompt: level.mission, pendingPart: null, notice: null, lastEdit: null });
      const proven = level.verified !== false;
      set((s) => ({ ai: idleAi, working: false, error: null, level, daily: { ...s.daily, date: '', stage: 0, tries: 0 }, machine: level.spec, rank: 2, proven, moved: [], mode: 'build', fix: null, veiled: true }));
      // A shared level nobody has run plays like a fresh AI level: its idea plus spares, no answer sheet.
      const started = proven ? await get().startFix('connect') : await get().startLevel(level.spec);
      if (!started) await get().load(level.spec, { rank: 2, proven });
    },
    shareable() {
      const { fix, level, machine } = get();
      const spec = fix ? fix.puzzle.solution : machine;
      if (!spec) return null;
      // The spares go along, so the receiver gets the same bin.
      const spares = fix?.puzzle.spares?.map((p) => ({ kind: p.kind as Exclude<Part['kind'], 'ball'>, ...(p.length ? { length: p.length } : {}) }));
      return {
        mission: level?.mission ?? get().prompt ?? spec.title,
        spec: { ...spec, spares: spares?.length ? spares : spec.spares },
        verified: fix ? fix.puzzle.verified !== false : get().proven,
        score: fix?.solved ? { stars: fix.stars, tries: fix.tries, parts: fix.placed.length } : undefined,
      };
    },
    daily: { date: '', loading: false, best: loadBest(), stage: 0, tries: 0, builds: [] },
    playerName: loadName(),
    setPlayerName(name) {
      const clean = name.replace(/\s+/g, ' ').slice(0, 24);
      set({ playerName: clean });
      try { localStorage.setItem(NAME_KEY, clean.trim()); } catch { /* private mode */ }
    },
    board: null,
    async postDaily() {
      const { daily, playerName } = get();
      if (!daily.date) return;
      set((s) => ({ board: { kind: 'daily', rows: s.board?.rows ?? [], busy: true } }));
      try {
        const r = await submitDaily({ date: daily.date, name: playerName.trim() || 'Anonymous', tries: daily.tries, builds: daily.builds });
        set({ board: { kind: 'daily', rows: r.board, rank: r.rank } });
      } catch (err) {
        set((s) => ({ board: { kind: 'daily', rows: s.board?.rows ?? [], error: err instanceof Error ? err.message : String(err) } }));
      }
    },
    async publish() {
      const { fix, level, prompt, playerName } = get();
      if (!fix?.solved) throw new Error('Solve it first: a level is published with the build that solved it.');
      const build = withPlacements(fix.puzzle, fix.placed);
      // The bin travels too: the parts the player left unused become spares, with the level's own.
      const unused = handOf(fix.puzzle).filter((h) => !fix.placed.some((p) => p.id === h.id)).map((h) => ({ kind: h.kind as Exclude<Part['kind'], 'ball'>, ...(h.length ? { length: h.length } : {}) }));
      const spares = unused.slice(0, 4);
      return publishMachine({
        machine: { ...build, spares: spares.length ? spares : undefined },
        mission: level?.mission ?? prompt ?? build.title,
        author: playerName.trim() || 'Anonymous',
        tries: fix.tries,
        parts: fix.placed.length,
      });
    },
    run: null,
    result: null,
    hash: null,
    phase: 'idle',
    time: 0,
    endTime: 0,
    celebrated: 0,
    error: null,

    setPrompt: (prompt) => set({ prompt }),
    setDraft: (draft) => set({ draft }),

    insertPart(id) {
      const { fix, machine, draft } = get();
      const parts = fix ? fix.puzzle.solution.parts : machine?.parts;
      const name = parts && partNames(parts).get(id);
      if (!name) return;
      const before = draft.replace(/\s+$/, '');
      set((s) => ({ promptMode: 'edit', draft: `${before}${before ? ' ' : ''}${name} `, draftFocus: s.draftFocus + 1 }));
    },

    create(prompt) {
      return aiStream('/machine', { prompt, verify: true, stage: requestedStage() });
    },

    edit(instruction) {
      const { machine, fix } = get();
      if (!machine) return Promise.resolve();
      // Mid-puzzle with parts still in hand, the edit reads the puzzle's whole machine; only its looks come back unless the player makes a copy.
      const placedBuild = fix ? withPlacements(fix.puzzle, fix.placed) : machine;
      const visible = fix && !parseMachine(placedBuild).ok ? fix.puzzle.solution : placedBuild;
      if (!parseMachine(visible).ok) {
        set((s) => ({ ai: { ...s.ai, error: 'Place the route’s checkpoint parts before editing this build, or choose Watch to edit the complete machine.' } }));
        return Promise.resolve();
      }
      return aiStream('/machine/edit', { machine: visible, instruction, verify: true });
    },

    async load(machine, meta = {}) {
      set({ machine, rank: meta.rank ?? 0, proven: meta.proven ?? false, moved: meta.moved ?? [], mode: 'build', fix: null, veiled: false, pendingPart: null });
      await simulate(machine, false);
    },

    play() {
      const { run, result, mode, fix } = get();
      if (mode === 'fix' && fix) {
        void get().runFix();
        return;
      }
      if (!run || !result) {
        const machine = get().machine;
        if (machine && !get().pendingPart) void simulate(machine).then((result) => {
          if (get().machine === machine && result) set({ proven: result.success && !ruleProblems(machine.rules, result, routeParts(machine).length).length });
        });
        return;
      }
      set({ phase: 'playing', time: 0, celebrated: 0, endTime: playbackEnd(run, result) });
    },

    setTime: (time) => set({ time }),

    celebrate(step) {
      if (step < get().celebrated) return;
      set({ celebrated: step + 1 });
    },

    finish() {
      const { phase, result, mode, fix } = get();
      if (phase !== 'playing') return;
      set({ phase: 'done' });
      if (result?.success && !fix?.broke?.length) sfx.success();
      if (mode === 'fix' && (!result?.success || fix?.broke?.length)) sfx.miss();
    },

    stopAi() {
      aiAbort?.abort();
      set({ ai: idleAi, working: false });
    },

    async playDaily() {
      abandon();
      aiAbort?.abort();
      set((s) => ({ ai: idleAi, working: false, board: null, tutorial: false, suspendedFix: null, puzzle: true, daily: { ...s.daily, loading: true, builds: [] }, error: null }));
      try {
        const d = await getDailyMachine();
        const parsed = parseMachine(d.machine);
        if (!parsed.ok) throw new Error("Today's machine is broken; try again later.");
        set({ machine: parsed.spec, rank: 2, proven: true, moved: [], mode: 'build', fix: null, veiled: true });
        set((s) => ({ daily: { ...s.daily, date: d.date, loading: false, stage: 0, tries: 0 } }));
        await get().nextDailyStage();
      } catch (err) {
        set((s) => ({ daily: { ...s.daily, loading: false }, error: err instanceof Error ? err.message : String(err) }));
      }
    },

    async nextDailyStage() {
      const { daily } = get();
      // Stages go missing, two missing, moved; a stage the machine cannot offer is skipped.
      for (let stage = daily.stage + 1; stage <= DAILY_LADDER.length; stage++) {
        set((s) => ({ daily: { ...s.daily, stage } }));
        if (await get().startFix(DAILY_LADDER[stage - 1])) return;
      }
      set((s) => ({ daily: { ...s.daily, stage: DAILY_LADDER.length + 1 } }));
    },

    async startFix(kind = 'missing') {
      const { machine, proven, daily } = get();
      if (!machine || !proven) return false;
      set({ phase: 'simulating', error: null, puzzle: true, tutorial: false, suspendedFix: null });
      const seed = daily.date ? dailySeed(daily.date) : Math.floor(Math.random() * 1e9);
      let puzzle: Puzzle | null = null;
      try {
        puzzle = await makePuzzle(machine, kind, seed);
      } catch (err) {
        set({ phase: 'idle', veiled: false, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
      if (!puzzle) {
        set({ phase: 'idle', veiled: false, error: kind === 'missing' ? 'This machine has no part that can be taken out; try another one.' : 'This machine cannot be broken that way; try another kind.' });
        return false;
      }
      set({ mode: 'fix', veiled: false, fix: { puzzle, kind, hand: handOf(puzzle).map((m) => ({ ...m })), placed: puzzle.start, picking: puzzle.start.length ? null : 0, lift: 1, tries: 0, solved: false, hint: false, stars: 0 } });
      logPlay(playKey(), 'start', 0, 0);
      // Show the broken machine fail first, so the player sees what is wrong.
      await simulate(withPlacements(puzzle, puzzle.start));
      return true;
    },

    async startLevel(level) {
      const puzzle = makeLevelPuzzle(level);
      if (!puzzle) {
        set({ veiled: false, error: 'This level has no parts to hand out; ask for another one.' });
        return false;
      }
      set({ mode: 'fix', veiled: false, phase: 'simulating', error: null, fix: { puzzle, kind: 'connect', hand: handOf(puzzle).map((m) => ({ ...m })), placed: [], picking: 0, lift: 1, tries: 0, solved: false, hint: false, stars: 0 } });
      logPlay(playKey(), 'start', 0, 0);
      // The stage as it is: the ball drops and nothing happens yet.
      await simulate(withPlacements(puzzle, []));
      return true;
    },

    pick(index) {
      set((s) => (s.fix ? { fix: { ...s.fix, picking: index } } : {}));
    },

    placeAt(x, z) {
      const { fix } = get();
      if (!fix || fix.picking === null || fix.solved) return false;
      const original = fix.hand[fix.picking];
      const others = fix.placed.filter((p) => p.id !== original.id);
      // Lands on the floor or the platform under the cursor (a shelf at the chosen height); a taken cell refuses it.
      const part = dropAt([...fix.puzzle.spec.parts, ...others], original, x, z, { y: fix.lift, terrain: fix.puzzle.spec.terrain });
      if (!part) return false;
      const placed = [...others, part];
      const next = fix.hand.findIndex((m) => !placed.some((p) => p.id === m.id));
      // A run still being simulated (the opening replay) is stale now.
      loadSeq++;
      set({ fix: { ...fix, placed, picking: next >= 0 ? next : null }, run: null, result: null, phase: 'idle' });
      return true;
    },

    rotatePicked() {
      const pending = get().pendingPart;
      if (pending) { set({ pendingPart: { ...pending, yaw: ((pending.yaw + 90) % 360) as Part['yaw'] } }); return; }
      const { fix } = get();
      if (!fix || fix.solved) return;
      let { picking } = fix;
      let placed = fix.placed;
      if (picking === null) return;
      const id = fix.hand[picking].id;
      if (placed.some((p) => p.id === id)) placed = placed.filter((p) => p.id !== id);
      const hand = fix.hand.map((h, i) => (i === picking ? { ...h, yaw: (((h.yaw + 90) % 360) as Part['yaw']) } : h));
      set({ fix: { ...fix, hand, placed, picking }, run: null, result: null, phase: 'idle' });
    },

    pickPlaced(id) {
      const { fix } = get();
      if (!fix || fix.solved) return;
      const index = fix.hand.findIndex((m) => m.id === id);
      if (index < 0) return;
      const lifted = fix.placed.find((p) => p.id === id);
      let placed = fix.placed.filter((p) => p.id !== id);
      // Whatever stood on a lifted shelf comes up with it, back into the hand.
      const all = [...fix.puzzle.spec.parts, ...placed];
      placed = placed.filter((p) => isSupported(all, p, fix.puzzle.spec.terrain));
      set({ fix: { ...fix, placed, picking: index, lift: lifted?.kind === 'platform' ? lifted.y : fix.lift }, run: null, result: null, phase: 'idle' });
    },

    liftBy(by) {
      const { fix } = get();
      if (!fix || fix.solved || fix.picking === null) return;
      const part = fix.hand[fix.picking];
      if (part.kind !== 'platform') return;
      if (fix.placed.some((p) => p.id === part.id)) get().pickPlaced(part.id);
      set((s) => (s.fix ? { fix: { ...s.fix, lift: Math.max(0, Math.min(GRID.y - 1, s.fix.lift + by)) } } : {}));
    },

    clearPlaced() {
      const { fix } = get();
      if (!fix || fix.solved) return;
      set({ fix: { ...fix, placed: [], picking: 0, hand: handOf(fix.puzzle).map((m) => ({ ...m })) }, run: null, result: null, phase: 'idle' });
    },

    async runFix() {
      const { fix } = get();
      if (!fix || fix.solved) return;
      set({ fix: { ...fix, tries: fix.tries + 1, broke: undefined } });
      const result = await simulate(withPlacements(fix.puzzle, fix.placed));
      // The goal happened, but a challenge level also wants it done its way.
      const broke = result?.success ? ruleProblems(fix.puzzle.solution.rules, result, fix.placed.length) : [];
      if (broke.length) set((s) => (s.fix ? { fix: { ...s.fix, broke } } : {}));
      if (result?.success && !broke.length) {
        set((s) => (s.fix ? { fix: { ...s.fix, solved: true, stars: starsFor(s.fix), server: 'checking' } } : {}));
        // The server runs the same build: the same physics must give the same trace, bit for bit.
        const browserHash = get().hash;
        void verifyOnServer(withPlacements(fix.puzzle, fix.placed)).then((v) => {
          const server = !v ? 'offline' : v.success && v.hash === browserHash ? 'agrees' : 'differs';
          if (server === 'differs') console.warn('[machine] server run differs', { browser: browserHash, server: v });
          set((s) => (s.fix?.solved ? { fix: { ...s.fix, server } } : {}));
        });
        const { level, fix: won, stars } = get();
        if (won) logPlay(playKey(), 'solve', won.tries, won.placed.length);
        // A community level: the server re-runs the build before it goes on the level's board.
        if (level?.gallery && won) {
          set({ board: { kind: 'level', rows: [], busy: true } });
          void clearMachine(level.slug, { placed: won.placed, tries: won.tries, name: get().playerName.trim() || 'Anonymous' })
            .then((r) => set({ board: { kind: 'level', rows: r.board, rank: r.rank } }))
            .catch((err: unknown) => set({ board: { kind: 'level', rows: [], error: err instanceof Error ? err.message : String(err) } }));
        }
        if (level && level.slug !== 'shared' && won && won.stars > (stars[level.slug] ?? 0)) {
          const next = { ...stars, [level.slug]: won.stars };
          try { localStorage.setItem(STARS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
          set({ stars: next });
        }
        // The daily ladder adds up tries; the last stage records a personal best.
        const { daily, fix: done } = get();
        if (daily.date && done) {
          const tries = daily.tries + done.tries;
          const last = daily.stage >= DAILY_LADDER.length;
          const best = last && (!daily.best[daily.date] || tries < daily.best[daily.date]) ? { ...daily.best, [daily.date]: tries } : daily.best;
          if (best !== daily.best) { try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* private mode */ } }
          set({ daily: { ...daily, tries, best, builds: [...daily.builds, done.placed] } });
        }
      }
    },

    showHint() {
      const { fix } = get();
      if (fix && !fix.hint) { logPlay(playKey(), 'hint', fix.tries, fix.placed.length); }
      set((s) => (s.fix && !s.fix.hint ? { fix: { ...s.fix, hint: true, tries: s.fix.tries + HINT_COST } } : {}));
    },

    leaveFix() {
      abandon();
      const { machine, fix, tutorial } = get();
      // A solved puzzle: what plays on is the player's build, not the AI's idea of one.
      const whole = fix?.solved ? withPlacements(fix.puzzle, fix.placed) : machine;
      const saved = fix && !fix.solved && !fix.hint && !tutorial ? { ...fix, hint: true, tries: fix.tries + HINT_COST } : fix;
      set((s) => ({ mode: 'build', puzzle: false, suspendedFix: saved, fix: null, machine: whole, proven: fix?.solved ? true : s.proven, daily: { ...s.daily, date: '', stage: 0, tries: 0 } }));
      if (whole) void simulate(whole);
    },
  };
});

// Dev only: lets headless browser checks drive the screen.
if (import.meta.env.DEV) (window as unknown as { __machine: typeof useMachine }).__machine = useMachine;
