import {
  dropAt, parseMachine, PUZZLE_KINDS, withPlacements,
  type MachineResult, type MachineRun, type MachineSpec, type MachineStreamEvent, type Part, type Puzzle, type PuzzleKind,
} from '@og/machine';
import { create } from 'zustand';
import { sfx } from '../game/audio';
import { getDailyMachine, makePuzzleInWorker, simulateInWorker, streamMachine } from './machineClient';

export interface MachineAiLog {
  busy: boolean;
  lines: string[];
  progress: number;
  error: string | null;
  /** Parts Claude has written so far for the design in progress. */
  sketch: { attempt: number; title?: string; parts: Part[] } | null;
}

/** How far the machine on screen got: 0 = designed, not proven; 1 = proven by the physics; 2 = final. */
export type MachineRank = 0 | 1 | 2;

export type PlayPhase = 'idle' | 'simulating' | 'playing' | 'done';

/** Build: the AI makes machines and you watch or change them. Fix: a part is missing and you put it back. */
export type Mode = 'build' | 'fix';

export interface FixState {
  puzzle: Puzzle;
  kind: PuzzleKind;
  /** The parts the player has put back (same ids as the missing ones). */
  placed: Part[];
  /** Index into puzzle.missing of the part being placed, or null. */
  picking: number | null;
  tries: number;
  solved: boolean;
  hint: boolean;
}

interface MachineState {
  prompt: string;
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
  create: (prompt: string) => Promise<void>;
  edit: (instruction: string) => Promise<void>;
  load: (machine: MachineSpec, meta?: { rank?: MachineRank; proven?: boolean; moved?: { id: string; cells: number }[] }) => Promise<void>;
  play: () => void;
  setTime: (t: number) => void;
  celebrate: (step: number) => void;
  finish: () => void;
  stopAi: () => void;

  /** Today's shared fix-it ladder: the same machine broken three ways, tries add up. */
  daily: { date: string; loading: boolean; best: Record<string, number>; stage: number; tries: number };
  playDaily: () => Promise<void>;
  /** After a daily stage is solved: break the machine the next way. */
  nextDailyStage: () => Promise<void>;
  /** Break the proven machine and hand the player the parts. Resolves false when it cannot be broken that way. */
  startFix: (kind?: PuzzleKind) => Promise<boolean>;
  pick: (index: number | null) => void;
  /** Drop the picked part on a column; false when something is in the way. */
  placeAt: (x: number, z: number) => boolean;
  /** Lift a placed part back into the hand. */
  pickPlaced: (id: string) => void;
  clearPlaced: () => void;
  runFix: () => Promise<void>;
  showHint: () => void;
  leaveFix: () => void;
}

const idleAi: MachineAiLog = { busy: false, lines: [], progress: 0, error: null, sketch: null };

const BEST_KEY = 'pg.daily.best';
function loadBest(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
let aiAbort: AbortController | null = null;
let loadSeq = 0;

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

  const aiStream = async (path: '/machine' | '/machine/edit', body: unknown) => {
    aiAbort?.abort();
    aiAbort = new AbortController();
    set({ ai: { busy: true, lines: [], progress: 0, error: null, sketch: null }, working: true, mode: 'build', fix: null });
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
      await get().load(parsed.spec, { rank, proven: rank >= 1, moved });
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
            set((s) => ({ ai: { ...s.ai, sketch: { attempt: e.attempt, title: e.title, parts: e.parts } } }));
            break;
          case 'draft':
            log(e.status === 'solved' ? 'The physics proved it works.' : 'Design ready. Running it…');
            void accept(e.machine, e.status === 'solved' ? 1 : 0);
            break;
          case 'machine':
            log(e.solved ? `Verified: the machine works${e.moved.length ? ` after nudging ${e.moved.length} part${e.moved.length > 1 ? 's' : ''}` : ''}.` : 'Could not make it work; here is the closest attempt.');
            void accept(e.machine, 2, e.moved).then(() => set((s) => ({
              ai: { ...idleAi, lines: s.ai.lines }, working: false, proven: e.solved,
              builds: s.builds + (path === '/machine' ? 1 : 0), edits: s.edits + (path === '/machine/edit' ? 1 : 0),
            })));
            break;
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
    daily: { date: '', loading: false, best: loadBest(), stage: 0, tries: 0 },
    run: null,
    result: null,
    hash: null,
    phase: 'idle',
    time: 0,
    endTime: 0,
    celebrated: 0,
    error: null,

    setPrompt: (prompt) => set({ prompt }),

    create(prompt) {
      set({ prompt, machine: null, run: null, result: null, rank: 0, proven: false, moved: [], phase: 'idle', time: 0, celebrated: 0 });
      return aiStream('/machine', { prompt });
    },

    edit(instruction) {
      const { machine } = get();
      if (!machine) return Promise.resolve();
      return aiStream('/machine/edit', { machine, instruction });
    },

    async load(machine, meta = {}) {
      set({ machine, rank: meta.rank ?? 0, proven: meta.proven ?? false, moved: meta.moved ?? [], mode: 'build', fix: null });
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
      const { phase, result, mode } = get();
      if (phase !== 'playing') return;
      set({ phase: 'done' });
      if (result?.success) sfx.success();
      else if (mode === 'fix') sfx.miss();
    },

    stopAi() {
      aiAbort?.abort();
      set({ ai: idleAi, working: false });
    },

    async playDaily() {
      aiAbort?.abort();
      set((s) => ({ ai: idleAi, working: false, daily: { ...s.daily, loading: true }, error: null }));
      try {
        const d = await getDailyMachine();
        const parsed = parseMachine(d.machine);
        if (!parsed.ok) throw new Error("Today's machine is broken; try again later.");
        set({ machine: parsed.spec, rank: 2, proven: true, moved: [], mode: 'build', fix: null });
        set((s) => ({ daily: { ...s.daily, date: d.date, loading: false, stage: 0, tries: 0 } }));
        await get().nextDailyStage();
      } catch (err) {
        set((s) => ({ daily: { ...s.daily, loading: false }, error: err instanceof Error ? err.message : String(err) }));
      }
    },

    async nextDailyStage() {
      const { daily } = get();
      // Stages go missing, two missing, moved; a stage the machine cannot offer is skipped.
      for (let stage = daily.stage + 1; stage <= PUZZLE_KINDS.length; stage++) {
        set((s) => ({ daily: { ...s.daily, stage } }));
        if (await get().startFix(PUZZLE_KINDS[stage - 1])) return;
      }
      set((s) => ({ daily: { ...s.daily, stage: PUZZLE_KINDS.length + 1 } }));
    },

    async startFix(kind = 'missing') {
      const { machine, proven, daily } = get();
      if (!machine || !proven) return false;
      set({ phase: 'simulating', error: null });
      const seed = daily.date ? Number(daily.date.replace(/-/g, '')) : Math.floor(Math.random() * 1e9);
      const puzzle = await makePuzzleInWorker(machine, kind, seed);
      if (!puzzle) {
        set({ phase: 'idle', error: kind === 'missing' ? 'This machine has no part that can be taken out; try another one.' : 'This machine cannot be broken that way; try another kind.' });
        return false;
      }
      set({ mode: 'fix', fix: { puzzle, kind, placed: puzzle.start, picking: puzzle.start.length ? null : 0, tries: 0, solved: false, hint: false } });
      // Show the broken machine fail first, so the player sees what is wrong.
      await simulate(withPlacements(puzzle, puzzle.start));
      return true;
    },

    pick(index) {
      set((s) => (s.fix ? { fix: { ...s.fix, picking: index } } : {}));
    },

    placeAt(x, z) {
      const { fix } = get();
      if (!fix || fix.picking === null || fix.solved) return false;
      const original = fix.puzzle.missing[fix.picking];
      const others = fix.placed.filter((p) => p.id !== original.id);
      // Lands on the floor or the platform under the cursor; a taken cell refuses it.
      const part = dropAt([...fix.puzzle.spec.parts, ...others], original, x, z);
      if (!part) return false;
      const placed = [...others, part];
      const next = fix.puzzle.missing.findIndex((m) => !placed.some((p) => p.id === m.id));
      set({ fix: { ...fix, placed, picking: next >= 0 ? next : null }, run: null, result: null, phase: 'idle' });
      return true;
    },

    pickPlaced(id) {
      const { fix } = get();
      if (!fix || fix.solved) return;
      const index = fix.puzzle.missing.findIndex((m) => m.id === id);
      if (index < 0) return;
      set({ fix: { ...fix, placed: fix.placed.filter((p) => p.id !== id), picking: index }, run: null, result: null, phase: 'idle' });
    },

    clearPlaced() {
      const { fix } = get();
      if (!fix || fix.solved) return;
      set({ fix: { ...fix, placed: [], picking: 0 }, run: null, result: null, phase: 'idle' });
    },

    async runFix() {
      const { fix } = get();
      if (!fix || fix.solved) return;
      set({ fix: { ...fix, tries: fix.tries + 1 } });
      const result = await simulate(withPlacements(fix.puzzle, fix.placed));
      if (result?.success) {
        set((s) => (s.fix ? { fix: { ...s.fix, solved: true } } : {}));
        // The daily ladder adds up tries; the last stage records a personal best.
        const { daily, fix: done } = get();
        if (daily.date && done) {
          const tries = daily.tries + done.tries;
          const last = daily.stage >= PUZZLE_KINDS.length;
          const best = last && (!daily.best[daily.date] || tries < daily.best[daily.date]) ? { ...daily.best, [daily.date]: tries } : daily.best;
          if (best !== daily.best) { try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* private mode */ } }
          set({ daily: { ...daily, tries, best } });
        }
      }
    },

    showHint() {
      set((s) => (s.fix ? { fix: { ...s.fix, hint: true } } : {}));
    },

    leaveFix() {
      const { machine } = get();
      set((s) => ({ mode: 'build', fix: null, daily: { ...s.daily, date: '', stage: 0, tries: 0 } }));
      if (machine) void simulate(machine);
    },
  };
});

// Dev only: lets headless browser checks drive the screen.
if (import.meta.env.DEV) (window as unknown as { __machine: typeof useMachine }).__machine = useMachine;
