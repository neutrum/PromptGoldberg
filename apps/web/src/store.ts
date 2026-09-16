import { create } from 'zustand';
import { runSimulation, type RunData } from './simClient';

export interface Attempt {
  id: number;
  label: string;
  run: RunData;
}

interface AppState {
  attempts: Attempt[];
  currentId: number | null;
  status: 'idle' | 'simulating' | 'error';
  error: string | null;

  time: number;
  playing: boolean;
  /** Simulated years per real second. */
  speed: number;
  showGhosts: boolean;
  focusId: string | null;

  loadSpec: (spec: unknown, label: string, opts?: { replace?: boolean }) => Promise<void>;
  selectAttempt: (id: number) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setShowGhosts: (v: boolean) => void;
  setFocus: (id: string | null) => void;
}

let attemptSeq = 1;

/** Playback speed that shows the whole run in about 20 seconds. */
const defaultSpeed = (duration: number) => duration / 20;

export const useStore = create<AppState>((set, get) => ({
  attempts: [],
  currentId: null,
  status: 'idle',
  error: null,
  time: 0,
  playing: false,
  speed: 1,
  showGhosts: true,
  focusId: null,

  async loadSpec(spec, label, opts = {}) {
    set({ status: 'simulating', error: null });
    try {
      const run = await runSimulation(spec);
      const attempt: Attempt = { id: attemptSeq++, label, run };
      set((s) => ({
        attempts: opts.replace ? [attempt] : [...s.attempts, attempt],
        currentId: attempt.id,
        status: 'idle',
        time: 0,
        playing: true,
        speed: defaultSpeed(run.duration),
        focusId: s.focusId && run.ids.includes(s.focusId) ? s.focusId : null,
      }));
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  selectAttempt(id) {
    const a = get().attempts.find((x) => x.id === id);
    if (!a) return;
    set({ currentId: id, time: Math.min(get().time, a.run.duration) });
  },
  setTime: (t) => set({ time: t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),
  setShowGhosts: (v) => set({ showGhosts: v }),
  setFocus: (id) => set({ focusId: id }),
}));

export const useCurrentAttempt = () =>
  useStore((s) => s.attempts.find((a) => a.id === s.currentId) ?? null);
