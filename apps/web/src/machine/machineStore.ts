import {
  DAILY_LADDER, dailySeed, dropAt, GRID, handOf, isSupported, makeLevelPuzzle, parseMachine, partNames, PUZZLE_KINDS, ruleProblems, samePlace, withPlacements,
  type MachineResult, type MachineRun, type MachineSpec, type MachineStreamEvent, type Part, type Puzzle, type PuzzleKind, type Terrain,
} from '@og/machine';
import { create } from 'zustand';
import { sfx, voice } from '../game/audio';
import { clearMachine, getDailyMachine, logPlay, makePuzzle, playedMachine, publishMachine, simulateInWorker, streamMachine, submitDaily, verifyOnServer, type MachineItem, type Score } from './machineClient';
import type { Level, SharedLevel } from './levels';

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

export type PlayPhase = 'idle' | 'simulating' | 'playing' | 'done';

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
  /** What the player is typing in the prompt bar; parts clicked on the stage are added here. */
  draft: string;
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
  try { return localStorage.getItem(PUZZLE_KEY) !== '0'; } catch { return true; }
}
function loadBest(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
let aiAbort: AbortController | null = null;
let loadSeq = 0;

/** Same parts in the same cells (the optimizer's fine offsets aside). */
function unchanged(a: MachineSpec, b: MachineSpec): boolean {
  return a.parts.length === b.parts.length && a.parts.every((p) => { const q = b.parts.find((x) => x.id === p.id); return !!q && samePlace(p, q); });
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
  const simulate = async (spec: MachineSpec): Promise<MachineResult | null> => {
    const seq = ++loadSeq;
    set({ phase: 'simulating', error: null, run: null, result: null, time: 0, celebrated: 0 });
    try {
      const { run, result, hash } = await simulateInWorker(spec);
      if (seq !== loadSeq) return null;
      set({ run, result, hash, phase: 'playing', time: 0, celebrated: 0, endTime: playbackEnd(run, result) });
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
      voice.say('giveup');
    }
  };

  const aiStream = async (path: '/machine' | '/machine/edit', body: unknown) => {
    abandon();
    aiAbort?.abort();
    aiAbort = new AbortController();
    // A new or changed machine is never the daily or an example level any more: its tries must not count as a daily best.
    set((s) => ({ ai: { busy: true, lines: [], progress: 0, error: null, sketch: null }, working: true, mode: 'build', fix: null, level: null, board: null, daily: { ...s.daily, date: '', stage: 0, tries: 0 } }));
    const log = (line: string) => set((s) => ({ ai: { ...s.ai, lines: [...s.ai.lines, line].slice(-8) } }));
    let delivered = false;
    const accept = async (raw: MachineSpec, rank: MachineRank, moved: { id: string; cells: number }[] = []) => {
      const parsed = parseMachine(raw);
      if (!parsed.ok) {
        set((s) => ({ ai: { ...s.ai, error: `The machine came back broken: ${parsed.issues[0]?.message}` } }));
        return;
      }
      delivered = true;
      // Never replace a proven version with an unproven one of the same design.
      if (rank < get().rank && get().machine?.title === parsed.spec.title) return;
      if (get().puzzle && rank === 2 && get().proven) {
        // Puzzle play: the finished machine goes straight into fix-it, unseen until the player builds the route.
        set({ machine: parsed.spec, rank, proven: true, moved, mode: 'build', fix: null, veiled: true });
        if (await get().startFix('connect')) return;
      }
      await get().load(parsed.spec, { rank, proven: rank >= 1, moved });
    };
    // A level the AI only set up: no answer sheet, the hand is the AI's idea plus spares, the player's run is the first.
    const acceptLevel = async (raw: MachineSpec) => {
      const parsed = parseMachine(raw);
      if (!parsed.ok) {
        set((s) => ({ ai: { ...s.ai, error: `The level came back broken: ${parsed.issues[0]?.message}` } }));
        return;
      }
      delivered = true;
      set({ machine: parsed.spec, rank: 2, proven: false, moved: [], mode: 'build', fix: null, veiled: true });
      if (await get().startLevel(parsed.spec)) return;
      await get().load(parsed.spec, { rank: 2, proven: false });
    };
    try {
      await streamMachine(path, body, (e: MachineStreamEvent) => {
        switch (e.type) {
          case 'stage':
            log(e.message || `${e.stage}…`);
            break;
          case 'progress':
            set((s) => ({ ai: { ...s.ai, progress: e.goalLength ? e.bestScore / e.goalLength : 0 } }));
            break;
          case 'sketch':
            set((s) => ({ ai: { ...s.ai, sketch: { attempt: e.attempt, title: e.title, parts: e.parts, terrain: e.terrain } } }));
            break;
          case 'draft':
            log(e.status === 'solved' ? 'The physics proved it works.' : 'Design ready. Running it…');
            // In puzzle play the working version stays hidden until the player completes it.
            if (get().puzzle) {
              const parsed = parseMachine(e.machine);
              if (parsed.ok) set((s) => ({ ai: { ...s.ai, sketch: { attempt: s.ai.sketch?.attempt ?? 1, title: parsed.spec.title, parts: parsed.spec.parts } } }));
              break;
            }
            void accept(e.machine, e.status === 'solved' ? 1 : 0);
            break;
          case 'machine': {
            const unrun = e.verified === false;
            log(unrun ? 'Level ready. Nobody has solved it yet: that is your job.' : e.solved ? `Verified: the machine works${e.moved.length ? ` after nudging ${e.moved.length} part${e.moved.length > 1 ? 's' : ''}` : ''}.` : 'Could not make it work; here is the closest attempt.');
            // An edit that left every part where it was: the request asked for a fixed part to move, most likely.
            const before = get().machine;
            if (path === '/machine/edit' && before && unchanged(before, e.machine)) log('Nothing moved: the ball and the goal parts stay where they are. Change the parts between them instead.');
            set({ proven: e.solved });
            const deliver = unrun ? acceptLevel(e.machine) : accept(e.machine, 2, e.moved);
            void deliver.then(() => set((s) => ({
              ai: { ...idleAi, lines: s.ai.lines }, working: false, proven: e.solved,
              builds: s.builds + (path === '/machine' ? 1 : 0), edits: s.edits + (path === '/machine/edit' ? 1 : 0),
            })));
            break;
          }
          case 'error':
            set((s) => ({ ai: { ...s.ai, error: e.error }, working: false }));
            break;
        }
      }, aiAbort.signal);
      if (!delivered) set((s) => ({ ai: { ...s.ai, busy: false, error: s.ai.error ?? 'The AI did not return a machine.' } }));
      set((s) => ({ ai: { ...s.ai, busy: false }, working: false }));
    } catch (err) {
      set((s) => ({ ai: { ...s.ai, busy: false, error: err instanceof Error ? err.message : String(err) }, working: false }));
    }
  };

  return {
    prompt: '',
    draft: '',
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
      set({ puzzle: on });
      try { localStorage.setItem(PUZZLE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    },
    level: null,
    stars: loadStars(),
    sharedScore: null,
    async playLevel(level) {
      abandon();
      aiAbort?.abort();
      if (level.gallery) void playedMachine(level.slug);
      set({ board: null });
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
        voice.say('board');
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
      set((s) => ({ draft: `${before}${before ? ' ' : ''}${name} `, draftFocus: s.draftFocus + 1 }));
    },

    create(prompt) {
      voice.say('build');
      set({ prompt, machine: null, run: null, result: null, rank: 0, proven: false, moved: [], phase: 'idle', time: 0, celebrated: 0 });
      return aiStream('/machine', { prompt, verify: !get().puzzle });
    },

    edit(instruction) {
      const { machine } = get();
      if (!machine) return Promise.resolve();
      return aiStream('/machine/edit', { machine, instruction, verify: !get().puzzle });
    },

    async load(machine, meta = {}) {
      set({ machine, rank: meta.rank ?? 0, proven: meta.proven ?? false, moved: meta.moved ?? [], mode: 'build', fix: null, veiled: false });
      await simulate(machine);
    },

    play() {
      const { run, result, mode, fix } = get();
      if (mode === 'fix' && fix) {
        void get().runFix();
        return;
      }
      if (!run || !result) return;
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
      // The engineer has a word once the run has played out.
      if (mode === 'fix' && fix && fix.tries > 0) voice.say(fix.solved ? (fix.stars === 3 ? 'stars' : 'solve') : fix.broke?.length ? 'broke' : 'miss', 0.6);
      else if (mode === 'fix') sfx.miss();
    },

    stopAi() {
      aiAbort?.abort();
      set({ ai: idleAi, working: false });
    },

    async playDaily() {
      abandon();
      aiAbort?.abort();
      set((s) => ({ ai: idleAi, working: false, board: null, daily: { ...s.daily, loading: true, builds: [] }, error: null }));
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
      set({ phase: 'simulating', error: null });
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
      if (!daily.date || daily.stage === 1) voice.say(daily.date ? 'daily' : 'start', 0.3);
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
      voice.say('start', 0.3);
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
      if (fix && !fix.hint) { logPlay(playKey(), 'hint', fix.tries, fix.placed.length); voice.say('hint'); }
      set((s) => (s.fix && !s.fix.hint ? { fix: { ...s.fix, hint: true, tries: s.fix.tries + HINT_COST } } : {}));
    },

    leaveFix() {
      abandon();
      const { machine, fix } = get();
      // A solved puzzle: what plays on is the player's build, not the AI's idea of one.
      const whole = fix?.solved ? withPlacements(fix.puzzle, fix.placed) : machine;
      set((s) => ({ mode: 'build', fix: null, machine: whole, proven: fix?.solved ? true : s.proven, daily: { ...s.daily, date: '', stage: 0, tries: 0 } }));
      if (whole) void simulate(whole);
    },
  };
});

// Dev only: lets headless browser checks drive the screen.
if (import.meta.env.DEV) (window as unknown as { __machine: typeof useMachine }).__machine = useMachine;
