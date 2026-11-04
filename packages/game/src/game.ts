/**
 * @pg/game: the workshop's state and rules, with no React, no DOM and no network of its own.
 * Everything outside (the server, the physics runner, sound, saved progress, the clock) comes in
 * through ports, so the same game runs in a browser, a test or a headless tool.
 *
 *   const game = createGame({ api, physics, storage });
 *   await game.getState().create('a snowball races down the High Tatras into a cave');
 *   game.getState().buildByWords('put a ramp next to the snowball');
 */
import {
  HEROES, targetParts, dropAt, footprint, GRID, inStage, stageOf, handOf, isSupported, makeLevelPuzzle, onPosts, parseMachine, partNames, routeParts, ruleProblems, partOfSpare, spareOf, withPlacements,
  landscapeFromWords, partsNamed, cellsAround, readBuildMove, yawToward, readSceneMove, looksFromWords,
  type Landscape, type MachineResult, type MachineRun, type MachineSpec, type MachineStreamEvent, type Part, type Puzzle, type Spare, type Terrain,
} from '@pg/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GamePorts } from './ports';
import type { Level, SharedLevel } from './levels';
import type { MachineItem, Score } from '@pg/client';

export interface MachineAiLog {
  busy: boolean;
  lines: string[];
  progress: number;
  error: string | null;
  /** Parts (and the shape of the ground) Claude has written so far for the design in progress. */
  sketch: { attempt: number; title?: string; parts: Part[]; terrain?: Terrain[] } | null;
  /** A new level on its way: the scene shows its world and builds up as the steps go by. */
  creating: boolean;
  /** The world it will stand in: the mission's keywords at once, the AI's own as soon as it arrives. */
  world: Landscape | null;
  /** Which build step is under way (see BUILD_STEPS). */
  step: number;
}

/** What the player sees happen while a new level is made. */
export const BUILD_STEPS = ['Reading your idea', 'Building the world', 'Setting the stage'] as const;

/** How far the machine on screen got: 0 = designed, not proven; 1 = proven by the physics; 2 = final. */
export type MachineRank = 0 | 1 | 2;

export type PlayPhase = 'idle' | 'simulating' | 'playing' | 'paused' | 'done';

/** Build: a machine on its own, to watch. Fix: a level, its parts in the player's hand. */
export type Mode = 'build' | 'fix';

export interface FixState {
  puzzle: Puzzle;
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
  /** It worked, and the run is still playing: shown as solved when the ball gets there, not before. */
  winning?: boolean;
  hint: boolean;
  /** Stars for a solved puzzle (1 to 3), or 0. */
  stars: number;
  /** The server's re-run of the solved build: 'agrees' when its trace hash matches the browser's. */
  server?: 'checking' | 'agrees' | 'differs' | 'offline';
  /** The AI solved it on the player's request: no stars, no boards. */
  assisted?: boolean;
  /** The player changed the level (scenery, ground, world): it is their version now. */
  edited?: boolean;
  /** Designer: the level thing selected (arrows nudge it, R turns it), and whether it is in hand to drop with the mouse. */
  selected?: string | null;
  carrying?: boolean;
  /** The last run met the goal but broke the level's challenge rules (too many parts, too quick). */
  broke?: string[];
}

/** What a hint costs, in tries. */
export const HINT_COST = 2;

/** The AI's route length: use as few parts as it did (or fewer) for the parts star. */
export const parOf = (puzzle: Puzzle) => puzzle.missing.length || puzzle.solution.par || handOf(puzzle).length;

/** One star for solving, one for using no more parts than par, one for 3 tries or fewer (hints count). */
export function starsFor(fix: Pick<FixState, 'puzzle' | 'placed' | 'tries'>): number {
  return 1 + (fix.placed.length <= parOf(fix.puzzle) ? 1 : 0) + (fix.tries <= 3 ? 1 : 0);
}

export interface MachineState {
  prompt: string;
  promptMode: 'create' | 'edit';
  setPromptMode: (mode: 'create' | 'edit') => void;
  /**
   * Who is at the board: the level's designer (words change the level; then test it or send it)
   * or a player solving it (words build with the tray; the level is locked). A level made here opens
   * for its designer; a shared, published, built-in or daily level opens for a player.
   */
  role: 'design' | 'play';
  setRole: (role: 'design' | 'play') => void;
  /** The level on the board was made here, so its designer may change it. */
  ownLevel: () => boolean;
  /** A built-in level from Levels: the puzzle is the point, so no hints and no solving for you. */
  noHelp: () => boolean;
  /** What the player is typing in the prompt bar; parts clicked on the stage are added here. */
  draft: string;
  notice: string | null;
  submitPrompt: (text: string) => Promise<void>;
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
  /** The machine is being turned into a level for the player: do not draw it, it is the solution. */
  veiled: boolean;
  /** A placed part is being dragged to a new cell (the camera holds still meanwhile). */
  dragging: boolean;

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
  /** Put a part's name ("dominoes #2") into the draft at its caret, so "move " + a click reads "move dominoes #2". */
  insertPart: (id: string) => void;
  /** Where the caret was in the prompt box. */
  promptTarget: { caret?: number };
  setPromptTarget: (caret?: number) => void;
  create: (prompt: string) => Promise<void>;
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
  /** Today's level, the same for everyone; best: fewest tries per day. */
  daily: { date: string; loading: boolean; best: Record<string, number> };
  /** The name that goes on boards (kept in the browser). */
  playerName: string;
  setPlayerName: (name: string) => void;
  /** The board for what was just solved: a community level's best builds, or today's daily. */
  board: { kind: 'level' | 'daily'; rows: Score[]; rank?: number; error?: string; busy?: boolean } | null;
  /** Put today's result on the board (the server re-runs the build). */
  postDaily: () => Promise<void>;
  /** Publish the solved level to the community gallery with the build that solved it. */
  publish: () => Promise<MachineItem>;
  playDaily: () => Promise<void>;
  /** A proven machine as a level: its route parts go to the player's hand. Resolves false when it has none. */
  startFix: () => Promise<boolean>;
  /** A level nobody has run: the stage stays, the AI's route parts and spares go to the hand. */
  startLevel: (level: MachineSpec) => Promise<boolean>;
  pick: (index: number | null) => void;
  /** Drop the picked part on a column; false when something is in the way. */
  placeAt: (x: number, z: number) => boolean;
  /** Lift a placed part back into the hand (and whatever stood on it, if it is a shelf). */
  pickPlaced: (id: string) => void;
  /** A change to the level in words ("build a fence around the tomb"): scenery at once, other changes through the AI. */
  changeLevel: (text: string) => Promise<void>;
  /** A building move in words during play ("put a ramp under the ball"); false when the text is not one. */
  buildByWords: (text: string) => boolean;
  /** Parts that just appeared on the board, with when (performance.now()), for their pop-in. */
  appear: Record<string, number>;
  /** Raise or lower the shelf in hand by `by` cells (a placed shelf is lifted first). */
  liftBy: (by: number) => void;
  /** Designer: pick a level thing up to drop elsewhere with the mouse (it stays selected). */
  grabLevelPart: (id: string) => void;
  /** Designer: move the selected level thing by cells, or turn it a quarter (false when it does not fit there). */
  shiftLevelPart: (by: { dx?: number; dz?: number; turn?: boolean }) => boolean;
  /** Designer: give the player one more part (a kit part, or one made on the workbench); false when the kit is full. */
  addToKit: (spare: Spare) => string | null;
  /** Designer: a kit part's 3D look arrived (a workbench part's model, made after the part). */
  lookKitPart: (id: string, model: string) => void;
  /** A kit part's new shapes from the test lab; placed copies change too. */
  reshapeKitPart: (id: string, build: NonNullable<Part['build']>) => void;
  /** Designer: take a part out of the player's kit. */
  removeFromKit: (id: string) => void;
  /** Turn the part in hand a quarter turn (or a placed part, which is lifted first). */
  rotatePicked: () => void;
  clearPlaced: () => void;
  runFix: () => Promise<void>;
  showHint: () => void;
  /** Only when the player asks: put the AI's own solution down and run it (no stars for that one). */
  solveForMe: () => Promise<void>;
  /** After the AI solved it: an empty board again, for the player's own build. */
  tryMyself: () => void;
}

const idleAi: MachineAiLog = { busy: false, lines: [], progress: 0, error: null, sketch: null, creating: false, world: null, step: 0 };
/** How long one part takes to pop in, and the gap between parts. */
export const POP_MS = 380;
const POP_GAP = 70;
/** The most parts a designer hands the player (the level's spares). */
export const KIT_MAX = 8;
let kitSeq = 0;

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
    puzzle: { ...s.fix.puzzle, spec: world(s.fix.puzzle.spec), solution: world(s.fix.puzzle.solution), missing: dress(s.fix.puzzle.missing) } };
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


const BEST_KEY = 'pg.daily.best';
const STARS_KEY = 'pg.level.stars';
const NAME_KEY = 'pg.name';

/** A new game. Each has its own state, counters and requests in flight. */
export function createGame(ports: GamePorts): StoreApi<MachineState> {
  const { clearMachine, getDailyMachine, logPlay, makePuzzle, playedMachine, publishMachine, streamMachine, submitDaily, verifyOnServer } = ports.api;
  const simulateInWorker = ports.physics.simulate;
  const sound = { place: () => {}, success: () => {}, miss: () => {}, ...ports.sound };
  const clock = ports.now ?? (() => Date.now());
  const stageForNew = ports.stage ?? (() => undefined);
  // Saved progress: a failing store (private mode, no storage at all) just means nothing is kept.
  const storage = {
    get: (key: string): string | null => { try { return ports.storage?.get(key) ?? null; } catch { return null; } },
    set: (key: string, value: string): void => { try { ports.storage?.set(key, value); } catch { /* not kept */ } },
  };
  let aiAbort: AbortController | null = null;
  let loadSeq = 0;
  function loadStars(): Record<string, number> {
    try { return JSON.parse(storage.get(STARS_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
  }
  function loadName(): string {
    try { return storage.get(NAME_KEY) ?? ''; } catch { return ''; }
  }
  function loadBest(): Record<string, number> {
    try { return JSON.parse(storage.get(BEST_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
  }


  return createStore<MachineState>()((set, get) => {
    /** Designer: a level thing moved or turned, landing where it rests; false (and it stays put) when it does not fit there. */
    const moveLevelPart = (id: string, change: (p: Part) => Part, drop: boolean): boolean => {
      const fix = get().fix!;
      const spec = fix.puzzle.spec;
      const part = spec.parts.find((p) => p.id === id);
      if (!part) return false;
      const want = change(part);
      const stage = stageOf(spec);
      const landed = footprint(want).every((c) => inStage(stage, c.x, c.z)) ? dropAt(spec.parts, want, want.x, want.z, { y: part.y, terrain: spec.terrain }) : null;
      if (!landed) return false;
      const swap = (s: MachineSpec): MachineSpec => ({ ...s, parts: s.parts.map((p) => (p.id === id ? landed : p)) });
      loadSeq++;
      set({ fix: { ...fix, edited: true, carrying: drop ? false : fix.carrying, puzzle: { ...fix.puzzle, spec: swap(spec), solution: swap(fix.puzzle.solution) } }, run: null, result: null, phase: 'idle' });
      return true;
    };
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
  
    /** What a play is called in the play log: a built-in slug, a community id, today's level, or an AI level. */
    const playKey = (): string => {
      const { level, daily, fix } = get();
      if (daily.date) return `daily:${daily.date}`;
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
    const aiStream = async (path: '/machine' | '/machine/edit', body: unknown, world: Landscape | null = null) => {
      aiAbort?.abort();
      const controller = new AbortController();
      aiAbort = controller;
      const creating = path === '/machine';
      set({ ai: { ...idleAi, busy: true, creating, world, step: creating && world ? 1 : 0 }, working: true, notice: null });
      const current = () => aiAbort === controller && !controller.signal.aborted;
      const log = (line: string) => set((s) => ({ ai: { ...s.ai, lines: [...s.ai.lines, line].slice(-8) } }));
      let candidate: Extract<MachineStreamEvent, { type: 'machine' }> | null = null;
      try {
        await streamMachine(path, body, (e: MachineStreamEvent) => {
          if (!current()) return;
          switch (e.type) {
            case 'stage':
              log(e.message || `${e.stage}…`);
              if (e.stage === 'verifying' || e.stage === 'nudging') set((s) => ({ ai: { ...s.ai, step: Math.max(s.ai.step, 2) } }));
              break;
            case 'world': set((s) => ({ ai: { ...s.ai, world: e.landscape, step: Math.max(s.ai.step, 2) } })); break;
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
        if (!result) throw new Error('The AI sent nothing back. Try again.');
        const parsed = parseMachine(result.machine);
        if (!parsed.ok) throw new Error('The designer returned an invalid machine. Try another description.');
        // A change to the level in play: looks apply in place; anything else becomes the level, the player's parts staying put.
        const playing = get().fix;
        if (path === '/machine/edit') {
          if (!playing || playing.solved) return;
          parsed.spec.title = (body as { machine: MachineSpec }).machine.title;
          const original = (body as { machine: MachineSpec }).machine;
          if (sameShape(original, parsed.spec)) {
            set({ ...withLooks(get(), parsed.spec), notice: 'Looks changed. Your parts and tries are untouched.', draft: '' });
            log('Looks only.');
            return;
          }
          // The level itself changed (the edit read the level only): the player's parts stay where they are, unless the change took their cell.
          const level = parsed.spec;
          const cells = new Set(level.parts.filter((p) => p.kind !== 'platform').flatMap((p) => footprint(p).map((c) => `${c.x},${c.z},${p.y}`)));
          const placed = playing.placed.filter((p) => !footprint(p).some((c) => cells.has(`${c.x},${c.z},${p.y}`)));
          const fresh = level.parts.filter((p) => !original.parts.some((q) => q.id === p.id));
          loadSeq++;
          set((s) => ({ fix: { ...playing, placed, edited: true, puzzle: { ...playing.puzzle, spec: level, solution: { ...level, parts: [...level.parts, ...playing.puzzle.missing] } } },
            run: null, result: null, phase: 'idle', draft: '',
            appear: { ...s.appear, ...Object.fromEntries(fresh.map((p, i) => [p.id, clock() + i * POP_GAP])) },
            notice: `Level changed.${placed.length < playing.placed.length ? ' Parts that stood where the change went are back in your tray.' : ' Your parts stay where they were.'}` }));
          log('The level changed.');
          return;
        }
        await adopt(body as { prompt: string }, parsed.spec, result.moved, !!result.solved && result.verified !== false);
      } catch (err) {
        if (current()) set((s) => ({ ai: { ...s.ai, error: err instanceof Error ? err.message : String(err) } }));
      } finally {
        if (current()) set((s) => ({ ai: { ...s.ai, busy: false }, working: false }));
      }
    };
    /** A new level becomes the one on the board, for its designer; any level or daily in progress ends. */
    const adopt = async (body: { prompt: string }, spec: MachineSpec, moved: { id: string; cells: number }[], proven: boolean) => {
      abandon();
      set((s) => ({ level: null, board: null, daily: { ...s.daily, date: '' }, prompt: body.prompt, promptMode: 'edit', draft: '' }));
      await get().load(spec, { rank: 2, proven, moved });
      if (proven ? await get().startFix() : await get().startLevel(spec)) {
        // The level builds up piece by piece: the start, the goal, the centrepiece, then the obstacles.
        const fix = get().fix!;
        const rank = (p: Part) => (p.kind === 'ball' ? 0 : targetParts(fix.puzzle.spec).has(p.id) ? 1 : p.prop === 'landmark' || (HEROES as readonly string[]).includes(p.prop ?? '') ? 2 : p.prop ? 4 : 3);
        const order = [...fix.puzzle.spec.parts].sort((a, b) => rank(a) - rank(b));
        const gap = Math.min(POP_GAP, 1800 / Math.max(1, order.length));
        const now = clock() + 150;
        get().pick(null);
        set({ role: 'design', appear: Object.fromEntries(order.map((p, i) => [p.id, now + i * gap])), notice: null });
      } else set({ error: null });
    };

    return {
      prompt: '',
      promptMode: 'edit',
      setPromptMode: (promptMode) => set((s) => ({ promptMode, draft: '', draftFocus: s.draftFocus + 1 })),
      role: 'play',
      setRole(role) {
        if (role === 'design' && !get().ownLevel()) return;
        get().pick(null);
        set((s) => ({ role, draft: '', notice: null, draftFocus: s.draftFocus + 1 }));
      },
      ownLevel: () => { const s = get(); return !!s.fix && !s.level && !s.daily.date; },
      noHelp: () => { const { level, daily } = get(); return !!level?.builtIn && !daily.date; },
      draft: '',
      notice: null,
      async submitPrompt(text) {
        if (get().ai.busy || !text.trim()) return;
        // During play, words build with the parts in the tray; only other wishes (looks, the world) go to the AI.
        if (get().fix && !get().fix!.solved && get().promptMode === 'edit') {
          // The designer's words change the level; a player's build with the tray.
          if (get().role === 'design') { set({ draft: '' }); await get().changeLevel(text); return; }
          get().buildByWords(text);
          return;
        }
        await get().create(text);
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
      veiled: false,
      dragging: false,
      level: null,
      stars: loadStars(),
      sharedScore: null,
      async playLevel(level) {
        abandon();
        aiAbort?.abort();
        if (level.gallery) void playedMachine(level.slug);
        set({ role: 'play', board: null, promptMode: 'edit', prompt: level.mission, notice: null });
        const proven = level.verified !== false;
        set((s) => ({ ai: idleAi, working: false, error: null, level, daily: { ...s.daily, date: '' }, machine: level.spec, rank: 2, proven, moved: [], mode: 'build', fix: null, veiled: true }));
        // A shared level nobody has run plays like a fresh AI level: its idea plus spares, no answer sheet.
        const started = proven ? await get().startFix() : await get().startLevel(level.spec);
        if (!started) await get().load(level.spec, { rank: 2, proven });
      },
      shareable() {
        const { fix, level, machine } = get();
        const spec = fix ? fix.puzzle.solution : machine;
        if (!spec) return null;
        // The spares go along, so the receiver gets the same bin.
        const spares = fix?.puzzle.spares?.map(spareOf);
        return {
          mission: level?.mission ?? get().prompt ?? spec.title,
          spec: { ...spec, spares: spares?.length ? spares : spec.spares },
          verified: fix ? fix.puzzle.verified !== false : get().proven,
          score: fix?.solved ? { stars: fix.stars, tries: fix.tries, parts: fix.placed.length } : undefined,
        };
      },
      daily: { date: '', loading: false, best: loadBest() },
      playerName: loadName(),
      setPlayerName(name) {
        const clean = name.replace(/\s+/g, ' ').slice(0, 24);
        set({ playerName: clean });
        storage.set(NAME_KEY, clean.trim());
      },
      board: null,
      async postDaily() {
        const { daily, playerName, fix } = get();
        if (!daily.date || !fix?.solved) return;
        set((s) => ({ board: { kind: 'daily', rows: s.board?.rows ?? [], busy: true } }));
        try {
          const r = await submitDaily({ date: daily.date, name: playerName.trim() || 'Anonymous', tries: fix.tries, placed: fix.placed });
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
        const unused = handOf(fix.puzzle).filter((h) => !fix.placed.some((p) => p.id === h.id)).map(spareOf);
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
        const { fix, machine, promptTarget, draft: text } = get();
        // Named as the board shows it now (the player's parts too): the numbers the word readers count by.
        const parts = fix ? (fix.solved ? fix.puzzle.solution : withPlacements(fix.puzzle, fix.placed)).parts : machine?.parts;
        const name = parts && partNames(parts).get(id);
        if (!name) return;
        const at = Math.min(promptTarget.caret ?? text.length, text.length);
        const head = text.slice(0, at).replace(/\s+$/, ''), tail = text.slice(at).replace(/^\s+/, '');
        const next = `${head}${head ? ' ' : ''}${name} ${tail}`;
        const caret = head.length + (head ? 1 : 0) + name.length + 1;
        set((s) => ({ promptMode: 'edit', draft: next, promptTarget: { caret }, draftFocus: s.draftFocus + 1 }));
      },
      promptTarget: {},
      setPromptTarget: (caret) => set({ promptTarget: { caret } }),
  
      create(prompt) {
        return aiStream('/machine', { prompt, stage: stageForNew() }, landscapeFromWords(prompt));
      },
  
      changeLevel(text) {
        const { fix } = get();
        if (!fix || get().ai.busy || !text.trim()) return Promise.resolve();
        const board = withPlacements(fix.puzzle, fix.placed);
        // A look on its own ("make it night", "snowy") changes the world's colours at once, no AI.
        const look = looksFromWords(text, fix.puzzle.spec.landscape);
        if (look) {
          set({ ...withLooks(get(), { ...fix.puzzle.spec, landscape: look.landscape }), notice: `${look.note} Your parts and tries are untouched.`, draft: '' });
          return Promise.resolve();
        }
        // Scenery the words name goes straight onto the board; anything else goes to the AI as a change to the level.
        const move = readSceneMove(text, { parts: board.parts, stage: stageOf(board), terrain: board.terrain });
        if (move && 'error' in move) { set({ notice: move.error }); return Promise.resolve(); }
        if (move && 'remove' in move) {
          const gone = new Set(move.remove);
          const cut = (s: MachineSpec): MachineSpec => ({ ...s, parts: s.parts.filter((p) => !gone.has(p.id)) });
          loadSeq++;
          set({ fix: { ...fix, edited: true, puzzle: { ...fix.puzzle, spec: cut(fix.puzzle.spec), solution: cut(fix.puzzle.solution) } } });
          set({ run: null, result: null, phase: 'idle', notice: `${move.what}: gone from the level. Press Run to see how it changes things.` });
          sound.place();
          return Promise.resolve();
        }
        if (move) {
          const add = (s: MachineSpec): MachineSpec => ({ ...s, parts: [...s.parts, ...move.parts] });
          loadSeq++;
          set({ fix: { ...fix, edited: true, puzzle: { ...fix.puzzle, spec: add(fix.puzzle.spec), solution: add(fix.puzzle.solution) } } });
          set((s) => ({ run: null, result: null, phase: 'idle',
            appear: { ...s.appear, ...Object.fromEntries(move.parts.map((p, i) => [p.id, clock() + i * POP_GAP])) },
            notice: `${move.what}: part of the level now. Press Run to see how it changes things.` }));
          sound.place();
          return Promise.resolve();
        }
        // The level only (not the player's parts), so the change comes back as a new level to build on.
        return aiStream('/machine/edit', { machine: fix.puzzle.spec, instruction: text });
      },
  
      async load(machine, meta = {}) {
        set({ machine, rank: meta.rank ?? 0, proven: meta.proven ?? false, moved: meta.moved ?? [], mode: 'build', fix: null, veiled: false });
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
          if (machine) void simulate(machine).then((result) => {
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
        set({ phase: 'done', ...(fix?.winning ? { fix: { ...fix, solved: true, winning: false } } : {}) });
        if (result?.success && !fix?.broke?.length) sound.success();
        if (mode === 'fix' && (!result?.success || fix?.broke?.length)) sound.miss();
      },
  
      stopAi() {
        aiAbort?.abort();
        set({ ai: idleAi, working: false });
      },
  
      async playDaily() {
        abandon();
        aiAbort?.abort();
        set((s) => ({ role: 'play', ai: idleAi, working: false, board: null, level: null, notice: null, daily: { ...s.daily, loading: true }, error: null }));
        try {
          const d = await getDailyMachine();
          const parsed = parseMachine(d.machine);
          if (!parsed.ok) throw new Error("Today's level is broken; try again later.");
          set((s) => ({ prompt: d.prompt, machine: parsed.spec, rank: 2, proven: false, moved: [], mode: 'build', fix: null, veiled: true, daily: { ...s.daily, date: d.date, loading: false } }));
          // The day's level is played like any new one: its route and spares in the hand, nothing run yet.
          if (!(await get().startLevel(parsed.spec))) await get().load(parsed.spec, { rank: 2 });
        } catch (err) {
          set((s) => ({ daily: { ...s.daily, loading: false }, error: err instanceof Error ? err.message : String(err) }));
        }
      },

      async startFix() {
        const { machine, proven } = get();
        if (!machine || !proven) return false;
        set({ phase: 'simulating', error: null });
        let puzzle: Puzzle | null = null;
        try {
          puzzle = await makePuzzle(machine);
        } catch (err) {
          set({ phase: 'idle', veiled: false, error: err instanceof Error ? err.message : String(err) });
          return false;
        }
        if (!puzzle) {
          set({ phase: 'idle', veiled: false, error: 'This machine has no parts to hand out; try another one.' });
          return false;
        }
        set({ mode: 'fix', veiled: false, fix: { puzzle, hand: handOf(puzzle).map((m) => ({ ...m })), placed: [], picking: 0, lift: 1, tries: 0, solved: false, hint: false, stars: 0 } });
        logPlay(playKey(), 'start', 0, 0);
        await simulate(withPlacements(puzzle, []), false);
        return true;
      },
  
      async startLevel(level) {
        const puzzle = makeLevelPuzzle(level);
        if (!puzzle) {
          set({ veiled: false, error: 'This level has no parts to hand out; ask for another one.' });
          return false;
        }
        set({ mode: 'fix', veiled: false, phase: 'simulating', error: null, fix: { puzzle, hand: handOf(puzzle).map((m) => ({ ...m })), placed: [], picking: 0, lift: 1, tries: 0, solved: false, hint: false, stars: 0 } });
        logPlay(playKey(), 'start', 0, 0);
        // The stage as it is: the ball drops and nothing happens yet.
        await simulate(withPlacements(puzzle, []), false);
        return true;
      },
  
      pick(index) {
        set((s) => (s.fix ? { fix: { ...s.fix, picking: index, ...(index === null ? { selected: null, carrying: false } : {}) } } : {}));
      },
  
      placeAt(x, z) {
        const { fix } = get();
        if (fix && get().role === 'design') return fix.carrying && fix.selected ? moveLevelPart(fix.selected, (p) => ({ ...p, x, z }), true) : false;
        // The designer shapes the level; parts are the player's.
        if (!fix || fix.picking === null || fix.solved || fix.winning) return false;
        const original = fix.hand[fix.picking];
        const others = fix.placed.filter((p) => p.id !== original.id);
        // Lands on the floor or the platform under the cursor (a shelf at the chosen height); a taken cell refuses it.
        const part = dropAt([...fix.puzzle.spec.parts, ...others], original, x, z, { y: fix.lift, terrain: fix.puzzle.spec.terrain });
        if (!part) return false;
        const placed = [...others, part];
        const next = fix.hand.findIndex((m) => !placed.some((p) => p.id === m.id));
        // A run still being simulated (the opening replay) is stale now.
        loadSeq++;
        set((s) => ({ fix: { ...fix, placed, picking: next >= 0 ? next : null }, run: null, result: null, phase: 'idle', appear: { ...s.appear, [part.id]: clock() } }));
        return true;
      },
  
      grabLevelPart(id) {
        const { fix } = get();
        if (!fix || get().role !== 'design' || !fix.puzzle.spec.parts.some((p) => p.id === id)) return;
        set({ fix: { ...fix, selected: id, carrying: true } });
      },

      shiftLevelPart({ dx = 0, dz = 0, turn }) {
        const { fix } = get();
        if (!fix?.selected || get().role !== 'design') return false;
        return moveLevelPart(fix.selected, (p) => ({ ...p, x: p.x + dx, z: p.z + dz, yaw: turn ? (((p.yaw + 90) % 360) as Part['yaw']) : p.yaw }), false);
      },

      addToKit(spare) {
        const { fix } = get();
        if (!fix || get().role !== 'design' || (fix.puzzle.spares?.length ?? 0) >= KIT_MAX) return null;
        const part = partOfSpare(spare, `kit${++kitSeq}-${Date.now() % 100000}`);
        set({ fix: { ...fix, edited: true, hand: [...fix.hand, part], puzzle: { ...fix.puzzle, spares: [...(fix.puzzle.spares ?? []), part] } }, appear: { ...get().appear, [part.id]: clock() } });
        return part.id;
      },

      reshapeKitPart(id, build) {
        const { fix } = get();
        if (!fix) return;
        // The old 3D look was made for the old shape: drawn as its shapes until a new look is made.
        const shape = <T extends { id?: string; build?: Part['build']; model?: string }>(p: T): T => (p.id === id ? { ...p, build, model: undefined } : p);
        loadSeq++;
        set({ fix: { ...fix, edited: true, hand: fix.hand.map(shape), placed: fix.placed.map(shape), puzzle: { ...fix.puzzle, spares: fix.puzzle.spares?.map(shape) } }, run: null, result: null, phase: 'idle' });
      },

      lookKitPart(id, model) {
        const { fix } = get();
        if (!fix) return;
        const look = (p: Part) => (p.id === id ? { ...p, model } : p);
        // The kit (spares) is what a shared level carries; the hand and anything placed show it now.
        set({ fix: { ...fix, hand: fix.hand.map(look), placed: fix.placed.map(look), puzzle: { ...fix.puzzle, spares: fix.puzzle.spares?.map(look) } } });
      },

      removeFromKit(id) {
        const { fix } = get();
        if (!fix || get().role !== 'design') return;
        const keep = (p: Part) => p.id !== id;
        const { puzzle } = fix;
        set({ fix: { ...fix, edited: true, hand: fix.hand.filter(keep), puzzle: { ...puzzle, missing: puzzle.missing.filter(keep), spares: puzzle.spares?.filter(keep), solution: { ...puzzle.solution, parts: puzzle.solution.parts.filter(keep) } } } });
      },

      rotatePicked() {
        const { fix } = get();
        if (fix && get().role === 'design') { get().shiftLevelPart({ turn: true }); return; }
        if (!fix || fix.solved || fix.winning) return;
        let { picking } = fix;
        let placed = fix.placed;
        if (picking === null) return;
        const id = fix.hand[picking].id;
        if (placed.some((p) => p.id === id)) placed = placed.filter((p) => p.id !== id);
        const hand = fix.hand.map((h, i) => (i === picking ? { ...h, yaw: (((h.yaw + 90) % 360) as Part['yaw']) } : h));
        set({ fix: { ...fix, hand, placed, picking }, run: null, result: null, phase: 'idle' });
      },
  
      appear: {},
      buildByWords(text) {
        let fix = get().fix;
        if (!fix || fix.solved || fix.winning) return false;
        const board = withPlacements(fix.puzzle, fix.placed);
        // "remove train station #2" typed in the Build box: that is the level's, so the level box's reader takes it.
        if (/^(?:please\s+)?(?:remove|delete|take away|get rid of)\b/i.test(text.trim()) && partsNamed(text, board.parts).some((p) => p.fixed)) {
          set({ draft: '' });
          void get().changeLevel(text);
          return true;
        }
        const move = readBuildMove(text, { parts: board.parts, hand: fix.hand, placed: new Set(fix.placed.map((p) => p.id)) });
        if (!move) {
          // Help only on request: "solve it", "show me how", "hint".
          if (/\b(solve|solution|show me how|help me|i give up|stuck)\b/i.test(text)) { set({ draft: '' }); void get().solveForMe(); return true; }
          if (/\bhint\b/i.test(text)) { set({ draft: '', notice: 'The green outlines show where the AI’s parts go.' }); get().showHint(); return true; }
          // Anything else asked for ("put a table by the bell") changes the level: its designer's to do.
          if (get().role === 'play') {
            set({ notice: get().ownLevel()
              ? 'That changes the level itself. Switch to ✏️ Edit level to do it, then test it again.'
              : 'That changes the level itself, and only its designer can. Here you build with the parts in your tray.' });
            return true;
          }
          set({ draft: '' });
          void get().changeLevel(text);
          return true;
        }
        set({ draft: '' });
        if (move.action === 'error') { set({ notice: move.message }); return true; }
        // A new part when the tray has none to spare: adding always adds.
        if (move.action === 'place' && move.index < 0) {
          let n = 1;
          while (fix.hand.some((h) => h.id === `added-${move.kind}-${n}`)) n++;
          const fresh: Part = { id: `added-${move.kind}-${n}`, kind: move.kind, x: 0, y: 0, z: 0, yaw: 0, ...(move.kind === 'platform' ? { length: 3 } : move.kind === 'dominoes' ? { length: 5 } : {}) };
          fix = { ...fix, hand: [...fix.hand, fresh] };
          set({ fix });
          move.index = fix.hand.length - 1;
        }
        const part = fix.hand[move.index];
        const label = move.what[0].toUpperCase() + move.what.slice(1);
        if (move.action === 'remove') {
          get().pickPlaced(part.id);
          set({ notice: `${label} back in your tray.` });
          return true;
        }
        const was = fix.placed.find((p) => p.id === part.id);
        const goal = board.parts.find((p) => targetParts(board).has(p.id) && p.kind !== 'ball');
        const at = move.action === 'turn' ? (was ? { x: was.x, z: was.z } : undefined) : move.at;
        // Facing: what was said, else the way it already faced, else toward the goal.
        const yaw = move.yaw ?? (was ? was.yaw : at && goal ? yawToward(at, goal) : part.yaw);
        const hand = fix.hand.map((h, i) => (i === move.index ? { ...h, yaw } : h));
        set({ fix: { ...fix, hand, placed: fix.placed.filter((p) => p.id !== part.id), picking: move.index } });
        if (!at) {
          set({ notice: move.action === 'turn' ? `${label} turned. Click the board to put it down.` : `${label} in hand. Click the board where it goes, or say where: "next to the ${board.parts.find((p) => p.kind === 'ball')?.label ?? 'ball'}".` });
          return true;
        }
        const stage = stageOf(board);
        for (const c of cellsAround(at, move.action === 'place' && !!move.near, goal)) {
          const probe = { ...hand[move.index], x: c.x, z: c.z };
          if (!footprint(probe).every((f) => inStage(stage, f.x, f.z))) continue;
          if (get().placeAt(c.x, c.z)) {
            const facing = ['east', 'south', 'west', 'north'][yaw / 90];
            set((s) => ({ appear: { ...s.appear, [part.id]: clock() }, notice: `${label} ${move.action === 'turn' ? 'turned' : was ? 'moved' : 'placed'} at ${c.x},${c.z}, facing ${facing}. Press Run to try it.` }));
            sound.place();
            return true;
          }
        }
        // Nowhere free near there: put it back as it was.
        set({ fix: { ...fix }, notice: `No free spot for the ${move.what} there. Try another place or click the board.` });
        return true;
      },
      pickPlaced(id) {
        const { fix } = get();
        if (!fix || fix.solved || fix.winning) return;
        const index = fix.hand.findIndex((m) => m.id === id);
        if (index < 0) return;
        const lifted = fix.placed.find((p) => p.id === id);
        let placed = fix.placed.filter((p) => p.id !== id);
        // Whatever stood on a lifted shelf comes up with it, back into the hand.
        const all = [...fix.puzzle.spec.parts, ...placed];
        placed = placed.filter((p) => isSupported(all, p, fix.puzzle.spec.terrain));
        set({ fix: { ...fix, placed, picking: index, lift: lifted && onPosts(lifted.kind) ? lifted.y : fix.lift }, run: null, result: null, phase: 'idle' });
      },
  
      liftBy(by) {
        const { fix } = get();
        if (!fix || fix.solved || fix.winning || fix.picking === null) return;
        const part = fix.hand[fix.picking];
        if (!onPosts(part.kind)) return;
        if (fix.placed.some((p) => p.id === part.id)) get().pickPlaced(part.id);
        set((s) => (s.fix ? { fix: { ...s.fix, lift: Math.max(0, Math.min(GRID.y - 1, s.fix.lift + by)) } } : {}));
      },
  
      clearPlaced() {
        const { fix } = get();
        if (!fix || fix.solved || fix.winning) return;
        set({ fix: { ...fix, placed: [], picking: 0, hand: handOf(fix.puzzle).map((m) => ({ ...m })) }, run: null, result: null, phase: 'idle' });
      },
  
      async runFix() {
        const { fix } = get();
        if (!fix || fix.solved || fix.winning) return;
        set({ fix: { ...fix, tries: fix.tries + 1, broke: undefined } });
        const result = await simulate(withPlacements(fix.puzzle, fix.placed));
        // The goal happened, but a challenge level also wants it done its way.
        const broke = result?.success ? ruleProblems(fix.puzzle.solution.rules, result, fix.placed.length) : [];
        if (broke.length) set((s) => (s.fix ? { fix: { ...s.fix, broke } } : {}));
        if (result?.success && !broke.length) {
          const playing = get().phase === 'playing';
          set((s) => (s.fix ? { fix: { ...s.fix, solved: !playing, winning: playing, stars: s.fix.assisted ? 0 : starsFor(s.fix), server: 'checking' } } : {}));
          // The server runs the same build: the same physics must give the same trace, bit for bit.
          const browserHash = get().hash;
          void verifyOnServer(withPlacements(fix.puzzle, fix.placed)).then((v) => {
            const server = !v ? 'offline' : v.success && v.hash === browserHash ? 'agrees' : 'differs';
            if (server === 'differs') console.warn('[machine] server run differs', { browser: browserHash, server: v });
            set((s) => (s.fix?.solved || s.fix?.winning ? { fix: { ...s.fix, server } } : {}));
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
            storage.set(STARS_KEY, JSON.stringify(next));
            set({ stars: next });
          }
          // Today's level: a personal best in tries.
          const { daily, fix: done } = get();
          if (daily.date && done && !done.assisted && (!daily.best[daily.date] || done.tries < daily.best[daily.date])) {
            const best = { ...daily.best, [daily.date]: done.tries };
            storage.set(BEST_KEY, JSON.stringify(best));
            set({ daily: { ...daily, best } });
          }
        }
      },
  
      async solveForMe() {
        const { fix } = get();
        if (!fix || fix.solved || ['simulating', 'playing'].includes(get().phase)) return;
        if (get().noHelp()) { set({ notice: 'No solutions in the levels: this one is yours to crack. Move or turn a part and run it again.' }); return; }
        logPlay(playKey(), 'hint', fix.tries, fix.placed.length);
        // A level set with no solution: the AI looks for one now, on the server, and the physics checks it.
        if (!fix.puzzle.missing.length) {
          aiAbort?.abort();
          const controller = new AbortController();
          aiAbort = controller;
          const log = (line: string) => set((s) => ({ ai: { ...s.ai, lines: [...s.ai.lines, line].slice(-8) } }));
          set({ ai: { ...idleAi, busy: true }, notice: null });
          let found: Extract<MachineStreamEvent, { type: 'machine' }> | null = null;
          try {
            // With the player's kit, so the server can look for a build from it first.
            const kit = handOf(fix.puzzle).map(spareOf);
            await streamMachine('/machine/solve', { machine: kit.length ? { ...fix.puzzle.spec, spares: kit } : fix.puzzle.spec }, (e) => {
              if (aiAbort !== controller) return;
              if (e.type === 'stage') log(e.message);
              else if (e.type === 'machine') found = e;
              else if (e.type === 'error') throw new Error(e.error);
            }, controller.signal);
          } catch (err) {
            // Stopped by the player: nothing to tell.
            if (aiAbort === controller && !controller.signal.aborted) set({ ai: { ...idleAi }, notice: `The AI could not look for a way just now: ${err instanceof Error ? err.message : String(err)}` });
            return;
          }
          if (controller.signal.aborted) return;
          if (aiAbort !== controller) return;
          set({ ai: { ...idleAi } });
          const res = found as Extract<MachineStreamEvent, { type: 'machine' }> | null;
          const now = get().fix;
          if (!now || now.solved) return;
          if (!res?.solved) {
            set({ notice: 'The AI could not find a way through this level. Your board is as you left it; maybe there is a way nobody has found yet.' });
            return;
          }
          // Parts from the player's own kit take the hand part's id (same kind and label); the AI's extra parts join the hand.
          const hand = handOf(now.puzzle).map((m) => ({ ...m }));
          const taken = new Set<string>();
          const added = res.machine.parts.filter((p) => !now.puzzle.spec.parts.some((q) => q.id === p.id)).map((p) => {
            const own = hand.find((h) => !taken.has(h.id) && h.kind === p.kind && h.label === p.label);
            if (!own) return p;
            taken.add(own.id);
            return { ...p, id: own.id };
          });
          set({ fix: { ...now, hand: [...hand, ...added.filter((p) => !taken.has(p.id))], placed: added, hint: true, assisted: true, picking: null },
            appear: { ...get().appear, ...Object.fromEntries(added.map((p, i) => [p.id, clock() + i * 120])) },
            notice: taken.size && taken.size === added.length ? 'Here is one way with your own parts. Watch it run, then try your own.' : 'Here is one way the AI found. Watch it run, then try your own.' });
          await get().runFix();
          return;
        }
        set({ fix: { ...fix, placed: fix.puzzle.missing.map((p) => ({ ...p })), hint: true, assisted: true, picking: null },
          appear: { ...get().appear, ...Object.fromEntries(fix.puzzle.missing.map((p, i) => [p.id, clock() + i * 120])) },
          notice: fix.puzzle.verified === false ? 'This is the AI’s own idea; nobody has run it yet. Watch what happens.' : 'Here is one way the AI found. Watch it run, then try your own.' });
        await get().runFix();
      },
      tryMyself() {
        const { fix } = get();
        if (!fix?.assisted) return;
        loadSeq++;
        set({ fix: { ...fix, placed: [], solved: false, assisted: false, stars: 0, server: undefined, picking: 0, hand: handOf(fix.puzzle).map((m) => ({ ...m })) },
          run: null, result: null, phase: 'idle', notice: 'Your turn. The AI’s parts are back in the tray; any build that works counts.' });
      },
      showHint() {
        const { fix } = get();
        if (get().noHelp()) return;
        if (fix && !fix.hint) { logPlay(playKey(), 'hint', fix.tries, fix.placed.length); }
        set((s) => (s.fix && !s.fix.hint ? { fix: { ...s.fix, hint: true, tries: s.fix.tries + HINT_COST } } : {}));
      },
  
    };
  });
}
