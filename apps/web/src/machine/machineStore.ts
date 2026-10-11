import { parseMachine, type MachineResult, type MachineRun, type MachineSpec, type MachineStreamEvent, type Part } from '@og/machine';
import { create } from 'zustand';
import { simulateInWorker, streamMachine } from './machineClient';

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

interface MachineState {
  prompt: string;
  machine: MachineSpec | null;
  rank: MachineRank;
  /** Versions are still arriving from the AI. */
  working: boolean;
  proven: boolean;
  moved: { id: string; cells: number }[];
  ai: MachineAiLog;

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
}

const idleAi: MachineAiLog = { busy: false, lines: [], progress: 0, error: null, sketch: null };
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
  const aiStream = async (path: '/machine' | '/machine/edit', body: unknown) => {
    aiAbort?.abort();
    aiAbort = new AbortController();
    set({ ai: { busy: true, lines: [], progress: 0, error: null, sketch: null }, working: true });
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
            void accept(e.machine, 2, e.moved).then(() => set((s) => ({ ai: { ...idleAi, lines: s.ai.lines }, working: false, proven: e.solved })));
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
      const seq = ++loadSeq;
      set({ machine, rank: meta.rank ?? 0, proven: meta.proven ?? false, moved: meta.moved ?? [], phase: 'simulating', error: null, run: null, result: null, time: 0, celebrated: 0 });
      try {
        const { run, result, hash } = await simulateInWorker(machine);
        if (seq !== loadSeq) return;
        set({ run, result, hash, phase: 'playing', time: 0, celebrated: 0, endTime: playbackEnd(run, result) });
      } catch (err) {
        if (seq !== loadSeq) return;
        set({ phase: 'idle', error: err instanceof Error ? err.message : String(err) });
      }
    },

    play() {
      const { run, result } = get();
      if (!run || !result) return;
      set({ phase: 'playing', time: 0, celebrated: 0, endTime: playbackEnd(run, result) });
    },

    setTime: (time) => set({ time }),

    celebrate(step) {
      if (step < get().celebrated) return;
      set({ celebrated: step + 1 });
    },

    finish() {
      if (get().phase === 'playing') set({ phase: 'done' });
    },

    stopAi() {
      aiAbort?.abort();
      set({ ai: idleAi, working: false });
    },
  };
});
